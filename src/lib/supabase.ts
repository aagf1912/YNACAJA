import { createClient } from '@supabase/supabase-js';

// Fallback de configuración pública de Supabase para builds web (ej. Cloudflare Pages)
const FALLBACK_SUPABASE_URL = 'https://xbjywyzuhtbmuusytsty.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_ZuesPOgbvmZ7dVHgfd46_Q_HShdR3L7';

// Limpieza estricta de espacios, saltos de línea y comillas accidentales
const cleanEnv = (val: unknown, fallback: string): string => {
  if (typeof val !== 'string') return fallback;
  const cleaned = val.trim().replace(/^["']|["']$/g, '').trim();
  return cleaned || fallback;
};

export const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL, FALLBACK_SUPABASE_URL);
export const supabaseAnonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, FALLBACK_SUPABASE_ANON_KEY);

// Obtiene el token de acceso JWT actual de localStorage sin invocar lock de navigator.locks
export function getAccessTokenFromStorage(): string {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.access_token) {
            return parsed.access_token;
          }
        }
      }
    }
  } catch (e) {
    console.warn('Error leyendo auth token de localStorage:', e);
  }
  return '';
}

const isConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://tu-proyecto.supabase.co' &&
  !supabaseUrl.includes('placeholder')
);

// Cliente Supabase con configuración estándar de auth (sin lock personalizado)
export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Re-exportar servicios y utilidades para compatibilidad total
export * from '../services/supabase';
