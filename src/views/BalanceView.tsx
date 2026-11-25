import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Share2,
  Calendar,
  TrendingDown,
  PieChart as PieIcon,
  BarChart2,
  Store,
  CheckCircle2,
  Loader2,
  X,
  Smartphone,
  Banknote,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { toPng } from 'html-to-image';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Movimiento, Puesto, CATEGORIAS_GASTO, NaturalezaMovimiento, CategoriaMovimiento, LiquidacionSemanal, SaldosInicialesCaja, TransferenciaCaja } from '../types';
import { calcularMontos, formatNumber, formatPorcentaje, formatUSD, formatVES } from '../utils/format';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { getSemanaLunesSabado, shiftSemana } from '../utils/dateUtils';
import { getVenezuelaDate } from '../utils/parserLocal';
import { getLiquidacionesSemanales, registrarLiquidacionSemanal, insertMovimientos } from '../services/supabase';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';
import { CajaDisponibleCard } from '../components/CajaDisponibleCard';
import { ModalSaldoInicial } from '../components/ModalSaldoInicial';
import { ModalTransferenciaCaja } from '../components/ModalTransferenciaCaja';
import { ResumenMensualView } from '../components/ResumenMensualView';

interface Props {
  movimientos: Movimiento[];
  puestos?: Puesto[];
  tasaActual?: number;
  onGuardarMovimientos?: (movs: Omit<Movimiento, 'id' | 'created_at'>[]) => Promise<Movimiento[]>;
  onRecargarDatos?: () => Promise<void>;
}

const normalizarMetodoPago = (
  raw?: string
): 'pago_movil' | 'punto_venta' | 'efectivo_bs' | 'divisa' | null => {
  if (!raw) return null;
  const norm = raw
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // Divisas / USD / Dólares
  if (
    norm === 'divisa' ||
    norm === 'divisas' ||
    norm.includes('divisa') ||
    norm.includes('dolar') ||
    norm === 'usd' ||
    norm === '$' ||
    norm.includes('usd') ||
    norm.includes('zelle')
  ) {
    return 'divisa';
  }

  // Efectivo Bs
  if (
    norm === 'efectivo_bs' ||
    norm === 'efectivo' ||
    norm.includes('efectivo bs') ||
    norm.includes('efectivo (bs)') ||
    norm === 'bs_efectivo' ||
    norm.includes('billetes bs') ||
    norm.includes('bolivares')
  ) {
    return 'efectivo_bs';
  }

  // Pago Móvil / Digital / Banco
  if (
    norm === 'pago_movil' ||
    norm.includes('pago movil') ||
    norm.includes('pagomovil') ||
    norm === 'pm' ||
    norm.includes('transferencia') ||
    norm.includes('banco')
  ) {
    return 'pago_movil';
  }

  // Punto de Venta
  if (
    norm === 'punto_venta' ||
    norm.includes('punto') ||
    norm === 'pos' ||
    norm.includes('biopago') ||
    norm.includes('tarjeta')
  ) {
    return 'punto_venta';
  }

  return null;
};

export const BalanceView: React.FC<Props> = ({
  movimientos,
  puestos = [],
  tasaActual = 100,
  onGuardarMovimientos,
  onRecargarDatos,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [compartiendo, setCompartiendo] = useState(false);
  const [filtroPuesto, setFiltroPuesto] = useState<string>('todos');

  // Modo de período: 'semanal' o 'mensual'
  const [periodo, setPeriodo] = useState<'semanal' | 'mensual'>('semanal');
  const [fechaMes, setFechaMes] = useState<Date>(() => new Date());

  // Acordeones para evitar scroll infinito en móvil
  const [detalleDiarioAbierto, setDetalleDiarioAbierto] = useState(false);
  const [categoriasAbierto, setCategoriasAbierto] = useState(false);
  const [graficosAbierto, setGraficosAbierto] = useState(false);

  // Estado de Caja Disponible en tiempo real
  const [movimientosHistoricos, setMovimientosHistoricos] = useState<Movimiento[]>(movimientos);
  const [saldosIniciales, setSaldosIniciales] = useState<SaldosInicialesCaja>({
    digital_bs: 0,
    efectivo_bs: 0,
    divisas_usd: 0,
  });
  const [transferencias, setTransferencias] = useState<TransferenciaCaja[]>([]);
  const [cargandoCaja, setCargandoCaja] = useState<boolean>(false);

  // Modales de caja
  const [modalSaldoInicialAbierto, setModalSaldoInicialAbierto] = useState(false);
  const [modalTransferenciaAbierto, setModalTransferenciaAbierto] = useState(false);

  // Carga global de datos vía fetch directo (movimientos, saldos_iniciales_caja y transferencias_caja)
  const cargarDatosCajaYMovimientos = useCallback(async () => {
    setCargandoCaja(true);
    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const headers = {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      };

      // 1. Cargar todos los movimientos históricos
      try {
        const resMovs = await fetch(
          `${supabaseUrl}/rest/v1/movimientos?select=*&order=fecha.desc,created_at.desc`,
          { headers }
        );
        if (resMovs.ok) {
          const dataMovs = await resMovs.json();
          if (Array.isArray(dataMovs)) {
            setMovimientosHistoricos(dataMovs);
          }
        }
      } catch (e) {
        console.warn('Error al cargar movimientos históricos:', e);
      }

      // 2. Cargar saldos iniciales de caja
      try {
        const resSaldos = await fetch(
          `${supabaseUrl}/rest/v1/saldos_iniciales_caja?id=eq.1&select=*`,
          { headers }
        );
        if (resSaldos.ok) {
          const dataSaldos = await resSaldos.json();
          if (Array.isArray(dataSaldos) && dataSaldos.length > 0) {
            setSaldosIniciales({
              id: dataSaldos[0].id,
              digital_bs: Number(dataSaldos[0].digital_bs) || 0,
              efectivo_bs: Number(dataSaldos[0].efectivo_bs) || 0,
              divisas_usd: Number(dataSaldos[0].divisas_usd) || 0,
            });
          }
        }
      } catch (e) {
        console.warn('Error al cargar saldos iniciales:', e);
      }

      // 3. Cargar transferencias de caja
      try {
        const resTrans = await fetch(
          `${supabaseUrl}/rest/v1/transferencias_caja?select=*&order=fecha.desc,created_at.desc`,
          { headers }
        );
        if (resTrans.ok) {
          const dataTrans = await resTrans.json();
          if (Array.isArray(dataTrans)) {
            setTransferencias(dataTrans);
          }
        }
      } catch (e) {
        console.warn('Error al cargar transferencias de caja:', e);
      }
    } finally {
      setCargandoCaja(false);
    }
  }, []);

  useEffect(() => {
    cargarDatosCajaYMovimientos();
  }, [cargarDatosCajaYMovimientos]);

  // Si los movimientos pasados por prop se actualizan (por ejemplo desde App.tsx), sincronizar
  useEffect(() => {
    if (movimientos && movimientos.length > 0) {
      setMovimientosHistoricos(movimientos);
    }
  }, [movimientos]);

  // Cálculo en tiempo real de la Caja Disponible en cada bolsillo
  const cajaDisponible = useMemo(() => {
    let digitalBs = saldosIniciales.digital_bs || 0;
    let efectivoBs = saldosIniciales.efectivo_bs || 0;
    let divisasUsd = saldosIniciales.divisas_usd || 0;

    const baseMovs = movimientosHistoricos.length > 0 ? movimientosHistoricos : movimientos;

    for (const m of baseMovs) {
      const tipoNorm = (m.tipo || '').toString().toLowerCase().trim();
      const esVenta = tipoNorm === 'venta' || tipoNorm === 'ingreso';
      const esGasto = tipoNorm === 'gasto' || tipoNorm === 'egreso';
      if (!esVenta && !esGasto) continue;

      const tasaMov = Number(m.tasa_aplicada) || Number(m.tasa) || (tasaActual > 0 ? tasaActual : 100);
      const montoOrig = Math.abs(Number(m.monto_original) || 0);
      const moneda = (m.moneda_original || m.moneda || '').toUpperCase();
      const metodoNorm = normalizarMetodoPago(m.metodo_pago);
      const esUSD = moneda === 'USD' || metodoNorm === 'divisa';

      const montoBs =
        m.monto_bs !== undefined && m.monto_bs !== null && !isNaN(Number(m.monto_bs)) && Number(m.monto_bs) !== 0
          ? Math.abs(Number(m.monto_bs))
          : (esUSD ? montoOrig * tasaMov : montoOrig);

      const montoUsd =
        m.monto_usd !== undefined && m.monto_usd !== null && !isNaN(Number(m.monto_usd)) && Number(m.monto_usd) !== 0
          ? Math.abs(Number(m.monto_usd))
          : (esUSD ? montoOrig : (tasaMov > 0 ? montoOrig / tasaMov : 0));

      if (metodoNorm === 'pago_movil' || metodoNorm === 'punto_venta') {
        if (esVenta) digitalBs += montoBs;
        if (esGasto) digitalBs -= montoBs;
      } else if (metodoNorm === 'efectivo_bs') {
        if (esVenta) efectivoBs += montoBs;
        if (esGasto) efectivoBs -= montoBs;
      } else if (metodoNorm === 'divisa' || (!metodoNorm && esUSD)) {
        if (esVenta) divisasUsd += montoUsd;
        if (esGasto) divisasUsd -= montoUsd;
      }
    }

    for (const t of transferencias) {
      const montoDestino = Math.abs(Number(t.monto_destino ?? t.monto_recibido ?? t.monto ?? 0));
      const montoOrigen = Math.abs(Number(t.monto_origen ?? t.monto_salida ?? t.monto ?? 0));

      // Sumar al destino
      if (t.destino === 'digital_bs') digitalBs += montoDestino;
      else if (t.destino === 'efectivo_bs') efectivoBs += montoDestino;
      else if (t.destino === 'divisas_usd') divisasUsd += montoDestino;

      // Restar del origen
      if (t.origen === 'digital_bs') digitalBs -= montoOrigen;
      else if (t.origen === 'efectivo_bs') efectivoBs -= montoOrigen;
      else if (t.origen === 'divisas_usd') divisasUsd -= montoOrigen;
    }

    const limpiarCero = (val: number): number => {
      if (isNaN(val) || Math.abs(val) < 0.005 || Object.is(val, -0)) return 0;
      return val;
    };

    const dBs = limpiarCero(digitalBs);
    const eBs = limpiarCero(efectivoBs);
    const dUsd = limpiarCero(divisasUsd);
    const tasaBcvOficial = tasaActual > 0 ? tasaActual : 100;
    const totUsd = limpiarCero(dUsd + (dBs + eBs) / tasaBcvOficial);
    const totBs = limpiarCero(dUsd * tasaBcvOficial + dBs + eBs);

    return {
      digitalBs: dBs,
      efectivoBs: eBs,
      divisasUsd: dUsd,
      totalConsolidadoUsd: totUsd,
      totalConsolidadoBs: totBs,
    };
  }, [saldosIniciales, movimientosHistoricos, movimientos, transferencias, tasaActual]);

  // Fecha base para la semana (por defecto hoy)
  const [fechaSemana, setFechaSemana] = useState<Date>(() => new Date());
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionSemanal[]>([]);
  const [liquidandoPuestoId, setLiquidandoPuestoId] = useState<string | null>(null);

  // Cargar liquidaciones semanales via fetch directo
  const cargarLiquidaciones = useCallback(async () => {
    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const res = await fetch(`${supabaseUrl}/rest/v1/liquidaciones_semanales?select=*`, {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLiquidaciones(data);
          return;
        }
      }
      const data = await getLiquidacionesSemanales();
      setLiquidaciones(data);
    } catch (err) {
      console.warn('Error cargando liquidaciones en BalanceView:', err);
    }
  }, []);

  useEffect(() => {
    cargarLiquidaciones();
  }, [cargarLiquidaciones]);

  // Calcula lunes a sábado de la semana seleccionada (estricto 6 días)
  const infoSemana = useMemo(() => {
    return getSemanaLunesSabado(fechaSemana);
  }, [fechaSemana]);

  const { dias: diasSemana, rangoTexto } = infoSemana;

  // Todos los movimientos dentro de la semana (Lunes a Sábado)
  const movimientosSemana = useMemo(() => {
    const base = movimientosHistoricos.length > 0 ? movimientosHistoricos : movimientos;
    return base.filter(
      (m) => m.fecha >= infoSemana.semanaInicio && m.fecha <= infoSemana.semanaFin
    );
  }, [movimientosHistoricos, movimientos, infoSemana.semanaInicio, infoSemana.semanaFin]);

  // Estado para el modal de pago de comisiones
  interface ModalPagarComisionData {
    puestoId: string;
    puestoNombre: string;
    totalVentasUSD: number;
    comisionPorcentaje: number;
    comisionUSD: number; // Monto exacto a liquidar en esta transacción (saldo pendiente)
    comisionTotalUSD: number;
    yaPagadoUSD: number;
  }
  const [pagoModalData, setPagoModalData] = useState<ModalPagarComisionData | null>(null);
  const [montoUSDInput, setMontoUSDInput] = useState<string>('');
  const [tasaPagoComision, setTasaPagoComision] = useState<string>('');
  const [metodoPagoComision, setMetodoPagoComision] = useState<'pago_movil' | 'efectivo_bs'>('pago_movil');

  // Abrir modal de pago de comisión con datos precargados (liquidar saldo pendiente o adelanto)
  const handleAbrirModalPago = (
    p: {
      id: string;
      nombre: string;
      totalUSD: number;
      porcentaje: number;
      comisionUSD: number;
      yaPagadoUsd: number;
      pendienteUsd: number;
    },
    esAdelanto = false
  ) => {
    if (p.id === 'sin-puesto') return;
    setTasaPagoComision(tasaActual > 0 ? String(tasaActual) : '100');
    setMetodoPagoComision('pago_movil');
    const valorInicialUSD = esAdelanto ? '' : (p.pendienteUsd > 0 ? String(p.pendienteUsd) : '');
    setMontoUSDInput(valorInicialUSD);
    setPagoModalData({
      puestoId: p.id,
      puestoNombre: p.nombre,
      totalVentasUSD: p.totalUSD,
      comisionPorcentaje: p.porcentaje,
      comisionUSD: p.pendienteUsd,
      comisionTotalUSD: p.comisionUSD,
      yaPagadoUSD: p.yaPagadoUsd,
    });
  };

  // Confirmar y registrar pago de comisión llamando via fetch POST a rpc/liquidar_comision_semanal
  const handleConfirmarPago = async () => {
    if (!pagoModalData || liquidandoPuestoId) return;

    const montoUSDNum = parseFloat(montoUSDInput);
    if (isNaN(montoUSDNum) || montoUSDNum <= 0) {
      alert('Ingresa un monto en dólares ($ USD) válido mayor a 0.');
      return;
    }

    const tasaNum = parseFloat(tasaPagoComision);
    if (isNaN(tasaNum) || tasaNum <= 0) {
      alert('Ingresa una tasa BCV válida mayor a 0.');
      return;
    }

    const { puestoId, totalVentasUSD, comisionPorcentaje } = pagoModalData;
    const fechaHoyVzla = getVenezuelaDate();
    const token = getAccessTokenFromStorage() || supabaseAnonKey;

    setLiquidandoPuestoId(puestoId);
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/liquidar_comision_semanal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          p_puesto_id: puestoId,
          p_semana_inicio: infoSemana.semanaInicio,
          p_semana_fin: infoSemana.semanaFin,
          p_total_ventas_usd: totalVentasUSD,
          p_comision_porcentaje: comisionPorcentaje,
          p_monto_comision_usd: montoUSDNum,
          p_tasa_pago: tasaNum,
          p_metodo_pago: metodoPagoComision,
          p_fecha_pago: fechaHoyVzla,
        }),
      });

      if (!res.ok) {
        let errMsg = 'Error al liquidar comisión';
        try {
          const errData = await res.json();
          errMsg = errData?.message || errData?.error_description || errMsg;
        } catch {
          const text = await res.text();
          if (text) errMsg = text;
        }
        throw new Error(errMsg);
      }

      // Cerrar modal
      setPagoModalData(null);

      // Recargar liquidaciones_semanales y movimientos para actualizar inmediatamente la interfaz
      await cargarLiquidaciones();
      await cargarDatosCajaYMovimientos();
      if (onRecargarDatos) {
        await onRecargarDatos();
      }
    } catch (err: any) {
      console.error('Error al registrar pago de comisión:', err);
      alert(err?.message || 'Error al procesar el pago de comisión.');
    } finally {
      setLiquidandoPuestoId(null);
    }
  };

  // Movimientos de la semana filtrados por puesto (si está activo un filtro)
  const movimientosSemanaFiltrados = useMemo(() => {
    if (filtroPuesto === 'todos') return movimientosSemana;
    return movimientosSemana.filter((m) => m.puesto_id === filtroPuesto);
  }, [movimientosSemana, filtroPuesto]);

  // Nombre del puesto actualmente filtrado
  const nombreFiltroPuesto = useMemo(() => {
    if (filtroPuesto === 'todos') return 'Todos los puestos';
    const match = puestos.find((p) => p.id === filtroPuesto);
    return match ? match.nombre : 'Puesto seleccionado';
  }, [filtroPuesto, puestos]);

  // 1. KPI Totales (incluyendo separación visual entre Gastos Operativos y Retiros Personales)
  const {
    totalIngresosUSD,
    totalGastosUSD,
    gastosOperativosUSD,
    retirosPersonalesUSD,
    balanceNetoUSD,
    totalIngresosBs,
    totalGastosBs,
    balanceNetoBs,
  } = useMemo(() => {
    let ingUSD = 0;
    let gasUSD = 0;
    let gasOpUSD = 0;
    let retPersUSD = 0;
    let ingBs = 0;
    let gasBs = 0;

    for (const m of movimientosSemanaFiltrados) {
      const { monto_usd, monto_bs } = calcularMontos(m);
      if (m.tipo === 'venta' || m.tipo === 'ingreso') {
        ingUSD += monto_usd;
        ingBs += monto_bs;
      } else {
        gasUSD += monto_usd;
        gasBs += monto_bs;
        if (m.naturaleza === 'Personal') {
          retPersUSD += monto_usd;
        } else {
          gasOpUSD += monto_usd;
        }
      }
    }

    const bUSD = ingUSD - gasUSD;
    const bBs = ingBs - gasBs;

    return {
      totalIngresosUSD: ingUSD,
      totalGastosUSD: gasUSD,
      gastosOperativosUSD: gasOpUSD,
      retirosPersonalesUSD: retPersUSD,
      balanceNetoUSD: Math.abs(bUSD) < 0.005 || Object.is(bUSD, -0) ? 0 : bUSD,
      totalIngresosBs: ingBs,
      totalGastosBs: gasBs,
      balanceNetoBs: Math.abs(bBs) < 0.005 || Object.is(bBs, -0) ? 0 : bBs,
    };
  }, [movimientosSemanaFiltrados]);

  // 2. Resumen por Puesto de Venta (Ventas, Comisión, Liquidaciones Parciales y Saldo Pendiente)
  const resumenPorPuesto = useMemo(() => {
    const items = puestos.map((p) => {
      const ventasPuesto = movimientosSemana.filter(
        (m) => (m.tipo === 'venta' || m.tipo === 'ingreso') && m.puesto_id === p.id
      );
      let totalUSD = 0;
      let totalBs = 0;

      for (const v of ventasPuesto) {
        const { monto_usd, monto_bs } = calcularMontos(v);
        totalUSD += monto_usd;
        totalBs += monto_bs;
      }

      const pct = Number(p.porcentaje_comision) || 22.0;
      const comisionUSD = Math.round(((totalUSD * pct) / 100) * 100) / 100;
      const netoUSD = Math.round((totalUSD - comisionUSD) * 100) / 100;

      // Sumar todas las liquidaciones (pagos totales o parciales) de esta semana para este puesto
      const liqsPuesto = liquidaciones.filter(
        (l) => l.puesto_id === p.id && l.semana_inicio === infoSemana.semanaInicio
      );

      let yaPagadoUsd = 0;
      let yaPagadoBs = 0;
      for (const l of liqsPuesto) {
        yaPagadoUsd += Number(l.monto_comision_usd ?? l.monto_usd ?? 0);
        yaPagadoBs += Number((l as any).monto_pagado_bs ?? l.monto_bs ?? 0);
      }
      yaPagadoUsd = Math.round(yaPagadoUsd * 100) / 100;
      yaPagadoBs = Math.round(yaPagadoBs * 100) / 100;

      const pendienteUsd = Math.max(0, Number((comisionUSD - yaPagadoUsd).toFixed(2)));

      return {
        id: p.id,
        nombre: p.nombre,
        porcentaje: pct,
        ventasCount: ventasPuesto.length,
        totalUSD,
        totalBs,
        comisionUSD,
        netoUSD,
        yaPagadoUsd,
        yaPagadoBs,
        pendienteUsd,
      };
    });

    // Detectar si hay ventas registradas sin puesto
    const ventasSinPuesto = movimientosSemana.filter(
      (m) => (m.tipo === 'venta' || m.tipo === 'ingreso') && !m.puesto_id
    );
    if (ventasSinPuesto.length > 0) {
      let totalSinPuestoUSD = 0;
      let totalSinPuestoBs = 0;
      for (const v of ventasSinPuesto) {
        const { monto_usd, monto_bs } = calcularMontos(v);
        totalSinPuestoUSD += monto_usd;
        totalSinPuestoBs += monto_bs;
      }
      items.push({
        id: 'sin-puesto',
        nombre: 'Ventas Generales (Sin puesto)',
        porcentaje: 0,
        ventasCount: ventasSinPuesto.length,
        totalUSD: totalSinPuestoUSD,
        totalBs: totalSinPuestoBs,
        comisionUSD: 0,
        netoUSD: totalSinPuestoUSD,
        yaPagadoUsd: 0,
        yaPagadoBs: 0,
        pendienteUsd: 0,
      });
    }

    const totalVentas = items.reduce((acc, i) => acc + i.totalUSD, 0);
    const totalComision = items.reduce((acc, i) => acc + i.comisionUSD, 0);
    const totalNeto = items.reduce((acc, i) => acc + i.netoUSD, 0);
    const totalYaPagado = items.reduce((acc, i) => acc + i.yaPagadoUsd, 0);
    const totalPendiente = items.reduce((acc, i) => acc + i.pendienteUsd, 0);

    return {
      items,
      totalVentas,
      totalComision,
      totalNeto,
      totalYaPagado,
      totalPendiente,
    };
  }, [puestos, movimientosSemana, liquidaciones, infoSemana.semanaInicio]);

  // 3. Resumen de Ingresos por Método de Pago (reconociendo variantes de nombres)
  const ingresosPorMetodo = useMemo(() => {
    const metodos = {
      pago_movil: { bs: 0, usd: 0 },
      punto_venta: { bs: 0, usd: 0 },
      efectivo_bs: { bs: 0, usd: 0 },
      divisa: { bs: 0, usd: 0 },
    };

    for (const m of movimientosSemanaFiltrados) {
      if (m.tipo === 'venta' || m.tipo === 'ingreso') {
        const { monto_usd, monto_bs } = calcularMontos(m);
        const key = normalizarMetodoPago(m.metodo_pago);
        if (key && metodos[key]) {
          metodos[key].bs += monto_bs;
          metodos[key].usd += monto_usd;
        }
      }
    }

    return metodos;
  }, [movimientosSemanaFiltrados]);

  // 4. Detalle Diario (7 filas Lunes a Domingo)
  const detalleDiario = useMemo(() => {
    return diasSemana.map((d) => {
      const movsDia = movimientosSemanaFiltrados.filter((m) => m.fecha === d.fechaStr);
      let ingBs = 0;
      let ingUSD = 0;
      let gasBs = 0;
      let gasUSD = 0;

      for (const m of movsDia) {
        const { monto_usd, monto_bs } = calcularMontos(m);
        if (m.tipo === 'venta' || m.tipo === 'ingreso') {
          ingBs += monto_bs;
          ingUSD += monto_usd;
        } else {
          gasBs += monto_bs;
          gasUSD += monto_usd;
        }
      }

      return {
        fecha: d.fechaStr,
        dia: d.nombreDia,
        ingresosBs: ingBs,
        ingresosUSD: ingUSD,
        gastosBs: gasBs,
        gastosUSD: gasUSD,
        balanceBs: ingBs - gasBs,
        balanceUSD: ingUSD - gasUSD,
      };
    });
  }, [diasSemana, movimientosSemanaFiltrados]);

  // 5. Resumen de Gastos por Categoría y Naturaleza
  const resumenCategorias = useMemo(() => {
    const mapa: Record<
      string,
      {
        categoria: CategoriaMovimiento;
        naturaleza: NaturalezaMovimiento;
        pagoMovilBs: number;
        efectivoBs: number;
        puntoDivisaBs: number;
        totalBs: number;
        totalUSD: number;
        itemsCount: number;
      }
    > = {};

    for (const cat of CATEGORIAS_GASTO) {
      mapa[cat.nombre] = {
        categoria: cat.nombre,
        naturaleza: cat.naturaleza,
        pagoMovilBs: 0,
        efectivoBs: 0,
        puntoDivisaBs: 0,
        totalBs: 0,
        totalUSD: 0,
        itemsCount: 0,
      };
    }

    for (const m of movimientosSemanaFiltrados) {
      if (m.tipo === 'gasto' || m.tipo === 'egreso') {
        const { monto_usd, monto_bs } = calcularMontos(m);
        if (!mapa[m.categoria]) {
          mapa[m.categoria] = {
            categoria: m.categoria,
            naturaleza: m.naturaleza,
            pagoMovilBs: 0,
            efectivoBs: 0,
            puntoDivisaBs: 0,
            totalBs: 0,
            totalUSD: 0,
            itemsCount: 0,
          };
        }

        const reg = mapa[m.categoria];
        reg.itemsCount += 1;
        reg.totalBs += monto_bs;
        reg.totalUSD += monto_usd;

        const key = normalizarMetodoPago(m.metodo_pago);
        if (key === 'pago_movil') {
          reg.pagoMovilBs += monto_bs;
        } else if (key === 'efectivo_bs') {
          reg.efectivoBs += monto_bs;
        } else {
          reg.puntoDivisaBs += monto_bs;
        }
      }
    }

    return Object.values(mapa).sort((a, b) => b.totalUSD - a.totalUSD);
  }, [movimientosSemanaFiltrados]);

  // Mostrar únicamente categorías con monto mayor a 0
  const categoriasVisibles = useMemo(() => {
    return resumenCategorias.filter((c) => c.totalUSD > 0 || c.totalBs > 0);
  }, [resumenCategorias]);

  const totalGastosItemsCount = useMemo(() => {
    return resumenCategorias.reduce((acc, c) => acc + c.itemsCount, 0);
  }, [resumenCategorias]);

  // 6. Desglose por Naturaleza del Gasto (Gastos vs Personal)
  const desgloseNaturaleza = useMemo(() => {
    const tipos: { key: NaturalezaMovimiento; label: string; matches: (nat: string) => boolean }[] = [
      {
        key: 'Negocio',
        label: 'Gastos',
        matches: (nat) => nat === 'Negocio' || nat === 'Gastos' || nat === 'Créditos / Otros',
      },
      {
        key: 'Personal',
        label: 'Personal',
        matches: (nat) => nat === 'Personal',
      },
    ];

    return tipos.map((t) => {
      let bs = 0;
      let usd = 0;

      for (const m of movimientosSemanaFiltrados) {
        if ((m.tipo === 'gasto' || m.tipo === 'egreso') && t.matches(m.naturaleza || 'Negocio')) {
          const { monto_usd, monto_bs } = calcularMontos(m);
          bs += monto_bs;
          usd += monto_usd;
        }
      }

      const porcGasto = totalGastosUSD > 0 ? (usd / totalGastosUSD) * 100 : 0;
      const impactoIngresos = totalIngresosUSD > 0 ? (usd / totalIngresosUSD) * 100 : 0;

      return {
        naturaleza: t.key,
        label: t.label,
        totalBs: bs,
        totalUSD: usd,
        porcGasto,
        impactoIngresos,
      };
    });
  }, [movimientosSemanaFiltrados, totalGastosUSD, totalIngresosUSD]);

  // 7. Datos Gráficos
  const datosGraficoBarras = useMemo(() => {
    return detalleDiario.map((d) => ({
      dia: d.dia.slice(0, 3),
      Ingresos: parseFloat(d.ingresosUSD.toFixed(2)),
      Gastos: parseFloat(d.gastosUSD.toFixed(2)),
    }));
  }, [detalleDiario]);

  const datosGraficoCircular = useMemo(() => {
    return resumenCategorias
      .filter((c) => c.totalUSD > 0)
      .map((c) => ({
        name: c.categoria,
        value: parseFloat(c.totalUSD.toFixed(2)),
      }));
  }, [resumenCategorias]);

  const COLORES_PIE = [
    '#1E3A3A', // verde oscuro corporativo
    '#10B981', // esmeralda
    '#0D9488', // teal
    '#F59E0B', // ámbar suave
    '#64748B', // gris pizarra
    '#047857', // esmeralda profundo
    '#14B8A6', // teal claro
    '#D97706', // ámbar medio
    '#475569', // gris pizarra oscuro
  ];

  // Navegación Semanas
  const anteriorSemana = () => {
    setFechaSemana((prev) => shiftSemana(prev, -1));
  };

  const siguienteSemana = () => {
    setFechaSemana((prev) => shiftSemana(prev, 1));
  };

  // Exportar Excel (CSV con UTF-8 BOM)
  const exportarCSV = () => {
    const BOM = '\uFEFF';
    let csv = `${BOM}"BALANCE SEMANAL COMPLETO — CHICHA ADICTIVA"\n`;
    csv += `"Período:","${rangoTexto}"\n`;
    csv += `"Filtro Puesto:","${nombreFiltroPuesto}"\n\n`;

    // Resumen KPI
    csv += `"TOTAL INGRESOS ($)","${totalIngresosUSD.toFixed(2)}","Bs","${totalIngresosBs.toFixed(2)}"\n`;
    csv += `"TOTAL GASTOS ($)","${totalGastosUSD.toFixed(2)}","Bs","${totalGastosBs.toFixed(2)}"\n`;
    csv += `"BALANCE NETO ($)","${balanceNetoUSD.toFixed(2)}","Bs","${balanceNetoBs.toFixed(2)}"\n\n`;

    // Resumen por Puesto
    csv += `"RESUMEN POR PUESTO DE VENTA (VENTAS Y COMISIONES)"\n`;
    csv += `"Puesto","Cant. Ventas","Total Ventas ($)","Comisión Vendedores ($)","Neto Negocio ($)"\n`;
    for (const p of resumenPorPuesto.items) {
      csv += `"${p.nombre}","${p.ventasCount}","${p.totalUSD.toFixed(2)}","(${p.comisionUSD.toFixed(2)})","${p.netoUSD.toFixed(2)}"\n`;
    }
    csv += `"TOTAL PUESTOS","${resumenPorPuesto.items.reduce((a, b) => a + b.ventasCount, 0)}","${resumenPorPuesto.totalVentas.toFixed(2)}","(${resumenPorPuesto.totalComision.toFixed(2)})","${resumenPorPuesto.totalNeto.toFixed(2)}"\n\n`;

    // Tabla: Detalle Diario
    csv += `"DETALLE DIARIO (LUNES A DOMINGO)"\n`;
    csv += `"Fecha","Día","Ingresos (Bs)","Ingresos ($)","Gastos (Bs)","Gastos ($)","Balance Día (Bs)","Balance Día ($)"\n`;
    for (const d of detalleDiario) {
      csv += `"${d.fecha}","${d.dia}","${d.ingresosBs.toFixed(2)}","${d.ingresosUSD.toFixed(2)}","${d.gastosBs.toFixed(2)}","${d.gastosUSD.toFixed(2)}","${d.balanceBs.toFixed(2)}","${d.balanceUSD.toFixed(2)}"\n`;
    }
    csv += `"TOTAL SEMANA","7 días","${totalIngresosBs.toFixed(2)}","${totalIngresosUSD.toFixed(2)}","${totalGastosBs.toFixed(2)}","${totalGastosUSD.toFixed(2)}","${balanceNetoBs.toFixed(2)}","${balanceNetoUSD.toFixed(2)}"\n\n`;

    // Tabla: Resumen de Gastos por Categoría
    csv += `"RESUMEN DE GASTOS POR CATEGORÍA Y NATURALEZA"\n`;
    csv += `"Categoría","Naturaleza","Pago Móvil (Bs)","Efectivo (Bs)","Punto / Divisa (Bs)","Total (Bs)","Total ($)","% del Gasto"\n`;
    for (const c of resumenCategorias) {
      const pct = totalGastosUSD > 0 ? (c.totalUSD / totalGastosUSD) * 100 : 0;
      csv += `"${c.categoria}","${c.naturaleza}","${c.pagoMovilBs.toFixed(2)}","${c.efectivoBs.toFixed(2)}","${c.puntoDivisaBs.toFixed(2)}","${c.totalBs.toFixed(2)}","${c.totalUSD.toFixed(2)}","${pct.toFixed(1)}%"\n`;
    }
    csv += `"TOTAL GASTOS","${totalGastosItemsCount} items","","","","${totalGastosBs.toFixed(2)}","${totalGastosUSD.toFixed(2)}","100.0%"\n\n`;

    // Tabla: Desglose por Naturaleza
    csv += `"DESGLOSE POR NATURALEZA DEL GASTO (OPERATIVO VS PERSONAL)"\n`;
    csv += `"Naturaleza","Total (Bs)","Total ($)","% del Gasto","Impacto sobre Ingresos"\n`;
    for (const n of desgloseNaturaleza) {
      csv += `"${n.naturaleza}","${n.totalBs.toFixed(2)}","${n.totalUSD.toFixed(2)}","${n.porcGasto.toFixed(1)}%","${n.impactoIngresos.toFixed(1)}%"\n`;
    }
    csv += `"TOTAL","${totalGastosBs.toFixed(2)}","${totalGastosUSD.toFixed(2)}","100.0%","${totalIngresosUSD > 0 ? ((totalGastosUSD / totalIngresosUSD) * 100).toFixed(1) : '0.0'}%"\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Balance_Chicha_Adictiva_${diasSemana[0].fechaStr}_al_${diasSemana[6].fechaStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compartir Imagen con html-to-image y Capacitor Share
  const compartirImagen = async () => {
    if (!reportRef.current) return;
    try {
      setCompartiendo(true);

      const dataUrl = await toPng(reportRef.current, {
        quality: 0.95,
        backgroundColor: '#F4F4F5',
        pixelRatio: 2,
      });

      const fileName = `Balance_ChichaAdictiva_${diasSemana[0].fechaStr}.png`;

      try {
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: dataUrl,
          directory: Directory.Cache,
        });

        await Share.share({
          title: 'Balance Semanal - Chicha Adictiva',
          text: `Balance semanal del ${rangoTexto} (${nombreFiltroPuesto}) — Chicha Adictiva`,
          url: savedFile.uri,
          dialogTitle: 'Compartir Balance Semanal',
        });
        setCompartiendo(false);
        return;
      } catch {
        // Fallback web
      }

      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Error generando imagen:', err);
      alert('No se pudo generar la imagen del reporte.');
    } finally {
      setCompartiendo(false);
    }
  };

  // Exportar reporte mensual y resumen anual en CSV
  const exportarCSVMensual = () => {
    const MESES = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    const mesIdx = fechaMes.getMonth();
    const anoSel = fechaMes.getFullYear();
    const mesNom = MESES[mesIdx];
    const mesTxt = `${mesNom} ${anoSel}`;

    const prefijo = `${anoSel}-${String(mesIdx + 1).padStart(2, '0')}`;
    const base = movimientosHistoricos.length > 0 ? movimientosHistoricos : movimientos;
    const movsMes = base.filter((m) => m.fecha && m.fecha.startsWith(prefijo));
    const movsFiltrados =
      filtroPuesto === 'todos' ? movsMes : movsMes.filter((m) => m.puesto_id === filtroPuesto);

    let ingUSD = 0,
      ingBs = 0,
      gasUSD = 0,
      gasBs = 0,
      retUSD = 0,
      retBs = 0;
    for (const m of movsFiltrados) {
      const { monto_usd, monto_bs } = calcularMontos(m);
      if (m.tipo === 'venta' || m.tipo === 'ingreso') {
        ingUSD += monto_usd;
        ingBs += monto_bs;
      } else {
        if (m.naturaleza === 'Personal') {
          retUSD += monto_usd;
          retBs += monto_bs;
        } else {
          gasUSD += monto_usd;
          gasBs += monto_bs;
        }
      }
    }

    let csv = `\uFEFF`;
    csv += `"REPORTE MENSUAL Y RESUMEN ANUAL — CHICHA ADICTIVA"\n`;
    csv += `"Mes Seleccionado:","${mesTxt}"\n`;
    csv += `"Puesto de Venta:","${nombreFiltroPuesto}"\n`;
    csv += `"Tasa Oficial BCV:","${tasaActual} Bs/$"\n\n`;

    const gUSD = ingUSD - gasUSD - retUSD;
    const gBs = ingBs - gasBs - retBs;
    const gananciaNetaUSD = Math.abs(gUSD) < 0.005 || Object.is(gUSD, -0) ? 0 : gUSD;
    const gananciaNetaBs = Math.abs(gBs) < 0.005 || Object.is(gBs, -0) ? 0 : gBs;

    csv += `"RESUMEN DEL MES (${mesTxt})"\n`;
    csv += `"Concepto","Monto ($ USD)","Monto (Bs)"\n`;
    csv += `"Total Ingresos","${ingUSD.toFixed(2)}","${ingBs.toFixed(2)}"\n`;
    csv += `"Gastos Operativos (Negocio)","${gasUSD.toFixed(2)}","${gasBs.toFixed(2)}"\n`;
    csv += `"Retiros Personales","${retUSD.toFixed(2)}","${retBs.toFixed(2)}"\n`;
    csv += `"Ganancia Neta","${gananciaNetaUSD.toFixed(2)}","${gananciaNetaBs.toFixed(2)}"\n\n`;

    csv += `"RESUMEN ANUAL (${anoSel}) — ENERO A DICIEMBRE"\n`;
    csv += `"Mes","Ingresos ($)","Gastos Operativos ($)","Retiros Personales ($)","Balance Neto ($)"\n`;

    let totIng = 0,
      totGas = 0,
      totRet = 0;
    const filteredBase =
      filtroPuesto === 'todos' ? base : base.filter((m) => m.puesto_id === filtroPuesto);

    for (let i = 0; i < 12; i++) {
      const pref = `${anoSel}-${String(i + 1).padStart(2, '0')}`;
      const mMes = filteredBase.filter((m) => m.fecha && m.fecha.startsWith(pref));
      let mIng = 0,
        mGas = 0,
        mRet = 0;
      for (const m of mMes) {
        const { monto_usd } = calcularMontos(m);
        if (m.tipo === 'venta' || m.tipo === 'ingreso') mIng += monto_usd;
        else if (m.naturaleza === 'Personal') mRet += monto_usd;
        else mGas += monto_usd;
      }
      totIng += mIng;
      totGas += mGas;
      totRet += mRet;
      csv += `"${MESES[i]}","${mIng.toFixed(2)}","${mGas.toFixed(2)}","${mRet.toFixed(2)}","${(mIng - mGas - mRet).toFixed(2)}"\n`;
    }
    csv += `"TOTAL ANUAL ${anoSel}","${totIng.toFixed(2)}","${totGas.toFixed(2)}","${totRet.toFixed(2)}","${(totIng - totGas - totRet).toFixed(2)}"\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Balance_Mensual_${mesNom}_${anoSel}.csv`;
    link.click();
  };

  return (
    <div className="space-y-4 pb-24 pt-2 px-3 sm:px-4 max-w-4xl mx-auto">
      {/* 1. BLOQUE SUPERIOR FIJO: DINERO DISPONIBLE DE LA EMPRESA */}
      <CajaDisponibleCard
        digitalBs={cajaDisponible.digitalBs}
        efectivoBs={cajaDisponible.efectivoBs}
        divisasUsd={cajaDisponible.divisasUsd}
        totalConsolidadoUsd={cajaDisponible.totalConsolidadoUsd}
        totalConsolidadoBs={cajaDisponible.totalConsolidadoBs}
        tasaBcv={tasaActual}
        cargando={cargandoCaja}
        onAbrirSaldoInicial={() => setModalSaldoInicialAbierto(true)}
        onAbrirTransferencia={() => setModalTransferenciaAbierto(true)}
      />

      {/* 2. SELECTOR SEGMENTADO: VISTA SEMANAL | VISTA MENSUAL */}
      <div className="flex items-center justify-center p-1 bg-zinc-200/70 rounded-xl border border-zinc-200 shadow-2xs">
        <button
          type="button"
          onClick={() => setPeriodo('semanal')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            periodo === 'semanal'
              ? 'bg-white text-[#2C474E] shadow-xs'
              : 'text-zinc-600 hover:text-zinc-900'
          }`}
        >
          <Calendar size={15} />
          <span>Vista Semanal</span>
        </button>
        <button
          type="button"
          onClick={() => setPeriodo('mensual')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            periodo === 'mensual'
              ? 'bg-white text-[#2C474E] shadow-xs'
              : 'text-zinc-600 hover:text-zinc-900'
          }`}
        >
          <BarChart2 size={15} />
          <span>Vista Mensual / Anual</span>
        </button>
      </div>

      {periodo === 'semanal' ? (
        <>
          {/* 1. SELECTOR DE FILTRO POR PUESTO */}
      {puestos.length > 0 && (
        <div className="flex items-center justify-start gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
          <button
            type="button"
            onClick={() => setFiltroPuesto('todos')}
            className={`px-3 py-1 text-xs rounded-full font-bold transition-colors shrink-0 ${
              filtroPuesto === 'todos'
                ? 'bg-[#2C474E] text-white shadow-xs'
                : 'bg-white border border-[#E4E4E7] text-[#52525B] hover:bg-zinc-100'
            }`}
          >
            Todos los puestos (Consolidado)
          </button>
          {puestos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setFiltroPuesto(p.id)}
              className={`px-3 py-1 text-xs rounded-full font-bold transition-colors shrink-0 ${
                filtroPuesto === p.id
                  ? 'bg-[#2C474E] text-white shadow-xs'
                  : 'bg-white border border-[#E4E4E7] text-[#52525B] hover:bg-zinc-100'
              }`}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      )}

      {/* 2. Barra de Período Semanal */}
      <div className="bg-white border border-[#E4E4E7] rounded-lg p-2.5 flex items-center justify-between shadow-xs">
        <button
          type="button"
          onClick={anteriorSemana}
          className="min-h-[40px] px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold text-[#2C474E] hover:bg-zinc-100 rounded active:bg-zinc-200"
        >
          <ChevronLeft size={16} />
          <span className="hidden sm:inline">Semana ant.</span>
        </button>

        <div className="flex items-center gap-2 text-center">
          <Calendar size={16} className="text-[#2C474E] shrink-0" />
          <span className="text-xs sm:text-sm font-bold tracking-wider text-[#18181B] uppercase tabular-nums">
            {rangoTexto}
          </span>
        </div>

        <button
          type="button"
          onClick={siguienteSemana}
          className="min-h-[40px] px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold text-[#2C474E] hover:bg-zinc-100 rounded active:bg-zinc-200"
        >
          <span className="hidden sm:inline">Semana sig.</span>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 3. Botones de Acción: Exportar Excel y Compartir Imagen */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={exportarCSV}
          className="flex-1 min-h-[44px] px-3 py-2 text-xs font-bold border border-[#E4E4E7] bg-white text-[#18181B] rounded hover:bg-zinc-50 active:bg-zinc-100 flex items-center justify-center gap-1.5 shadow-xs"
        >
          <Download size={15} className="text-[#52525B]" />
          <span>Exportar Excel (CSV)</span>
        </button>

        <button
          type="button"
          onClick={compartirImagen}
          disabled={compartiendo}
          className="flex-1 min-h-[44px] px-3 py-2 text-xs font-bold bg-[#2C474E] text-white rounded hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-70"
        >
          <Share2 size={15} className="text-[#86EFAC]" />
          <span>{compartiendo ? 'Generando...' : 'Compartir Imagen'}</span>
        </button>
      </div>

      {/* CONTENEDOR REPORTE PARA CAPTURA Y VISUALIZACIÓN */}
      <div ref={reportRef} className="space-y-4 bg-[#F4F4F5] p-0.5 rounded-xl">
        {/* 1. LAS 3 TARJETAS RESUMEN SIEMPRE VISIBLES */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {/* TOTAL INGRESOS */}
          <div className="bg-white border border-emerald-200/80 rounded-2xl p-2.5 sm:p-3.5 text-center shadow-xs flex flex-col justify-between">
            <div>
              <span className="block text-[10px] sm:text-xs font-bold text-[#1E3A3A] uppercase tracking-wider mb-1">
                Ingresos
              </span>
              <span className="block text-sm sm:text-xl font-black text-[#166534] tabular-nums">
                {formatUSD(totalIngresosUSD)}
              </span>
            </div>
            <span className="block text-[10px] sm:text-[11px] text-zinc-400 tabular-nums font-medium mt-1">
              {formatVES(totalIngresosBs)}
            </span>
          </div>

          {/* TOTAL GASTOS (separando Operativos vs Personales) */}
          <div className="bg-white border border-rose-200/80 rounded-2xl p-2.5 sm:p-3.5 text-center shadow-xs flex flex-col justify-between">
            <div>
              <span className="block text-[10px] sm:text-xs font-bold text-[#991B1B] uppercase tracking-wider mb-1">
                Gastos
              </span>
              <span className="block text-sm sm:text-xl font-black text-[#991B1B] tabular-nums">
                {formatUSD(totalGastosUSD)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums font-medium mt-0.5">
                {formatVES(totalGastosBs)}
              </span>
            </div>
            {/* Separación visual Operativos vs Retiros Personales */}
            <div className="mt-2 pt-1.5 border-t border-zinc-100 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 text-[9px] sm:text-[10px] tabular-nums">
              <span className="text-rose-700 font-semibold">
                Op: {formatUSD(gastosOperativosUSD)}
              </span>
              <span className="hidden sm:inline text-zinc-300">·</span>
              <span className="text-amber-700 font-semibold">
                Pers: {formatUSD(retirosPersonalesUSD)}
              </span>
            </div>
          </div>

          {/* BALANCE NETO */}
          <div
            className={`rounded-2xl p-2.5 sm:p-3.5 text-center shadow-xs border flex flex-col justify-between ${
              balanceNetoUSD >= 0
                ? 'bg-[#ECFDF5]/60 border-emerald-200/80'
                : 'bg-rose-50/70 border-rose-200/80'
            }`}
          >
            <div>
              <span className="block text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1 text-[#18181B]">
                Balance Neto
              </span>
              <span
                className={`block text-sm sm:text-xl font-black tabular-nums ${
                  balanceNetoUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                }`}
              >
                {balanceNetoUSD >= 0 ? '+' : ''}
                {formatUSD(balanceNetoUSD)}
              </span>
            </div>
            <span className="block text-[10px] sm:text-[11px] text-zinc-500 tabular-nums font-medium mt-1">
              {balanceNetoBs >= 0 ? '+' : ''}
              {formatVES(balanceNetoBs)}
            </span>
          </div>
        </div>

        {/* 2. TABLA PROTAGONISTA: COMISIÓN VENDEDORES POR PUESTO (bordes suaves y aire) */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="bg-[#1E3A3A] text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store size={15} className="text-[#86EFAC]" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Comisión Vendedores por Puesto
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-100 text-zinc-500 font-semibold">
                  <th className="py-3 px-3.5">Puesto</th>
                  <th className="py-3 px-2.5 text-center">Cant.</th>
                  <th className="py-3 px-3.5 text-right">Ventas</th>
                  <th className="py-3 px-3.5 text-right text-[#047857]">Comisión</th>
                  <th className="py-3 px-3.5 text-right text-[#1E3A3A]">Neto</th>
                  <th className="py-3 px-3.5 text-right">Liquidación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {resumenPorPuesto.items.map((p) => {
                  return (
                    <tr key={p.id} className="hover:bg-zinc-50/70 transition-colors">
                      <td className="py-3 px-3.5 font-bold text-[#18181B]">
                        {p.nombre}
                        {p.porcentaje > 0 && (
                          <span className="ml-1.5 text-[10px] text-zinc-400 font-normal">
                            ({p.porcentaje}%)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2.5 text-center tabular-nums text-zinc-500">
                        {p.ventasCount}
                      </td>
                      <td className="py-3 px-3.5 text-right tabular-nums font-bold text-[#18181B]">
                        {formatUSD(p.totalUSD)}
                      </td>
                      <td className="py-3 px-3.5 text-right tabular-nums font-bold text-[#047857]">
                        <div>({formatUSD(p.comisionUSD)})</div>
                        {p.yaPagadoUsd > 0 && (
                          <div className="text-[10px] text-[#166534] font-normal">
                            Pagado: {formatUSD(p.yaPagadoUsd)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right tabular-nums font-black text-[#1E3A3A]">
                        {formatUSD(p.netoUSD)}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        {p.pendienteUsd === 0 && p.comisionUSD > 0 ? (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#ECFDF5] text-[#166534] border border-emerald-200/70">
                              <CheckCircle2 size={12} />
                              <span>Pagado</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAbrirModalPago(p, true)}
                              disabled={liquidandoPuestoId === p.id}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#1E3A3A] bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer"
                              title="Registrar pago anticipado / adelanto"
                            >
                              + Adelanto
                            </button>
                          </div>
                        ) : p.pendienteUsd > 0 && p.id !== 'sin-puesto' ? (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => handleAbrirModalPago(p, false)}
                              disabled={liquidandoPuestoId === p.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#166534] hover:bg-[#14532d] text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {liquidandoPuestoId === p.id ? (
                                <>
                                  <Loader2 size={12} className="animate-spin text-white" />
                                  <span>Pagando...</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 size={12} className="text-[#86EFAC]" />
                                  <span>
                                    {p.yaPagadoUsd > 0
                                      ? `Saldo (${formatUSD(p.pendienteUsd)})`
                                      : `Pagar (${formatUSD(p.pendienteUsd)})`}
                                  </span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAbrirModalPago(p, true)}
                              disabled={liquidandoPuestoId === p.id}
                              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-[#1E3A3A] bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer"
                              title="Registrar monto diferente o adelanto"
                            >
                              + Adelanto
                            </button>
                          </div>
                        ) : p.id !== 'sin-puesto' ? (
                          <button
                            type="button"
                            onClick={() => handleAbrirModalPago(p, true)}
                            disabled={liquidandoPuestoId === p.id}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#1E3A3A] bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer"
                            title="Registrar adelanto de comisión"
                          >
                            + Adelanto
                          </button>
                        ) : (
                          <span className="text-zinc-300 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 font-bold border-t border-zinc-200 text-[#18181B]">
                  <td className="py-3 px-3.5">TOTAL PUESTOS</td>
                  <td className="py-3 px-2.5 text-center tabular-nums text-zinc-500">
                    {resumenPorPuesto.items.reduce((acc, i) => acc + i.ventasCount, 0)}
                  </td>
                  <td className="py-3 px-3.5 text-right tabular-nums text-[#18181B]">
                    {formatUSD(resumenPorPuesto.totalVentas)}
                  </td>
                  <td className="py-3 px-3.5 text-right tabular-nums text-[#047857]">
                    <div>({formatUSD(resumenPorPuesto.totalComision)})</div>
                    {resumenPorPuesto.totalYaPagado > 0 && (
                      <div className="text-[10px] text-[#166534] font-normal">
                        Pagado: {formatUSD(resumenPorPuesto.totalYaPagado)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3.5 text-right tabular-nums text-[#1E3A3A]">
                    {formatUSD(resumenPorPuesto.totalNeto)}
                  </td>
                  <td className="py-3 px-3.5"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 3. VENTAS POR MÉTODO DE PAGO (2 columnas compactas) */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl p-4 shadow-xs">
          <span className="block text-xs font-bold text-[#18181B] uppercase tracking-wider mb-3">
            Ventas por Método de Pago
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 border border-zinc-100 rounded-xl bg-zinc-50/70">
              <span className="block text-[11px] font-semibold text-zinc-500">Pago Móvil</span>
              <span className="block text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.pago_movil.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums mt-0.5">
                {formatVES(ingresosPorMetodo.pago_movil.bs)}
              </span>
            </div>

            <div className="p-3 border border-zinc-100 rounded-xl bg-zinc-50/70">
              <span className="block text-[11px] font-semibold text-zinc-500">Punto de Venta</span>
              <span className="block text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.punto_venta.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums mt-0.5">
                {formatVES(ingresosPorMetodo.punto_venta.bs)}
              </span>
            </div>

            <div className="p-3 border border-zinc-100 rounded-xl bg-zinc-50/70">
              <span className="block text-[11px] font-semibold text-zinc-500">Efectivo Bs</span>
              <span className="block text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.efectivo_bs.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums mt-0.5">
                {formatVES(ingresosPorMetodo.efectivo_bs.bs)}
              </span>
            </div>

            <div className="p-3 border border-zinc-100 rounded-xl bg-zinc-50/70">
              <span className="block text-[11px] font-semibold text-zinc-500">Divisas ($)</span>
              <span className="block text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.divisa.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums mt-0.5">
                {formatVES(ingresosPorMetodo.divisa.bs)}
              </span>
            </div>
          </div>
        </div>

        {/* 4. ACORDEÓN 1: DETALLE DIARIO (Lunes a Domingo) */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden shadow-xs">
          <button
            type="button"
            onClick={() => setDetalleDiarioAbierto((prev) => !prev)}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-zinc-50/80 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-[#1E3A3A]" />
              <span className="text-xs sm:text-sm font-bold text-[#18181B]">
                Detalle Diario
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={`text-xs font-bold tabular-nums ${
                  balanceNetoUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                }`}
              >
                {balanceNetoUSD >= 0 ? '+' : ''}
                {formatUSD(balanceNetoUSD)}
              </span>
              {detalleDiarioAbierto ? (
                <ChevronUp size={16} className="text-zinc-400" />
              ) : (
                <ChevronDown size={16} className="text-zinc-400" />
              )}
            </div>
          </button>

          {detalleDiarioAbierto && (
            <div className="overflow-x-auto border-t border-zinc-100">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-100 text-zinc-500 font-semibold">
                    <th className="py-2.5 px-3 sticky left-0 bg-zinc-50/80 z-10 border-r border-zinc-100">
                      Día
                    </th>
                    <th className="py-2.5 px-2.5 text-right">Ingresos (Bs)</th>
                    <th className="py-2.5 px-2.5 text-right text-[#166534]">Ingresos ($)</th>
                    <th className="py-2.5 px-2.5 text-right">Gastos (Bs)</th>
                    <th className="py-2.5 px-2.5 text-right text-[#991B1B]">Gastos ($)</th>
                    <th className="py-2.5 px-3 text-right font-bold">Balance ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {detalleDiario.map((d) => (
                    <tr key={d.fecha} className="hover:bg-zinc-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-semibold sticky left-0 bg-white z-10 border-r border-zinc-100 whitespace-nowrap">
                        {d.dia}{' '}
                        <span className="text-[10px] font-normal text-zinc-400">
                          ({d.fecha.slice(5)})
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums text-zinc-500">
                        {formatNumber(d.ingresosBs)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums font-bold text-[#166534]">
                        {formatUSD(d.ingresosUSD)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums text-zinc-500">
                        {formatNumber(d.gastosBs)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right tabular-nums font-bold text-[#991B1B]">
                        {formatUSD(d.gastosUSD)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right tabular-nums font-bold ${
                          d.balanceUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                        }`}
                      >
                        {d.balanceUSD >= 0 ? '+' : ''}
                        {formatUSD(d.balanceUSD)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 font-bold border-t border-zinc-200 text-[#18181B]">
                    <td className="py-2.5 px-3 sticky left-0 bg-zinc-50 z-10 border-r border-zinc-100">
                      TOTAL
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">
                      {formatNumber(totalIngresosBs)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#166534]">
                      {formatUSD(totalIngresosUSD)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">
                      {formatNumber(totalGastosBs)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                      {formatUSD(totalGastosUSD)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right tabular-nums font-black ${
                        balanceNetoUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                      }`}
                    >
                      {balanceNetoUSD >= 0 ? '+' : ''}
                      {formatUSD(balanceNetoUSD)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* 5. ACORDEÓN 2: GASTOS POR CATEGORÍA (solo categorías con monto > 0) */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden shadow-xs">
          <button
            type="button"
            onClick={() => setCategoriasAbierto((prev) => !prev)}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-zinc-50/80 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <TrendingDown size={15} className="text-[#991B1B]" />
              <span className="text-xs sm:text-sm font-bold text-[#18181B]">
                Gastos por Categoría
              </span>
              <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">
                {categoriasVisibles.length}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold tabular-nums text-[#991B1B]">
                {formatUSD(totalGastosUSD)}
              </span>
              {categoriasAbierto ? (
                <ChevronUp size={16} className="text-zinc-400" />
              ) : (
                <ChevronDown size={16} className="text-zinc-400" />
              )}
            </div>
          </button>

          {categoriasAbierto && (
            <div className="border-t border-zinc-100">
              {categoriasVisibles.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400">
                  No hay gastos registrados en esta semana.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-zinc-50/80 border-b border-zinc-100 text-zinc-500 font-semibold">
                        <th className="py-2.5 px-3 sticky left-0 bg-zinc-50/80 z-10 border-r border-zinc-100">
                          Categoría
                        </th>
                        <th className="py-2.5 px-2.5 text-center">Naturaleza</th>
                        <th className="py-2.5 px-2.5 text-right">Total Bs</th>
                        <th className="py-2.5 px-3 text-right text-[#991B1B]">Total ($)</th>
                        <th className="py-2.5 px-2.5 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {categoriasVisibles.map((c) => {
                        const pct = totalGastosUSD > 0 ? (c.totalUSD / totalGastosUSD) * 100 : 0;
                        return (
                          <tr key={c.categoria} className="hover:bg-zinc-50/60 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-[#18181B] sticky left-0 bg-white z-10 border-r border-zinc-100 whitespace-nowrap">
                              {c.categoria}
                            </td>
                            <td className="py-2.5 px-2.5 text-center">
                              <BadgeNaturaleza naturaleza={c.naturaleza} tipo="gasto" />
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums text-zinc-600">
                              {formatNumber(c.totalBs)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums font-bold text-[#991B1B]">
                              {formatUSD(c.totalUSD)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums text-zinc-500">
                              {formatPorcentaje(pct)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-zinc-50 font-bold border-t border-zinc-200 text-[#18181B]">
                        <td className="py-2.5 px-3 sticky left-0 bg-zinc-50 z-10 border-r border-zinc-100">
                          TOTAL
                        </td>
                        <td className="py-2.5 px-2.5 text-center text-[10px] text-zinc-400">
                          {totalGastosItemsCount} movs
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums">
                          {formatNumber(totalGastosBs)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#991B1B]">
                          {formatUSD(totalGastosUSD)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums">100.0%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 6. ACORDEÓN 3: GRÁFICOS */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden shadow-xs">
          <button
            type="button"
            onClick={() => setGraficosAbierto((prev) => !prev)}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-zinc-50/80 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <PieIcon size={15} className="text-[#1E3A3A]" />
              <span className="text-xs sm:text-sm font-bold text-[#18181B]">
                Gráficos y Distribución
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-medium text-zinc-400">
                Barras y Dona
              </span>
              {graficosAbierto ? (
                <ChevronUp size={16} className="text-zinc-400" />
              ) : (
                <ChevronDown size={16} className="text-zinc-400" />
              )}
            </div>
          </button>

          {graficosAbierto && (
            <div className="p-3.5 border-t border-zinc-100 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Gráfico 1: Barras agrupadas Ingresos vs Gastos Diarios ($ USD) */}
              <div className="border border-zinc-100 rounded-xl p-3 bg-zinc-50/40">
                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-zinc-100">
                  <BarChart2 size={14} className="text-[#1E3A3A]" />
                  <span className="text-xs font-bold text-[#18181B]">
                    Ingresos vs Gastos Diarios ($ USD)
                  </span>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={datosGraficoBarras} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
                      <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#52525B' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#52525B' }} />
                      <Tooltip
                        formatter={(val: any) => [`$${formatNumber(Number(val))}`, '']}
                        contentStyle={{
                          backgroundColor: '#FFFFFF',
                          borderColor: '#E4E4E7',
                          fontSize: '11px',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
                        iconType="rect"
                      />
                      <Bar dataKey="Ingresos" fill="#1E3A3A" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Gastos" fill="#B91C1C" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráfico 2: Circular Dona Distribución de Gastos por Categoría */}
              <div className="border border-zinc-100 rounded-xl p-3 bg-zinc-50/40">
                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-zinc-100">
                  <PieIcon size={14} className="text-[#1E3A3A]" />
                  <span className="text-xs font-bold text-[#18181B]">
                    Distribución de Gastos por Categoría
                  </span>
                </div>
                {datosGraficoCircular.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-xs text-zinc-400">
                    No hay gastos registrados en esta semana.
                  </div>
                ) : (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <Pie
                          data={datosGraficoCircular}
                          cx="50%"
                          cy="45%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {datosGraficoCircular.map((_, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={COLORES_PIE[index % COLORES_PIE.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any) => [`$${formatNumber(Number(val))}`, '']}
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#E4E4E7',
                            fontSize: '11px',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend
                          wrapperStyle={{
                            fontSize: '10px',
                            lineHeight: '14px',
                            maxHeight: '48px',
                            overflowY: 'auto',
                          }}
                          iconType="circle"
                          iconSize={8}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
        </>
      ) : (
        <>
          {/* BOTONES DE ACCIÓN: EXPORTAR EXCEL Y COMPARTIR IMAGEN */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportarCSVMensual}
              className="flex-1 min-h-[44px] px-3 py-2 text-xs font-bold border border-[#E4E4E7] bg-white text-[#18181B] rounded-lg hover:bg-zinc-50 active:bg-zinc-100 flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download size={15} className="text-[#52525B]" />
              <span>Exportar Excel (CSV)</span>
            </button>

            <button
              type="button"
              onClick={compartirImagen}
              disabled={compartiendo}
              className="flex-1 min-h-[44px] px-3 py-2 text-xs font-bold bg-[#2C474E] text-white rounded-lg hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-70 cursor-pointer"
            >
              <Share2 size={15} className="text-[#86EFAC]" />
              <span>{compartiendo ? 'Generando...' : 'Compartir Imagen'}</span>
            </button>
          </div>

          {/* CONTENEDOR REPORTE MENSUAL ref={reportRef} */}
          <div ref={reportRef} className="space-y-4 bg-[#F4F4F5] p-1 rounded-md">
            <ResumenMensualView
              fechaMes={fechaMes}
              onMesChange={setFechaMes}
              movimientos={movimientosHistoricos.length > 0 ? movimientosHistoricos : movimientos}
              filtroPuesto={filtroPuesto}
              onFiltroPuestoChange={setFiltroPuesto}
              puestos={puestos}
              tasaActual={tasaActual}
            />
          </div>
        </>
      )}

      {/* MODALES DE CAJA */}
      <ModalSaldoInicial
        isOpen={modalSaldoInicialAbierto}
        onClose={() => setModalSaldoInicialAbierto(false)}
        saldosActuales={saldosIniciales}
        onGuardadoExitoso={cargarDatosCajaYMovimientos}
      />

      <ModalTransferenciaCaja
        isOpen={modalTransferenciaAbierto}
        onClose={() => setModalTransferenciaAbierto(false)}
        tasaBcv={tasaActual}
        transferencias={transferencias}
        onActualizarDatos={cargarDatosCajaYMovimientos}
      />

      {/* MODAL DE CONFIRMACIÓN: PAGO DE COMISIONES EN BOLÍVARES AL CAMBIO DEL DÍA */}
      {pagoModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-zinc-200 w-full max-w-md overflow-hidden">
            {/* Encabezado */}
            <div className="bg-[#2C474E] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-[#86EFAC]/20 rounded-lg text-[#86EFAC]">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold leading-tight">
                    {pagoModalData.yaPagadoUSD > 0 ? 'Pagar Saldo / Adelanto de Comisión' : 'Pagar Comisión Semanal'}
                  </h3>
                  <p className="text-[11px] text-zinc-300">
                    {pagoModalData.puestoNombre} • {rangoTexto} (Lun - Sáb)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPagoModalData(null)}
                className="p-1 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Contenido */}
            <div className="p-4 sm:p-5 space-y-4">
              {/* Cifra acumulada o saldo de referencia en USD */}
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-zinc-500 block">
                    Comisión Generada ({pagoModalData.comisionPorcentaje}%):
                  </span>
                  <span className="text-[10px] text-zinc-500 block">
                    Total: {formatUSD(pagoModalData.comisionTotalUSD)} • Ya pagado: {formatUSD(pagoModalData.yaPagadoUSD)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Saldo Pendiente</span>
                  <div className="text-lg sm:text-xl font-black font-mono text-[#047857] tabular-nums">
                    {formatUSD(pagoModalData.comisionUSD)}
                  </div>
                </div>
              </div>

              {/* Monto editable a liquidar en USD */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-[#18181B]">
                    Monto a transferir en Dólares ($ USD):
                  </label>
                  {pagoModalData.comisionUSD > 0 && (
                    <button
                      type="button"
                      onClick={() => setMontoUSDInput(String(pagoModalData.comisionUSD))}
                      className="text-[11px] text-[#047857] hover:underline font-semibold cursor-pointer"
                    >
                      Sugerido: {formatUSD(pagoModalData.comisionUSD)}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={montoUSDInput}
                    onChange={(e) => setMontoUSDInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-zinc-300 rounded-lg bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none"
                    autoFocus
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    USD
                  </span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5 block">
                  Podés liquidar el saldo exacto, un pago parcial o un monto anticipado/adelanto.
                </span>
              </div>

              {/* Tasa BCV del día de pago */}
              <div>
                <label className="block text-xs font-bold text-[#18181B] mb-1.5">
                  Tasa BCV del día de pago (Bs/$):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={tasaPagoComision}
                    onChange={(e) => setTasaPagoComision(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-zinc-300 rounded-lg bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    Bs/$
                  </span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5 block">
                  Tasa oficial hoy: {formatNumber(tasaActual)} Bs/$. Editable si aplica otra tasa para el pago.
                </span>
              </div>

              {/* Selector de Método de Pago en Bolívares */}
              <div>
                <label className="block text-xs font-bold text-[#18181B] mb-1.5">
                  Método de pago en Bolívares:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMetodoPagoComision('pago_movil')}
                    className={`p-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      metodoPagoComision === 'pago_movil'
                        ? 'bg-[#2C474E] text-white border-[#2C474E] shadow-xs'
                        : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                    }`}
                  >
                    <Smartphone size={15} />
                    <span>Pago Móvil</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodoPagoComision('efectivo_bs')}
                    className={`p-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      metodoPagoComision === 'efectivo_bs'
                        ? 'bg-[#2C474E] text-white border-[#2C474E] shadow-xs'
                        : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                    }`}
                  >
                    <Banknote size={15} />
                    <span>Efectivo</span>
                  </button>
                </div>
              </div>

              {/* Monto exacto a transferir en Bolívares */}
              <div className="p-3.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-center">
                <span className="text-xs font-bold text-[#065F46] block uppercase tracking-wider mb-0.5">
                  Monto exacto a transferir en Bolívares:
                </span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-[#166534] tabular-nums">
                  {formatVES(
                    Math.round(
                      ((parseFloat(montoUSDInput) || 0) * (parseFloat(tasaPagoComision) || tasaActual || 100)) * 100
                    ) / 100
                  )}
                </div>
                <span className="text-[10px] text-[#059669] font-medium block mt-0.5">
                  ({formatUSD(parseFloat(montoUSDInput) || 0)} × {formatNumber(parseFloat(tasaPagoComision) || tasaActual || 100)} Bs/$)
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-zinc-50 border-t border-zinc-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPagoModalData(null)}
                disabled={liquidandoPuestoId !== null}
                className="px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarPago}
                disabled={liquidandoPuestoId !== null}
                className="px-4 py-2 text-xs font-bold bg-[#166534] hover:bg-[#14532d] active:bg-[#0f3d21] text-white rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
              >
                {liquidandoPuestoId ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-white" />
                    <span>Procesando pago...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} className="text-[#86EFAC]" />
                    <span>Confirmar y Guardar Pago</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
