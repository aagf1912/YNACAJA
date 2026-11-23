import { createClient, User } from '@supabase/supabase-js';
import { ConfigNegocio, Movimiento, PerfilUsuario, Puesto, RolUsuario } from '../types';

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

// Claves de respaldo en localStorage
const LOCAL_KEY_CONFIG = 'ynacaja_config_negocio';
const LOCAL_KEY_MOVIMIENTOS = 'ynacaja_movimientos';
const LOCAL_KEY_PUESTOS = 'ynacaja_puestos';
const LOCAL_KEY_PERFIL = 'ynacaja_perfil_usuario';

// Puestos iniciales por defecto si no hay conexión
const PUESTOS_DEFAULT: Puesto[] = [
  { id: 'puesto-principal', nombre: 'Puesto Principal', porcentaje_comision: 22.0, activo: true },
  { id: 'puesto-2', nombre: 'Puesto 2', porcentaje_comision: 22.0, activo: true },
];

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

function getLocalPuestos(): Puesto[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_PUESTOS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error leyendo puestos locales:', e);
  }
  return PUESTOS_DEFAULT;
}

function setLocalPuestos(puestos: Puesto[]) {
  localStorage.setItem(LOCAL_KEY_PUESTOS, JSON.stringify(puestos));
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

// ======================================================================
// AUTENTICACIÓN Y PERFIL DE USUARIO
// ======================================================================

export async function getCurrentUser(): Promise<User | null> {
  if (!supabase) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export async function getPerfilUsuario(userId: string): Promise<PerfilUsuario> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('perfiles')
        .select('*, puesto:puestos(*)')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        const perfil: PerfilUsuario = {
          id: data.id,
          nombre: data.nombre || 'Usuario',
          rol: (data.rol as RolUsuario) || 'admin',
          puesto_id: data.puesto_id || null,
          puesto: data.puesto || null,
          created_at: data.created_at,
        };
        localStorage.setItem(LOCAL_KEY_PERFIL, JSON.stringify(perfil));
        return perfil;
      }
    } catch (err) {
      console.warn('Error al consultar perfil en Supabase:', err);
    }
  }

  // Fallback: Si no tiene fila en perfiles, se trata como admin por defecto para Ynaides
  const fallbackPerfil: PerfilUsuario = {
    id: userId,
    nombre: 'Administrador (Ynaides)',
    rol: 'admin',
    puesto_id: null,
    puesto: null,
  };
  localStorage.setItem(LOCAL_KEY_PERFIL, JSON.stringify(fallbackPerfil));
  return fallbackPerfil;
}

export async function signOutUsuario(): Promise<void> {
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Error cerrando sesión:', e);
    }
  }
  localStorage.removeItem(LOCAL_KEY_PERFIL);
}

// ======================================================================
// CONFIGURACIÓN DEL NEGOCIO
// ======================================================================

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
    } catch (err) {
      console.warn('Fallo de red Supabase config:', err);
    }
  }
  return getLocalConfig();
}

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
    } catch (err) {
      console.warn('Fallo red update tasa:', err);
    }
  }

  setLocalConfig(updated);
  return updated;
}

// ======================================================================
// GESTIÓN DE PUESTOS
// ======================================================================

export async function getPuestos(): Promise<Puesto[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('puestos')
        .select('*')
        .order('nombre', { ascending: true });

      if (!error && data && data.length > 0) {
        setLocalPuestos(data);
        return data;
      }
    } catch (err) {
      console.warn('Fallo red get puestos:', err);
    }
  }
  return getLocalPuestos();
}

export async function crearPuesto(puesto: Omit<Puesto, 'id' | 'created_at'>): Promise<Puesto> {
  const nuevoPuesto: Puesto = {
    ...puesto,
    id: crypto.randomUUID ? crypto.randomUUID() : `pto_${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('puestos')
        .insert({
          nombre: puesto.nombre,
          porcentaje_comision: puesto.porcentaje_comision,
          activo: puesto.activo,
        })
        .select()
        .single();

      if (!error && data) {
        const local = getLocalPuestos();
        setLocalPuestos([...local, data]);
        return data;
      }
      console.warn('Error creando puesto en Supabase:', error?.message);
    } catch (err) {
      console.warn('Fallo red crear puesto:', err);
    }
  }

  const local = getLocalPuestos();
  setLocalPuestos([...local, nuevoPuesto]);
  return nuevoPuesto;
}

export async function actualizarPuesto(puesto: Puesto): Promise<Puesto> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('puestos')
        .update({
          nombre: puesto.nombre,
          porcentaje_comision: puesto.porcentaje_comision,
          activo: puesto.activo,
        })
        .eq('id', puesto.id)
        .select()
        .single();

      if (!error && data) {
        const local = getLocalPuestos().map((p) => (p.id === puesto.id ? data : p));
        setLocalPuestos(local);
        return data;
      }
    } catch (err) {
      console.warn('Fallo red actualizar puesto:', err);
    }
  }

  const local = getLocalPuestos().map((p) => (p.id === puesto.id ? puesto : p));
  setLocalPuestos(local);
  return puesto;
}

// ======================================================================
// MOVIMIENTOS CONTABLES
// ======================================================================

export async function getMovimientos(rol?: RolUsuario, puestoId?: string | null): Promise<Movimiento[]> {
  if (supabase) {
    try {
      let query = supabase
        .from('movimientos')
        .select('*, puesto:puestos(*)')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (rol === 'vendedor' && puestoId) {
        query = query.eq('puesto_id', puestoId);
      }

      const { data, error } = await query;

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

export async function insertMovimientos(
  movs: Omit<Movimiento, 'id' | 'created_at' | 'puesto'>[]
): Promise<Movimiento[]> {
  const newItems: Movimiento[] = movs.map((m) => ({
    ...m,
    id: crypto.randomUUID ? crypto.randomUUID() : `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    created_at: new Date().toISOString(),
  }));

  if (supabase) {
    try {
      const dbPayload = newItems.map((item) => ({
        id: item.id,
        fecha: item.fecha,
        descripcion: item.descripcion,
        tipo: item.tipo,
        naturaleza: item.naturaleza,
        categoria: item.categoria,
        metodo_pago: item.metodo_pago,
        moneda_original: item.moneda_original,
        monto_original: item.monto_original,
        tasa_aplicada: item.tasa_aplicada,
        puesto_id: item.puesto_id || null,
        creado_por: item.creado_por || null,
      }));

      const { data, error } = await supabase
        .from('movimientos')
        .insert(dbPayload)
        .select('*, puesto:puestos(*)');

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
          puesto_id: mov.puesto_id || null,
        })
        .eq('id', mov.id)
        .select('*, puesto:puestos(*)')
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

  const local = getLocalMovimientos().map((m) => (m.id === mov.id ? mov : m));
  setLocalMovimientos(local);
  return mov;
}

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
