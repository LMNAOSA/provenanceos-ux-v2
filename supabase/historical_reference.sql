-- ProvenanceOS — historical reference data
-- Run after supabase/schema.sql has completed.
-- Historical records are not physical specimens and never receive AHM/ACC/ACX/OTH IDs.

create table if not exists public.historical_datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dataset_type text not null default 'soil_reference',
  description text,
  raw_file_id uuid unique references public.raw_files(id) on delete restrict,
  parser_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.historical_records (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.historical_datasets(id) on delete restrict,
  source_row_no integer not null,
  original_index text,
  location text,
  original_time text,
  measured_at_local timestamp,
  time_ambiguous boolean not null default false,
  original_sample text,
  material_type text,
  duration_s numeric,
  units text,
  sigma_value numeric,
  sequence text,
  res numeric,
  escale numeric,
  shape_time numeric,
  inspector text,
  cor_1 text,
  cor_2 text,
  misc text,
  note text,
  flags text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique(dataset_id, source_row_no)
);

create index if not exists historical_records_dataset_idx
  on public.historical_records(dataset_id, source_row_no);
create index if not exists historical_records_location_idx
  on public.historical_records(location);

create table if not exists public.historical_observations (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.historical_records(id) on delete restrict,
  analyte text not null,
  raw_value text,
  value numeric,
  qualifier text,
  detection_limit numeric,
  raw_error text,
  error numeric,
  unit text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique(record_id, analyte)
);

create index if not exists historical_observations_record_idx
  on public.historical_observations(record_id);
create index if not exists historical_observations_analyte_idx
  on public.historical_observations(analyte);

alter table public.historical_datasets enable row level security;
alter table public.historical_records enable row level security;
alter table public.historical_observations enable row level security;

drop policy if exists "staff read historical datasets" on public.historical_datasets;
drop policy if exists "staff add historical datasets" on public.historical_datasets;
create policy "staff read historical datasets"
  on public.historical_datasets for select to authenticated using(public.is_staff());
create policy "staff add historical datasets"
  on public.historical_datasets for insert to authenticated with check(public.is_staff());

drop policy if exists "staff read historical records" on public.historical_records;
drop policy if exists "staff add historical records" on public.historical_records;
create policy "staff read historical records"
  on public.historical_records for select to authenticated using(public.is_staff());
create policy "staff add historical records"
  on public.historical_records for insert to authenticated with check(public.is_staff());

drop policy if exists "staff read historical observations" on public.historical_observations;
drop policy if exists "staff add historical observations" on public.historical_observations;
create policy "staff read historical observations"
  on public.historical_observations for select to authenticated using(public.is_staff());
create policy "staff add historical observations"
  on public.historical_observations for insert to authenticated with check(public.is_staff());

grant select, insert on public.historical_datasets, public.historical_records, public.historical_observations to authenticated;

notify pgrst, 'reload schema';
