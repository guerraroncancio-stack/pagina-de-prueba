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


-- ==========================================================
-- V2: EQUIPOS ILIMITADOS, ROSTERS, ACTIVIDADES Y CLASIFICACIÓN
-- Ejecutar después del esquema base. Las fichas de jugadores
-- pueden tener 6 o 7 integrantes. Las fotos personales quedan privadas.
-- ==========================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','staff','creator','vip','team'));

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text not null,
  manager_name text not null,
  country text not null,
  logo_url text,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create unique index if not exists teams_name_tag_unique on public.teams(lower(name),lower(tag));

create table if not exists public.team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  slot integer not null check(slot between 1 and 7),
  nick text not null,
  game_id text not null,
  age integer not null check(age between 1 and 99),
  country text not null,
  account_photo_path text not null,
  real_photo_path text not null,
  created_at timestamptz not null default now(),
  unique(team_id,slot)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null check(kind in ('relampago','torneo','entreno')),
  starts_at timestamptz not null,
  fee_text text,
  prize_text text,
  payment_instructions text,
  link_url text,
  group_link text,
  room_count integer not null default 0 check(room_count>=0),
  image_url text,
  description text,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.activity_entries (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  manager_name text not null,
  payment_proof_url text,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique(activity_id,team_id)
);

create table if not exists public.team_scores (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  event_title text not null,
  placement integer not null default 1 check(placement>0),
  placement_points numeric(10,2) not null default 0 check(placement_points>=0),
  kills integer not null default 0 check(kills>=0),
  booyah integer not null default 0 check(booyah>=0),
  total_points numeric(10,2) generated always as (placement_points + kills + booyah) stored,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
alter table public.team_players enable row level security;
alter table public.activities enable row level security;
alter table public.activity_entries enable row level security;
alter table public.team_scores enable row level security;

drop policy if exists "public reads approved teams" on public.teams;
create policy "public reads approved teams" on public.teams for select using(status='approved' or public.is_staff());
drop policy if exists "public submits team profiles" on public.teams;
create policy "public submits team profiles" on public.teams for insert to anon,authenticated with check(status='pending');
drop policy if exists "staff manages teams" on public.teams;
create policy "staff manages teams" on public.teams for update using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff deletes teams" on public.teams;
create policy "staff deletes teams" on public.teams for delete using(public.is_staff());

drop policy if exists "staff reads player identity data" on public.team_players;
create policy "staff reads player identity data" on public.team_players for select using(public.is_staff());
drop policy if exists "public submits player profiles" on public.team_players;
create policy "public submits player profiles" on public.team_players for insert to anon,authenticated
with check(exists(select 1 from public.teams t where t.id=team_id and t.status='pending'));
drop policy if exists "staff manages player profiles" on public.team_players;
create policy "staff manages player profiles" on public.team_players for all using(public.is_staff()) with check(public.is_staff());

drop policy if exists "public reads published activities" on public.activities;
create policy "public reads published activities" on public.activities for select using(published=true or public.is_staff());
drop policy if exists "staff manages activities" on public.activities;
create policy "staff manages activities" on public.activities for all using(public.is_staff()) with check(public.is_staff());

drop policy if exists "public applies to activities" on public.activity_entries;
create policy "public applies to activities" on public.activity_entries for insert to anon,authenticated
with check(status='pending' and exists(select 1 from public.activities a where a.id=activity_id and a.published=true)
and exists(select 1 from public.teams t where t.id=team_id and t.status='approved'));
drop policy if exists "staff manages activity entries" on public.activity_entries;
create policy "staff manages activity entries" on public.activity_entries for all using(public.is_staff()) with check(public.is_staff());

drop policy if exists "public reads score leaderboard" on public.team_scores;
create policy "public reads score leaderboard" on public.team_scores for select using(true);
drop policy if exists "staff manages scores" on public.team_scores;
create policy "staff manages scores" on public.team_scores for all using(public.is_staff()) with check(public.is_staff());

-- Bucket: team logos and activity covers are public; player/account photos remain private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('national-public-assets','national-public-assets',true,10485760,array['image/png','image/jpeg','image/webp']),
       ('national-private-assets','national-private-assets',false,10485760,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;

drop policy if exists "public upload national assets" on storage.objects;
drop policy if exists "public upload logos and covers" on storage.objects;
create policy "public upload logos and covers" on storage.objects for insert to anon,authenticated
with check(bucket_id='national-public-assets');
drop policy if exists "public upload private submissions" on storage.objects;
create policy "public upload private submissions" on storage.objects for insert to anon,authenticated
with check(bucket_id='national-private-assets');
drop policy if exists "staff read national assets" on storage.objects;
drop policy if exists "staff read private submissions" on storage.objects;
create policy "staff read private submissions" on storage.objects for select using(bucket_id='national-private-assets' and public.is_staff());
drop policy if exists "staff manage national assets" on storage.objects;
create policy "staff manage private submissions" on storage.objects for all using(bucket_id='national-private-assets' and public.is_staff()) with check(bucket_id='national-private-assets' and public.is_staff());

-- The public site reads approved team names/logos only; personal data stays staff-only.
create or replace function public.get_approved_team_directory()
returns table(id uuid,name text,tag text,country text,logo_url text)
language sql stable security definer set search_path=public
as $$ select t.id,t.name,t.tag,t.country,t.logo_url from public.teams t where t.status='approved' order by t.name; $$;
grant execute on function public.get_approved_team_directory() to anon,authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='teams') then alter publication supabase_realtime add table public.teams; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='activities') then alter publication supabase_realtime add table public.activities; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='team_scores') then alter publication supabase_realtime add table public.team_scores; end if;
end $$;


-- Permisos explícitos para el cliente público y el panel autenticado.
grant select, insert, update, delete on public.teams to anon, authenticated;
grant select, insert, update, delete on public.team_players to anon, authenticated;
grant select, insert, update, delete on public.activities to anon, authenticated;
grant select, insert, update, delete on public.activity_entries to anon, authenticated;
grant select, insert, update, delete on public.team_scores to anon, authenticated;
