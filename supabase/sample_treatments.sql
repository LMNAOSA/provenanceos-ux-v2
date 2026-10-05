-- ProvenanceOS — specimen treatment record
-- Run after supabase/schema.sql. Keeps enhancement/treatment history separate
-- from analytical observations. Do not infer treatment dose from pXRF chemistry.

create table if not exists public.sample_treatments (
  id uuid primary key default gen_random_uuid(),
  sample_id text not null references public.samples(id) on delete restrict,
  treatment_status text not null default 'unknown'
    check (treatment_status in ('untreated','treated','unknown')),
  treatment_method text,
  reagent_name text,
  reagent_concentration_pct numeric(8,3),
  reagent_volume_ml numeric(12,3),
  treatment_duration_min numeric(12,2),
  temperature_c numeric(8,2),
  cycle_count integer,
  pre_treatment_mass_g numeric(10,3),
  post_treatment_mass_g numeric(10,3),
  operator text,
  treated_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists sample_treatments_sample_idx
  on public.sample_treatments(sample_id, created_at desc);

alter table public.sample_treatments enable row level security;

drop policy if exists "staff read treatments" on public.sample_treatments;
drop policy if exists "staff add treatments" on public.sample_treatments;

create policy "staff read treatments"
  on public.sample_treatments for select to authenticated using(public.is_staff());

create policy "staff add treatments"
  on public.sample_treatments for insert to authenticated with check(public.is_staff());

revoke all on public.sample_treatments from anon, authenticated;
grant select, insert on public.sample_treatments to authenticated;

notify pgrst,'reload schema';
