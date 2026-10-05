-- ProvenanceOS field registry v2
-- Run this whole file in Supabase SQL Editor. Idempotent upgrade from the current UX V2 schema.
-- Identity is assigned once; original instrument/media evidence is never overwritten.

create extension if not exists pgcrypto;

create table if not exists public.staff (user_id uuid primary key references auth.users(id) on delete cascade,created_at timestamptz not null default now());
alter table public.staff enable row level security;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.staff where user_id=(select auth.uid())) $$;
revoke all on function public.is_staff() from public,anon; grant execute on function public.is_staff() to authenticated;
drop policy if exists "staff see their own membership" on public.staff;
create policy "staff see their own membership" on public.staff for select to authenticated using(user_id=(select auth.uid()));

create sequence if not exists public.sample_ahm_seq;
create sequence if not exists public.sample_acc_seq;
create sequence if not exists public.sample_acx_seq;
create sequence if not exists public.sample_oth_seq;

create table if not exists public.samples (id text primary key,sample_code text not null default 'OTH',location text not null default '',sample_type text not null default 'Unknown / Other',weight_g numeric(10,3) check(weight_g is null or weight_g>=0),dimensions text,notes text,created_at timestamptz not null default now(),created_by uuid default auth.uid());
alter table public.samples add column if not exists sample_code text;
alter table public.samples add column if not exists dimensions text;
alter table public.samples add column if not exists notes text;
update public.samples set sample_code='OTH',sample_type=coalesce(nullif(sample_type,''),'Unknown / Other') where sample_code is null;
alter table public.samples alter column sample_code set default 'OTH';
alter table public.samples alter column sample_code set not null;
alter table public.samples alter column id drop default;
alter table public.samples drop constraint if exists samples_id_check;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='samples_id_format') then alter table public.samples add constraint samples_id_format check(id ~ '^(AND|AHM|ACC|ACX|OTH)-[0-9]{6,}$'); end if;
  if not exists(select 1 from pg_constraint where conname='samples_code_allowed') then alter table public.samples add constraint samples_code_allowed check(sample_code in ('AHM','ACC','ACX','OTH')); end if;
end $$;

select setval('public.sample_ahm_seq',coalesce((select max(split_part(id,'-',2)::bigint) from public.samples where id like 'AHM-%'),1),(select max(split_part(id,'-',2)::bigint) from public.samples where id like 'AHM-%') is not null);
select setval('public.sample_acc_seq',coalesce((select max(split_part(id,'-',2)::bigint) from public.samples where id like 'ACC-%'),1),(select max(split_part(id,'-',2)::bigint) from public.samples where id like 'ACC-%') is not null);
select setval('public.sample_acx_seq',coalesce((select max(split_part(id,'-',2)::bigint) from public.samples where id like 'ACX-%'),1),(select max(split_part(id,'-',2)::bigint) from public.samples where id like 'ACX-%') is not null);
select setval('public.sample_oth_seq',coalesce((select max(split_part(id,'-',2)::bigint) from public.samples where id like 'OTH-%'),1),(select max(split_part(id,'-',2)::bigint) from public.samples where id like 'OTH-%') is not null);

create or replace function public.next_sample_number(p_code text) returns bigint language plpgsql security definer set search_path='' as $$ begin
case p_code when 'AHM' then return nextval('public.sample_ahm_seq'); when 'ACC' then return nextval('public.sample_acc_seq'); when 'ACX' then return nextval('public.sample_acx_seq'); when 'OTH' then return nextval('public.sample_oth_seq'); else raise exception 'Unknown sample code %',p_code; end case; end $$;
revoke all on function public.next_sample_number(text) from public,anon,authenticated;

create or replace function public.assign_sample_identity() returns trigger language plpgsql security definer set search_path='' as $$ declare n bigint; begin
  if new.sample_code not in ('AHM','ACC','ACX','OTH') then raise exception 'Invalid sample code'; end if;
  n:=public.next_sample_number(new.sample_code);
  new.id:=new.sample_code||'-'||lpad(n::text,6,'0');
  new.sample_type:=case new.sample_code when 'AHM' then 'Andamooka Hard Matrix' when 'ACC' then 'Andamooka Coloured Concrete' when 'ACX' then 'Andamooka Crystal Opal' else 'Unknown / Other' end;
  return new;
end $$;
drop trigger if exists samples_assign_identity on public.samples;
create trigger samples_assign_identity before insert on public.samples for each row execute function public.assign_sample_identity();
revoke all on function public.assign_sample_identity() from public,anon,authenticated;

create or replace function public.peek_next_sample_id(p_code text) returns text language sql security definer set search_path='' as $$ select p_code||'-'||lpad((case p_code when 'AHM' then (select case when is_called then last_value+1 else last_value end from public.sample_ahm_seq) when 'ACC' then (select case when is_called then last_value+1 else last_value end from public.sample_acc_seq) when 'ACX' then (select case when is_called then last_value+1 else last_value end from public.sample_acx_seq) else (select case when is_called then last_value+1 else last_value end from public.sample_oth_seq) end)::text,6,'0') where p_code in ('AHM','ACC','ACX','OTH') and public.is_staff() $$;
revoke all on function public.peek_next_sample_id(text) from public,anon; grant execute on function public.peek_next_sample_id(text) to authenticated;

create table if not exists public.sample_images (id uuid primary key default gen_random_uuid(),sample_id text not null references public.samples(id) on delete restrict,storage_path text not null unique,thumb_path text,file_name text,content_type text,size_bytes bigint,sha256 text,created_at timestamptz not null default now(),created_by uuid default auth.uid());
alter table public.sample_images add column if not exists capture_kind text not null default 'visible';
alter table public.sample_images add column if not exists media_type text;
alter table public.sample_images add column if not exists processing_method text not null default 'original';
alter table public.sample_images add column if not exists is_original boolean not null default true;
alter table public.sample_images add column if not exists derived_from_id uuid references public.sample_images(id);
alter table public.sample_images add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.sample_images add column if not exists width_px integer;
alter table public.sample_images add column if not exists height_px integer;
do $$ begin if not exists(select 1 from pg_constraint where conname='sample_images_capture_kind_allowed') then alter table public.sample_images add constraint sample_images_capture_kind_allowed check(capture_kind in ('visible','fluorescence','phosphorescence','reference')); end if; end $$;

create table if not exists public.raw_files (id uuid primary key default gen_random_uuid(),file_name text not null,storage_path text not null unique,content_type text,size_bytes bigint,sha256 text not null unique,parser_version text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),created_by uuid default auth.uid());
create table if not exists public.analyses (id uuid primary key default gen_random_uuid(),sample_id text not null references public.samples(id) on delete restrict,instrument text not null default 'Vanta',method text,reading_no text,measured_at timestamptz,results jsonb not null,raw jsonb,source_file text,source_sha256 text,reading_hash text not null,raw_file_id uuid references public.raw_files(id) on delete restrict,parser_version text,match_method text,match_confidence numeric(5,4),match_basis text,created_at timestamptz not null default now(),created_by uuid default auth.uid(),unique(sample_id,reading_hash));
alter table public.analyses add column if not exists raw_file_id uuid references public.raw_files(id) on delete restrict;
alter table public.analyses add column if not exists parser_version text;
alter table public.analyses add column if not exists match_method text;
alter table public.analyses add column if not exists match_confidence numeric(5,4);
alter table public.analyses add column if not exists match_basis text;

create table if not exists public.import_batches (id uuid primary key default gen_random_uuid(),raw_file_id uuid not null references public.raw_files(id) on delete restrict,parser_version text not null,imported_count integer not null default 0,duplicate_count integer not null default 0,skipped_count integer not null default 0,warnings jsonb not null default '[]'::jsonb,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),created_by uuid default auth.uid());
create table if not exists public.import_unmatched_rows (id uuid primary key default gen_random_uuid(),import_batch_id uuid not null references public.import_batches(id) on delete restrict,row_no integer not null,sample_id text,reason text not null,raw jsonb not null,created_at timestamptz not null default now(),created_by uuid default auth.uid());
create table if not exists public.sample_measurements (id uuid primary key default gen_random_uuid(),sample_id text not null references public.samples(id) on delete restrict,method text not null,dimensions jsonb not null,reference_metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),created_by uuid default auth.uid());
create table if not exists public.sample_events (id bigint generated always as identity primary key,sample_id text not null references public.samples(id) on delete restrict,kind text not null,detail jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),created_by uuid default auth.uid());

create or replace function public.log_sample_registered() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.sample_events(sample_id,kind,detail) values(new.id,'registered',jsonb_build_object('location',new.location,'sample_type',new.sample_type)); return new; end $$;
create or replace function public.log_image_added() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.sample_events(sample_id,kind,detail) values(new.sample_id,'photographed',jsonb_build_object('file_name',new.file_name,'capture_kind',new.capture_kind,'sha256',new.sha256,'processing_method',new.processing_method)); return new; end $$;
create or replace function public.log_measurement_added() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.sample_events(sample_id,kind,detail) values(new.sample_id,'measured',jsonb_build_object('method',new.method,'dimensions',new.dimensions)); return new; end $$;
create or replace function public.log_analyses_added() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.sample_events(sample_id,kind,detail) select sample_id,'analysed',jsonb_build_object('readings',count(*),'instrument',min(instrument),'source_file',min(source_file)) from new_rows group by sample_id; return null; end $$;
drop trigger if exists samples_registered on public.samples; create trigger samples_registered after insert on public.samples for each row execute function public.log_sample_registered();
drop trigger if exists images_logged on public.sample_images; create trigger images_logged after insert on public.sample_images for each row execute function public.log_image_added();
drop trigger if exists measurements_logged on public.sample_measurements; create trigger measurements_logged after insert on public.sample_measurements for each row execute function public.log_measurement_added();
drop trigger if exists analyses_logged on public.analyses; create trigger analyses_logged after insert on public.analyses referencing new table as new_rows for each statement execute function public.log_analyses_added();

create or replace view public.sample_overview with (security_invoker=true) as select s.*,(select count(*) from public.sample_images i where i.sample_id=s.id) image_count,(select count(*) from public.analyses a where a.sample_id=s.id) analysis_count,c.storage_path cover_path,c.thumb_path cover_thumb_path from public.samples s left join lateral(select i.storage_path,i.thumb_path from public.sample_images i where i.sample_id=s.id and i.capture_kind='visible' order by i.created_at limit 1)c on true;

alter table public.samples enable row level security;
alter table public.sample_images enable row level security;
alter table public.analyses enable row level security;
alter table public.sample_measurements enable row level security;
alter table public.sample_events enable row level security;
alter table public.raw_files enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_unmatched_rows enable row level security;

drop policy if exists "staff read samples" on public.samples;drop policy if exists "staff add samples" on public.samples;create policy "staff read samples" on public.samples for select to authenticated using(public.is_staff());create policy "staff add samples" on public.samples for insert to authenticated with check(public.is_staff());
drop policy if exists "staff read images" on public.sample_images;drop policy if exists "staff add images" on public.sample_images;create policy "staff read images" on public.sample_images for select to authenticated using(public.is_staff());create policy "staff add images" on public.sample_images for insert to authenticated with check(public.is_staff());
drop policy if exists "staff read analyses" on public.analyses;drop policy if exists "staff add analyses" on public.analyses;create policy "staff read analyses" on public.analyses for select to authenticated using(public.is_staff());create policy "staff add analyses" on public.analyses for insert to authenticated with check(public.is_staff());
drop policy if exists "staff read measurements" on public.sample_measurements;drop policy if exists "staff add measurements" on public.sample_measurements;create policy "staff read measurements" on public.sample_measurements for select to authenticated using(public.is_staff());create policy "staff add measurements" on public.sample_measurements for insert to authenticated with check(public.is_staff());
drop policy if exists "staff read events" on public.sample_events;create policy "staff read events" on public.sample_events for select to authenticated using(public.is_staff());
drop policy if exists "staff read raw" on public.raw_files;drop policy if exists "staff add raw" on public.raw_files;create policy "staff read raw" on public.raw_files for select to authenticated using(public.is_staff());create policy "staff add raw" on public.raw_files for insert to authenticated with check(public.is_staff());
drop policy if exists "staff read imports" on public.import_batches;drop policy if exists "staff add imports" on public.import_batches;create policy "staff read imports" on public.import_batches for select to authenticated using(public.is_staff());create policy "staff add imports" on public.import_batches for insert to authenticated with check(public.is_staff());
drop policy if exists "staff read unmatched" on public.import_unmatched_rows;drop policy if exists "staff add unmatched" on public.import_unmatched_rows;create policy "staff read unmatched" on public.import_unmatched_rows for select to authenticated using(public.is_staff());create policy "staff add unmatched" on public.import_unmatched_rows for insert to authenticated with check(public.is_staff());

revoke all on public.staff,public.samples,public.sample_images,public.analyses,public.sample_measurements,public.sample_events,public.raw_files,public.import_batches,public.import_unmatched_rows,public.sample_overview from anon,authenticated;
grant select on public.staff,public.samples,public.sample_images,public.analyses,public.sample_measurements,public.sample_events,public.raw_files,public.import_batches,public.import_unmatched_rows,public.sample_overview to authenticated;
grant insert on public.samples,public.sample_images,public.analyses,public.sample_measurements,public.raw_files,public.import_batches,public.import_unmatched_rows to authenticated;
grant usage on sequence public.sample_ahm_seq,public.sample_acc_seq,public.sample_acx_seq,public.sample_oth_seq to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sample-images','sample-images',false,78643200,array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/webm','video/quicktime']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vanta-raw','vanta-raw',false,52428800,array['text/csv','text/plain','application/csv','application/vnd.ms-excel']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "staff read sample media" on storage.objects;drop policy if exists "staff upload sample media" on storage.objects;create policy "staff read sample media" on storage.objects for select to authenticated using(bucket_id='sample-images' and public.is_staff());create policy "staff upload sample media" on storage.objects for insert to authenticated with check(bucket_id='sample-images' and public.is_staff());
drop policy if exists "staff read raw exports" on storage.objects;drop policy if exists "staff upload raw exports" on storage.objects;create policy "staff read raw exports" on storage.objects for select to authenticated using(bucket_id='vanta-raw' and public.is_staff());create policy "staff upload raw exports" on storage.objects for insert to authenticated with check(bucket_id='vanta-raw' and public.is_staff());
insert into public.staff(user_id) select id from auth.users on conflict do nothing;
notify pgrst,'reload schema';