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
//
// The card has its own fixed "Wrapped"-style branded look, independent of
// the live site's current theme — but the person can pick whether that
// look is light or dark via the toggle in the share modal. Defaults to
// light (matching the site's own default theme).
let shareCardTheme = 'light';
let shareCardData  = null; // cached inputs so we can redraw on theme toggle

async function shareCard() {
  const halvedGlobal = document.getElementById('global-halved').checked;
  const prevCr  = parseFloat(document.getElementById('prev-credits').value) || 0;
  const prevPts = parseFloat(document.getElementById('prev-points').value) || 0;

  if (courses.length === 0) {
    showToast('Add some courses first!');
    return;
  }

  shareCardData = { halvedGlobal, prevCr, prevPts };

  // Make sure the custom webfonts are actually loaded before measuring/
  // drawing text. Without this, the canvas can briefly fall back to a
  // wider system font on first use, which is what let grade letters spill
  // out of their pill backgrounds — the pill sizing below is also made
  // dynamic to guard against this regardless.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) {}
  }

  renderShareCard();
  updateShareThemeButtons();
  document.getElementById('share-modal').style.display = 'block';
}

// Redraws the card using whichever light/dark mode is currently selected.
function renderShareCard() {
  if (!shareCardData) return;
  const { halvedGlobal, prevCr, prevPts } = shareCardData;

  // Force the card's own theme just for this draw (independent of the
  // live site's theme), so grade/division colors read from CSS variables
  // come out correctly, then restore whatever the site actually had active.
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', shareCardTheme);
  try {
    shareCardDraw(halvedGlobal, prevCr, prevPts, shareCardTheme);
  } finally {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
    else document.documentElement.removeAttribute('data-theme');
  }
}

function setShareCardTheme(mode) {
  shareCardTheme = mode === 'dark' ? 'dark' : 'light';
  updateShareThemeButtons();
  renderShareCard();
}

function updateShareThemeButtons() {
  const lightBtn = document.getElementById('share-theme-light');
  const darkBtn  = document.getElementById('share-theme-dark');
  if (!lightBtn || !darkBtn) return;
  lightBtn.classList.toggle('active', shareCardTheme === 'light');
  darkBtn.classList.toggle('active', shareCardTheme === 'dark');
}

function shareCardDraw(halvedGlobal, prevCr, prevPts, cardTheme) {

  const isDark = cardTheme === 'dark';

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

  // ── Palette (light vs dark card look) ──
  const textPrimary   = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,32,0.86)';
  const textSecondary = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(20,20,32,0.48)';
  const textMuted      = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(20,20,32,0.34)';
  const textFaint      = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(20,20,32,0.30)';
  const lineColor      = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(20,20,32,0.09)';
  const lineColorSoft  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,20,32,0.11)';
  const gridColor      = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(20,20,32,0.035)';
  const rowStripe      = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(20,20,32,0.035)';
  const cgpaBoxBg      = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(20,20,32,0.045)';
  const glowAlpha      = isDark ? '22' : '12';

  // ── Canvas setup ──
  const W = 1080, H = 1920;
  const canvas = document.getElementById('share-canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  if (isDark) {
    bg.addColorStop(0, '#060608');
    bg.addColorStop(0.5, '#0d0d18');
    bg.addColorStop(1, '#060608');
  } else {
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.5, '#f3f4f9');
    bg.addColorStop(1, '#ffffff');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Accent glow top
  const glow = ctx.createRadialGradient(W/2, 0, 0, W/2, 0, 600);
  glow.addColorStop(0, sd.color + glowAlpha);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 600);

  // ── Header ──
  ctx.fillStyle = sd.color;
  ctx.font = '500 32px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('DOON UNIVERSITY · CSE', W/2, 120);

  ctx.fillStyle = textFaint;
  ctx.font = '400 26px "IBM Plex Mono", monospace';
  ctx.fillText(`SEM ${activeSem || ''}  ·  RESULT CARD`, W/2, 168);

  // Divider line
  ctx.strokeStyle = lineColorSoft;
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

  ctx.fillStyle = textSecondary;
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
  ctx.font = '700 26px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(badgeTxt, W/2, 490);

  // ── CGPA row (if available) ──
  let nextY = 560;
  if (cgpa !== null) {
    const cd = divLabel(cgpa);
    ctx.fillStyle = cgpaBoxBg;
    roundRect(ctx, 80, nextY, W - 160, 110, 16);
    ctx.fill();

    ctx.fillStyle = textSecondary;
    ctx.font = '500 24px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CUMULATIVE CGPA', 130, nextY + 44);

    ctx.fillStyle = cd.color;
    ctx.font = '700 52px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(cgpa.toFixed(2), W - 130, nextY + 90);

    nextY += 138;
  }

  // ── Course table ──
  // Layout (left → right): course name · credits · grade pill.
  // The grade pill's width is measured from its own text at draw time so
  // letters like "A+" / "B+" always fit inside their oval — it never
  // relies on a fixed guessed width. The raw marks/total score column has
  // been removed so nothing sits crowded next to the grade letters.
  const tableRight = W - 80;
  const pillRightX = tableRight - 10;   // right edge grade pills align to
  const crX = pillRightX - 150;         // credits column center
  const maxNameW = crX - 150;           // course name column width (from x=100)

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, nextY); ctx.lineTo(W - 80, nextY); ctx.stroke();
  nextY += 30;

  // Table header
  ctx.fillStyle = textMuted;
  ctx.font = '500 24px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('COURSE', 100, nextY);
  ctx.textAlign = 'center';
  ctx.fillText('CR', crX, nextY);
  ctx.fillText('GRADE', pillRightX - 55, nextY);
  nextY += 16;

  ctx.strokeStyle = lineColor;
  ctx.beginPath(); ctx.moveTo(80, nextY); ctx.lineTo(W - 80, nextY); ctx.stroke();
  nextY += 28;

  const rowH = Math.min(90, Math.floor((H - nextY - 200) / courseRows.length));

  courseRows.forEach((row, i) => {
    const even = i % 2 === 0;
    const rowTop = nextY - 20;
    if (even) {
      ctx.fillStyle = rowStripe;
      ctx.fillRect(80, rowTop, W - 160, rowH);
    }

    // Single vertical center for this row — course name, credit number,
    // and the grade pill all anchor to this exact line (via textBaseline
    // 'middle') so they stay level with each other instead of each using
    // a different offset guess.
    const rowCenterY = rowTop + rowH / 2;
    ctx.textBaseline = 'middle';

    // Course name — truncate if needed
    ctx.fillStyle = textPrimary;
    ctx.font = `500 ${Math.min(28, rowH * 0.38)}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    const truncName = truncateText(ctx, row.name, maxNameW);
    ctx.fillText(truncName, 100, rowCenterY);

    // Credits
    ctx.fillStyle = textSecondary;
    ctx.font = `500 ${Math.min(26, rowH * 0.35)}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(row.credits, crX, rowCenterY);

    // Grade pill — width measured from the letter itself, so it always
    // fully contains the text no matter how wide the glyphs render.
    const gpH = Math.min(40, rowH * 0.5);
    const letterFont = Math.min(24, rowH * 0.32);
    ctx.font = `700 ${letterFont}px "IBM Plex Mono", monospace`;
    const letterW = ctx.measureText(row.grade.letter).width;
    const gpW = Math.max(gpH * 1.6, letterW + 34);
    const gpX = pillRightX - gpW;
    const gpY = rowCenterY - gpH / 2;

    ctx.fillStyle = row.grade.color + '28';
    roundRect(ctx, gpX, gpY, gpW, gpH, gpH / 2);
    ctx.fill();
    ctx.strokeStyle = row.grade.color + '60';
    ctx.lineWidth = 1.5;
    roundRect(ctx, gpX, gpY, gpW, gpH, gpH / 2);
    ctx.stroke();

    ctx.fillStyle = row.grade.color;
    ctx.textAlign = 'center';
    ctx.fillText(row.grade.letter, gpX + gpW / 2, rowCenterY);

    ctx.textBaseline = 'alphabetic';
    nextY += rowH;
  });
}

function closeShareModal() {
  document.getElementById('share-modal').style.display = 'none';
}

function downloadCard() {
  const canvas = document.getElementById('share-canvas');
  const a = document.createElement('a');
  const sem = activeSem ? `sem${activeSem}-` : '';
  a.download = `doon-cse-${sem}sgpa.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  showToast('✓ Card downloaded!', 'success');
}

function copyCardToClipboard() {
  const canvas = document.getElementById('share-canvas');
  canvas.toBlob(blob => {
    try {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
        showToast('✓ Copied to clipboard!', 'success');
      }).catch(() => showToast('Clipboard copy not supported — use Download instead'));
    } catch(e) {
      showToast('Use Download instead on this browser');
    }
  });
}

// Canvas helpers
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

// ─── DATA BACKUP / RESTORE (v6 P0) ──────────────────// Exports ALL localStorage keys used by this app as a
// single timestamped JSON file — protects against data loss.
function exportData() {
  try {
    const meta = getMetaState();
    const blob_data = { _version: 6, _exportedAt: new Date().toISOString(), meta };
    // Collect every sem slot
    (meta.semsUsed || []).forEach(n => {
      const raw = localStorage.getItem(SEM_KEY(n));
      if (raw) blob_data['sem_' + n] = JSON.parse(raw);
    });
    // Collect planner
    const planRaw = localStorage.getItem(PLAN_KEY);
    if (planRaw) blob_data.planner = JSON.parse(planRaw);

    const blob = new Blob([JSON.stringify(blob_data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const ts   = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `doon-grades-backup-${ts}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    showToast('✓ Backup downloaded!', 'success');
  } catch(e) {
    showToast('Export failed — ' + e.message);
  }
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.meta || !data._version) throw new Error('Not a valid backup file');
      // Restore all sem slots
      const semsUsed = data.meta.semsUsed || [];
      semsUsed.forEach(n => {
        if (data['sem_' + n]) {
          localStorage.setItem(SEM_KEY(n), JSON.stringify(data['sem_' + n]));
        }
      });
      // Restore planner
      if (data.planner) localStorage.setItem(PLAN_KEY, JSON.stringify(data.planner));
      // Restore meta
      localStorage.setItem(META_KEY, JSON.stringify(data.meta));
      showToast('✓ Backup restored! Reloading…', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch(err) {
      showToast('Restore failed: ' + err.message);
    }
    input.value = ''; // reset file input
  };
  reader.readAsText(file);
}

// ─── SECURITY: HTML ESCAPE ───────────────────────────
// All user-controlled strings must pass through this before
// being interpolated into innerHTML. Prevents persistent XSS.
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── INPUT VALIDATION ────────────────────────────────
// Validates a numeric input, shows error/warn class, clamps to max.
// Returns true if valid, false if below min.
function validateNumberInput(el, min, max) {
  const val = parseFloat(el.value);
  el.classList.remove('input-error', 'input-warn');
  if (isNaN(val) || val < min) {
    el.value = min; // clamp to minimum
    el.classList.add('input-error');
    setTimeout(() => el.classList.remove('input-error'), 1200);
    return false;
  }
  if (max !== undefined && val > max) {
    el.value = max; // clamp to maximum
    el.classList.add('input-warn');
    setTimeout(() => el.classList.remove('input-warn'), 1200);
  }
  return true;
}



// ─── TAB SWITCHING ──────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  // Synced via data-tab so both the desktop tab row AND the mobile
  // dropdown's menu items reflect whichever one was actually clicked.
  document.querySelectorAll('.tab-btn, .menu-item').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.querySelectorAll('[data-tab="' + id + '"]').forEach(el => el.classList.add('active'));
  closeMobileMenu();

  // Leaderboard is an opt-in, separate feature — its code (and the
  // Supabase SDK) only ever gets fetched if someone opens this tab.
  if (id === 'leaderboard') lbBootstrap();
}

// Loads leaderboard.js on first visit to the tab, then hands off to it.
let _lbScriptLoaded = false;
function lbBootstrap() {
  if (_lbScriptLoaded) { if (typeof initLeaderboardTab === 'function') initLeaderboardTab(); return; }
  _lbScriptLoaded = true;
  const s = document.createElement('script');
  s.src = 'leaderboard.js';
  s.onload = () => { if (typeof initLeaderboardTab === 'function') initLeaderboardTab(); };
  s.onerror = () => showToast('Could not load the leaderboard — check your connection');
  document.body.appendChild(s);
}

// ─── MOBILE HAMBURGER MENU ──────────────────────────
// The panel lives at body level (not nested in .nav) so it can't get
// clipped by .nav's implicit overflow-y:auto. Since it's no longer
// positioned relative to .nav-menu-wrap, we anchor it in JS instead.
function positionMobileMenuPanel() {
  const panel = document.getElementById('mobile-menu-panel');
  const hb = document.getElementById('hamburger-btn');
  if (!panel || !hb) return;
  const rect = hb.getBoundingClientRect();
  panel.style.top = (rect.bottom + 10) + 'px';
  panel.style.right = (window.innerWidth - rect.right) + 'px';
}

function openMobileMenu() {
  const panel = document.getElementById('mobile-menu-panel');
  const overlay = document.getElementById('mobile-menu-overlay');
  const hb = document.getElementById('hamburger-btn');
  positionMobileMenuPanel();
  if (panel) panel.classList.add('open');
  if (overlay) overlay.classList.add('open');
  if (hb) { hb.classList.add('active'); hb.setAttribute('aria-expanded', 'true'); }
}

function closeMobileMenu() {
  const panel = document.getElementById('mobile-menu-panel');
  const overlay = document.getElementById('mobile-menu-overlay');
  const hb = document.getElementById('hamburger-btn');
  if (panel) panel.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  if (hb) { hb.classList.remove('active'); hb.setAttribute('aria-expanded', 'false'); }
}

// Toggles open/closed; stopPropagation keeps the click from also
// hitting the overlay (which would immediately close what we just opened).
function toggleMobileMenu(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('mobile-menu-panel');
  if (panel && panel.classList.contains('open')) closeMobileMenu();
  else openMobileMenu();
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeMobileMenu();
});

// If the viewport grows past the mobile breakpoint (resize/rotate) while
// the menu happens to be open, close it so it can't get stuck visible.
// If it's still open and still mobile-width, re-anchor it instead, since
// the hamburger button's on-screen position may have shifted.
window.addEventListener('resize', function () {
  if (window.innerWidth > 768) { closeMobileMenu(); return; }
  const panel = document.getElementById('mobile-menu-panel');
  if (panel && panel.classList.contains('open')) positionMobileMenuPanel();
});


// ─── v5.4: STRESS TEST MODE ─────────────────────────
// Temporarily renders all endsem sliders as 0 without mutating stored data.
// The stressTestActive flag makes calcTotal/renderCourses treat endsemScore as 0.
function toggleStressTest() {
  // Stress test removed in v6.1
}

// ─── v5.5: SEM 1 UI CLEANUP ─────────────────────────
// On Sem 1 there are no previous semesters, so hide:
//   - the entire "Previous Semester Data" section
//   - the CGPA hero card (meaningless with one sem)
// Replace the CGPA card with a "Sem 1" label showing just the
// total marks context instead.
function updateSem1UI() {
  const isSem1 = activeSem === 1;
  const prevSection = document.getElementById('prev-sem-section');
  const cgpaCard    = document.getElementById('hero-cgpa-card');
  const cgpaLbl     = document.getElementById('h-cgpa-lbl');
  const cgpaDiv     = document.getElementById('h-cgpa-div');
  const cgpaVal     = document.getElementById('h-cgpa');

  if (prevSection) prevSection.style.display = isSem1 ? 'none' : '';

  if (cgpaCard) {
    if (isSem1) {
      // Re-purpose the third card to show something useful for Sem 1
      cgpaCard.style.setProperty('--accent-color', 'var(--muted2)');
      if (cgpaLbl) cgpaLbl.textContent = 'CGPA';
      if (cgpaVal) { cgpaVal.textContent = '—'; cgpaVal.style.color = 'var(--muted)'; }
      if (cgpaDiv) {
        cgpaDiv.textContent = 'available from Sem 2';
        cgpaDiv.style.color = 'var(--muted2)';
        cgpaDiv.style.background = 'var(--overlay-md)';
      }
    } else {
      // Restore normal CGPA card styling
      cgpaCard.style.setProperty('--accent-color', 'var(--acc4)');
      if (cgpaLbl) cgpaLbl.textContent = 'CGPA (all sems)';
      // Values will be filled by updateHero() immediately after
    }
  }
}

// ─── GRADE HELPERS ──────────────────────────────────
// Colors are read live from CSS variables so they follow the active
// theme automatically. renderShareCard() temporarily forces whichever
// light/dark mode is selected for the share card, independent of the
// live site's own theme.
const GRADES = [
  { letter: 'O',  pts: 10, min: 90, var: '--gold'  },
  { letter: 'A+', pts: 9,  min: 80, var: '--green' },
  { letter: 'A',  pts: 8,  min: 70, var: '--acc4'  },
  { letter: 'B+', pts: 7,  min: 60, var: '--acc2'  },
  { letter: 'B',  pts: 6,  min: 50, var: '--yellow'},
  { letter: 'C',  pts: 5,  min: 40, var: '--orange'},
  { letter: 'D',  pts: 4,  min: 30, var: '--acc3'  },
  { letter: 'F',  pts: 0,  min: 0,  var: '--red'   },
];

function getGrade(total) {
  for (const g of GRADES) if (total >= g.min) return { letter: g.letter, pts: g.pts, min: g.min, color: cssVar(g.var) };
  const g = GRADES[GRADES.length - 1];
  return { letter: g.letter, pts: g.pts, min: g.min, color: cssVar(g.var) };
}

function divLabel(cgpa) {
  if (cgpa >= 8.0) return { txt: '★ Distinction', color: cssVar('--green') };
  if (cgpa >= 6.0) return { txt: 'First Division', color: cssVar('--acc4') };
  if (cgpa >= 5.0) return { txt: 'Second Division', color: cssVar('--yellow') };
  if (cgpa >= 4.0) return { txt: 'Pass', color: cssVar('--muted') };
  return { txt: 'Fail', color: cssVar('--red') };
}

// ─── CALC HELPERS ───────────────────────────────────
function calcTotal(c, endsemScore) {
  const iMax = c.internalMax || 20;
  let raw, maxRaw;
  if (c.midsemType === 'teacher') {
    const taMax = c.teacherAwardMax || 30;
    raw = c.internal + c.teacherAward + endsemScore;
    maxRaw = iMax + taMax + 70;
  } else if (c.midsemType === 'halved') {
    const halfMax = (c.midsemMax || 30) / 2;
    const ms = (c.midsem / (c.midsemMax || 30)) * halfMax;
    raw = c.internal + ms + endsemScore;
    maxRaw = iMax + halfMax + c.endsemMax;
  } else {
    raw = c.internal + c.midsem + endsemScore;
    maxRaw = iMax + (c.midsemMax || 30) + c.endsemMax;
  }
  return (raw / maxRaw) * 100;
}

function minEndsemFor(c, targetTotal) {
  const iMax = c.internalMax || 20;
  let maxRaw, secured;
  if (c.midsemType === 'teacher') {
    const taMax = c.teacherAwardMax || 30;
    maxRaw = iMax + taMax + 70;
    secured = c.internal + c.teacherAward;
  } else if (c.midsemType === 'halved') {
    const halfMax = (c.midsemMax || 30) / 2;
    maxRaw = iMax + halfMax + c.endsemMax;
    secured = c.internal + (c.midsem / (c.midsemMax || 30)) * halfMax;
  } else {
    maxRaw = iMax + (c.midsemMax || 30) + c.endsemMax;
    secured = c.internal + c.midsem;
  }
  return (targetTotal / 100) * maxRaw - secured;
}

// ─── PREV SEM SANITY CHECK (Fix #8) ─────────────────
function updatePrevSgpaCheck() {
  const cr = parseFloat(document.getElementById('prev-credits').value) || 0;
  const pts = parseFloat(document.getElementById('prev-points').value) || 0;
  const el = document.getElementById('prev-sgpa-check');
  if (cr > 0 && pts > 0) {
    const sgpa = (pts / cr).toFixed(2);
    const d = divLabel(pts / cr);
    el.innerHTML = `<span class="prev-sgpa-display">Prev SGPA = <b style="color:${d.color}">${sgpa}</b> — ${d.txt}</span>`;
  } else {
    el.innerHTML = '';
  }
}

// ─── RENDER COURSES ─────────────────────────────────
function renderCourses() {
  const container = document.getElementById('courses-list');
  const halvedGlobal = document.getElementById('global-halved').checked;

  if (courses.length === 0) {
    container.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon">📚</div>
        <div class="empty-title">No courses added yet</div>
        <div class="empty-sub">Add your subjects or load demo data<br>to start calculating your SGPA.</div>
        <div class="empty-actions">
          <button class="btn" onclick="addCourse()">+ Add Course</button>
          <button class="btn sec" onclick="loadDemo()">Load Demo Data</button>
        </div>
      </div>`;
    updateHero();
    renderThresh();
    return;
  }

  // Preserve which cards are expanded before rebuilding DOM
  const expanded = new Set(
    [...document.querySelectorAll('.course-card.expanded')]
      .map(el => el.id.replace('course-card-', ''))
      .map(Number)
  );

  container.innerHTML = '';
  courses.forEach(c => renderOneCourse(c, container, halvedGlobal));

  // Restore expanded state
  expanded.forEach(id => {
    const card = document.getElementById('course-card-' + id);
    if (card) card.classList.add('expanded');
  });

  updateHero();
  renderThresh();
  updatePrevSgpaCheck();
}

// ─── THRESHOLD TICKS FOR RANGE SLIDER (Fix #6) ──────
function buildTicks(endsemMax, c) {
  const halvedGlobal = document.getElementById('global-halved').checked;
  const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
  const cv = { ...c, midsemType: effectiveMidsemType };

  const targets = [
    { pct: 60, color: cssVar('--acc2'),  label: 'B+' },
    { pct: 70, color: cssVar('--acc4'),  label: 'A'  },
    { pct: 80, color: cssVar('--green'), label: 'A+' },
    { pct: 90, color: cssVar('--gold'),  label: 'O'  },
  ];

  let html = '';
  targets.forEach(t => {
    const needed = minEndsemFor(cv, t.pct);
    if (needed > 0 && needed <= endsemMax) {
      const pos = (needed / endsemMax) * 100;
      html += `<div class="tick" style="left:${pos}%;background:${t.color}"></div>`;
      html += `<div class="tick-label" style="left:${pos}%;color:${t.color}">${t.label}</div>`;
    }
  });
  return html;
}

// ─── RENDER ONE COURSE (Fix #3 — collapsible) ───────
function renderOneCourse(c, container, halvedGlobal) {
  const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
  const cv = { ...c, midsemType: effectiveMidsemType };
  // v5.4: stress test removed in v6.1
  const effectiveEndsem = c.endsemScore;
  const total = calcTotal(cv, effectiveEndsem);
  const grade = getGrade(total);

  let midDisplay, securedDisplay;
  if (effectiveMidsemType === 'teacher') {
    midDisplay = `${c.teacherAward}/${c.teacherAward} (teacher)`;
    securedDisplay = (c.internal + c.teacherAward).toFixed(1);
  } else if (effectiveMidsemType === 'halved') {
    const ms = (c.midsem / c.midsemMax) * 15;
    midDisplay = `${c.midsem}/${c.midsemMax} → ${ms.toFixed(1)}/15`;
    securedDisplay = (c.internal + ms).toFixed(1);
  } else {
    midDisplay = `${c.midsem}/${c.midsemMax}`;
    securedDisplay = (c.internal + c.midsem).toFixed(1);
  }

  const card = document.createElement('div');
  card.className = 'course-card';
  card.id = 'course-card-' + c.id;

  const ticksHtml = buildTicks(c.endsemMax, c);

  card.innerHTML = `
    <!-- Collapsed header — always visible -->
    <div class="cc-header" onclick="toggleExpand(${c.id})">
      <div class="cc-left">
        <div class="cc-name" id="ccname-${c.id}">${escapeHtml(c.name)}</div>
        <div class="cc-meta">${c.credits} cr · ${total.toFixed(1)}/100 · End-sem ${c.endsemScore}/${c.endsemMax}</div>
      </div>
      <div class="cc-right">
        <div class="grade-pill" style="background:${grade.color}22;color:${grade.color};border-color:${grade.color}44" id="gpill-${c.id}">
          ${grade.letter} &middot; ${grade.pts}
        </div>
        <button class="del-btn" onclick="event.stopPropagation();removeCourse(${c.id})" title="Remove course">✕</button>
        <span class="cc-chevron" id="chev-${c.id}">▾</span>
      </div>
    </div>

    <!-- Mini progress bar — always visible -->
    <div class="cc-minibar">
      <div class="cc-minifill" id="minibar-${c.id}" style="width:${Math.min(total,100)}%;background:${grade.color}"></div>
    </div>

    <!-- Expandable body -->
    <div class="cc-body" id="ccbody-${c.id}">
      <!-- Editable name -->
      <div style="margin-bottom:12px;">
        <label class="field-lbl" style="margin-bottom:4px;display:block;" for="cname-input-${c.id}">Course Name</label>
        <input type="text" id="cname-input-${c.id}" value="${escapeHtml(c.name)}"
          onblur="updateCourseName(${c.id}, this.value)"
          onkeydown="if(event.key==='Enter')this.blur()"
          style="width:100%;background:var(--s3);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;font-size:13px;font-weight:600;color:var(--text);">
      </div>

      <!-- Marks row -->
      <div class="marks-row">
        <div class="mark-cell">
          <div class="ml">Credits</div>
          <input type="number" value="${c.credits}" min="1" max="8" style="width:60px;text-align:center;font-size:13px;padding:4px 6px;"
            onchange="validateNumberInput(this,1,8);updateCourseField(${c.id},'credits',+this.value)">
        </div>
        <div class="mark-cell">
          <div class="ml">Internal /${c.internalMax||20}</div>
          <input type="number" value="${c.internal}" min="0" max="${c.internalMax||20}" style="width:60px;text-align:center;font-size:13px;padding:4px 6px;"
            onchange="validateNumberInput(this,0,${c.internalMax||20});updateCourseField(${c.id},\'internal\',+this.value)">
        </div>
        <div class="mark-cell">
          <div class="ml">Mid-sem</div>
          ${effectiveMidsemType === 'teacher'
            ? `<input type="number" value="${c.teacherAward}" min="0" max="30" style="width:60px;text-align:center;font-size:13px;padding:4px 6px;" onchange="validateNumberInput(this,0,30);updateCourseField(${c.id},'teacherAward',+this.value)">`
            : `<input type="number" value="${c.midsem}" min="0" max="${c.midsemMax}" style="width:60px;text-align:center;font-size:13px;padding:4px 6px;" onchange="validateNumberInput(this,0,${c.midsemMax});updateCourseField(${c.id},'midsem',+this.value)">`
          }
        </div>
        <div class="mark-cell">
          <div class="ml">Pre-end total</div>
          <div class="mv" id="secured-${c.id}" style="color:var(--acc2)">${securedDisplay}</div>
        </div>
        <div class="mark-cell">
          <div class="ml">Total /100</div>
          <div class="mv" id="total-${c.id}" style="color:${grade.color}">${total.toFixed(1)}</div>
        </div>
      </div>

      <!-- Toggles -->
      <div class="divider"></div>
      <div class="toggle-row">
        <div>
          <span class="toggle-lbl">Mid-sem not held — teacher awards marks</span>
          <span class="toggle-sub">Teacher directly assigns marks (e.g. gave 20/30, not full 30)</span>
        </div>
        <label class="switch">
          <input type="checkbox" ${c.midsemType === 'teacher' ? 'checked' : ''} onchange="updateCourseField(${c.id},'midsemType',this.checked?'teacher':'auto')">
          <span class="slider-sw"></span>
        </label>
      </div>
      <div class="toggle-row" style="padding-bottom:4px;">
        <div>
          <span class="toggle-lbl">End-sem out of 50 (has practicals)</span>
          <span class="toggle-sub">Uncheck for theory-only courses (out of 70)</span>
        </div>
        <label class="switch">
          <input type="checkbox" ${c.endsemMax === 50 ? 'checked' : ''} onchange="updateCourseField(${c.id},'endsemMax',this.checked?50:70)">
          <span class="slider-sw"></span>
        </label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;padding-top:10px;border-top:1px solid var(--border);">
        <div>
          <div class="field-lbl" style="margin-bottom:4px;">Internal marks max</div>
          <select onchange="updateCourseField(${c.id},\'internalMax\',+this.value)" style="font-size:12px;padding:5px 8px;">
            <option value="20" ${(c.internalMax||20)===20?'selected':''}>/ 20 (default)</option>
            <option value="25" ${(c.internalMax||20)===25?'selected':''}>/ 25</option>
            <option value="30" ${(c.internalMax||20)===30?'selected':''}>/ 30</option>
            <option value="15" ${(c.internalMax||20)===15?'selected':''}>/ 15</option>
          </select>
        </div>
        <div id="teacher-award-max-${c.id}" style="${c.midsemType==='teacher'?'':'opacity:0.3;pointer-events:none;'}">
          <div class="field-lbl" style="margin-bottom:4px;">Marks teacher actually gave</div>
          <select onchange="updateCourseField(${c.id},\'teacherAwardMax\',+this.value)" style="font-size:12px;padding:5px 8px;">
            <option value="30" ${(c.teacherAwardMax||30)===30?'selected':''}>max 30 (gave full)</option>
            <option value="25" ${(c.teacherAwardMax||30)===25?'selected':''}>max 25</option>
            <option value="20" ${(c.teacherAwardMax||30)===20?'selected':''}>max 20</option>
            <option value="15" ${(c.teacherAwardMax||30)===15?'selected':''}>max 15</option>
          </select>
        </div>
      </div>

      <!-- End sem slider with threshold ticks (Fix #6) -->
      <div class="field-row" style="margin-top:8px;">
        <span class="field-lbl">End Sem /${c.endsemMax}</span>
        <div class="range-wrap">
          <input type="range" min="0" max="${c.endsemMax}" value="${c.endsemScore}" step="0.5"
            oninput="updateEndsem(${c.id}, +this.value)">
          <div class="range-ticks" id="ticks-${c.id}">${ticksHtml}</div>
        </div>
        <span class="range-val" id="rv-${c.id}">${c.endsemScore}</span>
      </div>

      <div class="prog-bar">
        <div class="prog-fill" id="pbar-${c.id}" style="width:${Math.min(total,100)}%;background:${grade.color}"></div>
      </div>
    </div>
  `;
  container.appendChild(card);
}

// ─── EXPAND/COLLAPSE ────────────────────────────────
function toggleExpand(id) {
  const card = document.getElementById('course-card-' + id);
  card.classList.toggle('expanded');
}

// ─── UPDATE HELPERS ─────────────────────────────────
function updateEndsem(id, val) {
  const c = courses.find(x => x.id === id);
  if (!c) return;
  c.endsemScore = val;
  document.getElementById('rv-' + id).textContent = val;
  refreshCourseDisplay(c);
  updateHero();
  renderThresh();
  debouncedSave();
}

// ─── SURGICAL CARD REBUILD (no collapse side-effect) ─
function rebuildCourseBody(id) {
  // Re-renders only the body of an existing card — preserves expanded state
  const c = courses.find(x => x.id === id);
  if (!c) return;
  const card = document.getElementById('course-card-' + id);
  if (!card) { renderCourses(); return; }  // fallback if card not in DOM

  const halvedGlobal = document.getElementById('global-halved').checked;
  const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher'
    : (halvedGlobal ? 'halved' : 'full');
  const cv = { ...c, midsemType: effectiveMidsemType };
  const total = calcTotal(cv, c.endsemScore);
  const grade = getGrade(total);

  // Rebuild body by creating a temp card and transplanting its body
  const tempContainer = document.createElement('div');
  renderOneCourse(c, tempContainer, halvedGlobal);
  const newCard = tempContainer.firstChild;

  // Swap only the cc-body
  const oldBody = card.querySelector('.cc-body');
  const newBody = newCard.querySelector('.cc-body');
  if (oldBody && newBody) oldBody.replaceWith(newBody);

  // Also update the endsem slider section if present
  const oldSlider = card.querySelector('.endsem-slider-wrap');
  const newSlider = newCard.querySelector('.endsem-slider-wrap');
  if (oldSlider && newSlider) oldSlider.replaceWith(newSlider);

  // Update header meta line and grade pill
  refreshCourseDisplay(c);
}

function updateCourseField(id, field, val) {
  const c = courses.find(x => x.id === id);
  if (!c) return;
  if (field === 'midsemType') {
    c.midsemType = val;
    rebuildCourseBody(id);   // surgical — card stays expanded
    updateHero();
    renderThresh();
    debouncedSave();
    return;
  }
  if (field === 'endsemMax') {
    c.endsemMax = val;
    if (c.endsemScore > val) c.endsemScore = val;
    rebuildCourseBody(id);   // surgical — card stays expanded
    updateHero();
    renderThresh();
    debouncedSave();
    return;
  }
  if (field === 'internalMax') {
    c.internalMax = val;
    // Clamp internal score to new max
    if (c.internal > val) c.internal = val;
    rebuildCourseBody(id);
    updateHero();
    renderThresh();
    debouncedSave();
    return;
  }
  if (field === 'teacherAwardMax') {
    c.teacherAwardMax = val;
    if (c.teacherAward > val) c.teacherAward = val;
    rebuildCourseBody(id);
    updateHero();
    renderThresh();
    debouncedSave();
    return;
  }
  c[field] = val;
  refreshCourseDisplay(c);
  updateHero();
  renderThresh();
  debouncedSave();
}

function updateCourseName(id, val) {
  const c = courses.find(x => x.id === id);
  if (c) c.name = val.trim();
  renderThresh();
  debouncedSave();
  // Also update header display name
  const nameEl = document.getElementById('ccname-' + id);
  if (nameEl && val.trim()) nameEl.textContent = val.trim();
}

function refreshCourseDisplay(c) {
  const halvedGlobal = document.getElementById('global-halved').checked;
  const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
  const cv = { ...c, midsemType: effectiveMidsemType };
  // stress test removed in v6.1
  const effectiveEndsem = c.endsemScore;
  const total = calcTotal(cv, effectiveEndsem);
  const grade = getGrade(total);

  let securedDisplay;
  if (effectiveMidsemType === 'teacher') {
    securedDisplay = (c.internal + c.teacherAward).toFixed(1);
  } else if (effectiveMidsemType === 'halved') {
    securedDisplay = (c.internal + (c.midsem / c.midsemMax) * 15).toFixed(1);
  } else {
    securedDisplay = (c.internal + c.midsem).toFixed(1);
  }

  const totalEl = document.getElementById('total-' + c.id);
  const secEl   = document.getElementById('secured-' + c.id);
  const pillEl  = document.getElementById('gpill-' + c.id);
  const barEl   = document.getElementById('pbar-' + c.id);
  const miniEl  = document.getElementById('minibar-' + c.id);
  const metaEl  = document.querySelector(`#course-card-${c.id} .cc-meta`);
  const tickEl  = document.getElementById('ticks-' + c.id);

  if (totalEl) { totalEl.textContent = total.toFixed(1); totalEl.style.color = grade.color; }
  if (secEl) secEl.textContent = securedDisplay;
  if (pillEl) {
    pillEl.innerHTML = `${grade.letter} &middot; ${grade.pts}`;
    pillEl.style.background = grade.color + '22';
    pillEl.style.color = grade.color;
    pillEl.style.borderColor = grade.color + '44';
  }
  if (barEl) { barEl.style.width = Math.min(total,100) + '%'; barEl.style.background = grade.color; }
  if (miniEl) { miniEl.style.width = Math.min(total,100) + '%'; miniEl.style.background = grade.color; }
  if (metaEl) metaEl.textContent = `${c.credits} cr · ${total.toFixed(1)}/100 · End-sem ${c.endsemScore}/${c.endsemMax}`;
  if (tickEl) tickEl.innerHTML = buildTicks(c.endsemMax, c);
}

// ─── HERO UPDATE ────────────────────────────────────
function updateHero() {
  const halvedGlobal = document.getElementById('global-halved').checked;
  const prevCr  = parseFloat(document.getElementById('prev-credits').value) || 0;
  const prevPts = parseFloat(document.getElementById('prev-points').value) || 0;

  let totalPts = 0, totalCr = 0;
  courses.forEach(c => {
    const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
    const cv = { ...c, midsemType: effectiveMidsemType };
    // stress test removed in v6.1
    const effectiveEndsem = c.endsemScore;
    const total = calcTotal(cv, effectiveEndsem);
    const grade = getGrade(total);
    totalPts += grade.pts * c.credits;
    totalCr  += c.credits;
  });

  const sgpa = totalCr > 0 ? totalPts / totalCr : null;
  const cgpaCredits = prevCr + totalCr;
  const cgpaPoints  = prevPts + totalPts;
  const cgpa = cgpaCredits > 0 ? cgpaPoints / cgpaCredits : null;

  document.getElementById('h-sgpa').textContent     = sgpa !== null ? sgpa.toFixed(2) : '—';
  document.getElementById('h-pts').textContent      = totalCr > 0 ? totalPts : '—';
  document.getElementById('h-credits').textContent  = `/ ${totalCr} credits`;
  document.getElementById('h-cgpa').textContent     = cgpa !== null ? cgpa.toFixed(2) : '—';

  if (sgpa !== null) {
    const sd = divLabel(sgpa);
    const badge = document.getElementById('h-sgpa-div');
    badge.textContent = sd.txt;
    badge.style.color = sd.color;
    badge.style.background = sd.color + '18';
    document.getElementById('h-sgpa').style.color = sd.color;
  }
  if (cgpa !== null) {
    const cd = divLabel(cgpa);
    const badge = document.getElementById('h-cgpa-div');
    badge.textContent = cd.txt;
    badge.style.color = cd.color;
    badge.style.background = cd.color + '18';
    document.getElementById('h-cgpa').style.color = cd.color;
  }

  updatePrevSgpaCheck();
}

// ─── THRESHOLD TABLE (Fix #5) ───────────────────────
function renderThresh() {
  const halvedGlobal = document.getElementById('global-halved').checked;
  const tbody = document.getElementById('thresh-body');
  tbody.innerHTML = '';
  const targets = [
    { grade: 'B+', min: 60, color: cssVar('--yellow') },
    { grade: 'A',  min: 70, color: cssVar('--acc2')   },
    { grade: 'A+', min: 80, color: cssVar('--green')  },
    { grade: 'O',  min: 90, color: cssVar('--gold')   },
  ];

  courses.forEach(c => {
    const effectiveMidsemType = c.midsemType === 'teacher' ? 'teacher' : (halvedGlobal ? 'halved' : 'full');
    // v5.4: When stress-testing, compute thresholds as if endsem is the only unknown
    const cv = { ...c, midsemType: effectiveMidsemType };
    const tr = document.createElement('tr');
    let cells = `<td style="font-weight:600;font-size:12px;padding-left:14px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.name)}</td><td style="color:var(--muted)">${c.credits}</td>`;

    targets.forEach(t => {
      const needed = minEndsemFor(cv, t.min);
      let display;
      if (needed <= 0) {
        display = `<span class="chip achieved">✓ Achieved</span>`;
      } else if (needed > c.endsemMax) {
        display = `<span class="chip impossible">✕ Impossible</span>`;
      } else {
        const pct = Math.round((needed / c.endsemMax) * 100);
        display = `<span class="chip needed" style="color:${t.color};border-color:${t.color}33;">${Math.ceil(needed)}/${c.endsemMax} <span style="color:var(--muted);font-size:9px">${pct}%</span></span>`;
      }
      cells += `<td>${display}</td>`;
    });

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  if (courses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px;font-family:'IBM Plex Mono',monospace;font-size:11px;">Add courses above to see grade thresholds</td></tr>`;
  }
}

// ─── COURSE MANAGEMENT ──────────────────────────────
function addCourse(preset) {
  const c = preset || {
    id: ++courseIdCounter,
    name: 'Course ' + courseIdCounter,
    credits: 4,
    internal: 0,
    internalMax: 20,
    midsem: 0,
    midsemMax: 30,
    midsemType: 'auto',
    teacherAward: 30,
    teacherAwardMax: 30,
    endsemMax: 70,
    endsemScore: 0,
  };
  if (!preset) c.id = ++courseIdCounter;
  courses.push(c);
  renderCourses();
  debouncedSave();
  // Auto-expand the newly added course
  setTimeout(() => {
    const newCard = document.getElementById('course-card-' + c.id);
    if (newCard) newCard.classList.add('expanded');
  }, 0);
}

function removeCourse(id) {
  courses = courses.filter(c => c.id !== id);
  renderCourses();
  debouncedSave();
}

function clearCourses() {
  if (courses.length === 0) return;
  courses = [];
  renderCourses();
  debouncedSave();
}

function recalcAll() {
  renderCourses();
  debouncedSave();
}

// Fix #4: renamed loadYashSem2 → loadDemo, clarified it's sample data
function loadDemo() {
  courses = [];
  courseIdCounter = 0;
  // Demo uses Sem 2 CSE course names — marks are illustrative, not any real person's data
  const data = [
    { name: 'Computer Architecture',      credits: 4, internal: 15, internalMax: 20, midsem: 20,   midsemMax: 30, midsemType: 'auto',    teacherAward: 25, teacherAwardMax: 30, endsemMax: 70, endsemScore: 48 },
    { name: 'Discrete Mathematics',        credits: 4, internal: 16, internalMax: 20, midsem: 22,   midsemMax: 30, midsemType: 'auto',    teacherAward: 25, teacherAwardMax: 30, endsemMax: 70, endsemScore: 52 },
    { name: 'Fundamentals of Electronics', credits: 4, internal: 14, internalMax: 20, midsem: 18,   midsemMax: 30, midsemType: 'auto',    teacherAward: 25, teacherAwardMax: 30, endsemMax: 50, endsemScore: 35 },
    { name: 'Optimisation Techniques',     credits: 3, internal: 17, internalMax: 20, midsem: 0,    midsemMax: 30, midsemType: 'teacher', teacherAward: 25, teacherAwardMax: 30, endsemMax: 70, endsemScore: 50 },
    { name: 'Communicative English',        credits: 2, internal: 18, internalMax: 20, midsem: 0,    midsemMax: 30, midsemType: 'teacher', teacherAward: 25, teacherAwardMax: 30, endsemMax: 70, endsemScore: 55 },
  ];
  data.forEach(d => { d.id = ++courseIdCounter; courses.push(d); });
  document.getElementById('prev-credits').value = '';
  document.getElementById('prev-points').value  = '';
  renderCourses();
}

// ─── CGPA PLANNER ───────────────────────────────────
function addPastSem(preset) {
  const id = ++pastSemIdCounter;
  const s = preset || { id, sem: id, credits: 22, points: 0 };
  s.id = id;
  pastSems.push(s);
  renderPastSems();
  calcPlan();
  debouncedSave();
}

function removePastSem(id) {
  pastSems = pastSems.filter(s => s.id !== id);
  renderPastSems();
  calcPlan();
  debouncedSave();
}

function renderPastSems() {
  const list = document.getElementById('past-sems-list');
  list.innerHTML = '';
  pastSems.forEach(s => {
    const row = document.createElement('div');
    row.className = 'prev-sem-row';
    const sgpaVal = s.credits > 0 ? (s.points / s.credits) : 0;
    const d = divLabel(sgpaVal);
    row.innerHTML = `
      <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--muted)">Sem ${s.sem}</div>
      <input type="number" value="${s.credits}" min="1" placeholder="Credits" style="font-size:12px;padding:6px 8px;" onchange="updatePastSem(${s.id},'credits',+this.value)">
      <input type="number" value="${s.points}" min="0" placeholder="Cr.Pts" style="font-size:12px;padding:6px 8px;" onchange="updatePastSem(${s.id},'points',+this.value)">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:${d.color};text-align:center;padding:6px 0;" id="plan-sgpa-${s.id}">
        ${s.credits > 0 ? (s.points / s.credits).toFixed(2) : '—'}
      </div>
      <button class="del-btn" onclick="removePastSem(${s.id})">✕</button>
    `;
    list.appendChild(row);
  });
}

function updatePastSem(id, field, val) {
  const s = pastSems.find(x => x.id === id);
  if (!s) return;
  s[field] = val;
  debouncedSave();
  if (field === 'credits' || field === 'points') {
    const el = document.getElementById('plan-sgpa-' + id);
    if (el) {
      const sgpaVal = s.credits > 0 ? s.points / s.credits : 0;
      const d = divLabel(sgpaVal);
      el.textContent = s.credits > 0 ? (s.points / s.credits).toFixed(2) : '—';
      el.style.color = d.color;
    }
  }
  calcPlan();
}

function calcPlan() {
  const curCredits = parseFloat(document.getElementById('cur-credits-plan').value) || 0;
  const target     = parseFloat(document.getElementById('target-cgpa').value) || 0;
  let prevCr = 0, prevPts = 0;
  pastSems.forEach(s => { prevCr += s.credits; prevPts += s.points; });

  const totalCr = prevCr + curCredits;
  const neededTotalPts = target * totalCr;
  const neededCurPts   = neededTotalPts - prevPts;
  const neededSGPA = curCredits > 0 ? neededCurPts / curCredits : null;
  const res = document.getElementById('plan-result');

  if (curCredits === 0) {
    res.innerHTML = `<div style="color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:12px;">Set current semester credits to see the result.</div>`;
    return;
  }

  const currentCGPA = prevCr > 0 ? prevPts / prevCr : null;
  let html = '';

  if (currentCGPA !== null) {
    const cd = divLabel(currentCGPA);
    html += `<div class="info-box" style="margin-bottom:12px;">
      Current CGPA: <b style="color:${cd.color}">${currentCGPA.toFixed(2)}</b> — ${cd.txt}<br>
      Prev credits: <b>${prevCr}</b> · Prev credit points: <b>${prevPts}</b>
    </div>`;
  }

  if (neededSGPA === null || isNaN(neededSGPA)) {
    html += `<div style="color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:12px;">Enter valid data to continue.</div>`;
  } else if (neededSGPA > 10) {
    const maxCGPA = (prevPts + 10 * curCredits) / totalCr;
    const md = divLabel(maxCGPA);
    html += `<div class="warn-box">
      ⚠ A CGPA of <b>${target.toFixed(2)}</b> is not achievable — even with a perfect 10.00 SGPA this semester.<br><br>
      Maximum achievable CGPA: <b style="color:${md.color}">${maxCGPA.toFixed(2)}</b> — ${md.txt}
    </div>`;
  } else if (neededSGPA <= 0) {
    const sd = divLabel(target);
    html += `<div class="success-box">
      ✅ Target CGPA of <b>${target.toFixed(2)}</b> (${sd.txt}) is already guaranteed — you'll exceed it even with a 0 SGPA this semester.<br>Consider aiming higher!
    </div>`;
  } else {
    const sd = divLabel(neededSGPA);
    const td = divLabel(target);
    const gradeNeeded = GRADES.find(g => g.pts >= Math.ceil(neededSGPA));
    html += `<div class="info-box" style="border-color:rgba(232,255,71,0.2);background:rgba(232,255,71,0.05);">
      To reach CGPA <b style="color:${td.color}">${target.toFixed(2)}</b> (${td.txt}):<br><br>
      Required SGPA this semester: <b style="color:${sd.color};font-size:22px;letter-spacing:-1px;">${neededSGPA.toFixed(3)}</b><br>
      Required credit points: <b>${neededCurPts.toFixed(1)}</b> of ${curCredits * 10} max<br><br>
      ${gradeNeeded ? `Average roughly <b style="color:${gradeNeeded.color}">${gradeNeeded.letter}</b> (${gradeNeeded.pts} pts) or better in every course.` : ''}
    </div>`;

    html += `<div class="sec-head" style="margin-top:16px;">CGPA projection by SGPA</div>`;
    html += `<table class="thresh-table"><thead><tr>
      <th>Your SGPA</th><th>Cr. Points</th><th>Final CGPA</th><th>Division</th>
    </tr></thead><tbody>`;
    [6,7,8,9,10].forEach(sgpaTest => {
      const pts     = sgpaTest * curCredits;
      const cgpaTest = (prevPts + pts) / totalCr;
      const d = divLabel(cgpaTest);
      const isTarget = Math.round(neededSGPA) === sgpaTest;
      html += `<tr style="${isTarget ? 'background:rgba(232,255,71,0.06);' : ''}">
        <td style="color:var(--acc2)">${sgpaTest}.00${isTarget ? ' ←' : ''}</td>
        <td>${pts}</td>
        <td style="color:${d.color};font-weight:700">${cgpaTest.toFixed(2)}</td>
        <td style="color:${d.color}">${d.txt}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  res.innerHTML = html;
  debouncedSave();
}

// ─── SEMESTER COURSE MAP (NEP 2020 CSE, Doon Univ) ─
const SEM_COURSES = {
  1: [
    { name: 'Problem Solving & Programming in C', credits: 4, endsemMax: 70 },
    { name: 'Digital System Design',               credits: 4, endsemMax: 70 },
    { name: 'Fundamentals of Computer Science',    credits: 4, endsemMax: 70 },
    { name: 'AECC (from pool)',                    credits: 2, endsemMax: 70 },
    { name: 'VAC (from pool)',                     credits: 2, endsemMax: 70 },
    { name: 'Generic Elective 1 (e.g. Applied Calculus)', credits: 3, endsemMax: 70 },
    { name: 'Generic Elective 2 (e.g. Mechanics I)',      credits: 3, endsemMax: 70 },
  ],
  2: [
    { name: 'Computer Architecture',               credits: 4, endsemMax: 70 },
    { name: 'Discrete Mathematics',                credits: 4, endsemMax: 70 },
    { name: 'Fundamentals of Electronics',         credits: 4, endsemMax: 50 },
    { name: 'AECC (from pool)',                    credits: 2, endsemMax: 70 },
    { name: 'VAC (from pool)',                     credits: 2, endsemMax: 70 },
    { name: 'Generic Elective (e.g. Opt. Prob. & Stats)', credits: 3, endsemMax: 70 },
  ],
  3: [
    { name: 'Data Structures',                     credits: 4, endsemMax: 70 },
    { name: 'OOP using C++',                       credits: 4, endsemMax: 70 },
    { name: 'Theory of Computation',               credits: 4, endsemMax: 70 },
    { name: 'AECC (from pool)',                    credits: 2, endsemMax: 70 },
    { name: 'VAC (from pool)',                     credits: 2, endsemMax: 70 },
    { name: 'Python Programming with Project',     credits: 2, endsemMax: 50 },
    { name: 'Elective',                            credits: 4, endsemMax: 70 },
  ],
  4: [
    { name: 'Database Management System',          credits: 4, endsemMax: 70 },
    { name: 'Numerical & Statistical Computing',   credits: 4, endsemMax: 70 },
    { name: 'Design & Analysis of Algorithms',     credits: 4, endsemMax: 70 },
    { name: 'AECC (from pool)',                    credits: 2, endsemMax: 70 },
    { name: 'VAC (from pool)',                     credits: 2, endsemMax: 70 },
    { name: 'Server-side Web Technologies',        credits: 2, endsemMax: 50 },
    { name: 'Elective',                            credits: 4, endsemMax: 70 },
  ],
  5: [
    { name: 'Operating Systems',                   credits: 4, endsemMax: 70 },
    { name: 'Compiler Design',                     credits: 4, endsemMax: 70 },
    { name: 'Computer Networks',                   credits: 4, endsemMax: 70 },
    { name: 'DSE Elective 1',                      credits: 4, endsemMax: 70 },
    { name: 'GE / DSE Elective 2',                 credits: 4, endsemMax: 70 },
    { name: 'Project-1 with Internship',           credits: 2, endsemMax: 50 },
  ],
  6: [
    { name: 'Software Engineering',                credits: 4, endsemMax: 70 },
    { name: 'System Software',                     credits: 4, endsemMax: 70 },
    { name: 'Programming in Java',                 credits: 4, endsemMax: 70 },
    { name: 'DSE Elective 1',                      credits: 4, endsemMax: 70 },
    { name: 'GE / DSE Elective 2',                 credits: 4, endsemMax: 70 },
    { name: 'Project-2 with Internship',           credits: 2, endsemMax: 50 },
  ],
  7: [
    { name: 'Computer Graphics',                   credits: 4, endsemMax: 70 },
    { name: 'DSE/GE Elective 1',                   credits: 4, endsemMax: 70 },
    { name: 'DSE/GE Elective 2',                   credits: 4, endsemMax: 70 },
    { name: 'DSE/GE Elective 3',                   credits: 4, endsemMax: 70 },
    { name: 'UG Dissertation Part 1',              credits: 6, endsemMax: 70 },
  ],
  8: [
    { name: 'Artificial Intelligence',             credits: 4, endsemMax: 70 },
    { name: 'DSE/GE Elective 1',                   credits: 4, endsemMax: 70 },
    { name: 'DSE/GE Elective 2',                   credits: 4, endsemMax: 70 },
    { name: 'DSE/GE Elective 3',                   credits: 4, endsemMax: 70 },
    { name: 'UG Dissertation Part 2',              credits: 6, endsemMax: 70 },
  ],
};

// ─── QUICK SETUP — load courses from semester map ───
function quickSetup(sem) {
  const semNum = parseInt(sem);
  if (!SEM_COURSES[semNum]) return;
  // Hide onboarding, show calculator
  const ob = document.getElementById('onboarding');
  if (ob) ob.style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  activeSem = semNum;
  crossSemOverride = false;
  // Init this sem slot from course map
  courses = [];
  courseIdCounter = 0;
  SEM_COURSES[semNum].forEach(sc => {
    courses.push({
      id: ++courseIdCounter,
      name: sc.name,
      credits: sc.credits,
      internal: 0, internalMax: 20,
      midsem: 0, midsemMax: 30, midsemType: 'auto',
      teacherAward: 0, teacherAwardMax: 30,
      endsemMax: sc.endsemMax, endsemScore: 0,
    });
  });
  renderCourses();
  renderSemSwitcher();
  updateSem1UI(); // v5.5: hide/show prev section based on sem
  debouncedSave();
  // v5.4: Auto-fill from prior saved sems
  autoFillPrevFromSavedSems(semNum);
  showToast('✓ Sem ' + semNum + ' loaded — enter your marks!', 'success');
}

function skipOnboarding() {
  const ob = document.getElementById('onboarding');
  if (ob) ob.style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  if (!activeSem) activeSem = 1;
  courses = [];
  courseIdCounter = 0;
  renderCourses();
  renderSemSwitcher();
  updateSem1UI(); // v5.5
}

// ─── INIT ───────────────────────────────────────────
(function init() {
  initTheme();
  let restored = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      if (state.savedAt && (Date.now() - state.savedAt) < 90 * 24 * 3600 * 1000) {
        restoreState(state);
        restored = true;
      }
    }
  } catch(e) { /* ignore corrupt storage */ }

  // ── Multi-sem restore ──
  const meta = getMetaState();
  const semsUsed = meta.semsUsed || [];

  // Legacy migration: if old single-key data exists, migrate it
  try {
    const legacyRaw = localStorage.getItem('doon_calc_v3');
    if (legacyRaw && semsUsed.length === 0) {
      const legacy = JSON.parse(legacyRaw);
      if (legacy.courses && legacy.courses.length > 0) {
        // Migrate to sem slot 1 (best guess)
        activeSem = 1;
        courses = legacy.courses;
        courseIdCounter = legacy.courseIdCounter || courses.length;
        localStorage.setItem(SEM_KEY(1), JSON.stringify({ courses, courseIdCounter, globalHalved: legacy.globalHalved, savedAt: Date.now(), semNum: 1 }));
        const newMeta = { activeSem: 1, semsUsed: [1] };
        localStorage.setItem(META_KEY, JSON.stringify(newMeta));
        pastSems = legacy.pastSems || [];
        pastSemIdCounter = legacy.pastSemIdCounter || 0;
        document.getElementById('prev-credits').value = legacy.prevCredits ?? '';
        document.getElementById('prev-points').value  = legacy.prevPoints  ?? '';
        document.getElementById('cur-credits-plan').value = legacy.curCreditsPlan ?? 22;
        document.getElementById('target-cgpa').value = legacy.targetCgpa ?? '8.00';
        localStorage.removeItem('doon_calc_v3'); // clean up legacy key
        restored = true;
      }
    }
  } catch(e) {}

  if (!restored && semsUsed.length > 0) {
    // New multi-sem storage found
    const semToLoad = meta.activeSem || semsUsed[0];
    activeSem = semToLoad;
    loadSemSlot(semToLoad);
    loadPlannerSlot();
    restored = true;
  }

  if (restored) {
    const ob = document.getElementById('onboarding');
    if (ob) ob.style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    renderCourses();
    renderPastSems();
    renderSemSwitcher();
    updateSem1UI(); // v5.5: hide prev section on Sem 1 restore
    calcPlan();
    // v5.4: Auto-fill prev sems from saved slots (only if not already manually set)
    if (activeSem && activeSem > 1) {
      autoFillPrevFromSavedSems(activeSem);
    }
    setTimeout(() => {
      const ind = document.getElementById('save-indicator');
      const lbl = document.getElementById('save-label');
      ind.classList.add('saved');
      lbl.textContent = 'data restored ✓';
      setTimeout(() => { ind.classList.remove('saved'); lbl.textContent = 'auto-saved'; }, 3000);
    }, 300);
  } else {
    // First visit
    document.getElementById('onboarding').style.display = 'block';
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('cur-credits-plan').value = 22;
    document.getElementById('target-cgpa').value = '8.00';
    calcPlan();
  }
})();
