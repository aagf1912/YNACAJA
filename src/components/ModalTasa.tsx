import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { formatNumber } from '../utils/format';

interface Props {
  isOpen: boolean;
  tasaActual: number;
  onClose: () => void;
  onGuardar: (nuevaTasa: number) => Promise<void>;
}

export const ModalTasa: React.FC<Props> = ({ isOpen, tasaActual, onClose, onGuardar }) => {
  const [valor, setValor] = useState<string>(tasaActual.toString());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(valor.replace(',', '.'));
    if (isNaN(num) || num <= 0) {
      setError('Introduce un valor numérico válido mayor a 0');
      return;
    }

    try {
      setGuardando(true);
      setError(null);
      await onGuardar(num);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Error guardando la tasa');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white border border-[#E4E4E7] shadow-md overflow-hidden">
        {/* Encabezado */}
        <div className="bg-[#2C474E] text-white px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">Actualizar Tasa del Día</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-300 hover:text-white p-1 rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#52525B] mb-1">
              Tasa de Cambio Oficial (Bs / USD)
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0.01"
                autoFocus
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="w-full text-lg font-bold px-3 py-2 border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
                placeholder="Ej. 100.00"
              />
              <span className="absolute right-3 top-2.5 text-xs text-[#52525B] font-semibold">
                Bs/$
              </span>
            </div>
            <p className="mt-1 text-xs text-[#52525B]">
              Tasa actual activa: <span className="font-semibold text-[#18181B] tabular-nums">{formatNumber(tasaActual)} Bs/$</span>
            </p>
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
              className="flex-1 min-h-[44px] px-3 py-2 text-sm font-medium border border-[#E4E4E7] bg-white text-[#52525B] rounded hover:bg-zinc-50 active:bg-zinc-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 min-h-[44px] px-3 py-2 text-sm font-semibold bg-[#2C474E] text-white rounded hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1.5"
            >
              <Check size={16} />
              {guardando ? 'Guardando...' : 'Guardar Tasa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
