-- ProvenanceOS — Supabase schema
--
-- Run once: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to re-run. Create your first user BEFORE running (Authentication → Users → Add user,
-- tick "Auto Confirm User"), because the last step authorises every user that exists.
--
-- Design rules
--   * Provenance is an append-only record: the app can read and insert, never update or delete.
--   * Only people listed in public.staff can touch anything (so open sign-ups can't read your data).
--   * The anon (not-signed-in) role has no access at all.
--   * Photos live in a private bucket and are served through short-lived signed URLs.

-- ── Staff allow-list ────────────────────────────────────────────────────────────────────────
create table if not exists public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.staff where user_id = (select auth.uid())) $$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

drop policy if exists "staff see their own membership" on public.staff;
create policy "staff see their own membership" on public.staff
  for select to authenticated using (user_id = (select auth.uid()));

-- ── Samples ─────────────────────────────────────────────────────────────────────────────────
-- IDs are assigned by the database (AND-000001, AND-000002, …) so two phones can never collide.
create sequence if not exists public.sample_seq;

create table if not exists public.samples (
  id          text primary key
              default ('AND-' || lpad(nextval('public.sample_seq')::text, 6, '0'))
              check (id ~ '^[A-Z]{3}-[0-9]{6,}$'),
  location    text        not null default '',
  sample_type text        not null default 'Rough opal',
  weight_g    numeric(10,3) check (weight_g is null or weight_g >= 0),
  dimensions  text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid()
);

-- ── Photos (files are in Storage; this table is the evidence record) ───────────────────────
create table if not exists public.sample_images (
  id           uuid primary key default gen_random_uuid(),
  sample_id    text not null references public.samples (id) on delete restrict,
  storage_path text not null unique,
  thumb_path   text,
  file_name    text,
  content_type text,
  size_bytes   bigint,
  sha256       text,                       -- hash of the original file, for integrity checks
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index if not exists sample_images_sample_idx on public.sample_images (sample_id, created_at);

-- ── pXRF analyses: one row per Vanta reading ───────────────────────────────────────────────
-- results = { "Fe": { "value": 1780.74, "error": 12.1, "unit": "ppm", "lod": false }, … }
--           (below-detection readings have value = null and lod = true)
-- raw     = the original CSV row, untouched
create table if not exists public.analyses (
  id            uuid primary key default gen_random_uuid(),
  sample_id     text not null references public.samples (id) on delete restrict,
  instrument    text not null default 'Vanta',
  method        text,
  reading_no    text,
  measured_at   timestamptz,
  results       jsonb not null,
  raw           jsonb,
  source_file   text,
  source_sha256 text,
  reading_hash  text not null,             -- hash of the raw row: re-importing a file can't duplicate readings
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  unique (sample_id, reading_hash)
);
create index if not exists analyses_sample_idx on public.analyses (sample_id, measured_at desc);

-- ── History: filled by triggers, never by the browser ──────────────────────────────────────
create table if not exists public.sample_events (
  id         bigint generated always as identity primary key,
  sample_id  text not null references public.samples (id) on delete restrict,
  kind       text not null,                -- registered | photographed | analysed
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists sample_events_sample_idx on public.sample_events (sample_id, created_at desc);
create index if not exists sample_events_recent_idx on public.sample_events (created_at desc);

create or replace function public.log_sample_registered()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.sample_events (sample_id, kind, detail)
  values (new.id, 'registered', jsonb_build_object('location', new.location, 'sample_type', new.sample_type));
  return new;
end $$;

create or replace function public.log_image_added()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.sample_events (sample_id, kind, detail)
  values (new.sample_id, 'photographed', jsonb_build_object('file_name', new.file_name, 'sha256', new.sha256));
  return new;
end $$;

-- Statement-level, so importing 40 readings logs one event, not forty.
create or replace function public.log_analyses_added()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.sample_events (sample_id, kind, detail)
  select sample_id, 'analysed',
         jsonb_build_object('readings', count(*), 'instrument', min(instrument), 'source_file', min(source_file))
  from new_rows group by sample_id;
  return null;
end $$;

revoke all on function public.log_sample_registered(), public.log_image_added(), public.log_analyses_added()
  from public, anon, authenticated;

drop trigger if exists samples_registered on public.samples;
create trigger samples_registered after insert on public.samples
  for each row execute function public.log_sample_registered();

drop trigger if exists images_logged on public.sample_images;
create trigger images_logged after insert on public.sample_images
  for each row execute function public.log_image_added();

drop trigger if exists analyses_logged on public.analyses;
create trigger analyses_logged after insert on public.analyses
  referencing new table as new_rows
  for each statement execute function public.log_analyses_added();

-- ── List view the app reads (RLS of the underlying tables still applies) ───────────────────
create or replace view public.sample_overview with (security_invoker = true) as
select s.*,
       (select count(*) from public.sample_images i where i.sample_id = s.id) as image_count,
       (select count(*) from public.analyses a      where a.sample_id = s.id) as analysis_count,
       c.storage_path as cover_path,
       c.thumb_path   as cover_thumb_path
from public.samples s
left join lateral (
  select i.storage_path, i.thumb_path
  from public.sample_images i
  where i.sample_id = s.id
  order by i.created_at
  limit 1
) c on true;

-- Preview of the ID the next registration will get (the database still decides the real one).
create or replace function public.peek_next_sample_id()
returns text
language sql security definer set search_path = ''
as $$
  select case when public.is_staff() then
    (select 'AND-' || lpad((case when is_called then last_value + 1 else last_value end)::text, 6, '0')
       from public.sample_seq)
  end
$$;
revoke all on function public.peek_next_sample_id() from public, anon;
grant execute on function public.peek_next_sample_id() to authenticated;

-- ── Row level security ─────────────────────────────────────────────────────────────────────
alter table public.samples       enable row level security;
alter table public.sample_images enable row level security;
alter table public.analyses      enable row level security;
alter table public.sample_events enable row level security;

drop policy if exists "staff read samples"   on public.samples;
drop policy if exists "staff add samples"    on public.samples;
create policy "staff read samples" on public.samples for select to authenticated using ((select public.is_staff()));
create policy "staff add samples"  on public.samples for insert to authenticated with check ((select public.is_staff()));

drop policy if exists "staff read images" on public.sample_images;
drop policy if exists "staff add images"  on public.sample_images;
create policy "staff read images" on public.sample_images for select to authenticated using ((select public.is_staff()));
create policy "staff add images"  on public.sample_images for insert to authenticated with check ((select public.is_staff()));

drop policy if exists "staff read analyses" on public.analyses;
drop policy if exists "staff add analyses"  on public.analyses;
create policy "staff read analyses" on public.analyses for select to authenticated using ((select public.is_staff()));
create policy "staff add analyses"  on public.analyses for insert to authenticated with check ((select public.is_staff()));

drop policy if exists "staff read events" on public.sample_events;
create policy "staff read events" on public.sample_events for select to authenticated using ((select public.is_staff()));

-- ── Table privileges: least privilege, nothing for anon ────────────────────────────────────
revoke all on public.staff, public.samples, public.sample_images, public.analyses,
              public.sample_events, public.sample_overview from anon, authenticated;

grant select         on public.staff, public.sample_events, public.sample_overview to authenticated;
grant select, insert on public.samples, public.sample_images, public.analyses       to authenticated;
grant usage          on sequence public.sample_seq to authenticated;

-- ── Photo storage: private bucket, staff can upload and read, nobody can overwrite or delete ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sample-images', 'sample-images', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff read sample images"   on storage.objects;
drop policy if exists "staff upload sample images" on storage.objects;
create policy "staff read sample images" on storage.objects
  for select to authenticated using (bucket_id = 'sample-images' and (select public.is_staff()));
create policy "staff upload sample images" on storage.objects
  for insert to authenticated with check (bucket_id = 'sample-images' and (select public.is_staff()));

-- ── Authorise everyone who currently exists in Authentication → Users ──────────────────────
-- To add a colleague later: create them under Authentication → Users, then re-run just this statement
-- (or:  insert into public.staff (user_id) select id from auth.users where email = 'them@example.com';)
insert into public.staff (user_id)
select id from auth.users
on conflict do nothing;

notify pgrst, 'reload schema';
