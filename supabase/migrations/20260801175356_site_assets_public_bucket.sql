-- Public, read-only bucket for small static assets the frontend needs to
-- fetch dynamically at runtime but that should NOT live in the public
-- GitHub repo (e.g. admin.js — the review-queue UI, which the app loads
-- only for the admin's own browser, never bundled/shipped to students).
--
-- public = true means Storage serves GET requests straight from the
-- bucket with no RLS check at all (that's what "public" means for
-- Storage) — so no SELECT policy is needed here. RLS stays enabled with
-- no insert/update/delete policy for this bucket, so nothing can write
-- to it from the client; only the Dashboard (or service role) can
-- upload/replace files in it.
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;
