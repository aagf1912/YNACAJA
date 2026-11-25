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
    <div className="bg-white border border-zinc-200/80 rounded-2xl p-4 shadow-xs space-y-3.5">
      {/* Cabecera compacta con título y acciones discretas */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-[#ECFDF5] rounded-lg text-[#1E3A3A] shrink-0">
            <Wallet size={16} />
          </div>
          <h2 className="text-sm font-bold text-[#18181B] tracking-tight truncate">
            Dinero Disponible
          </h2>
          {cargando && <Loader2 size={13} className="animate-spin text-zinc-400 shrink-0" />}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onAbrirSaldoInicial}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 rounded-lg transition-colors min-h-[32px] cursor-pointer"
            title="Ajustar saldo base inicial"
          >
            <SlidersHorizontal size={12} />
            <span>Saldo Inicial</span>
          </button>

          <button
            type="button"
            onClick={onAbrirTransferencia}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#1E3A3A] hover:bg-[#172e2e] rounded-lg transition-colors min-h-[32px] cursor-pointer"
            title="Mover dinero o cambiar moneda"
          >
            <ArrowLeftRight size={12} className="text-[#86EFAC]" />
            <span>Mover / Cambiar</span>
          </button>
        </div>
      </div>

      {/* Total Consolidado Protagonista */}
      <div className="bg-[#F8FAFC] border border-zinc-100 rounded-xl px-3.5 py-2.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-500">Total Consolidado</span>
        <div className="text-right">
          <span
            className={`text-xl sm:text-2xl font-black tabular-nums tracking-tight ${
              totalConsolidadoUsd < 0 ? 'text-red-600' : 'text-[#1E3A3A]'
            }`}
          >
            ${formatNumber(totalConsolidadoUsd)}
          </span>
          <span className="ml-1 text-[11px] font-bold text-zinc-500">USD</span>
          <span className="block text-[11px] text-zinc-400 font-medium tabular-nums">
            ≈ Bs. {formatNumber(totalConsolidadoBs)}
          </span>
        </div>
      </div>

      {/* 3 Bolsillos en cuadrícula compacta de 3 columnas */}
      <div className="grid grid-cols-3 gap-2">
        {/* Digital / Banco */}
        <div className="border border-zinc-100 bg-zinc-50/70 rounded-xl p-2.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1 text-zinc-600 mb-1">
            <Smartphone size={13} className="text-[#1E3A3A] shrink-0" />
            <span className="text-[11px] font-semibold truncate">Digital / Banco</span>
          </div>
          <div className="min-w-0">
            <div
              className={`text-xs sm:text-sm font-bold tabular-nums tracking-tight truncate ${
                digitalBs < 0 ? 'text-red-600' : 'text-[#18181B]'
              }`}
            >
              Bs. {formatNumber(digitalBs)}
            </div>
            <div className="text-[10px] text-zinc-400 tabular-nums truncate mt-0.5">
              ${formatNumber(tasaSegura > 0 ? digitalBs / tasaSegura : 0)}
            </div>
          </div>
        </div>

        {/* Efectivo */}
        <div className="border border-zinc-100 bg-zinc-50/70 rounded-xl p-2.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1 text-zinc-600 mb-1">
            <Banknote size={13} className="text-emerald-600 shrink-0" />
            <span className="text-[11px] font-semibold truncate">Efectivo</span>
          </div>
          <div className="min-w-0">
            <div
              className={`text-xs sm:text-sm font-bold tabular-nums tracking-tight truncate ${
                efectivoBs < 0 ? 'text-red-600' : 'text-[#18181B]'
              }`}
            >
              Bs. {formatNumber(efectivoBs)}
            </div>
            <div className="text-[10px] text-zinc-400 tabular-nums truncate mt-0.5">
              ${formatNumber(tasaSegura > 0 ? efectivoBs / tasaSegura : 0)}
            </div>
          </div>
        </div>

        {/* Divisas */}
        <div className="border border-zinc-100 bg-zinc-50/70 rounded-xl p-2.5 flex flex-col justify-between min-w-0">
          <div className="flex items-center gap-1 text-zinc-600 mb-1">
            <DollarSign size={13} className="text-amber-600 shrink-0" />
            <span className="text-[11px] font-semibold truncate">Divisas</span>
          </div>
          <div className="min-w-0">
            <div
              className={`text-xs sm:text-sm font-bold tabular-nums tracking-tight truncate ${
                divisasUsd < 0 ? 'text-red-600' : 'text-[#18181B]'
              }`}
            >
              ${formatNumber(divisasUsd)}
            </div>
            <div className="text-[10px] text-zinc-400 tabular-nums truncate mt-0.5">
              Bs. {formatNumber(divisasUsd * tasaSegura)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
