import React, { useState } from 'react';
import { ClipboardPaste, Plus, Pencil, Trash2, CheckCircle2, AlertCircle, Loader2, Store } from 'lucide-react';
import { Movimiento, Puesto } from '../types';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { formatMontoMovimiento, formatNumber } from '../utils/format';
import { METODOS_PAGO_LABELS } from '../types';
import { ModalMovimiento } from '../components/ModalMovimiento';
import { analizarTextoMovimientos } from '../services/api';
import { parseTextoLocal, getVenezuelaDate } from '../utils/parserLocal';
import { Clipboard as CapClipboard } from '@capacitor/clipboard';

interface Props {
  tasaDia: number;
  puestos?: Puesto[];
  onGuardarMovimientos: (movs: Omit<Movimiento, 'id' | 'created_at'>[]) => Promise<Movimiento[]>;
  onActualizarMovimiento: (mov: Movimiento) => Promise<void>;
  onEliminarMovimiento: (id: string) => Promise<void>;
}

export const RegistrarView: React.FC<Props> = ({
  tasaDia,
  puestos = [],
  onGuardarMovimientos,
  onActualizarMovimiento,
  onEliminarMovimiento,
}) => {
  const [texto, setTexto] = useState('');
  const [puestoSeleccionado, setPuestoSeleccionado] = useState<string>('');
  const [procesando, setProcesando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [ultimoLote, setUltimoLote] = useState<Movimiento[]>([]);
  const [modalManualAbierto, setModalManualAbierto] = useState(false);
  const [movimientoParaEditar, setMovimientoParaEditar] = useState<Movimiento | null>(null);

  const handlePegar = async () => {
    try {
      const result = await CapClipboard.read();
      if (result && result.value) {
        setTexto((prev) => (prev ? `${prev}\n${result.value}` : result.value));
        return;
      }
    } catch {
      // Fallback a API nativa del navegador
    }

    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setTexto((prev) => (prev ? `${prev}\n${text}` : text));
        }
      }
    } catch (e) {
      console.warn('Error accediendo al portapapeles:', e);
    }
  };

  const handleProcesar = async () => {
    if (!texto.trim()) {
      setMensajeError('Por favor escribe o pega el texto con los movimientos diarios.');
      return;
    }

    setProcesando(true);
    setMensajeError(null);

    try {
      const fechaActual = getVenezuelaDate();

      // 1. Intentar primero con el parser local ultrarrápido
      let movimientosExtraidos = parseTextoLocal(texto, fechaActual, 'admin');

      // 2. Si no encuentra nada, consultar el backend API (respaldo Gemini)
      if (movimientosExtraidos.length === 0) {
        movimientosExtraidos = await analizarTextoMovimientos(texto, fechaActual, 'admin');
      }

      if (movimientosExtraidos.length === 0) {
        setMensajeError('No se identificaron movimientos válidos en el texto ingresado.');
        setProcesando(false);
        return;
      }

      // Preparar para guardar, asignando la tasa_dia actual y el puesto seleccionado si aplica
      const aGuardar = movimientosExtraidos.map((m) => ({
        fecha: m.fecha || fechaActual,
        descripcion: m.descripcion,
        tipo: m.tipo,
        naturaleza: m.naturaleza,
        categoria: m.categoria,
        metodo_pago: m.metodo_pago,
        moneda_original: m.moneda_original,
        monto_original: m.monto_original,
        tasa_aplicada: tasaDia,
        puesto_id: puestoSeleccionado || null,
      }));

      const guardados = await onGuardarMovimientos(aGuardar);
      setUltimoLote(guardados);
      setTexto('');
    } catch (err: any) {
      setMensajeError(err?.message || 'Error al procesar y guardar la nota.');
    } finally {
      setProcesando(false);
    }
  };

  const handleGuardarManual = async (mov: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => {
    if (mov.id) {
      await onActualizarMovimiento(mov as Movimiento);
      setUltimoLote((prev) => prev.map((item) => (item.id === mov.id ? (mov as Movimiento) : item)));
    } else {
      const guardados = await onGuardarMovimientos([mov]);
      setUltimoLote(guardados);
    }
  };

  const handleEliminarItemLote = async (id: string) => {
    if (window.confirm('¿Deseas eliminar este registro?')) {
      await onEliminarMovimiento(id);
      setUltimoLote((prev) => prev.filter((item) => item.id !== id));
    }
  };

  return (
    <div className="space-y-4 pb-20 pt-2 px-3 sm:px-4 max-w-4xl mx-auto">
      {/* Barra superior de acción rápida */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-[#18181B] tracking-tight">
            Registro Diario Rápido
          </h1>
          <p className="text-xs text-[#52525B]">
            Pega el reporte de ventas y gastos de WhatsApp
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMovimientoParaEditar(null);
            setModalManualAbierto(true);
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#2C474E] bg-white border border-[#E4E4E7] rounded hover:bg-zinc-50 active:bg-zinc-100 min-h-[36px]"
        >
          <Plus size={14} />
          <span>+ Carga manual rápida</span>
        </button>
      </div>

      {/* Tarjeta de Entrada de Texto */}
      <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 sm:p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <label htmlFor="input-nota" className="block text-xs font-semibold text-[#52525B]">
            Pegar texto de ventas y gastos (uno o varios días)
          </label>

          {/* Selector opcional de Puesto */}
          {puestos.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Store size={13} className="text-[#52525B]" />
              <select
                value={puestoSeleccionado}
                onChange={(e) => setPuestoSeleccionado(e.target.value)}
                className="text-xs px-2 py-1 border border-[#E4E4E7] rounded bg-[#FAFAFA] text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E]"
              >
                <option value="">Sin puesto específico (General)</option>
                {puestos.filter((p) => p.activo).map((p) => (
                  <option key={p.id} value={p.id}>
                    Asignar a: {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <textarea
          id="input-nota"
          rows={6}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={procesando}
          placeholder={`Ejemplo:\nMartes 18: 45000 pago movil, 12000 punto, 15$ divisa. 8000 de hielo, 15000 leche, 12000 cashea y 6500 una hamburguesa para mi`}
          className="w-full p-3 text-xs sm:text-sm border border-[#E4E4E7] rounded bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] placeholder:text-zinc-400 font-mono resize-y"
        />

        {/* Fila de Acciones debajo del Textarea */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handlePegar}
            disabled={procesando}
            className="min-h-[44px] px-4 py-2 text-xs font-semibold border border-[#E4E4E7] bg-white text-[#18181B] rounded hover:bg-zinc-50 active:bg-zinc-100 flex items-center justify-center gap-1.5 transition-colors"
          >
            <ClipboardPaste size={16} className="text-[#52525B]" />
            Pegar
          </button>

          <button
            type="button"
            onClick={handleProcesar}
            disabled={procesando}
            className="flex-1 min-h-[44px] px-4 py-2 text-xs sm:text-sm font-semibold bg-[#2C474E] text-white rounded hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-2 transition-colors disabled:opacity-70"
          >
            {procesando ? (
              <>
                <Loader2 size={16} className="animate-spin text-white" />
                <span>Procesando nota...</span>
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
          <div className="mt-3 p-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded text-xs text-[#991B1B] flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{mensajeError}</span>
          </div>
        )}
      </div>

      {/* Tarjeta Último Registro Guardado */}
      {ultimoLote.length > 0 && (
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] px-3.5 py-2.5 flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#86EFAC]" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Último registro guardado ({ultimoLote.length} {ultimoLote.length === 1 ? 'movimiento' : 'movimientos'})
              </span>
            </div>
            <span className="text-[11px] text-[#86EFAC] font-semibold tabular-nums">
              Tasa: {formatNumber(tasaDia)} Bs/$
            </span>
          </div>

          <div className="divide-y divide-[#E4E4E7]">
            {ultimoLote.map((item) => (
              <div
                key={item.id}
                className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-[#18181B] truncate">
                      {item.descripcion}
                    </span>
                    <BadgeNaturaleza naturaleza={item.naturaleza} tipo={item.tipo} />
                    <span className="text-[11px] text-[#52525B] bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                      {METODOS_PAGO_LABELS[item.metodo_pago]}
                    </span>
                    {item.puesto && (
                      <span className="text-[10px] text-[#166534] bg-[#ECFDF5] border border-[#BBF7D0] px-1.5 py-0.5 rounded font-semibold">
                        {item.puesto.nombre}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#52525B]">
                    <span className="tabular-nums font-medium">{item.fecha}</span>
                    <span>•</span>
                    <span className="truncate">{item.categoria}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span
                      className={`block text-xs sm:text-sm font-bold tabular-nums ${
                        item.tipo === 'venta' ? 'text-[#166534]' : 'text-[#991B1B]'
                      }`}
                    >
                      {item.tipo === 'venta' ? '+' : '-'} {formatMontoMovimiento(item)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 border-l border-[#E4E4E7] pl-2 ml-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMovimientoParaEditar(item);
                        setModalManualAbierto(true);
                      }}
                      className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded"
                      title="Editar movimiento"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminarItemLote(item.id)}
                      className="p-1.5 text-[#52525B] hover:text-[#991B1B] hover:bg-red-50 rounded"
                      title="Eliminar movimiento"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal para carga manual rápida o edición */}
      <ModalMovimiento
        isOpen={modalManualAbierto}
        movimientoAEditar={movimientoParaEditar}
        tasaActual={tasaDia}
        puestos={puestos}
        puestoIdPorDefecto={puestoSeleccionado || null}
        onClose={() => {
          setModalManualAbierto(false);
          setMovimientoParaEditar(null);
        }}
        onGuardar={handleGuardarManual}
      />
    </div>
  );
};
