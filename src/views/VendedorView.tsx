import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Award,
  ChevronDown,
  ChevronUp,
  Banknote,
  Smartphone,
  CreditCard,
  CircleDollarSign,
  Receipt,
  Sparkles,
} from 'lucide-react';
import { Movimiento, PerfilUsuario, LiquidacionSemanal } from '../types';
import { formatNumber, formatUSD, formatVES } from '../utils/format';
import { getVenezuelaDate } from '../utils/parserLocal';
import { getSemanaLunesSabado, shiftSemana } from '../utils/dateUtils';
import { getLiquidacionesSemanales, eliminarMovimientosDiaPuesto, supabase } from '../services/supabase';

interface Props {
  perfil: PerfilUsuario;
  tasaDia: number;
  movimientos: Movimiento[];
  onGuardarMovimientos: (movs: Omit<Movimiento, 'id' | 'created_at'>[]) => Promise<Movimiento[]>;
  onActualizarMovimiento: (mov: Movimiento) => Promise<void>;
  onEliminarMovimiento: (id: string) => Promise<void>;
}

export const VendedorView: React.FC<Props> = ({
  perfil,
  tasaDia,
  movimientos,
  onGuardarMovimientos,
}) => {
  // Pestaña activa en el menú inferior del vendedor
  const [tabActiva, setTabActiva] = useState<'cierre' | 'ganancias'>('cierre');

  // Fecha fija estricta de HOY en Venezuela (UTC-4)
  const fechaHoyVzla = useMemo(() => getVenezuelaDate(), []);

  // Campos del formulario de Cierre de Caja Diario (EXCLUSIVAMENTE DE HOY)
  const [montoEfectivoBs, setMontoEfectivoBs] = useState<string>('');
  const [montoPagoMovilBs, setMontoPagoMovilBs] = useState<string>('');
  const [montoPuntoVentaBs, setMontoPuntoVentaBs] = useState<string>('');
  const [montoDivisasUSD, setMontoDivisasUSD] = useState<string>('');

  // Sección opcional de gastos del puesto en efectivo
  const [mostrarGastos, setMostrarGastos] = useState<boolean>(false);
  const [gastoBs, setGastoBs] = useState<string>('');
  const [gastoDescripcion, setGastoDescripcion] = useState<string>('');

  // Estados de guardado, mensaje y toast
  const [guardando, setGuardando] = useState<boolean>(false);
  const [toastMensaje, setToastMensaje] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Liquidaciones semanales
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionSemanal[]>([]);

  // Comisión del puesto (default 22%)
  const comisionPorcentaje = perfil.puesto?.porcentaje_comision ?? 22.0;

  // Cargar liquidaciones semanales
  const cargarLiquidaciones = useCallback(async () => {
    try {
      const data = await getLiquidacionesSemanales(perfil.puesto_id || undefined);
      setLiquidaciones(data);
    } catch (err) {
      console.warn('Error cargando liquidaciones:', err);
    }
  }, [perfil.puesto_id]);

  useEffect(() => {
    cargarLiquidaciones();
  }, [cargarLiquidaciones]);

  // Suscripción en tiempo real a liquidaciones y movimientos
  useEffect(() => {
    const client = supabase;
    if (!client || !perfil.puesto_id) return;

    const channel = client
      .channel(`rt-vendedor-movimientos-${perfil.puesto_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'liquidaciones_semanales',
          filter: `puesto_id=eq.${perfil.puesto_id}`,
        },
        () => {
          cargarLiquidaciones();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [perfil.puesto_id, cargarLiquidaciones]);

  // Información de la semana a la que pertenece HOY
  const infoSemanaHoy = useMemo(() => {
    return getSemanaLunesSabado(fechaHoyVzla);
  }, [fechaHoyVzla]);

  // Comprobar si la semana de HOY está bloqueada como pagada en liquidaciones_semanales
  const semanaHoyPagada = useMemo(() => {
    if (!perfil.puesto_id) return false;
    return liquidaciones.some(
      (l) =>
        l.puesto_id === perfil.puesto_id &&
        l.semana_inicio === infoSemanaHoy.semanaInicio &&
        l.pagado !== false
    );
  }, [liquidaciones, perfil.puesto_id, infoSemanaHoy.semanaInicio]);

  // Cargar en el formulario ÚNICAMENTE los registros guardados de HOY
  const cargarCierreDeHoy = useCallback(() => {
    const movsHoy = movimientos.filter(
      (m) =>
        (!perfil.puesto_id || m.puesto_id === perfil.puesto_id) &&
        m.fecha === fechaHoyVzla
    );

    let efBs = 0;
    let pmBs = 0;
    let ptBs = 0;
    let divUSD = 0;
    let gastBs = 0;
    let descGasto = '';

    for (const m of movsHoy) {
      if (m.tipo === 'venta' || m.tipo === 'ingreso') {
        const orig = Number(m.monto_original) || 0;
        if (m.metodo_pago === 'efectivo_bs') efBs += orig;
        else if (m.metodo_pago === 'pago_movil') pmBs += orig;
        else if (m.metodo_pago === 'punto_venta') ptBs += orig;
        else if (m.metodo_pago === 'divisa') divUSD += orig;
      } else if (m.tipo === 'gasto' || m.tipo === 'egreso') {
        const orig = Number(m.monto_original) || 0;
        const tasa = Number(m.tasa ?? m.tasa_aplicada ?? tasaDia) || 100;
        gastBs += m.moneda_original === 'USD' ? orig * tasa : orig;
        if (m.descripcion && !descGasto) descGasto = m.descripcion;
      }
    }

    setMontoEfectivoBs(efBs > 0 ? String(efBs) : '');
    setMontoPagoMovilBs(pmBs > 0 ? String(pmBs) : '');
    setMontoPuntoVentaBs(ptBs > 0 ? String(ptBs) : '');
    setMontoDivisasUSD(divUSD > 0 ? String(divUSD) : '');

    if (gastBs > 0) {
      setMostrarGastos(true);
      setGastoBs(String(gastBs));
      setGastoDescripcion(descGasto);
    } else {
      setMostrarGastos(false);
      setGastoBs('');
      setGastoDescripcion('');
    }
  }, [movimientos, perfil.puesto_id, fechaHoyVzla, tasaDia]);

  // Al montar o cuando se actualicen los movimientos, sincronizar cierre de hoy
  useEffect(() => {
    cargarCierreDeHoy();
  }, [cargarCierreDeHoy]);

  // Resumen en vivo de los montos que el vendedor escribe para hoy
  const resumenCierreHoy = useMemo(() => {
    const efBs = parseFloat(montoEfectivoBs) || 0;
    const pmBs = parseFloat(montoPagoMovilBs) || 0;
    const ptBs = parseFloat(montoPuntoVentaBs) || 0;
    const divUSD = parseFloat(montoDivisasUSD) || 0;
    const gBs = parseFloat(gastoBs) || 0;

    const tasa = tasaDia > 0 ? tasaDia : 100;
    const totalBsVentas = efBs + pmBs + ptBs;
    const totalVendidoUSD = totalBsVentas / tasa + divUSD;
    const comisionUSD = (totalVendidoUSD * comisionPorcentaje) / 100;

    // Dinero físico a entregar
    const efectivoBsNeto = Math.max(0, efBs - gBs);
    const divisasUSDNeto = divUSD;

    return {
      efBs,
      pmBs,
      ptBs,
      divUSD,
      gBs,
      totalVendidoUSD,
      comisionUSD,
      efectivoBsNeto,
      divisasUSDNeto,
    };
  }, [montoEfectivoBs, montoPagoMovilBs, montoPuntoVentaBs, montoDivisasUSD, gastoBs, tasaDia, comisionPorcentaje]);

  // Guardar Cierre del Día (Exclusivamente de HOY) con try/catch/finally garantizado y timeout
  const handleGuardarCierre = async () => {
    if (guardando) return;

    if (semanaHoyPagada) {
      setMensajeError('Esta semana ya fue liquidada y pagada en nómina. Los montos no se pueden modificar.');
      return;
    }

    if (!perfil.puesto_id) {
      setMensajeError('No tienes un puesto de venta asignado a tu cuenta.');
      return;
    }

    const efBs = parseFloat(montoEfectivoBs) || 0;
    const pmBs = parseFloat(montoPagoMovilBs) || 0;
    const ptBs = parseFloat(montoPuntoVentaBs) || 0;
    const divUSD = parseFloat(montoDivisasUSD) || 0;
    const gBs = parseFloat(gastoBs) || 0;

    const totalVendido = efBs + pmBs + ptBs + divUSD;
    if (totalVendido <= 0 && gBs <= 0) {
      setMensajeError('Ingresa al menos un monto de venta o gasto para guardar el cierre del día.');
      return;
    }

    setGuardando(true);
    setMensajeError(null);
    setMensajeExito(null);

    try {
      const guardarOperacion = async () => {
        const tasa = tasaDia > 0 ? tasaDia : 100;
        const fechaHoy = fechaHoyVzla;

        // 1. Eliminar registros previos de este puesto en la fecha de HOY
        await eliminarMovimientosDiaPuesto(perfil.puesto_id!, fechaHoy);

        // 2. Construir los registros a insertar con tipo 'venta'
        const nuevosMovs: Omit<Movimiento, 'id' | 'created_at'>[] = [];

        if (efBs > 0) {
          nuevosMovs.push({
            fecha: fechaHoy,
            descripcion: 'Venta Efectivo Bs',
            tipo: 'venta',
            naturaleza: 'Negocio',
            categoria: 'Ventas',
            metodo_pago: 'efectivo_bs',
            moneda_original: 'VES',
            monto_original: efBs,
            tasa_aplicada: tasa,
            tasa,
            monto_bs: efBs,
            monto_usd: Math.round((efBs / tasa) * 100) / 100,
            puesto_id: perfil.puesto_id,
            creado_por: perfil.id,
            user_id: perfil.id,
          });
        }

        if (pmBs > 0) {
          nuevosMovs.push({
            fecha: fechaHoy,
            descripcion: 'Venta Pago Móvil',
            tipo: 'venta',
            naturaleza: 'Negocio',
            categoria: 'Ventas',
            metodo_pago: 'pago_movil',
            moneda_original: 'VES',
            monto_original: pmBs,
            tasa_aplicada: tasa,
            tasa,
            monto_bs: pmBs,
            monto_usd: Math.round((pmBs / tasa) * 100) / 100,
            puesto_id: perfil.puesto_id,
            creado_por: perfil.id,
            user_id: perfil.id,
          });
        }

        if (ptBs > 0) {
          nuevosMovs.push({
            fecha: fechaHoy,
            descripcion: 'Venta Punto de Venta',
            tipo: 'venta',
            naturaleza: 'Negocio',
            categoria: 'Ventas',
            metodo_pago: 'punto_venta',
            moneda_original: 'VES',
            monto_original: ptBs,
            tasa_aplicada: tasa,
            tasa,
            monto_bs: ptBs,
            monto_usd: Math.round((ptBs / tasa) * 100) / 100,
            puesto_id: perfil.puesto_id,
            creado_por: perfil.id,
            user_id: perfil.id,
          });
        }

        if (divUSD > 0) {
          nuevosMovs.push({
            fecha: fechaHoy,
            descripcion: 'Venta Divisas ($)',
            tipo: 'venta',
            naturaleza: 'Negocio',
            categoria: 'Ventas',
            metodo_pago: 'divisa',
            moneda_original: 'USD',
            monto_original: divUSD,
            tasa_aplicada: tasa,
            tasa,
            monto_usd: divUSD,
            monto_bs: Math.round(divUSD * tasa * 100) / 100,
            puesto_id: perfil.puesto_id,
            creado_por: perfil.id,
            user_id: perfil.id,
          });
        }

        // 3. Si hubo gasto del puesto en efectivo, insertar con tipo 'gasto'
        if (gBs > 0) {
          nuevosMovs.push({
            fecha: fechaHoy,
            descripcion: gastoDescripcion.trim() || 'Gasto operativo del puesto (Efectivo)',
            tipo: 'gasto',
            naturaleza: 'Negocio',
            categoria: 'Hielo y Varios Operativos',
            metodo_pago: 'efectivo_bs',
            moneda_original: 'VES',
            monto_original: gBs,
            tasa_aplicada: tasa,
            tasa,
            monto_bs: gBs,
            monto_usd: Math.round((gBs / tasa) * 100) / 100,
            puesto_id: perfil.puesto_id,
            creado_por: perfil.id,
            user_id: perfil.id,
          });
        }

        if (nuevosMovs.length > 0) {
          await onGuardarMovimientos(nuevosMovs);
        }
      };

      // Timeout de seguridad en la vista (10 segundos)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado al conectar con Supabase (10s)')), 10000)
      );

      await Promise.race([guardarOperacion(), timeoutPromise]);

      setToastMensaje('Cierre guardado correctamente');
      setMensajeExito('Cierre guardado correctamente');
      setTimeout(() => {
        setToastMensaje(null);
        setMensajeExito(null);
      }, 4000);
    } catch (err: any) {
      console.error('Error al guardar cierre de caja:', err);
      setMensajeError(err?.message || 'Error al guardar el cierre de caja en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  // ======================================================================
  // ESTADOS Y CÁLCULOS PARA LA PESTAÑA "MIS GANANCIAS"
  // ======================================================================
  const [semanaGananciasBase, setSemanaGananciasBase] = useState<Date>(() => {
    const [y, m, d] = fechaHoyVzla.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  });

  const infoSemanaGanancias = useMemo(() => {
    return getSemanaLunesSabado(semanaGananciasBase);
  }, [semanaGananciasBase]);

  const semanaGananciasPagada = useMemo(() => {
    if (!perfil.puesto_id) return false;
    return liquidaciones.some(
      (l) =>
        l.puesto_id === perfil.puesto_id &&
        l.semana_inicio === infoSemanaGanancias.semanaInicio &&
        l.pagado !== false
    );
  }, [liquidaciones, perfil.puesto_id, infoSemanaGanancias.semanaInicio]);

  const movimientosSemanaGanancias = useMemo(() => {
    return movimientos.filter((m) => {
      const esPuesto = !perfil.puesto_id || m.puesto_id === perfil.puesto_id;
      const enRango = m.fecha >= infoSemanaGanancias.semanaInicio && m.fecha <= infoSemanaGanancias.semanaFin;
      return esPuesto && enRango;
    });
  }, [movimientos, perfil.puesto_id, infoSemanaGanancias.semanaInicio, infoSemanaGanancias.semanaFin]);

  const datos6DiasGanancias = useMemo(() => {
    return infoSemanaGanancias.dias.map((d) => {
      const movsDia = movimientosSemanaGanancias.filter((m) => m.fecha === d.fechaStr);
      let totalVentaUSD = 0;
      let totalVentaBs = 0;

      for (const m of movsDia) {
        if (m.tipo === 'venta' || m.tipo === 'ingreso') {
          const tasa = Number(m.tasa ?? m.tasa_aplicada ?? tasaDia) || 100;
          const orig = Number(m.monto_original) || 0;
          if (m.moneda_original === 'USD') {
            totalVentaUSD += orig;
            totalVentaBs += orig * tasa;
          } else {
            totalVentaBs += orig;
            totalVentaUSD += tasa > 0 ? orig / tasa : 0;
          }
        }
      }

      const comisionUSD = (totalVentaUSD * comisionPorcentaje) / 100;

      return {
        fechaStr: d.fechaStr,
        nombreDia: d.nombreDia,
        diaCorto: d.diaCorto,
        dateObj: d.dateObj,
        totalVentaUSD,
        totalVentaBs,
        comisionUSD,
        movimientosCount: movsDia.length,
      };
    });
  }, [infoSemanaGanancias.dias, movimientosSemanaGanancias, tasaDia, comisionPorcentaje]);

  const { totalVendidoSemanaUSD, comisionSemanaUSD, mejorDiaIndex } = useMemo(() => {
    let totalUSD = 0;
    let maxDiaUSD = 0;
    let mejorIdx = -1;

    datos6DiasGanancias.forEach((d, idx) => {
      totalUSD += d.totalVentaUSD;
      if (d.totalVentaUSD > maxDiaUSD) {
        maxDiaUSD = d.totalVentaUSD;
        mejorIdx = idx;
      }
    });

    const comision = (totalUSD * comisionPorcentaje) / 100;

    return {
      totalVendidoSemanaUSD: totalUSD,
      comisionSemanaUSD: comision,
      mejorDiaIndex: maxDiaUSD > 0 ? mejorIdx : -1,
    };
  }, [datos6DiasGanancias, comisionPorcentaje]);

  // Día seleccionado en el gráfico interactivo de Mis Ganancias (0 a 5)
  const [diaGananciasIndex, setDiaGananciasIndex] = useState<number>(0);

  const diaDetalleTrading = datos6DiasGanancias[diaGananciasIndex] || datos6DiasGanancias[0];

  const variacionDiaAnterior = useMemo(() => {
    if (diaGananciasIndex === 0) return null;
    const diaPrev = datos6DiasGanancias[diaGananciasIndex - 1];
    const prevUSD = diaPrev?.totalVentaUSD || 0;
    const currUSD = diaDetalleTrading?.totalVentaUSD || 0;

    if (prevUSD === 0 && currUSD === 0) return 0;
    if (prevUSD === 0 && currUSD > 0) return 100;
    return ((currUSD - prevUSD) / prevUSD) * 100;
  }, [diaGananciasIndex, datos6DiasGanancias, diaDetalleTrading]);

  // Coordenadas SVG Trading
  const svgTradingCoords = useMemo(() => {
    const W = 500;
    const H = 180;
    const padL = 40;
    const padR = 20;
    const padT = 25;
    const padB = 35;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxVal = Math.max(...datos6DiasGanancias.map((d) => d.totalVentaUSD), 10) * 1.15;

    const points = datos6DiasGanancias.map((d, i) => {
      const x = padL + i * (plotW / 5);
      const y = padT + (1 - d.totalVentaUSD / maxVal) * plotH;
      return { x, y, val: d.totalVentaUSD, dia: d.diaCorto };
    });

    const linePath = points.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
    }, '');

    const baseY = padT + plotH;
    const areaPath = `${linePath} L ${points[5].x},${baseY} L ${points[0].x},${baseY} Z`;

    return {
      W,
      H,
      points,
      linePath,
      areaPath,
      maxVal,
      padL,
      padR,
      baseY,
    };
  }, [datos6DiasGanancias]);

  // Formato legible de fecha de hoy en Venezuela
  const fechaHoyTexto = useMemo(() => {
    const [y, m, d] = fechaHoyVzla.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    const diaNum = dateObj.getDate();
    const mes = dateObj.toLocaleString('es-VE', { month: 'short' }).replace('.', '');
    return `${diaNum} ${mes.charAt(0).toUpperCase() + mes.slice(1)} ${y}`;
  }, [fechaHoyVzla]);

  return (
    <div className="pb-28 pt-2 px-3 sm:px-4 max-w-2xl mx-auto">
      {/* Toast Flotante de Confirmación */}
      {toastMensaje && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#166534] text-white px-4 py-2.5 rounded-xl shadow-lg border border-[#86EFAC]/30 flex items-center gap-2 animate-bounce">
          <CheckCircle2 size={18} className="text-[#86EFAC]" />
          <span className="text-xs sm:text-sm font-bold">{toastMensaje}</span>
        </div>
      )}

      {/* ======================================================================
          PESTAÑA 1: CIERRE DE CAJA (Únicamente el día de HOY)
         ====================================================================== */}
      {tabActiva === 'cierre' && (
        <div className="space-y-4">
          {/* ENCABEZADO CON NOMBRE DEL PUESTO, BADGE DE HOY Y TASA OFICIAL */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7] mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#166534] animate-pulse" />
                <h1 className="text-sm font-bold uppercase tracking-wider text-[#18181B]">
                  {perfil.puesto?.nombre || 'Mi Puesto de Venta'}
                </h1>
              </div>

              <span className="text-xs font-mono font-bold text-[#166534] bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-1 rounded-md">
                Tasa: {formatNumber(tasaDia)} Bs/$
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Calendar size={15} className="text-[#2C474E]" />
                <span className="text-xs font-semibold text-[#52525B]">Fecha del Cierre:</span>
                <span className="text-xs font-bold text-[#18181B] bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-md">
                  Hoy, {fechaHoyTexto}
                </span>
              </div>

              {semanaHoyPagada && (
                <div className="flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                  <Lock size={12} />
                  <span>Semana Pagada</span>
                </div>
              )}
            </div>
          </div>

          {semanaHoyPagada && (
            <div className="p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl text-xs text-[#92400E] flex items-start gap-2">
              <Lock size={15} className="shrink-0 mt-0.5 text-amber-600" />
              <div>
                <strong className="block font-bold">Semana pagada y cerrada</strong>
                Esta semana ya fue liquidada en nómina. Los campos están en solo lectura.
              </div>
            </div>
          )}

          {/* 4 CAMPOS NUMÉRICOS CLAROS DE VENTAS */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl p-4 shadow-xs space-y-3">
            <span className="block text-xs font-bold text-[#18181B] uppercase tracking-wide pb-1 border-b border-[#E4E4E7]">
              Ventas del Día ({fechaHoyTexto})
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Efectivo Bs */}
              <div className="p-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Banknote size={15} className="text-[#166534]" />
                    <span>Efectivo (Bs)</span>
                  </span>
                  <span className="text-[10px] text-zinc-400 font-normal">Físico Bs</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={montoEfectivoBs}
                    onChange={(e) => setMontoEfectivoBs(e.target.value)}
                    disabled={semanaHoyPagada || guardando}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-[#D4D4D8] rounded-md bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    Bs
                  </span>
                </div>
              </div>

              {/* Pago Móvil Bs */}
              <div className="p-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Smartphone size={15} className="text-[#2563EB]" />
                    <span>Pago Móvil (Bs)</span>
                  </span>
                  <span className="text-[10px] text-zinc-400 font-normal">Digital Bs</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={montoPagoMovilBs}
                    onChange={(e) => setMontoPagoMovilBs(e.target.value)}
                    disabled={semanaHoyPagada || guardando}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-[#D4D4D8] rounded-md bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    Bs
                  </span>
                </div>
              </div>

              {/* Punto de Venta Bs */}
              <div className="p-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={15} className="text-[#7C3AED]" />
                    <span>Punto de Venta (Bs)</span>
                  </span>
                  <span className="text-[10px] text-zinc-400 font-normal">Tarjeta Bs</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={montoPuntoVentaBs}
                    onChange={(e) => setMontoPuntoVentaBs(e.target.value)}
                    disabled={semanaHoyPagada || guardando}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-[#D4D4D8] rounded-md bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    Bs
                  </span>
                </div>
              </div>

              {/* Divisas $ en efectivo */}
              <div className="p-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <CircleDollarSign size={15} className="text-[#059669]" />
                    <span>Divisas ($ efectivo)</span>
                  </span>
                  <span className="text-[10px] text-zinc-400 font-normal">Físico $</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={montoDivisasUSD}
                    onChange={(e) => setMontoDivisasUSD(e.target.value)}
                    disabled={semanaHoyPagada || guardando}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-[#D4D4D8] rounded-md bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    $
                  </span>
                </div>
              </div>
            </div>

            {/* SECCIÓN OPCIONAL COLAPSABLE: GASTOS DEL PUESTO EN EFECTIVO (BS) */}
            <div className="border border-[#E4E4E7] rounded-lg overflow-hidden bg-zinc-50">
              <button
                type="button"
                onClick={() => setMostrarGastos((prev) => !prev)}
                className="w-full p-3 text-left flex items-center justify-between text-xs font-bold text-[#18181B] hover:bg-zinc-100 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className="text-red-600 font-black">-</span>
                  <span>Gastos del puesto en efectivo (Bs)</span>
                  {parseFloat(gastoBs) > 0 && (
                    <span className="text-[11px] text-red-700 bg-red-100 px-2 py-0.5 rounded font-mono font-bold">
                      {formatVES(parseFloat(gastoBs))}
                    </span>
                  )}
                </span>
                {mostrarGastos ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {mostrarGastos && (
                <div className="p-3 border-t border-[#E4E4E7] bg-white space-y-2.5">
                  <p className="text-[11px] text-[#52525B] leading-tight">
                    Se descuenta <strong>únicamente del efectivo físico a entregar</strong> al cierre. <strong>NO resta comisión</strong> a tu ganancia del día.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-600 mb-1">
                        Monto gastado en efectivo (Bs):
                      </label>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={gastoBs}
                        onChange={(e) => setGastoBs(e.target.value)}
                        disabled={semanaHoyPagada || guardando}
                        placeholder="0.00"
                        className="w-full p-2 text-xs font-mono font-bold border border-[#D4D4D8] rounded bg-white text-[#18181B] focus:ring-1 focus:ring-[#2C474E] disabled:bg-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-600 mb-1">
                        Concepto del gasto:
                      </label>
                      <input
                        type="text"
                        value={gastoDescripcion}
                        onChange={(e) => setGastoDescripcion(e.target.value)}
                        disabled={semanaHoyPagada || guardando}
                        placeholder="Ej. Hielo, vasos, servilletas"
                        className="w-full p-2 text-xs border border-[#D4D4D8] rounded bg-white text-[#18181B] focus:ring-1 focus:ring-[#2C474E] disabled:bg-zinc-100"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* TARJETA DE RESUMEN EN VIVO DE HOY */}
          <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-3.5 sm:p-4 shadow-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[11px] text-[#065F46] block font-semibold">
                  Total Vendido Hoy ($):
                </span>
                <div className="text-xl sm:text-2xl font-black tabular-nums text-[#065F46]">
                  {formatUSD(resumenCierreHoy.totalVendidoUSD)}
                </div>
                <span className="text-[10px] text-[#047857]">
                  Tasa: {formatNumber(tasaDia)} Bs/$
                </span>
              </div>

              <div className="sm:border-l sm:border-[#A7F3D0] sm:pl-3">
                <span className="text-[11px] text-[#065F46] block font-semibold">
                  Tu Comisión del Día ({comisionPorcentaje}%):
                </span>
                <div className="text-lg sm:text-2xl font-black tabular-nums text-[#047857] font-mono">
                  ({formatUSD(resumenCierreHoy.comisionUSD)})
                </div>
                <span className="text-[10px] text-[#059669]">
                  Calculada sobre venta bruta
                </span>
              </div>

              <div className="bg-white/80 border border-[#A7F3D0] rounded-lg p-2.5 sm:p-2 sm:border-l">
                <span className="text-[10px] uppercase font-bold text-[#166534] block mb-1">
                  Dinero Físico a Entregar:
                </span>
                <div className="text-xs font-bold text-[#18181B] flex justify-between gap-1">
                  <span>Efectivo Bs:</span>
                  <span className="font-mono tabular-nums text-[#166534]">
                    {formatVES(resumenCierreHoy.efectivoBsNeto)}
                  </span>
                </div>
                {resumenCierreHoy.gBs > 0 && (
                  <span className="block text-[9px] text-zinc-500 text-right">
                    (Descontado {formatVES(resumenCierreHoy.gBs)} de gasto)
                  </span>
                )}
                <div className="text-xs font-bold text-[#18181B] flex justify-between gap-1 mt-0.5">
                  <span>Divisas $:</span>
                  <span className="font-mono tabular-nums text-[#059669]">
                    {formatUSD(resumenCierreHoy.divisasUSDNeto)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BOTÓN GUARDAR CIERRE DEL DÍA */}
          <button
            type="button"
            onClick={handleGuardarCierre}
            disabled={semanaHoyPagada || guardando}
            className="w-full min-h-[48px] px-4 py-2.5 text-xs sm:text-sm font-bold bg-[#2C474E] text-white rounded-xl hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {guardando ? (
              <>
                <Loader2 size={16} className="animate-spin text-white" />
                <span>Guardando Cierre del Día...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={17} className="text-[#86EFAC]" />
                <span>Guardar Cierre del Día ({fechaHoyTexto})</span>
              </>
            )}
          </button>

          {mensajeError && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{mensajeError}</span>
            </div>
          )}

          {mensajeExito && (
            <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-xs text-[#065F46] flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0 text-[#10B981]" />
              <span className="font-semibold">{mensajeExito}</span>
            </div>
          )}
        </div>
      )}

      {/* ======================================================================
          PESTAÑA 2: MIS GANANCIAS (Rendimiento semanal, trading y comisiones)
         ====================================================================== */}
      {tabActiva === 'ganancias' && (
        <div className="space-y-4">
          {/* TARJETA OSCURA CON RESUMEN SEMANAL */}
          <div className="bg-gradient-to-br from-[#2C474E] to-[#1a2d32] text-white rounded-xl p-4 sm:p-5 shadow-sm border border-[#23393e]">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#86EFAC] animate-pulse" />
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-zinc-100">
                  {perfil.puesto?.nombre || 'Mi Puesto de Venta'}
                </span>
              </div>

              <span className="text-[11px] font-mono font-bold text-[#86EFAC] bg-white/10 px-2 py-0.5 rounded border border-white/10">
                Tasa: {formatNumber(tasaDia)} Bs/$
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <span className="text-[11px] text-zinc-300 block mb-0.5 font-medium">
                  Vendido esta Semana ($):
                </span>
                <div className="text-xl sm:text-2xl font-black tabular-nums text-white">
                  {formatUSD(totalVendidoSemanaUSD)}
                </div>
                <span className="text-[10px] text-zinc-300">
                  {infoSemanaGanancias.rangoTexto}
                </span>
              </div>

              <div className="bg-[#86EFAC]/15 border border-[#86EFAC]/30 rounded-lg p-2.5 text-right">
                <span className="text-[11px] font-bold text-[#86EFAC] block mb-0.5">
                  Tu Sueldo ({comisionPorcentaje}%):
                </span>
                <div className="text-lg sm:text-2xl font-black tabular-nums text-[#86EFAC] font-mono">
                  ({formatUSD(comisionSemanaUSD)})
                </div>
                <div className="mt-1">
                  {semanaGananciasPagada ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#166534] text-white border border-[#22c55e]">
                      <CheckCircle2 size={11} />
                      <span>Pagado ✓</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40">
                      <Clock size={11} />
                      <span>Pendiente</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* SELECTOR DE SEMANAS DE LUNES A SÁBADO */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl p-3 sm:p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSemanaGananciasBase((prev) => shiftSemana(prev, -1))}
                className="p-1.5 border border-[#E4E4E7] rounded-lg hover:bg-zinc-100 text-[#52525B] transition-colors"
                title="Semana anterior"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="text-center">
                <span className="block text-xs font-bold text-[#18181B] font-mono">
                  &lt; {infoSemanaGanancias.rangoTexto} &gt;
                </span>
                <span className="text-[10px] text-zinc-500">
                  Lunes a Sábado (6 días laborables)
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const [y, m, d] = fechaHoyVzla.split('-').map(Number);
                    setSemanaGananciasBase(new Date(y, m - 1, d, 12, 0, 0));
                  }}
                  className="px-2 py-1 text-[10px] font-bold text-[#2C474E] bg-zinc-100 hover:bg-zinc-200 rounded border border-zinc-200 transition-colors"
                  title="Semana actual"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => setSemanaGananciasBase((prev) => shiftSemana(prev, 1))}
                  className="p-1.5 border border-[#E4E4E7] rounded-lg hover:bg-zinc-100 text-[#52525B] transition-colors"
                  title="Semana siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* GRÁFICO ESTILO TRADING SVG RESPONSIVO */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl p-4 shadow-xs space-y-3">
            {/* Detalle interactivo del día seleccionado */}
            <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-[#2C474E]" />
                  <span className="text-xs font-bold text-[#18181B]">
                    {diaDetalleTrading.nombreDia} {diaDetalleTrading.dateObj.getDate()}
                  </span>
                  {diaGananciasIndex === mejorDiaIndex && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                      <Award size={10} className="text-amber-600" />
                      <span>★ Mejor día</span>
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-lg font-black tabular-nums text-[#18181B]">
                    {formatUSD(diaDetalleTrading.totalVentaUSD)}
                  </span>
                  <span className="text-xs font-bold text-[#047857] font-mono">
                    Comisión: ({formatUSD(diaDetalleTrading.comisionUSD)})
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[10px] text-zinc-500 block">vs Día Anterior:</span>
                {variacionDiaAnterior === null ? (
                  <span className="text-xs font-bold text-zinc-400">Inicio semana</span>
                ) : variacionDiaAnterior >= 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-black text-[#166534]">
                    <TrendingUp size={13} />
                    +{variacionDiaAnterior.toFixed(1)}%
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-xs font-black text-[#991B1B]">
                    <TrendingDown size={13} />
                    {variacionDiaAnterior.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* SVG TRADING VIEWPORT */}
            <div className="relative w-full bg-[#FAFAFA] rounded-xl border border-[#E4E4E7] p-2 overflow-hidden">
              <svg
                viewBox={`0 0 ${svgTradingCoords.W} ${svgTradingCoords.H}`}
                className="w-full h-40 sm:h-48 overflow-visible select-none"
              >
                <defs>
                  <linearGradient id="tradingGradientGanancias" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
                    <stop offset="70%" stopColor="#10B981" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Guías horizontales */}
                <line
                  x1={svgTradingCoords.padL}
                  y1="25"
                  x2={svgTradingCoords.W - svgTradingCoords.padR}
                  y2="25"
                  stroke="#E4E4E7"
                  strokeDasharray="3 3"
                />
                <text x={svgTradingCoords.padL - 6} y="28" textAnchor="end" fontSize="9" fill="#A1A1AA" fontFamily="monospace">
                  ${Math.round(svgTradingCoords.maxVal)}
                </text>

                <line
                  x1={svgTradingCoords.padL}
                  y1={svgTradingCoords.baseY - (svgTradingCoords.baseY - 25) / 2}
                  x2={svgTradingCoords.W - svgTradingCoords.padR}
                  y2={svgTradingCoords.baseY - (svgTradingCoords.baseY - 25) / 2}
                  stroke="#E4E4E7"
                  strokeDasharray="3 3"
                />
                <text
                  x={svgTradingCoords.padL - 6}
                  y={svgTradingCoords.baseY - (svgTradingCoords.baseY - 25) / 2 + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="#A1A1AA"
                  fontFamily="monospace"
                >
                  ${Math.round(svgTradingCoords.maxVal / 2)}
                </text>

                <line
                  x1={svgTradingCoords.padL}
                  y1={svgTradingCoords.baseY}
                  x2={svgTradingCoords.W - svgTradingCoords.padR}
                  y2={svgTradingCoords.baseY}
                  stroke="#E4E4E7"
                />
                <text x={svgTradingCoords.padL - 6} y={svgTradingCoords.baseY + 3} textAnchor="end" fontSize="9" fill="#A1A1AA" fontFamily="monospace">
                  $0
                </text>

                {/* Área con gradiente verde esmeralda */}
                <path d={svgTradingCoords.areaPath} fill="url(#tradingGradientGanancias)" />

                {/* Línea nítida de tendencia */}
                <path
                  d={svgTradingCoords.linePath}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Puntos interactivos */}
                {svgTradingCoords.points.map((pt, i) => {
                  const isSelected = i === diaGananciasIndex;
                  const isMejor = i === mejorDiaIndex;

                  return (
                    <g key={i} className="cursor-pointer" onClick={() => setDiaGananciasIndex(i)}>
                      {isSelected && (
                        <line
                          x1={pt.x}
                          y1="25"
                          x2={pt.x}
                          y2={svgTradingCoords.baseY}
                          stroke="#10B981"
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                          opacity="0.6"
                        />
                      )}

                      {isSelected && (
                        <circle cx={pt.x} cy={pt.y} r="12" fill="#10B981" opacity="0.25" className="animate-pulse" />
                      )}

                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isSelected ? 6 : 4}
                        fill={isSelected ? '#059669' : isMejor ? '#D97706' : '#10B981'}
                        stroke="#ffffff"
                        strokeWidth={isSelected ? 2.5 : 1.5}
                      />

                      <text
                        x={pt.x}
                        y={svgTradingCoords.baseY + 16}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight={isSelected ? 'bold' : 'normal'}
                        fill={isSelected ? '#18181B' : '#71717A'}
                      >
                        {pt.dia}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* LISTA DETALLADA DE GANANCIAS POR DÍA (Lunes a Sábado - Solo Lectura) */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-xs divide-y divide-[#E4E4E7]">
            <div className="bg-[#FAFAFA] px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-[#52525B]">
              <span>Rendimiento Diario (Lun - Sáb)</span>
              <span>Venta / Comisión</span>
            </div>

            {datos6DiasGanancias.map((d, i) => {
              const esHoy = d.fechaStr === fechaHoyVzla;
              const esSeleccionado = i === diaGananciasIndex;
              const esMejor = i === mejorDiaIndex;

              return (
                <div
                  key={d.fechaStr}
                  onClick={() => setDiaGananciasIndex(i)}
                  className={`p-3 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    esSeleccionado ? 'bg-emerald-50/60 font-semibold' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#18181B]">
                        {d.nombreDia} {d.dateObj.getDate()}
                      </span>
                      {esHoy && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#2C474E] text-white">
                          Hoy
                        </span>
                      )}
                      {esMejor && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300">
                          ★ Mejor día
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 block font-mono">
                      {d.fechaStr}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-xs sm:text-sm font-bold text-[#18181B] tabular-nums block">
                      {formatUSD(d.totalVentaUSD)}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-[#047857] block tabular-nums">
                      Comisión: ({formatUSD(d.comisionUSD)})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================================
          BARRA DE NAVEGACIÓN FIJA INFERIOR DEL VENDEDOR (Cierre de Caja | Mis Ganancias)
         ====================================================================== */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E4E4E7] shadow-sm safe-bottom">
        <div className="max-w-2xl mx-auto flex items-center justify-around h-16 px-2">
          {/* Pestaña Cierre de Caja */}
          <button
            type="button"
            onClick={() => setTabActiva('cierre')}
            className={`flex-1 flex flex-col items-center justify-center min-h-[48px] py-1 rounded transition-colors ${
              tabActiva === 'cierre'
                ? 'text-[#2C474E] font-bold'
                : 'text-[#52525B] hover:text-[#18181B] font-medium'
            }`}
          >
            <div
              className={`relative flex items-center justify-center p-1.5 rounded-md transition-colors ${
                tabActiva === 'cierre' ? 'bg-[#ECFDF5] text-[#2C474E]' : ''
              }`}
            >
              <Receipt size={20} strokeWidth={tabActiva === 'cierre' ? 2.3 : 1.8} />
            </div>
            <span className="text-[11px] mt-0.5 tracking-tight">Cierre de Caja</span>
          </button>

          {/* Pestaña Mis Ganancias */}
          <button
            type="button"
            onClick={() => setTabActiva('ganancias')}
            className={`flex-1 flex flex-col items-center justify-center min-h-[48px] py-1 rounded transition-colors ${
              tabActiva === 'ganancias'
                ? 'text-[#2C474E] font-bold'
                : 'text-[#52525B] hover:text-[#18181B] font-medium'
            }`}
          >
            <div
              className={`relative flex items-center justify-center p-1.5 rounded-md transition-colors ${
                tabActiva === 'ganancias' ? 'bg-[#ECFDF5] text-[#2C474E]' : ''
              }`}
            >
              <TrendingUp size={20} strokeWidth={tabActiva === 'ganancias' ? 2.3 : 1.8} />
            </div>
            <span className="text-[11px] mt-0.5 tracking-tight">Mis Ganancias</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
