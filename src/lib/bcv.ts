/**
 * Consulta la tasa oficial del BCV (Banco Central de Venezuela).
 * 1. Intenta con https://ve.dolarapi.com/v1/dolares/oficial (timeout 4s).
 * 2. Si falla o tarda, realiza fallback automático a https://rates.dolarvzla.com/bcv/current.json.
 * Retorna el valor numérico redondeado a 2 decimales.
 */
export async function obtenerTasaBCVOficial(): Promise<number> {
  // 1. Intento primario con ve.dolarapi.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const val = Number(data?.promedio ?? data?.price ?? data?.venta);
      if (!isNaN(val) && val > 0) {
        return Math.round(val * 100) / 100;
      }
    }
  } catch (err) {
    console.warn('Fallo o timeout en dolarapi.com, intentando fallback...', err);
  }

  // 2. Fallback con rates.dolarvzla.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://rates.dolarvzla.com/bcv/current.json', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const val = Number(data?.current?.usd ?? data?.usd ?? data?.current?.price);
      if (!isNaN(val) && val > 0) {
        return Math.round(val * 100) / 100;
      }
    }
  } catch (err) {
    console.warn('Fallo en fallback dolarvzla.com:', err);
  }

  throw new Error('No se pudo obtener la tasa oficial del BCV.');
}
