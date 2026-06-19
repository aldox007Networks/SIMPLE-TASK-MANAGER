-- ============================================================
--  CENTRO DE OPERACIONES — Esquema de base de datos
--  Pega TODO este texto en Supabase → SQL Editor → Run (una sola vez)
-- ============================================================

-- 1) TABLA DE PERFILES (usuarios del equipo)
-- Se conecta con el sistema de login de Supabase (auth.users)
create table if not exists perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'member',   -- 'admin' o 'member'
  creado      timestamptz default now()
);

-- 2) EMPRESAS (catálogo de lugares donde se ejecutan actividades)
create table if not exists empresas (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  contacto  text,
  direccion text,
  creado    timestamptz default now()
);

-- 3) ACTIVIDADES
create table if not exists actividades (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  descripcion   text,
  empresa_id    uuid references empresas(id) on delete set null,
  asignado_a    uuid references perfiles(id) on delete set null,
  progreso      int default 0,
  fotos         jsonb default '[]',              -- URLs de fotos de referencia
  aprobacion_solicitada boolean default false,
  aprobada      boolean default false,
  creado_por    uuid references perfiles(id),
  creado        timestamptz default now()
);

-- 4) AVANCES (bitácora de cada actividad)
create table if not exists avances (
  id            uuid primary key default gen_random_uuid(),
  actividad_id  uuid references actividades(id) on delete cascade,
  autor_id      uuid references perfiles(id),
  texto         text,
  fotos         jsonb default '[]',
  progreso      int default 0,
  creado        timestamptz default now()
);

-- 5) NOTIFICACIONES (campana dentro de la app)
create table if not exists notificaciones (
  id            uuid primary key default gen_random_uuid(),
  destinatario  uuid references perfiles(id) on delete cascade,
  texto         text not null,
  actividad_id  uuid references actividades(id) on delete cascade,
  tipo          text default 'info',
  leida         boolean default false,
  creado        timestamptz default now()
);

-- ============================================================
--  SEGURIDAD (RLS) — deja que usuarios autenticados trabajen
-- ============================================================
alter table perfiles        enable row level security;
alter table empresas        enable row level security;
alter table actividades     enable row level security;
alter table avances         enable row level security;
alter table notificaciones  enable row level security;

-- Política simple: cualquier usuario con sesión iniciada puede leer/escribir.
-- (Suficiente para un equipo interno de confianza. Más adelante se puede afinar.)
create policy "perfiles_rw"       on perfiles       for all to authenticated using (true) with check (true);
create policy "empresas_rw"       on empresas       for all to authenticated using (true) with check (true);
create policy "actividades_rw"    on actividades    for all to authenticated using (true) with check (true);
create policy "avances_rw"        on avances        for all to authenticated using (true) with check (true);
create policy "notificaciones_rw" on notificaciones for all to authenticated using (true) with check (true);

-- ============================================================
--  CREAR PERFIL AUTOMÁTICO al registrarse un usuario nuevo
-- ============================================================
create or replace function crear_perfil()
returns trigger as $$
begin
  insert into perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    coalesce(new.raw_user_meta_data->>'rol', 'member')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function crear_perfil();

-- ============================================================
--  REALTIME (notificaciones y cambios en vivo)
-- ============================================================
alter publication supabase_realtime add table actividades;
alter publication supabase_realtime add table avances;
alter publication supabase_realtime add table notificaciones;

-- ¡Listo! Ahora crea el bucket de fotos (ver guía, Paso 4).
