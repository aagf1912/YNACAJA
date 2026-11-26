export type TipoMovimiento = 'venta' | 'gasto' | 'ingreso' | 'egreso';

export type NaturalezaMovimiento = 'Negocio' | 'Personal' | 'Gastos' | 'Créditos / Otros' | 'Ventas';

export type CategoriaMovimiento =
  | 'Ventas'
  | 'Nómina / Sueldos'
  | 'Créditos (Cashea / Krece)'
  | 'Materia Prima'
  | 'Personal / Ocio / Regalos'
  | 'Transporte y Logística'
  | 'Insumos y Empaques'
  | 'Comidas y Bebidas'
  | 'Hielo y Varios Operativos'
  | 'Recargas y Servicios'
  | 'Cuota Negocio'
  | 'Equipamiento / Maquinaria'
  | 'Sueldos / Comisiones';

export type MetodoPago = 'pago_movil' | 'punto_venta' | 'efectivo_bs' | 'divisa';

export type MonedaOriginal = 'VES' | 'USD';

export interface Puesto {
  id: string;
  nombre: string;
  porcentaje_comision: number;
  comision_porcentaje?: number;
  activo: boolean;
  created_at?: string;
  email?: string;
  vendedor?: {
    id: string;
    nombre?: string;
    usuario?: string;
    email?: string;
  } | null;
}

export type RolUsuario = 'admin' | 'vendedor';

export interface PerfilUsuario {
  id: string;
  nombre: string;
  rol: RolUsuario;
  puesto_id: string | null;
  puesto?: Puesto | null;
  created_at?: string;
}

export interface Movimiento {
  id: string;
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  tipo: TipoMovimiento;
  naturaleza: NaturalezaMovimiento;
  categoria: CategoriaMovimiento;
  metodo_pago: MetodoPago;
  moneda_original: MonedaOriginal;
  moneda?: string;
  monto_original: number;
  tasa_aplicada: number;
  tasa?: number;
  monto_bs?: number;
  monto_usd?: number;
  puesto_id?: string | null;
  creado_por?: string | null;
  user_id?: string | null;
  puesto?: Puesto | null;
  created_at?: string;
}

export interface ConfigNegocio {
  id: number;
  nombre_negocio: string;
  tasa_dia: number;
  updated_at?: string;
}

export const CATEGORIAS_GASTO: { nombre: CategoriaMovimiento; naturaleza: NaturalezaMovimiento }[] = [
  { nombre: 'Materia Prima', naturaleza: 'Negocio' },
  { nombre: 'Hielo y Varios Operativos', naturaleza: 'Negocio' },
  { nombre: 'Insumos y Empaques', naturaleza: 'Negocio' },
  { nombre: 'Transporte y Logística', naturaleza: 'Negocio' },
  { nombre: 'Recargas y Servicios', naturaleza: 'Negocio' },
  { nombre: 'Cuota Negocio', naturaleza: 'Negocio' },
  { nombre: 'Equipamiento / Maquinaria', naturaleza: 'Negocio' },
  { nombre: 'Sueldos / Comisiones', naturaleza: 'Negocio' },
  { nombre: 'Personal / Ocio / Regalos', naturaleza: 'Personal' },
  { nombre: 'Comidas y Bebidas', naturaleza: 'Personal' },
];

export interface LiquidacionSemanal {
  id?: string;
  puesto_id: string;
  semana_inicio: string; // YYYY-MM-DD (Lunes)
  semana_fin: string;    // YYYY-MM-DD (Sábado)
  total_ventas_usd?: number;
  comision_porcentaje?: number;
  monto_comision_usd?: number;
  monto_usd?: number;
  monto_bs?: number;
  monto_pagado_bs?: number;
  tasa?: number;
  tasa_pago?: number;
  metodo_pago?: string;
  pagado?: boolean;
  fecha_pago?: string;
  movimiento_id?: string | null;
  movimiento_gasto_id?: string | null;
  pagado_por?: string | null;
  created_at?: string;
}

export const METODOS_PAGO_LABELS: Record<MetodoPago, string> = {
  pago_movil: 'Pago Móvil',
  punto_venta: 'Punto de Venta',
  efectivo_bs: 'Efectivo Bs',
  divisa: 'Divisa ($)',
};

export type BolsilloCaja = 'digital_bs' | 'efectivo_bs' | 'divisas_usd';

export const BOLSILLOS_LABELS: Record<BolsilloCaja, string> = {
  digital_bs: 'Digital / Banco (Bs)',
  efectivo_bs: 'Efectivo (Bs)',
  divisas_usd: 'Divisas ($ USD)',
};

export interface SaldosInicialesCaja {
  id?: number;
  digital_bs: number;
  efectivo_bs: number;
  divisas_usd: number;
  fecha_inicio?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TransferenciaCaja {
  id: string;
  fecha: string;
  origen: BolsilloCaja;
  destino: BolsilloCaja;
  monto_origen?: number;
  monto_destino?: number;
  monto?: number;
  monto_salida?: number;
  monto_recibido?: number;
  tasa?: number;
  descripcion?: string;
  concepto?: string;
  creado_por?: string | null;
  created_at?: string;
}
