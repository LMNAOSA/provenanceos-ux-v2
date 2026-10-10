-- CONSOL v3.9 — SOLOPTICS Optical Acquisition Schema (Staging Migration Proposal)
-- STATUS: PREPARED FOR STAGING VERIFICATION & ARCHITECTURAL APPROVAL
-- DO NOT RUN AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL (Master Backend Directive §19)
--
-- Purpose:
-- Provides authoritative relational tables for SOLOPTICS optical capture sessions
-- (`public.optical_capture_sessions`) and captured source assets (`public.optical_capture_assets`)
-- linked to `public.samples(id)` and `public.sample_images(id)`.
-- Enforces Row Level Security via `public.is_staff()`.

create table if not exists public.optical_capture_sessions (
  id text primary key,
  sample_id text not null references public.samples(id) on delete restrict,
  operator_email text not null,
  operator_uid uuid default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  capture_mode text not null default 'SOLOPTICS_GUIDED_DUAL_PASS',
  pass_completed jsonb not null default '{"passA":false,"passB":false}'::jsonb,
  device_metadata jsonb not null default '{}'::jsonb,
  camera_limitations jsonb not null default '[]'::jsonb,
  illumination jsonb not null default '{}'::jsonb,
  background_surface text not null default 'matte-black',
  scale_reference_present boolean not null default false,
  scale_reference_mm numeric(10,3) check (scale_reference_mm is null or scale_reference_mm > 0),
  colour_reference_present boolean not null default false,
  colour_reference_note text,
  quality_summary jsonb not null default '{}'::jsonb,
  lifecycle_state text not null default 'draft'
    check (lifecycle_state in ('draft', 'uploading', 'saved', 'partial', 'failed', 'retryable')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists optical_capture_sessions_sample_idx
  on public.optical_capture_sessions(sample_id, started_at desc);

create table if not exists public.optical_capture_assets (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.optical_capture_sessions(id) on delete cascade,
  sample_id text not null references public.samples(id) on delete restrict,
  sample_image_id uuid references public.sample_images(id) on delete set null,
  pass_kind text not null check (pass_kind in ('pass_a_appearance', 'pass_b_play_of_colour')),
  step_role text not null,
  sequence_order integer not null default 1,
  view_label text not null,
  storage_path text not null,
  thumb_path text,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  width_px integer,
  height_px integer,
  duration_s numeric(8,2),
  capture_kind text not null default 'visible'
    check (capture_kind in ('visible', 'fluorescence', 'phosphorescence', 'reference')),
  quality_checks jsonb not null default '{}'::jsonb,
  camera_settings jsonb not null default '{}'::jsonb,
  is_original boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists optical_capture_assets_session_idx
  on public.optical_capture_assets(session_id, pass_kind, sequence_order asc);

create index if not exists optical_capture_assets_sample_idx
  on public.optical_capture_assets(sample_id, created_at desc);

alter table public.optical_capture_sessions enable row level security;
alter table public.optical_capture_assets enable row level security;

drop policy if exists "staff read optical capture sessions" on public.optical_capture_sessions;
drop policy if exists "staff insert optical capture sessions" on public.optical_capture_sessions;
drop policy if exists "staff update optical capture sessions" on public.optical_capture_sessions;

create policy "staff read optical capture sessions"
  on public.optical_capture_sessions for select to authenticated using (public.is_staff());

create policy "staff insert optical capture sessions"
  on public.optical_capture_sessions for insert to authenticated with check (public.is_staff());

create policy "staff update optical capture sessions"
  on public.optical_capture_sessions for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff read optical capture assets" on public.optical_capture_assets;
drop policy if exists "staff insert optical capture assets" on public.optical_capture_assets;

create policy "staff read optical capture assets"
  on public.optical_capture_assets for select to authenticated using (public.is_staff());

create policy "staff insert optical capture assets"
  on public.optical_capture_assets for insert to authenticated with check (public.is_staff());

grant select, insert, update on public.optical_capture_sessions to authenticated;
grant select, insert on public.optical_capture_assets to authenticated;
