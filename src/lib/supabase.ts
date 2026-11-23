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

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL, FALLBACK_SUPABASE_URL);
const supabaseAnonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, FALLBACK_SUPABASE_ANON_KEY);

const isConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://tu-proyecto.supabase.co' &&
  !supabaseUrl.includes('placeholder')
);

// Cliente Supabase con lock desbloqueado para evitar congelamiento de navigator.locks (10s) con Realtime
export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        lock: async (_name, _acquireTimeout, fn) => await fn(),
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Re-exportar servicios y utilidades para compatibilidad total
export * from '../services/supabase';
