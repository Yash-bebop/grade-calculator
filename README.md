# Doon Grade Calculator

**A what-if simulator for end-semester exam planning — built for CSE students at Doon University.**

→ **[Try the live app](https://yash-bebop.github.io/grade-calculator/)**

---

## The one-line pitch

You've scored 14/20 in internals and 22/30 in midsem. You want an A. The app tells you exactly what you need in the end-sem paper — across all 6 courses, instantly, with Doon's actual marking formula baked in.

---

## Why this exists

Doon's NEP 2020 marking scheme is non-trivial. Midsem marks are halved in most courses. End-sem is out of 50 or 70 depending on practicals. Teacher-awarded marks apply when midsem wasn't held. Students were doing this calculation in WhatsApp chats and getting it wrong.

The university portal shows past results. Generic calculators don't know Doon's credit structure. There was nothing in between.

---

## What it does

- Preloads the exact course list for each of Doon CSE's 8 semesters
- Models all three marking schemes used at Doon (midsem halved / full / teacher-awarded)
- Live threshold table: what end-sem score gets you B+, A, A+, or O in each course
- Cumulative CGPA tracking across semesters, auto-filled from saved data
- Shareable result card — 1080×1920 image sized for WhatsApp status
- Full data export/import — your marks never leave your browser, but you can back them up

No install. No login. No server. One HTML file.

---

## This repo as a PM portfolio

This project is documented as a product case — not just a codebase.

| Document | What it covers |
|---|---|
| [`PRD.md`](./PRD.md) | Problem framing, user personas, feature prioritisation, success metrics, what was cut and why |
| [`CASE_STUDY.md`](./CASE_STUDY.md) | Six-version iteration arc, critique triage, UVP analysis, honest retrospective |

The most PM-relevant part of this project isn't the app — it's the decision to openly question whether the problem it solves is large enough to be a product. That conversation is documented in the case study.

---

## Iteration history

| Version | What actually changed |
|---|---|
| **v1** | Core calculator — single semester, manual course entry, grade formula, basic SGPA display |
| **v2** | Full UI overhaul from critique: collapsible course cards, threshold chip badges, division badges on hero stats, slider tick marks, empty state CTA, font switch Manrope → Inter, focus states, personal data removed from demo button |
| **v3** | localStorage persistence added (`saveState`, `restoreState`, `debouncedSave`), `copySummary` clipboard export, `showToast` feedback system — first version a student could close and reopen without losing their marks |
| **v4** | Multi-semester architecture: per-sem localStorage slots (`SEM_KEY`), semester switcher bar, onboarding flow (pick your semester), `quickSetup` from hardcoded course list, `loadSemSlot` / `loadPlannerSlot` separation |
| **v5** | Surgical card re-render (`rebuildCourseBody`) to preserve expanded state on field change — previously any mark change collapsed all cards |
| **v5.4** | Cross-semester CGPA auto-fill (`autoFillPrevFromSavedSems`), partial midsem / teacher-awarded marks support, stress-test mode (later removed), SGPA ribbon on sem switcher pills |
| **v5.5** | Sem 1 UI cleanup (`updateSem1UI`) — hides CGPA card and previous semester section when meaningless; midsem max selector UX clarification |
| **v6** | Security pass: XSS fix via `escapeHtml()`, validation wired to all numeric inputs, `contenteditable` → `<input>`. Reliability: JSON export/import backup. Distribution: share card (canvas, 1080×1920). Stress-test mode removed. |

---

## Tech

Single HTML file. Vanilla JS. No framework, no build step, no dependencies beyond two Google Fonts. Intentional — the distribution channel is a WhatsApp link, not an app store.

---

*B.Tech CSE Year 1 · Doon University, Dehradun · Built by Yashvardhan Dobhal*
