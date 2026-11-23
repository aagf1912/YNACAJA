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

// Claves de respaldo en localStorage únicamente para contingencia de red en balance y config
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

      if (error) {
        console.warn('Error consultando perfil en Supabase:', error.message);
      }

      if (data) {
        return {
          id: data.id,
          nombre: data.nombre || 'Usuario',
          rol: (data.rol as RolUsuario) || 'admin',
          puesto_id: data.puesto_id || null,
          puesto: data.puesto || null,
          created_at: data.created_at,
        };
      }
    } catch (err) {
      console.warn('Error al consultar perfil en Supabase:', err);
    }
  }

  // Fallback: Si no tiene fila en perfiles, se trata como admin por defecto para Ynaides
  return {
    id: userId,
    nombre: 'Administrador (Ynaides)',
    rol: 'admin',
    puesto_id: null,
    puesto: null,
  };
}

export async function actualizarRolUsuario(
  userId: string,
  nuevoRol: RolUsuario,
  puestoId: string | null = null
): Promise<PerfilUsuario> {
  if (supabase) {
    try {
      // 1. Intentar primero con UPDATE por si el usuario no tiene permisos de INSERT
      const { data: updateData, error: updateError } = await supabase
        .from('perfiles')
        .update({
          nombre: nuevoRol === 'admin' ? 'Administrador (Ynaides)' : 'Vendedor',
          rol: nuevoRol,
          puesto_id: nuevoRol === 'admin' ? null : puestoId,
        })
        .eq('id', userId)
        .select('*, puesto:puestos(*)')
        .maybeSingle();

      if (!updateError && updateData) {
        return {
          id: updateData.id,
          nombre: updateData.nombre || (nuevoRol === 'admin' ? 'Administrador (Ynaides)' : 'Vendedor'),
          rol: updateData.rol as RolUsuario,
          puesto_id: updateData.puesto_id || null,
          puesto: updateData.puesto || null,
          created_at: updateData.created_at,
        };
      }

      // 2. Si no había fila previa, intentar upsert
      const { data, error } = await supabase
        .from('perfiles')
        .upsert({
          id: userId,
          nombre: nuevoRol === 'admin' ? 'Administrador (Ynaides)' : 'Vendedor',
          rol: nuevoRol,
          puesto_id: nuevoRol === 'admin' ? null : puestoId,
        })
        .select('*, puesto:puestos(*)')
        .single();

      if (!error && data) {
        return {
          id: data.id,
          nombre: data.nombre || (nuevoRol === 'admin' ? 'Administrador (Ynaides)' : 'Vendedor'),
          rol: data.rol as RolUsuario,
          puesto_id: data.puesto_id || null,
          puesto: data.puesto || null,
          created_at: data.created_at,
        };
      }

      if (error || updateError) {
        console.warn('Aviso actualizando rol en Supabase:', error || updateError);
      }
    } catch (err: any) {
      console.warn('Excepción al actualizar rol en Supabase:', err);
    }
  }

  return {
    id: userId,
    nombre: nuevoRol === 'admin' ? 'Administrador (Ynaides)' : 'Vendedor',
    rol: nuevoRol,
    puesto_id: nuevoRol === 'admin' ? null : puestoId,
    puesto: null,
  };
}

export async function signOutUsuario(): Promise<void> {
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Error cerrando sesión:', e);
    }
  }
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
// GESTIÓN DE PUESTOS (Directamente desde Supabase)
// ======================================================================

export async function getPuestos(): Promise<Puesto[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('puestos')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error al consultar puestos:', error);
    throw new Error(`Error al consultar puestos en Supabase: ${error.message} (Código: ${error.code || 'N/A'})`);
  }

  return data || [];
}

export async function crearPuesto(puesto: Omit<Puesto, 'id' | 'created_at'>): Promise<Puesto> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const { data, error } = await supabase
    .from('puestos')
    .insert({
      nombre: puesto.nombre,
      porcentaje_comision: puesto.porcentaje_comision,
      activo: puesto.activo,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creando puesto:', error);
    throw new Error(`Error al crear puesto en Supabase: ${error.message} (Código: ${error.code || 'N/A'}${error.details ? ` - ${error.details}` : ''})`);
  }

  if (!data) {
    throw new Error('No se recibió el puesto creado desde Supabase.');
  }

  return data;
}

export async function actualizarPuesto(puesto: Puesto): Promise<Puesto> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

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

  if (error) {
    console.error('Error actualizando puesto:', error);
    throw new Error(`Error al actualizar puesto en Supabase: ${error.message} (Código: ${error.code || 'N/A'}${error.details ? ` - ${error.details}` : ''})`);
  }

  if (!data) {
    throw new Error('No se recibió el puesto actualizado desde Supabase.');
  }

  return data;
}

export async function eliminarPuesto(id: string): Promise<boolean> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const { error } = await supabase
    .from('puestos')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error eliminando puesto:', error);
    throw new Error(`Error al eliminar puesto en Supabase: ${error.message} (Código: ${error.code || 'N/A'}${error.details ? ` - ${error.details}` : ''})`);
  }

  return true;
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
