-- =====================================================================
-- Doon Grade Calculator — perf hardening on top of schema.sql v2
-- Applied directly to the live project on 2026-08-01. This file exists
-- so your local migration history (and `supabase db push`/`db pull`)
-- stays in sync with what's actually running.
--
-- What it does, and why:
--   1. Six RLS policies called auth.uid() directly in USING/WITH CHECK,
--      which Postgres re-evaluates on every row scanned. Wrapping it as
--      (select auth.uid()) lets the planner evaluate it once per query
--      instead — same access rules, cheaper at scale. Flagged by
--      Supabase's own advisor (lint 0003_auth_rls_initplan).
--   2. Two foreign keys had no covering index (semester_results.
--      source_request_id, verification_requests.profile_id), which
--      slows down the deletes/joins that touch those columns as data
--      grows. Flagged by lint 0001_unindexed_foreign_keys.
-- No behavior change — just cheaper at scale.
-- =====================================================================

-- profiles
drop policy if exists "profiles_select_own_or_visible_to_verified" on public.profiles;
create policy "profiles_select_own_or_visible_to_verified"
  on public.profiles for select
  using (id = (select auth.uid()) or (visible_on_leaderboard = true and public.is_verified_viewer()));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- semester_results
drop policy if exists "semester_results_select_own_or_visible_to_verified" on public.semester_results;
create policy "semester_results_select_own_or_visible_to_verified"
  on public.semester_results for select
  using (
    profile_id = (select auth.uid())
    or (
      public.is_verified_viewer()
      and exists (
        select 1 from public.profiles p
        where p.id = semester_results.profile_id and p.visible_on_leaderboard = true
      )
    )
  );

-- verification_requests
drop policy if exists "requests_insert_own" on public.verification_requests;
create policy "requests_insert_own"
  on public.verification_requests for insert
  with check (profile_id = (select auth.uid()));

drop policy if exists "requests_select_own" on public.verification_requests;
create policy "requests_select_own"
  on public.verification_requests for select
  using (profile_id = (select auth.uid()));

-- covering indexes for unindexed foreign keys
create index if not exists semester_results_source_request_id_idx
  on public.semester_results (source_request_id);
create index if not exists verification_requests_profile_id_idx
  on public.verification_requests (profile_id);
