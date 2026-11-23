import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Pencil,
  Check,
  Store,
  Percent,
  AlertCircle,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  User,
  UserPlus,
} from 'lucide-react';
import { Puesto } from '../types';
import {
  getPuestos,
  obtenerUsuariosPuestos,
  crearPuestoConVendedor,
  asignarVendedorAPuesto,
  actualizarPuesto,
  actualizarCredencialesPuesto,
  eliminarPuesto,
} from '../services/supabase';

interface Props {
  isOpen: boolean;
  puestos: Puesto[];
  onClose: () => void;
  onPuestosActualizados: (puestosActualizados: Puesto[]) => void;
}

/**
 * Envoltorio para garantizar timeout de 8 segundos en cualquier petición asíncrona
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number = 8000,
  mensajeError: string = 'Tiempo de espera agotado (8s) al conectar con Supabase. Revisa tu conexión a internet o los permisos.'
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
  const [puestosEmails, setPuestosEmails] = useState<Record<string, string>>({});

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaComision, setNuevaComision] = useState('22.00');
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editComision, setEditComision] = useState('22.00');
  const [editActivo, setEditActivo] = useState(true);
  const [editUsuario, setEditUsuario] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [mostrarEditPassword, setMostrarEditPassword] = useState(false);

  // Estado para asignar usuario a puesto existente
  const [puestoParaAsignar, setPuestoParaAsignar] = useState<Puesto | null>(null);
  const [asignarUsuario, setAsignarUsuario] = useState('');
  const [asignarPassword, setAsignarPassword] = useState('');
  const [mostrarAsignarPassword, setMostrarAsignarPassword] = useState(false);
  const [asignando, setAsignando] = useState(false);

  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mantener referencia estable al callback del padre para no provocar re-renders
  const onPuestosActualizadosRef = useRef(onPuestosActualizados);
  useEffect(() => {
    onPuestosActualizadosRef.current = onPuestosActualizados;
  }, [onPuestosActualizados]);

  // Limpiar usuario corto (quitar arrobas, dominios y caracteres no válidos)
  const limpiarUsuario = (val: string): string => {
    return val.toLowerCase().replace(/[@].*$/, '').replace(/[^a-z0-9._-]/g, '');
  };

  // Consultar directamente desde Supabase con timeout de 8s y try/catch/finally garantizado
  const cargarPuestos = async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const [puestosFrescos, emailsMap] = await Promise.all([
        withTimeout(
          getPuestos(),
          8000,
          'Tiempo de espera agotado (8s) al sincronizar puestos con Supabase.'
        ),
        withTimeout(
          obtenerUsuariosPuestos(),
          8000,
          'Tiempo de espera agotado (8s) al consultar usuarios de puestos.'
        ).catch((err) => {
          console.warn('Aviso consultando obtener_usuarios_puestos:', err);
          return {} as Record<string, string>;
        }),
      ]);

      const puestosConEmail = puestosFrescos.map((p) => {
        const correo = emailsMap[p.id] || p.email || p.vendedor?.email;
        return {
          ...p,
          email: correo,
          vendedor: p.vendedor
            ? { ...p.vendedor, email: correo || p.vendedor.email }
            : correo
            ? {
                id: '',
                nombre: correo.split('@')[0],
                usuario: correo.split('@')[0],
                email: correo,
              }
            : null,
        };
      });

      setPuestosEmails(emailsMap);
      setListaPuestos(puestosConEmail);
      onPuestosActualizadosRef.current?.(puestosConEmail);
    } catch (err: any) {
      console.error('Error al consultar puestos:', err);
      setErrorMsg(err?.message || 'Error de conexión o permisos al consultar puestos en Supabase.');
    } finally {
      setCargando(false);
    }
  };

  // Se ejecuta únicamente al montar el modal, sin dependencias inestables (evita React error #185)
  useEffect(() => {
    cargarPuestos();
  }, []);

  if (!isOpen) return null;

  // 1. Crear Puesto con Usuario y Contraseña Integrados
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

    const usuarioLimpio = limpiarUsuario(nuevoUsuario);
    if (!usuarioLimpio || usuarioLimpio.length < 2) {
      setErrorMsg('Ingresa un usuario de acceso de al menos 2 caracteres (ej. puesto1).');
      return;
    }

    if (!nuevaPassword || nuevaPassword.length < 6) {
      setErrorMsg('La contraseña del vendedor debe tener al menos 6 caracteres.');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      await withTimeout(
        crearPuestoConVendedor(
          nuevoNombre.trim(),
          comisionNum,
          usuarioLimpio,
          nuevaPassword
        ),
        8000,
        'Tiempo de espera agotado (8s) al guardar el nuevo puesto en Supabase.'
      );

      await cargarPuestos();
      setNuevoNombre('');
      setNuevaComision('22.00');
      setNuevoUsuario('');
      setNuevaPassword('');
      setMostrarPassword(false);
    } catch (err: any) {
      console.error('Error al crear puesto con vendedor:', err);
      setErrorMsg(err?.message || 'Error al crear el puesto y vendedor en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  // 2. Asignar Vendedor a Puesto Existente sin Usuario
  const handleAsignarVendedor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puestoParaAsignar) return;

    const usuarioLimpio = limpiarUsuario(asignarUsuario);
    if (!usuarioLimpio || usuarioLimpio.length < 2) {
      setErrorMsg('Ingresa un usuario de acceso de al menos 2 caracteres.');
      return;
    }

    if (!asignarPassword || asignarPassword.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setAsignando(true);
    setErrorMsg(null);
    try {
      await withTimeout(
        asignarVendedorAPuesto(puestoParaAsignar.id, usuarioLimpio, asignarPassword),
        8000,
        'Tiempo de espera agotado (8s) al asignar vendedor en Supabase.'
      );

      await cargarPuestos();
      setPuestoParaAsignar(null);
      setAsignarUsuario('');
      setAsignarPassword('');
      setMostrarAsignarPassword(false);
    } catch (err: any) {
      console.error('Error al asignar vendedor:', err);
      setErrorMsg(err?.message || 'Error al asignar vendedor en Supabase.');
    } finally {
      setAsignando(false);
    }
  };

  // 3. Iniciar Edición de Puesto
  const iniciarEdicion = (p: Puesto) => {
    setEditandoId(p.id);
    setEditNombre(p.nombre);
    setEditComision((p.comision_porcentaje ?? p.porcentaje_comision ?? 22).toString());
    setEditActivo(p.activo);

    // Obtener la parte antes del @ del correo actual asignado
    const correoActual = puestosEmails[p.id] || p.email || p.vendedor?.email || '';
    const usuarioActual = correoActual
      ? correoActual.split('@')[0]
      : (p.vendedor?.usuario || p.vendedor?.nombre || '').toLowerCase().replace(/[@].*$/, '');

    setEditUsuario(limpiarUsuario(usuarioActual));
    setEditPassword('');
    setMostrarEditPassword(false);
    setErrorMsg(null);
  };

  // 4. Guardar Edición
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

    const usuarioLimpio = limpiarUsuario(editUsuario);
    const passwordTrim = editPassword.trim();

    if (passwordTrim && passwordTrim.length < 6) {
      setErrorMsg('La nueva contraseña debe tener al menos 6 caracteres (o dejarse vacía para mantener la actual).');
      return;
    }

    const emailPrevio = puestosEmails[puestoOriginal.id] || puestoOriginal.email || puestoOriginal.vendedor?.email;
    if (!emailPrevio && usuarioLimpio && !passwordTrim) {
      setErrorMsg('Para asignar un nuevo usuario a este puesto por primera vez, ingresá una contraseña de al menos 6 caracteres.');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      // 1. Actualizar datos base del puesto
      await withTimeout(
        actualizarPuesto({
          ...puestoOriginal,
          nombre: editNombre.trim(),
          comision_porcentaje: comisionNum,
          porcentaje_comision: comisionNum,
          activo: editActivo,
        }),
        8000,
        'Tiempo de espera agotado (8s) al actualizar el puesto en Supabase.'
      );

      // 2. Si se ingresó usuario o nueva contraseña, llamar a actualizar_credenciales_puesto
      if (usuarioLimpio || passwordTrim) {
        await withTimeout(
          actualizarCredencialesPuesto(
            puestoOriginal.id,
            usuarioLimpio,
            passwordTrim || null
          ),
          8000,
          'Tiempo de espera agotado (8s) al actualizar credenciales en Supabase.'
        );
      }

      await cargarPuestos();
      setEditandoId(null);
      setEditUsuario('');
      setEditPassword('');
      setMostrarEditPassword(false);
    } catch (err: any) {
      console.error('Error al actualizar puesto:', err);
      setErrorMsg(err?.message || 'Error al actualizar el puesto en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  // 5. Eliminar Puesto
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
        8000,
        'Tiempo de espera agotado (8s) al eliminar el puesto en Supabase.'
      );

      await cargarPuestos();
    } catch (err: any) {
      console.error('Error al eliminar puesto:', err);
      setErrorMsg(err?.message || 'Error al eliminar el puesto en Supabase.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-[#E4E4E7] max-h-[92vh] flex flex-col">
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
            className="p-1 rounded text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
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
                <span className="font-bold block mb-0.5">Aviso de Supabase / Red:</span>
                <span className="font-mono break-words leading-relaxed text-[11px] block">{errorMsg}</span>
                <button
                  type="button"
                  onClick={cargarPuestos}
                  className="mt-2 px-2.5 py-1 bg-red-800 text-white font-bold rounded hover:bg-red-900 transition-colors inline-flex items-center gap-1 text-[11px]"
                >
                  <Loader2 size={11} className={cargando ? 'animate-spin' : ''} />
                  <span>Reintentar sincronización</span>
                </button>
              </div>
            </div>
          )}

          {/* Formulario para Crear Puesto con Usuario y Contraseña */}
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3">
            <h3 className="font-bold text-[#18181B] mb-2 flex items-center gap-1.5">
              <Plus size={14} className="text-[#2C474E]" />
              Crear Nuevo Puesto y Vendedor
            </h3>
            <form onSubmit={handleCrearPuesto} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-8">
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

                <div className="sm:col-span-4">
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
              </div>

              {/* Campos de Usuario y Contraseña para el Vendedor */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-zinc-200">
                <div className="sm:col-span-6">
                  <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                    Usuario de acceso
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      placeholder="puesto3"
                      value={nuevoUsuario}
                      onChange={(e) => setNuevoUsuario(limpiarUsuario(e.target.value))}
                      disabled={guardando}
                      className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-xs text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] font-mono pr-28 disabled:bg-zinc-100"
                    />
                    <span className="absolute right-2 text-zinc-400 font-mono text-[11px] select-none pointer-events-none">
                      @ynacaja.app
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono block mt-0.5">
                    Correo de acceso: {limpiarUsuario(nuevoUsuario) ? `${limpiarUsuario(nuevoUsuario)}@ynacaja.app` : 'ejemplo@ynacaja.app'}
                  </span>
                </div>

                <div className="sm:col-span-6">
                  <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                    Contraseña (mín. 6 caracteres)
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={mostrarPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={nuevaPassword}
                      onChange={(e) => setNuevaPassword(e.target.value)}
                      disabled={guardando}
                      className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-xs text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] font-mono pr-8 disabled:bg-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarPassword(!mostrarPassword)}
                      className="absolute right-2 text-zinc-400 hover:text-zinc-600 p-0.5"
                      title={mostrarPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {mostrarPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={guardando || cargando}
                  className="py-1.5 px-4 bg-[#2C474E] text-white rounded font-bold text-xs hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 min-h-[32px] shadow-xs"
                >
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  <span>Agregar Puesto y Vendedor</span>
                </button>
              </div>
            </form>
          </div>

          {/* Tarjeta para Asignar Usuario a Puesto Existente */}
          {puestoParaAsignar && (
            <div className="p-3 bg-amber-50/80 border border-amber-300 rounded-lg space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between pb-1.5 border-b border-amber-200">
                <div className="flex items-center gap-1.5 font-bold text-xs text-amber-950">
                  <UserPlus size={14} className="text-amber-700" />
                  <span>Asignar Usuario a: &quot;{puestoParaAsignar.nombre}&quot;</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPuestoParaAsignar(null)}
                  className="text-amber-700 hover:text-amber-950 p-0.5"
                >
                  <X size={14} />
                </button>
              </div>

              <form onSubmit={handleAsignarVendedor} className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-6">
                    <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                      Usuario de acceso
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        placeholder="ej. puesto2"
                        value={asignarUsuario}
                        onChange={(e) => setAsignarUsuario(limpiarUsuario(e.target.value))}
                        disabled={asignando}
                        className="w-full px-2.5 py-1.5 border border-amber-300 rounded bg-white text-xs text-[#18181B] font-mono pr-28"
                      />
                      <span className="absolute right-2 text-zinc-400 font-mono text-[11px] select-none pointer-events-none">
                        @ynacaja.app
                      </span>
                    </div>
                    <span className="text-[10px] text-amber-800 font-mono block mt-0.5">
                      Correo: {limpiarUsuario(asignarUsuario) ? `${limpiarUsuario(asignarUsuario)}@ynacaja.app` : 'ejemplo@ynacaja.app'}
                    </span>
                  </div>

                  <div className="sm:col-span-6">
                    <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                      Contraseña (mín. 6 car.)
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type={mostrarAsignarPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={asignarPassword}
                        onChange={(e) => setAsignarPassword(e.target.value)}
                        disabled={asignando}
                        className="w-full px-2.5 py-1.5 border border-amber-300 rounded bg-white text-xs text-[#18181B] font-mono pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setMostrarAsignarPassword(!mostrarAsignarPassword)}
                        className="absolute right-2 text-zinc-400 hover:text-zinc-600 p-0.5"
                      >
                        {mostrarAsignarPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPuestoParaAsignar(null)}
                    disabled={asignando}
                    className="px-2.5 py-1 text-xs border border-amber-300 rounded bg-white hover:bg-amber-100/50 text-amber-900"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={asignando}
                    className="px-3.5 py-1.5 text-xs bg-amber-700 hover:bg-amber-800 text-white font-bold rounded flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    {asignando ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                    <span>Guardar y Asignar Usuario</span>
                  </button>
                </div>
              </form>
            </div>
          )}

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
                        className="p-3 bg-[#F4F4F5] border-2 border-[#2C474E] rounded-lg space-y-2.5"
                      >
                        <div className="flex items-center justify-between pb-1 border-b border-zinc-200">
                          <span className="text-xs font-bold text-[#2C474E] flex items-center gap-1.5">
                            <Pencil size={13} />
                            Editando Puesto: {p.nombre}
                          </span>
                        </div>

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

                        {/* Credenciales de Acceso */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-zinc-200">
                          {/* Campo Usuario de acceso */}
                          <div className="sm:col-span-6">
                            <label className="block text-[10px] font-bold text-[#52525B] uppercase mb-0.5">
                              Usuario de acceso
                            </label>
                            <div className="flex rounded border border-[#E4E4E7] overflow-hidden focus-within:border-[#2C474E] bg-white">
                              <input
                                type="text"
                                value={editUsuario}
                                onChange={(e) => setEditUsuario(limpiarUsuario(e.target.value))}
                                disabled={guardando}
                                placeholder="ej. puesto1"
                                className="w-full px-2 py-1 bg-transparent text-xs font-mono text-[#18181B] outline-none"
                              />
                              <span className="bg-[#F4F4F5] border-l border-[#E4E4E7] px-2 py-1 text-[11px] text-[#71717A] font-mono select-none flex items-center">
                                @ynacaja.app
                              </span>
                            </div>
                            {editUsuario ? (
                              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                                Correo: {limpiarUsuario(editUsuario)}@ynacaja.app
                              </p>
                            ) : null}
                          </div>

                          {/* Campo Nueva contraseña */}
                          <div className="sm:col-span-6">
                            <label className="block text-[10px] font-bold text-[#52525B] uppercase mb-0.5">
                              Nueva contraseña <span className="font-normal text-zinc-500 normal-case">(dejar vacío para mantener la actual)</span>
                            </label>
                            <div className="relative">
                              <input
                                type={mostrarEditPassword ? 'text' : 'password'}
                                value={editPassword}
                                onChange={(e) => setEditPassword(e.target.value)}
                                disabled={guardando}
                                placeholder="Dejar vacío para mantener la actual"
                                className="w-full px-2 py-1 pr-8 border border-[#E4E4E7] rounded bg-white text-xs font-mono text-[#18181B]"
                              />
                              <button
                                type="button"
                                onClick={() => setMostrarEditPassword(!mostrarEditPassword)}
                                className="absolute right-2 top-1.5 text-zinc-400 hover:text-zinc-600"
                                tabIndex={-1}
                                title={mostrarEditPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                              >
                                {mostrarEditPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            </div>
                            {editPassword && editPassword.length > 0 && editPassword.length < 6 && (
                              <p className="text-[10px] text-amber-600 mt-0.5">
                                Mínimo 6 caracteres
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-1 border-t border-zinc-200">
                          <button
                            type="button"
                            onClick={() => {
                              setEditandoId(null);
                              setEditUsuario('');
                              setEditPassword('');
                              setMostrarEditPassword(false);
                            }}
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
                          Comisión: <span className="font-bold text-[#166534] tabular-nums font-mono">({p.comision_porcentaje ?? p.porcentaje_comision}%)</span> en dólares
                        </div>

                        {/* Estado del Vendedor asignado / Correo */}
                        {(() => {
                          const emailAsignado = puestosEmails[p.id] || p.email || p.vendedor?.email;
                          const usuarioAsignado = emailAsignado
                            ? emailAsignado.split('@')[0]
                            : p.vendedor?.usuario || p.vendedor?.nombre;

                          if (emailAsignado || p.vendedor) {
                            return (
                              <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded mt-1.5 w-fit">
                                <User size={12} className="text-emerald-700 shrink-0" />
                                <span>
                                  Usuario: <strong className="font-mono">{usuarioAsignado}</strong>
                                  <span className="text-zinc-600 font-mono text-[10px] ml-1">
                                    ({emailAsignado || `${usuarioAsignado}@ynacaja.app`})
                                  </span>
                                </span>
                              </div>
                            );
                          }

                          return (
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                                Sin usuario asignado
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setPuestoParaAsignar(p);
                                  setAsignarUsuario(limpiarUsuario(p.nombre));
                                  setAsignarPassword('');
                                }}
                                className="text-[11px] font-bold text-[#2C474E] hover:text-[#1b2c30] bg-[#2C474E]/10 hover:bg-[#2C474E]/20 px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1"
                              >
                                <UserPlus size={12} />
                                <span>+ Asignar usuario</span>
                              </button>
                            </div>
                          );
                        })()}
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
