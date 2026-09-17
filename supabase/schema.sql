-- Run this once in the Supabase SQL Editor for the project used by Vercel.
create extension if not exists pgcrypto;

create table if not exists public.mentor_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  questionnaire_version text not null,
  answers jsonb not null,
  no_ai_confirmed boolean not null,
  started_at timestamptz,
  completed_at timestamptz,
  constraint mentor_submissions_answers_are_complete check (
    case
      when jsonb_typeof(answers) = 'array'
        then jsonb_array_length(answers) = 20
      else false
    end
  ),
  constraint mentor_submissions_confirmation_required check (
    no_ai_confirmed is true
  ),
  constraint mentor_submissions_time_order check (
    started_at is null
    or completed_at is null
    or completed_at >= started_at
  )
);

comment on table public.mentor_submissions is
  'Mentor-authored reference answers for the master thesis evaluation.';

alter table public.mentor_submissions enable row level security;

-- Browser-facing Supabase roles cannot read or write the research responses.
revoke all on table public.mentor_submissions from public, anon, authenticated;

-- The secret server key used by the Vercel function maps to service_role.
grant insert, select on table public.mentor_submissions to service_role;
