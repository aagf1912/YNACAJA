import { CategoriaMovimiento, MetodoPago, MonedaOriginal, NaturalezaMovimiento, TipoMovimiento } from '../types';

export interface ExtractedMovimiento {
  fecha: string;
  descripcion: string;
  tipo: TipoMovimiento;
  naturaleza: NaturalezaMovimiento;
  categoria: CategoriaMovimiento;
  metodo_pago: MetodoPago;
  moneda_original: MonedaOriginal;
  monto_original: number;
}

export interface AnalizarResponse {
  movimientos: ExtractedMovimiento[];
}

export async function analizarTextoMovimientos(
  texto: string,
  fechaActual: string,
  rol: 'admin' | 'vendedor' = 'admin'
): Promise<ExtractedMovimiento[]> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const endpoint = baseUrl ? `${baseUrl}/api/analizar` : '/api/analizar';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texto,
      fecha_actual: fechaActual,
      rol,
    }),
  });

  if (!response.ok) {
    let errorMsg = `Error en el servidor (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error) errorMsg = errJson.error;
    } catch {
      const text = await response.text();
      if (text) errorMsg = text;
    }
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as AnalizarResponse;
  if (!data?.movimientos || !Array.isArray(data.movimientos)) {
    throw new Error('La respuesta del analizador no contiene la lista de movimientos esperada.');
  }

  return data.movimientos;
}
