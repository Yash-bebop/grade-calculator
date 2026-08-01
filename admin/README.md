# Admin dashboard — deployment notes

`admin.js` (in this folder) is **gitignored on purpose** — it never gets
pushed to GitHub. It contains the verification-review UI: pending
requests, applicant details, and the transcript preview. Keeping it out
of the public repo means nobody browsing the source can see how the
review queue works or what data it surfaces.

This isn't the actual security boundary, though — that's the
`review-verification` edge function, which checks the signed-in user's
email against `ADMIN_EMAILS` server-side before returning any data.
`admin.js` is just the UI on top of it. Even if someone got a copy of
this file, they couldn't do anything with it without also being an
admin as far as the edge function is concerned.

## How it's served

`admin.js` is uploaded straight to Supabase Storage instead of being
deployed with the rest of the site via Vercel/GitHub. The main app
(`leaderboard.js`) checks if the signed-in email is an admin, and if so,
fetches this file at runtime from a public bucket and injects it as a
`<script>` tag. Nobody else's browser ever requests it.

## First-time setup (already done for the `site-assets` bucket itself)

The `site-assets` bucket already exists in the Supabase project
(public, read-only — no one can write to it from the client, only via
the Dashboard or service role).

## Uploading / updating `admin.js`

1. Go to the [Supabase Dashboard](https://supabase.com/dashboard) → your
   project → **Storage** → `site-assets` bucket.
2. Upload `admin/admin.js` from this repo (drag & drop, or "Upload
   file"). If a file named `admin.js` already exists, replace it.
3. That's it — the app always fetches with a cache-busting query param,
   so the new version is live immediately, no redeploy needed.

Whenever you edit the admin dashboard, edit `admin/admin.js` locally
(it's kept in this folder for your own reference, just not committed),
then re-upload it the same way.
