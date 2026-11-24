import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Award,
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
import { getLiquidacionesSemanales, supabase } from '../services/supabase';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

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

  // Fecha fija estricta de HOY y AYER en Venezuela (UTC-4)
  const fechaHoyVzla = useMemo(() => getVenezuelaDate(), []);
  const fechaAyerVzla = useMemo(() => {
    const [y, m, d] = fechaHoyVzla.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    dt.setDate(dt.getDate() - 1);
    const yA = dt.getFullYear();
    const mA = String(dt.getMonth() + 1).padStart(2, '0');
    const dA = String(dt.getDate()).padStart(2, '0');
    return `${yA}-${mA}-${dA}`;
  }, [fechaHoyVzla]);

  const formatDiaMes = (fechaStr: string) => {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    const diaNum = dt.getDate();
    const mes = dt.toLocaleString('es-VE', { month: 'short' }).replace('.', '');
    return `${diaNum} ${mes.charAt(0).toUpperCase() + mes.slice(1)}`;
  };
  const labelHoy = useMemo(() => formatDiaMes(fechaHoyVzla), [fechaHoyVzla]);
  const labelAyer = useMemo(() => formatDiaMes(fechaAyerVzla), [fechaAyerVzla]);

  // Selección de fecha en Cierre de Caja: 'hoy' o 'ayer' (plazo de 1 día)
  const [diaSeleccionado, setDiaSeleccionado] = useState<'hoy' | 'ayer'>('hoy');
  const fechaSeleccionada = diaSeleccionado === 'hoy' ? fechaHoyVzla : fechaAyerVzla;
  const fechaSeleccionadaTexto = diaSeleccionado === 'hoy' ? `Hoy (${labelHoy})` : `Ayer (${labelAyer})`;

  // Tasa oficial sincronizada con Supabase (tasa_bcv_oficial)
  const [tasaEfectiva, setTasaEfectiva] = useState<number>(tasaDia > 0 ? tasaDia : 0);

  // Consultar tasa_bcv_oficial?id=eq.1 al montar la vista
  useEffect(() => {
    let cancelado = false;
    const cargarTasaOficial = async () => {
      try {
        const token = getAccessTokenFromStorage() || supabaseAnonKey;
        const res = await fetch(`${supabaseUrl}/rest/v1/tasa_bcv_oficial?id=eq.1`, {
          method: 'GET',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelado && Array.isArray(data) && data[0]?.tasa) {
            const t = Number(data[0].tasa);
            if (t > 0) setTasaEfectiva(t);
          }
        }
      } catch (err) {
        console.warn('Error consultando tasa_bcv_oficial en VendedorView:', err);
      }
    };
    cargarTasaOficial();
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (tasaDia > 0) {
      setTasaEfectiva(tasaDia);
    }
  }, [tasaDia]);

  // Suscripción Realtime a tasa_bcv_oficial para actualizar al instante
  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel('rt-vendedor-tasa-bcv')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasa_bcv_oficial' },
        (payload) => {
          if (payload.new && (payload.new as any).tasa) {
            const t = Number((payload.new as any).tasa);
            if (t > 0) setTasaEfectiva(t);
          }
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, []);

  // Campos del formulario de Cierre de Caja Diario (EXCLUSIVAMENTE DE HOY - Solo 4 métodos de venta)
  const [montoEfectivoBs, setMontoEfectivoBs] = useState<string>('');
  const [montoPagoMovilBs, setMontoPagoMovilBs] = useState<string>('');
  const [montoPuntoVentaBs, setMontoPuntoVentaBs] = useState<string>('');
  const [montoDivisasUSD, setMontoDivisasUSD] = useState<string>('');

  // Estados de guardado, mensaje y toast
  const [guardando, setGuardando] = useState<boolean>(false);
  const [tieneCierreGuardado, setTieneCierreGuardado] = useState<boolean>(false);
  const [toastMensaje, setToastMensaje] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Liquidaciones semanales
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionSemanal[]>([]);

  // Comisión del puesto (default 22%)
  const comisionPorcentaje = perfil.puesto?.porcentaje_comision ?? 22.0;

  // Cargar liquidaciones semanales via fetch directo
  const cargarLiquidaciones = useCallback(async () => {
    if (!perfil.puesto_id) return;
    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const res = await fetch(
        `${supabaseUrl}/rest/v1/liquidaciones_semanales?puesto_id=eq.${perfil.puesto_id}&select=*`,
        {
          method: 'GET',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLiquidaciones(data);
          return;
        }
      }
      const data = await getLiquidacionesSemanales(perfil.puesto_id);
      setLiquidaciones(data);
    } catch (err) {
      console.warn('Error cargando liquidaciones en VendedorView:', err);
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

  // Cargar en el formulario los registros del día seleccionado (Hoy o Ayer) mediante fetch directo
  const cargarCierre = useCallback(async (fechaACargar: string) => {
    let movsFecha: any[] = movimientos.filter(
      (m) =>
        (!perfil.puesto_id || m.puesto_id === perfil.puesto_id) &&
        m.fecha === fechaACargar
    );

    const token = getAccessTokenFromStorage() || supabaseAnonKey;
    if (perfil.puesto_id) {
      try {
        const url = `${supabaseUrl}/rest/v1/movimientos?puesto_id=eq.${perfil.puesto_id}&fecha=eq.${fechaACargar}&select=*`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            movsFecha = data;
          }
        }
      } catch (e) {
        console.warn('Aviso cargando movimientos directo via fetch:', e);
      }
    }

    let efBs = 0;
    let pmBs = 0;
    let ptBs = 0;
    let divUSD = 0;

    for (const m of movsFecha) {
      const tipo = (m.tipo || '').toLowerCase();
      const metodo = (m.metodo_pago || '').toLowerCase();
      const orig = Number(m.monto_original) || 0;
      const mBs = Number(m.monto_bs) || (m.moneda_original === 'VES' || m.moneda === 'VES' ? orig : 0);
      const mUSD = Number(m.monto_usd) || (m.moneda_original === 'USD' || m.moneda === 'USD' ? orig : 0);

      if (tipo === 'venta' || tipo === 'ingreso') {
        if (metodo === 'efectivo_bs' || (metodo.includes('efectivo') && !metodo.includes('divisa'))) {
          efBs += mBs || orig;
        } else if (metodo === 'pago_movil' || metodo.includes('pago')) {
          pmBs += mBs || orig;
        } else if (metodo === 'punto_venta' || metodo.includes('punto')) {
          ptBs += mBs || orig;
        } else if (metodo === 'divisa' || metodo.includes('divisa') || metodo.includes('dolar') || metodo.includes('usd')) {
          divUSD += mUSD || orig;
        }
      }
    }

    const hayDatos = efBs > 0 || pmBs > 0 || ptBs > 0 || divUSD > 0;
    setTieneCierreGuardado(hayDatos);

    if (hayDatos) {
      setMontoEfectivoBs(efBs > 0 ? String(efBs) : '');
      setMontoPagoMovilBs(pmBs > 0 ? String(pmBs) : '');
      setMontoPuntoVentaBs(ptBs > 0 ? String(ptBs) : '');
      setMontoDivisasUSD(divUSD > 0 ? String(divUSD) : '');
    } else {
      setMontoEfectivoBs('');
      setMontoPagoMovilBs('');
      setMontoPuntoVentaBs('');
      setMontoDivisasUSD('');
    }
  }, [movimientos, perfil.puesto_id]);

  // Al montar, cuando se cambie de pestaña o se cambie la fecha seleccionada, sincronizar cierre
  useEffect(() => {
    if (tabActiva === 'cierre') {
      cargarCierre(fechaSeleccionada);
    }
  }, [tabActiva, fechaSeleccionada, cargarCierre]);

  // Resumen en vivo de los montos que el vendedor escribe (solo ventas, sin deducciones de gastos)
  const resumenCierre = useMemo(() => {
    const efBs = parseFloat(montoEfectivoBs) || 0;
    const pmBs = parseFloat(montoPagoMovilBs) || 0;
    const ptBs = parseFloat(montoPuntoVentaBs) || 0;
    const divUSD = parseFloat(montoDivisasUSD) || 0;

    const tasa = tasaEfectiva > 0 ? tasaEfectiva : (tasaDia > 0 ? tasaDia : 1);
    const totalBsVentas = efBs + pmBs + ptBs;
    const totalVendidoUSD = totalBsVentas / tasa + divUSD;
    const comisionUSD = (totalVendidoUSD * comisionPorcentaje) / 100;

    return {
      efBs,
      pmBs,
      ptBs,
      divUSD,
      totalVendidoUSD,
      comisionUSD,
      efectivoBsFisico: efBs,
      divisasUSDFisico: divUSD,
    };
  }, [montoEfectivoBs, montoPagoMovilBs, montoPuntoVentaBs, montoDivisasUSD, tasaEfectiva, tasaDia, comisionPorcentaje]);

  // Guardar Cierre del Día (Hoy o Ayer) con try/catch/finally garantizado y timeout
  const handleGuardarCierre = async () => {
    if (guardando) return;

    if (!perfil.puesto_id) {
      setMensajeError('No tienes un puesto de venta asignado a tu cuenta.');
      return;
    }

    const efBs = parseFloat(montoEfectivoBs) || 0;
    const pmBs = parseFloat(montoPagoMovilBs) || 0;
    const ptBs = parseFloat(montoPuntoVentaBs) || 0;
    const divUSD = parseFloat(montoDivisasUSD) || 0;

    const totalVendido = efBs + pmBs + ptBs + divUSD;
    if (totalVendido <= 0) {
      setMensajeError('Ingresa al menos un monto de venta para guardar el cierre del día.');
      return;
    }

    setGuardando(true);
    setMensajeError(null);
    setMensajeExito(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const tasa = tasaEfectiva > 0 ? tasaEfectiva : (tasaDia > 0 ? tasaDia : 1);
      const token = getAccessTokenFromStorage() || supabaseAnonKey;

      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/guardar_cierre_diario`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          p_efectivo_bs: efBs,
          p_pago_movil_bs: pmBs,
          p_punto_bs: ptBs,
          p_divisas_usd: divUSD,
          p_gasto_bs: 0,
          p_gasto_desc: '',
          p_tasa: tasa,
          p_fecha: fechaSeleccionada,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errMsg = 'Error al guardar cierre';
        try {
          const errData = await res.json();
          errMsg = errData?.message || errData?.error_description || errMsg;
        } catch {
          const text = await res.text();
          if (text) errMsg = text;
        }
        throw new Error(errMsg);
      }

      setTieneCierreGuardado(true);
      const msgOk = `Cierre (${fechaSeleccionadaTexto}) guardado correctamente`;
      setToastMensaje(msgOk);
      setMensajeExito(msgOk);
      setTimeout(() => {
        setToastMensaje(null);
        setMensajeExito(null);
      }, 4000);

      // Recargar los datos del cierre y el estado de liquidaciones
      await cargarCierre(fechaSeleccionada);
      await cargarLiquidaciones();
    } catch (err: any) {
      console.error('Error al guardar cierre de caja:', err);
      if (err.name === 'AbortError') {
        setMensajeError('Tiempo de espera agotado al conectar con el servidor (8s).');
      } else {
        setMensajeError(err?.message || 'Error al guardar cierre');
      }
    } finally {
      clearTimeout(timeoutId);
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

  // Todas las liquidaciones registradas para la semana seleccionada
  const liquidacionesSemana = useMemo(() => {
    if (!perfil.puesto_id) return [];
    return liquidaciones.filter(
      (l) =>
        l.puesto_id === perfil.puesto_id &&
        l.semana_inicio === infoSemanaGanancias.semanaInicio &&
        l.pagado !== false
    );
  }, [liquidaciones, perfil.puesto_id, infoSemanaGanancias.semanaInicio]);

  // Sumatoria de montos pagados en USD y en Bs en la semana seleccionada
  const { yaPagadoSemanaUSD, yaPagadoSemanaBs, tasaCobroPromedio } = useMemo(() => {
    let usd = 0;
    let bs = 0;
    for (const l of liquidacionesSemana) {
      usd += Number(l.monto_comision_usd ?? l.monto_usd ?? 0);
      bs += Number((l as any).monto_pagado_bs ?? l.monto_bs ?? 0);
    }
    usd = Math.round(usd * 100) / 100;
    bs = Math.round(bs * 100) / 100;
    const tasa = usd > 0 && bs > 0 ? Math.round((bs / usd) * 100) / 100 : 0;
    return {
      yaPagadoSemanaUSD: usd,
      yaPagadoSemanaBs: bs,
      tasaCobroPromedio: tasa,
    };
  }, [liquidacionesSemana]);

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

      for (const m of movsDia) {
        if (m.tipo === 'venta' || m.tipo === 'ingreso') {
          const tasa = Number(m.tasa ?? m.tasa_aplicada ?? (tasaEfectiva > 0 ? tasaEfectiva : tasaDia)) || 1;
          const orig = Number(m.monto_original) || 0;
          if (m.moneda_original === 'USD' || m.moneda === 'USD') {
            totalVentaUSD += orig;
          } else {
            totalVentaUSD += tasa > 0 ? orig / tasa : 0;
          }
        }
      }

      const comisionUSD = Math.round(((totalVentaUSD * comisionPorcentaje) / 100) * 100) / 100;

      return {
        fechaStr: d.fechaStr,
        nombreDia: d.nombreDia,
        diaCorto: d.diaCorto,
        dateObj: d.dateObj,
        comisionUSD,
        movimientosCount: movsDia.length,
      };
    });
  }, [infoSemanaGanancias.dias, movimientosSemanaGanancias, tasaEfectiva, tasaDia, comisionPorcentaje]);

  const { comisionSemanaUSD, mejorDiaIndex } = useMemo(() => {
    let totalComision = 0;
    let maxComisionUSD = 0;
    let mejorIdx = -1;

    datos6DiasGanancias.forEach((d, idx) => {
      totalComision += d.comisionUSD;
      if (d.comisionUSD > maxComisionUSD) {
        maxComisionUSD = d.comisionUSD;
        mejorIdx = idx;
      }
    });

    return {
      comisionSemanaUSD: totalComision,
      mejorDiaIndex: maxComisionUSD > 0 ? mejorIdx : -1,
    };
  }, [datos6DiasGanancias]);

  // Saldo pendiente por cobrar en la semana
  const pendienteSemanaUSD = useMemo(() => {
    return Math.max(0, Number((comisionSemanaUSD - yaPagadoSemanaUSD).toFixed(2)));
  }, [comisionSemanaUSD, yaPagadoSemanaUSD]);

  // Día seleccionado en el gráfico interactivo de Mis Ganancias (0 a 5)
  const [diaGananciasIndex, setDiaGananciasIndex] = useState<number>(0);

  const diaDetalleTrading = datos6DiasGanancias[diaGananciasIndex] || datos6DiasGanancias[0];

  const variacionDiaAnterior = useMemo(() => {
    if (diaGananciasIndex === 0) return null;
    const diaPrev = datos6DiasGanancias[diaGananciasIndex - 1];
    const prevUSD = diaPrev?.comisionUSD || 0;
    const currUSD = diaDetalleTrading?.comisionUSD || 0;

    if (prevUSD === 0 && currUSD === 0) return 0;
    if (prevUSD === 0 && currUSD > 0) return 100;
    return ((currUSD - prevUSD) / prevUSD) * 100;
  }, [diaGananciasIndex, datos6DiasGanancias, diaDetalleTrading]);

  // Coordenadas SVG Trading (calculadas EXCLUSIVAMENTE con la ganancia/comisión del vendedor en $)
  const svgTradingCoords = useMemo(() => {
    const W = 500;
    const H = 180;
    const padL = 42;
    const padR = 20;
    const padT = 25;
    const padB = 35;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Eje Y basado exclusivamente en la ganancia del vendedor
    const maxVal = Math.max(...datos6DiasGanancias.map((d) => d.comisionUSD), 5) * 1.15;

    const points = datos6DiasGanancias.map((d, i) => {
      const x = padL + i * (plotW / 5);
      const y = padT + (1 - d.comisionUSD / maxVal) * plotH;
      return { x, y, val: d.comisionUSD, dia: d.diaCorto };
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
                Tasa: {formatNumber(tasaEfectiva > 0 ? tasaEfectiva : tasaDia)} Bs/$
              </span>
            </div>

            {/* SELECTOR SEGMENTADO DE FECHA: HOY VS AYER */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#52525B]">
                <Calendar size={15} className="text-[#2C474E]" />
                <span>Fecha del Cierre:</span>
              </div>
              <div className="flex items-center p-1 bg-zinc-100 rounded-lg border border-zinc-200">
                <button
                  type="button"
                  onClick={() => setDiaSeleccionado('hoy')}
                  className={`py-1 px-3 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    diaSeleccionado === 'hoy'
                      ? 'bg-[#2C474E] text-white shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60'
                  }`}
                >
                  Hoy ({labelHoy})
                </button>
                <button
                  type="button"
                  onClick={() => setDiaSeleccionado('ayer')}
                  className={`py-1 px-3 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    diaSeleccionado === 'ayer'
                      ? 'bg-[#2C474E] text-white shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60'
                  }`}
                >
                  Ayer ({labelAyer})
                </button>
              </div>
            </div>
          </div>

          {/* 4 CAMPOS NUMÉRICOS CLAROS DE VENTAS */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl p-4 shadow-xs space-y-3">
            <span className="block text-xs font-bold text-[#18181B] uppercase tracking-wide pb-1 border-b border-[#E4E4E7]">
              Ventas del Día ({fechaSeleccionadaTexto})
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
                    disabled={guardando}
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
                    disabled={guardando}
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
                    disabled={guardando}
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
                    disabled={guardando}
                    placeholder="0.00"
                    className="w-full p-2.5 text-sm font-mono font-bold border border-[#D4D4D8] rounded-md bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                    $
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* TARJETA DE RESUMEN EN VIVO */}
          <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-3.5 sm:p-4 shadow-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[11px] text-[#065F46] block font-semibold">
                  Total Vendido ({diaSeleccionado === 'hoy' ? 'Hoy' : 'Ayer'}) ($):
                </span>
                <div className="text-xl sm:text-2xl font-black tabular-nums text-[#065F46]">
                  {formatUSD(resumenCierre.totalVendidoUSD)}
                </div>
                <span className="text-[10px] text-[#047857]">
                  Tasa: {formatNumber(tasaEfectiva > 0 ? tasaEfectiva : tasaDia)} Bs/$
                </span>
              </div>

              <div className="sm:border-l sm:border-[#A7F3D0] sm:pl-3">
                <span className="text-[11px] text-[#065F46] block font-semibold">
                  Tu Comisión ({diaSeleccionado === 'hoy' ? 'del Día' : 'de Ayer'}) ({comisionPorcentaje}%):
                </span>
                <div className="text-lg sm:text-2xl font-black tabular-nums text-[#047857] font-mono">
                  ({formatUSD(resumenCierre.comisionUSD)})
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
                    {formatVES(resumenCierre.efectivoBsFisico)}
                  </span>
                </div>
                <div className="text-xs font-bold text-[#18181B] flex justify-between gap-1 mt-0.5">
                  <span>Divisas $:</span>
                  <span className="font-mono tabular-nums text-[#059669]">
                    {formatUSD(resumenCierre.divisasUSDFisico)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* AVISO VERDE SI YA HAY CIERRE GUARDADO */}
          {tieneCierreGuardado && (
            <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-xs text-[#065F46] flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#10B981] shrink-0" />
              <span className="font-semibold">
                ✓ Cierre guardado (podés modificar los montos si necesitás corregir algo)
              </span>
            </div>
          )}

          {/* BOTÓN GUARDAR / ACTUALIZAR CIERRE */}
          <button
            type="button"
            onClick={handleGuardarCierre}
            disabled={guardando}
            className="w-full min-h-[48px] px-4 py-2.5 text-xs sm:text-sm font-bold bg-[#2C474E] text-white rounded-xl hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {guardando ? (
              <>
                <Loader2 size={16} className="animate-spin text-white" />
                <span>{tieneCierreGuardado ? 'Actualizando Cierre...' : 'Guardando Cierre...'}</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={17} className="text-[#86EFAC]" />
                <span>
                  {tieneCierreGuardado ? `Actualizar Cierre (${fechaSeleccionadaTexto})` : `Guardar Cierre (${fechaSeleccionadaTexto})`}
                </span>
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
          {/* TARJETA OSCURA CON RESUMEN SEMANAL (EXCLUSIVAMENTE GANANCIAS) */}
          <div className="bg-gradient-to-br from-[#2C474E] to-[#1a2d32] text-white rounded-xl p-4 sm:p-5 shadow-sm border border-[#23393e]">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#86EFAC] animate-pulse" />
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-zinc-100">
                  {perfil.puesto?.nombre || 'Mi Puesto de Venta'}
                </span>
              </div>

              <span className="text-[11px] font-mono font-bold text-[#86EFAC] bg-white/10 px-2 py-0.5 rounded border border-white/10">
                Tasa: {formatNumber(tasaEfectiva > 0 ? tasaEfectiva : tasaDia)} Bs/$
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <span className="text-xs text-emerald-300/90 block mb-1 font-semibold flex items-center gap-1.5">
                  <Sparkles size={14} className="text-[#86EFAC]" />
                  Ganancia Generada ({comisionPorcentaje}%):
                </span>
                <div className="text-3xl sm:text-4xl font-black tabular-nums text-[#86EFAC] font-mono tracking-tight">
                  {formatUSD(comisionSemanaUSD)}
                </div>
                <div className="text-xs text-zinc-300 mt-1 flex items-center gap-2">
                  <span>{infoSemanaGanancias.rangoTexto}</span>
                  <span className="text-zinc-500">•</span>
                  <span>Lun - Sáb</span>
                </div>
              </div>

              <div className="sm:text-right">
                {pendienteSemanaUSD === 0 && comisionSemanaUSD > 0 ? (
                  <div className="flex flex-col items-start sm:items-end gap-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-[#166534] text-white border border-[#22c55e] shadow-xs">
                      <CheckCircle2 size={14} />
                      <span>Pagado al 100% ✓</span>
                    </span>
                    {yaPagadoSemanaBs > 0 && (
                      <span className="text-[11px] text-[#86EFAC] font-mono mt-0.5 font-semibold">
                        Ya Pagado: {formatUSD(yaPagadoSemanaUSD)} ({formatVES(yaPagadoSemanaBs)})
                      </span>
                    )}
                  </div>
                ) : yaPagadoSemanaUSD > 0 && pendienteSemanaUSD > 0 ? (
                  <div className="flex flex-col items-start sm:items-end gap-1.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[#166534] text-white border border-[#22c55e] shadow-xs">
                      <CheckCircle2 size={13} />
                      <span>Ya Pagado: {formatUSD(yaPagadoSemanaUSD)} ({formatVES(yaPagadoSemanaBs)})</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40">
                      <Clock size={12} />
                      <span>Pendiente: {formatUSD(pendienteSemanaUSD)}</span>
                    </span>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40">
                    <Clock size={14} />
                    <span>Pendiente: {formatUSD(comisionSemanaUSD)}</span>
                  </span>
                )}
              </div>
            </div>

            {/* HISTORIAL DE ABONOS / PAGOS DE LA SEMANA */}
            {liquidacionesSemana.length > 0 && (
              <div className="mt-3.5 pt-3 border-t border-white/10 space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-emerald-300/80 tracking-wider block">
                  Historial de Abonos / Pagos:
                </span>
                <div className="space-y-1">
                  {liquidacionesSemana.map((l, idx) => {
                    const fechaAbono = l.fecha_pago || (l as any).created_at?.slice(0, 10) || 'Fecha n/d';
                    const mBs = Number((l as any).monto_pagado_bs ?? l.monto_bs ?? 0);
                    const mUsd = Number(l.monto_comision_usd ?? l.monto_usd ?? 0);
                    const t = Number((l as any).tasa_pago ?? l.tasa ?? 0);
                    return (
                      <div
                        key={l.id || `liq-${idx}`}
                        className="text-[11px] bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-1 text-zinc-200"
                      >
                        <span className="font-semibold text-zinc-300">
                          {fechaAbono}: <span className="text-white font-mono font-bold">{formatUSD(mUsd)}</span>
                        </span>
                        <span className="text-[#86EFAC] font-mono font-bold">
                          {formatVES(mBs)} {t > 0 && <span className="text-zinc-400 text-[10px] font-normal font-sans">(Tasa BCV: {formatNumber(t)} Bs/$)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl sm:text-2xl font-black tabular-nums text-[#047857] font-mono">
                    {formatUSD(diaDetalleTrading.comisionUSD)}
                  </span>
                  <span className="text-[11px] font-semibold text-zinc-500">
                    Ganancia ({comisionPorcentaje}%)
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
              <span>Ganancias Diarias (Lun - Sáb)</span>
              <span>Ganancia ($)</span>
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
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#2C474E] text-white">
                          Hoy
                        </span>
                      )}
                      {esMejor && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                          ★ Mejor día
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 block font-mono">
                      {d.fechaStr}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-sm sm:text-base font-black font-mono text-[#047857] tabular-nums block">
                      {formatUSD(d.comisionUSD)}
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
