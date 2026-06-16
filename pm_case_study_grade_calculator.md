# Doon University Grade Calculator
### PM Case Study — Yashvardhan Dobhal

---

## The Problem

In the weeks before end-semester exams, every CSE student at Doon University is doing the same mental arithmetic: *"I got 14/20 in internals and 22/30 in midsem — what do I need in the end-sem paper to get an A?"*

Doon's NEP 2020 marking scheme is non-trivial. Midsem marks are halved in most courses. End-sem is out of 50 or 70 depending on whether the course has practicals. Teacher-awarded marks apply when midsem wasn't held. The formula isn't hard, but doing it correctly across 6–7 courses simultaneously, under exam stress, is error-prone and time-consuming.

No existing tool solved this specifically. The university portal shows past results — it's backwards-looking. Generic SGPA calculators don't know Doon's credit structure or marking weights. Students were doing it in WhatsApp chats, asking seniors, or just guessing.

I was one of those students.

---

## What I Built

A single-file web app (no install, no login, no server) that:

- Preloads the exact course list and credit structure for each of Doon CSE's 8 semesters
- Models all three of Doon's marking schemes — midsem halved, midsem at full value, teacher-awarded marks
- Shows a live threshold table: what end-sem score you need in each course to hit B+, A, A+, or O
- Tracks SGPA across semesters and computes cumulative CGPA automatically from saved data
- Stores everything in the browser — no account, no data leaves the device

The app went through 6 iterations (v1 through v6) over several months, with each version responding to real usage friction and structured critique.

---

## How I Made Decisions

### Taking structured critique seriously

At v5.5, I commissioned a multi-perspective critique of the app across three lenses: Engineering, Design, and Product. The findings were blunt. The engineering review identified a persistent XSS vulnerability — course names were interpolated directly into `innerHTML` with no escaping, meaning a malicious string would execute on every page load. A validation function existed in the codebase but was never wired to any input. The design review found zero ARIA attributes across 2,855 lines of code. The product review noted the entire grading formula was hardcoded to one department with no configuration path.

I triaged these findings into P0 (launch-blocking) and P1 (important but deferrable):

- **Fixed immediately:** XSS via `escapeHtml()` across all three render paths, validation wired to every numeric field, `contenteditable` replaced with a proper `<input>` element, data export/import added as a backup mechanism.
- **Deferred:** Accessibility layer, responsive type scale, multi-institution configuration.

The triage was a deliberate product decision, not just engineering prioritisation. A data loss bug (localStorage only, no export) is a retention risk — a student who loses a semester of marks never comes back. That made export/import P0 despite being framed as a "P1 nice-to-have" in the original critique.

### Removing a feature based on reasoning, not sentiment

Version 5.4 included a "stress-test mode" that temporarily set all end-sem scores to zero to show worst-case grades. It was removed in v6.1.

The reasoning: the scenario it modelled — scoring zero in every end-sem paper — is not a realistic planning case for any student. The feature added UI complexity (a toggle that silently changed every number on screen), created a confusion risk (easy to leave on accidentally), and addressed a problem that doesn't actually arise. Removing it was straightforward once I stopped defending it on the grounds that it was technically interesting to build.

### Killing the UVP honestly

Late in the project I asked a hard question: *what is the unique value proposition here, really?*

The university portal already shows all past semester results. LLMs can do CGPA planning on demand. The threshold table exists in the app, but students could approximate it with a calculator. Working through this systematically, I concluded that the app's genuine differentiation is narrow: it's the only tool that combines Doon's exact marking formula, a student's live marks, and instant what-if simulation in one place with zero setup friction.

That's real but thin. It doesn't support a growth engine. The app is a well-built personal utility that is useful to batchmates — not a product with scalable demand. That conclusion is in the case study because reaching it is the point. A PM who can clearly articulate why their product's addressable market is limited is more credible than one who can only pitch upside.

---

## Key Decisions and Their Outcomes

| Decision | Alternatives Considered | Reasoning |
|---|---|---|
| Single HTML file, no backend | React app, hosted service | Zero friction to share — one link, no install, works offline. Distribution via WhatsApp link is the realistic channel for a university audience. |
| localStorage only (v1–v5) | Firebase, Supabase | No auth complexity, no data privacy concerns, works without internet. Accepted the data-loss risk consciously. |
| Added export/import in v6 | Cloud sync | Addresses data-loss risk without introducing a backend. Students can back up before clearing their browser. |
| Removed attendance tracker | Build it with error-correction | University portal has known data quality issues (double-counted entries). A tracker built on unreliable source data erodes trust in the whole app. Better to not build it. |
| Share card feature | Richer social features | WhatsApp status is the actual distribution channel in a hostel. A downloadable image card costs one canvas API call and creates a natural peer-to-peer spread mechanism. |
| Didn't build multi-institution config | Build it | Correctly scoped to one use case. Generic tools exist. Specificity is the only defensible advantage this app has. |

---

## What I'd Do Differently

**Validate demand before building.** I built v1 because I needed it. I didn't ask whether 50 other students needed it badly enough to change their behaviour. The right first step would have been to spend a week sharing a rough Google Sheet version in batchmate groups and watching whether people actually used it unprompted. If they did, build. If they opened it once and forgot, the signal is already there.

**Define the retention mechanism earlier.** The app has no reason to be opened more than once or twice per semester. Every product decision I made was about the first-use experience. I never asked "what brings someone back on week 6?" A marks diary — logging internal scores as they're announced so the simulation sharpens over time — would have created a repeated-use loop. I identified it too late.

**Separate the tool from the product question sooner.** The tool is good. The product question — is there a business or a growth engine here — is separate and I conflated them for too long. Useful tools and scalable products are different things. Knowing which you're building changes every decision downstream.

---

## Skills Demonstrated

- **Problem framing:** Identified a specific, personal friction point and scoped it tightly rather than building a generic calculator
- **Prioritisation under constraint:** Triaged a 8-point critique into P0/P1 with explicit reasoning for each call
- **Tradeoff articulation:** Every major decision has a documented alternative and a reason it was rejected
- **Intellectual honesty:** Reached and documented a conclusion that limited the product's own market potential
- **Iterative product thinking:** Six shipped versions, each responding to real friction — not a waterfall spec

---

*Built over ~6 months during B.Tech CSE Year 1, Doon University, Dehradun. Live app available on request.*
