-- ======================================================================
-- MIGRACIÓN SUPABASE: MÚLTIPLES PUESTOS, ROLES (ADMIN / VENDEDOR) Y COMISIÓN 22%
-- Archivo: supabase_puestos_migration.sql
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ======================================================================

-- 1. Crear tabla de puestos
CREATE TABLE IF NOT EXISTS public.puestos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 22.00,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

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
