// supabase/functions/review-verification/index.ts
//
// Deploy with: supabase functions deploy review-verification
// Requires this secret set on the project:
//   supabase secrets set ADMIN_EMAILS="you@gmail.com,co-admin@gmail.com"
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.)
//
// This is the ONLY place semester_results ever gets written. Nothing
// client-side can touch it — that's what makes "verified" trustworthy.
//
// Actions (POST body: { action, ...params }), auth via the caller's own
// Supabase session JWT in the Authorization header:
//   - "list_pending"    -> pending requests, each tagged with which
//                          semester it claims to be for + roll number to
//                          cross-check against the transcript
//   - "get_review_url"  -> a short-lived signed URL to view one transcript
//   - "approve"         -> { request_id, sgpa, cgpa }
//                          NOTE: both numbers come from what the ADMIN
//                          reads off the document, not from the user's
//                          claimed_cgpa/claimed_sgpa. That's the whole
//                          point — the user's own input is never trusted
//                          for what actually gets written.
//   - "reject"          -> { request_id, rejection_reason }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const cors = {
  "Access-Control-Allow-Origin": "*", // tighten to your domain once deployed
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user?.email) return json({ error: "Not signed in" }, 401);

    const callerEmail = userData.user.email.toLowerCase();
    if (!ADMIN_EMAILS.includes(callerEmail)) return json({ error: "Not an admin" }, 403);

    // Service-role client — bypasses RLS. Only reachable past the admin check above.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === "list_pending") {
      const { data, error } = await admin
        .from("verification_requests")
        .select(`
          id, profile_id, semester_number, transcript_storage_path, claimed_cgpa, claimed_sgpa, created_at,
          profiles ( display_name, roll_number, department, admission_year, has_university_email )
        `)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ requests: data });
    }

    if (action === "get_review_url") {
      const { request_id } = body;
      const { data: reqRow, error: reqErr } = await admin
        .from("verification_requests")
        .select("transcript_storage_path")
        .eq("id", request_id)
        .single();
      if (reqErr || !reqRow) return json({ error: "Request not found" }, 404);

      const { data: signed, error: signErr } = await admin.storage
        .from("transcripts")
        .createSignedUrl(reqRow.transcript_storage_path, 300); // 5 min
      if (signErr) return json({ error: signErr.message }, 500);
      return json({ url: signed.signedUrl });
    }

    if (action === "approve") {
      const { request_id, sgpa, cgpa } = body;
      if (!request_id || sgpa == null || cgpa == null) {
        return json({ error: "request_id, sgpa, and cgpa are all required" }, 400);
      }

      const { data: reqRow, error: reqErr } = await admin
        .from("verification_requests")
        .select("profile_id, semester_number, transcript_storage_path, status")
        .eq("id", request_id)
        .single();
      if (reqErr || !reqRow) return json({ error: "Request not found" }, 404);
      if (reqRow.status !== "pending") return json({ error: "Already reviewed" }, 409);

      // Append (or overwrite, if re-verifying the same semester) — never
      // touches any OTHER semester's row, which is what preserves history.
      const { error: upsertErr } = await admin.from("semester_results").upsert(
        {
          profile_id: reqRow.profile_id,
          semester_number: reqRow.semester_number,
          sgpa,
          cgpa,
          verified_at: new Date().toISOString(),
          verified_by: userData.user.id,
          source_request_id: request_id,
        },
        { onConflict: "profile_id,semester_number" }
      );
      if (upsertErr) return json({ error: upsertErr.message }, 500);

      await admin
        .from("verification_requests")
        .update({ status: "approved", reviewed_by: userData.user.id, reviewed_at: new Date().toISOString() })
        .eq("id", request_id);

      await admin.storage.from("transcripts").remove([reqRow.transcript_storage_path]);

      return json({ ok: true });
    }

    if (action === "reject") {
      const { request_id, rejection_reason } = body;
      if (!request_id) return json({ error: "request_id is required" }, 400);

      const { data: reqRow, error: reqErr } = await admin
        .from("verification_requests")
        .select("transcript_storage_path, status")
        .eq("id", request_id)
        .single();
      if (reqErr || !reqRow) return json({ error: "Request not found" }, 404);
      if (reqRow.status !== "pending") return json({ error: "Already reviewed" }, 409);

      await admin
        .from("verification_requests")
        .update({
          status: "rejected",
          rejection_reason: rejection_reason ?? null,
          reviewed_by: userData.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", request_id);

      await admin.storage.from("transcripts").remove([reqRow.transcript_storage_path]);

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
