import React from 'react';
import { NaturalezaMovimiento, TipoMovimiento } from '../types';

interface Props {
  naturaleza: NaturalezaMovimiento;
  tipo?: TipoMovimiento;
  className?: string;
}

export const BadgeNaturaleza: React.FC<Props> = ({ naturaleza, tipo, className = '' }) => {
  if (tipo === 'venta') {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#ECFDF5] border-[#A7F3D0] text-[#166534] ${className}`}
      >
        Venta
      </span>
    );
  }

  switch (naturaleza) {
    case 'Negocio':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#FEF2F2] border-[#FECACA] text-[#991B1B] ${className}`}
        >
          Negocio
        </span>
      );
    case 'Personal':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#FEF3C7] border-[#FDE68A] text-[#92400E] ${className}`}
        >
          Personal
        </span>
      );
    case 'Créditos / Otros':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF] ${className}`}
        >
          Créditos / Otros
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border bg-zinc-100 border-zinc-200 text-zinc-700 ${className}`}
        >
          {naturaleza}
        </span>
      );
  }
};
