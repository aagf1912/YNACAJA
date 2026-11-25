import React, { useState } from 'react';
import {
  TrendingDown,
  TrendingUp,
  User,
  Store,
  Calendar,
  CreditCard,
  DollarSign,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Pencil,
  Trash2,
  Tag,
} from 'lucide-react';
import {
  CategoriaMovimiento,
  CATEGORIAS_GASTO,
  MetodoPago,
  METODOS_PAGO_LABELS,
  Movimiento,
  NaturalezaMovimiento,
  Puesto,
  TipoMovimiento,
} from '../types';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { formatMontoMovimiento, formatNumber } from '../utils/format';
import { getVenezuelaDate } from '../utils/parserLocal';
import { ModalMovimiento } from '../components/ModalMovimiento';

interface Props {
  tasaDia: number;
  puestos?: Puesto[];
  onGuardarMovimientos: (movs: Omit<Movimiento, 'id' | 'created_at'>[]) => Promise<Movimiento[]>;
  onActualizarMovimiento: (mov: Movimiento) => Promise<void>;
  onEliminarMovimiento: (id: string) => Promise<void>;
}

type ModoRegistro = 'gastos' | 'personal' | 'ventas';

export const RegistrarView: React.FC<Props> = ({
  tasaDia,
  puestos = [],
  onGuardarMovimientos,
  onActualizarMovimiento,
  onEliminarMovimiento,
}) => {
  // Estado del formulario
  const [modo, setModo] = useState<ModoRegistro>('gastos');
  const [puestoId, setPuestoId] = useState<string>('');
  const [fecha, setFecha] = useState<string>(getVenezuelaDate());
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('pago_movil');
  const [monto, setMonto] = useState<string>('');
  const [descripcion, setDescripcion] = useState<string>('');
  const [categoriaGasto, setCategoriaGasto] = useState<CategoriaMovimiento>('Materia Prima');

  // Estado de feedback y guardado
  const [guardando, setGuardando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [exitoMensaje, setExitoMensaje] = useState<string | null>(null);

  // Historial de la sesión actual
  const [movimientosSesion, setMovimientosSesion] = useState<Movimiento[]>([]);

  // Modal para editar algún movimiento del historial de la sesión
  const [movimientoParaEditar, setMovimientoParaEditar] = useState<Movimiento | null>(null);
  const [modalEditarAbierto, setModalEditarAbierto] = useState(false);

  // Sugerencias rápidas de descripción según el tipo seleccionado
  const sugerencias = {
    gastos: ['Hielo y vasos', 'Materia prima', 'Leche condensada', 'Canela / Insumos', 'Flete / Transporte', 'Bolsas y empaques'],
    personal: ['Retiro personal Ynaides', 'Almuerzo / Comida', 'Gasto personal', 'Ocio / Varios'],
    ventas: ['Venta del día', 'Venta especial evento', 'Venta mayor'],
  };

  // Cálculo en vivo de conversión
  const montoNumerico = parseFloat(monto.replace(',', '.')) || 0;
  const esDolar = metodoPago === 'divisa';
  const tasaSegura = tasaDia > 0 ? tasaDia : 100;
  const montoEquivalente = esDolar
    ? montoNumerico * tasaSegura
    : (tasaSegura > 0 ? montoNumerico / tasaSegura : 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMensaje(null);
    setExitoMensaje(null);

    const mNum = parseFloat(monto.replace(',', '.'));
    if (isNaN(mNum) || mNum <= 0) {
      setErrorMensaje('Por favor ingresa un monto válido mayor a 0.');
      return;
    }

    if (!descripcion.trim()) {
      setErrorMensaje('Por favor escribe el concepto o descripción del movimiento.');
      return;
    }

    setGuardando(true);

    try {
      let tipoMov: TipoMovimiento = 'gasto';
      let natMov: NaturalezaMovimiento = 'Negocio';
      let catMov: CategoriaMovimiento = categoriaGasto;

      if (modo === 'ventas') {
        tipoMov = 'venta';
        natMov = 'Ventas';
        catMov = 'Ventas';
      } else if (modo === 'personal') {
        tipoMov = 'gasto';
        natMov = 'Personal';
        catMov = 'Personal / Ocio / Regalos';
      } else {
        tipoMov = 'gasto';
        natMov = 'Negocio';
        catMov = categoriaGasto || 'Materia Prima';
      }

      const montoBs = esDolar ? Math.round(mNum * tasaSegura * 100) / 100 : mNum;
      const montoUSD = esDolar ? mNum : Math.round((mNum / tasaSegura) * 100) / 100;

      const nuevoMov: Omit<Movimiento, 'id' | 'created_at'> = {
        fecha,
        descripcion: descripcion.trim(),
        tipo: tipoMov,
        naturaleza: natMov,
        categoria: catMov,
        metodo_pago: metodoPago,
        moneda_original: esDolar ? 'USD' : 'VES',
        moneda: esDolar ? 'USD' : 'VES',
        monto_original: mNum,
        monto_bs: montoBs,
        monto_usd: montoUSD,
        tasa_aplicada: tasaSegura,
        tasa: tasaSegura,
        puesto_id: puestoId || null,
      };

      const guardados = await onGuardarMovimientos([nuevoMov]);

      if (guardados && guardados.length > 0) {
        setMovimientosSesion((prev) => [guardados[0], ...prev]);
        setExitoMensaje(`✓ Guardado con éxito: "${nuevoMov.descripcion}" (${formatMontoMovimiento(guardados[0])})`);
      } else {
        setExitoMensaje(`✓ Guardado con éxito: "${nuevoMov.descripcion}"`);
      }

      // Limpiar únicamente monto y descripción para seguir registrando ágilmente
      setMonto('');
      setDescripcion('');
    } catch (err: any) {
      setErrorMensaje(err?.message || 'Error al guardar el movimiento. Inténtalo nuevamente.');
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarItem = async (id: string) => {
    if (window.confirm('¿Deseas eliminar este registro?')) {
      try {
        await onEliminarMovimiento(id);
        setMovimientosSesion((prev) => prev.filter((m) => m.id !== id));
      } catch (err: any) {
        alert(err?.message || 'Error al eliminar');
      }
    }
  };

  const handleActualizarItem = async (mov: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => {
    if (mov.id) {
      await onActualizarMovimiento(mov as Movimiento);
      setMovimientosSesion((prev) =>
        prev.map((item) => (item.id === mov.id ? (mov as Movimiento) : item))
      );
    }
  };

  return (
    <div className="space-y-5 pb-24 pt-3 px-3.5 sm:px-4 max-w-2xl mx-auto">
      {/* Encabezado limpio con aire */}
      <div className="pt-1">
        <h1 className="text-lg font-bold text-[#18181B] tracking-tight">
          Registrar Movimiento
        </h1>
      </div>

      {/* Tarjeta Principal del Formulario */}
      <div className="bg-white border border-zinc-200/80 rounded-2xl p-4 sm:p-6 shadow-xs">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 1. Selector de Naturaleza / Tipo (Gastos, Personal, Ventas) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">
              Tipo de Movimiento
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {/* Opción GASTOS */}
              <button
                type="button"
                onClick={() => {
                  setModo('gastos');
                  setErrorMensaje(null);
                }}
                className={`min-h-[56px] flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  modo === 'gastos'
                    ? 'border-[#EF4444] bg-[#FEF2F2] text-[#991B1B] font-bold shadow-xs ring-1 ring-[#EF4444]'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <TrendingDown size={16} className={modo === 'gastos' ? 'text-[#DC2626]' : 'text-zinc-400'} />
                  <span className="text-xs sm:text-sm">Gastos</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5">Negocio</span>
              </button>

              {/* Opción PERSONAL */}
              <button
                type="button"
                onClick={() => {
                  setModo('personal');
                  setErrorMensaje(null);
                }}
                className={`min-h-[56px] flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  modo === 'personal'
                    ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#92400E] font-bold shadow-xs ring-1 ring-[#F59E0B]'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <User size={16} className={modo === 'personal' ? 'text-[#D97706]' : 'text-zinc-400'} />
                  <span className="text-xs sm:text-sm">Personal</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5">Retiros</span>
              </button>

              {/* Opción VENTAS */}
              <button
                type="button"
                onClick={() => {
                  setModo('ventas');
                  setErrorMensaje(null);
                }}
                className={`min-h-[56px] flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  modo === 'ventas'
                    ? 'border-[#10B981] bg-[#ECFDF5] text-[#065F46] font-bold shadow-xs ring-1 ring-[#10B981]'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={16} className={modo === 'ventas' ? 'text-[#059669]' : 'text-zinc-400'} />
                  <span className="text-xs sm:text-sm">Ventas</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5">Ingresos</span>
              </button>
            </div>
          </div>

          {/* 2. Fila: Puesto y Fecha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Selector de Puesto */}
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Store size={13} />
                  Puesto de Venta
                </span>
              </label>
              <select
                value={puestoId}
                onChange={(e) => setPuestoId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              >
                <option value="">Sin puesto específico (General)</option>
                {puestos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} {p.activo === false ? '(Inactivo)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector de Fecha */}
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Calendar size={13} />
                  Fecha
                </span>
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
                className="w-full min-h-[44px] px-3 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              />
            </div>
          </div>

          {/* 3. Selector de Método de Pago */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">
              Método de Pago
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Pago Móvil */}
              <button
                type="button"
                onClick={() => setMetodoPago('pago_movil')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'pago_movil'
                    ? 'border-[#1E3A3A] bg-[#1E3A3A] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <Smartphone size={14} />
                <span>Pago Móvil</span>
              </button>

              {/* Efectivo Bs */}
              <button
                type="button"
                onClick={() => setMetodoPago('efectivo_bs')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'efectivo_bs'
                    ? 'border-[#1E3A3A] bg-[#1E3A3A] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <Banknote size={14} />
                <span>Efectivo (Bs)</span>
              </button>

              {/* Punto de Venta */}
              <button
                type="button"
                onClick={() => setMetodoPago('punto_venta')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'punto_venta'
                    ? 'border-[#1E3A3A] bg-[#1E3A3A] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <CreditCard size={14} />
                <span>Punto de Venta</span>
              </button>

              {/* Divisas ($) */}
              <button
                type="button"
                onClick={() => setMetodoPago('divisa')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'divisa'
                    ? 'border-[#15803D] bg-[#15803D] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <DollarSign size={14} />
                <span>Divisas ($)</span>
              </button>
            </div>
          </div>

          {/* 4. Categoría opcional para Gastos */}
          {modo === 'gastos' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Tag size={13} />
                  Categoría del Gasto
                </span>
              </label>
              <select
                value={categoriaGasto}
                onChange={(e) => setCategoriaGasto(e.target.value as CategoriaMovimiento)}
                className="w-full min-h-[44px] px-3 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              >
                {CATEGORIAS_GASTO.filter((c) => c.naturaleza === 'Negocio').map((c) => (
                  <option key={c.nombre} value={c.nombre}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 5. Input de Monto con Conversión en Vivo */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-[#18181B]">
                {esDolar ? 'Monto en Divisas ($ USD)' : 'Monto en Bolívares (Bs)'}
              </label>
              {montoNumerico > 0 && (
                <span className="text-[11px] font-semibold text-[#1E3A3A] tabular-nums bg-emerald-50 border border-emerald-200/70 px-2.5 py-0.5 rounded-full">
                  {esDolar
                    ? `≈ Bs. ${formatNumber(montoEquivalente)}`
                    : `≈ $ ${formatNumber(montoEquivalente)}`}
                </span>
              )}
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">
                {esDolar ? '$' : 'Bs.'}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                required
                className="w-full min-h-[48px] pl-11 pr-3.5 py-3 text-base sm:text-lg font-bold border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
              />
            </div>
          </div>

          {/* 6. Input de Descripción / Concepto */}
          <div>
            <label className="block text-xs font-semibold text-[#18181B] mb-1.5">
              Descripción / Concepto
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={
                modo === 'gastos'
                  ? 'Ej: Hielo y vasos, compra de leche condensada...'
                  : modo === 'personal'
                  ? 'Ej: Retiro personal Ynaides, almuerzo...'
                  : 'Ej: Venta del día, venta evento...'
              }
              required
              className="w-full min-h-[46px] px-3.5 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
            />

            {/* Chips de sugerencias rápidas */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              {sugerencias[modo].map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setDescripcion(sug)}
                  className="px-2.5 py-1.5 text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors cursor-pointer"
                >
                  + {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Mensajes de Alerta / Éxito */}
          {errorMensaje && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMensaje}</span>
            </div>
          )}

          {exitoMensaje && (
            <div className="p-3 bg-[#ECFDF5] border border-[#BBF7D0] rounded-xl text-xs text-[#166534] flex items-start gap-2 animate-fadeIn">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-[#166534]" />
              <span className="font-semibold">{exitoMensaje}</span>
            </div>
          )}

          {/* 7. Botón Principal "Guardar Movimiento" */}
          <button
            type="submit"
            disabled={guardando}
            className={`w-full min-h-[50px] px-4 py-3 text-sm font-bold text-white rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
              modo === 'ventas'
                ? 'bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D]'
                : modo === 'personal'
                ? 'bg-[#D97706] hover:bg-[#B45309] active:bg-[#92400E]'
                : 'bg-[#1E3A3A] hover:bg-[#172e2e] active:bg-[#102222]'
            } disabled:opacity-60`}
          >
            {guardando ? (
              <>
                <Loader2 size={17} className="animate-spin text-white" />
                <span>Guardando movimiento...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={17} />
                <span>
                  {modo === 'ventas'
                    ? 'Guardar Venta'
                    : modo === 'personal'
                    ? 'Guardar Retiro Personal'
                    : 'Guardar Movimiento'}
                </span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* 8. Historial de la Sesión Actual */}
      {movimientosSesion.length > 0 && (
        <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] px-3.5 py-2.5 flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#86EFAC]" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Registrados en esta sesión ({movimientosSesion.length})
              </span>
            </div>
            <span className="text-[11px] text-[#86EFAC] font-semibold tabular-nums">
              Tasa: {formatNumber(tasaDia)} Bs/$
            </span>
          </div>

          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-y-auto">
            {movimientosSesion.map((item) => (
              <div
                key={item.id}
                className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50 transition-colors"
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
                        setModalEditarAbierto(true);
                      }}
                      className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded"
                      title="Editar movimiento"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminarItem(item.id)}
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

      {/* Modal para editar algún movimiento registrado en la sesión */}
      {modalEditarAbierto && movimientoParaEditar && (
        <ModalMovimiento
          isOpen={modalEditarAbierto}
          movimientoAEditar={movimientoParaEditar}
          tasaActual={tasaDia}
          puestos={puestos}
          puestoIdPorDefecto={puestoId || null}
          onClose={() => {
            setModalEditarAbierto(false);
            setMovimientoParaEditar(null);
          }}
          onGuardar={handleActualizarItem}
        />
      )}
    </div>
  );
};
