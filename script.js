// ═══════════════════════════════════════════════════════════════════
// DOON GRADE CALCULATOR — script.js ("Still Liquid" redesign)
// ------------------------------------------------------------
// Rewritten front-end logic. Every localStorage key, the course
// object shape, and every formula function (calcTotal, getGrade,
// divLabel, minEndsemFor) are unchanged from the original app, so
// data saved by the old UI loads correctly here, and anything this
// version saves would load correctly in the old UI too.
//
// leaderboard.js is NOT touched by this redesign — it still expects
// exactly what it always did: an element with id="tab-leaderboard",
// and a lbBootstrap() call the first time that tab opens. Both are
// preserved below, unchanged in behaviour.
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ─── STATE ───────────────────────────────────────────────────────
let courses = [];
let courseIdCounter = 0;
let pastSems = [];
let pastSemIdCounter = 0;
let activeSem = null;
let crossSemOverride = false;
let _saveTimer = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── THEME ───────────────────────────────────────────────────────
const THEME_KEY = 'doon_calc_theme';
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function applyTheme(theme){
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}
function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem(THEME_KEY); } catch(e){}
  // Dark is this redesign's default look (matches the liquid concept) —
  // saved preference always wins if present.
  applyTheme(saved === 'light' ? 'light' : 'dark');
}
function toggleTheme(){
  const goingLight = document.documentElement.getAttribute('data-theme') !== 'light';
  applyTheme(goingLight ? 'light' : 'dark');
  try{ localStorage.setItem(THEME_KEY, goingLight ? 'light' : 'dark'); } catch(e){}
  refreshThemedUI();
}
function refreshThemedUI(){
  if (typeof renderCourses === 'function') renderCourses();
  if (typeof renderPastSems === 'function') renderPastSems();
  if (typeof calcPlan === 'function') calcPlan();
  if (typeof renderSemSwitcher === 'function') renderSemSwitcher();
  if (typeof refreshCgpaReadouts === 'function') refreshCgpaReadouts();
}

// ─── LOCALSTORAGE PERSISTENCE (unchanged keys/shape from original) ─
const SEM_KEY  = n => 'doon_calc_sem_' + n;
const PLAN_KEY = 'doon_calc_planner';
const META_KEY = 'doon_calc_meta';

function saveState(){
  try{
    if (activeSem){
      const semState = {
        courses, courseIdCounter,
        globalHalved: document.getElementById('global-halved').checked,
        savedAt: Date.now(), semNum: activeSem,
      };
      localStorage.setItem(SEM_KEY(activeSem), JSON.stringify(semState));
    }
    const planState = {
      pastSems, pastSemIdCounter,
      prevCredits: document.getElementById('prev-credits').value,
      prevPoints:  document.getElementById('prev-points').value,
      curCreditsPlan: document.getElementById('cur-credits-plan').value,
      targetCgpa: document.getElementById('target-cgpa').value,
    };
    localStorage.setItem(PLAN_KEY, JSON.stringify(planState));
    const meta = getMetaState();
    if (activeSem && !meta.semsUsed.includes(activeSem)){
      meta.semsUsed.push(activeSem);
      meta.semsUsed.sort((a, b) => a - b);
    }
    meta.activeSem = activeSem;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    flashSaveIndicator();
  } catch(e){ /* storage quota or private mode — silently ignore, same as original */ }
}
function flashSaveIndicator(label){
  const ind = document.getElementById('save-indicator');
  const lbl = document.getElementById('save-label');
  if (!ind || !lbl) return;
  ind.classList.add('saved');
  const d = new Date();
  lbl.textContent = label || ('saved ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }));
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { ind.classList.remove('saved'); lbl.textContent = 'auto-saved'; }, 2500);
}
function getMetaState(){
  try{ const raw = localStorage.getItem(META_KEY); if (raw) return JSON.parse(raw); } catch(e){}
  return { activeSem: null, semsUsed: [] };
}
function debouncedSave(){
  clearTimeout(window._debounceSaveTimer);
  window._debounceSaveTimer = setTimeout(saveState, 600);
}

// ─── CROSS-SEM CGPA AUTO-FILL ───────────────────────────────────
function autoFillPrevFromSavedSems(currentSem){
  if (crossSemOverride) return;
  const meta = getMetaState();
  const semsUsed = (meta.semsUsed || []).filter(s => s < currentSem).sort((a, b) => a - b);
  const banner = document.getElementById('crosssem-banner');

  if (semsUsed.length === 0){
    document.getElementById('prev-credits').value = '';
    document.getElementById('prev-points').value = '';
    if (banner) banner.style.display = 'none';
    updateHero();
    return;
  }

  let totalCr = 0, totalPts = 0;
  const contrib = [];
  semsUsed.forEach(semN => {
    try{
      const raw = localStorage.getItem(SEM_KEY(semN));
      if (!raw) return;
      const state = JSON.parse(raw);
      const semCourses = state.courses || [];
      const halved = state.globalHalved ?? true;
      let semCr = 0, semPts = 0;
      semCourses.forEach(c => {
        const effectiveType = c.midsemType === 'teacher' ? 'teacher' : (halved ? 'halved' : 'full');
        const cv = { ...c, midsemType: effectiveType };
        const total = calcTotal(cv, c.endsemScore);
        const grade = getGrade(total);
        semPts += grade.pts * c.credits;
        semCr += c.credits;
      });
      totalCr += semCr;
      totalPts += semPts;
      if (semCr > 0) contrib.push('Sem ' + semN + ' (' + (semPts / semCr).toFixed(2) + ')');
    } catch(e){}
  });

  if (totalCr === 0){ if (banner) banner.style.display = 'none'; return; }

  document.getElementById('prev-credits').value = totalCr;
  document.getElementById('prev-points').value = totalPts;

  if (banner){
    const cgpa = totalPts / totalCr;
    const d = divLabel(cgpa);
    document.getElementById('cs-text').innerHTML = 'Auto-filled from ' + contrib.join(', ') + ' &rarr; CGPA so far: <b style="color:' + d.color + '">' + cgpa.toFixed(2) + '</b>';
    document.getElementById('cs-sub').textContent = 'You can edit the fields below to override (e.g. if a course grade changed).';
    banner.style.display = 'flex';
  }
  updateHero();
  updatePrevSgpaCheck();
}

function loadSemSlot(semNum){
  try{
    const raw = localStorage.getItem(SEM_KEY(semNum));
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (state.savedAt && (Date.now() - state.savedAt) > 365 * 24 * 3600 * 1000) return false;
    courses = state.courses || [];
    courseIdCounter = state.courseIdCounter || courses.length;
    document.getElementById('global-halved').checked = state.globalHalved ?? true;
    return true;
  } catch(e){ return false; }
}
function loadPlannerSlot(){
  try{
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    pastSems = state.pastSems || [];
    pastSemIdCounter = state.pastSemIdCounter || pastSems.length;
    document.getElementById('prev-credits').value     = state.prevCredits ?? '';
    document.getElementById('prev-points').value      = state.prevPoints ?? '';
    document.getElementById('cur-credits-plan').value = state.curCreditsPlan ?? 22;
    document.getElementById('target-cgpa').value      = state.targetCgpa ?? '8.00';
  } catch(e){}
}

function switchToSem(semNum){
  if (activeSem) saveState();
  activeSem = semNum;
  crossSemOverride = false;

  const ok = loadSemSlot(semNum);
  if (!ok){
    courses = [];
    courseIdCounter = 0;
    if (SEM_COURSES[semNum]){
      SEM_COURSES[semNum].forEach(sc => {
        courses.push({
          id: ++courseIdCounter, name: sc.name, credits: sc.credits,
          internal: 0, internalMax: 20,
          midsem: 0, midsemMax: 30, midsemType: 'auto',
          teacherAward: 0, teacherAwardMax: 30,
          endsemMax: sc.endsemMax, endsemScore: 0,
        });
      });
    }
  }

  document.getElementById('onboarding-gate').style.display = 'none';
  document.getElementById('calc-guard').hidden = true;
  document.getElementById('calc-content').hidden = false;

  renderCourses();
  renderSemSwitcher();
  updateSem1UI();
  autoFillPrevFromSavedSems(semNum);
  updateSemPickerChrome();
  debouncedSave();
  showToast((ok ? 'Sem ' + semNum + ' loaded' : 'Sem ' + semNum + ' started'), 'success');
}

// ─── SEM SWITCHER BAR ────────────────────────────────────────────
function isCalcTabActive(){
  const panel = document.getElementById('tab-calculator');
  return !!(panel && panel.classList.contains('active'));
}
function renderSemSwitcher(){
  const bar = document.getElementById('sem-switcher-bar');
  if (!bar) return;
  if (!activeSem || !isCalcTabActive()){ bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  const meta = getMetaState();
  const used = meta.semsUsed || [];
  const allUsed = used.includes(activeSem) ? used : [...used, activeSem].sort((a, b) => a - b);

  const semSgpaMap = {};
  let runningCr = 0, runningPts = 0;
  allUsed.forEach(s => {
    try{
      const raw = localStorage.getItem(SEM_KEY(s));
      if (!raw) return;
      const state = JSON.parse(raw);
      const semCourses = state.courses || [];
      const halved = state.globalHalved ?? true;
      let semCr = 0, semPts = 0;
      semCourses.forEach(c => {
        const effectiveType = c.midsemType === 'teacher' ? 'teacher' : (halved ? 'halved' : 'full');
        const cv = { ...c, midsemType: effectiveType };
        const total = calcTotal(cv, c.endsemScore);
        const grade = getGrade(total);
        semPts += grade.pts * c.credits;
        semCr += c.credits;
      });
      if (semCr > 0){ semSgpaMap[s] = semPts / semCr; runningCr += semCr; runningPts += semPts; }
    } catch(e){}
  });

  let html = '<span class="sem-switcher-label">Semester</span>';
  for (let s = 1; s <= 8; s++){
    const isActive = s === activeSem;
    const isUsed = allUsed.includes(s);
    const cls = 'sem-pill-sw' + (isActive ? ' active' : '') + (!isActive && isUsed ? ' used' : '') + (!isActive && !isUsed ? ' ghost' : '');
    const title = 'Semester ' + s + (isUsed ? (' · SGPA ' + (semSgpaMap[s] || 0).toFixed(2)) : ' · start fresh');
    html += '<button class="' + cls + '" onclick="switchToSem(' + s + ')" title="' + title + '">' + s + '</button>';
  }
  if (runningCr > 0){
    const cgpa = runningPts / runningCr;
    const d = divLabel(cgpa);
    html += '<span class="sem-cgpa-chip">CGPA <b style="color:' + d.color + '">' + cgpa.toFixed(2) + '</b></span>';
  }
  bar.innerHTML = html;
}

// ─── TOAST ───────────────────────────────────────────────────────
function showToast(msg, type){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── GRADE HELPERS ───────────────────────────────────────────────
const GRADES = [
  { letter:'O',  pts:10, min:90, cvar:'--emerald' },
  { letter:'A+', pts:9,  min:80, cvar:'--mint'    },
  { letter:'A',  pts:8,  min:70, cvar:'--aqua'    },
  { letter:'B+', pts:7,  min:60, cvar:'--sky'     },
  { letter:'B',  pts:6,  min:50, cvar:'--deepblue'},
  { letter:'C',  pts:5,  min:40, cvar:'--amber'   },
  { letter:'D',  pts:4,  min:30, cvar:'--coral'   },
  { letter:'F',  pts:0,  min:0,  cvar:'--red'     },
];
function getGrade(total){
  for (const g of GRADES) if (total >= g.min) return { letter:g.letter, pts:g.pts, min:g.min, color:cssVar(g.cvar) };
  const g = GRADES[GRADES.length - 1];
  return { letter:g.letter, pts:g.pts, min:g.min, color:cssVar(g.cvar) };
}
function divLabel(cgpa){
  if (cgpa >= 8.0) return { txt:'\u2605 Distinction', color:cssVar('--emerald') };
  if (cgpa >= 6.0) return { txt:'First Division', color:cssVar('--aqua') };
  if (cgpa >= 5.0) return { txt:'Second Division', color:cssVar('--amber') };
  if (cgpa >= 4.0) return { txt:'Pass', color:cssVar('--text-dim') };
  return { txt:'Fail', color:cssVar('--red') };
}

// ─── CALC HELPERS (identical to original — all 3 midsem modes) ──
function calcTotal(c, endsemScore){
  const iMax = c.internalMax || 20;
  let raw, maxRaw;
  if (c.midsemType === 'teacher'){
    const taMax = c.teacherAwardMax || 30;
    raw = c.internal + c.teacherAward + endsemScore;
    maxRaw = iMax + taMax + 70;
  } else if (c.midsemType === 'halved'){
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
function minEndsemFor(c, targetTotal){
  const iMax = c.internalMax || 20;
  let maxRaw, secured;
  if (c.midsemType === 'teacher'){
    const taMax = c.teacherAwardMax || 30;
    maxRaw = iMax + taMax + 70;
    secured = c.internal + c.teacherAward;
  } else if (c.midsemType === 'halved'){
    const halfMax = (c.midsemMax || 30) / 2;
    maxRaw = iMax + halfMax + c.endsemMax;
    secured = c.internal + (c.midsem / (c.midsemMax || 30)) * halfMax;
  } else {
    maxRaw = iMax + (c.midsemMax || 30) + c.endsemMax;
    secured = c.internal + c.midsem;
  }
  return (targetTotal / 100) * maxRaw - secured;
}

// ─── SLIDER TICK MARKS — where each grade threshold sits on the
// end-sem range slider, positioned as a % of the track (min→max). ──
const TICK_TARGETS = [
  { grade:'B+', min:60, cvar:'--sky'     },
  { grade:'A',  min:70, cvar:'--aqua'    },
  { grade:'A+', min:80, cvar:'--mint'    },
  { grade:'O',  min:90, cvar:'--emerald' },
];
function buildTicks(c){
  const cv = { ...c, midsemType: effectiveType(c) };
  let html = '';
  TICK_TARGETS.forEach(t => {
    const needed = minEndsemFor(cv, t.min);
    if (needed < 0 || needed > c.endsemMax) return; // off the visible track — skip rather than clamp/crowd the edge
    const pct = (needed / c.endsemMax) * 100;
    const color = cssVar(t.cvar);
    html += '<div class="tick-liquid" style="left:' + pct + '%;background:' + color + '"></div>';
    html += '<div class="tick-label-liquid" style="left:' + pct + '%;color:' + color + '">' + t.grade + '</div>';
  });
  return html;
}

function escapeHtml(str){
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function validateNumberInput(el, min, max){
  const val = parseFloat(el.value);
  let flash = null;
  if (isNaN(val) || val < min){ el.value = min; flash = 'input-error'; }
  else if (max !== undefined && val > max){ el.value = max; flash = 'input-warn'; }
  if (flash){
    el.classList.remove('input-error', 'input-warn');
    void el.offsetWidth; // restart the animation if it's already flashing
    el.classList.add(flash);
    setTimeout(() => el.classList.remove(flash), 1200);
  }
  return !(isNaN(val) || val < min);
}

// ─── TABS ─────────────────────────────────────────────────────────
const TAB_IDS = ['overview', 'calculator', 'planner', 'reference', 'leaderboard'];
function positionTabIndicator(){
  const ind = document.getElementById('tab-indicator');
  const activeBtn = document.querySelector('.tab-btn.active');
  if (!ind || !activeBtn) return;
  ind.style.left = activeBtn.offsetLeft + 'px';
  ind.style.width = activeBtn.offsetWidth + 'px';
}
function activateTab(name){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.menu-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  TAB_IDS.forEach(id => {
    const panel = document.getElementById('tab-' + id);
    if (panel) panel.classList.toggle('active', id === name);
  });
  positionTabIndicator();
  renderSemSwitcher();
  closeMobileMenu();
  if (name === 'leaderboard') lbBootstrap();
  window.scrollTo({ top:0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

// ─── MOBILE NAV (hamburger + slide-in drawer) ───────────────────
// Below the tabbar's breakpoint (styles.css), the horizontal tab row
// is hidden and this drawer is how every tab gets reached — most
// people using this app are on a phone, so it has to be one tap away.
function openMobileMenu(){
  document.getElementById('mobile-menu-overlay').classList.add('open');
  document.getElementById('mobile-menu-panel').classList.add('open');
  document.getElementById('hamburger-btn').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu(){
  const overlay = document.getElementById('mobile-menu-overlay');
  const panel = document.getElementById('mobile-menu-panel');
  const btn = document.getElementById('hamburger-btn');
  if (overlay) overlay.classList.remove('open');
  if (panel) panel.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
function toggleMobileMenu(e){
  if (e) e.stopPropagation();
  const isOpen = document.getElementById('mobile-menu-panel').classList.contains('open');
  if (isOpen) closeMobileMenu(); else openMobileMenu();
}

// Loads leaderboard.js on first visit to the tab, then hands off to it —
// unchanged behaviour from the original app.
let _lbScriptLoaded = false;
function lbBootstrap(){
  if (_lbScriptLoaded){ if (typeof initLeaderboardTab === 'function') initLeaderboardTab(); return; }
  _lbScriptLoaded = true;
  const s = document.createElement('script');
  s.src = 'leaderboard.js';
  s.onload = () => { if (typeof initLeaderboardTab === 'function') initLeaderboardTab(); };
  s.onerror = () => showToast('Could not load the leaderboard — check your connection');
  document.body.appendChild(s);
}

// ─── ONBOARDING / SEMESTER PICKER (Overview tab) ────────────────
function updateSemPickerChrome(){
  const kicker = document.getElementById('sem-picker-kicker');
  const title = document.getElementById('sem-picker-title');
  const sub = document.getElementById('sem-picker-sub');
  const dashboard = document.getElementById('dashboard');
  document.querySelectorAll('.sem-pill').forEach(p => p.classList.toggle('active', Number(p.dataset.sem) === activeSem));

  if (activeSem){
    kicker.textContent = 'Your semester';
    title.textContent = 'Sem ' + activeSem + ' \u00b7 Computer Science Engineering';
    sub.textContent = "Switch anytime — what you enter for each semester is kept separate.";
    dashboard.hidden = false;
    const semIndicator = document.getElementById('sem-indicator-label');
    if (semIndicator) semIndicator.textContent = 'Sem ' + activeSem;
    document.getElementById('calc-kicker').textContent = 'Sem ' + activeSem;
  } else {
    kicker.textContent = 'Get started';
    title.textContent = 'Which semester are you in?';
    sub.textContent = "Pick one and we'll load the right course list and marking scheme for it. Nothing is filled in for you.";
    dashboard.hidden = true;
  }
}
function quickSetup(sem){
  const semNum = parseInt(sem, 10);
  if (!SEM_COURSES[semNum]) return;
  document.getElementById('onboarding-gate').style.display = 'none';
  activeSem = semNum;
  crossSemOverride = false;
  courses = [];
  courseIdCounter = 0;
  SEM_COURSES[semNum].forEach(sc => {
    courses.push({
      id: ++courseIdCounter, name: sc.name, credits: sc.credits,
      internal: 0, internalMax: 20,
      midsem: 0, midsemMax: 30, midsemType: 'auto',
      teacherAward: 0, teacherAwardMax: 30,
      endsemMax: sc.endsemMax, endsemScore: 0,
    });
  });
  document.getElementById('calc-guard').hidden = true;
  document.getElementById('calc-content').hidden = false;
  renderCourses();
  renderSemSwitcher();
  updateSem1UI();
  updateSemPickerChrome();
  debouncedSave();
  autoFillPrevFromSavedSems(semNum);
  showToast('Sem ' + semNum + ' loaded — enter your marks!', 'success');
}
function skipOnboarding(){
  document.getElementById('onboarding-gate').style.display = 'none';
  if (!activeSem) activeSem = 1;
  courses = [];
  courseIdCounter = 0;
  document.getElementById('calc-guard').hidden = true;
  document.getElementById('calc-content').hidden = false;
  renderCourses();
  renderSemSwitcher();
  updateSem1UI();
  updateSemPickerChrome();
}
function updateSem1UI(){
  const isSem1 = activeSem === 1;
  const prevSection = document.getElementById('prev-sem-section');
  const cgpaCard = document.getElementById('hero-cgpa-card');
  const cgpaLbl = document.getElementById('h-cgpa-lbl');
  const cgpaVal = document.getElementById('h-cgpa');
  const cgpaDiv = document.getElementById('h-cgpa-div');
  if (prevSection) prevSection.style.display = isSem1 ? 'none' : '';
  if (cgpaCard){
    if (isSem1){
      if (cgpaLbl) cgpaLbl.textContent = 'CGPA';
      if (cgpaVal) cgpaVal.textContent = '\u2014';
      if (cgpaDiv){ cgpaDiv.textContent = 'available from Sem 2'; cgpaDiv.style.color = ''; cgpaDiv.style.background = ''; }
    } else if (cgpaLbl){
      cgpaLbl.textContent = 'CGPA (all sems)';
    }
  }
}

// ─── COURSE RENDERING ────────────────────────────────────────────
function halvedGlobalChecked(){
  const el = document.getElementById('global-halved');
  return el ? el.checked : true;
}
function effectiveType(c){ return c.midsemType === 'teacher' ? 'teacher' : (halvedGlobalChecked() ? 'halved' : 'full'); }

function renderCourses(){
  const container = document.getElementById('courses-list');
  if (!container) return;

  if (courses.length === 0){
    container.innerHTML = '<div class="empty-state-liquid"><p>No courses added yet — add your subjects to start calculating your SGPA.</p><button class="btn btn-add" type="button" onclick="addCourse()">+ Add course</button></div>';
    updateHero();
    renderThresh();
    return;
  }

  const expanded = new Set([...document.querySelectorAll('.course-card.expanded')].map(el => Number(el.id.replace('course-card-', ''))));
  container.innerHTML = '';
  courses.forEach(c => container.appendChild(buildCourseCard(c)));
  expanded.forEach(id => { const card = document.getElementById('course-card-' + id); if (card) card.classList.add('expanded'); });
  // buildCourseCard() only lays out each card's skeleton (placeholders
  // for total/secured/targets/ticks) — refreshCourseCard() is what
  // actually computes and fills them in, same as it does after any
  // later edit. Without this, a freshly loaded/switched semester would
  // show every card stuck on "—" until the user touched a field.
  courses.forEach(refreshCourseCard);

  updateHero();
  updatePrevSgpaCheck();
  renderThresh();
}

// ─── END-SEM TARGETS SUMMARY — all courses at a glance ──────────
// Companion to the per-course "targets" chips inside each card: same
// minEndsemFor() numbers, laid out as one table so every course's
// requirement is visible without opening each card individually.
function renderThresh(){
  const body = document.getElementById('thresh-body');
  if (!body) return;
  if (courses.length === 0){
    body.innerHTML = '<tr><td colspan="6" class="esr-empty">Add a course above to see what you need in each end-sem.</td></tr>';
    return;
  }
  body.innerHTML = courses.map(c => {
    const cv = { ...c, midsemType: effectiveType(c) };
    const cells = TICK_TARGETS.map(t => {
      const needed = minEndsemFor(cv, t.min);
      if (needed <= 0) return '<td><span class="esr-chip achieved">&check; secured</span></td>';
      if (needed > c.endsemMax) return '<td><span class="esr-chip impossible">out of reach</span></td>';
      const pct = Math.round((needed / c.endsemMax) * 100);
      return '<td><span class="esr-chip needed">need ' + needed.toFixed(1) + '<span class="esr-pct">/' + c.endsemMax + '</span></span></td>';
    }).join('');
    return '<tr><td>' + escapeHtml(c.name || 'Untitled') + '</td><td>' + c.credits + '</td>' + cells + '</tr>';
  }).join('');
}

function buildCourseCard(c){
  const card = document.createElement('div');
  card.className = 'course-card';
  card.id = 'course-card-' + c.id;
  card.innerHTML = `
    <div class="cc-head" onclick="toggleExpand(${c.id})">
      <div class="cc-name-wrap">
        <div class="cc-name" id="ccname-${c.id}"></div>
        <div class="cc-meta" id="ccmeta-${c.id}"></div>
        <div class="cc-mini-meter liquid-meter" id="minimeter-${c.id}">
          <svg class="liquid-wave" viewBox="0 0 600 14" preserveAspectRatio="none"><path d="M0,7 C150,14 150,0 300,7 C450,14 450,0 600,7 L600,14 L0,14 Z"/></svg>
          <div class="liquid-fill"></div>
        </div>
      </div>
      <div class="grade-chip" id="chip-${c.id}"></div>
      <button class="del-btn" title="Remove course" onclick="event.stopPropagation();removeCourse(${c.id})">&#10005;</button>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    <div class="cc-body-wrap"><div class="cc-body"><div class="cc-body-inner">
      <div class="divider"></div>
      <input class="name-edit" id="nameinput-${c.id}" value="${escapeHtml(c.name)}" onchange="updateCourseName(${c.id}, this.value)" aria-label="Course name">

      <div class="marks-grid">
        <label class="tile"><span class="tile-label">Credits</span><input type="number" min="1" max="8" value="${c.credits}" onchange="validateNumberInput(this,1,8);updateCourseField(${c.id},'credits',+this.value)"></label>
        <label class="tile"><span class="tile-label">Internal /<span id="imax-lbl-${c.id}">${c.internalMax || 20}</span></span><input type="number" min="0" max="${c.internalMax || 20}" value="${c.internal}" oninput="updateCourseField(${c.id},'internal',+this.value)"></label>
        <div class="tile" id="mid-input-wrap-${c.id}"></div>
        <div class="tile readonly"><span class="tile-label">Pre-end total</span><div class="tile-readout" id="secured-${c.id}">\u2014</div></div>
      </div>

      <div class="marks-grid">
        <label class="tile"><span class="tile-label">Internal max</span>
          <select onchange="updateCourseField(${c.id},'internalMax',+this.value)">
            <option value="20" ${(c.internalMax||20)===20?'selected':''}>/20</option>
            <option value="25" ${(c.internalMax||20)===25?'selected':''}>/25</option>
            <option value="30" ${(c.internalMax||20)===30?'selected':''}>/30</option>
            <option value="15" ${(c.internalMax||20)===15?'selected':''}>/15</option>
          </select>
        </label>
        <label class="tile" id="tamax-wrap-${c.id}"><span class="tile-label">Teacher gave max</span>
          <select onchange="updateCourseField(${c.id},'teacherAwardMax',+this.value)">
            <option value="30" ${(c.teacherAwardMax||30)===30?'selected':''}>/30</option>
            <option value="25" ${(c.teacherAwardMax||30)===25?'selected':''}>/25</option>
            <option value="20" ${(c.teacherAwardMax||30)===20?'selected':''}>/20</option>
            <option value="15" ${(c.teacherAwardMax||30)===15?'selected':''}>/15</option>
          </select>
        </label>
      </div>

      <div class="toggle-row-liquid">
        <div class="toggle-text"><b>Mid-sem not held — teacher awards marks</b><span>Teacher directly assigns marks (e.g. gave 20/30, not the full 30)</span></div>
        <label class="lswitch"><input type="checkbox" id="teachertoggle-${c.id}" ${c.midsemType==='teacher'?'checked':''} onchange="updateCourseField(${c.id},'midsemType',this.checked?'teacher':'auto')"><span class="ltrack"><span class="lthumb"></span></span></label>
      </div>
      <div class="toggle-row-liquid">
        <div class="toggle-text"><b>End-sem out of 50 (has practicals)</b><span>Off for theory-only courses (out of 70)</span></div>
        <label class="lswitch"><input type="checkbox" ${c.endsemMax===50?'checked':''} onchange="updateCourseField(${c.id},'endsemMax',this.checked?50:70)"><span class="ltrack"><span class="lthumb"></span></span></label>
      </div>

      <div class="slider-row" style="margin-top:16px;">
        <div class="slider-top">
          <span class="slider-label">End-sem score</span>
          <span class="slider-val"><span id="rangeval-${c.id}">${c.endsemScore}</span><span> / <span id="rangemax-${c.id}">${c.endsemMax}</span></span></span>
        </div>
        <div class="slider-track-wrap">
          <input type="range" class="liquid-range" id="range-${c.id}" min="0" max="${c.endsemMax}" step="0.5" value="${c.endsemScore}" oninput="updateEndsem(${c.id}, +this.value)" aria-label="End-sem score">
          <div class="slider-ticks" id="ticks-${c.id}"></div>
        </div>
      </div>

      <div class="cc-total-meter">
        <div class="cc-total-meter-top"><span>Total</span><span id="total-${c.id}">\u2014</span></div>
        <div class="liquid-meter thick" id="meter-${c.id}">
          <svg class="liquid-wave" viewBox="0 0 600 16" preserveAspectRatio="none"><path d="M0,8 C150,16 150,0 300,8 C450,16 450,0 600,8 L600,16 L0,16 Z"/></svg>
          <div class="liquid-fill"></div>
        </div>
      </div>

      <div class="targets">
        <div class="targets-label">What you need in end-sem</div>
        <div class="targets-grid" id="targets-${c.id}"></div>
      </div>
    </div></div></div>
  `;
  return card;
}

function midInputHtml(c){
  if (effectiveType(c) === 'teacher'){
    return '<span class="tile-label">Teacher gave</span><input type="number" min="0" max="' + (c.teacherAwardMax||30) + '" value="' + c.teacherAward + '" oninput="updateCourseField(' + c.id + ',\'teacherAward\',+this.value)">';
  }
  return '<span class="tile-label">Mid-sem /' + c.midsemMax + '</span><input type="number" min="0" max="' + c.midsemMax + '" value="' + c.midsem + '" oninput="updateCourseField(' + c.id + ',\'midsem\',+this.value)">';
}

function refreshCourseCard(c){
  const type = effectiveType(c);
  const cv = { ...c, midsemType: type };
  const total = calcTotal(cv, c.endsemScore);
  const grade = getGrade(total);

  const nameEl = document.getElementById('ccname-' + c.id);
  if (nameEl) nameEl.textContent = c.name;
  const metaEl = document.getElementById('ccmeta-' + c.id);
  if (metaEl) metaEl.innerHTML = c.credits + ' cr \u00b7 <b>' + total.toFixed(1) + '</b>/100 \u00b7 end-sem ' + c.endsemScore + '/' + c.endsemMax;

  const chip = document.getElementById('chip-' + c.id);
  if (chip){ chip.textContent = grade.letter + ' \u00b7 ' + grade.pts + 'pt'; chip.style.setProperty('--gc', grade.color); }

  ['minimeter-', 'meter-'].forEach(prefix => {
    const m = document.getElementById(prefix + c.id);
    if (!m) return;
    m.style.setProperty('--level', Math.min(total, 100) + '%');
    m.style.setProperty('--gc', grade.color);
  });

  let securedDisplay;
  if (type === 'teacher') securedDisplay = (c.internal + c.teacherAward).toFixed(1);
  else if (type === 'halved') securedDisplay = (c.internal + (c.midsem / c.midsemMax) * 15).toFixed(1);
  else securedDisplay = (c.internal + c.midsem).toFixed(1);
  const secEl = document.getElementById('secured-' + c.id);
  if (secEl) secEl.textContent = securedDisplay;

  const totalEl = document.getElementById('total-' + c.id);
  if (totalEl) totalEl.textContent = total.toFixed(1) + '%';

  const range = document.getElementById('range-' + c.id);
  if (range){
    range.max = c.endsemMax;
    range.value = c.endsemScore;
    range.style.setProperty('--pct', (c.endsemScore / c.endsemMax * 100) + '%');
    range.style.setProperty('--gc', grade.color);
  }
  const rv = document.getElementById('rangeval-' + c.id);
  if (rv) rv.textContent = c.endsemScore;
  const rm = document.getElementById('rangemax-' + c.id);
  if (rm) rm.textContent = c.endsemMax;
  const ticks = document.getElementById('ticks-' + c.id);
  if (ticks) ticks.innerHTML = buildTicks(c);

  const imaxLbl = document.getElementById('imax-lbl-' + c.id);
  if (imaxLbl) imaxLbl.textContent = c.internalMax || 20;

  const midWrap = document.getElementById('mid-input-wrap-' + c.id);
  if (midWrap) midWrap.innerHTML = midInputHtml(c);

  const tamaxWrap = document.getElementById('tamax-wrap-' + c.id);
  if (tamaxWrap) tamaxWrap.classList.toggle('dim', type !== 'teacher');

  const targetsEl = document.getElementById('targets-' + c.id);
  if (targetsEl){
    const bands = [
      { grade:'B+', min:60 }, { grade:'A', min:70 }, { grade:'A+', min:80 }, { grade:'O', min:90 },
    ];
    targetsEl.innerHTML = bands.map(b => {
      const bandGrade = GRADES.find(g => g.min === b.min);
      const color = cssVar(bandGrade.cvar);
      const needed = minEndsemFor(cv, b.min);
      let cls = 'target-chip', valHtml, barPct;
      if (needed <= 0){ cls += ' secured'; valHtml = '\u2713 achieved'; barPct = 100; }
      else if (needed > c.endsemMax){ cls += ' impossible'; valHtml = 'out of reach'; barPct = 100; }
      else { valHtml = 'need ' + Math.ceil(needed * 2) / 2; barPct = Math.min(100, (total / b.min) * 100); }
      return '<div class="' + cls + '" style="--gc:' + color + '"><div class="tc-top"><span class="tc-grade">' + b.grade + '</span><span class="tc-val">' + valHtml + '</span></div><div class="tc-bar"><div class="tc-bar-fill" style="width:' + barPct + '%"></div></div></div>';
    }).join('');
  }
}

function toggleExpand(id){
  const card = document.getElementById('course-card-' + id);
  if (card) card.classList.toggle('expanded');
}
function updateEndsem(id, val){
  const c = courses.find(x => x.id === id);
  if (!c) return;
  c.endsemScore = val;
  refreshCourseCard(c);
  updateHero();
  renderThresh();
  debouncedSave();
}
function updateCourseField(id, field, val){
  const c = courses.find(x => x.id === id);
  if (!c) return;
  if (field === 'endsemMax'){ c.endsemMax = val; if (c.endsemScore > val) c.endsemScore = val; }
  else if (field === 'internalMax'){ c.internalMax = val; if (c.internal > val) c.internal = val; }
  else if (field === 'teacherAwardMax'){ c.teacherAwardMax = val; if (c.teacherAward > val) c.teacherAward = val; }
  else { c[field] = val; }
  refreshCourseCard(c);
  updateHero();
  renderThresh();
  debouncedSave();
}
function updateCourseName(id, val){
  const c = courses.find(x => x.id === id);
  if (!c) return;
  c.name = val.trim() || 'Untitled course';
  const el = document.getElementById('ccname-' + id);
  if (el) el.textContent = c.name;
  renderThresh();
  debouncedSave();
}
function addCourse(){
  const c = { id: ++courseIdCounter, name: 'New course', credits: 4, internal:0, internalMax:20, midsem:0, midsemMax:30, midsemType:'auto', teacherAward:0, teacherAwardMax:30, endsemMax:70, endsemScore:0 };
  const empty = document.querySelector('.empty-state-liquid');
  if (empty) empty.parentElement.innerHTML = '';
  courses.push(c);
  const container = document.getElementById('courses-list');
  const card = buildCourseCard(c);
  card.classList.add('expanded', 'entering');
  container.appendChild(card);
  refreshCourseCard(c);
  updateHero();
  renderThresh();
  debouncedSave();
  setTimeout(() => card.classList.remove('entering'), 600);
  card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block:'center' });
}
function removeCourse(id){
  const card = document.getElementById('course-card-' + id);
  courses = courses.filter(c => c.id !== id);
  const finish = () => { renderCourses(); debouncedSave(); };
  if (card && !reduceMotion){ card.classList.add('leaving'); setTimeout(finish, 380); }
  else finish();
}
function clearCourses(){
  if (courses.length === 0) return;
  courses = [];
  renderCourses();
  debouncedSave();
}
function recalcAll(){ renderCourses(); debouncedSave(); }

// ─── HERO ─────────────────────────────────────────────────────────
function updateHero(){
  const prevCr = parseFloat(document.getElementById('prev-credits').value) || 0;
  const prevPts = parseFloat(document.getElementById('prev-points').value) || 0;

  let totalPts = 0, totalCr = 0;
  courses.forEach(c => {
    const cv = { ...c, midsemType: effectiveType(c) };
    const total = calcTotal(cv, c.endsemScore);
    const grade = getGrade(total);
    totalPts += grade.pts * c.credits;
    totalCr += c.credits;
  });

  const sgpa = totalCr > 0 ? totalPts / totalCr : null;
  const cgpaCredits = prevCr + totalCr;
  const cgpaPoints = prevPts + totalPts;
  const cgpa = cgpaCredits > 0 ? cgpaPoints / cgpaCredits : null;

  document.getElementById('h-sgpa').textContent = sgpa !== null ? sgpa.toFixed(2) : '\u2014';
  document.getElementById('h-pts').textContent = totalCr > 0 ? totalPts : '\u2014';
  document.getElementById('h-credits').textContent = '/ ' + totalCr + ' credits';
  const sgpaMeter = document.getElementById('h-sgpa-meter');
  if (sgpaMeter) sgpaMeter.style.setProperty('--level', sgpa !== null ? Math.min(sgpa * 10, 100) + '%' : '0%');

  if (sgpa !== null){
    const sd = divLabel(sgpa);
    const badge = document.getElementById('h-sgpa-div');
    badge.textContent = sd.txt; badge.style.color = sd.color; badge.style.background = sd.color + '22';
    if (sgpaMeter) sgpaMeter.style.setProperty('--gc', sd.color);
  }

  if (activeSem !== 1){
    document.getElementById('h-cgpa').textContent = cgpa !== null ? cgpa.toFixed(2) : '\u2014';
    const cgpaMeter = document.getElementById('h-cgpa-meter');
    if (cgpa !== null){
      const cd = divLabel(cgpa);
      const badge = document.getElementById('h-cgpa-div');
      badge.textContent = cd.txt; badge.style.color = cd.color; badge.style.background = cd.color + '22';
      if (cgpaMeter){ cgpaMeter.style.setProperty('--level', Math.min(cgpa * 10, 100) + '%'); cgpaMeter.style.setProperty('--gc', cd.color); }
    }
  }

  updateOverviewDashboard(sgpa, activeSem === 1 ? null : cgpa);
  updatePrevSgpaCheck();
}
function updatePrevSgpaCheck(){
  const cr = parseFloat(document.getElementById('prev-credits').value) || 0;
  const pts = parseFloat(document.getElementById('prev-points').value) || 0;
  const el = document.getElementById('prev-sgpa-check');
  if (!el) return;
  if (cr > 0 && pts > 0){
    const sgpa = pts / cr;
    const d = divLabel(sgpa);
    el.innerHTML = 'Prev SGPA = <b style="color:' + d.color + '">' + sgpa.toFixed(2) + '</b> \u2014 ' + d.txt;
  } else el.innerHTML = '';
}
function onPrevFieldEdit(){
  crossSemOverride = true;
  const sub = document.getElementById('cs-sub');
  if (sub) sub.textContent = 'Manual override active — auto-fill paused.';
  updateHero();
  debouncedSave();
}

// ─── OVERVIEW DASHBOARD ──────────────────────────────────────────
function updateOverviewDashboard(sgpa, cgpa){
  const dashSgpa = document.getElementById('dash-sgpa');
  const dashSgpaMeter = document.getElementById('dash-sgpa-meter');
  if (dashSgpa) dashSgpa.textContent = sgpa !== null && sgpa !== undefined ? sgpa.toFixed(2) : '\u2014';
  if (dashSgpaMeter){
    const has = sgpa !== null && sgpa !== undefined;
    dashSgpaMeter.style.setProperty('--level', has ? Math.min(sgpa * 10, 100) + '%' : '0%');
    if (has) dashSgpaMeter.style.setProperty('--gc', divLabel(sgpa).color);
  }
  const dashCgpa = document.getElementById('dash-cgpa');
  const dashCgpaMeter = document.getElementById('dash-cgpa-meter');
  const hasCgpa = cgpa !== null && cgpa !== undefined;
  if (dashCgpa) dashCgpa.textContent = hasCgpa ? cgpa.toFixed(2) : '\u2014';
  if (dashCgpaMeter){
    dashCgpaMeter.style.setProperty('--level', hasCgpa ? Math.min(cgpa * 10, 100) + '%' : '0%');
    if (hasCgpa) dashCgpaMeter.style.setProperty('--gc', divLabel(cgpa).color);
  }
}

// ─── TOOLBAR: copy / backup / restore ───────────────────────────
function copySummary(){
  if (!activeSem){ showToast('Pick a semester first'); return; }
  let totalPts = 0, totalCr = 0;
  const lines = courses.map(c => {
    const cv = { ...c, midsemType: effectiveType(c) };
    const total = calcTotal(cv, c.endsemScore);
    const grade = getGrade(total);
    totalPts += grade.pts * c.credits; totalCr += c.credits;
    return '\u2022 ' + c.name + ' \u2014 ' + total.toFixed(1) + '/100 (' + grade.letter + ' \u00b7 ' + grade.pts + 'pt)';
  });
  const sgpa = totalCr ? (totalPts / totalCr).toFixed(2) : '0.00';
  const text = 'Doon Grade Calculator \u2014 Sem ' + activeSem + '\n' + lines.join('\n') + '\n\nSGPA: ' + sgpa + ' (' + totalCr + ' credits)';
  const done = () => showToast('Summary copied \u2713', 'success');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done){
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); } catch(e){ showToast('Could not copy — select manually'); }
  document.body.removeChild(ta);
}

// ─── SHARE CARD — canvas-drawn shareable grade card ──────────────
// Draws current semester's SGPA (+ CGPA if past semesters are on
// file) and per-course grades onto a canvas, downloadable as a PNG
// or copyable straight to the clipboard. Dark/light card themes are
// independent of the app's own theme so the card looks right no
// matter which app theme it was generated under.
let shareCardTheme = 'dark';
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function truncateText(ctx, text, maxWidth){
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}
function shareCard(){
  if (!activeSem || courses.length === 0){ showToast('Add at least one course first'); return; }
  document.getElementById('share-modal').classList.add('open');
  updateShareThemeButtons();
  renderShareCard();
}
function closeShareModal(){
  document.getElementById('share-modal').classList.remove('open');
}
function setShareCardTheme(theme){
  shareCardTheme = theme;
  updateShareThemeButtons();
  renderShareCard();
}
function updateShareThemeButtons(){
  const d = document.getElementById('share-theme-dark'), l = document.getElementById('share-theme-light');
  if (d) d.classList.toggle('active', shareCardTheme === 'dark');
  if (l) l.classList.toggle('active', shareCardTheme === 'light');
}
function renderShareCard(){
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const W = 720, H = 900;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.aspectRatio = W + ' / ' + H;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  shareCardDraw(ctx, W, H);
}
function shareCardDraw(ctx, W, H){
  const dark = shareCardTheme === 'dark';
  const ink       = dark ? '#eef7f2' : '#062a20';
  const inkDim    = dark ? 'rgba(238,247,242,.62)' : 'rgba(6,42,32,.58)';
  const inkFaint  = dark ? 'rgba(238,247,242,.38)' : 'rgba(6,42,32,.4)';
  const cardBg    = dark ? '#0a1310' : '#f4faf6';
  const lineCol   = dark ? 'rgba(238,247,242,.12)' : 'rgba(6,42,32,.1)';
  const chipBg    = dark ? 'rgba(238,247,242,.06)' : 'rgba(6,42,32,.045)';
  const emerald = '#34d399', aqua = '#22d3d0', mint = '#5eead4';

  ctx.clearRect(0, 0, W, H);

  // background — soft liquid gradient blobs on a flat base
  ctx.fillStyle = cardBg;
  roundRect(ctx, 0, 0, W, H, 28); ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 28); ctx.clip();
  const g1 = ctx.createRadialGradient(W * 0.15, H * 0.05, 0, W * 0.15, H * 0.05, W * 0.65);
  g1.addColorStop(0, dark ? 'rgba(52,211,153,.24)' : 'rgba(52,211,153,.16)');
  g1.addColorStop(1, 'rgba(52,211,153,0)');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W * 0.95, H * 0.28, 0, W * 0.95, H * 0.28, W * 0.6);
  g2.addColorStop(0, dark ? 'rgba(34,211,208,.2)' : 'rgba(34,211,208,.13)');
  g2.addColorStop(1, 'rgba(34,211,208,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // header
  ctx.fillStyle = inkFaint;
  ctx.font = '700 13px Manrope, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('DOON GRADE CALCULATOR', 44, 56);
  ctx.fillStyle = inkDim;
  ctx.font = '600 13px "JetBrains Mono", monospace';
  const semLabel = 'SEMESTER ' + activeSem;
  ctx.fillText(semLabel, W - 44 - ctx.measureText(semLabel).width, 56);

  ctx.strokeStyle = lineCol; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(44, 76); ctx.lineTo(W - 44, 76); ctx.stroke();

  // SGPA (+ CGPA if we have prior-semester data)
  let totalPts = 0, totalCr = 0;
  courses.forEach(c => {
    const cv = { ...c, midsemType: effectiveType(c) };
    const total = calcTotal(cv, c.endsemScore);
    const grade = getGrade(total);
    totalPts += grade.pts * c.credits; totalCr += c.credits;
  });
  const sgpa = totalCr ? (totalPts / totalCr) : 0;

  const prevCr = parseFloat(document.getElementById('prev-credits')?.value) || 0;
  const prevPts = parseFloat(document.getElementById('prev-points')?.value) || 0;
  const cgpaCr = prevCr + totalCr;
  const cgpa = cgpaCr > 0 ? ((prevPts + totalPts) / cgpaCr) : null;

  ctx.fillStyle = inkFaint;
  ctx.font = '700 12px Manrope, sans-serif';
  ctx.fillText('SGPA THIS SEMESTER', 44, 128);
  ctx.fillStyle = ink;
  ctx.font = '800 76px Archivo, sans-serif';
  ctx.fillText(sgpa.toFixed(2), 42, 200);

  if (cgpa !== null && prevCr > 0){
    const sgpaW = ctx.measureText(sgpa.toFixed(2)).width;
    ctx.fillStyle = inkDim;
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.fillText('CGPA ' + cgpa.toFixed(2), 42 + sgpaW + 22, 200);
  }
  ctx.fillStyle = inkFaint;
  ctx.font = '500 12.5px Manrope, sans-serif';
  ctx.fillText(totalCr + ' credits · ' + courses.length + ' course' + (courses.length === 1 ? '' : 's'), 44, 224);

  // per-course rows
  let y = 268;
  const rowH = 58;
  const maxRows = 8;
  const shown = courses.slice(0, maxRows);
  shown.forEach(c => {
    const cv = { ...c, midsemType: effectiveType(c) };
    const total = calcTotal(cv, c.endsemScore);
    const grade = getGrade(total);

    ctx.fillStyle = chipBg;
    roundRect(ctx, 44, y, W - 88, rowH - 12, 14); ctx.fill();

    ctx.fillStyle = ink;
    ctx.font = '700 15px Manrope, sans-serif';
    const name = truncateText(ctx, c.name || 'Untitled', W - 88 - 200);
    ctx.fillText(name, 66, y + 30);

    ctx.fillStyle = inkFaint;
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillText(c.credits + ' credits · ' + total.toFixed(1) + '%', 66, y + 47);

    const chipColor = cssVar(grade.cvar) || emerald;
    const chipLabel = grade.letter + ' · ' + grade.pts + 'pt';
    ctx.font = '800 14px "JetBrains Mono", monospace';
    const chipTextW = ctx.measureText(chipLabel).width;
    const chipW = chipTextW + 28, chipH = 30;
    const chipX = W - 44 - 20 - chipW, chipY = y + (rowH - 12 - chipH) / 2;
    ctx.fillStyle = hexToRgba(chipColor, dark ? 0.16 : 0.14);
    roundRect(ctx, chipX, chipY, chipW, chipH, 999); ctx.fill();
    ctx.fillStyle = chipColor;
    ctx.fillText(chipLabel, chipX + 14, chipY + 20);

    y += rowH;
  });
  if (courses.length > maxRows){
    ctx.fillStyle = inkFaint;
    ctx.font = '600 12px Manrope, sans-serif';
    ctx.fillText('+ ' + (courses.length - maxRows) + ' more course' + (courses.length - maxRows === 1 ? '' : 's'), 44, y + 14);
    y += 30;
  }

  // footer
  ctx.strokeStyle = lineCol;
  ctx.beginPath(); ctx.moveTo(44, H - 58); ctx.lineTo(W - 44, H - 58); ctx.stroke();
  ctx.fillStyle = inkFaint;
  ctx.font = '500 11.5px Manrope, sans-serif';
  ctx.fillText('Made with the Doon Grade Calculator', 44, H - 32);
  const dot1 = emerald, dot2 = aqua, dot3 = mint;
  [dot1, dot2, dot3].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(W - 44 - 10 - i * 18, H - 37, 5, 0, Math.PI * 2); ctx.fill();
  });
}
function hexToRgba(hex, alpha){
  hex = (hex || '').trim();
  if (!hex.startsWith('#')) return hex; // already a color() / rgb() string from a CSS var — use as-is
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
  const num = parseInt(h, 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function downloadCard(){
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  canvas.toBlob(blob => {
    if (!blob){ showToast('Could not generate image'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'doon-grades-sem' + activeSem + '.png';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    showToast('Card downloaded ✓', 'success');
  }, 'image/png');
}
function copyCardToClipboard(){
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  if (!navigator.clipboard || !window.ClipboardItem){
    showToast('Clipboard images aren\u2019t supported here — try Download instead');
    return;
  }
  canvas.toBlob(blob => {
    if (!blob){ showToast('Could not generate image'); return; }
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      .then(() => showToast('Card copied ✓', 'success'))
      .catch(() => showToast('Could not copy — try Download instead'));
  }, 'image/png');
}

function exportData(){
  try{
    const meta = getMetaState();
    const blob_data = { _version:6, _exportedAt:new Date().toISOString(), meta };
    (meta.semsUsed || []).forEach(n => {
      const raw = localStorage.getItem(SEM_KEY(n));
      if (raw) blob_data['sem_' + n] = JSON.parse(raw);
    });
    const planRaw = localStorage.getItem(PLAN_KEY);
    if (planRaw) blob_data.planner = JSON.parse(planRaw);

    const blob = new Blob([JSON.stringify(blob_data, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = 'doon-grades-backup-' + ts + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    showToast('\u2713 Backup downloaded!', 'success');
  } catch(e){ showToast('Export failed \u2014 ' + e.message); }
}
function importData(input){
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const data = JSON.parse(e.target.result);
      if (!data.meta || !data._version) throw new Error('Not a valid backup file');
      (data.meta.semsUsed || []).forEach(n => { if (data['sem_' + n]) localStorage.setItem(SEM_KEY(n), JSON.stringify(data['sem_' + n])); });
      if (data.planner) localStorage.setItem(PLAN_KEY, JSON.stringify(data.planner));
      localStorage.setItem(META_KEY, JSON.stringify(data.meta));
      showToast('\u2713 Backup restored! Reloading\u2026', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch(err){ showToast('Restore failed: ' + err.message); }
    input.value = '';
  };
  reader.readAsText(file);
}
function loadSampleMarks(){
  if (!courses.length){ showToast('Add a course first'); return; }
  courses.forEach(c => {
    c.internal = Math.round((c.internalMax || 20) * (0.7 + Math.random() * 0.25));
    if (effectiveType(c) === 'teacher') c.teacherAward = Math.round((c.teacherAwardMax || 30) * (0.7 + Math.random() * 0.25));
    else c.midsem = Math.round((c.midsemMax || 30) * (0.65 + Math.random() * 0.3));
    c.endsemScore = Math.round((0.55 + Math.random() * 0.35) * c.endsemMax);
  });
  renderCourses();
  debouncedSave();
  showToast('Sample marks loaded');
}

// ─── CGPA PLANNER (independent of the auto-computed CGPA above —
// ─── this is a manual "what SGPA do I need this semester" tool) ──
function addPastSem(){
  const id = ++pastSemIdCounter;
  pastSems.push({ id, sem:id, credits:22, points:0 });
  renderPastSems();
  calcPlan();
  debouncedSave();
}
function removePastSem(id){
  pastSems = pastSems.filter(s => s.id !== id);
  renderPastSems();
  calcPlan();
  debouncedSave();
}
function renderPastSems(){
  const list = document.getElementById('past-sems-list');
  if (!list) return;
  if (pastSems.length === 0){
    list.innerHTML = '<div class="pt-row"><span class="pt-sem" style="grid-column:1/5;color:var(--text-dim2);">No past semesters added yet.</span></div>';
    return;
  }
  list.innerHTML = pastSems.map(s => {
    const sgpaVal = s.credits > 0 ? s.points / s.credits : 0;
    const d = divLabel(sgpaVal);
    return `<div class="pt-row" data-id="${s.id}">
      <span class="pt-sem">Sem ${s.sem}</span>
      <input type="number" value="${s.credits}" min="1" placeholder="Credits" onchange="updatePastSem(${s.id},'credits',+this.value)">
      <input type="number" value="${s.points}" min="0" placeholder="Cr.Pts" onchange="updatePastSem(${s.id},'points',+this.value)">
      <span class="pt-sgpa" id="pt-sgpa-${s.id}" style="color:${d.color}">${s.credits > 0 ? sgpaVal.toFixed(2) : '\u2014'}</span>
      <button class="pt-del" onclick="removePastSem(${s.id})">&#10005;</button>
    </div>`;
  }).join('');
}
function updatePastSem(id, field, val){
  const s = pastSems.find(x => x.id === id);
  if (!s) return;
  s[field] = val;
  const el = document.getElementById('pt-sgpa-' + id);
  if (el){
    const sgpaVal = s.credits > 0 ? s.points / s.credits : 0;
    const d = divLabel(sgpaVal);
    el.textContent = s.credits > 0 ? sgpaVal.toFixed(2) : '\u2014';
    el.style.color = d.color;
  }
  calcPlan();
  debouncedSave();
}
function calcPlan(){
  const res = document.getElementById('plan-result');
  if (!res) return;
  const curCredits = parseFloat(document.getElementById('cur-credits-plan').value) || 0;
  const target = parseFloat(document.getElementById('target-cgpa').value) || 0;
  let prevCr = 0, prevPts = 0;
  pastSems.forEach(s => { prevCr += s.credits; prevPts += s.points; });
  const totalCr = prevCr + curCredits;

  res.className = 'planner-result';
  if (curCredits === 0){
    res.innerHTML = 'Set current semester credits to see the result.';
    return;
  }

  const currentCGPA = prevCr > 0 ? prevPts / prevCr : null;
  const neededTotalPts = target * totalCr;
  const neededCurPts = neededTotalPts - prevPts;
  const neededSGPA = curCredits > 0 ? neededCurPts / curCredits : null;

  let html = '';
  if (currentCGPA !== null){
    const cd = divLabel(currentCGPA);
    html += 'Current CGPA: <b style="color:' + cd.color + '">' + currentCGPA.toFixed(2) + '</b> \u2014 ' + cd.txt + '<br>Prev credits: <b>' + prevCr + '</b> \u00b7 Prev credit points: <b>' + prevPts + '</b><br><br>';
  }

  if (neededSGPA === null || isNaN(neededSGPA)){
    html += 'Enter valid data to continue.';
    res.innerHTML = html;
    return;
  }

  if (neededSGPA > 10){
    const maxCGPA = (prevPts + 10 * curCredits) / totalCr;
    const md = divLabel(maxCGPA);
    res.classList.add('warn');
    html += '\u26A0 A CGPA of <b>' + target.toFixed(2) + '</b> is not achievable this semester \u2014 even a perfect 10.00 SGPA won\u2019t get you there.<br><br>Maximum achievable CGPA: <b style="color:' + md.color + '">' + maxCGPA.toFixed(2) + '</b> \u2014 ' + md.txt;
  } else if (neededSGPA <= 0){
    const sd = divLabel(target);
    res.classList.add('ok');
    html += '\u2713 Target CGPA of <b>' + target.toFixed(2) + '</b> (' + sd.txt + ') is already guaranteed \u2014 you\u2019ll exceed it even with a 0 SGPA this semester.';
  } else {
    const sd = divLabel(neededSGPA);
    html += 'Required SGPA this semester:<br><span class="big" style="color:' + sd.color + '">' + neededSGPA.toFixed(3) + '</span><br><br>Required credit points: <b>' + neededCurPts.toFixed(1) + '</b> of ' + (curCredits * 10) + ' max';
    res.innerHTML = html;

    let projRows = '';
    [6, 7, 8, 9, 10].forEach(sgpaTest => {
      const pts = sgpaTest * curCredits;
      const cgpaTest = (prevPts + pts) / totalCr;
      const d = divLabel(cgpaTest);
      const isTarget = Math.round(neededSGPA) === sgpaTest;
      projRows += `<tr class="${isTarget ? 'hit' : ''}"><td>${sgpaTest}.00${isTarget ? ' \u2190' : ''}</td><td>${pts}</td><td style="color:${d.color};font-weight:700;">${cgpaTest.toFixed(2)}</td><td style="color:${d.color}">${d.txt}</td></tr>`;
    });
    const table = document.createElement('table');
    table.className = 'proj-table';
    table.innerHTML = '<thead><tr><th>Your SGPA</th><th>Cr. Pts</th><th>Final CGPA</th><th>Division</th></tr></thead><tbody>' + projRows + '</tbody>';
    res.appendChild(table);
    return;
  }
  res.innerHTML = html;
}

// ─── SEMESTER COURSE MAP (NEP 2020 CSE, Doon Univ — real data) ──
const SEM_COURSES = {
  1: [
    { name:'Problem Solving & Programming in C', credits:4, endsemMax:70 },
    { name:'Digital System Design', credits:4, endsemMax:70 },
    { name:'Fundamentals of Computer Science', credits:4, endsemMax:70 },
    { name:'AECC (from pool)', credits:2, endsemMax:70 },
    { name:'VAC (from pool)', credits:2, endsemMax:70 },
    { name:'Generic Elective 1 (e.g. Applied Calculus)', credits:3, endsemMax:70 },
    { name:'Generic Elective 2 (e.g. Mechanics I)', credits:3, endsemMax:70 },
  ],
  2: [
    { name:'Computer Architecture', credits:4, endsemMax:70 },
    { name:'Discrete Mathematics', credits:4, endsemMax:70 },
    { name:'Fundamentals of Electronics', credits:4, endsemMax:50 },
    { name:'AECC (from pool)', credits:2, endsemMax:70 },
    { name:'VAC (from pool)', credits:2, endsemMax:70 },
    { name:'Generic Elective (e.g. Opt. Prob. & Stats)', credits:3, endsemMax:70 },
  ],
  3: [
    { name:'Data Structures', credits:4, endsemMax:70 },
    { name:'OOP using C++', credits:4, endsemMax:70 },
    { name:'Theory of Computation', credits:4, endsemMax:70 },
    { name:'AECC (from pool)', credits:2, endsemMax:70 },
    { name:'VAC (from pool)', credits:2, endsemMax:70 },
    { name:'Python Programming with Project', credits:2, endsemMax:50 },
    { name:'Elective', credits:4, endsemMax:70 },
  ],
  4: [
    { name:'Database Management System', credits:4, endsemMax:70 },
    { name:'Numerical & Statistical Computing', credits:4, endsemMax:70 },
    { name:'Design & Analysis of Algorithms', credits:4, endsemMax:70 },
    { name:'AECC (from pool)', credits:2, endsemMax:70 },
    { name:'VAC (from pool)', credits:2, endsemMax:70 },
    { name:'Server-side Web Technologies', credits:2, endsemMax:50 },
    { name:'Elective', credits:4, endsemMax:70 },
  ],
  5: [
    { name:'Operating Systems', credits:4, endsemMax:70 },
    { name:'Compiler Design', credits:4, endsemMax:70 },
    { name:'Computer Networks', credits:4, endsemMax:70 },
    { name:'DSE Elective 1', credits:4, endsemMax:70 },
    { name:'GE / DSE Elective 2', credits:4, endsemMax:70 },
    { name:'Project-1 with Internship', credits:2, endsemMax:50 },
  ],
  6: [
    { name:'Software Engineering', credits:4, endsemMax:70 },
    { name:'System Software', credits:4, endsemMax:70 },
    { name:'Programming in Java', credits:4, endsemMax:70 },
    { name:'DSE Elective 1', credits:4, endsemMax:70 },
    { name:'GE / DSE Elective 2', credits:4, endsemMax:70 },
    { name:'Project-2 with Internship', credits:2, endsemMax:50 },
  ],
  7: [
    { name:'Computer Graphics', credits:4, endsemMax:70 },
    { name:'DSE/GE Elective 1', credits:4, endsemMax:70 },
    { name:'DSE/GE Elective 2', credits:4, endsemMax:70 },
    { name:'DSE/GE Elective 3', credits:4, endsemMax:70 },
    { name:'UG Dissertation Part 1', credits:6, endsemMax:70 },
  ],
  8: [
    { name:'Artificial Intelligence', credits:4, endsemMax:70 },
    { name:'DSE/GE Elective 1', credits:4, endsemMax:70 },
    { name:'DSE/GE Elective 2', credits:4, endsemMax:70 },
    { name:'DSE/GE Elective 3', credits:4, endsemMax:70 },
    { name:'UG Dissertation Part 2', credits:6, endsemMax:70 },
  ],
};

// ─── INIT ─────────────────────────────────────────────────────────
function initTabsUI(){
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)));
  document.querySelectorAll('.menu-item').forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => activateTab(el.dataset.goto)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape'){ closeMobileMenu(); closeShareModal(); } });
  window.addEventListener('resize', () => { positionTabIndicator(); closeMobileMenu(); });
  window.addEventListener('load', positionTabIndicator);
  positionTabIndicator();
}
function initSemPills(){
  document.querySelectorAll('.sem-pill').forEach(btn => {
    btn.addEventListener('click', () => quickSetup(btn.dataset.sem));
  });
}

(function init(){
  initTheme();
  initTabsUI();
  initSemPills();

  let restored = false;
  const meta = getMetaState();
  const semsUsed = meta.semsUsed || [];

  // Legacy migration: v3 single-key storage → per-semester slots.
  try{
    const legacyRaw = localStorage.getItem('doon_calc_v3');
    if (legacyRaw && semsUsed.length === 0){
      const legacy = JSON.parse(legacyRaw);
      if (legacy.courses && legacy.courses.length > 0){
        activeSem = 1;
        courses = legacy.courses;
        courseIdCounter = legacy.courseIdCounter || courses.length;
        localStorage.setItem(SEM_KEY(1), JSON.stringify({ courses, courseIdCounter, globalHalved: legacy.globalHalved, savedAt: Date.now(), semNum: 1 }));
        localStorage.setItem(META_KEY, JSON.stringify({ activeSem:1, semsUsed:[1] }));
        pastSems = legacy.pastSems || [];
        pastSemIdCounter = legacy.pastSemIdCounter || 0;
        document.getElementById('prev-credits').value = legacy.prevCredits ?? '';
        document.getElementById('prev-points').value = legacy.prevPoints ?? '';
        document.getElementById('cur-credits-plan').value = legacy.curCreditsPlan ?? 22;
        document.getElementById('target-cgpa').value = legacy.targetCgpa ?? '8.00';
        localStorage.removeItem('doon_calc_v3');
        restored = true;
      }
    }
  } catch(e){}

  if (!restored && semsUsed.length > 0){
    const semToLoad = meta.activeSem || semsUsed[0];
    activeSem = semToLoad;
    loadSemSlot(semToLoad);
    loadPlannerSlot();
    restored = true;
  }

  if (restored){
    document.getElementById('onboarding-gate').style.display = 'none';
    document.getElementById('calc-guard').hidden = true;
    document.getElementById('calc-content').hidden = false;
    renderCourses();
    renderPastSems();
    renderSemSwitcher();
    updateSem1UI();
    updateSemPickerChrome();
    calcPlan();
    if (activeSem && activeSem > 1) autoFillPrevFromSavedSems(activeSem);
    setTimeout(() => flashSaveIndicator('data restored \u2713'), 300);
  } else {
    document.getElementById('cur-credits-plan').value = 22;
    document.getElementById('target-cgpa').value = '8.00';
    calcPlan();
    updateSemPickerChrome();
  }
})();

// ─── RETURN-FROM-GOOGLE-SIGN-IN ROUTING ──────────────────────────
// lbSignIn() (in leaderboard.js) tags its redirectTo with ?lbreturn=1
// specifically so that, after the OAuth round trip reloads this page,
// we land back on the Leaderboard tab instead of Overview — otherwise
// leaderboard.js never even loads and the returning session token in
// the URL never gets picked up. Preserved verbatim from the original.
(function restoreLeaderboardTabAfterSignIn(){
  const params = new URLSearchParams(window.location.search);
  if (params.get('lbreturn') !== '1') return;
  activateTab('leaderboard');
  params.delete('lbreturn');
  const newSearch = params.toString();
  history.replaceState(null, '', window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash);
})();
