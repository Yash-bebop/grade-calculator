-- =====================================================================
-- Verified-result edit log — audit trail for admin corrections made
-- through the "Verified results" tab's inline edit (edit_result action
-- in supabase/functions/review-verification/index.ts).
--
-- Why this exists: once a transcript is approved, the file itself is
-- deleted immediately (by design — see schema.sql's privacy reasoning,
-- "Only the service role... can write to semester_results"). That means
-- a later correction has nothing to re-check against. This doesn't
-- reverse that design — the file still gets deleted right away — it
-- just keeps a record of what changed, when, and by whom, so a
-- correction isn't untraceable even without the original document.
-- =====================================================================

create table public.semester_result_edits (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.semester_results(id) on delete cascade,
  old_sgpa numeric(4,2) not null,
  old_cgpa numeric(4,2) not null,
  new_sgpa numeric(4,2) not null,
  new_cgpa numeric(4,2) not null,
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now()
);

alter table public.semester_result_edits enable row level security;

-- Deliberately no select/insert/update/delete policy for regular users —
-- this is an admin-only audit trail. Reads and writes both go through
-- the service role inside the Edge Function (list_edit_history /
-- edit_result), the same trust boundary as everything else admin-owned.

create index semester_result_edits_result_id_idx on public.semester_result_edits(result_id);
