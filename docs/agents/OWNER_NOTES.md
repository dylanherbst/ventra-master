# Owner notes

Dated notes from Dylan for the Master Coordinator. The coordinator reads this every cycle, turns each new note into
board tasks or decisions, then marks the note `handled <run id>` in place. Never delete notes.

## Owner notes for the coordinator

### 2026-11-10 07:35 AWST — P0: AI Setter + AI Receptionist launch playground (status: handled c-90917b1a — planned as A-22, A-23 (server) + A-23b (UI), A-24..A-28; A-9 priority raised)

Full brief: `docs/agents/briefs/FRONT_OFFICE_LAUNCH_BRIEF_2026-11-10.md`. It **refines** Workstream A, it does not
replace it: keep A-0…A-21, their ids and their commits. Workstreams B (owner UI), C (marketing) and D (website) carry
on unchanged; A goes first whenever budget is tight.

**What already exists (reuse, do not rebuild):** Setter Lab and Receptionist Lab (A-3, A-4) on the real pipelines
with a scripted model; contracts (A-1); modes + approval queue (A-2, A-21); Setter actions through decide()/gate()
(A-8); quote capture (A-19); fo_connections (A-15); mode check in live routes (A-17); Anthropic client with streaming
(`lib/front-office/llm.ts`, key + FRONT_OFFICE_MODEL already set in apps/web/.env.local); Vapi custom-LLM endpoint
(`lib/front-office/vapi-route.ts`); Google Calendar client (credentials set in .env.local).

**The gap this note closes:** the labs only run the SCRIPTED model, so the owner cannot yet see genuine AI replies or
talk to the Receptionist. Plan these as new board tasks (ids are suggestions; one owner, <60 min each, no overlapping
scope), in this order:

1. **A-22 (ventra-research, read-only, one cycle max):** `docs/agents/FRONT_OFFICE_RESEARCH.md` with the ten
   sections in the brief. Must compare at least: (a) keep **Vapi** — its Web SDK gives browser calls against our
   existing custom-LLM endpoint, so browser and phone share one pipeline; (b) **Twilio ConversationRelay / Media
   Streams + our own STT→Claude→TTS** (e.g. Deepgram + ElevenLabs); (c) **OpenAI Realtime or LiveKit Agents + SIP**
   speech-to-speech. AUD costs per minute, AU number availability, latency, recording-consent rules (WA and other
   states), Meta 24-hour window / message tags / comment private replies. Coordinator writes the file. Never blocks 2–6.
2. **A-23 (ventra-feature + ventra-voice split by scope): Setter Lab "Live AI Test" mode.** Same Setter agent, real
   Anthropic model, side effects sandboxed (lab workspace, nothing sent to any customer). Show per-turn tokens,
   latency and estimated AUD cost; enforce a server-side lab spending cap (new env FRONT_OFFICE_LAB_DAILY_CAP_AUD,
   default 5). Demo mode stays scripted. Connected mode shown disabled with the reason until A-11 passes.
   **The owner authorises real model calls from the labs within that cap** — this is the approval for it.
   Check: the lab must never honour FRONT_OFFICE_SEND_LIVE (it is set in .env.local).
3. **A-25 (ventra-backend): lab persistence.** Lab bookings, contacts and action log write to a dedicated sandbox
   workspace in local Supabase through the real booking/CRM services, so a lab booking can be verified in CRM;
   reset + save/reload scenarios. Depends on A-9 (one customer record) — pull A-9 forward.
4. **A-16 then A-24 (ventra-voice): knowledge base, then industry presets** Beauty (nails/lashes), Fitness (PT/coach),
   Trades (electrician/plumber/cleaner): services + prices, policies, qualification rules, booking types, example
   conversations; preset selector + knowledge editor in the Setter Lab.
5. **A-26 (ventra-voice): Receptionist browser voice — talk to it today.** Step 1, no new account: browser
   speech-to-text + speech synthesis (en-AU voice) driving the existing Receptionist turn endpoint in Live AI Test
   mode, with live transcript, tool actions, latency and post-call summary. Step 2 after A-22: swap in the chosen
   provider (Vapi Web SDK if research agrees) — needs the owner's key, so record it as needsApproval, keep step 1.
   Same knowledge, tools and booking pipeline as phone calls.
6. **A-27 (ventra-feature): `/tools/front-office-lab`** overview linking both labs, current mode + usage, and a
   cross-channel check: a contact qualified in the Setter Lab is recognised in the Receptionist Lab (after identity
   check, A-20).
7. **A-28 (ventra-qa): scenario suites** from the brief (12 Setter, 13 Receptionist) plus prompt injection,
   unauthorised tool calls and cross-tenant access; each records inputs, outputs, tool calls, DB state, latency,
   cost, pass/fail; runs in Demo mode in CI and in Live AI mode on demand.

**Frontend:** labs stay under `apps/web/app/tools/**` owned by feature/voice. They may *import* the existing glass
components read-only. After A-23 and A-26 are verified, you may dispatch `ventra-frontend` for one task limited to
styling `apps/web/app/tools/{setter-lab,receptionist-lab,front-office-lab}/**` — that is the owner's written OK for
that task only; it never touches approved layouts.

**Still needs the owner (do not do):** buying numbers, Vapi/Twilio/ElevenLabs subscriptions, Meta app review
submission, live sending, pushes, production deploys, raising the daily cap. Record these as needsApproval.

**Milestones that define done for this note:** (1) owner types a customer message in the Setter Lab, gets a genuine
AI reply, sees the lead qualify and a test booking verified in CRM; (2) owner speaks into the Receptionist Lab, hears
the AI, books an appointment, and a real test booking + call record exist.

**Report:** the next cycle summary covers the brief's "Required report" list (reused code, assignments, research,
implemented, interactive tests, lab URLs, routes/contracts, commits, blockers, keys/approvals, next tasks).

### 2026-11-13 20:55 AWST — VENTRA archived; AiMoneyPrinter only (status: handled c-aa359f36)

Owner decision: **VENTRA is archived. Work only on Workstream E (AiMoneyPrinter).**
- Workstreams A (Setter/Receptionist), B (owner UI), C (marketing) and D (website & store) are paused. Do not dispatch
  any A-, W-, M- or other VENTRA task. Move every queued/running VENTRA task on `TASK_BOARD.json` and
  `WEBSITE_BOARD.json` to `deferred` with note "VENTRA archived 2026-11-13" (keep ids, commits and evidence).
- All task slots and the whole daily budget go to `AIMP_BOARD.json`. Keep every AMP coding job on Sonnet.
- **AMP-001-D is resolved:** `~/Developer/AIMONEYPRINTER` is now its own git repository (normal `.git` directory,
  branch `aimp/foundation`, commit 8ce30e5 "AiMoneyPrinter becomes its own repository" contains all work that was
  held uncommitted, including AMP-003/012/030). It is no longer a VENTRA-CLEAN worktree. Mark AMP-001-D done, let
  git/ventra-git run there again, and commit AMP work inside that repo (`ventra-git` from that directory;
  `VENTRA_REPO=~/Developer/AIMONEYPRINTER ventra-verify` for checks). It has no remote yet (GitHub token pending).
- Do not edit `~/Developer/VENTRA-CLEAN` or its worktree list. Full VENTRA backup:
  `~/Backups/ventra/ventra-archive-2026-11-13.bundle`.

### 2026-11-14 16:40 AWST — New reference files; two tasks taken by the owner's Cowork session; model rule (status: handled c-d90206df — reference files passed to specialists; AMP coding dispatched on Fable; reservations superseded by the 17:35 and 17:36 notes)

- **New source documents** from Dylan are in `~/Developer/AIMONEYPRINTER/docs/aimp/reference/` (Business Plan v2,
  Business Builder Architecture, Website CTA Strategy, Peach & Lavender Glass UI Library + Claude guide, Sales/Voice
  operating-backbone diagram, plant animation brief; `text/` has plain-text extractions). Treat them as the product
  reference for every AMP task from now on.
- **Do not dispatch these two; the owner's Cowork session is building them right now in the AiMoneyPrinter repo:**
  1. **AMP-042** (fulfilment, delivery, reissue, order history, basic refund/support) — scope
     `apps/web/lib/aimp/fulfilment/**`, `apps/web/app/api/aimp/fulfilment/**`, `apps/web/app/tools/aimp-fulfilment/**`,
     `apps/web/test/aimp-fulfilment-*.test.ts`, `apps/web/test/aimp-release-*.test.ts`.
  2. **New task (give it the next free id, e.g. AMP-014): Peach & Lavender Glass UI library and app onboarding
     screens** — scope `apps/web/app/design-system/aimp-glass/**`, `apps/web/app/tools/aimp-glass/**`,
     `apps/web/app/start/**`, `apps/web/test/aimp-glass-*.test.ts`. All later AMP UI work (AMP-062 merchant dashboard,
     AMP-065 landing) must use this library, not the VENTRA teal glass.
  Keep other AMP tasks moving, but stay out of those paths until this note is marked handled by a later note.
- **Model rule changed by Dylan:** AiMoneyPrinter coding jobs use **Fable while it is available on the plan**; when
  Fable is rate-limited or its allowance runs out, fall back to **Sonnet** (record the model used on each task, as
  before). This replaces "every coding job runs on Sonnet".

### 2026-11-14 17:35 AWST — AMP-042 and AMP-014 handed back (status: handled c-d90206df — AMP-042 sent to ventra-review and coordinator checks; AMP-014 review deferred while AMP-015 edits the same paths)

The owner's Cowork session finished both tasks reserved in the 16:40 note; the paths are free again. Both are
`implemented` on the board with Local evidence and file lists in their notes, uncommitted. Review + QA them, then
commit with the rest of the held work once AMP-005-D clears. New AMP UI tasks (AMP-062, AMP-065) must build on
`apps/web/app/design-system/aimp-glass/`.

### 2026-11-14 17:36 AWST — AMP-015 reserved by the owner's Cowork session (status: handled c-d90206df — reservation respected: nothing dispatched into app/start, design-system/aimp-glass or test/aimp-glass-*; stays in force until a later note hands the paths back)

Dylan wants the whole app after sign-in to use the same glass UI as `/start`. The Cowork session's frontend agent is
building **AMP-015** now: guided-setup pages under `apps/web/app/start/**` (ideas, selection, brand, products, review,
catalogue, publish, seller readiness) on `apps/web/app/design-system/aimp-glass/**`. **Do not dispatch any task that
edits `apps/web/app/start/**`, `apps/web/app/design-system/aimp-glass/**` or `apps/web/test/aimp-glass-*` until a later
note hands them back** (this partly overrides the 17:35 note). Reviewing AMP-014 read-only is fine. Backend and feature
work in `lib/aimp/**` continues as normal; do not change the function signatures the `/tools` pages use without
recording it in HANDOFF.md.

### 2026-11-14 18:05 AWST — New frontend + backend build brief; both agents must read it (status: new)

Dylan added **`~/Developer/AIMONEYPRINTER/docs/aimp/reference/AiMoneyPrinter_Frontend_Backend_Build_Brief.pdf`**
(21 pages; plain text at `docs/aimp/reference/text/Frontend_Backend_Build_Brief.txt`). It is now part of the product
reference for every AMP task.
- **Frontend agents (`ventra-frontend`, `ventra-web-design`) and `ventra-backend` read it before their next AMP task.**
  Their agent files in the AiMoneyPrinter repo already point to it. Frontend: sections 1-6. Backend: section 7. Both:
  sections 8 (shared contracts, canonical states, build order) and 9 (tools, shared skills). Pass it to
  `ventra-feature`, `ventra-qa` and `ventra-review` as reference too.
- **Feature checklist:** `docs/aimp/FEATURE_CHECKLIST.md` lists the brief's 68 features (A01-I12) with release tier and a
  first-pass mapping to AMP tasks. Correct the mapping where it is wrong and keep the states current.
- **Board fields (brief section 7):** add to each AMP item: frontend owner, backend owner, contract link, fixture, test
  route, dependencies, required evidence level, current blocker. Tag each task with its feature IDs.
- **Gaps to plan as board tasks (suggestions, not dispatched):** G05 scheduled management routines has no task; the
  three shared skills (`amp-feature-contract`, `amp-design-handoff`, `amp-e2e`); agreeing the canonical states; the
  brief's first acceptance run (two test stores, replayed Stripe test payment, exactly one delivery) folds into AMP-064/043.
- **Unchanged:** the model rule from the 16:40 note stays (Fable while available, then Sonnet) even though the brief
  says Sonnet; the AMP-015 reservation from the 17:36 note stays in force; owner approval rules are as before. Nothing
  in the brief authorises live payments, publishing, spend, deploys or migrations.
