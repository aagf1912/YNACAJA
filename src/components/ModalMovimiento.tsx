import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import {
  CategoriaMovimiento,
  CATEGORIAS_GASTO,
  MetodoPago,
  METODOS_PAGO_LABELS,
  MonedaOriginal,
  Movimiento,
  NaturalezaMovimiento,
  Puesto,
  TipoMovimiento,
} from '../types';

interface Props {
  isOpen: boolean;
  movimientoAEditar?: Movimiento | null;
  tasaActual: number;
  soloVenta?: boolean;
  puestos?: Puesto[];
  puestoIdPorDefecto?: string | null;
  onClose: () => void;
  onGuardar: (movimiento: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => Promise<void>;
}

export const ModalMovimiento: React.FC<Props> = ({
  isOpen,
  movimientoAEditar,
  tasaActual,
  soloVenta = false,
  puestos = [],
  puestoIdPorDefecto = null,
  onClose,
  onGuardar,
}) => {
  const [tipo, setTipo] = useState<TipoMovimiento>(soloVenta ? 'venta' : 'gasto');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState<string>('');
  const [categoria, setCategoria] = useState<CategoriaMovimiento>(soloVenta ? 'Ventas' : 'Materia Prima');
  const [naturaleza, setNaturaleza] = useState<NaturalezaMovimiento>('Negocio');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('pago_movil');
  const [monedaOriginal, setMonedaOriginal] = useState<MonedaOriginal>('VES');
  const [montoOriginal, setMontoOriginal] = useState<string>('');
  const [tasaAplicada, setTasaAplicada] = useState<string>(tasaActual.toString());
  const [puestoId, setPuestoId] = useState<string | null>(puestoIdPorDefecto);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (movimientoAEditar) {
      setTipo(movimientoAEditar.tipo === 'ingreso' || movimientoAEditar.tipo === 'venta' ? 'venta' : 'gasto');
      setFecha(movimientoAEditar.fecha);
      setDescripcion(movimientoAEditar.descripcion);
      setCategoria(movimientoAEditar.categoria);
      setNaturaleza(movimientoAEditar.naturaleza);
      setMetodoPago(movimientoAEditar.metodo_pago);
      setMonedaOriginal(movimientoAEditar.moneda_original);
      setMontoOriginal(movimientoAEditar.monto_original.toString());
      setTasaAplicada(movimientoAEditar.tasa_aplicada.toString());
      setPuestoId(movimientoAEditar.puesto_id || null);
    } else {
      setTipo(soloVenta ? 'venta' : 'gasto');
      setFecha(new Date().toISOString().split('T')[0]);
      setDescripcion('');
      setCategoria(soloVenta ? 'Ventas' : 'Materia Prima');
      setNaturaleza('Negocio');
      setMetodoPago('pago_movil');
      setMonedaOriginal('VES');
      setMontoOriginal('');
      setTasaAplicada(tasaActual.toString());
      setPuestoId(puestoIdPorDefecto);
    }
    setError(null);
  }, [movimientoAEditar, isOpen, tasaActual, soloVenta, puestoIdPorDefecto]);

  if (!isOpen) return null;

  const handleTipoChange = (nuevoTipo: TipoMovimiento) => {
    setTipo(nuevoTipo);
    if (nuevoTipo === 'venta') {
      setCategoria('Ventas');
      setNaturaleza('Negocio');
    } else {
      setCategoria('Materia Prima');
      setNaturaleza('Negocio');
    }
  };

  const handleCategoriaChange = (nuevaCat: CategoriaMovimiento) => {
    setCategoria(nuevaCat);
    const match = CATEGORIAS_GASTO.find((c) => c.nombre === nuevaCat);
    if (match) {
      setNaturaleza(match.naturaleza);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const montoNum = parseFloat(montoOriginal.replace(',', '.'));
    const tasaNum = parseFloat(tasaAplicada.replace(',', '.'));

    if (!descripcion.trim()) {
      setError('La descripción es obligatoria.');
      return;
    }
    if (isNaN(montoNum) || montoNum <= 0) {
      setError('Introduce un monto válido mayor a 0.');
      return;
    }
    if (isNaN(tasaNum) || tasaNum <= 0) {
      setError('Introduce una tasa válida mayor a 0.');
      return;
    }

    try {
      setGuardando(true);
      setError(null);
      await onGuardar({
        ...(movimientoAEditar ? { id: movimientoAEditar.id } : {}),
        fecha,
        descripcion: descripcion.trim(),
        tipo: tipo === 'ingreso' || tipo === 'venta' ? 'venta' : 'gasto',
        naturaleza,
        categoria,
        metodo_pago: metodoPago,
        moneda_original: monedaOriginal,
        moneda: monedaOriginal,
        monto_original: montoNum,
        tasa_aplicada: tasaNum,
        tasa: tasaNum,
        puesto_id: puestoId || null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Error guardando movimiento');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-[#E4E4E7]">
        {/* Header Modal */}
        <div className="bg-[#2C474E] text-white px-4 py-3 flex items-center justify-between">
          <span className="font-bold text-sm tracking-tight">
            {movimientoAEditar
              ? 'Editar Movimiento'
              : soloVenta
              ? 'Registrar Venta'
              : 'Nuevo Movimiento'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-300 hover:text-white hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs text-[#18181B]">
          {error && (
            <div className="p-2 bg-[#FEF2F2] border border-[#FECACA] rounded text-[#991B1B]">
              {error}
            </div>
          )}

          {/* Selector de Tipo (Ingreso vs Gasto) - Oculto si soloVenta es true */}
          {!soloVenta && (
            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Tipo de Movimiento
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleTipoChange('venta')}
                  className={`py-1.5 px-3 rounded font-bold border text-center transition-colors ${
                    tipo === 'venta' || tipo === 'ingreso'
                      ? 'bg-[#166534] text-white border-[#166534]'
                      : 'bg-[#F4F4F5] text-[#52525B] border-[#E4E4E7] hover:bg-zinc-200'
                  }`}
                >
                  Ingreso / Venta (+)
                </button>
                <button
                  type="button"
                  onClick={() => handleTipoChange('gasto')}
                  className={`py-1.5 px-3 rounded font-bold border text-center transition-colors ${
                    tipo === 'gasto' || tipo === 'egreso'
                      ? 'bg-[#991B1B] text-white border-[#991B1B]'
                      : 'bg-[#F4F4F5] text-[#52525B] border-[#E4E4E7] hover:bg-zinc-200'
                  }`}
                >
                  Gasto / Egreso (-)
                </button>
              </div>
            </div>
          )}

          {/* Selector de Puesto (si hay puestos disponibles y no es soloVenta) */}
          {puestos.length > 0 && !soloVenta && (
            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Puesto de Venta / Origen (Opcional)
              </label>
              <select
                value={puestoId || ''}
                onChange={(e) => setPuestoId(e.target.value ? e.target.value : null)}
                className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E]"
              >
                <option value="">Sin puesto específico (General)</option>
                {puestos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} {p.activo ? '' : '(Inactivo)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Fecha y Descripción */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Fecha
              </label>
              <input
                type="date"
                required
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full px-2 py-1.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] tabular-nums"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Descripción
              </label>
              <input
                type="text"
                required
                placeholder={soloVenta ? 'Ej. Venta Chicha Adictiva' : 'Ej. Leche condensada, Hielo, etc.'}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E]"
              />
            </div>
          </div>

          {/* Categoría (solo para gastos) */}
          {(tipo === 'gasto' || tipo === 'egreso') && !soloVenta && (
            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Categoría del Gasto (9 oficiales)
              </label>
              <select
                value={categoria}
                onChange={(e) => handleCategoriaChange(e.target.value as CategoriaMovimiento)}
                className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E]"
              >
                {CATEGORIAS_GASTO.map((cat) => (
                  <option key={cat.nombre} value={cat.nombre}>
                    {cat.nombre} ({cat.naturaleza})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Método de Pago y Moneda */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Método de Pago
              </label>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                className="w-full px-2 py-1.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E]"
              >
                {Object.entries(METODOS_PAGO_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Moneda
              </label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setMonedaOriginal('VES')}
                  className={`py-1.5 rounded font-bold border text-center transition-colors ${
                    monedaOriginal === 'VES'
                      ? 'bg-[#2C474E] text-white border-[#2C474E]'
                      : 'bg-white text-[#52525B] border-[#E4E4E7]'
                  }`}
                >
                  Bs (VES)
                </button>
                <button
                  type="button"
                  onClick={() => setMonedaOriginal('USD')}
                  className={`py-1.5 rounded font-bold border text-center transition-colors ${
                    monedaOriginal === 'USD'
                      ? 'bg-[#2C474E] text-white border-[#2C474E]'
                      : 'bg-white text-[#52525B] border-[#E4E4E7]'
                  }`}
                >
                  $ (USD)
                </button>
              </div>
            </div>
          </div>

          {/* Monto y Tasa Aplicada */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Monto Original ({monedaOriginal === 'VES' ? 'Bs' : '$'})
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                placeholder="0.00"
                value={montoOriginal}
                onChange={(e) => setMontoOriginal(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-xs font-mono font-bold text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#52525B] mb-1">
                Tasa Aplicada (Bs/$)
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                disabled={soloVenta}
                value={tasaAplicada}
                onChange={(e) => setTasaAplicada(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#E4E4E7] rounded bg-white text-xs font-mono text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#2C474E] tabular-nums disabled:bg-zinc-100"
              />
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#E4E4E7]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-[#52525B] hover:text-[#18181B] hover:bg-zinc-100 rounded"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-4 py-1.5 text-xs font-bold text-white bg-[#2C474E] hover:bg-[#23393e] active:bg-[#1a2b2f] rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Check size={14} />
              <span>{guardando ? 'Guardando...' : 'Guardar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
