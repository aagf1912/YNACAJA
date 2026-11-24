import React from 'react';
import {
  Wallet,
  Smartphone,
  Banknote,
  DollarSign,
  ArrowLeftRight,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';
import { formatNumber } from '../utils/format';

interface Props {
  digitalBs: number;
  efectivoBs: number;
  divisasUsd: number;
  totalConsolidadoUsd: number;
  totalConsolidadoBs: number;
  tasaBcv: number;
  cargando?: boolean;
  onAbrirSaldoInicial: () => void;
  onAbrirTransferencia: () => void;
}

export const CajaDisponibleCard: React.FC<Props> = ({
  digitalBs,
  efectivoBs,
  divisasUsd,
  totalConsolidadoUsd,
  totalConsolidadoBs,
  tasaBcv,
  cargando = false,
  onAbrirSaldoInicial,
  onAbrirTransferencia,
}) => {
  const tasaSegura = tasaBcv > 0 ? tasaBcv : 100;

  return (
    <div className="bg-white border border-[#E4E4E7] rounded-xl p-3.5 sm:p-4 shadow-xs space-y-3">
      {/* Cabecera del bloque */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-[#ECFDF5] border border-[#BBF7D0] rounded-lg text-[#166534]">
            <Wallet size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-[#18181B] tracking-tight">
                Dinero Disponible de la Empresa
              </h2>
              {cargando && <Loader2 size={13} className="animate-spin text-zinc-400" />}
            </div>
            <p className="text-[11px] text-[#71717A]">
              Saldo real acumulado en cada bolsillo contable (ventas, gastos y cambios)
            </p>
          </div>
        </div>

        {/* Botones de Acción */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={onAbrirSaldoInicial}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#2C474E] bg-white border border-[#E4E4E7] rounded-lg hover:bg-zinc-50 active:bg-zinc-100 shadow-xs transition-colors min-h-[36px]"
            title="Ajustar saldo base inicial de caja"
          >
            <SlidersHorizontal size={14} className="text-[#52525B]" />
            <span>Saldo Inicial</span>
          </button>

          <button
            type="button"
            onClick={onAbrirTransferencia}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2C474E] hover:bg-[#23393e] active:bg-[#1a2b2f] rounded-lg shadow-xs transition-colors min-h-[36px]"
            title="Mover dinero entre bolsillos o registrar cambio de divisas"
          >
            <ArrowLeftRight size={14} className="text-[#86EFAC]" />
            <span>Mover / Cambiar</span>
          </button>
        </div>
      </div>

      {/* Resumen Total Consolidado */}
      <div className="bg-gradient-to-r from-zinc-50 to-slate-50 border border-zinc-200/80 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-600">
          Total Consolidado en Caja:
        </span>
        <div className="flex items-baseline gap-2">
          <span className="text-base sm:text-lg font-black text-[#166534] tabular-nums tracking-tight">
            ${formatNumber(totalConsolidadoUsd)} <span className="text-xs font-bold">USD</span>
          </span>
          <span className="text-xs text-zinc-500 font-medium tabular-nums">
            (≈ Bs. {formatNumber(totalConsolidadoBs)})
          </span>
        </div>
      </div>

      {/* Tarjetas de los 3 bolsillos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Bolsillo 1: Digital / Banco (Bs) */}
        <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-3 flex flex-col justify-between transition-all hover:shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
              <Smartphone size={14} className="text-blue-600" />
              Digital / Banco (Bs)
            </span>
            <span className="text-[10px] font-medium text-blue-700 bg-blue-100/70 px-1.5 py-0.5 rounded">
              PM / Punto
            </span>
          </div>
          <div>
            <div
              className={`text-base sm:text-lg font-black tabular-nums tracking-tight ${
                digitalBs < 0 ? 'text-red-600' : 'text-blue-900'
              }`}
            >
              Bs. {formatNumber(digitalBs)}
            </div>
            <div className="text-[11px] text-zinc-500 font-medium tabular-nums mt-0.5">
              ≈ ${formatNumber(tasaSegura > 0 ? digitalBs / tasaSegura : 0)} USD
            </div>
          </div>
        </div>

        {/* Bolsillo 2: Efectivo (Bs) */}
        <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-3 flex flex-col justify-between transition-all hover:shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
              <Banknote size={14} className="text-emerald-600" />
              Efectivo (Bs)
            </span>
            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded">
              Billetes Bs
            </span>
          </div>
          <div>
            <div
              className={`text-base sm:text-lg font-black tabular-nums tracking-tight ${
                efectivoBs < 0 ? 'text-red-600' : 'text-emerald-900'
              }`}
            >
              Bs. {formatNumber(efectivoBs)}
            </div>
            <div className="text-[11px] text-zinc-500 font-medium tabular-nums mt-0.5">
              ≈ ${formatNumber(tasaSegura > 0 ? efectivoBs / tasaSegura : 0)} USD
            </div>
          </div>
        </div>

        {/* Bolsillo 3: Divisas ($ USD) */}
        <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-3 flex flex-col justify-between transition-all hover:shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
              <DollarSign size={14} className="text-amber-600" />
              Divisas ($ USD)
            </span>
            <span className="text-[10px] font-medium text-amber-700 bg-amber-100/70 px-1.5 py-0.5 rounded">
              Billetes $
            </span>
          </div>
          <div>
            <div
              className={`text-base sm:text-lg font-black tabular-nums tracking-tight ${
                divisasUsd < 0 ? 'text-red-600' : 'text-amber-900'
              }`}
            >
              ${formatNumber(divisasUsd)} USD
            </div>
            <div className="text-[11px] text-zinc-500 font-medium tabular-nums mt-0.5">
              ≈ Bs. {formatNumber(divisasUsd * tasaSegura)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
