# Product Requirements Document
## Doon University Grade Calculator

**Author:** Yashvardhan Dobhal
**Status:** v6.0 Shipped
**Last updated:** June 2026

---

## 1. Problem Statement

### Background

Doon University's CSE department runs on NEP 2020 evaluation structure. Every course has three mark components — Internal (out of 20), Mid-semester (out of 30, often halved), and End-semester (out of 50 or 70). These combine into a percentage that maps to a grade on a 10-point scale. SGPA and CGPA are computed from grade points weighted by credits.

The formula is deterministic and known. The problem is friction: students doing this calculation manually across 6–7 courses get it wrong, skip it, or rely on seniors who also approximate it.

### The specific moment this matters

End-semester exam week. A student has their internal and midsem scores. They need to know what to aim for in each paper. This decision affects how they allocate study time across subjects in the 5–7 days they have left.

They currently solve this by:
- Asking in WhatsApp groups (slow, often wrong)
- Using a generic SGPA calculator (doesn't know Doon's weights)
- Manually computing in a notes app (error-prone, not repeatable)
- Asking an LLM (has to re-explain marks every time, no persistent state)

### What the university portal does not solve

The portal is backwards-looking. It shows finalised results after grading is complete. It cannot simulate forward from partial marks. It cannot answer "what do I need" — only "what did I get."

---

## 2. Goals and Non-Goals

### Goals

- Let a Doon CSE student answer "what do I need in each end-sem paper to hit [target grade]?" in under 60 seconds from first open
- Model all three marking schemes used across Doon CSE courses accurately
- Persist data across sessions without requiring an account
- Work on a mobile browser with no install step
- Be shareable via a single link

### Non-Goals

- Supporting other universities or departments (specificity is the product's only defensible advantage)
- Replacing the university portal (this tool is forward-looking; the portal is the source of truth for finalised results)
- Attendance tracking (source data from the university has known reliability issues — double-counted entries are common. A tracker built on unreliable data erodes trust in the whole product)
- Backend, accounts, or cloud sync (adds friction to onboarding and creates data privacy obligations not warranted by the problem)

---

## 3. Users

### Primary user

**CSE student at Doon University, Sem 1–8.**

Behaviour pattern: opens the app in the 1–2 weeks before end-semester exams. Has internal and midsem scores already announced. Wants to know what to study hardest for. Uses WhatsApp heavily for peer communication. Unlikely to download an app but will open a link shared in a group chat.

Devices: Android phone, primarily. May also use a laptop during study sessions.

Technical literacy: comfortable with web forms, sliders, number inputs. Does not need onboarding beyond knowing what the tool does.

### Secondary user

**The same student, recurring across 8 semesters.**

A student who finds the tool useful in Sem 2 may return in Sem 3, 4, and beyond if cumulative CGPA tracking is valuable to them. This user has more invested in the product — their multi-semester data is stored in it — and is at higher churn risk if data loss occurs.

### Non-user (explicitly)

Students from other departments or universities. The course list, credit structure, and marking weights are hardcoded to Doon CSE. Using it for a different institution produces wrong results.

---

## 4. User Stories

**Core (must have)**
- As a student, I want to enter my internal and midsem scores and see what end-sem score I need for each target grade, so I can plan my exam preparation.
- As a student, I want the course list for my semester pre-filled, so I don't have to look up subject names and credits.
- As a student, I want my marks saved when I close the browser, so I don't have to re-enter them next time.

**Important (should have)**
- As a student, I want to track CGPA across multiple semesters, so I can see whether I'm on track for Distinction.
- As a student, I want to share my result as an image, so I can post it in my batch group after results are announced.
- As a student, I want to export my data, so I don't lose a semester's worth of marks if I clear my browser.

**Deferred (won't have in v6)**
- As a student with a disability, I want the app to work with a screen reader. *(Deferred: zero ARIA attributes currently. Valid gap, not prioritised for v6 given the primary user base and timeline.)*
- As a student at a different institution, I want to configure my own grading scheme. *(Explicitly out of scope — see Non-Goals.)*

---

## 5. Feature Prioritisation

### P0 — Launch blocking

These were identified during a structured critique at v5.5 and fixed before v6 was considered shippable.

**XSS vulnerability in course name rendering**
Course names entered by the user were interpolated directly into `innerHTML` with no sanitisation. A course name containing `<img src=x onerror=alert(1)>` would execute on every page load, including after being persisted to localStorage. Fixed by routing all user-controlled strings through `escapeHtml()` before any innerHTML assignment.

*Why P0:* Any sharing or sync feature (which the product roadmap includes) would convert this from self-XSS to a real attack vector. It needed to be fixed before those features were built, not after.

**Validation logic defined but never wired**
`validateNumberInput()` existed in the codebase but was called nowhere. Typing 999 into an "Internal /20" field was accepted, producing totals like 1050/100 with no error. Fixed by wiring validation to every numeric `onchange` handler with correct bounds per field.

*Why P0:* The core value proposition is accurate grade prediction. A tool that silently produces wrong numbers when given out-of-range input is broken at its foundation.

**Data loss risk with no recovery path**
All data lived in localStorage with no export mechanism. Clearing browser data meant total, unrecoverable loss of potentially four years of mark history. Fixed by adding JSON export/import (download backup / restore from file).

*Why P0 despite being labelled P1 in the original critique:* This is a retention issue disguised as a reliability bug. A student who loses their data once does not come back. The cost of losing a user is higher than the cost of shipping a simple file download.

### P1 — Important, deferred

**`contenteditable` → `<input>` for course name editing**
The course name editor used a `contenteditable` div instead of a real input element. This broke mobile keyboard behaviour (no numeric keyboard, wrong input mode), screen reader field identification, and native paste/undo. Fixed in v6.

**Stress-test mode (removed)**
v5.4 added a toggle that set all end-sem scores to zero to show worst-case grades. Removed in v6.1. The scenario modelled (zero in every paper) doesn't reflect any realistic planning case. The feature added UI complexity and a confusion risk (easy to leave toggled on, changing every number on screen silently) without solving a real problem.

*This is the most instructive cut in the project: the feature was technically interesting and took real effort to build. Removing it required separating "this was fun to make" from "this solves a problem that exists."*

**Attendance tracker (rejected at proposal stage)**
Proposed, then rejected before any code was written. Doon's attendance system has known data quality issues — teachers sometimes enter double attendance entries, making the recorded percentage unreliable. A tracker built on a broken source of truth makes the whole app feel broken when the numbers don't match reality. Better to not build it.

### P2 — On the backlog

- Accessibility layer (ARIA attributes, screen reader support)
- Responsive type scale with `clamp()` for very small viewports
- Scroll-into-view when expanding a course card
- "Enter your actual final grade" reconciliation step at semester end

---

## 6. Success Metrics

This is a single-institution tool with no analytics instrumentation. These metrics are defined as a framework for how success *would* be measured if instrumentation were added — relevant for understanding what the product is optimising for.

**Activation:** Did the user complete onboarding (select a semester and add at least one course) in the same session they first opened the app? Target: >80%.

**Core action completion:** Did the user enter at least one end-sem slider value and view the threshold table? This is the moment the app delivers its core value. Target: >60% of activated users.

**Return usage:** Did the user open the app more than once in a semester? This is the weakest metric currently — the app has no hook that creates repeated use within a semester. Identified as the biggest product gap.

**Data persistence:** Did the user's data survive across sessions (i.e., did localStorage work and did they not clear their browser)? Proxy: did they return and find their courses pre-filled? Target: >90% of returning users.

**Share card generation:** Did the user generate and download a share card? This is the distribution mechanism — each card shared in a batch group is a potential new user acquisition.

---

## 7. Distribution Strategy

The target user doesn't search for tools — they receive links from people they trust. The realistic distribution channels, in order of likelihood:

1. **Batch WhatsApp groups** — a senior shares the link before end-sem, the whole batch opens it
2. **Hostel group chats** — a batchmate shares their result card, others ask "how did you make that?"
3. **Direct link sharing** — one student sends it to another who's asking the same calculation question

The share card feature is built specifically to accelerate channel 2. The no-install, single-link architecture is built for channel 1.

There is no SEO play, no app store, no paid acquisition. The tool either spreads peer-to-peer within Doon CSE or it doesn't spread.

---

## 8. Constraints

**Technical:** Single HTML file. No build tooling, no framework, no backend. This is a deliberate constraint — it keeps the distribution model (share a link, open immediately) intact.

**Scope:** Doon CSE only. The grading formula, course list, credit structure, and grade band definitions are all hardcoded. This is the right call for v6. It's also the ceiling on addressable market.

**Data:** localStorage only. No server means no cross-device sync, no backup without the user taking explicit action. Accepted consciously; mitigated by the export/import feature.

---

## 9. Open Questions

These are unresolved at v6 and would need answers before any hypothetical v7:

- Is there a retention hook that makes the app worth opening more than twice per semester? A "marks diary" pattern (log scores as they're announced, simulation sharpens over time) is the most promising candidate — untested.
- Would a second institution's marking scheme be worth supporting, or does that dilute the specificity that makes the tool trustworthy?
- If the university portal were to expose an API or provide structured mark data, would importing from it create more value than it costs in complexity?

---

*This PRD documents decisions made across v1–v6 of the Doon Grade Calculator. It is written retrospectively as a portfolio artefact but reflects the actual reasoning behind each shipped and unshipped feature. Live app: https://yash-bebop.github.io/grade-calculator/*
