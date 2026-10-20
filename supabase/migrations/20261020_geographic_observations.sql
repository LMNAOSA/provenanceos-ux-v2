-- Geographic evidence, staged only. Review and apply separately; do not run in production automatically.
-- Exact field coordinates are commercially sensitive. Initial access matches the existing
-- private specimen evidence policy (authenticated staff only); implement narrower roles before
-- exposing this dataset to guests, public users, or third-party map services.
create table if not exists public.geographic_observations (
  id uuid primary key default gen_random_uuid(),
  sample_id text not null references public.samples(id) on delete restrict,
  sample_image_id uuid references public.sample_images(id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  source_type text not null check (source_type in ('photo_exif','device_gps','reported_origin','verified_origin')),
  coordinate_datum text not null default 'WGS84' check (coordinate_datum = 'WGS84'),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  altitude_m double precision,
  captured_at text, -- EXIF clock often lacks a reliable UTC offset: preserve its literal value.
  source_sha256 text,
  source_file_name text,
  extraction_version text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','reviewed','verified','rejected')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint geo_observation_source_file check (
    source_type not in ('photo_exif','device_gps') or sample_image_id is not null
  )
);
create unique index if not exists geographic_obs_image_source_unique
  on public.geographic_observations(sample_image_id,source_type)
  where sample_image_id is not null;
create index if not exists geographic_obs_sample_idx on public.geographic_observations(sample_id);
create index if not exists geographic_obs_location_idx on public.geographic_observations(latitude,longitude);
alter table public.geographic_observations enable row level security;
revoke all on public.geographic_observations from anon;
grant select, insert on public.geographic_observations to authenticated;
-- No direct UPDATE or DELETE: original observations are append-only from regular clients.
drop policy if exists "geo_staff_read" on public.geographic_observations;
create policy "geo_staff_read" on public.geographic_observations for select
  to authenticated using ((select public.is_staff()));
drop policy if exists "geo_staff_insert" on public.geographic_observations;
create policy "geo_staff_insert" on public.geographic_observations for insert
  to authenticated with check (
    (select public.is_staff()) and created_by = (select auth.uid())
    and (sample_image_id is null or exists (
      select 1 from public.sample_images si
      where si.id=sample_image_id and si.sample_id=geographic_observations.sample_id
    ))
  );
-- EXIF backfill is idempotent via insert-if-missing at the application layer.
comment on table public.geographic_observations is
  'Private georeferenced evidence. Photo capture GPS is NOT an assertion of geological extraction origin.';
