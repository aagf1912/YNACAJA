-- ======================================================================
-- MIGRACIÓN SUPABASE: MÚLTIPLES PUESTOS, ROLES (ADMIN / VENDEDOR) Y COMISIÓN 22%
-- Archivo: supabase_puestos_migration.sql
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ======================================================================

-- 1. Crear tabla de puestos
CREATE TABLE IF NOT EXISTS public.puestos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    comision_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 22.00,
    porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 22.00,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Asegurar columnas si la tabla ya existía
ALTER TABLE public.puestos ADD COLUMN IF NOT EXISTS comision_porcentaje NUMERIC(5,2) DEFAULT 22.00;
ALTER TABLE public.puestos ADD COLUMN IF NOT EXISTS porcentaje_comision NUMERIC(5,2) DEFAULT 22.00;
ALTER TABLE public.puestos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

-- Trigger para mantener sincronizadas comision_porcentaje y porcentaje_comision
CREATE OR REPLACE FUNCTION public.sync_puestos_comision()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.comision_porcentaje IS NOT NULL THEN
    NEW.porcentaje_comision := NEW.comision_porcentaje;
  ELSIF NEW.porcentaje_comision IS NOT NULL THEN
    NEW.comision_porcentaje := NEW.porcentaje_comision;
  ELSE
    NEW.comision_porcentaje := 22.00;
    NEW.porcentaje_comision := 22.00;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_puestos_comision
BEFORE INSERT OR UPDATE ON public.puestos
FOR EACH ROW
EXECUTE FUNCTION public.sync_puestos_comision();

-- 2. Crear tabla de perfiles de usuario
CREATE TABLE IF NOT EXISTS public.perfiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'vendedor')),
    puesto_id UUID REFERENCES public.puestos(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Agregar columnas puesto_id y creado_por a la tabla movimientos
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'movimientos' 
        AND column_name = 'puesto_id'
    ) THEN
        ALTER TABLE public.movimientos 
        ADD COLUMN puesto_id UUID REFERENCES public.puestos(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'movimientos' 
        AND column_name = 'creado_por'
    ) THEN
        ALTER TABLE public.movimientos 
        ADD COLUMN creado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Índices para optimizar consultas por puesto y creador
CREATE INDEX IF NOT EXISTS idx_movimientos_puesto_id ON public.movimientos(puesto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_creado_por ON public.movimientos(creado_por);
CREATE INDEX IF NOT EXISTS idx_perfiles_puesto_id ON public.perfiles(puesto_id);
CREATE INDEX IF NOT EXISTS idx_puestos_activo ON public.puestos(activo);

-- 4. Insertar 2 puestos iniciales si la tabla puestos está vacía
INSERT INTO public.puestos (nombre, porcentaje_comision, activo)
SELECT 'Puesto Principal', 22.00, true
WHERE NOT EXISTS (SELECT 1 FROM public.puestos);

INSERT INTO public.puestos (nombre, porcentaje_comision, activo)
SELECT 'Puesto 2', 22.00, true
WHERE (SELECT COUNT(*) FROM public.puestos) <= 1;

-- 5. Funciones auxiliares de seguridad (SECURITY DEFINER)
-- Retorna el rol del usuario autenticado; si no tiene fila en perfiles, devuelve 'admin' por defecto
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT AS $$
DECLARE
    v_rol TEXT;
BEGIN
    SELECT rol INTO v_rol FROM public.perfiles WHERE id = auth.uid();
    IF v_rol IS NULL THEN
        RETURN 'admin'; -- Acceso admin por defecto para no bloquear acceso inicial
    END IF;
    RETURN v_rol;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Retorna el puesto_id asignado al usuario autenticado
CREATE OR REPLACE FUNCTION public.get_auth_puesto_id()
RETURNS UUID AS $$
DECLARE
    v_puesto_id UUID;
BEGIN
    SELECT puesto_id INTO v_puesto_id FROM public.perfiles WHERE id = auth.uid();
    RETURN v_puesto_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 6. Configurar RLS en tablas

-- Habilitar RLS
ALTER TABLE public.puestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas anteriores en puestos
DROP POLICY IF EXISTS "Admin acceso total puestos" ON public.puestos;
DROP POLICY IF EXISTS "Lectura de puestos activos" ON public.puestos;
DROP POLICY IF EXISTS "Allow anon select puestos" ON public.puestos;

-- Políticas en puestos:
-- Admin: acceso total
CREATE POLICY "Admin acceso total puestos" ON public.puestos
    FOR ALL
    USING (public.get_auth_role() = 'admin')
    WITH CHECK (public.get_auth_role() = 'admin');

-- Vendedores y usuarios autenticados: lectura de puestos activos
CREATE POLICY "Lectura de puestos activos" ON public.puestos
    FOR SELECT
    USING (activo = true);

-- Limpiar políticas anteriores en perfiles
DROP POLICY IF EXISTS "Admin acceso total perfiles" ON public.perfiles;
DROP POLICY IF EXISTS "Vendedor lectura propio perfil" ON public.perfiles;
DROP POLICY IF EXISTS "Vendedor actualizacion propio perfil" ON public.perfiles;

-- Políticas en perfiles:
-- Admin: acceso total
CREATE POLICY "Admin acceso total perfiles" ON public.perfiles
    FOR ALL
    USING (public.get_auth_role() = 'admin')
    WITH CHECK (public.get_auth_role() = 'admin');

-- Vendedor: lectura de su propio perfil
CREATE POLICY "Vendedor lectura propio perfil" ON public.perfiles
    FOR SELECT
    USING (id = auth.uid());

-- Vendedor: actualización de su propio perfil
CREATE POLICY "Vendedor actualizacion propio perfil" ON public.perfiles
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Limpiar políticas permisivas previas en movimientos
DROP POLICY IF EXISTS "Allow anon select movimientos" ON public.movimientos;
DROP POLICY IF EXISTS "Allow anon insert movimientos" ON public.movimientos;
DROP POLICY IF EXISTS "Allow anon update movimientos" ON public.movimientos;
DROP POLICY IF EXISTS "Allow anon delete movimientos" ON public.movimientos;
DROP POLICY IF EXISTS "Admin acceso total movimientos" ON public.movimientos;
DROP POLICY IF EXISTS "Vendedor lectura movimientos hoy" ON public.movimientos;
DROP POLICY IF EXISTS "Vendedor insercion ventas puesto" ON public.movimientos;

-- Políticas en movimientos:
-- Admin: acceso total (SELECT, INSERT, UPDATE, DELETE) a todos los movimientos
CREATE POLICY "Admin acceso total movimientos" ON public.movimientos
    FOR ALL
    USING (public.get_auth_role() = 'admin')
    WITH CHECK (public.get_auth_role() = 'admin');

-- Vendedor: SELECT solo de su propio puesto_id, solo tipo 'venta', solo fecha de hoy (Venezuela UTC-4)
CREATE POLICY "Vendedor lectura movimientos hoy" ON public.movimientos
    FOR SELECT
    USING (
        public.get_auth_role() = 'vendedor'
        AND tipo = 'venta'
        AND puesto_id IS NOT NULL
        AND puesto_id = public.get_auth_puesto_id()
        AND fecha = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '4 hours')::DATE
    );

-- Vendedor: INSERT solo de ventas asignadas a su puesto_id
CREATE POLICY "Vendedor insercion ventas puesto" ON public.movimientos
    FOR INSERT
    WITH CHECK (
        public.get_auth_role() = 'vendedor'
        AND tipo = 'venta'
        AND categoria = 'Ventas'
        AND puesto_id IS NOT NULL
        AND puesto_id = public.get_auth_puesto_id()
    );

-- Vendedor: UPDATE solo de ventas de su propio puesto_id de la fecha de hoy
CREATE POLICY "Vendedor actualizacion ventas hoy" ON public.movimientos
    FOR UPDATE
    USING (
        public.get_auth_role() = 'vendedor'
        AND tipo = 'venta'
        AND puesto_id IS NOT NULL
        AND puesto_id = public.get_auth_puesto_id()
        AND fecha = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '4 hours')::DATE
    )
    WITH CHECK (
        public.get_auth_role() = 'vendedor'
        AND tipo = 'venta'
        AND categoria = 'Ventas'
        AND puesto_id IS NOT NULL
        AND puesto_id = public.get_auth_puesto_id()
    );

-- ======================================================================
-- 7. Funciones RPC para crear y asignar vendedores a puestos (sin cerrar sesión de admin)
-- ======================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Agregar columnas usuario y email a perfiles si no existen
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS usuario TEXT;
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS email TEXT;

CREATE OR REPLACE FUNCTION public.crear_puesto_con_vendedor(
    p_nombre_puesto TEXT,
    p_comision NUMERIC,
    p_usuario_corto TEXT,
    p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_usuario_limpio TEXT;
    v_email TEXT;
    v_puesto_id UUID;
    v_user_id UUID;
    v_encrypted_pw TEXT;
BEGIN
    -- Validar que quien ejecuta sea admin
    IF public.get_auth_role() != 'admin' THEN
        RAISE EXCEPTION 'Solo los administradores pueden crear puestos con usuario.';
    END IF;

    -- Limpiar usuario corto (quitar espacios, arrobas, dominios)
    v_usuario_limpio := lower(trim(regexp_replace(p_usuario_corto, '[@].*$', '')));
    v_usuario_limpio := regexp_replace(v_usuario_limpio, '[^a-z0-9._-]', '', 'g');

    IF length(v_usuario_limpio) < 2 THEN
        RAISE EXCEPTION 'El usuario debe tener al menos 2 caracteres alfanuméricos.';
    END IF;

    IF length(p_password) < 6 THEN
        RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres.';
    END IF;

    v_email := v_usuario_limpio || '@ynacaja.app';

    -- 1. Crear el puesto con comision_porcentaje y porcentaje_comision
    INSERT INTO public.puestos (nombre, comision_porcentaje, porcentaje_comision, activo)
    VALUES (trim(p_nombre_puesto), COALESCE(p_comision, 22.00), COALESCE(p_comision, 22.00), true)
    RETURNING id INTO v_puesto_id;

    -- 2. Crear o actualizar usuario en auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_user_id,
            'authenticated',
            'authenticated',
            v_email,
            v_encrypted_pw,
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('nombre', trim(p_nombre_puesto), 'usuario', v_usuario_limpio),
            now(),
            now()
        );

        BEGIN
            INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
            VALUES (v_user_id, v_user_id, jsonb_build_object('sub', v_user_id::text, 'email', v_email), 'email', now(), now(), now())
            ON CONFLICT DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    ELSE
        UPDATE auth.users
        SET encrypted_password = v_encrypted_pw,
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            updated_at = now()
        WHERE id = v_user_id;
    END IF;

    -- 3. Crear o actualizar perfil como vendedor asignado al nuevo puesto
    INSERT INTO public.perfiles (id, nombre, rol, puesto_id, usuario, email)
    VALUES (v_user_id, trim(p_nombre_puesto), 'vendedor', v_puesto_id, v_usuario_limpio, v_email)
    ON CONFLICT (id) DO UPDATE
    SET nombre = trim(p_nombre_puesto),
        rol = 'vendedor',
        puesto_id = v_puesto_id,
        usuario = v_usuario_limpio,
        email = v_email;

    RETURN jsonb_build_object(
        'success', true,
        'puesto_id', v_puesto_id,
        'user_id', v_user_id,
        'email', v_email,
        'usuario', v_usuario_limpio
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.asignar_vendedor_a_puesto(
    p_puesto_id UUID,
    p_usuario_corto TEXT,
    p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_usuario_limpio TEXT;
    v_email TEXT;
    v_user_id UUID;
    v_puesto_nombre TEXT;
    v_encrypted_pw TEXT;
BEGIN
    -- Validar que quien ejecuta sea admin
    IF public.get_auth_role() != 'admin' THEN
        RAISE EXCEPTION 'Solo los administradores pueden asignar vendedores.';
    END IF;

    SELECT nombre INTO v_puesto_nombre FROM public.puestos WHERE id = p_puesto_id;
    IF v_puesto_nombre IS NULL THEN
        RAISE EXCEPTION 'El puesto especificado no existe.';
    END IF;

    -- Limpiar usuario corto
    v_usuario_limpio := lower(trim(regexp_replace(p_usuario_corto, '[@].*$', '')));
    v_usuario_limpio := regexp_replace(v_usuario_limpio, '[^a-z0-9._-]', '', 'g');

    IF length(v_usuario_limpio) < 2 THEN
        RAISE EXCEPTION 'El usuario debe tener al menos 2 caracteres alfanuméricos.';
    END IF;

    IF length(p_password) < 6 THEN
        RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres.';
    END IF;

    v_email := v_usuario_limpio || '@ynacaja.app';
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_user_id,
            'authenticated',
            'authenticated',
            v_email,
            v_encrypted_pw,
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('nombre', v_puesto_nombre, 'usuario', v_usuario_limpio),
            now(),
            now()
        );

        BEGIN
            INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
            VALUES (v_user_id, v_user_id, jsonb_build_object('sub', v_user_id::text, 'email', v_email), 'email', now(), now(), now())
            ON CONFLICT DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    ELSE
        UPDATE auth.users
        SET encrypted_password = v_encrypted_pw,
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            updated_at = now()
        WHERE id = v_user_id;
    END IF;

    -- Asignar puesto al perfil
    INSERT INTO public.perfiles (id, nombre, rol, puesto_id, usuario, email)
    VALUES (v_user_id, v_puesto_nombre, 'vendedor', p_puesto_id, v_usuario_limpio, v_email)
    ON CONFLICT (id) DO UPDATE
    SET puesto_id = p_puesto_id,
        rol = 'vendedor',
        nombre = v_puesto_nombre,
        usuario = v_usuario_limpio,
        email = v_email;

    RETURN jsonb_build_object(
        'success', true,
        'puesto_id', p_puesto_id,
        'user_id', v_user_id,
        'email', v_email,
        'usuario', v_usuario_limpio
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_puesto_con_vendedor(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asignar_vendedor_a_puesto(UUID, TEXT, TEXT) TO authenticated;
