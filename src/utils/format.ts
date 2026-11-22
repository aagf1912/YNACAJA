import { Movimiento } from '../types';

/**
 * Formatea un número con separadores de miles y 2 decimales: 12,000.00
 */
export function formatNumber(amount: number, decimals: number = 2): string {
  if (isNaN(amount) || amount === null || amount === undefined) return '0.00';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Calcula los montos en USD y en Bs según la tasa histórica aplicada
 */
export function calcularMontos(movimiento: Pick<Movimiento, 'moneda_original' | 'monto_original' | 'tasa_aplicada'>): {
  monto_usd: number;
  monto_bs: number;
} {
  const tasa = movimiento.tasa_aplicada > 0 ? movimiento.tasa_aplicada : 1;
  const monto = Number(movimiento.monto_original) || 0;

  if (movimiento.moneda_original === 'VES') {
    return {
      monto_usd: monto / tasa,
      monto_bs: monto,
    };
  } else {
    return {
      monto_usd: monto,
      monto_bs: monto * tasa,
    };
  }
}

/**
 * Regla visual obligatoria:
 * - Si es VES: "12,000.00 Bs ($13.12)"
 * - Si es USD: "$15.00"
 */
export function formatMontoMovimiento(movimiento: Pick<Movimiento, 'moneda_original' | 'monto_original' | 'tasa_aplicada'>): string {
  const { monto_usd, monto_bs } = calcularMontos(movimiento);

  if (movimiento.moneda_original === 'VES') {
    return `${formatNumber(monto_bs)} Bs ($${formatNumber(monto_usd)})`;
  } else {
    return `$${formatNumber(monto_usd)}`;
  }
}

/**
 * Formato solo en Dólares: "$123.45"
 */
export function formatUSD(amount: number): string {
  return `$${formatNumber(amount)}`;
}

/**
 * Formato solo en Bolívares: "12,345.00 Bs"
 */
export function formatVES(amount: number): string {
  return `${formatNumber(amount)} Bs`;
}

/**
 * Formato mixto estándar: "12,000.00 Bs ($13.12)"
 */
export function formatMixto(montoBs: number, montoUsd: number): string {
  return `${formatNumber(montoBs)} Bs ($${formatNumber(montoUsd)})`;
}

/**
 * Formatea porcentaje: "12.5%"
 */
export function formatPorcentaje(value: number): string {
  if (isNaN(value) || !isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}
