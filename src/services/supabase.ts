import { createClient } from '@supabase/supabase-js';
import { ConfigNegocio, Movimiento } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://tu-proyecto.supabase.co' &&
  !supabaseUrl.includes('placeholder')
);

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Claves de respaldo en localStorage por si la red falla o aún no configuran Supabase
const LOCAL_KEY_CONFIG = 'ynacaja_config_negocio';
const LOCAL_KEY_MOVIMIENTOS = 'ynacaja_movimientos';

function getLocalConfig(): ConfigNegocio {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_CONFIG);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error leyendo config local:', e);
  }
  return {
    id: 1,
    nombre_negocio: 'Chicha Adictiva',
    tasa_dia: 100.0,
    updated_at: new Date().toISOString(),
  };
}

function setLocalConfig(config: ConfigNegocio) {
  localStorage.setItem(LOCAL_KEY_CONFIG, JSON.stringify(config));
}

function getLocalMovimientos(): Movimiento[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_MOVIMIENTOS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error leyendo movimientos locales:', e);
  }
  return [];
}

function setLocalMovimientos(movs: Movimiento[]) {
  localStorage.setItem(LOCAL_KEY_MOVIMIENTOS, JSON.stringify(movs));
}

/**
 * Obtiene la configuración del negocio (nombre y tasa del día)
 */
export async function getConfigNegocio(): Promise<ConfigNegocio> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('config_negocio')
        .select('*')
        .eq('id', 1)
        .single();

      if (!error && data) {
        setLocalConfig(data);
        return data;
      }
      console.warn('Supabase config_negocio error, fallback local:', error?.message);
    } catch (err) {
      console.warn('Fallo de red Supabase config:', err);
    }
  }
  return getLocalConfig();
}

/**
 * Actualiza la tasa del día en config_negocio
 */
export async function updateTasaDia(nuevaTasa: number): Promise<ConfigNegocio> {
  const updated: ConfigNegocio = {
    id: 1,
    nombre_negocio: 'Chicha Adictiva',
    tasa_dia: Number(nuevaTasa),
    updated_at: new Date().toISOString(),
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('config_negocio')
        .upsert(updated)
        .select()
        .single();

      if (!error && data) {
        setLocalConfig(data);
        return data;
      }
      console.warn('Error actualizando tasa en Supabase:', error?.message);
    } catch (err) {
      console.warn('Fallo red update tasa:', err);
    }
  }

  setLocalConfig(updated);
  return updated;
}

/**
 * Obtiene todos los movimientos ordenados por fecha descendente
 */
export async function getMovimientos(): Promise<Movimiento[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('movimientos')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (!error && data) {
        setLocalMovimientos(data);
        return data;
      }
      console.warn('Supabase movimientos fetch error:', error?.message);
    } catch (err) {
      console.warn('Fallo red get movimientos:', err);
    }
  }
  return getLocalMovimientos();
}

/**
 * Inserta un lote de movimientos
 */
export async function insertMovimientos(
  movs: Omit<Movimiento, 'id' | 'created_at'>[]
): Promise<Movimiento[]> {
  const newItems: Movimiento[] = movs.map((m) => ({
    ...m,
    id: crypto.randomUUID ? crypto.randomUUID() : `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    created_at: new Date().toISOString(),
  }));

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('movimientos')
        .insert(newItems)
        .select();

      if (!error && data && data.length > 0) {
        const local = getLocalMovimientos();
        const merged = [...data, ...local];
        setLocalMovimientos(merged);
        return data;
      }
      console.warn('Error insertando en Supabase:', error?.message);
    } catch (err) {
      console.warn('Fallo red insert movimientos:', err);
    }
  }

  // Fallback local
  const local = getLocalMovimientos();
  const updated = [...newItems, ...local];
  setLocalMovimientos(updated);
  return newItems;
}

/**
 * Actualiza un movimiento existente
 */
export async function updateMovimiento(mov: Movimiento): Promise<Movimiento> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('movimientos')
        .update({
          fecha: mov.fecha,
          descripcion: mov.descripcion,
          tipo: mov.tipo,
          naturaleza: mov.naturaleza,
          categoria: mov.categoria,
          metodo_pago: mov.metodo_pago,
          moneda_original: mov.moneda_original,
          monto_original: mov.monto_original,
          tasa_aplicada: mov.tasa_aplicada,
        })
        .eq('id', mov.id)
        .select()
        .single();

      if (!error && data) {
        const local = getLocalMovimientos().map((m) => (m.id === mov.id ? data : m));
        setLocalMovimientos(local);
        return data;
      }
      console.warn('Error actualizando movimiento en Supabase:', error?.message);
    } catch (err) {
      console.warn('Fallo red update movimiento:', err);
    }
  }

  // Fallback local
  const local = getLocalMovimientos().map((m) => (m.id === mov.id ? mov : m));
  setLocalMovimientos(local);
  return mov;
}

/**
 * Elimina un movimiento por su ID
 */
export async function deleteMovimiento(id: string): Promise<boolean> {
  if (supabase) {
    try {
      const { error } = await supabase.from('movimientos').delete().eq('id', id);
      if (!error) {
        const local = getLocalMovimientos().filter((m) => m.id !== id);
        setLocalMovimientos(local);
        return true;
      }
      console.warn('Error eliminando en Supabase:', error?.message);
    } catch (err) {
      console.warn('Fallo red delete movimiento:', err);
    }
  }

  const local = getLocalMovimientos().filter((m) => m.id !== id);
  setLocalMovimientos(local);
  return true;
}
