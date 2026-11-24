import React, { useState, useEffect } from 'react';
import { X, Check, Loader2, SlidersHorizontal, Smartphone, Banknote, DollarSign, AlertCircle } from 'lucide-react';
import { SaldosInicialesCaja } from '../types';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  saldosActuales: SaldosInicialesCaja;
  onGuardadoExitoso: () => Promise<void>;
}

export const ModalSaldoInicial: React.FC<Props> = ({
  isOpen,
  onClose,
  saldosActuales,
  onGuardadoExitoso,
}) => {
  const [digitalBs, setDigitalBs] = useState<string>('');
  const [efectivoBs, setEfectivoBs] = useState<string>('');
  const [divisasUsd, setDivisasUsd] = useState<string>('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDigitalBs(String(saldosActuales.digital_bs ?? 0));
      setEfectivoBs(String(saldosActuales.efectivo_bs ?? 0));
      setDivisasUsd(String(saldosActuales.divisas_usd ?? 0));
      setError(null);
    }
  }, [isOpen, saldosActuales]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dBs = parseFloat(digitalBs.replace(',', '.')) || 0;
    const eBs = parseFloat(efectivoBs.replace(',', '.')) || 0;
    const dUsd = parseFloat(divisasUsd.replace(',', '.')) || 0;

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

      // 1. Intentar llamar a la función RPC guardar_saldos_iniciales
      let guardadoOk = false;
      try {
        const resRpc = await fetch(`${supabaseUrl}/rest/v1/rpc/guardar_saldos_iniciales`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_digital_bs: dBs,
            p_efectivo_bs: eBs,
            p_divisas_usd: dUsd,
            digital_bs: dBs,
            efectivo_bs: eBs,
            divisas_usd: dUsd,
          }),
          signal: controller.signal,
        });
        if (resRpc.ok) {
          guardadoOk = true;
        }
      } catch (errRpc) {
        console.warn('RPC guardar_saldos_iniciales falló, intentando upsert directo:', errRpc);
      }

      // 2. Si no fue por RPC, hacer upsert directo en saldos_iniciales_caja
      if (!guardadoOk) {
        const resDirect = await fetch(`${supabaseUrl}/rest/v1/saldos_iniciales_caja?id=eq.1`, {
          method: 'PATCH',
          headers: {
            ...headers,
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            digital_bs: dBs,
            efectivo_bs: eBs,
            divisas_usd: dUsd,
            updated_at: new Date().toISOString(),
          }),
          signal: controller.signal,
        });

        if (!resDirect.ok) {
          // Intentar POST si la fila 1 no existía
          const resPost = await fetch(`${supabaseUrl}/rest/v1/saldos_iniciales_caja`, {
            method: 'POST',
            headers: {
              ...headers,
              Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              id: 1,
              digital_bs: dBs,
              efectivo_bs: eBs,
              divisas_usd: dUsd,
            }),
            signal: controller.signal,
          });
          if (!resPost.ok) {
            const errText = await resPost.text();
            throw new Error(`Error guardando saldos iniciales: ${errText}`);
          }
        }
      }

      clearTimeout(timeoutId);
      await onGuardadoExitoso();
      onClose();
    } catch (err: any) {
      console.error('Error guardando saldos iniciales:', err);
      setError(err?.message || 'Error al guardar los saldos iniciales.');
    } finally {
      clearTimeout(timeoutId);
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-[#E4E4E7]">
        {/* Header */}
        <div className="bg-[#2C474E] text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={17} className="text-[#86EFAC]" />
            <span className="font-bold text-sm">Ajustar Saldo Inicial de Caja</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-300 hover:text-white hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <p className="text-xs text-zinc-600">
            Define el dinero base con el que comenzó la empresa antes de los movimientos registrados.
          </p>

          {/* Input 1: Digital / Banco Bs */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              <span className="flex items-center gap-1.5 text-blue-900">
                <Smartphone size={14} className="text-blue-600" />
                Digital / Banco (Bs)
              </span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                Bs.
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={digitalBs}
                onChange={(e) => setDigitalBs(e.target.value)}
                placeholder="0.00"
                className="w-full pl-10 pr-3 py-2 text-sm font-bold border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
              />
            </div>
          </div>

          {/* Input 2: Efectivo Bs */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              <span className="flex items-center gap-1.5 text-emerald-900">
                <Banknote size={14} className="text-emerald-600" />
                Efectivo (Bs)
              </span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                Bs.
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={efectivoBs}
                onChange={(e) => setEfectivoBs(e.target.value)}
                placeholder="0.00"
                className="w-full pl-10 pr-3 py-2 text-sm font-bold border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
              />
            </div>
          </div>

          {/* Input 3: Divisas USD */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              <span className="flex items-center gap-1.5 text-amber-900">
                <DollarSign size={14} className="text-amber-600" />
                Divisas ($ USD)
              </span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={divisasUsd}
                onChange={(e) => setDivisasUsd(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-2 text-sm font-bold border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E] tabular-nums"
              />
            </div>
          </div>

          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Acciones */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="px-3 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors min-h-[38px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-4 py-2 text-xs font-bold text-white bg-[#2C474E] hover:bg-[#23393e] active:bg-[#1a2b2f] rounded-lg flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-60 min-h-[38px]"
            >
              {guardando ? (
                <>
                  <Loader2 size={14} className="animate-spin text-white" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  <span>Guardar Saldo Inicial</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
