import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Pencil, Check, Store, Percent, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { Puesto } from '../types';
import { getPuestos, crearPuesto, actualizarPuesto, eliminarPuesto } from '../services/supabase';

interface Props {
  isOpen: boolean;
  puestos: Puesto[];
  onClose: () => void;
  onPuestosActualizados: (puestosActualizados: Puesto[]) => void;
}

/**
 * Envoltorio para garantizar timeout de 10 segundos en cualquier petición asíncrona
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number = 10000,
  mensajeError: string = 'Tiempo de espera agotado (10s) al conectar con Supabase. Revisa tu conexión a internet o los permisos.'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(mensajeError)), ms)
    ),
  ]);
}

export const ModalGestionPuestos: React.FC<Props> = ({
  isOpen,
  puestos: puestosIniciales,
  onClose,
  onPuestosActualizados,
}) => {
  const [listaPuestos, setListaPuestos] = useState<Puesto[]>(puestosIniciales);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaComision, setNuevaComision] = useState('22.00');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editComision, setEditComision] = useState('22.00');
  const [editActivo, setEditActivo] = useState(true);

  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Consultar directamente desde Supabase con timeout de 10s y try/catch/finally garantizado
  const recargarPuestosDirecto = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const puestosFrescos = await withTimeout(
        getPuestos(),
        10000,
        'Tiempo de espera agotado (10s) al sincronizar puestos con Supabase.'
      );
      setListaPuestos(puestosFrescos);
      onPuestosActualizados(puestosFrescos);
    } catch (err: any) {
      console.error('Error al consultar puestos:', err);
      setErrorMsg(err?.message || 'Error de conexión o permisos al consultar puestos en Supabase.');
    } finally {
      setCargando(false);
    }
  }, [onPuestosActualizados]);

  useEffect(() => {
    if (isOpen) {
      recargarPuestosDirecto();
    } else {
      setEditandoId(null);
      setErrorMsg(null);
      setCargando(false);
      setGuardando(false);
    }
  }, [isOpen, recargarPuestosDirecto]);

  if (!isOpen) return null;

  // 1. Crear Puesto
  const handleCrearPuesto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim()) {
      setErrorMsg('Ingresa un nombre para el nuevo puesto.');
      return;
    }
    const comisionNum = parseFloat(nuevaComision.replace(',', '.'));
    if (isNaN(comisionNum) || comisionNum < 0 || comisionNum > 100) {
      setErrorMsg('El porcentaje de comisión debe estar entre 0 y 100%.');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      await withTimeout(
        crearPuesto({
          nombre: nuevoNombre.trim(),
          porcentaje_comision: comisionNum,
          activo: true,
        }),
        10000,
        'Tiempo de espera agotado (10s) al guardar el nuevo puesto en Supabase.'
      );

      await recargarPuestosDirecto();
      setNuevoNombre('');
      setNuevaComision('22.00');
    } catch (err: any) {
      console.error('Error al crear puesto:', err);
      setErrorMsg(err?.message || 'Error al crear el puesto en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  // 2. Iniciar Edición
  const iniciarEdicion = (p: Puesto) => {
    setEditandoId(p.id);
    setEditNombre(p.nombre);
    setEditComision(p.porcentaje_comision.toString());
    setEditActivo(p.activo);
    setErrorMsg(null);
  };

  // 3. Guardar Edición
  const handleGuardarEdicion = async (puestoOriginal: Puesto) => {
    if (!editNombre.trim()) {
      setErrorMsg('El nombre del puesto no puede estar vacío.');
      return;
    }
    const comisionNum = parseFloat(editComision.replace(',', '.'));
    if (isNaN(comisionNum) || comisionNum < 0 || comisionNum > 100) {
      setErrorMsg('El porcentaje de comisión debe estar entre 0 y 100%.');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      await withTimeout(
        actualizarPuesto({
          ...puestoOriginal,
          nombre: editNombre.trim(),
          porcentaje_comision: comisionNum,
          activo: editActivo,
        }),
        10000,
        'Tiempo de espera agotado (10s) al actualizar el puesto en Supabase.'
      );

      await recargarPuestosDirecto();
      setEditandoId(null);
    } catch (err: any) {
      console.error('Error al actualizar puesto:', err);
      setErrorMsg(err?.message || 'Error al actualizar el puesto en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  // 4. Eliminar Puesto
  const handleEliminarPuesto = async (p: Puesto) => {
    const confirmacion = window.confirm(
      `¿Estás seguro de que deseas eliminar el puesto "${p.nombre}"?\nEsta acción no se puede deshacer.`
    );
    if (!confirmacion) return;

    setGuardando(true);
    setErrorMsg(null);
    try {
      await withTimeout(
        eliminarPuesto(p.id),
        10000,
        'Tiempo de espera agotado (10s) al eliminar el puesto en Supabase.'
      );

      await recargarPuestosDirecto();
    } catch (err: any) {
      console.error('Error al eliminar puesto:', err);
      setErrorMsg(err?.message || 'Error al eliminar el puesto en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-[#E4E4E7] max-h-[90vh] flex flex-col">
        {/* Header del Modal */}
        <div className="bg-[#2C474E] text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store size={18} className="text-[#86EFAC]" />
            <span className="font-bold text-sm tracking-tight">
              Gestionar Puestos de Venta
            </span>
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
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* CARTEL ROJO VISIBLE ANTE CUALQUIER ERROR DE RED O SUPABASE */}
          {errorMsg && (
            <div className="p-3 bg-[#FEF2F2] border-2 border-[#FECACA] rounded-lg text-xs text-[#991B1B] flex items-start gap-2 shadow-xs animate-in fade-in">
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1">
                <span className="font-bold block mb-0.5">Error de Supabase / Red:</span>
                <span className="font-mono break-words leading-relaxed text-[11px] block">{errorMsg}</span>
                <button
                  type="button"
                  onClick={recargarPuestosDirecto}
                  className="mt-2 px-2.5 py-1 bg-red-800 text-white font-bold rounded hover:bg-red-900 transition-colors inline-flex items-center gap-1 text-[11px]"
                >
                  <Loader2 size={11} className={cargando ? 'animate-spin' : ''} />
                  <span>Reintentar sincronización</span>
                </button>
              </div>
            </div>
          )}

          {/* Formulario para Crear Puesto */}
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3">
            <h3 className="font-bold text-[#18181B] mb-2 flex items-center gap-1.5">
              <Plus size={14} className="text-[#2C474E]" />
              Crear Nuevo Puesto
            </h3>
            <form onSubmit={handleCrearPuesto} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                  Nombre del Puesto
                </label>
                <input
                  type="text"
                  placeholder="Ej. Puesto 3 - Plaza"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  disabled={guardando}
                  className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-xs text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] disabled:bg-zinc-100"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                  Comisión (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={nuevaComision}
                    onChange={(e) => setNuevaComision(e.target.value)}
                    disabled={guardando}
                    className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-xs text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] font-mono tabular-nums pr-6 disabled:bg-zinc-100"
                  />
                  <Percent size={12} className="absolute right-2 top-2.5 text-zinc-400" />
                </div>
              </div>

              <div className="sm:col-span-3 flex items-end">
                <button
                  type="submit"
                  disabled={guardando || cargando}
                  className="w-full py-1.5 px-3 bg-[#2C474E] text-white rounded font-bold text-xs hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1 transition-colors disabled:opacity-50 min-h-[32px]"
                >
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  <span>Agregar</span>
                </button>
              </div>
            </form>
          </div>

          {/* Lista de Puestos Existentes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-[#18181B]">
                Puestos en Base de Datos ({listaPuestos.length})
              </h3>
              {cargando && (
                <span className="flex items-center gap-1 text-[11px] text-[#52525B]">
                  <Loader2 size={12} className="animate-spin text-[#2C474E]" />
                  <span>Sincronizando con Supabase...</span>
                </span>
              )}
            </div>

            {listaPuestos.length === 0 && !cargando ? (
              <div className="p-4 bg-zinc-50 border border-dashed border-zinc-300 rounded-lg text-center text-zinc-500 text-xs">
                No hay puestos registrados en Supabase. Agrega uno usando el formulario de arriba.
              </div>
            ) : (
              <div className="space-y-2">
                {listaPuestos.map((p) => {
                  const esEditando = editandoId === p.id;

                  if (esEditando) {
                    return (
                      <div
                        key={p.id}
                        className="p-3 bg-[#F4F4F5] border border-[#2C474E] rounded-lg space-y-2"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <div className="sm:col-span-6">
                            <label className="block text-[10px] font-bold text-[#52525B] uppercase mb-0.5">
                              Nombre
                            </label>
                            <input
                              type="text"
                              value={editNombre}
                              onChange={(e) => setEditNombre(e.target.value)}
                              disabled={guardando}
                              className="w-full px-2 py-1 border border-[#E4E4E7] rounded bg-white text-xs font-semibold"
                            />
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[10px] font-bold text-[#52525B] uppercase mb-0.5">
                              Comisión %
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={editComision}
                              onChange={(e) => setEditComision(e.target.value)}
                              disabled={guardando}
                              className="w-full px-2 py-1 border border-[#E4E4E7] rounded bg-white text-xs font-mono tabular-nums"
                            />
                          </div>

                          <div className="sm:col-span-3 flex items-center gap-2 pt-4">
                            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-[#18181B]">
                              <input
                                type="checkbox"
                                checked={editActivo}
                                onChange={(e) => setEditActivo(e.target.checked)}
                                disabled={guardando}
                                className="rounded text-[#2C474E] focus:ring-[#2C474E]"
                              />
                              <span>Activo</span>
                            </label>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-1 border-t border-zinc-200">
                          <button
                            type="button"
                            onClick={() => setEditandoId(null)}
                            disabled={guardando}
                            className="px-2.5 py-1 text-xs border border-zinc-300 rounded bg-white hover:bg-zinc-100"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={guardando}
                            onClick={() => handleGuardarEdicion(p)}
                            className="px-3 py-1 text-xs bg-[#2C474E] text-white rounded font-bold hover:bg-[#23393e] flex items-center gap-1 disabled:opacity-50"
                          >
                            {guardando ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                            <span>Guardar</span>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={p.id}
                      className={`p-3 border rounded-lg flex items-center justify-between gap-3 ${
                        p.activo
                          ? 'bg-white border-[#E4E4E7]'
                          : 'bg-zinc-50 border-zinc-200 opacity-60'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-[#18181B]">
                            {p.nombre}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              p.activo
                                ? 'bg-[#ECFDF5] text-[#166534] border border-[#BBF7D0]'
                                : 'bg-zinc-200 text-zinc-600'
                            }`}
                          >
                            {p.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#52525B] mt-0.5">
                          Comisión: <span className="font-bold text-[#166534] tabular-nums font-mono">({p.porcentaje_comision}%)</span> en dólares
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => iniciarEdicion(p)}
                          disabled={guardando}
                          className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded border border-transparent hover:border-zinc-200 transition-colors"
                          title="Editar puesto"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEliminarPuesto(p)}
                          disabled={guardando}
                          className="p-1.5 text-[#52525B] hover:text-[#991B1B] hover:bg-red-50 rounded border border-transparent hover:border-red-200 transition-colors"
                          title="Eliminar puesto"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#FAFAFA] border-t border-[#E4E4E7] px-4 py-2.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#2C474E] text-white rounded font-bold text-xs hover:bg-[#23393e] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
