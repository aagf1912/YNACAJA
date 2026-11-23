import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Calendar,
  DollarSign,
  TrendingUp,
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
import { Movimiento, Puesto, CATEGORIAS_GASTO, NaturalezaMovimiento, CategoriaMovimiento, LiquidacionSemanal } from '../types';
import { calcularMontos, formatNumber, formatPorcentaje, formatUSD, formatVES } from '../utils/format';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { getSemanaLunesSabado, shiftSemana } from '../utils/dateUtils';
import { getVenezuelaDate } from '../utils/parserLocal';
import { getLiquidacionesSemanales, registrarLiquidacionSemanal, insertMovimientos } from '../services/supabase';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

interface Props {
  movimientos: Movimiento[];
  puestos?: Puesto[];
  tasaActual?: number;
  onGuardarMovimientos?: (movs: Omit<Movimiento, 'id' | 'created_at'>[]) => Promise<Movimiento[]>;
  onRecargarDatos?: () => Promise<void>;
}

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
    return movimientos.filter(
      (m) => m.fecha >= infoSemana.semanaInicio && m.fecha <= infoSemana.semanaFin
    );
  }, [movimientos, infoSemana.semanaInicio, infoSemana.semanaFin]);

  // Comprobar si un puesto ya fue liquidado en esta semana (anti-doble pago)
  const isPuestoLiquidado = useCallback(
    (puestoId: string) => {
      return liquidaciones.some(
        (l) =>
          l.puesto_id === puestoId &&
          l.semana_inicio === infoSemana.semanaInicio &&
          (l.pagado !== false || (l as any).monto_pagado_bs > 0)
      );
    },
    [liquidaciones, infoSemana.semanaInicio]
  );

  // Estado para el modal de pago de comisiones
  interface ModalPagarComisionData {
    puestoId: string;
    puestoNombre: string;
    totalVentasUSD: number;
    comisionPorcentaje: number;
    comisionUSD: number;
  }
  const [pagoModalData, setPagoModalData] = useState<ModalPagarComisionData | null>(null);
  const [tasaPagoComision, setTasaPagoComision] = useState<string>('');
  const [metodoPagoComision, setMetodoPagoComision] = useState<'pago_movil' | 'efectivo_bs'>('pago_movil');

  // Abrir modal de pago de comisión con datos precargados
  const handleAbrirModalPago = (p: {
    id: string;
    nombre: string;
    totalUSD: number;
    porcentaje: number;
    comisionUSD: number;
  }) => {
    if (isPuestoLiquidado(p.id) || p.comisionUSD <= 0) return;
    setTasaPagoComision(tasaActual > 0 ? String(tasaActual) : '100');
    setMetodoPagoComision('pago_movil');
    setPagoModalData({
      puestoId: p.id,
      puestoNombre: p.nombre,
      totalVentasUSD: p.totalUSD,
      comisionPorcentaje: p.porcentaje,
      comisionUSD: p.comisionUSD,
    });
  };

  // Confirmar y registrar pago de comisión llamando via fetch POST a rpc/liquidar_comision_semanal
  const handleConfirmarPago = async () => {
    if (!pagoModalData || liquidandoPuestoId) return;

    const tasaNum = parseFloat(tasaPagoComision);
    if (isNaN(tasaNum) || tasaNum <= 0) {
      alert('Ingresa una tasa BCV válida mayor a 0.');
      return;
    }

    const { puestoId, totalVentasUSD, comisionPorcentaje, comisionUSD } = pagoModalData;
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
          p_monto_comision_usd: comisionUSD,
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

  // 1. KPI Totales
  const { totalIngresosUSD, totalGastosUSD, balanceNetoUSD, totalIngresosBs, totalGastosBs, balanceNetoBs } =
    useMemo(() => {
      let ingUSD = 0;
      let gasUSD = 0;
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
        }
      }

      return {
        totalIngresosUSD: ingUSD,
        totalGastosUSD: gasUSD,
        balanceNetoUSD: ingUSD - gasUSD,
        totalIngresosBs: ingBs,
        totalGastosBs: gasBs,
        balanceNetoBs: ingBs - gasBs,
      };
    }, [movimientosSemanaFiltrados]);

  // 2. Resumen por Puesto de Venta (Ventas, Comisión 22% y Neto)
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
      const comisionUSD = (totalUSD * pct) / 100;
      const netoUSD = totalUSD - comisionUSD;

      return {
        id: p.id,
        nombre: p.nombre,
        porcentaje: pct,
        ventasCount: ventasPuesto.length,
        totalUSD,
        totalBs,
        comisionUSD,
        netoUSD,
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
      });
    }

    const totalVentas = items.reduce((acc, i) => acc + i.totalUSD, 0);
    const totalComision = items.reduce((acc, i) => acc + i.comisionUSD, 0);
    const totalNeto = items.reduce((acc, i) => acc + i.netoUSD, 0);

    return {
      items,
      totalVentas,
      totalComision,
      totalNeto,
    };
  }, [puestos, movimientosSemana]);

  // 3. Resumen de Ingresos por Método de Pago
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
        if (metodos[m.metodo_pago]) {
          metodos[m.metodo_pago].bs += monto_bs;
          metodos[m.metodo_pago].usd += monto_usd;
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

        if (m.metodo_pago === 'pago_movil') {
          reg.pagoMovilBs += monto_bs;
        } else if (m.metodo_pago === 'efectivo_bs') {
          reg.efectivoBs += monto_bs;
        } else {
          reg.puntoDivisaBs += monto_bs;
        }
      }
    }

    return Object.values(mapa).sort((a, b) => b.totalUSD - a.totalUSD);
  }, [movimientosSemanaFiltrados]);

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
    '#2C474E',
    '#3B5B64',
    '#4E7985',
    '#991B1B',
    '#B91C1C',
    '#D97706',
    '#92400E',
    '#1E40AF',
    '#15803D',
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

  return (
    <div className="space-y-4 pb-24 pt-2 px-3 sm:px-4 max-w-4xl mx-auto">
      {/* 1. SELECTOR DE FILTRO POR PUESTO */}
      {puestos.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-[11px] font-bold text-[#52525B] flex items-center gap-1 shrink-0">
            <Store size={13} className="text-[#2C474E]" />
            Ver puesto:
          </span>
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
      <div ref={reportRef} className="space-y-4 bg-[#F4F4F5] p-1 rounded-md">
        {/* Barra de Subtítulo Corporativo */}
        <div className="bg-[#2C474E] text-white px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider">
              BALANCE SEMANAL — CHICHA ADICTIVA
            </span>
            <span className="text-[11px] text-[#86EFAC] font-medium uppercase tracking-wide tabular-nums">
              {rangoTexto} • {nombreFiltroPuesto}
            </span>
          </div>
        </div>

        {/* 1. TARJETAS KPI EN FILA */}
        <div className="grid grid-cols-3 gap-2">
          {/* TOTAL INGRESOS */}
          <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg p-2.5 text-center shadow-xs">
            <span className="block text-[10px] sm:text-xs font-bold text-[#166534] uppercase tracking-wider mb-1">
              TOTAL INGRESOS ($)
            </span>
            <span className="block text-sm sm:text-lg font-black text-[#166534] tabular-nums">
              {formatUSD(totalIngresosUSD)}
            </span>
            <span className="block text-[10px] text-[#166534] opacity-80 tabular-nums font-medium mt-0.5">
              {formatVES(totalIngresosBs)}
            </span>
          </div>

          {/* TOTAL GASTOS */}
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-2.5 text-center shadow-xs">
            <span className="block text-[10px] sm:text-xs font-bold text-[#991B1B] uppercase tracking-wider mb-1">
              TOTAL GASTOS ($)
            </span>
            <span className="block text-sm sm:text-lg font-black text-[#991B1B] tabular-nums">
              {formatUSD(totalGastosUSD)}
            </span>
            <span className="block text-[10px] text-[#991B1B] opacity-80 tabular-nums font-medium mt-0.5">
              {formatVES(totalGastosBs)}
            </span>
          </div>

          {/* BALANCE NETO */}
          <div
            className={`rounded-lg p-2.5 text-center shadow-xs border ${
              balanceNetoUSD >= 0
                ? 'bg-[#F0FDF4] border-[#86EFAC]'
                : 'bg-[#FFF1F2] border-[#FDA4AF]'
            }`}
          >
            <span className="block text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1 text-[#18181B]">
              BALANCE NETO ($)
            </span>
            <span
              className={`block text-sm sm:text-lg font-black tabular-nums ${
                balanceNetoUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
              }`}
            >
              {balanceNetoUSD >= 0 ? '+' : ''}
              {formatUSD(balanceNetoUSD)}
            </span>
            <span className="block text-[10px] text-[#52525B] tabular-nums font-medium mt-0.5">
              {balanceNetoBs >= 0 ? '+' : ''}
              {formatVES(balanceNetoBs)}
            </span>
          </div>
        </div>

        {/* 2. BLOQUE DESTACADO: RESUMEN POR PUESTO DE VENTA (VENTAS Y COMISIÓN 22%) */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3.5 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store size={15} className="text-[#86EFAC]" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Resumen por Puesto de Venta (Comisión Vendedores)
              </span>
            </div>
            <span className="text-[11px] text-[#86EFAC] font-mono">
              Período Seleccionado
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-[#52525B] font-bold">
                  <th className="py-2 px-3">Puesto de Venta</th>
                  <th className="py-2 px-2.5 text-center">Cant.</th>
                  <th className="py-2 px-3 text-right">Total Ventas ($)</th>
                  <th className="py-2 px-3 text-right text-[#047857]">Comisión Vendedores ($)</th>
                  <th className="py-2 px-3 text-right text-[#166534]">Neto Negocio ($)</th>
                  <th className="py-2 px-3 text-right">Liquidación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {resumenPorPuesto.items.map((p) => {
                  const liquidado = isPuestoLiquidado(p.id);
                  return (
                    <tr key={p.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-[#18181B]">
                        {p.nombre}
                        {p.porcentaje > 0 && (
                          <span className="ml-1.5 text-[10px] text-zinc-500 font-mono font-normal">
                            ({p.porcentaje}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-center tabular-nums text-zinc-500">
                        {p.ventasCount}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-[#18181B]">
                        {formatUSD(p.totalUSD)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-[#047857] font-mono">
                        ({formatUSD(p.comisionUSD)})
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-black text-[#166534]">
                        {formatUSD(p.netoUSD)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {liquidado ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#ECFDF5] text-[#166534] border border-[#A7F3D0]">
                            <CheckCircle2 size={12} />
                            <span>Pagado ✓</span>
                          </span>
                        ) : p.comisionUSD > 0 && p.id !== 'sin-puesto' ? (
                          <button
                            type="button"
                            onClick={() => handleAbrirModalPago(p)}
                            disabled={liquidandoPuestoId === p.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#166534] hover:bg-[#14532d] active:bg-[#0f3d21] text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {liquidandoPuestoId === p.id ? (
                              <>
                                <Loader2 size={12} className="animate-spin text-white" />
                                <span>Pagando...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={12} className="text-[#86EFAC]" />
                                <span>Pagar Comisión ({formatUSD(p.comisionUSD)})</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-zinc-400 text-xs italic">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-3">TOTAL PUESTOS</td>
                  <td className="py-2.5 px-2.5 text-center tabular-nums">
                    {resumenPorPuesto.items.reduce((acc, i) => acc + i.ventasCount, 0)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#18181B]">
                    {formatUSD(resumenPorPuesto.totalVentas)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#047857] font-mono">
                    ({formatUSD(resumenPorPuesto.totalComision)})
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#166534]">
                    {formatUSD(resumenPorPuesto.totalNeto)}
                  </td>
                  <td className="py-2.5 px-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 3. RESUMEN DE INGRESOS POR MÉTODO DE PAGO */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 shadow-xs">
          <span className="block text-xs font-bold text-[#18181B] uppercase tracking-wider mb-2 pb-1 border-b border-[#E4E4E7]">
            Ventas por Método de Pago
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 border border-[#E4E4E7] rounded bg-[#FAFAFA]">
              <span className="block text-[11px] font-semibold text-[#52525B]">Pago Móvil</span>
              <span className="block text-xs sm:text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.pago_movil.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums">
                {formatVES(ingresosPorMetodo.pago_movil.bs)}
              </span>
            </div>
            <div className="p-2 border border-[#E4E4E7] rounded bg-[#FAFAFA]">
              <span className="block text-[11px] font-semibold text-[#52525B]">Punto de Venta</span>
              <span className="block text-xs sm:text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.punto_venta.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums">
                {formatVES(ingresosPorMetodo.punto_venta.bs)}
              </span>
            </div>
            <div className="p-2 border border-[#E4E4E7] rounded bg-[#FAFAFA]">
              <span className="block text-[11px] font-semibold text-[#52525B]">Efectivo Bs</span>
              <span className="block text-xs sm:text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.efectivo_bs.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums">
                {formatVES(ingresosPorMetodo.efectivo_bs.bs)}
              </span>
            </div>
            <div className="p-2 border border-[#E4E4E7] rounded bg-[#FAFAFA]">
              <span className="block text-[11px] font-semibold text-[#52525B]">Divisa ($)</span>
              <span className="block text-xs sm:text-sm font-bold text-[#166534] tabular-nums mt-0.5">
                {formatUSD(ingresosPorMetodo.divisa.usd)}
              </span>
              <span className="block text-[10px] text-zinc-400 tabular-nums">
                {formatVES(ingresosPorMetodo.divisa.bs)}
              </span>
            </div>
          </div>
        </div>

        {/* 4. TABLA DETALLE DIARIO (Lunes a Domingo) */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3.5 py-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">
              Detalle Diario (Lunes a Domingo)
            </span>
            <span className="text-[11px] text-[#86EFAC] font-mono">7 Días</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-[#52525B] font-bold">
                  <th className="py-2 px-2.5 sticky left-0 bg-[#FAFAFA] z-10 border-r border-[#E4E4E7]">
                    Día
                  </th>
                  <th className="py-2 px-2 text-right">Ingresos (Bs)</th>
                  <th className="py-2 px-2 text-right text-[#166534]">Ingresos ($)</th>
                  <th className="py-2 px-2 text-right">Gastos (Bs)</th>
                  <th className="py-2 px-2 text-right text-[#991B1B]">Gastos ($)</th>
                  <th className="py-2 px-2.5 text-right font-black">Balance ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {detalleDiario.map((d) => (
                  <tr key={d.fecha} className="hover:bg-zinc-50 transition-colors">
                    <td className="py-2 px-2.5 font-bold sticky left-0 bg-white z-10 border-r border-[#E4E4E7] whitespace-nowrap">
                      {d.dia} <span className="text-[10px] font-normal text-zinc-400">({d.fecha.slice(5)})</span>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-zinc-600">
                      {formatNumber(d.ingresosBs)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold text-[#166534]">
                      {formatUSD(d.ingresosUSD)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-zinc-600">
                      {formatNumber(d.gastosBs)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold text-[#991B1B]">
                      {formatUSD(d.gastosUSD)}
                    </td>
                    <td
                      className={`py-2 px-2.5 text-right tabular-nums font-bold ${
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
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-2.5 sticky left-0 bg-zinc-100 z-10 border-r border-[#E4E4E7]">
                    TOTAL
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{formatNumber(totalIngresosBs)}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-[#166534]">
                    {formatUSD(totalIngresosUSD)}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{formatNumber(totalGastosBs)}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-[#991B1B]">
                    {formatUSD(totalGastosUSD)}
                  </td>
                  <td
                    className={`py-2.5 px-2.5 text-right tabular-nums font-black ${
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
        </div>

        {/* 5. TABLA RESUMEN DE GASTOS POR CATEGORÍA Y NATURALEZA */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3.5 py-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">
              Gastos por Categoría y Naturaleza
            </span>
            <span className="text-[11px] text-[#86EFAC] font-mono">
              Total: {formatUSD(totalGastosUSD)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-[#52525B] font-bold">
                  <th className="py-2 px-2.5 sticky left-0 bg-[#FAFAFA] z-10 border-r border-[#E4E4E7]">
                    Categoría
                  </th>
                  <th className="py-2 px-2 text-center">Naturaleza</th>
                  <th className="py-2 px-2 text-right">Pago Móvil</th>
                  <th className="py-2 px-2 text-right">Efectivo</th>
                  <th className="py-2 px-2 text-right">Total Bs</th>
                  <th className="py-2 px-2.5 text-right text-[#991B1B]">Total ($)</th>
                  <th className="py-2 px-2 text-right">% Gasto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {resumenCategorias.map((c) => {
                  const pct = totalGastosUSD > 0 ? (c.totalUSD / totalGastosUSD) * 100 : 0;
                  return (
                    <tr key={c.categoria} className="hover:bg-zinc-50 transition-colors">
                      <td className="py-2 px-2.5 font-bold text-[#18181B] sticky left-0 bg-white z-10 border-r border-[#E4E4E7] whitespace-nowrap">
                        {c.categoria}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <BadgeNaturaleza naturaleza={c.naturaleza} tipo="gasto" />
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-600">
                        {formatNumber(c.pagoMovilBs)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-600">
                        {formatNumber(c.efectivoBs)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold text-[#18181B]">
                        {formatNumber(c.totalBs)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#991B1B]">
                        {formatUSD(c.totalUSD)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-500 font-medium">
                        {formatPorcentaje(pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-2.5 sticky left-0 bg-zinc-100 z-10 border-r border-[#E4E4E7]">
                    TOTAL GASTOS
                  </td>
                  <td className="py-2.5 px-2 text-center text-[10px] text-zinc-500">
                    {totalGastosItemsCount} items
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">
                    {formatNumber(resumenCategorias.reduce((a, b) => a + b.pagoMovilBs, 0))}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">
                    {formatNumber(resumenCategorias.reduce((a, b) => a + b.efectivoBs, 0))}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{formatNumber(totalGastosBs)}</td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                    {formatUSD(totalGastosUSD)}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">100.0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 6. TABLA DESGLOSE POR NATURALEZA (Gastos vs Personal) */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3.5 py-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">
              Desglose por Naturaleza (Gastos vs Personal)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-[#52525B] font-bold">
                  <th className="py-2 px-2.5 sticky left-0 bg-[#FAFAFA] z-10 border-r border-[#E4E4E7]">
                    Naturaleza
                  </th>
                  <th className="py-2 px-2.5 text-right">Total (Bs)</th>
                  <th className="py-2 px-2.5 text-right text-[#991B1B]">Total ($)</th>
                  <th className="py-2 px-2.5 text-right">% Gasto</th>
                  <th className="py-2 px-2.5 text-right">Impacto s/ Ventas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {desgloseNaturaleza.map((n) => (
                  <tr key={n.naturaleza} className="hover:bg-zinc-50 transition-colors">
                    <td className="py-2 px-2.5 font-bold sticky left-0 bg-white z-10 border-r border-[#E4E4E7]">
                      <BadgeNaturaleza naturaleza={n.naturaleza} tipo="gasto" />
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums text-zinc-600">
                      {formatNumber(n.totalBs)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#991B1B]">
                      {formatUSD(n.totalUSD)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#52525B]">
                      {formatPorcentaje(n.porcGasto)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#18181B]">
                      {formatPorcentaje(n.impactoIngresos)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-2.5 sticky left-0 bg-zinc-100 z-10 border-r border-[#E4E4E7]">
                    TOTAL
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">{formatNumber(totalGastosBs)}</td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                    {formatUSD(totalGastosUSD)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">100.0%</td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">
                    {totalIngresosUSD > 0
                      ? formatPorcentaje((totalGastosUSD / totalIngresosUSD) * 100)
                      : '0.0%'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 7. GRÁFICOS (RECHARTS RESPONSIVOS CON COLORES SÓLIDOS CORPORATIVOS) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Gráfico 1: Barras agrupadas Ingresos vs Gastos Diarios ($ USD) */}
          <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 shadow-xs">
            <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-[#E4E4E7]">
              <BarChart2 size={15} className="text-[#2C474E]" />
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
                      borderRadius: '6px',
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
                    iconType="rect"
                  />
                  <Bar dataKey="Ingresos" fill="#2C474E" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Gastos" fill="#B91C1C" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfico 2: Circular Distribución de Gastos por Categoría */}
          <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 shadow-xs">
            <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-[#E4E4E7]">
              <PieIcon size={15} className="text-[#2C474E]" />
              <span className="text-xs font-bold text-[#18181B]">
                Distribución de Gastos por Categoría
              </span>
            </div>
            {datosGraficoCircular.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-xs text-[#52525B]">
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
                      innerRadius={38}
                      outerRadius={68}
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
                        borderRadius: '6px',
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
      </div>

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
                  <h3 className="text-sm font-bold leading-tight">Pagar Comisión Semanal</h3>
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
              {/* Cifra acumulada en USD */}
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-zinc-500 block">
                    Comisión Acumulada ({pagoModalData.comisionPorcentaje}%):
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    Congelada según tasa de cada día trabajado
                  </span>
                </div>
                <div className="text-xl sm:text-2xl font-black font-mono text-[#047857] tabular-nums">
                  {formatUSD(pagoModalData.comisionUSD)}
                </div>
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
                  Monto exacto a transferir:
                </span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-[#166534] tabular-nums">
                  {formatVES(
                    Math.round(
                      pagoModalData.comisionUSD * (parseFloat(tasaPagoComision) || tasaActual || 100) * 100
                    ) / 100
                  )}
                </div>
                <span className="text-[10px] text-[#059669] font-medium block mt-0.5">
                  ({formatUSD(pagoModalData.comisionUSD)} × {formatNumber(parseFloat(tasaPagoComision) || tasaActual || 100)} Bs/$)
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
