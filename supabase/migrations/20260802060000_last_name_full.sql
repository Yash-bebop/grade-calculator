-- =====================================================================
-- Fix: the "show full name" toggle had nothing real to show.
-- profiles.last_initial was a single character by design (the frontend
-- enforced maxlength="1" on it), so full_name_opt_in = true just
-- rendered display_name alone — the surname was dropped entirely,
-- because a real surname was never collected anywhere. This renames the
-- column to what it needs to actually hold (the full last name) and
-- derives the abbreviated initial from it on the fly wherever needed,
-- instead of storing the initial as a separate, redundant value that
-- can't hold anything more than one letter.
-- =====================================================================

alter table public.profiles rename column last_initial to last_name;

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
