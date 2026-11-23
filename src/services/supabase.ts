import { createClient, User } from '@supabase/supabase-js';
import { ConfigNegocio, LiquidacionSemanal, Movimiento, PerfilUsuario, Puesto, RolUsuario, TipoMovimiento } from '../types';

// Fallback de configuración pública de Supabase para builds web (ej. Cloudflare Pages)
const FALLBACK_SUPABASE_URL = 'https://xbjywyzuhtbmuusytsty.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_ZuesPOgbvmZ7dVHgfd46_Q_HShdR3L7';

// Limpieza estricta de espacios, saltos de línea y comillas accidentales (Cloudflare Pages)
const cleanEnv = (val: unknown, fallback: string): string => {
  if (typeof val !== 'string') return fallback;
  const cleaned = val.trim().replace(/^["']|["']$/g, '').trim();
  return cleaned || fallback;
};

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL, FALLBACK_SUPABASE_URL);
const supabaseAnonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, FALLBACK_SUPABASE_ANON_KEY);

const isConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://tu-proyecto.supabase.co' &&
  !supabaseUrl.includes('placeholder')
);

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        lock: async (_name, _acquireTimeout, fn) => await fn(),
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Claves de respaldo en localStorage únicamente para contingencia de red en balance y config
const LOCAL_KEY_CONFIG = 'ynacaja_config_negocio';
const LOCAL_KEY_MOVIMIENTOS = 'ynacaja_movimientos';
const LOCAL_KEY_LIQUIDACIONES = 'ynacaja_liquidaciones_semanales';

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

function getLocalLiquidaciones(): LiquidacionSemanal[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_LIQUIDACIONES);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error leyendo liquidaciones locales:', e);
  }
  return [];
}

function setLocalLiquidaciones(liqs: LiquidacionSemanal[]) {
  localStorage.setItem(LOCAL_KEY_LIQUIDACIONES, JSON.stringify(liqs));
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

  const { data: puestosData, error: puestosError } = await supabase
    .from('puestos')
    .select('*')
    .order('created_at', { ascending: true });

  if (puestosError) {
    console.error('Error al consultar puestos:', puestosError);
    throw new Error(`Error al consultar puestos en Supabase: ${puestosError.message} (Código: ${puestosError.code || 'N/A'})`);
  }

  // Consultar perfiles para identificar qué vendedor está asignado a cada puesto
  const perfilesMap: Record<string, { id: string; nombre: string; usuario?: string; email?: string }> = {};
  try {
    const { data: perfilesData, error: perfilesError } = await supabase
      .from('perfiles')
      .select('id, nombre, rol, puesto_id, usuario, email')
      .eq('rol', 'vendedor');

    if (!perfilesError && perfilesData) {
      for (const perf of perfilesData) {
        if (perf.puesto_id) {
          perfilesMap[perf.puesto_id] = {
            id: perf.id,
            nombre: perf.nombre,
            usuario: (perf as any).usuario || perf.nombre,
            email: (perf as any).email || undefined,
          };
        }
      }
    } else if (perfilesError) {
      // Reintentar sin columnas opcionales usuario/email si aún no se han creado en Supabase
      const { data: fallbackData } = await supabase
        .from('perfiles')
        .select('id, nombre, rol, puesto_id')
        .eq('rol', 'vendedor');

      if (fallbackData) {
        for (const perf of fallbackData) {
          if (perf.puesto_id) {
            perfilesMap[perf.puesto_id] = {
              id: perf.id,
              nombre: perf.nombre,
              usuario: perf.nombre,
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn('Aviso consultando perfiles en getPuestos:', e);
  }

  // Intentar obtener correos de puestos vía RPC obtener_usuarios_puestos
  try {
    const { data: rpcUsuarios } = await supabase.rpc('obtener_usuarios_puestos');
    if (Array.isArray(rpcUsuarios)) {
      for (const item of rpcUsuarios) {
        if (item.puesto_id && item.email) {
          const perf = perfilesMap[item.puesto_id];
          if (!perf) {
            perfilesMap[item.puesto_id] = {
              id: '',
              nombre: item.email.split('@')[0],
              usuario: item.email.split('@')[0],
              email: item.email,
            };
          } else {
            perf.email = item.email;
            if (!perf.usuario || perf.usuario.startsWith('Vendedor -')) {
              perf.usuario = item.email.split('@')[0];
            }
          }
        }
      }
    }
  } catch (eRpc) {
    console.warn('Aviso consultando obtener_usuarios_puestos en getPuestos:', eRpc);
  }

  return (puestosData || []).map((p) => {
    const comision = Number(p.comision_porcentaje ?? p.porcentaje_comision ?? 22.00);
    const vendedor = perfilesMap[p.id] || null;
    return {
      ...p,
      comision_porcentaje: comision,
      porcentaje_comision: comision,
      email: vendedor?.email,
      vendedor,
    };
  });
}

export async function obtenerUsuariosPuestos(): Promise<Record<string, string>> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase.rpc('obtener_usuarios_puestos');
    if (error) {
      console.warn('Aviso RPC obtener_usuarios_puestos:', error);
      return {};
    }
    const map: Record<string, string> = {};
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.puesto_id && item.email) {
          map[item.puesto_id] = item.email;
        }
      }
    }
    return map;
  } catch (err) {
    console.warn('Excepción en obtenerUsuariosPuestos:', err);
    return {};
  }
}

export async function actualizarCredencialesPuesto(
  puestoId: string,
  usuarioCorto: string,
  nuevaPassword?: string | null
): Promise<any> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const usuarioLimpio = usuarioCorto.trim().toLowerCase().replace(/[@].*$/, '').replace(/[^a-z0-9._-]/g, '');

  const { data, error } = await supabase.rpc('actualizar_credenciales_puesto', {
    p_puesto_id: puestoId,
    p_usuario_corto: usuarioLimpio,
    p_nueva_password: nuevaPassword && nuevaPassword.trim() ? nuevaPassword.trim() : null,
  });

  if (error) {
    console.error('Error RPC actualizar_credenciales_puesto:', error);
    throw new Error(error.message || 'Error al actualizar credenciales del puesto en Supabase.');
  }

  return data;
}

export async function crearPuestoConVendedor(
  nombrePuesto: string,
  comision: number,
  usuarioCorto: string,
  password: string
): Promise<any> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const usuarioLimpio = usuarioCorto.trim().toLowerCase().replace(/[@].*$/, '').replace(/[^a-z0-9._-]/g, '');

  const { data, error } = await supabase.rpc('crear_puesto_con_vendedor', {
    p_nombre_puesto: nombrePuesto.trim(),
    p_comision: comision,
    p_usuario_corto: usuarioLimpio,
    p_password: password,
  });

  if (error) {
    console.error('Error RPC crear_puesto_con_vendedor:', error);
    throw new Error(error.message || 'Error al crear puesto con vendedor en Supabase.');
  }

  return data;
}

export async function asignarVendedorAPuesto(
  puestoId: string,
  usuarioCorto: string,
  password: string
): Promise<any> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const usuarioLimpio = usuarioCorto.trim().toLowerCase().replace(/[@].*$/, '').replace(/[^a-z0-9._-]/g, '');

  const { data, error } = await supabase.rpc('asignar_vendedor_a_puesto', {
    p_puesto_id: puestoId,
    p_usuario_corto: usuarioLimpio,
    p_password: password,
  });

  if (error) {
    console.error('Error RPC asignar_vendedor_a_puesto:', error);
    throw new Error(error.message || 'Error al asignar vendedor al puesto en Supabase.');
  }

  return data;
}

export async function crearPuesto(puesto: Omit<Puesto, 'id' | 'created_at'>): Promise<Puesto> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const comision = Number(puesto.comision_porcentaje ?? puesto.porcentaje_comision ?? 22.00);

  const { data, error } = await supabase
    .from('puestos')
    .insert({
      nombre: puesto.nombre,
      comision_porcentaje: comision,
      porcentaje_comision: comision,
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

  const comisionRes = Number(data.comision_porcentaje ?? data.porcentaje_comision ?? 22.00);
  return {
    ...data,
    comision_porcentaje: comisionRes,
    porcentaje_comision: comisionRes,
  };
}

export async function actualizarPuesto(puesto: Puesto): Promise<Puesto> {
  if (!supabase) {
    throw new Error('Supabase no está configurado en el cliente.');
  }

  const comision = Number(puesto.comision_porcentaje ?? puesto.porcentaje_comision ?? 22.00);

  const { data, error } = await supabase
    .from('puestos')
    .update({
      nombre: puesto.nombre,
      comision_porcentaje: comision,
      porcentaje_comision: comision,
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

  const comisionRes = Number(data.comision_porcentaje ?? data.porcentaje_comision ?? 22.00);
  return {
    ...data,
    comision_porcentaje: comisionRes,
    porcentaje_comision: comisionRes,
  };
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

      // Si es vendedor, filtrar únicamente por su puesto
      if (rol === 'vendedor' && puestoId) {
        query = query.eq('puesto_id', puestoId);
      }
      // Si es admin, NO filtrar por user_id: se cargan TODOS los registros

      const { data, error } = await query;

      if (!error && data) {
        // Cruzar con puestos para asegurar que todos los movimientos tengan su puesto asociado
        const puestosMap: Record<string, Puesto> = {};
        try {
          const pts = await getPuestos();
          for (const p of pts) {
            puestosMap[p.id] = p;
          }
        } catch {}

        const movimientosCompletos: Movimiento[] = data.map((item: any) => ({
          ...item,
          tipo: (item.tipo === 'ingreso' || item.tipo === 'venta') ? 'venta' : 'gasto',
          puesto: item.puesto || (item.puesto_id ? puestosMap[item.puesto_id] || null : null),
        }));

        setLocalMovimientos(movimientosCompletos);
        return movimientosCompletos;
      }
      console.warn('Supabase movimientos fetch error:', error?.message);
    } catch (err) {
      console.warn('Fallo red get movimientos:', err);
    }
  }
  return getLocalMovimientos();
}

/**
 * Consulta en tiempo real las ventas de HOY para un puesto específico directamente en Supabase
 */
export async function getVentasHoyPuesto(puestoId: string, fecha: string): Promise<Movimiento[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('movimientos')
        .select('*, puesto:puestos(*)')
        .eq('puesto_id', puestoId)
        .eq('fecha', fecha)
        .in('tipo', ['ingreso', 'venta'])
        .order('created_at', { ascending: false });

      if (!error && data) {
        return data.map((item: any) => ({
          ...item,
          tipo: (item.tipo === 'ingreso' || item.tipo === 'venta') ? 'venta' : 'gasto',
        }));
      }
      console.warn('Error consultando ventas hoy en Supabase:', error?.message);
    } catch (err) {
      console.warn('Fallo de red al consultar ventas hoy:', err);
    }
  }

  // Fallback local
  return getLocalMovimientos().filter(
    (m) =>
      m.puesto_id === puestoId &&
      m.fecha === fecha &&
      (m.tipo === 'ingreso' || m.tipo === 'venta')
  );
}

export async function insertMovimientos(
  movs: Omit<Movimiento, 'id' | 'created_at' | 'puesto'>[]
): Promise<Movimiento[]> {
  // Obtener ID del usuario autenticado si no viene explícito
  let authUserId: string | null = null;
  if (supabase) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) authUserId = user.id;
    } catch {}
  }

  const newItems: Movimiento[] = movs.map((m) => {
    const tasa = Number(m.tasa ?? m.tasa_aplicada ?? 100);
    const montoOrig = Number(m.monto_original) || 0;
    const monto_usd = m.monto_usd ?? (m.moneda_original === 'USD' ? montoOrig : (tasa > 0 ? montoOrig / tasa : 0));
    const monto_bs = m.monto_bs ?? (m.moneda_original === 'USD' ? montoOrig * tasa : montoOrig);
    const userId = m.user_id || m.creado_por || authUserId || null;
    // Estándar único: siempre 'venta' para ingresos/ventas y 'gasto' para egresos/gastos
    const tipoNormalizado: TipoMovimiento = (m.tipo === 'ingreso' || m.tipo === 'venta') ? 'venta' : 'gasto';
    const monedaOriginal = m.moneda_original || (m.metodo_pago === 'divisa' ? 'USD' : 'VES');

    return {
      ...m,
      tipo: tipoNormalizado,
      moneda_original: monedaOriginal,
      id: crypto.randomUUID ? crypto.randomUUID() : `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString(),
      tasa_aplicada: tasa,
      tasa: tasa,
      monto_bs: Math.round(monto_bs * 100) / 100,
      monto_usd: Math.round(monto_usd * 100) / 100,
      creado_por: userId,
      user_id: userId,
    };
  });

  if (supabase) {
    try {
      const dbPayload = newItems.map((item) => ({
        id: item.id,
        fecha: item.fecha,
        descripcion: item.descripcion,
        tipo: item.tipo,
        naturaleza: item.naturaleza || 'Negocio',
        categoria: item.categoria || 'Ventas',
        metodo_pago: item.metodo_pago,
        moneda_original: item.moneda_original,
        moneda: item.moneda || item.moneda_original || 'VES',
        monto_original: item.monto_original,
        tasa_aplicada: item.tasa_aplicada,
        tasa: item.tasa ?? item.tasa_aplicada,
        monto_bs: item.monto_bs,
        monto_usd: item.monto_usd,
        puesto_id: item.puesto_id || null,
        creado_por: item.creado_por || item.user_id || null,
        user_id: item.user_id || item.creado_por || null,
      }));

      const insertPromise = supabase
        .from('movimientos')
        .insert(dbPayload)
        .select('*, puesto:puestos(*)');

      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado al guardar en Supabase (10s)')), 10000)
      );

      const { data, error } = await Promise.race([insertPromise, timeoutPromise]);

      if (!error && data && data.length > 0) {
        const local = getLocalMovimientos();
        const merged = [...data, ...local];
        setLocalMovimientos(merged);
        return data;
      }
      if (error) {
        console.error('Error insertando en Supabase:', error.message);
        throw new Error(`Error al guardar en Supabase: ${error.message}`);
      }
    } catch (err: any) {
      console.warn('Fallo red insert movimientos:', err);
      throw err;
    }
  }

  // Fallback local
  const local = getLocalMovimientos();
  const updated = [...newItems, ...local];
  setLocalMovimientos(updated);
  return newItems;
}

export async function updateMovimiento(mov: Movimiento): Promise<Movimiento> {
  const tasa = Number(mov.tasa ?? mov.tasa_aplicada ?? 100);
  const montoOrig = Number(mov.monto_original) || 0;
  const monto_usd = mov.monto_usd ?? (mov.moneda_original === 'USD' ? montoOrig : (tasa > 0 ? montoOrig / tasa : 0));
  const monto_bs = mov.monto_bs ?? (mov.moneda_original === 'USD' ? montoOrig * tasa : montoOrig);
  const userId = mov.user_id || mov.creado_por || null;
  // Estándar único: siempre 'venta' o 'gasto'
  const tipoNormalizado: TipoMovimiento = (mov.tipo === 'ingreso' || mov.tipo === 'venta') ? 'venta' : 'gasto';

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('movimientos')
        .update({
          fecha: mov.fecha,
          descripcion: mov.descripcion,
          tipo: tipoNormalizado,
          naturaleza: mov.naturaleza,
          categoria: mov.categoria,
          metodo_pago: mov.metodo_pago,
          moneda_original: mov.moneda_original,
          moneda: mov.moneda || mov.moneda_original || 'VES',
          monto_original: mov.monto_original,
          tasa_aplicada: tasa,
          tasa: tasa,
          monto_bs: Math.round(monto_bs * 100) / 100,
          monto_usd: Math.round(monto_usd * 100) / 100,
          puesto_id: mov.puesto_id || null,
          creado_por: userId,
          user_id: userId,
        })
        .eq('id', mov.id)
        .select('*, puesto:puestos(*)')
        .single();

      if (!error && data) {
        const local = getLocalMovimientos().map((m) => (m.id === mov.id ? data : m));
        setLocalMovimientos(local);
        return data;
      }
      if (error) {
        console.error('Error actualizando movimiento en Supabase:', error.message);
        throw new Error(`Error al actualizar en Supabase: ${error.message}`);
      }
    } catch (err: any) {
      console.warn('Fallo red update movimiento:', err);
      throw err;
    }
  }

  const local = getLocalMovimientos().map((m) => (m.id === mov.id ? { ...mov, tipo: tipoNormalizado } : m));
  setLocalMovimientos(local);
  return { ...mov, tipo: tipoNormalizado };
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
      if (error) {
        console.error('Error eliminando en Supabase:', error.message);
        throw new Error(`Error al eliminar en Supabase: ${error.message}`);
      }
    } catch (err: any) {
      console.warn('Fallo red delete movimiento:', err);
      throw err;
    }
  }

  const local = getLocalMovimientos().filter((m) => m.id !== id);
  setLocalMovimientos(local);
  return true;
}

/**
 * Elimina todos los movimientos de un puesto en una fecha específica (para reescribir Cierre Diario sin duplicados)
 */
export async function eliminarMovimientosDiaPuesto(puestoId: string, fecha: string): Promise<boolean> {
  if (supabase) {
    try {
      const deletePromise = supabase
        .from('movimientos')
        .delete()
        .eq('puesto_id', puestoId)
        .eq('fecha', fecha);

      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado al eliminar registros previos en Supabase (8s)')), 8000)
      );

      const { error } = await Promise.race([deletePromise, timeoutPromise]);

      if (error) {
        console.warn('Aviso eliminando movimientos previos del puesto en la fecha:', error.message);
      }
    } catch (err) {
      console.warn('Excepción al eliminar movimientos del día en Supabase:', err);
    }
  }

  // Eliminar también en contingencia local
  const local = getLocalMovimientos().filter((m) => !(m.puesto_id === puestoId && m.fecha === fecha));
  setLocalMovimientos(local);
  return true;
}

// ======================================================================
// LIQUIDACIONES SEMANALES (Sueldos y Comisiones)
// ======================================================================

export async function getLiquidacionesSemanales(puestoId?: string): Promise<LiquidacionSemanal[]> {
  if (supabase) {
    try {
      let query = supabase
        .from('liquidaciones_semanales')
        .select('*')
        .order('semana_inicio', { ascending: false });

      if (puestoId) {
        query = query.eq('puesto_id', puestoId);
      }

      const { data, error } = await query;
      if (!error && data) {
        setLocalLiquidaciones(data);
        return data;
      }
      if (error) {
        console.warn('Aviso consultando liquidaciones_semanales en Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Excepción consultando liquidaciones_semanales:', err);
    }
  }

  const local = getLocalLiquidaciones();
  if (puestoId) {
    return local.filter((l) => l.puesto_id === puestoId);
  }
  return local;
}

export async function registrarLiquidacionSemanal(
  liq: Omit<LiquidacionSemanal, 'id' | 'created_at'>
): Promise<LiquidacionSemanal> {
  const nuevaLiq: LiquidacionSemanal = {
    ...liq,
    id: crypto.randomUUID ? crypto.randomUUID() : `liq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    pagado: true,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('liquidaciones_semanales')
        .upsert({
          puesto_id: nuevaLiq.puesto_id,
          semana_inicio: nuevaLiq.semana_inicio,
          semana_fin: nuevaLiq.semana_fin,
          monto_usd: nuevaLiq.monto_usd,
          monto_bs: nuevaLiq.monto_bs,
          tasa: nuevaLiq.tasa,
          pagado: true,
          fecha_pago: nuevaLiq.fecha_pago || new Date().toISOString().split('T')[0],
        })
        .select()
        .maybeSingle();

      if (!error && data) {
        const local = getLocalLiquidaciones().filter(
          (l) => !(l.puesto_id === nuevaLiq.puesto_id && l.semana_inicio === nuevaLiq.semana_inicio)
        );
        local.unshift(data);
        setLocalLiquidaciones(local);
        return data;
      }
      if (error) {
        console.warn('Aviso guardando liquidacion_semanal en Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Excepción guardando liquidacion_semanal:', err);
    }
  }

  // Fallback local
  const local = getLocalLiquidaciones().filter(
    (l) => !(l.puesto_id === nuevaLiq.puesto_id && l.semana_inicio === nuevaLiq.semana_inicio)
  );
  local.unshift(nuevaLiq);
  setLocalLiquidaciones(local);
  return nuevaLiq;
}
