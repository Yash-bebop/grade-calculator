-- =====================================================================
-- Doon Grade Calculator — Leaderboard schema (Supabase / Postgres)
-- v2 — adds per-semester history (replaces the old single-row
-- leaderboard_status) and enables Realtime for live updates.
-- If you already ran v1, drop the old objects first:
--   drop view if exists public.leaderboard;
--   drop table if exists public.leaderboard_status;
-- =====================================================================
-- Design decisions this encodes:
--   1. Calculator itself stays 100% client-side — untouched by any of this.
--   2. "Verified" and "visible on leaderboard" are two separate switches.
--   3. Every verified result is an APPEND, not an overwrite — one row per
--      (profile, semester). This is what makes "Sem 5 toppers" possible:
--      old semesters' numbers stay queryable after someone re-verifies
--      for a later semester.
--   4. Only the service role (your admin Edge Function) can write to
--      semester_results — never the client, even the client's own row.
--      Closes the devtools-tamper hole without needing triggers.
--   5. You must be a VERIFIED viewer yourself before you can see anyone
--      else's entry — enforced in RLS, not just hidden in the UI.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles — user-owned, user-editable
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  last_name text not null,
  full_name_opt_in boolean not null default false,
  department text not null,
  degree_type text not null,
  admission_year int not null,
  program_duration_years int not null check (program_duration_years in (3,4)),
  roll_number text not null unique,            -- self-reported, cross-checked against
                                                -- the transcript at review time; UNIQUE
                                                -- also blocks multi-accounting
  has_university_email boolean not null default false, -- informational only, never a gate
  manual_year_override text,                   -- 'freshman'|'sophomore'|'junior'|'final'
  visible_on_leaderboard boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Gate: you must already be verified yourself to see anyone else's entry.
-- security definer so this doesn't recurse into semester_results' own RLS.
create or replace function public.is_verified_viewer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.semester_results where profile_id = auth.uid());
$$;
-- (function body references semester_results, created just below — fine,
--  Postgres resolves this at call time, not create time)
revoke execute on function public.is_verified_viewer() from public, anon;
grant execute on function public.is_verified_viewer() to authenticated;

create policy "profiles_select_own_or_visible_to_verified"
  on public.profiles for select
  using (id = auth.uid() or (visible_on_leaderboard = true and public.is_verified_viewer()));

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. semester_results — one APPEND-ONLY row per (profile, semester)
--    Admin-owned: only the service role writes here.
-- ---------------------------------------------------------------------
create table public.semester_results (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  semester_number int not null check (semester_number between 1 and 8),
  sgpa numeric(4,2) not null,          -- THIS semester's SGPA, off the document
  cgpa numeric(4,2) not null,          -- cumulative CGPA as of this semester
  verified_at timestamptz not null default now(),
  verified_by uuid not null,           -- admin's auth uid, for audit
  source_request_id uuid references public.verification_requests(id),
  unique (profile_id, semester_number) -- re-verifying the same semester
                                        -- overwrites that semester's row
                                        -- (upsert), doesn't duplicate it
);

alter table public.semester_results enable row level security;

create policy "semester_results_select_own_or_visible_to_verified"
  on public.semester_results for select
  using (
    profile_id = auth.uid()
    or (
      public.is_verified_viewer()
      and exists (
        select 1 from public.profiles p
        where p.id = semester_results.profile_id and p.visible_on_leaderboard = true
      )
    )
  );

-- No insert/update/delete policy for regular users at all — only the
-- service role (inside the Edge Function) bypasses RLS and can write here.

-- ---------------------------------------------------------------------
-- 3. verification_requests — the review queue
-- ---------------------------------------------------------------------
create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  semester_number int not null check (semester_number between 1 and 8), -- which
                                                -- semester THIS transcript reflects
  transcript_storage_path text not null,
  claimed_cgpa numeric(4,2),
  claimed_sgpa numeric(4,2),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.verification_requests enable row level security;

create policy "requests_insert_own"
  on public.verification_requests for insert
  with check (profile_id = auth.uid());

create policy "requests_select_own"
  on public.verification_requests for select
  using (profile_id = auth.uid());

-- Only the service role updates status — no update policy for regular
-- users means updates are blocked entirely.

-- ---------------------------------------------------------------------
-- 4. Storage bucket for transcripts — keep it transient
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('transcripts', 'transcripts', false)
on conflict (id) do nothing;

create policy "transcripts_insert_own_folder"
  on storage.objects for insert
  with check (bucket_id = 'transcripts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "transcripts_select_own_folder"
  on storage.objects for select
  using (bucket_id = 'transcripts' and (storage.foldername(name))[1] = auth.uid()::text);

-- No policy grants broad read — the admin Edge Function uses the service
-- role (bypasses RLS) to fetch a file for review, then deletes it right
-- after the decision is made.

-- ---------------------------------------------------------------------
-- 5. Views — what the frontend actually queries
-- ---------------------------------------------------------------------

-- Semester-specific rankings ("Sem 5 toppers") — every verified row,
-- client filters by semester_number.
create or replace view public.semester_leaderboard
with (security_invoker = true) as
select
  p.id as profile_id,
  case when p.full_name_opt_in then p.display_name || ' ' || p.last_name
       else p.display_name || ' ' || coalesce(substring(p.last_name from 1 for 1) || '.', '')
  end as shown_name,
  p.department, p.degree_type, p.admission_year, p.program_duration_years,
  p.manual_year_override,
  sr.semester_number, sr.sgpa, sr.cgpa, sr.verified_at
from public.semester_results sr
join public.profiles p on p.id = sr.profile_id
where p.visible_on_leaderboard = true;

-- Overall/cumulative rankings — each person's MOST RECENT verified
-- semester only (their current standing).
create or replace view public.leaderboard
with (security_invoker = true) as
select distinct on (sr.profile_id)
  p.id as profile_id,
  case when p.full_name_opt_in then p.display_name || ' ' || p.last_name
       else p.display_name || ' ' || coalesce(substring(p.last_name from 1 for 1) || '.', '')
  end as shown_name,
  p.department, p.degree_type, p.admission_year, p.program_duration_years,
  p.manual_year_override,
  sr.semester_number as latest_semester,
  sr.cgpa as frozen_cgpa,
  sr.sgpa as latest_sgpa,
  sr.verified_at
from public.semester_results sr
join public.profiles p on p.id = sr.profile_id
where p.visible_on_leaderboard = true
order by sr.profile_id, sr.semester_number desc;

-- Both views use security_invoker = true so they inherit the
-- verified-viewer RLS gate from the underlying tables — an unverified
-- or signed-out user querying either gets zero rows back.

-- ---------------------------------------------------------------------
-- 6. Realtime — so the leaderboard updates live as new results land
-- ---------------------------------------------------------------------
-- Realtime respects RLS for authenticated clients: a change to a row
-- someone isn't allowed to SELECT (per the policies above) simply isn't
-- broadcast to them. So this piggybacks on the same verified-viewer gate
-- with no extra access-control work.
alter publication supabase_realtime add table public.semester_results;
alter publication supabase_realtime add table public.profiles;
