-- NATIONAL TOURNAMENTS / Supabase schema
-- Ejecuta TODO este archivo en Supabase > SQL Editor.
-- RLS protege los datos. Nunca uses la service_role key en el sitio.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','staff')); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null check (kind in ('scrim','tournament','league')),
  game text not null default 'Free Fire',
  starts_at timestamptz not null,
  slots integer not null default 12 check (slots between 1 and 500),
  format text,
  maps text,
  description text,
  status text not null default 'draft' check (status in ('draft','open','closed','live','completed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competition_rooms (
  competition_id uuid primary key references public.competitions(id) on delete cascade,
  room_id text,
  room_password text,
  updated_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  team_name text not null,
  tag text not null,
  manager_name text not null,
  manager_phone text not null,
  manager_discord text,
  players jsonb not null,
  access_code text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  team_name text not null,
  event_title text not null,
  kills integer not null default 0 check (kills >= 0),
  points numeric(10,2) not null default 0 check (points >= 0),
  position integer not null default 1 check (position > 0),
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_rooms enable row level security;
alter table public.registrations enable row level security;
alter table public.news enable row level security;
alter table public.results enable row level security;

drop policy if exists "profile self or admin read" on public.profiles;
create policy "profile self or admin read" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public reads visible competitions" on public.competitions;
create policy "public reads visible competitions" on public.competitions for select using (status <> 'draft' or public.is_staff());
drop policy if exists "staff inserts competitions" on public.competitions;
create policy "staff inserts competitions" on public.competitions for insert with check (public.is_staff());
drop policy if exists "staff updates competitions" on public.competitions;
create policy "staff updates competitions" on public.competitions for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff deletes competitions" on public.competitions;
create policy "staff deletes competitions" on public.competitions for delete using (public.is_staff());

drop policy if exists "staff only room access" on public.competition_rooms;
create policy "staff only room access" on public.competition_rooms for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "public submits pending registrations" on public.registrations;
create policy "public submits pending registrations" on public.registrations for insert to anon, authenticated
with check (
  status = 'pending' and exists (
    select 1 from public.competitions c where c.id = competition_id and c.status = 'open'
  )
);
drop policy if exists "staff reads registrations" on public.registrations;
create policy "staff reads registrations" on public.registrations for select using (public.is_staff());
drop policy if exists "staff updates registrations" on public.registrations;
create policy "staff updates registrations" on public.registrations for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff deletes registrations" on public.registrations;
create policy "staff deletes registrations" on public.registrations for delete using (public.is_staff());

drop policy if exists "public reads published news" on public.news;
create policy "public reads published news" on public.news for select using (published = true or public.is_staff());
drop policy if exists "staff manages news" on public.news;
create policy "staff manages news" on public.news for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "public reads published results" on public.results;
create policy "public reads published results" on public.results for select using (published = true or public.is_staff());
drop policy if exists "staff manages results" on public.results;
create policy "staff manages results" on public.results for all using (public.is_staff()) with check (public.is_staff());

-- Limita cupos incluso si llegan varias solicitudes al mismo tiempo.
create or replace function public.guard_registration_capacity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_status text; v_slots integer; v_count integer;
begin
  select status, slots into v_status, v_slots from public.competitions where id = new.competition_id for update;
  if v_status is distinct from 'open' then raise exception 'REGISTRATION_CLOSED'; end if;
  select count(*) into v_count from public.registrations
    where competition_id = new.competition_id and status in ('pending','approved');
  if v_count >= v_slots then raise exception 'SLOTS_FULL'; end if;
  return new;
end;
$$;
drop trigger if exists registration_capacity_guard on public.registrations;
create trigger registration_capacity_guard before insert on public.registrations
for each row execute procedure public.guard_registration_capacity();

-- Devuelve solo nombres/tags aprobados. Nunca expone teléfono ni roster.
create or replace function public.get_public_teams()
returns table(team_name text, tag text, competition_title text)
language sql stable security definer set search_path = public
as $$
  select r.team_name, r.tag, c.title
  from public.registrations r join public.competitions c on c.id = r.competition_id
  where r.status = 'approved'
  order by r.created_at desc limit 60;
$$;

-- Consulta privada por código de alta entropía. Los datos de sala solo salen si el equipo fue aprobado.
create or replace function public.check_registration(p_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'status', r.status,
    'competition_title', c.title,
    'room_id', case when r.status = 'approved' then cr.room_id else null end,
    'room_password', case when r.status = 'approved' then cr.room_password else null end
  ) into v_result
  from public.registrations r
  join public.competitions c on c.id = r.competition_id
  left join public.competition_rooms cr on cr.competition_id = c.id
  where upper(r.access_code) = upper(trim(p_code))
  limit 1;
  return coalesce(v_result, jsonb_build_object('error','not_found'));
end;
$$;

grant execute on function public.get_public_teams() to anon, authenticated;
grant execute on function public.check_registration(text) to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Realtime: habilita las tablas necesarias si todavía no están publicadas.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='competitions') then
    alter publication supabase_realtime add table public.competitions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='registrations') then
    alter publication supabase_realtime add table public.registrations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='news') then
    alter publication supabase_realtime add table public.news;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='results') then
    alter publication supabase_realtime add table public.results;
  end if;
end $$;
