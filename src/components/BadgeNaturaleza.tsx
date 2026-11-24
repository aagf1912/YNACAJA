import React from 'react';
import { NaturalezaMovimiento, TipoMovimiento } from '../types';

interface Props {
  naturaleza: NaturalezaMovimiento;
  tipo?: TipoMovimiento;
  className?: string;
}

export const BadgeNaturaleza: React.FC<Props> = ({ naturaleza, tipo, className = '' }) => {
  if (tipo === 'venta' || tipo === 'ingreso') {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#ECFDF5] border-[#A7F3D0] text-[#166534] ${className}`}
      >
        Venta
      </span>
    );
  }

  switch (naturaleza) {
    case 'Ventas':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#ECFDF5] border-[#A7F3D0] text-[#166534] ${className}`}
        >
          Venta
        </span>
      );
    case 'Gastos':
    case 'Negocio':
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#FEF2F2] border-[#FECACA] text-[#991B1B] ${className}`}
        >
          Gastos
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
    default:
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-[#FEF2F2] border-[#FECACA] text-[#991B1B] ${className}`}
        >
          Gastos
        </span>
      );
  }
};
