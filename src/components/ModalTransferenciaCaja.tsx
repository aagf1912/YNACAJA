import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Loader2,
  ArrowLeftRight,
  Trash2,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { BolsilloCaja, BOLSILLOS_LABELS, TransferenciaCaja } from '../types';
import { formatNumber } from '../utils/format';
import { getVenezuelaDate } from '../utils/parserLocal';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tasaBcv: number;
  transferencias: TransferenciaCaja[];
  onActualizarDatos: () => Promise<void>;
}

export const ModalTransferenciaCaja: React.FC<Props> = ({
  isOpen,
  onClose,
  tasaBcv,
  transferencias = [],
  onActualizarDatos,
}) => {
  const [origen, setOrigen] = useState<BolsilloCaja>('divisas_usd');
  const [destino, setDestino] = useState<BolsilloCaja>('digital_bs');
  const [fecha, setFecha] = useState<string>(getVenezuelaDate());
  const [montoOrigen, setMontoOrigen] = useState<string>('');
  const [tasaCambio, setTasaCambio] = useState<string>(String(tasaBcv > 0 ? tasaBcv : 100));
  const [montoDestino, setMontoDestino] = useState<string>('');
  const [concepto, setConcepto] = useState<string>('');

  const [guardando, setGuardando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mostrarHistorial, setMostrarHistorial] = useState(true);

  // Determinar si hay cambio de moneda (un bolsillo es Divisas y el otro es Bs)
  const esCambioMoneda =
    (origen === 'divisas_usd' && destino !== 'divisas_usd') ||
    (origen !== 'divisas_usd' && destino === 'divisas_usd');

  // Precargar tasa y calcular monto recibido al abrir o cambiar
  useEffect(() => {
    if (isOpen) {
      setFecha(getVenezuelaDate());
      setTasaCambio(String(tasaBcv > 0 ? tasaBcv : 100));
      setError(null);
    }
  }, [isOpen, tasaBcv]);

  // Recalcular montoDestino automáticamente cuando cambia montoOrigen o tasaCambio
  const handleMontoOrigenChange = (val: string) => {
    setMontoOrigen(val);
    const mNum = parseFloat(val.replace(',', '.')) || 0;
    const tNum = parseFloat(tasaCambio.replace(',', '.')) || (tasaBcv > 0 ? tasaBcv : 100);

    if (origen === 'divisas_usd' && destino !== 'divisas_usd') {
      // De USD a Bs: multiplicar por tasa
      const calc = Math.round(mNum * tNum * 100) / 100;
      setMontoDestino(calc > 0 ? String(calc) : '');
    } else if (origen !== 'divisas_usd' && destino === 'divisas_usd') {
      // De Bs a USD: dividir entre tasa
      const calc = tNum > 0 ? Math.round((mNum / tNum) * 100) / 100 : 0;
      setMontoDestino(calc > 0 ? String(calc) : '');
    } else {
      // Misma moneda (ej. Efectivo Bs a Digital Bs): mismo monto
      setMontoDestino(mNum > 0 ? String(mNum) : '');
    }
  };

  const handleTasaChange = (val: string) => {
    setTasaCambio(val);
    const mNum = parseFloat(montoOrigen.replace(',', '.')) || 0;
    const tNum = parseFloat(val.replace(',', '.')) || 0;

    if (origen === 'divisas_usd' && destino !== 'divisas_usd') {
      const calc = Math.round(mNum * tNum * 100) / 100;
      setMontoDestino(calc > 0 ? String(calc) : '');
    } else if (origen !== 'divisas_usd' && destino === 'divisas_usd') {
      const calc = tNum > 0 ? Math.round((mNum / tNum) * 100) / 100 : 0;
      setMontoDestino(calc > 0 ? String(calc) : '');
    }
  };

  // Cuando cambia el origen o destino, asegurar que no sean el mismo
  const handleOrigenChange = (nuevoOrigen: BolsilloCaja) => {
    setOrigen(nuevoOrigen);
    if (nuevoOrigen === destino) {
      const opciones: BolsilloCaja[] = ['digital_bs', 'efectivo_bs', 'divisas_usd'];
      const otro = opciones.find((o) => o !== nuevoOrigen) || 'digital_bs';
      setDestino(otro);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mOrig = parseFloat(montoOrigen.replace(',', '.'));
    const mDest = parseFloat(montoDestino.replace(',', '.'));
    const tasa = parseFloat(tasaCambio.replace(',', '.')) || 1;

    if (isNaN(mOrig) || mOrig <= 0) {
      setError('Introduce un monto de salida válido mayor a 0.');
      return;
    }
    if (isNaN(mDest) || mDest <= 0) {
      setError('El monto recibido debe ser mayor a 0.');
      return;
    }
    if (origen === destino) {
      setError('El bolsillo de origen y destino no pueden ser el mismo.');
      return;
    }

    setGuardando(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const headers = {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      };

      const desc =
        concepto.trim() ||
        (esCambioMoneda
          ? `Cambio de ${BOLSILLOS_LABELS[origen]} a ${BOLSILLOS_LABELS[destino]}`
          : `Traspaso de ${BOLSILLOS_LABELS[origen]} a ${BOLSILLOS_LABELS[destino]}`);

      // 1. Intentar llamar a la función RPC registrar_transferencia_caja
      let guardadoOk = false;
      try {
        const resRpc = await fetch(`${supabaseUrl}/rest/v1/rpc/registrar_transferencia_caja`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_origen: origen,
            p_destino: destino,
            p_monto_origen: mOrig,
            p_monto_destino: mDest,
            p_tasa: tasa,
            p_fecha: fecha,
            p_descripcion: desc,
            p_concepto: desc,
            origen,
            destino,
            monto_origen: mOrig,
            monto_destino: mDest,
            monto: mOrig,
            tasa,
            fecha,
            descripcion: desc,
          }),
          signal: controller.signal,
        });

        if (resRpc.ok) {
          guardadoOk = true;
        }
      } catch (errRpc) {
        console.warn('RPC registrar_transferencia_caja falló, intentando insert directo:', errRpc);
      }

      // 2. Si no fue por RPC, insertar directamente en transferencias_caja
      if (!guardadoOk) {
        const resDirect = await fetch(`${supabaseUrl}/rest/v1/transferencias_caja`, {
          method: 'POST',
          headers: {
            ...headers,
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            fecha,
            origen,
            destino,
            monto_origen: mOrig,
            monto_destino: mDest,
            monto: mOrig,
            tasa,
            descripcion: desc,
            concepto: desc,
          }),
          signal: controller.signal,
        });

        if (!resDirect.ok) {
          let errMsg = 'Error al registrar la transferencia';
          try {
            const errData = await resDirect.json();
            errMsg = errData?.message || errMsg;
          } catch {
            const t = await resDirect.text();
            if (t) errMsg = t;
          }
          throw new Error(errMsg);
        }
      }

      clearTimeout(timeoutId);
      // Limpiar formulario y refrescar datos globales
      setMontoOrigen('');
      setMontoDestino('');
      setConcepto('');
      await onActualizarDatos();
    } catch (err: any) {
      console.error('Error registrando transferencia:', err);
      setError(err?.message || 'Error al registrar el movimiento.');
    } finally {
      clearTimeout(timeoutId);
      setGuardando(false);
    }
  };

  const handleEliminarTransferencia = async (id: string) => {
    if (!window.confirm('¿Deseas eliminar este movimiento de caja? Se revertirán los saldos.')) {
      return;
    }

    setEliminandoId(id);
    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const res = await fetch(`${supabaseUrl}/rest/v1/transferencias_caja?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('No se pudo eliminar el movimiento de caja.');
      }

      await onActualizarDatos();
    } catch (err: any) {
      alert(err?.message || 'Error al eliminar');
    } finally {
      setEliminandoId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden border border-[#E4E4E7] flex flex-col">
        {/* Header */}
        <div className="bg-[#2C474E] text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={17} className="text-[#86EFAC]" />
            <span className="font-bold text-sm">Mover Dinero / Cambio de Moneda</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-300 hover:text-white hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Formulario */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Fila: De Bolsillo -> A Bolsillo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Origen */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">
                  Sale de (Origen):
                </label>
                <select
                  value={origen}
                  onChange={(e) => handleOrigenChange(e.target.value as BolsilloCaja)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                >
                  <option value="digital_bs">Digital / Banco (Bs)</option>
                  <option value="efectivo_bs">Efectivo (Bs)</option>
                  <option value="divisas_usd">Divisas ($ USD)</option>
                </select>
              </div>

              {/* Destino */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">
                  Entra a (Destino):
                </label>
                <select
                  value={destino}
                  onChange={(e) => setDestino(e.target.value as BolsilloCaja)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                >
                  <option value="digital_bs" disabled={origen === 'digital_bs'}>
                    Digital / Banco (Bs)
                  </option>
                  <option value="efectivo_bs" disabled={origen === 'efectivo_bs'}>
                    Efectivo (Bs)
                  </option>
                  <option value="divisas_usd" disabled={origen === 'divisas_usd'}>
                    Divisas ($ USD)
                  </option>
                </select>
              </div>
            </div>

            {/* Fecha */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Fecha:</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
              />
            </div>

            {/* Monto Origen */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Monto que Sale ({origen === 'divisas_usd' ? '$ USD' : 'Bs'}):
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                  {origen === 'divisas_usd' ? '$' : 'Bs.'}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={montoOrigen}
                  onChange={(e) => handleMontoOrigenChange(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full pl-10 pr-3 py-2 text-sm font-bold border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
                />
              </div>
            </div>

            {/* Fila: Tasa y Monto Destino si hay cambio de moneda */}
            {esCambioMoneda ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-amber-50/50 border border-amber-200/80 rounded-xl">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-amber-950">Tasa de Cambio:</label>
                    <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded font-semibold">
                      BCV: {formatNumber(tasaBcv)} Bs
                    </span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tasaCambio}
                    onChange={(e) => handleTasaChange(e.target.value)}
                    placeholder={String(tasaBcv)}
                    className="w-full px-3 py-2 text-sm font-bold border border-amber-300 rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
                  />
                  <p className="text-[10px] text-amber-800 mt-0.5">Editable si negociaste otra tasa</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-amber-950 mb-1">
                    Monto Recibido ({destino === 'divisas_usd' ? '$ USD' : 'Bs'}):
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={montoDestino}
                    onChange={(e) => setMontoDestino(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3 py-2 text-sm font-bold border border-amber-300 rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
                  />
                  <p className="text-[10px] text-amber-800 mt-0.5">Calculado automáticamente</p>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Monto Recibido ({destino === 'divisas_usd' ? '$ USD' : 'Bs'}):
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={montoDestino}
                  onChange={(e) => setMontoDestino(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full px-3 py-2 text-sm font-bold border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
                />
              </div>
            )}

            {/* Concepto / Nota */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">
                Concepto / Motivo (opcional):
              </label>
              <input
                type="text"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Ej: Cambio de $ en efectivo por Bs para pagar nómina"
                className="w-full px-3 py-2 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
              />
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={guardando}
              className="w-full min-h-[42px] px-4 py-2 text-xs sm:text-sm font-bold text-white bg-[#2C474E] hover:bg-[#23393e] active:bg-[#1a2b2f] rounded-lg flex items-center justify-center gap-2 shadow-xs transition-colors disabled:opacity-60"
            >
              {guardando ? (
                <>
                  <Loader2 size={16} className="animate-spin text-white" />
                  <span>Registrando movimiento...</span>
                </>
              ) : (
                <>
                  <Check size={16} />
                  <span>Registrar Movimiento de Caja</span>
                </>
              )}
            </button>
          </form>

          {/* Historial de Transferencias */}
          <div className="pt-3 border-t border-zinc-200">
            <button
              type="button"
              onClick={() => setMostrarHistorial((prev) => !prev)}
              className="w-full flex items-center justify-between text-xs font-bold text-zinc-700 py-1"
            >
              <span className="flex items-center gap-1.5">
                <History size={14} className="text-[#2C474E]" />
                Historial de Transferencias ({transferencias.length})
              </span>
              {mostrarHistorial ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {mostrarHistorial && (
              <div className="mt-2 divide-y divide-zinc-100 max-h-52 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/50">
                {transferencias.length === 0 ? (
                  <p className="p-3 text-xs text-zinc-400 text-center italic">
                    No hay transferencias registradas todavía.
                  </p>
                ) : (
                  transferencias.map((t) => {
                    const mOrig = Number(t.monto_origen ?? t.monto_salida ?? t.monto ?? 0);
                    const mDest = Number(t.monto_destino ?? t.monto_recibido ?? t.monto ?? 0);
                    const esUSDOrigen = t.origen === 'divisas_usd';
                    const esUSDDestino = t.destino === 'divisas_usd';

                    return (
                      <div
                        key={t.id}
                        className="p-2.5 flex items-center justify-between gap-2 hover:bg-white text-xs transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-bold text-zinc-800">
                            <span>{BOLSILLOS_LABELS[t.origen] || t.origen}</span>
                            <span className="text-zinc-400">→</span>
                            <span className="text-[#166534]">
                              {BOLSILLOS_LABELS[t.destino] || t.destino}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                            <span className="tabular-nums font-medium">{t.fecha}</span>
                            <span>•</span>
                            <span className="tabular-nums">
                              Salió:{' '}
                              <strong>
                                {esUSDOrigen ? `$${formatNumber(mOrig)}` : `Bs. ${formatNumber(mOrig)}`}
                              </strong>
                              {' | '}
                              Entró:{' '}
                              <strong className="text-[#166534]">
                                {esUSDDestino ? `$${formatNumber(mDest)}` : `Bs. ${formatNumber(mDest)}`}
                              </strong>
                            </span>
                            {Number(t.tasa) > 1 && (
                              <>
                                <span>•</span>
                                <span className="tabular-nums">Tasa: {formatNumber(Number(t.tasa))}</span>
                              </>
                            )}
                          </div>
                          {(t.descripcion || t.concepto) && (
                            <p className="text-[11px] text-zinc-400 italic truncate mt-0.5">
                              {t.descripcion || t.concepto}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleEliminarTransferencia(t.id)}
                          disabled={eliminandoId === t.id}
                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors shrink-0"
                          title="Eliminar este movimiento"
                        >
                          {eliminandoId === t.id ? (
                            <Loader2 size={14} className="animate-spin text-red-600" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
