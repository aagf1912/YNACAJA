import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ClipboardPaste,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  DollarSign,
  TrendingUp,
  Percent,
  Clock,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Movimiento, PerfilUsuario, Puesto, METODOS_PAGO_LABELS } from '../types';
import { formatMontoMovimiento, formatNumber, formatUSD } from '../utils/format';
import { getVenezuelaDate, parseTextoLocal } from '../utils/parserLocal';
import { analizarTextoMovimientos } from '../services/api';
import { ModalMovimiento } from '../components/ModalMovimiento';
import { getVentasHoyPuesto, supabase } from '../services/supabase';
import { Clipboard as CapClipboard } from '@capacitor/clipboard';

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
  onActualizarMovimiento,
  onEliminarMovimiento,
}) => {
  const [texto, setTexto] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [modalManualAbierto, setModalManualAbierto] = useState(false);
  const [movimientoParaEditar, setMovimientoParaEditar] = useState<Movimiento | null>(null);

  const [ventasHoy, setVentasHoy] = useState<Movimiento[]>([]);
  const [cargandoVentas, setCargandoVentas] = useState<boolean>(false);

  const fechaHoyVzla = useMemo(() => getVenezuelaDate(), []);
  const comisionPorcentaje = perfil.puesto?.porcentaje_comision ?? 22.0;

  // Cargar ventas de hoy directamente desde Supabase
  const cargarVentasHoy = useCallback(async () => {
    if (!perfil.puesto_id) return;
    setCargandoVentas(true);
    try {
      const data = await getVentasHoyPuesto(perfil.puesto_id, fechaHoyVzla);
      if (data && data.length > 0) {
        setVentasHoy(data);
        return;
      }
      // Si Supabase devuelve lista vacía o falla, filtrar de props
      const filtrados = movimientos.filter((m) => {
        const esHoy = m.fecha === fechaHoyVzla;
        const esVenta = m.tipo === 'ingreso' || m.tipo === 'venta';
        const esMismoPuesto = !perfil.puesto_id || m.puesto_id === perfil.puesto_id;
        return esHoy && esVenta && esMismoPuesto;
      });
      setVentasHoy(filtrados);
    } catch (err) {
      console.warn('Error al cargar ventas hoy desde Supabase:', err);
    } finally {
      setCargandoVentas(false);
    }
  }, [perfil.puesto_id, fechaHoyVzla, movimientos]);

  useEffect(() => {
    cargarVentasHoy();
  }, [cargarVentasHoy]);

  // Si cambian los movimientos desde el padre (App.tsx), sincronizar
  useEffect(() => {
    if (movimientos && movimientos.length > 0) {
      const filtrados = movimientos.filter((m) => {
        const esHoy = m.fecha === fechaHoyVzla;
        const esVenta = m.tipo === 'ingreso' || m.tipo === 'venta';
        const esMismoPuesto = !perfil.puesto_id || m.puesto_id === perfil.puesto_id;
        return esHoy && esVenta && esMismoPuesto;
      });
      setVentasHoy(filtrados);
    }
  }, [movimientos, fechaHoyVzla, perfil.puesto_id]);

  // Suscripción en tiempo real a Supabase para este puesto
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
          table: 'movimientos',
          filter: `puesto_id=eq.${perfil.puesto_id}`,
        },
        () => {
          cargarVentasHoy();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [perfil.puesto_id, cargarVentasHoy]);

  // Filtrar ventas de HOY para este puesto específico
  const ventasHoyPuesto = useMemo(() => {
    return ventasHoy.filter((m) => {
      const esHoy = m.fecha === fechaHoyVzla;
      const esVenta = m.tipo === 'ingreso' || m.tipo === 'venta';
      const esMismoPuesto = !perfil.puesto_id || m.puesto_id === perfil.puesto_id;
      return esHoy && esVenta && esMismoPuesto;
    });
  }, [ventasHoy, fechaHoyVzla, perfil.puesto_id]);

  // Total vendido hoy en USD y ganancia de comisión (22%)
  const { totalVendidoHoyUSD, comisionHoyUSD } = useMemo(() => {
    let totalUSD = 0;
    for (const v of ventasHoyPuesto) {
      if (v.moneda_original === 'USD') {
        totalUSD += Number(v.monto_original);
      } else {
        const tasa = Number(v.tasa_aplicada) || Number(tasaDia) || 100;
        totalUSD += Number(v.monto_original) / tasa;
      }
    }
    const comision = (totalUSD * comisionPorcentaje) / 100;
    return {
      totalVendidoHoyUSD: totalUSD,
      comisionHoyUSD: comision,
    };
  }, [ventasHoyPuesto, tasaDia, comisionPorcentaje]);

  // Vista previa instantánea mientras el vendedor escribe o pega texto
  const previewNota = useMemo(() => {
    if (!texto.trim()) return null;
    try {
      const items = parseTextoLocal(texto, fechaHoyVzla, 'vendedor');
      if (items.length === 0) return null;

      let totalNotaUSD = 0;
      for (const item of items) {
        if (item.moneda_original === 'USD') {
          totalNotaUSD += item.monto_original;
        } else {
          const tasa = Number(tasaDia) || 100;
          totalNotaUSD += item.monto_original / tasa;
        }
      }
      const comisionNotaUSD = (totalNotaUSD * comisionPorcentaje) / 100;

      return {
        count: items.length,
        totalUSD: totalNotaUSD,
        comisionUSD: comisionNotaUSD,
        items,
      };
    } catch {
      return null;
    }
  }, [texto, fechaHoyVzla, tasaDia, comisionPorcentaje]);

  const handlePegar = async () => {
    try {
      const result = await CapClipboard.read();
      if (result && result.value) {
        setTexto((prev) => (prev ? `${prev}\n${result.value}` : result.value));
        return;
      }
    } catch {
      // Fallback
    }

    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setTexto((prev) => (prev ? `${prev}\n${text}` : text));
        }
      }
    } catch (e) {
      console.warn('Error leyendo portapapeles:', e);
    }
  };

  const handleProcesar = async () => {
    if (!texto.trim()) {
      setMensajeError('Escribe o pega los montos vendidos antes de procesar.');
      return;
    }

    setProcesando(true);
    setMensajeError(null);
    setMensajeExito(null);

    try {
      // 1. Intentar primero con el parser local
      let extraidos = parseTextoLocal(texto, fechaHoyVzla, 'vendedor');

      // 2. Si el parser local no extrae nada, intentar con el backend API (que tiene Gemini como respaldo)
      if (extraidos.length === 0) {
        extraidos = await analizarTextoMovimientos(texto, fechaHoyVzla, 'vendedor');
      }

      if (extraidos.length === 0) {
        setMensajeError('No se encontraron montos de venta válidos en el texto.');
        setProcesando(false);
        return;
      }

      // Preparar para guardar forzando tipo ingreso, puesto_id, user_id y montos
      const aGuardar: Omit<Movimiento, 'id' | 'created_at'>[] = extraidos.map((m) => {
        const tasa = Number(tasaDia) || Number((m as any).tasa_aplicada) || 100;
        const montoNum = Number(m.monto_original) || 0;
        const monto_usd = m.moneda_original === 'USD' ? montoNum : (tasa > 0 ? montoNum / tasa : 0);
        const monto_bs = m.moneda_original === 'USD' ? montoNum * tasa : montoNum;

        return {
          fecha: m.fecha || fechaHoyVzla,
          descripcion: m.descripcion || 'Venta',
          tipo: 'ingreso' as const,
          naturaleza: 'Negocio' as const,
          categoria: 'Ventas' as const,
          metodo_pago: m.metodo_pago,
          moneda_original: m.moneda_original,
          monto_original: m.monto_original,
          tasa_aplicada: tasa,
          tasa: tasa,
          monto_bs: Math.round(monto_bs * 100) / 100,
          monto_usd: Math.round(monto_usd * 100) / 100,
          puesto_id: perfil.puesto_id,
          creado_por: perfil.id,
          user_id: perfil.id,
        };
      });

      const guardados = await onGuardarMovimientos(aGuardar);
      setTexto('');
      await cargarVentasHoy();
      setMensajeExito(`¡Excelente! Se registraron ${guardados.length} ventas correctamente.`);
      setTimeout(() => setMensajeExito(null), 5000);
    } catch (err: any) {
      setMensajeError(err?.message || 'Error al procesar las ventas.');
    } finally {
      setProcesando(false);
    }
  };

  const handleGuardarManual = async (
    mov: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }
  ) => {
    const tasa = Number(tasaDia) || Number(mov.tasa_aplicada) || 100;
    const montoNum = Number(mov.monto_original) || 0;
    const monto_usd = mov.moneda_original === 'USD' ? montoNum : (tasa > 0 ? montoNum / tasa : 0);
    const monto_bs = mov.moneda_original === 'USD' ? montoNum * tasa : montoNum;

    const movConPuesto = {
      ...mov,
      fecha: mov.fecha || fechaHoyVzla,
      tipo: 'ingreso' as const,
      categoria: 'Ventas' as const,
      naturaleza: 'Negocio' as const,
      tasa_aplicada: tasa,
      tasa: tasa,
      monto_bs: Math.round(monto_bs * 100) / 100,
      monto_usd: Math.round(monto_usd * 100) / 100,
      puesto_id: perfil.puesto_id,
      creado_por: perfil.id,
      user_id: perfil.id,
    };

    if (mov.id) {
      await onActualizarMovimiento(movConPuesto as Movimiento);
    } else {
      await onGuardarMovimientos([movConPuesto]);
    }
    await cargarVentasHoy();
  };

  const handleEliminarVenta = async (id: string) => {
    if (window.confirm('¿Deseas eliminar este registro de venta?')) {
      await onEliminarMovimiento(id);
      await cargarVentasHoy();
    }
  };

  return (
    <div className="space-y-4 pb-20 pt-2 px-3 sm:px-4 max-w-2xl mx-auto">
      {/* 1. TARJETA DESTACADA: RESUMEN DE HOY Y COMISIÓN 22% */}
      <div className="bg-gradient-to-br from-[#2C474E] to-[#1a2d32] text-white rounded-xl p-4 sm:p-5 shadow-sm border border-[#23393e]">
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#86EFAC] animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              {perfil.puesto?.nombre || 'Mi Puesto de Venta'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-[#86EFAC] bg-white/10 px-2 py-0.5 rounded">
            Tasa: {formatNumber(tasaDia)} Bs/$
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <span className="text-[11px] text-zinc-300 block mb-0.5">
              Total vendido hoy:
            </span>
            <div className="text-xl sm:text-2xl font-black tabular-nums text-white">
              {formatUSD(totalVendidoHoyUSD)}
            </div>
            <span className="text-[10px] text-zinc-300">
              {ventasHoyPuesto.length} {ventasHoyPuesto.length === 1 ? 'venta registrada' : 'ventas registradas'}
            </span>
          </div>

          <div className="bg-[#86EFAC]/15 border border-[#86EFAC]/30 rounded-lg p-2.5 text-right">
            <span className="text-[11px] font-bold text-[#86EFAC] block mb-0.5">
              Tu ganancia hoy ({comisionPorcentaje}%):
            </span>
            <div className="text-lg sm:text-2xl font-black tabular-nums text-[#86EFAC] font-mono">
              ({formatUSD(comisionHoyUSD)})
            </div>
          </div>
        </div>
      </div>

      {/* 2. ENTRADA RÁPIDA DE VENTAS */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-3.5 sm:p-4 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="input-ventas-vendedor" className="text-xs font-bold text-[#18181B]">
            Cargar ventas del día (Efectivo, Pago Móvil, Punto, Divisas)
          </label>
          <button
            type="button"
            onClick={() => {
              setMovimientoParaEditar(null);
              setModalManualAbierto(true);
            }}
            className="flex items-center gap-1 text-[11px] font-bold text-[#2C474E] bg-zinc-100 hover:bg-zinc-200 px-2 py-1 rounded transition-colors"
          >
            <Plus size={13} />
            <span>Carga manual</span>
          </button>
        </div>

        <textarea
          id="input-ventas-vendedor"
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={procesando}
          placeholder={`Ejemplo:\nefectivo: 10950, Pmovil: 52646, Punto: 12000, 15$ divisa`}
          className="w-full p-3 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] placeholder:text-zinc-400 font-mono resize-y"
        />

        {/* VISTA PREVIA INSTANTÁNEA MIENTRAS ESCRIBE */}
        {previewNota && (
          <div className="mt-2.5 p-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-[#065F46] font-semibold">
              <TrendingUp size={15} className="text-[#10B981] shrink-0" />
              <span>
                Nota: <strong className="tabular-nums font-bold">{formatUSD(previewNota.totalUSD)}</strong> ({previewNota.count} ventas)
              </span>
            </div>
            <div className="text-right text-[#065F46] font-bold font-mono">
              Comisión ({comisionPorcentaje}%):{' '}
              <span className="text-[#047857] text-sm underline decoration-2">
                ({formatUSD(previewNota.comisionUSD)})
              </span>
            </div>
          </div>
        )}

        {/* Botones de Acción */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handlePegar}
            disabled={procesando}
            className="min-h-[44px] px-3.5 py-2 text-xs font-bold border border-[#E4E4E7] bg-white text-[#18181B] rounded-lg hover:bg-zinc-50 active:bg-zinc-100 flex items-center justify-center gap-1.5 transition-colors"
          >
            <ClipboardPaste size={16} className="text-[#52525B]" />
            <span>Pegar</span>
          </button>

          <button
            type="button"
            onClick={handleProcesar}
            disabled={procesando || !texto.trim()}
            className="flex-1 min-h-[44px] px-4 py-2 text-xs sm:text-sm font-bold bg-[#2C474E] text-white rounded-lg hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 size={16} className="animate-spin text-white" />
                <span>Guardando ventas...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} className="text-[#86EFAC]" />
                <span>Procesar y Guardar</span>
              </>
            )}
          </button>
        </div>

        {mensajeError && (
          <div className="mt-3 p-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#991B1B] flex items-start gap-2">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            <span>{mensajeError}</span>
          </div>
        )}

        {mensajeExito && (
          <div className="mt-3 p-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg text-xs text-[#065F46] flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0 text-[#10B981]" />
            <span className="font-semibold">{mensajeExito}</span>
          </div>
        )}
      </div>

      {/* 3. LISTADO DE VENTAS CARGADAS HOY EN ESTE PUESTO */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-xs">
        <div className="bg-[#FAFAFA] border-b border-[#E4E4E7] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-[#52525B]" />
            <span className="font-bold text-xs text-[#18181B] uppercase tracking-wider">
              Ventas de Hoy ({ventasHoyPuesto.length})
            </span>
          </div>
          <span className="text-xs font-bold text-[#166534] tabular-nums font-mono">
            Total: {formatUSD(totalVendidoHoyUSD)}
          </span>
        </div>

        {ventasHoyPuesto.length === 0 ? (
          <div className="p-6 text-center text-[#71717A] text-xs">
            Aún no has registrado ventas hoy en este puesto. Pega el reporte arriba o presiona "+ Carga manual".
          </div>
        ) : (
          <div className="divide-y divide-[#E4E4E7]">
            {ventasHoyPuesto.map((item) => (
              <div
                key={item.id}
                className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-bold text-[#18181B]">
                      {item.descripcion}
                    </span>
                    <span className="text-[10px] text-[#52525B] bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                      {METODOS_PAGO_LABELS[item.metodo_pago]}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#71717A]">
                    {item.fecha}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className="text-xs sm:text-sm font-bold text-[#166534] tabular-nums block">
                      +{formatMontoMovimiento(item)}
                    </span>
                    {item.moneda_original === 'VES' && (
                      <span className="text-[10px] text-zinc-400 block tabular-nums">
                        ≈ {formatUSD(Number(item.monto_original) / (Number(item.tasa_aplicada) || Number(tasaDia) || 100))}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 border-l border-[#E4E4E7] pl-1.5 ml-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMovimientoParaEditar(item);
                        setModalManualAbierto(true);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-[#2C474E] rounded"
                      title="Editar venta"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminarVenta(item.id)}
                      className="p-1.5 text-zinc-500 hover:text-red-700 rounded"
                      title="Eliminar venta"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal para carga o edición manual */}
      <ModalMovimiento
        isOpen={modalManualAbierto}
        movimientoAEditar={movimientoParaEditar}
        tasaActual={tasaDia}
        soloVenta={true}
        onClose={() => {
          setModalManualAbierto(false);
          setMovimientoParaEditar(null);
        }}
        onGuardar={handleGuardarManual}
      />
    </div>
  );
};
