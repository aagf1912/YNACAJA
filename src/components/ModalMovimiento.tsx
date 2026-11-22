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
  TipoMovimiento,
} from '../types';

interface Props {
  isOpen: boolean;
  movimientoAEditar?: Movimiento | null;
  tasaActual: number;
  onClose: () => void;
  onGuardar: (movimiento: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => Promise<void>;
}

export const ModalMovimiento: React.FC<Props> = ({
  isOpen,
  movimientoAEditar,
  tasaActual,
  onClose,
  onGuardar,
}) => {
  const [tipo, setTipo] = useState<TipoMovimiento>('gasto');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState<string>('');
  const [categoria, setCategoria] = useState<CategoriaMovimiento>('Materia Prima');
  const [naturaleza, setNaturaleza] = useState<NaturalezaMovimiento>('Negocio');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('pago_movil');
  const [monedaOriginal, setMonedaOriginal] = useState<MonedaOriginal>('VES');
  const [montoOriginal, setMontoOriginal] = useState<string>('');
  const [tasaAplicada, setTasaAplicada] = useState<string>(tasaActual.toString());

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (movimientoAEditar) {
      setTipo(movimientoAEditar.tipo);
      setFecha(movimientoAEditar.fecha);
      setDescripcion(movimientoAEditar.descripcion);
      setCategoria(movimientoAEditar.categoria);
      setNaturaleza(movimientoAEditar.naturaleza);
      setMetodoPago(movimientoAEditar.metodo_pago);
      setMonedaOriginal(movimientoAEditar.moneda_original);
      setMontoOriginal(movimientoAEditar.monto_original.toString());
      setTasaAplicada(movimientoAEditar.tasa_aplicada.toString());
    } else {
      setTipo('gasto');
      setFecha(new Date().toISOString().split('T')[0]);
      setDescripcion('');
      setCategoria('Materia Prima');
      setNaturaleza('Negocio');
      setMetodoPago('pago_movil');
      setMonedaOriginal('VES');
      setMontoOriginal('');
      setTasaAplicada(tasaActual.toString());
    }
    setError(null);
  }, [movimientoAEditar, isOpen, tasaActual]);

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
        tipo,
        naturaleza,
        categoria,
        metodo_pago: metodoPago,
        moneda_original: monedaOriginal,
        monto_original: montoNum,
        tasa_aplicada: tasaNum,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Error guardando movimiento');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-lg bg-white border border-[#E4E4E7] shadow-lg overflow-hidden my-6">
        {/* Encabezado */}
        <div className="bg-[#2C474E] text-white px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">
            {movimientoAEditar ? 'Editar Movimiento' : 'Carga Manual de Movimiento'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-300 hover:text-white p-1 rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {/* Tipo de movimiento: Venta vs Gasto */}
          <div>
            <label className="block font-medium text-[#52525B] mb-1">
              Tipo de Movimiento
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleTipoChange('venta')}
                className={`min-h-[44px] rounded border font-semibold flex items-center justify-center transition-colors ${
                  tipo === 'venta'
                    ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#166534]'
                    : 'bg-white border-[#E4E4E7] text-[#52525B]'
                }`}
              >
                Ingreso / Venta
              </button>
              <button
                type="button"
                onClick={() => handleTipoChange('gasto')}
                className={`min-h-[44px] rounded border font-semibold flex items-center justify-center transition-colors ${
                  tipo === 'gasto'
                    ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                    : 'bg-white border-[#E4E4E7] text-[#52525B]'
                }`}
              >
                Gasto / Egreso
              </button>
            </div>
          </div>

          {/* Fecha */}
          <div>
            <label className="block font-medium text-[#52525B] mb-1">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-[#E4E4E7] rounded bg-white text-[#18181B] font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
              required
            />
          </div>

          {/* Descripción */}
          <div>
            <label className="block font-medium text-[#52525B] mb-1">
              Descripción
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej. Leche condensada, Venta Punto, Cashea..."
              className="w-full min-h-[44px] px-3 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
              required
            />
          </div>

          {/* Categoría y Naturaleza */}
          {tipo === 'gasto' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-[#52525B] mb-1">
                  Categoría de Gasto
                </label>
                <select
                  value={categoria}
                  onChange={(e) => handleCategoriaChange(e.target.value as CategoriaMovimiento)}
                  className="w-full min-h-[44px] px-2.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                >
                  {CATEGORIAS_GASTO.map((cat) => (
                    <option key={cat.nombre} value={cat.nombre}>
                      {cat.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-[#52525B] mb-1">
                  Naturaleza
                </label>
                <select
                  value={naturaleza}
                  onChange={(e) => setNaturaleza(e.target.value as NaturalezaMovimiento)}
                  className="w-full min-h-[44px] px-2.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                >
                  <option value="Negocio">Negocio</option>
                  <option value="Personal">Personal</option>
                  <option value="Créditos / Otros">Créditos / Otros</option>
                </select>
              </div>
            </div>
          )}

          {/* Método de Pago y Moneda */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#52525B] mb-1">
                Método de Pago
              </label>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                className="w-full min-h-[44px] px-2.5 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
              >
                <option value="pago_movil">Pago Móvil</option>
                <option value="punto_venta">Punto de Venta</option>
                <option value="efectivo_bs">Efectivo Bs</option>
                <option value="divisa">Divisa ($)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-[#52525B] mb-1">
                Moneda Original
              </label>
              <div className="grid grid-cols-2 gap-1.5 h-[44px]">
                <button
                  type="button"
                  onClick={() => setMonedaOriginal('VES')}
                  className={`rounded border font-bold flex items-center justify-center transition-colors ${
                    monedaOriginal === 'VES'
                      ? 'bg-[#2C474E] text-white border-[#2C474E]'
                      : 'bg-white border-[#E4E4E7] text-[#52525B]'
                  }`}
                >
                  Bs (VES)
                </button>
                <button
                  type="button"
                  onClick={() => setMonedaOriginal('USD')}
                  className={`rounded border font-bold flex items-center justify-center transition-colors ${
                    monedaOriginal === 'USD'
                      ? 'bg-[#2C474E] text-white border-[#2C474E]'
                      : 'bg-white border-[#E4E4E7] text-[#52525B]'
                  }`}
                >
                  $ (USD)
                </button>
              </div>
            </div>
          </div>

          {/* Monto y Tasa Aplicada */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#52525B] mb-1">
                Monto Original ({monedaOriginal === 'VES' ? 'Bs' : '$'})
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={montoOriginal}
                onChange={(e) => setMontoOriginal(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[44px] px-3 border border-[#E4E4E7] rounded bg-white text-[#18181B] font-bold text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                required
              />
            </div>

            <div>
              <label className="block font-medium text-[#52525B] mb-1">
                Tasa Aplicada (Bs/$)
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={tasaAplicada}
                onChange={(e) => setTasaAplicada(e.target.value)}
                placeholder="100.00"
                className="w-full min-h-[44px] px-3 border border-[#E4E4E7] rounded bg-white text-[#18181B] font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                required
              />
            </div>
          </div>

          {error && (
            <div className="p-2 text-xs text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="flex-1 min-h-[44px] px-3 py-2 text-xs font-semibold border border-[#E4E4E7] bg-white text-[#52525B] rounded hover:bg-zinc-50 active:bg-zinc-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 min-h-[44px] px-3 py-2 text-xs font-semibold bg-[#2C474E] text-white rounded hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1.5"
            >
              <Check size={16} />
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
