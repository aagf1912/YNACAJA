-- ======================================================================
-- ESQUEMA SUPABASE - YNACAJA (CHICHA ADICTIVA)
-- ======================================================================

-- 1. Tabla: config_negocio
create table if not exists public.config_negocio (
    id int primary key default 1,
    nombre_negocio text not null default 'Chicha Adictiva',
    tasa_dia numeric(12,4) not null default 100.00,
    updated_at timestamptz default now()
);

-- Habilitar RLS en config_negocio
alter table public.config_negocio enable row level security;

-- Políticas permisivas para anon (app monousuario sin login)
create policy "Allow anon select config" on public.config_negocio
    for select using (true);

create policy "Allow anon insert config" on public.config_negocio
    for insert with check (true);

create policy "Allow anon update config" on public.config_negocio
    for update using (true);

-- Fila inicial id = 1
insert into public.config_negocio (id, nombre_negocio, tasa_dia, updated_at)
values (1, 'Chicha Adictiva', 100.00, now())
on conflict (id) do nothing;


-- 2. Tabla: movimientos
create table if not exists public.movimientos (
    id uuid primary key default gen_random_uuid(),
    fecha date not null,
    descripcion text not null,
    tipo text not null check (tipo in ('venta', 'gasto')),
    naturaleza text not null check (naturaleza in ('Negocio', 'Personal', 'Créditos / Otros')),
    categoria text not null,
    metodo_pago text not null check (metodo_pago in ('pago_movil', 'punto_venta', 'efectivo_bs', 'divisa')),
    moneda_original text not null check (moneda_original in ('VES', 'USD')),
    monto_original numeric(14,2) not null,
    tasa_aplicada numeric(12,4) not null,
    created_at timestamptz default now()
);

-- Índices para optimizar consultas de fechas y tipos
create index if not exists idx_movimientos_fecha on public.movimientos(fecha desc);
create index if not exists idx_movimientos_tipo on public.movimientos(tipo);
create index if not exists idx_movimientos_naturaleza on public.movimientos(naturaleza);

-- Habilitar RLS en movimientos
alter table public.movimientos enable row level security;

-- Políticas permisivas para anon (select, insert, update, delete)
create policy "Allow anon select movimientos" on public.movimientos
    for select using (true);

create policy "Allow anon insert movimientos" on public.movimientos
    for insert with check (true);

create policy "Allow anon update movimientos" on public.movimientos
    for update using (true);

create policy "Allow anon delete movimientos" on public.movimientos
    for delete using (true);
