export type TipoMovimiento = 'venta' | 'gasto';

export type NaturalezaMovimiento = 'Negocio' | 'Personal' | 'Créditos / Otros';

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
  | 'Recargas y Servicios';

export type MetodoPago = 'pago_movil' | 'punto_venta' | 'efectivo_bs' | 'divisa';

export type MonedaOriginal = 'VES' | 'USD';

export interface Movimiento {
  id: string;
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  tipo: TipoMovimiento;
  naturaleza: NaturalezaMovimiento;
  categoria: CategoriaMovimiento;
  metodo_pago: MetodoPago;
  moneda_original: MonedaOriginal;
  monto_original: number;
  tasa_aplicada: number;
  created_at?: string;
}

export interface ConfigNegocio {
  id: number;
  nombre_negocio: string;
  tasa_dia: number;
  updated_at?: string;
}

export const CATEGORIAS_GASTO: { nombre: CategoriaMovimiento; naturaleza: NaturalezaMovimiento }[] = [
  { nombre: 'Nómina / Sueldos', naturaleza: 'Negocio' },
  { nombre: 'Créditos (Cashea / Krece)', naturaleza: 'Créditos / Otros' },
  { nombre: 'Materia Prima', naturaleza: 'Negocio' },
  { nombre: 'Personal / Ocio / Regalos', naturaleza: 'Personal' },
  { nombre: 'Transporte y Logística', naturaleza: 'Negocio' },
  { nombre: 'Insumos y Empaques', naturaleza: 'Negocio' },
  { nombre: 'Comidas y Bebidas', naturaleza: 'Personal' },
  { nombre: 'Hielo y Varios Operativos', naturaleza: 'Negocio' },
  { nombre: 'Recargas y Servicios', naturaleza: 'Negocio' },
];

export const METODOS_PAGO_LABELS: Record<MetodoPago, string> = {
  pago_movil: 'Pago Móvil',
  punto_venta: 'Punto de Venta',
  efectivo_bs: 'Efectivo Bs',
  divisa: 'Divisa ($)',
};
