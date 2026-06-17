// ─── STATE ─────────────────────────────────────────
let courses = [];
let courseIdCounter = 0;
let pastSems = [];
let pastSemIdCounter = 0;
let _saveTimer = null;
let crossSemOverride = false;   // v5.4: true if user manually edited prev fields

// ─── THEME (light is default; dark is opt-in & remembered) ──
const THEME_KEY = 'doon_calc_theme';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch(e) {}
  applyTheme(saved === 'dark' ? 'dark' : 'light');
}

function toggleTheme() {
  const goingDark = document.documentElement.getAttribute('data-theme') !== 'dark';
  applyTheme(goingDark ? 'dark' : 'light');
  try { localStorage.setItem(THEME_KEY, goingDark ? 'dark' : 'light'); } catch(e) {}
  refreshThemedUI();
}

// Re-renders every view whose colors are baked in as inline styles at
// render time, so switching theme updates already-visible elements too.
function refreshThemedUI() {
  if (typeof renderCourses === 'function') renderCourses();
  if (typeof renderPastSems === 'function') renderPastSems();
  if (typeof calcPlan === 'function') calcPlan();
  if (typeof renderSemSwitcher === 'function') renderSemSwitcher();
  if (typeof updateSem1UI === 'function') updateSem1UI();
}

// ─── LOCALSTORAGE PERSISTENCE ───────────────────────
const SEM_KEY    = n => 'doon_calc_sem_' + n;   // per-semester slot
const PLAN_KEY   = 'doon_calc_planner';              // CGPA planner (shared)
const META_KEY   = 'doon_calc_meta';                 // { activeSem, semsUsed[] }
let activeSem    = null;  // which semester slot is currently open (1-8)

function saveState() {
  try {
    // Save current semester slot
    if (activeSem) {
      const semState = {
        courses,
        courseIdCounter,
        globalHalved: document.getElementById('global-halved').checked,
        savedAt: Date.now(),
        semNum: activeSem,
      };
      localStorage.setItem(SEM_KEY(activeSem), JSON.stringify(semState));
    }
    // Save planner state separately
    const planState = {
      pastSems,
      pastSemIdCounter,
      prevCredits: document.getElementById('prev-credits').value,
      prevPoints:  document.getElementById('prev-points').value,
      curCreditsPlan: document.getElementById('cur-credits-plan').value,
      targetCgpa: document.getElementById('target-cgpa').value,
    };
    localStorage.setItem(PLAN_KEY, JSON.stringify(planState));
    // Save meta
    const meta = getMetaState();
    if (activeSem && !meta.semsUsed.includes(activeSem)) {
      meta.semsUsed.push(activeSem);
      meta.semsUsed.sort((a,b) => a-b);
    }
    meta.activeSem = activeSem;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    // Flash the save indicator
    const ind = document.getElementById('save-indicator');
    const lbl = document.getElementById('save-label');
    ind.classList.add('saved');
    const d = new Date();
    lbl.textContent = 'saved ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      ind.classList.remove('saved');
      lbl.textContent = 'auto-saved';
    }, 2500);
  } catch(e) { /* storage quota or private mode — silently ignore */ }
}

function getMetaState() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { activeSem: null, semsUsed: [] };
}

// ─── v5.4: CROSS-SEM CGPA AUTO-FILL ────────────────
// Reads all saved sem slots BEFORE activeSem, sums credits+points,
// then fills the prev-credits/prev-points fields automatically.
function autoFillPrevFromSavedSems(currentSem) {
  if (crossSemOverride) return; // user manually set values — respect that

  const meta = getMetaState();
  const semsUsed = (meta.semsUsed || []).filter(s => s < currentSem).sort((a,b) => a-b);
  if (semsUsed.length === 0) {
    // No prior sems — clear fields and hide banner
    document.getElementById('prev-credits').value = '';
    document.getElementById('prev-points').value = '';
    document.getElementById('crosssem-banner').style.display = 'none';
    updateHero();
    return;
  }

  let totalCr = 0, totalPts = 0;
  const semsContrib = [];

  semsUsed.forEach(semN => {
    try {
      const raw = localStorage.getItem(SEM_KEY(semN));
      if (!raw) return;
      const state = JSON.parse(raw);
      const semCourses = state.courses || [];
      const halved = state.globalHalved ?? true;
      let semCr = 0, semPts = 0;
      semCourses.forEach(c => {
        const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halved ? 'halved' : 'full');
        const cv = { ...c, midsemType: effectiveMidsemType };
        const total = calcTotal(cv, c.endsemScore);
        const grade = getGrade(total);
        semPts += grade.pts * c.credits;
        semCr  += c.credits;
      });
      totalCr  += semCr;
      totalPts += semPts;
      if (semCr > 0) {
        const sgpa = (semPts / semCr).toFixed(2);
        semsContrib.push(`Sem ${semN} (${sgpa})`);
      }
    } catch(e) {}
  });

  if (totalCr === 0) {
    document.getElementById('crosssem-banner').style.display = 'none';
    return;
  }

  document.getElementById('prev-credits').value = totalCr;
  document.getElementById('prev-points').value  = totalPts;

  // Show informational banner
  const banner = document.getElementById('crosssem-banner');
  const cgpa = (totalPts / totalCr).toFixed(2);
  const d = divLabel(totalPts / totalCr);
  document.getElementById('cs-text').innerHTML =
    `⚡ Auto-filled from ${semsContrib.join(', ')} → CGPA so far: <b style="color:${d.color}">${cgpa}</b>`;
  document.getElementById('cs-sub').textContent =
    'You can edit the fields below to override (e.g. if a course grade changed).';
  banner.style.display = 'flex';

  updateHero();
  updatePrevSgpaCheck();
}

function loadSemSlot(semNum) {
  try {
    const raw = localStorage.getItem(SEM_KEY(semNum));
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (state.savedAt && (Date.now() - state.savedAt) > 365 * 24 * 3600 * 1000) return false;
    courses = state.courses || [];
    courseIdCounter = state.courseIdCounter || courses.length;
    document.getElementById('global-halved').checked = state.globalHalved ?? true;
    return true;
  } catch(e) { return false; }
}

function loadPlannerSlot() {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    pastSems = state.pastSems || [];
    pastSemIdCounter = state.pastSemIdCounter || pastSems.length;
    document.getElementById('prev-credits').value     = state.prevCredits   ?? '';
    document.getElementById('prev-points').value      = state.prevPoints    ?? '';
    document.getElementById('cur-credits-plan').value = state.curCreditsPlan ?? 22;
    document.getElementById('target-cgpa').value      = state.targetCgpa   ?? '8.00';
  } catch(e) {}
}

function switchToSem(semNum) {
  // Save current sem first
  if (activeSem) saveState();
  activeSem = semNum;
  crossSemOverride = false; // reset override flag on sem switch

  const ok = loadSemSlot(semNum);
  if (!ok) {
    // New slot — init from SEM_COURSES if available
    courses = [];
    courseIdCounter = 0;
    if (SEM_COURSES[semNum]) {
      SEM_COURSES[semNum].forEach(sc => {
        courses.push({
          id: ++courseIdCounter,
          name: sc.name, credits: sc.credits,
          internal: 0, internalMax: 20,
          midsem: 0, midsemMax: 30, midsemType: 'auto',
          teacherAward: 0, teacherAwardMax: 30,
          endsemMax: sc.endsemMax, endsemScore: 0,
        });
      });
    }
  }
  renderCourses();
  renderSemSwitcher();
  updateSem1UI(); // v5.5: hide/show prev section and CGPA card based on sem
  autoFillPrevFromSavedSems(semNum); // v5.4: auto-fill CGPA from prev sems
  debouncedSave();
  const label = ok ? 'Sem ' + semNum + ' loaded' : 'Sem ' + semNum + ' started';
  showToast('✓ ' + label, 'success');
}

// Legacy single-key migration (v3 → v4 multi-sem)
function restoreState(state) {
  // Only used for legacy migration — new code uses loadSemSlot/loadPlannerSlot
  courses = state.courses || [];
  courseIdCounter = state.courseIdCounter || courses.length;
  pastSems = state.pastSems || [];
  pastSemIdCounter = state.pastSemIdCounter || pastSems.length;
  document.getElementById('prev-credits').value     = state.prevCredits   ?? '';
  document.getElementById('prev-points').value      = state.prevPoints    ?? '';
  document.getElementById('global-halved').checked  = state.globalHalved ?? true;
  document.getElementById('cur-credits-plan').value = state.curCreditsPlan ?? 22;
  document.getElementById('target-cgpa').value      = state.targetCgpa   ?? '8.00';
}

function debouncedSave() {
  // Save 600ms after last change — avoids hammering storage on rapid slider drag
  clearTimeout(window._debounceSaveTimer);
  window._debounceSaveTimer = setTimeout(saveState, 600);
}

// v5.4: Called when user manually edits the prev-credits/prev-points fields
function onPrevFieldEdit() {
  crossSemOverride = true;
  const banner = document.getElementById('crosssem-banner');
  if (banner) {
    document.getElementById('cs-sub').textContent = 'Manual override active — auto-fill paused.';
  }
  recalcAll();
}

// ─── SEM SWITCHER UI ────────────────────────────────
function renderSemSwitcher() {
  const bar = document.getElementById('sem-switcher-bar');
  if (!bar) return;
  if (!activeSem) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const meta = getMetaState();
  const used = meta.semsUsed || [];
  const allUsed = used.includes(activeSem) ? used : [...used, activeSem].sort((a,b)=>a-b);

  // v5.4: Compute per-sem SGPA for pills and running CGPA
  const semSgpaMap = {};
  let runningCr = 0, runningPts = 0;
  allUsed.forEach(s => {
    try {
      const raw = localStorage.getItem(SEM_KEY(s));
      if (!raw) return;
      const state = JSON.parse(raw);
      const semCourses = state.courses || [];
      const halved = state.globalHalved ?? true;
      let semCr = 0, semPts = 0;
      semCourses.forEach(c => {
        const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halved ? 'halved' : 'full');
        const cv = { ...c, midsemType: effectiveMidsemType };
        const total = calcTotal(cv, c.endsemScore);
        const grade = getGrade(total);
        semPts += grade.pts * c.credits;
        semCr  += c.credits;
      });
      if (semCr > 0) {
        semSgpaMap[s] = (semPts / semCr);
        runningCr  += semCr;
        runningPts += semPts;
      }
    } catch(e) {}
  });

  let html = '<span class="sem-switcher-label">Semester</span>';
  for (let s = 1; s <= 8; s++) {
    const isActive = s === activeSem;
    const isUsed   = allUsed.includes(s);
    const cls = 'sem-pill' + (isActive ? ' active' : '') + (!isActive && isUsed ? ' used' : '') + (!isActive && !isUsed ? ' ghost' : '');
    const dot  = isUsed && !isActive ? '<span class="pill-dot"></span>' : '';
    // v5.4: Show SGPA under pill if computed
    const sgpaStr = (isUsed && semSgpaMap[s]) ? `<span class="sem-pill-sgpa">${semSgpaMap[s].toFixed(2)}</span>` : '';
    html += `<button class="${cls}" onclick="switchToSem(${s})" title="Semester ${s}${isUsed ? ` · SGPA ${(semSgpaMap[s]||0).toFixed(2)}` : ' · start fresh'}">${s}${dot}${sgpaStr}</button>`;
  }

  // v5.4: Running CGPA chip
  if (runningCr > 0) {
    const cgpa = (runningPts / runningCr).toFixed(2);
    const d = divLabel(runningPts / runningCr);
    html += `<span class="sem-cgpa-chip" title="Cumulative CGPA across all saved semesters">CGPA <span style="color:${d.color}">${cgpa}</span></span>`;
  }

  bar.innerHTML = html;
  // Update sem label in hero
  const lbl = document.getElementById('active-sem-label');
  if (lbl) lbl.textContent = '· SEM ' + activeSem;
}

// ─── TOAST ───────────────────────────────────────────
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── COPY SUMMARY ───────────────────────────────────
function copySummary() {
  if (courses.length === 0) {
    showToast('No courses to summarise — add some first!');
    return;
  }
  const halvedGlobal = document.getElementById('global-halved').checked;
  const prevCr  = parseFloat(document.getElementById('prev-credits').value)  || 0;
  const prevPts = parseFloat(document.getElementById('prev-points').value)   || 0;

  let totalPts = 0, totalCr = 0;
  const lines = [];

  lines.push('╔═══════════════════════════════════════╗');
  lines.push('║   DOON UNIVERSITY — GRADE SUMMARY     ║');
  lines.push('╚═══════════════════════════════════════╝');
  lines.push('Generated: ' + new Date().toLocaleString());
  lines.push('');
  lines.push('SEMESTER COURSES');
  lines.push('─'.repeat(42));

  const padR = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);

  lines.push(padR('Course', 28) + padL('Cr', 4) + padL('Total', 7) + padL('Grade', 7) + padL('Pts', 5));
  lines.push('─'.repeat(42));

  courses.forEach(c => {
    const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
    const cv = { ...c, midsemType: effectiveMidsemType };
    const total = calcTotal(cv, c.endsemScore);
    const grade = getGrade(total);
    totalPts += grade.pts * c.credits;
    totalCr  += c.credits;
    const name = c.name.length > 26 ? c.name.slice(0, 24) + '..' : c.name;
    lines.push(padR(name, 28) + padL(c.credits, 4) + padL(total.toFixed(1), 7) + padL(grade.letter, 7) + padL(grade.pts, 5));
  });

  lines.push('─'.repeat(42));
  const sgpa = totalCr > 0 ? totalPts / totalCr : 0;
  const sd = divLabel(sgpa);
  lines.push('');
  lines.push('SEMESTER RESULT');
  lines.push('  Total Credits   : ' + totalCr);
  lines.push('  Credit Points   : ' + totalPts);
  lines.push('  SGPA            : ' + sgpa.toFixed(2) + '  (' + sd.txt + ')');
  lines.push('  Equivalent %    : ' + (sgpa * 10).toFixed(1) + '%');

  if (prevCr > 0) {
    const cgpaCredits = prevCr + totalCr;
    const cgpaPoints  = prevPts + totalPts;
    const cgpa = cgpaCredits > 0 ? cgpaPoints / cgpaCredits : 0;
    const cd = divLabel(cgpa);
    lines.push('');
    lines.push('CUMULATIVE (ALL SEMESTERS)');
    lines.push('  Previous Credits: ' + prevCr + ' · Points: ' + prevPts);
    lines.push('  CGPA            : ' + cgpa.toFixed(2) + '  (' + cd.txt + ')');
  }

  lines.push('');
  lines.push('Grade Scale: O(10) A+(9) A(8) B+(7) B(6) C(5) D(4) F(0)');
  lines.push('Distinction ≥ 8.00 · First Div ≥ 6.00 · Second Div ≥ 5.00');
  lines.push('─'.repeat(42));

  const text = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✓ Summary copied to clipboard!', 'success');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('✓ Summary copied!', 'success');
  } catch(e) {
    showToast('Could not copy — try long-pressing the text');
  }
  document.body.removeChild(ta);
}

// ─── SHARE CARD (v6.1) ──────────────────────────────
// Draws a 1080×1920 canvas card (WhatsApp/Instagram story size)
// showing SGPA, CGPA, per-course grades, and division badge.

function shareCard() {
  const halvedGlobal = document.getElementById('global-halved').checked;
  const prevCr  = parseFloat(document.getElementById('prev-credits').value) || 0;
  const prevPts = parseFloat(document.getElementById('prev-points').value) || 0;

  if (courses.length === 0) {
    showToast('Add some courses first!');
    return;
  }

  // The exported card always keeps its own fixed dark, branded look
  // (like a Wrapped-style share card) regardless of the live site theme.
  // Force dark theme just for this draw, then restore whatever the user
  // actually had active.
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'dark');
  try {
    shareCardDraw(halvedGlobal, prevCr, prevPts);
  } finally {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
    else document.documentElement.removeAttribute('data-theme');
  }
}

function shareCardDraw(halvedGlobal, prevCr, prevPts) {

  // ── Compute data ──
  let totalPts = 0, totalCr = 0;
  const courseRows = courses.map(c => {
    const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
    const cv = { ...c, midsemType: effectiveMidsemType };
    const total = calcTotal(cv, c.endsemScore);
    const grade = getGrade(total);
    totalPts += grade.pts * c.credits;
    totalCr  += c.credits;
    return { name: c.name, credits: c.credits, total, grade };
  });

  const sgpa = totalCr > 0 ? totalPts / totalCr : 0;
  const cgpaCredits = prevCr + totalCr;
  const cgpaPoints  = prevPts + totalPts;
  const cgpa = cgpaCredits > 0 ? cgpaPoints / cgpaCredits : null;
  const sd = divLabel(sgpa);

  // ── Canvas setup ──
  const W = 1080, H = 1920;
  const canvas = document.getElementById('share-canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#060608');
  bg.addColorStop(0.5, '#0d0d18');
  bg.addColorStop(1, '#060608');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Accent glow top
  const glow = ctx.createRadialGradient(W/2, 0, 0, W/2, 0, 600);
  glow.addColorStop(0, sd.color + '22');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 600);

  // ── Header ──
  ctx.fillStyle = sd.color;
  ctx.font = '500 32px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('DOON UNIVERSITY · CSE', W/2, 120);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '400 26px "IBM Plex Mono", monospace';
  ctx.fillText(`SEM ${activeSem || ''}  ·  RESULT CARD`, W/2, 168);

  // Divider line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(80, 200); ctx.lineTo(W - 80, 200); ctx.stroke();

  // ── SGPA Hero ──
  const sgpaColor = sd.color;
  ctx.fillStyle = sgpaColor + '15';
  roundRect(ctx, 80, 230, W - 160, 280, 24);
  ctx.fill();
  ctx.strokeStyle = sgpaColor + '40';
  ctx.lineWidth = 2;
  roundRect(ctx, 80, 230, W - 160, 280, 24);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.font = '500 30px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SEMESTER GPA', W/2, 290);

  ctx.fillStyle = sgpaColor;
  ctx.font = `700 160px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(sgpa.toFixed(2), W/2, 440);

  // Division badge
  const badgeTxt = sd.txt.toUpperCase();
  ctx.font = '700 28px Inter, sans-serif';
  const bdW = ctx.measureText(badgeTxt).width + 48;
  ctx.fillStyle = sgpaColor + '25';
  roundRect(ctx, W/2 - bdW/2, 458, bdW, 50, 25);
  ctx.fill();
  ctx.fillStyle = sgpaColor;
  c
