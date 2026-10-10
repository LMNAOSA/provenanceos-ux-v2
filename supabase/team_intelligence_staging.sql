-- CONSOL v3.6 — Team Intelligence & Research Questions Inbox (Staging Migration Proposal)
-- STATUS: PREPARED FOR STAGING VERIFICATION & ARCHITECTURAL APPROVAL
-- DO NOT RUN AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL (Master Backend Directive §19)
--
-- Purpose:
-- Provides persistent backend tables for researcher questions, assigned reviewers,
-- linked specimen/historical record references, evidence-backed replies, and review status
-- enforced by PostgreSQL Row Level Security (public.is_staff()).

create table if not exists public.research_questions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  question_body text not null,
  raised_by_email text not null,
  raised_by_uid uuid default auth.uid(),
  assigned_researcher text not null,
  review_status text not null default 'Open Question'
    check (review_status in ('Open Question', 'Under Review', 'Needs Verification', 'Resolved')),
  linked_specimen_id text references public.samples(id) on delete set null,
  linked_historical_record_id uuid references public.historical_records(id) on delete set null,
  linked_historical_row_no integer,
  linked_investigation_id text,
  evidence_citation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_questions_status_idx
  on public.research_questions(review_status, updated_at desc);

create index if not exists research_questions_assigned_idx
  on public.research_questions(assigned_researcher);

create table if not exists public.research_question_replies (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.research_questions(id) on delete cascade,
  author_email text not null,
  author_uid uuid default auth.uid(),
  reply_body text not null,
  evidence_reference text,
  created_at timestamptz not null default now()
);

create index if not exists research_question_replies_question_idx
  on public.research_question_replies(question_id, created_at asc);

alter table public.research_questions enable row level security;
alter table public.research_question_replies enable row level security;

drop policy if exists "staff read research questions" on public.research_questions;
drop policy if exists "staff insert research questions" on public.research_questions;
drop policy if exists "staff update research questions" on public.research_questions;

create policy "staff read research questions"
  on public.research_questions for select to authenticated using (public.is_staff());

create policy "staff insert research questions"
  on public.research_questions for insert to authenticated with check (public.is_staff());

create policy "staff update research questions"
  on public.research_questions for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff read research question replies" on public.research_question_replies;
drop policy if exists "staff insert research question replies" on public.research_question_replies;

create policy "staff read research question replies"
  on public.research_question_replies for select to authenticated using (public.is_staff());

create policy "staff insert research question replies"
  on public.research_question_replies for insert to authenticated with check (public.is_staff());

grant select, insert, update on public.research_questions to authenticated;
grant select, insert on public.research_question_replies to authenticated;
