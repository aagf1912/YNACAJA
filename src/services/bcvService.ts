import { getAccessTokenFromStorage, supabaseAnonKey, supabaseUrl } from '../lib/supabase';
import { getVenezuelaDate } from '../utils/parserLocal';

const CACHE_KEY_TASAS_HISTORICAS = 'ynacaja_tasas_historicas_cache';

function leerCacheTasas(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CACHE_KEY_TASAS_HISTORICAS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function guardarEnCacheTasas(fecha: string, tasa: number): void {
  if (!fecha || !(tasa > 0)) return;
  try {
    const cache = leerCacheTasas();
    cache[fecha] = Math.round(tasa * 100) / 100;
    localStorage.setItem(CACHE_KEY_TASAS_HISTORICAS, JSON.stringify(cache));
  } catch {
    // Ignorar errores de cuota de localStorage
  }
}

/**
 * Obtiene la tasa BCV oficial correspondiente a una fecha (YYYY-MM-DD).
 * - Si es hoy, devuelve tasaActualHoy directamente.
 * - Si es una fecha pasada:
 *   1. Revisa caché local y luego public.movimientos en Supabase.
 *   2. Si no hay registros previos, consulta https://ve.dolarapi.com/v1/historicos/dolares/oficial
 *      (buscando coincidencia exacta o el día hábil inmediato anterior si fue domingo/feriado).
 *   3. Si falla o no hay internet, devuelve tasaActualHoy como respaldo.
 */
export async function obtenerTasaPorFecha(
  fechaYYYYMMDD: string,
  tasaActualHoy: number
): Promise<number> {
  const hoyVzla = getVenezuelaDate();
  if (!fechaYYYYMMDD || fechaYYYYMMDD >= hoyVzla) {
    return tasaActualHoy;
  }

  // 1. Revisar caché local
  const cache = leerCacheTasas();
  if (cache[fechaYYYYMMDD] && Number(cache[fechaYYYYMMDD]) > 0) {
    return Number(cache[fechaYYYYMMDD]);
  }

  // 2. Buscar en public.movimientos de Supabase si ya existe un movimiento con tasa ese día
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const token = getAccessTokenFromStorage() || supabaseAnonKey;

    const res = await fetch(
      `${supabaseUrl}/rest/v1/movimientos?fecha=eq.${fechaYYYYMMDD}&select=tasa_aplicada,created_at&order=created_at.desc&limit=10`,
      {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          const t = Number(item?.tasa_bcv ?? item?.tasa_aplicada ?? item?.tasa ?? 0);
          if (t > 0) {
            const tasaRedondeada = Math.round(t * 100) / 100;
            guardarEnCacheTasas(fechaYYYYMMDD, tasaRedondeada);
            return tasaRedondeada;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Aviso consultando tasa histórica en Supabase:', err);
  }

  // 3. Consultar endpoint histórico público ve.dolarapi.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch('https://ve.dolarapi.com/v1/historicos/dolares/oficial', {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const historico = await res.json();
      if (Array.isArray(historico) && historico.length > 0) {
        // Coincidencia exacta
        const exacta = historico.find(
          (item: any) => item?.fecha === fechaYYYYMMDD && Number(item?.promedio) > 0
        );
        if (exacta) {
          const tasaExacta = Math.round(Number(exacta.promedio) * 100) / 100;
          guardarEnCacheTasas(fechaYYYYMMDD, tasaExacta);
          return tasaExacta;
        }

        // Fecha hábil inmediata anterior (si cayó domingo o feriado)
        const anteriores = historico
          .filter(
            (item: any) =>
              typeof item?.fecha === 'string' &&
              item.fecha <= fechaYYYYMMDD &&
              Number(item?.promedio) > 0
          )
          .sort((a: any, b: any) => b.fecha.localeCompare(a.fecha));

        if (anteriores.length > 0) {
          const tasaAnterior = Math.round(Number(anteriores[0].promedio) * 100) / 100;
          guardarEnCacheTasas(fechaYYYYMMDD, tasaAnterior);
          return tasaAnterior;
        }
      }
    }
  } catch (err) {
    console.warn('Aviso consultando histórico BCV en dolarapi:', err);
  }

  // 4. Respaldo seguro
  return tasaActualHoy;
}
