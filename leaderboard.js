// ═══════════════════════════════════════════════════════════════════
// LEADERBOARD MODULE — loaded lazily, only when the Leaderboard tab
// is opened for the first time. The calculator (index.html/script.js)
// never references anything in this file and never loads it itself.
//
// v2 — matches schema.sql v2 (semester_results, append-only per
// semester) and index.ts v2 (approve takes {sgpa, cgpa}). Adds
// semester-wise rankings and Supabase Realtime live updates.
// ═══════════════════════════════════════════════════════════════════

// ─── CONFIG — from Supabase Dashboard → Settings → API ─────────────────
// Both values below are meant to be public — the anon/publishable key
// only ever grants what RLS in schema.sql allows, nothing more.
const LB_SUPABASE_URL = 'https://vjuganaxvgudjgjybbxe.supabase.co';
const LB_SUPABASE_ANON_KEY = 'sb_publishable_SRWpwaUx6vkVekrUFO3vGQ_qY_YNKHc';
// Client-side admin list is ONLY for showing/hiding the review UI. It is
// NOT a security boundary — the Edge Function independently checks its
// own ADMIN_EMAILS secret before allowing any write. Someone editing this
// array in devtools gains nothing; the function would still reject them.
const LB_ADMIN_EMAILS = ['inquireofyash@gmail.com'];
const LB_EDGE_FN_URL = LB_SUPABASE_URL + '/functions/v1/review-verification';
const LB_MAX_SEMESTERS = 8;

let _lbClient = null;
let _lbSession = null;
let _lbProfile = null;
let _lbMyResults = [];       // all MY verified semester_results, ascending by semester_number
let _lbPendingRequest = null; // my most recent verification_requests row, if any
let _lbScope = 'batch';       // 'batch' | 'department' | 'university'
let _lbSemesterView = 'overall'; // 'overall' | 1..8
let _lbOnLeaderboardView = false;
let _lbRealtimeChannel = null;

// ─── SDK LOADING (dynamic — this is the ONLY network activity that ────
// ─── touches the calculator's load path being untouched) ──────────────
function lbLoadSDK() {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Supabase SDK'));
    document.head.appendChild(s);
  });
}

// ─── ENTRY POINT — called once from showTab() the first time the ──────
// ─── Leaderboard tab is opened (see script.js change) ──────────────────
let _lbInited = false;
async function initLeaderboardTab() {
  if (_lbInited) return;
  _lbInited = true;
  lbRender(`<div class="card empty-state"><div class="empty-title">Loading…</div></div>`);

  try {
    await lbLoadSDK();
  } catch (e) {
    lbRender(`<div class="warn-box">Couldn't load the leaderboard right now — check your connection and reopen this tab.</div>`);
    _lbInited = false;
    return;
  }

  _lbClient = window.supabase.createClient(LB_SUPABASE_URL, LB_SUPABASE_ANON_KEY);

  _lbClient.auth.onAuthStateChange((_event, session) => {
    // Supabase re-validates the session (and fires this callback, usually
    // as a same-user SIGNED_IN) every time the tab's visibilityState goes
    // hidden -> visible again — which includes the moment the native file
    // picker closes after choosing a file. Without this guard, that fired
    // a full re-render of the verification form on every file selection,
    // wiping the chosen file (and typed CGPA/SGPA) before "Submit for
    // verification" could be clicked. Only actually refresh the view on a
    // REAL auth change (sign-in/out) — not a same-user session touch-up.
    const sameUser = _lbSession?.user?.id === session?.user?.id;
    _lbSession = session;
    if (sameUser) return;
    lbRefresh();
  });

  const { data } = await _lbClient.auth.getSession();
  _lbSession = data.session;
  await lbRefresh();

  lbSetupRealtime();
}

function lbRender(html) {
  const el = document.getElementById('tab-leaderboard');
  if (el) el.innerHTML = html;
}

// ─── LIVE UPDATES — subscribes once. Postgres Realtime respects RLS for ─
// ─── authenticated clients, so this only ever receives rows the current ─
// ─── user could already SELECT (see schema.sql §6). ─────────────────────
function lbSetupRealtime() {
  if (_lbRealtimeChannel) return;
  _lbRealtimeChannel = _lbClient
    .channel('lb-live-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'semester_results' }, () => {
      if (_lbOnLeaderboardView) { lbRenderLeaderboard(); lbNoteLiveUpdate(); }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => {
      if (_lbOnLeaderboardView) { lbRenderLeaderboard(); lbNoteLiveUpdate(); }
    })
    .subscribe();
}

function lbNoteLiveUpdate() {
  const el = document.getElementById('lb-live-ts');
  if (el) el.textContent = 'updated ' + new Date().toLocaleTimeString();
}

// ─── MAIN STATE ROUTER ──────────────────────────────────────────────
async function lbRefresh() {
  _lbOnLeaderboardView = false;

  if (!_lbSession) {
    lbRenderSignedOut();
    return;
  }

  const { data: profile } = await _lbClient
    .from('profiles')
    .select('*')
    .eq('id', _lbSession.user.id)
    .maybeSingle();
  _lbProfile = profile;

  if (!_lbProfile) {
    lbRenderProfileForm();
    return;
  }

  const [{ data: results }, { data: pending }] = await Promise.all([
    _lbClient
      .from('semester_results')
      .select('*')
      .eq('profile_id', _lbSession.user.id)
      .order('semester_number', { ascending: true }),
    _lbClient
      .from('verification_requests')
      .select('*')
      .eq('profile_id', _lbSession.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  _lbMyResults = results || [];
  _lbPendingRequest = pending || null;

  if (_lbMyResults.length === 0) {
    lbRenderVerificationFlow(_lbPendingRequest, 1);
    return;
  }

  _lbOnLeaderboardView = true;
  await lbRenderLeaderboard();
}

// ─── VIEW: SIGNED OUT ───────────────────────────────────────────────
function lbRenderSignedOut() {
  lbRender(`
    <div class="info-box" style="margin-bottom:16px;">
      <b>What this is:</b> an opt-in leaderboard to compare CGPA with your batch and department at Doon University. Nothing here is public until you choose to make it — and you can turn visibility off again anytime.
    </div>
    <div class="card" style="text-align:center;padding:32px 20px;">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">Sign in to continue</div>
      <button class="btn" onclick="lbSignIn()">Sign in with Google</button>
      <div class="helper" style="margin-top:14px;">Any Google account works — a university email isn't required. Verification happens separately, by uploading your transcript.</div>
    </div>
  `);
}

function lbSignIn() {
  _lbClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
}

function lbSignOut() {
  _lbClient.auth.signOut();
}

// ─── VIEW: CREATE PROFILE ───────────────────────────────────────────
function lbParseRoll(rollNumber) {
  const m = /^(\d{2})([a-zA-Z]+)(\d+)$/.exec((rollNumber || '').trim());
  if (!m) return null;
  return { admissionYear: 2000 + parseInt(m[1], 10), branchCode: m[2].toLowerCase() };
}

function lbRenderProfileForm() {
  const emailDomain = (_lbSession.user.email || '').split('@')[1] || '';
  const hasUniEmail = emailDomain.toLowerCase() === 'doonuniversity.ac.in';

  lbRender(`
    <div class="info-box" style="margin-bottom:16px;">
      One-time setup. Your roll number isn't shown publicly — it's only used to cross-check against your transcript at verification time, and to stop one person creating multiple profiles.
    </div>
    <div class="card">
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">First name (shown on leaderboard)</div>
        <input type="text" id="lb-name" placeholder="e.g. Yashvardhan" style="width:100%;">
      </div>
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">Last initial</div>
        <input type="text" id="lb-lastinitial" maxlength="1" placeholder="e.g. D" style="width:80px;">
        <div class="helper">Shown as "Yashvardhan D." by default. You can opt up to your full name later from settings.</div>
      </div>
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">Roll number</div>
        <input type="text" id="lb-roll" placeholder="e.g. 25ce85" style="width:100%;" oninput="lbOnRollInput()">
        <div class="helper" id="lb-roll-hint"></div>
      </div>
      <div class="lb-2col" style="margin-bottom:12px;">
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Department</div>
          <input type="text" id="lb-dept" placeholder="e.g. CSE" style="width:100%;">
        </div>
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Degree</div>
          <input type="text" id="lb-degree" placeholder="e.g. B.Tech" style="width:100%;">
        </div>
      </div>
      <div class="lb-2col" style="margin-bottom:16px;">
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Admission year</div>
          <input type="number" id="lb-admyear" placeholder="e.g. 2025" style="width:100%;">
        </div>
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Program length</div>
          <select id="lb-duration" style="width:100%;">
            <option value="4">4 years (B.Tech etc.)</option>
            <option value="3">3 years (BA etc.)</option>
          </select>
        </div>
      </div>
      ${hasUniEmail ? `<div class="success-box" style="margin-bottom:16px;">✓ Signed in with your university email (${escapeHtml(_lbSession.user.email)})</div>` : ''}
      <button class="btn" style="width:100%;" onclick="lbCreateProfile(${hasUniEmail})">Continue</button>
    </div>
  `);
}

function lbOnRollInput() {
  const val = document.getElementById('lb-roll').value;
  const parsed = lbParseRoll(val);
  const hint = document.getElementById('lb-roll-hint');
  const admYearInput = document.getElementById('lb-admyear');
  if (parsed) {
    hint.textContent = `Reads as admission year ${parsed.admissionYear}, branch "${parsed.branchCode}" — feel free to correct the fields below if that's wrong.`;
    if (admYearInput && !admYearInput.value) admYearInput.value = parsed.admissionYear;
  } else {
    hint.textContent = '';
  }
}

async function lbCreateProfile(hasUniEmail) {
  const display_name = document.getElementById('lb-name').value.trim();
  const last_initial = document.getElementById('lb-lastinitial').value.trim().toUpperCase();
  const roll_number = document.getElementById('lb-roll').value.trim().toLowerCase();
  const department = document.getElementById('lb-dept').value.trim();
  const degree_type = document.getElementById('lb-degree').value.trim();
  const admission_year = parseInt(document.getElementById('lb-admyear').value, 10);
  const program_duration_years = parseInt(document.getElementById('lb-duration').value, 10);

  if (!display_name || !last_initial || !roll_number || !department || !degree_type || !admission_year) {
    showToast('Please fill in every field');
    return;
  }

  const { error } = await _lbClient.from('profiles').insert({
    id: _lbSession.user.id,
    display_name, last_initial, roll_number, department, degree_type,
    admission_year, program_duration_years,
    has_university_email: hasUniEmail,
  });

  if (error) {
    showToast(error.code === '23505' ? 'That roll number is already registered' : 'Could not save: ' + error.message);
    return;
  }
  showToast('✓ Profile created', 'success');
  await lbRefresh();
}

// ─── VIEW: VERIFICATION FLOW (upload / pending / rejected) ─────────
// suggestedSemester pre-selects a semester in the dropdown — either "1"
// for a first-time submission, or "highest verified + 1" when someone
// taps "Submit next semester" from the leaderboard view.
function lbRenderVerificationFlow(pending, suggestedSemester) {
  if (pending && pending.status === 'pending') {
    lbRender(`
      <div class="card" style="text-align:center;padding:32px 20px;">
        <div style="font-size:32px;margin-bottom:10px;">⏳</div>
        <div style="font-weight:700;margin-bottom:6px;">Semester ${pending.semester_number} — under review</div>
        <div class="helper">Your transcript was submitted on ${new Date(pending.created_at).toLocaleDateString()}. You'll be able to flex once it's checked.</div>
      </div>
    `);
    return;
  }

  const rejectedNotice = pending && pending.status === 'rejected'
    ? `<div class="warn-box" style="margin-bottom:16px;">Your last submission (Semester ${pending.semester_number}) wasn't approved${pending.rejection_reason ? ': ' + escapeHtml(pending.rejection_reason) : '.'} You can try again below.</div>`
    : '';

  const alreadyVerified = new Set(_lbMyResults.map(r => r.semester_number));
  const clampedSuggestion = Math.max(1, Math.min(suggestedSemester || 1, LB_MAX_SEMESTERS));
  const semOptions = Array.from({ length: LB_MAX_SEMESTERS }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === clampedSuggestion ? 'selected' : ''}>Semester ${n}${alreadyVerified.has(n) ? ' (already verified — re-submit to correct it)' : ''}</option>`)
    .join('');

  lbRender(`
    ${rejectedNotice}
    <div class="info-box" style="margin-bottom:16px;">
      Upload a photo or PDF of your official transcript/marksheet. This gets reviewed manually — once approved you'll get a verified badge and can join the leaderboard. The file is deleted right after review either way.
    </div>
    <div class="card">
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">Which semester does this transcript cover?</div>
        <select id="lb-semester-number" style="width:100%;">${semOptions}</select>
      </div>
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">Transcript (image or PDF)</div>
        <input type="file" id="lb-transcript-file" accept="image/*,.pdf">
      </div>
      <div class="lb-2col" style="margin-bottom:14px;">
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Your CGPA (optional)</div>
          <input type="number" id="lb-claimed-cgpa" step="0.01" min="0" max="10" placeholder="e.g. 8.42" style="width:100%;">
        </div>
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">This semester's SGPA (optional)</div>
          <input type="number" id="lb-claimed-sgpa" step="0.01" min="0" max="10" placeholder="optional" style="width:100%;">
        </div>
      </div>
      <div class="helper" style="margin-bottom:14px;">These numbers are just a hint for the reviewer — what actually gets frozen on your profile is read directly off the document, not typed by you.</div>
      <button class="btn" style="width:100%;" onclick="lbSubmitTranscript()">Submit for verification</button>
      ${_lbMyResults.length > 0 ? `<button class="btn sec" style="width:100%;margin-top:8px;" onclick="lbRefresh()">← Back to leaderboard</button>` : ''}
    </div>
  `);
}

async function lbSubmitTranscript() {
  const semester_number = parseInt(document.getElementById('lb-semester-number').value, 10);
  const fileInput = document.getElementById('lb-transcript-file');
  const file = fileInput.files[0];
  if (!file) { showToast('Choose a file first'); return; }

  const claimed_cgpa = parseFloat(document.getElementById('lb-claimed-cgpa').value) || null;
  const claimed_sgpa = parseFloat(document.getElementById('lb-claimed-sgpa').value) || null;

  // Mobile browsers (Android especially, when the file comes from a
  // gallery/content picker rather than local storage) sometimes hand back
  // a File with an empty `.type`. Supabase stores whatever content-type
  // the browser sends, so an empty type gets saved as a generic
  // application/octet-stream object — which is why it can silently fail
  // to render as an image in the Storage dashboard even though the bytes
  // are fine. Force a real one before uploading.
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const fileToUpload = file.type ? file : new File([file], file.name, { type: contentType });

  const path = `${_lbSession.user.id}/${Date.now()}-${file.name}`;
  const { error: uploadErr } = await _lbClient.storage.from('transcripts').upload(path, fileToUpload, { contentType });
  if (uploadErr) { showToast('Upload failed: ' + uploadErr.message); return; }

  const { error: reqErr } = await _lbClient.from('verification_requests').insert({
    profile_id: _lbSession.user.id,
    semester_number,
    transcript_storage_path: path,
    claimed_cgpa, claimed_sgpa,
  });
  if (reqErr) { showToast('Could not submit: ' + reqErr.message); return; }

  showToast('✓ Submitted — you\'ll see verified status here once reviewed', 'success');
  await lbRefresh();
}

// ─── ACADEMIC YEAR LABEL (August rollover) ──────────────────────────
function lbYearLabel(admissionYear, durationYears, manualOverride) {
  if (manualOverride) return manualOverride;
  const AUGUST = 7;
  const today = new Date();
  const effectiveYear = today.getMonth() >= AUGUST ? today.getFullYear() : today.getFullYear() - 1;
  let n = Math.max(1, Math.min(effectiveYear - admissionYear + 1, durationYears));
  const labels4 = ['freshman', 'sophomore', 'junior', 'final'];
  const labels3 = ['freshman', 'sophomore', 'final'];
  return (durationYears === 4 ? labels4 : labels3)[n - 1];
}

// ─── VIEW: LEADERBOARD (verified users only, per RLS) ───────────────
// _lbSemesterView === 'overall'  -> queries the `leaderboard` view
//   (each person's most recent verified semester), ranked by cumulative CGPA.
// _lbSemesterView === 1..8       -> queries `semester_leaderboard` filtered
//   to that semester, ranked by THAT semester's SGPA (cumulative CGPA as of
//   that point is shown alongside). Flip the sort to `cgpa` instead of
//   `sgpa` below if you'd rather rank each semester tab by cumulative
//   standing instead of that semester's individual performance.
async function lbRenderLeaderboard() {
  const myYearLabel = lbYearLabel(_lbProfile.admission_year, _lbProfile.program_duration_years, _lbProfile.manual_year_override);
  const latest = _lbMyResults[_lbMyResults.length - 1];
  const isOverall = _lbSemesterView === 'overall';

  const query = isOverall
    ? _lbClient.from('leaderboard').select('*')
    : _lbClient.from('semester_leaderboard').select('*').eq('semester_number', _lbSemesterView);
  const { data: rows, error } = await query;
  if (error) {
    lbRender(`<div class="warn-box">Couldn't load the leaderboard: ${escapeHtml(error.message)}</div>`);
    return;
  }

  const withYear = (rows || []).map(r => ({
    ...r,
    yearLabel: lbYearLabel(r.admission_year, r.program_duration_years, r.manual_year_override),
  }));

  let filtered = withYear;
  if (_lbScope === 'batch') {
    filtered = filtered.filter(r => r.department === _lbProfile.department && r.admission_year === _lbProfile.admission_year);
  } else if (_lbScope === 'department') {
    filtered = filtered.filter(r => r.department === _lbProfile.department);
  }
  filtered.sort((a, b) => isOverall ? (b.frozen_cgpa ?? 0) - (a.frozen_cgpa ?? 0) : (b.sgpa ?? 0) - (a.sgpa ?? 0));

  const colCount = isOverall ? 4 : 5;
  const rowsHtml = filtered.length
    ? filtered.map((r, i) => `
        <tr ${r.profile_id === _lbSession.user.id ? 'style="background:rgba(232,255,71,0.06);"' : ''}>
          <td style="color:var(--muted);width:36px;">${i + 1}</td>
          <td style="font-weight:600;">${escapeHtml(r.shown_name)}</td>
          <td style="color:var(--muted2);text-transform:capitalize;">${escapeHtml(r.yearLabel)}</td>
          ${isOverall
            ? `<td style="font-weight:700;color:var(--acc4);">${Number(r.frozen_cgpa).toFixed(2)}</td>`
            : `<td style="font-weight:700;color:var(--acc4);">${Number(r.sgpa).toFixed(2)}</td><td style="color:var(--muted2);">${Number(r.cgpa).toFixed(2)}</td>`}
        </tr>`).join('')
    : `<tr><td colspan="${colCount}" style="color:var(--muted);text-align:center;padding:20px;font-family:'IBM Plex Mono',monospace;font-size:11px;">No one in this view yet — be the first!</td></tr>`;

  const semesterOptions = Array.from({ length: LB_MAX_SEMESTERS }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${_lbSemesterView === n ? 'selected' : ''}>Semester ${n}</option>`).join('');

  const pendingBanner = (_lbPendingRequest && _lbPendingRequest.status === 'pending')
    ? `<div class="info-box" style="margin:16px 0;">⏳ Semester ${_lbPendingRequest.semester_number} transcript is under review.</div>`
    : '';

  const nextSem = (latest.semester_number || 0) + 1;
  const addSemesterButton = (!pendingBanner && nextSem <= LB_MAX_SEMESTERS)
    ? `<button class="btn sec sm" style="margin-top:12px;" onclick="lbGoAddSemester()">+ Submit Semester ${nextSem}'s transcript</button>`
    : (!pendingBanner ? `<div class="helper" style="margin-top:12px;">🎓 All ${LB_MAX_SEMESTERS} semesters recorded.</div>` : '');

  const historyRows = _lbMyResults.map(r => `
    <tr>
      <td style="color:var(--muted2);">Sem ${r.semester_number}</td>
      <td>${Number(r.sgpa).toFixed(2)}</td>
      <td style="color:var(--muted2);">${Number(r.cgpa).toFixed(2)}</td>
      <td style="color:var(--muted);font-size:11px;">${new Date(r.verified_at).toLocaleDateString()}</td>
    </tr>`).join('');
  const historyTable = _lbMyResults.length > 1 ? `
    <div class="sec-head" style="margin-top:16px;">Your history</div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="thresh-table">
        <thead><tr><th>Sem</th><th>SGPA</th><th>CGPA</th><th>Verified</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>` : '';

  lbRender(`
    <div class="flex-gap" style="justify-content:flex-end;margin-bottom:10px;">
      <button class="btn sec sm" onclick="lbOpenSettings()">⚙ Profile settings</button>
      <button class="btn sec sm" onclick="lbSignOut()">Sign out</button>
    </div>
    <div class="hero-grid" style="margin-bottom:4px;">
      <div class="hero-stat" style="--accent-color: var(--acc4)">
        <div class="lbl">Your current CGPA</div>
        <div class="val" style="color:var(--acc4)">${Number(latest.cgpa).toFixed(2)}</div>
        <span class="div-badge">Semester ${latest.semester_number} · verified ${new Date(latest.verified_at).toLocaleDateString()}</span>
      </div>
    </div>

    ${pendingBanner}
    ${addSemesterButton}
    ${historyTable}

    <div class="toggle-row" style="margin-top:16px;">
      <div>
        <span class="toggle-lbl">Show me on the leaderboard</span>
        <span class="toggle-sub">Off by default. You can flip this back off anytime — it takes effect immediately.</span>
      </div>
      <label class="switch">
        <input type="checkbox" ${_lbProfile.visible_on_leaderboard ? 'checked' : ''} onchange="lbToggleVisibility(this.checked)">
        <span class="slider-sw"></span>
      </label>
    </div>

    <div class="sec-head" style="margin-top:20px;">Rankings</div>
    <div class="flex-gap" style="margin-bottom:10px;">
      <button class="btn ${_lbScope === 'batch' ? '' : 'sec'} sm" onclick="lbSetScope('batch')">My batch (${_lbProfile.department} '${String(_lbProfile.admission_year).slice(-2)})</button>
      <button class="btn ${_lbScope === 'department' ? '' : 'sec'} sm" onclick="lbSetScope('department')">${escapeHtml(_lbProfile.department)}, all years</button>
      <button class="btn ${_lbScope === 'university' ? '' : 'sec'} sm" onclick="lbSetScope('university')">University-wide</button>
    </div>
    <div style="margin-bottom:10px;">
      <select id="lb-semester-select" style="width:100%;" onchange="lbSetSemesterView(this.value === 'overall' ? 'overall' : parseInt(this.value, 10))">
        <option value="overall" ${isOverall ? 'selected' : ''}>Overall (cumulative CGPA)</option>
        ${semesterOptions}
      </select>
    </div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="thresh-table">
        <thead><tr><th></th><th>Name</th><th>Year</th>${isOverall ? '<th>CGPA</th>' : '<th>SGPA</th><th>CGPA</th>'}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="helper" style="text-align:right;margin-top:6px;">🟢 Live — <span id="lb-live-ts">updates automatically</span></div>

    ${LB_ADMIN_EMAILS.includes((_lbSession.user.email || '').toLowerCase()) ? '<div id="lb-admin-panel"></div>' : ''}
  `);

  if (LB_ADMIN_EMAILS.includes((_lbSession.user.email || '').toLowerCase())) {
    lbRenderAdminPanel();
  }
}

function lbSetScope(scope) {
  _lbScope = scope;
  lbRenderLeaderboard();
}

function lbSetSemesterView(view) {
  _lbSemesterView = view;
  lbRenderLeaderboard();
}

function lbGoAddSemester() {
  const latest = _lbMyResults[_lbMyResults.length - 1];
  const nextSem = Math.min((latest?.semester_number || 0) + 1, LB_MAX_SEMESTERS);
  _lbOnLeaderboardView = false;
  lbRenderVerificationFlow(null, nextSem);
}

async function lbToggleVisibility(visible) {
  const { error } = await _lbClient.from('profiles').update({ visible_on_leaderboard: visible }).eq('id', _lbSession.user.id);
  if (error) { showToast('Could not update: ' + error.message); return; }
  _lbProfile.visible_on_leaderboard = visible;
  showToast(visible ? '✓ Now visible on the leaderboard' : '✓ Hidden from the leaderboard', 'success');
}

// ─── VIEW: PROFILE SETTINGS ──────────────────────────────────────────
// Everything here is a column on `profiles` the owning user is already
// allowed to update per "profiles_update_own" in schema.sql — this is
// just the UI for it. roll_number is deliberately NOT editable from here
// (it's what verification cross-checks against); ask an admin to fix a
// typo'd roll number directly if that ever comes up.
function lbOpenSettings() {
  _lbOnLeaderboardView = false;
  lbRenderSettings();
}

function lbYearOverrideOptions(durationYears, selected) {
  const labels = durationYears === 3
    ? [['', 'Auto-detect from admission year'], ['freshman', 'Freshman'], ['sophomore', 'Sophomore'], ['final', 'Final year']]
    : [['', 'Auto-detect from admission year'], ['freshman', 'Freshman'], ['sophomore', 'Sophomore'], ['junior', 'Junior'], ['final', 'Final year']];
  return labels.map(([val, label]) => `<option value="${val}" ${(selected || '') === val ? 'selected' : ''}>${label}</option>`).join('');
}

function lbRenderSettings() {
  const p = _lbProfile;
  lbRender(`
    <div class="info-box" style="margin-bottom:16px;">Changes here save immediately and reflect on the leaderboard right away.</div>
    <div class="card">
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">First name (shown on leaderboard)</div>
        <input type="text" id="lbs-name" value="${escapeHtml(p.display_name)}" style="width:100%;">
      </div>
      <div style="margin-bottom:12px;">
        <div class="field-lbl" style="margin-bottom:5px;">Last initial</div>
        <input type="text" id="lbs-lastinitial" maxlength="1" value="${escapeHtml(p.last_initial)}" style="width:80px;">
      </div>
      <div class="toggle-row">
        <div>
          <span class="toggle-lbl">Show my full name instead of "${escapeHtml(p.display_name)} ${escapeHtml(p.last_initial)}."</span>
          <span class="toggle-sub">Off by default. You can flip this back off anytime.</span>
        </div>
        <label class="switch">
          <input type="checkbox" id="lbs-fullname" ${p.full_name_opt_in ? 'checked' : ''}>
          <span class="slider-sw"></span>
        </label>
      </div>
      <div class="lb-2col" style="margin:12px 0;">
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Department</div>
          <input type="text" id="lbs-dept" value="${escapeHtml(p.department)}" style="width:100%;">
        </div>
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Degree</div>
          <input type="text" id="lbs-degree" value="${escapeHtml(p.degree_type)}" style="width:100%;">
        </div>
      </div>
      <div class="lb-2col" style="margin-bottom:12px;">
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Admission year</div>
          <input type="number" id="lbs-admyear" value="${p.admission_year}" style="width:100%;">
        </div>
        <div>
          <div class="field-lbl" style="margin-bottom:5px;">Program length</div>
          <select id="lbs-duration" style="width:100%;" onchange="lbSettingsDurationChanged()">
            <option value="4" ${p.program_duration_years === 4 ? 'selected' : ''}>4 years (B.Tech etc.)</option>
            <option value="3" ${p.program_duration_years === 3 ? 'selected' : ''}>3 years (BA etc.)</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <div class="field-lbl" style="margin-bottom:5px;">Year label override</div>
        <select id="lbs-yearoverride" style="width:100%;">${lbYearOverrideOptions(p.program_duration_years, p.manual_year_override)}</select>
        <div class="helper">Leave on auto-detect unless your year label looks wrong (e.g. after a repeat/drop year).</div>
      </div>
      <div style="margin-bottom:16px;">
        <div class="field-lbl" style="margin-bottom:5px;">Roll number</div>
        <input type="text" value="${escapeHtml(p.roll_number)}" disabled style="width:100%;opacity:0.6;">
        <div class="helper">Can't be changed here — it's cross-checked at verification time. Contact an admin if it's wrong.</div>
      </div>
      <button class="btn" style="width:100%;" onclick="lbSaveSettings()">Save changes</button>
      <button class="btn sec" style="width:100%;margin-top:8px;" onclick="lbRefresh()">← Back to leaderboard</button>
    </div>
  `);
}

// Re-renders the form with the new duration's year-label options while
// preserving whatever the person already typed in the other fields.
function lbSettingsDurationChanged() {
  const captured = {
    name: document.getElementById('lbs-name').value,
    lastinitial: document.getElementById('lbs-lastinitial').value,
    fullname: document.getElementById('lbs-fullname').checked,
    dept: document.getElementById('lbs-dept').value,
    degree: document.getElementById('lbs-degree').value,
    admyear: document.getElementById('lbs-admyear').value,
    yearoverride: document.getElementById('lbs-yearoverride').value,
  };
  const duration = parseInt(document.getElementById('lbs-duration').value, 10);

  const original = _lbProfile;
  _lbProfile = { ..._lbProfile, program_duration_years: duration };
  lbRenderSettings();
  _lbProfile = original; // not persisted until Save is clicked

  document.getElementById('lbs-name').value = captured.name;
  document.getElementById('lbs-lastinitial').value = captured.lastinitial;
  document.getElementById('lbs-fullname').checked = captured.fullname;
  document.getElementById('lbs-dept').value = captured.dept;
  document.getElementById('lbs-degree').value = captured.degree;
  document.getElementById('lbs-admyear').value = captured.admyear;
  document.getElementById('lbs-duration').value = duration;
  const yearSelect = document.getElementById('lbs-yearoverride');
  if ([...yearSelect.options].some(o => o.value === captured.yearoverride)) {
    yearSelect.value = captured.yearoverride;
  }
}

async function lbSaveSettings() {
  const display_name = document.getElementById('lbs-name').value.trim();
  const last_initial = document.getElementById('lbs-lastinitial').value.trim().toUpperCase();
  const full_name_opt_in = document.getElementById('lbs-fullname').checked;
  const department = document.getElementById('lbs-dept').value.trim();
  const degree_type = document.getElementById('lbs-degree').value.trim();
  const admission_year = parseInt(document.getElementById('lbs-admyear').value, 10);
  const program_duration_years = parseInt(document.getElementById('lbs-duration').value, 10);
  const manual_year_override = document.getElementById('lbs-yearoverride').value || null;

  if (!display_name || !last_initial || !department || !degree_type || !admission_year) {
    showToast('Please fill in every field');
    return;
  }

  const { error } = await _lbClient.from('profiles').update({
    display_name, last_initial, full_name_opt_in, department, degree_type,
    admission_year, program_duration_years, manual_year_override,
    updated_at: new Date().toISOString(),
  }).eq('id', _lbSession.user.id);

  if (error) { showToast('Could not save: ' + error.message); return; }
  showToast('✓ Settings saved', 'success');
  await lbRefresh();
}

// ─── ADMIN REVIEW PANEL ──────────────────────────────────────────────
async function lbCallEdgeFunction(payload) {
  const res = await fetch(LB_EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + _lbSession.access_token,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function lbRenderAdminPanel() {
  const panel = document.getElementById('lb-admin-panel');
  if (!panel) return;
  panel.innerHTML = `<div class="sec-head" style="margin-top:24px;">Review Queue (admin)</div><div class="card"><div class="helper">Loading…</div></div>`;

  const result = await lbCallEdgeFunction({ action: 'list_pending' });
  if (result.error) {
    panel.innerHTML = `<div class="sec-head" style="margin-top:24px;">Review Queue (admin)</div><div class="warn-box">${escapeHtml(result.error)}</div>`;
    return;
  }

  const requests = result.requests || [];
  if (requests.length === 0) {
    panel.innerHTML = `<div class="sec-head" style="margin-top:24px;">Review Queue (admin)</div><div class="card empty-state"><div class="empty-sub">Nothing pending.</div></div>`;
    return;
  }

  panel.innerHTML = `<div class="sec-head" style="margin-top:24px;">Review Queue (admin) — ${requests.length} pending</div>` +
    requests.map(r => `
      <div class="card" id="lb-req-${r.id}" style="margin-bottom:10px;">
        <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(r.profiles.display_name)} — roll ${escapeHtml(r.profiles.roll_number)} — Semester ${r.semester_number}</div>
        <div class="helper" style="margin-bottom:10px;">
          ${escapeHtml(r.profiles.department)} · admitted ${r.profiles.admission_year} ·
          ${r.profiles.has_university_email ? 'has university email' : 'no university email'} ·
          claimed CGPA: ${r.claimed_cgpa ?? '—'} · claimed SGPA: ${r.claimed_sgpa ?? '—'}
        </div>
        <button class="btn sec sm" onclick="lbViewTranscript('${r.id}')" style="margin-bottom:10px;">📄 View transcript</button>
        <div class="helper" style="margin-bottom:4px;">Both fields below are required — read them off the document, not from the claimed values above.</div>
        <div class="lb-2col" style="margin-bottom:10px;">
          <input type="number" id="lb-sgpa-${r.id}" step="0.01" min="0" max="10" placeholder="Sem ${r.semester_number} SGPA (document)">
          <input type="number" id="lb-cgpa-${r.id}" step="0.01" min="0" max="10" placeholder="Cumulative CGPA (document)">
        </div>
        <div class="flex-gap">
          <button class="btn sm" onclick="lbApprove('${r.id}')">✓ Approve</button>
          <button class="btn sec sm danger" onclick="lbReject('${r.id}')">✕ Reject</button>
        </div>
      </div>
    `).join('');
}

async function lbViewTranscript(requestId) {
  const result = await lbCallEdgeFunction({ action: 'get_review_url', request_id: requestId });
  if (result.error) { showToast(result.error); return; }
  window.open(result.url, '_blank');
}

async function lbApprove(requestId) {
  const sgpa = parseFloat(document.getElementById('lb-sgpa-' + requestId).value);
  const cgpa = parseFloat(document.getElementById('lb-cgpa-' + requestId).value);
  if (!sgpa || !cgpa) { showToast('Enter both SGPA and CGPA as shown on the document first'); return; }
  const result = await lbCallEdgeFunction({ action: 'approve', request_id: requestId, sgpa, cgpa });
  if (result.error) { showToast(result.error); return; }
  showToast('✓ Approved', 'success');
  lbRenderAdminPanel();
}

async function lbReject(requestId) {
  const reason = prompt('Rejection reason (shown to the student):') || '';
  const result = await lbCallEdgeFunction({ action: 'reject', request_id: requestId, rejection_reason: reason });
  if (result.error) { showToast(result.error); return; }
  showToast('Rejected', 'success');
  lbRenderAdminPanel();
}
