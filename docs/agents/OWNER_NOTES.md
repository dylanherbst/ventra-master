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

### 2026-11-14 18:05 AWST — New frontend + backend build brief; both agents must read it (status: handled c-82af1724 — board fields, feature IDs and the G05 task (AMP-117) were added by c-6c238f0d; brief passed to every specialist this cycle; five state decisions stay on AMP-006)

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
- **Kickoff documents written by the owner's Cowork session (18:09 AWST, handed back, nothing reserved):**
  `docs/aimp/contracts/README.md` (what a contract must state; where each first-release feature's screen, module, tests
  and test route live today; the six first contracts to agree) and `docs/aimp/contracts/CANONICAL_STATES.md` (brief's
  states mapped to existing enums; **proposed**, five decisions open for `ventra-backend` + the frontend agent). Three
  shared skills added: `.claude/skills/amp-feature-contract/`, `amp-design-handoff/`, `amp-e2e/`, with a pointer in the
  AiMoneyPrinter `CLAUDE.md`. Documentation only; no file under `apps/web/**` was edited. Review them, settle the five
  state decisions, and have each new AMP task start with `amp-feature-contract`.
- **Gaps to plan as board tasks:** G05 scheduled management routines has no task; the brief's first acceptance run
  (two test stores, replayed Stripe test payment, exactly one delivery) folds into AMP-064/043.
- **Unchanged:** the model rule from the 16:40 note stays (Fable while available, then Sonnet) even though the brief
  says Sonnet; the AMP-015 reservation from the 17:36 note stays in force; owner approval rules are as before. Nothing
  in the brief authorises live payments, publishing, spend, deploys or migrations.

### 2026-11-14 18:10 AWST — Chief of Staff directive from Dylan: run the build brief through the board (status: handled c-82af1724 — all 68 feature IDs are on board tasks; first journey run on two test businesses verified locally (AMP-067, fixtures); Sonnet used for coding; Telegram is AMP-007; first report is this cycle's summary)

Dylan sent a written directive at 18:09. Full text, unedited: `docs/agents/briefs/AIMP_CHIEF_OF_STAFF_BRIEF_2026-11-14.md`.
Read it in full with the build brief (18:05 note). It is addressed to you as Chief of Staff. What it asks, in order:

1. **Tracker (Build Steps, AiMoneyPrinter).** Map all 68 brief feature IDs (A01-I12) onto the existing AMP backlog.
   Preserve task ids, progress, evidence and release priorities. Where applicable split each feature into frontend,
   backend and verification tasks, each with an owner, dependencies, acceptance criteria and an evidence link. A
   first-pass map is in `docs/agents/AIMP_FEATURE_MAP.json` (feature -> existing AMP tasks) and
   `~/Developer/AIMONEYPRINTER/docs/aimp/FEATURE_CHECKLIST.md`; correct it, then record `featureIds` on every task.
   Verify each capability in code before giving it a status. Keep tasks scoped to the AiMoneyPrinter project and use
   the existing concurrency settings to run independent frontend and backend tasks in parallel.
2. **One contract for both agents.** Per feature: route and Figma frame, actor and permissions, request/response shapes,
   customer-visible states, events, fixtures, acceptance scenario, kept beside the code. Starting points already in the
   repo: `docs/aimp/contracts/README.md`, `docs/aimp/contracts/CANONICAL_STATES.md` (five decisions open) and the skills
   `amp-feature-contract`, `amp-design-handoff`, `amp-e2e`. First six contracts are listed in the contracts README.
3. **First complete customer journey**, two separate test businesses: sign-in and intake -> five ranked ideas -> choose one
   -> offer, brand, downloadable product, storefront, organic campaign draft -> test storefront live -> Stripe **test**
   checkout -> correct file delivered -> owner sees order and delivery status. Verify: interrupted build resumes; repeated
   payment event delivers once; pending or unpaid orders cannot download; expired links have a recovery path; one business
   cannot reach the other's data or files; campaign export stays usable while provider authorisation is pending.
   Then continue through the backlog. Marketing is tracked as separate buildable tasks: research, positioning, content,
   SEO, local discovery, lead capture, consent and opt-outs, follow-up, attribution, experiments, paid campaign readiness
   and spend controls.
4. **Needs Dylan.** When a task needs his login, credentials, provider approval, DNS change, authorised spend or a
   decision, mark it **Needs Dylan** in Build Steps with: feature ID, the exact action, where to take it, what it unlocks,
   and the next task you started. Keep building the highest-priority unblocked work on fixtures or test mode; live
   verification stays pending.
5. **Telegram.** If the Chief of Staff Telegram connection is still failing, track it as a separate internal task:
   capture the failure, verify a real round trip when it works, keep the product queue moving meanwhile.
6. **Reviewable tracker.** Each completed task records feature ID, changed code or commit, local route, acceptance steps,
   result and evidence level (Local, Provider Test, Live). Each open blocker links to the exact step it affects.
7. **First report** (next cycle summary): repo and worktree found, first tasks assigned, and the first customer flow
   Dylan can open locally (the preview is up on `http://127.0.0.1:3040`; `/start` is the entry flow).

- **Model:** this directive says **Sonnet for coding and test code**. It is later than the 16:40 "Fable while
  available" rule, so use Sonnet for coding and test subagents from now on unless Dylan says otherwise (the Cowork
  session has asked him to confirm). Record the model on each task as before.
- **Still in force:** AMP-015 path reservation (17:36 note); one writer at a time; owner approval for merges, deploys,
  production migrations, env vars, live payments, publishing, customer messages and spend. Nothing here authorises any
  live action.
- **Small owner-requested edit (18:15 AWST):** `apps/web/app/start/account/account-form.tsx` gained one secondary button,
  "Continue without an account" (goes to `/start/tour`, same as the existing header Skip). Checked in the browser on
  127.0.0.1:3040; tests not re-run. Keep it when AMP-014/015 are reviewed.

### 2026-11-14 18:22 AWST — AI Setter and organic lead-gen agents must be on the feature list (status: handled c-82af1724 — planned as AMP-121 (S01), AMP-122 (S02), AMP-123 (S03), AMP-124 (S04), AMP-125 (S07), tier Next; S05 on AMP-051, S06 on AMP-114; plan details checked in code (AMP-126) and attached to tasks)

Dylan (18:19): "we also need our AI Setter / organic lead gen agent ... make sure you have all features on the list".
The Cowork session re-read the Master Business Plan in full. Result and requests:
- All 68 plan feature IDs are on the checklist; none missing by ID.
- The sales and lead-gen agents from the brief's agent maps (section 4) have no board task of their own. They are now
  listed as S01-S08 in `~/Developer/AIMONEYPRINTER/docs/aimp/FEATURE_CHECKLIST.md` ("Sales and lead-generation agents").
  Plan board tasks for them, with frontend, backend and verification parts: **S01 AI Setter** (split from AMP-114; reuse
  the VENTRA Setter in `apps/web/lib/front-office/` after verifying it in code), **S02 Organic Lead Gen Agent**
  (business finder, lead scorer, website auditor, email writer, lead log), **S03 Inbox Agent**, **S04 Leads and Booking
  workspace**, **S07 business knowledge base**. S05 folds into AMP-051, S06 stays in AMP-114, S08 Voice Receptionist
  stays deferred (plan section 15.1).
- Plan limits apply: no unrestricted cold outbound, no mass unsolicited DMs, recorded consent before follow-up, Spam Act.
  Outreach only through supported, permissioned channels; nothing is sent live without owner approval.
- Release tier for S01/S02 is Dylan's decision (plan says P1); until he answers, plan them as "Next" and do not delay the
  first customer journey.
- The same checklist has "Plan details not found on any board task" (Google/Apple sign-in and password reset, trademark
  screening, spreadsheet/image exports, publish smoke test, abandoned-checkout follow-up, coupons and quantities, daily
  summaries, manual expenses). Confirm each against the code and add it to the right task's acceptance criteria.

### 2026-11-14 18:31 AWST — New agent `aimp-website` for AiMoneyPrinter's own public site (status: handled c-82af1724 — AMP-065 assigned to aimp-website and split into AMP-068 to AMP-073; AMP-068 audit done; copy decisions are AMP-068-D)

Dylan asked for another agent to work on the website, and chose **AiMoneyPrinter's own site** (not customer storefronts,
not the archived VENTRA site).
- Agent definition: `.claude/agents/aimp-website.md` in this repository (so cycles can dispatch it) and the same in
  `~/Developer/AIMONEYPRINTER/.claude/agents/`. Model: Sonnet. It owns `apps/web/app/plant-lab/**`,
  `apps/web/lib/aimp/plant/**`, `apps/web/lib/aimp/site-config.ts`, `apps/web/public/plant/**`, `assets-src/plant/**` and
  tests `aimp-plant-*` / `aimp-website-*` in the AiMoneyPrinter repo. No other agent edits those paths; it does not edit
  `app/start/**`, `app/s/**`, `app/site/**` or the glass library.
- **Assign AMP-065** (public landing page, demonstration store, pilot onboarding, policy drafts, measurement plan) to
  `aimp-website`, and split it into tasks it can finish one at a time. Suggested order: (1) audit `/plant-lab` and
  `/plant-lab/build` against `docs/aimp/reference/text/Website_CTA_Strategy.txt` and the brief's public-site screen list,
  with a gap list; (2) carry the visitor's preview into `/start` sign-up; (3) how it works, examples, pricing and plan
  comparison, FAQ, contact, privacy and terms; (4) measurement events and the first headline A/B test; (5) real-device
  iPhone Safari and Lighthouse checks; (6) homepage integration, which needs Dylan's approval. It can run in parallel with
  app and backend tasks because its paths are separate.
- Nothing is deployed and `/plant-lab` stays noindex until Dylan approves. Claims rules: no guaranteed earnings, no
  invented testimonials or urgency; draft pricing labelled as draft; brand name only from `site-config.ts`.
- Also done by the Cowork session: the coordinator-side agent files `ventra-frontend`, `ventra-backend`,
  `ventra-web-design`, `ventra-feature` and `ventra-qa` in this repository had no AiMoneyPrinter section; a short one was
  appended pointing to the brief, contracts, checklist and the three AMP skill files in the AiMoneyPrinter repo.


### 2026-11-14 20:14 AWST — New page-by-page build specification for frontend and backend agents (status: handled c-82af1724 — given to every specialist this cycle as the page-level reference, with the four rules (keep repo routes, checklist wins on release labels, canonical-state decisions stay open, no approval skipped))

Dylan uploaded a new 48-page doc, "Page-by-page build specification", and asked for it to go to the front-end and
back-end agents to build the app. It elaborates the existing Frontend + Backend Build Brief down to 43 screen
groups / 115 feature implementations, using the same 68 feature IDs (A01-I12) already on `FEATURE_CHECKLIST.md`.
Saved into the AiMoneyPrinter repo (Cowork session, not yet committed by the owner per AMP-005-D):
- PDF: `docs/aimp/reference/AiMoneyPrinter_Page_By_Page_Build_Specification.pdf`
- Markdown (one section per screen, same structure as the brief's text files): `docs/aimp/reference/text/Page_By_Page_Build_Specification.md`
- `CLAUDE.md`'s AiMoneyPrinter section now points at it alongside the original brief.

What it adds beyond the existing brief: for each of the 43 screens — route path(s), a proposed release label
(First release / Next / Expansion, sometimes split by sub-feature), the primary action, a "what's on the
screen / purpose / how to build it" table, and a states-and-acceptance line. Page 4 is a shared "implementation
contract" (tenant/identity, read-write contracts, durable jobs, money/delivery, model boundaries, mobile/
accessibility, integration verification) that applies across every screen. Page 48 lists the same provider
choices already in the brief (Supabase, Stripe Connect/Checkout/Billing, Trigger.dev as fallback, Pinterest/Meta/
TikTok/Search Console, Resend, Twilio Voice, Figma MCP, Playwright).

**For the coordinator to give `ventra-frontend`, `ventra-backend` (and `aimp-website` where its paths overlap):**
treat this as the page-level spec to build each screen against, but the doc itself says its route paths, release
ordering and provider picks are *proposed, not finalised* — the engineering team (i.e. the coordinator/agents)
confirm them against the active repo. Concretely:
1. Where a screen's route here already exists in the repo under a different path, keep the repo's route and flag
   the mismatch rather than renaming a shipped route.
2. Where its release label conflicts with `FEATURE_CHECKLIST.md` / `AIMP_BOARD.json` (e.g. this doc marks CRM and
   the unified inbox "Next" while a brief ID might already be scheduled differently), `FEATURE_CHECKLIST.md` wins
   unless Dylan says otherwise.
3. The shared implementation contract (page 4 of the spec) should be read alongside `docs/aimp/contracts/README.md`
   and `CANONICAL_STATES.md` — it does not override the 5 open canonical-state decisions already flagged there.
4. Nothing here authorises skipping owner approval for merges, deploys, production migrations, env vars, live
   payments, publishing, customer messages or spend — same standing rule as before.

No app code was changed by this Cowork session for this request; this is the kickoff doc only, same as the brief
and contracts were. Next coordinator cycle should pick this up as the primary reference for any screen it assigns.


### 2026-11-14 20:37 AWST — Priority: finish the after-launch front and backend (owner workspace, screens 10-43) (status: new)

Dylan (20:37): "now we need to finish the after launch front and backend." Context: the Cowork session just proved the
Welcome -> Account -> Goals -> Ideas -> Brand -> Products -> Catalogue -> Store funnel (screens 01-09 of the new
page-by-page spec) works end to end on a phone, including a one-click demo-data button (see below). He now wants the
rest of the product built: everything AFTER a business is launched -- the owner's actual workspace.

**What "after launch" means, mapped to `docs/aimp/reference/text/Page_By_Page_Build_Specification.md`:** screens 10-43
(`/app/[business]` Business Overview onward) -- owner home/brand/products (10-15), website/checkout/delivery owner
side (16-20; the *public* storefront/checkout/downloads, 21-24, are already implemented per `FEATURE_CHECKLIST.md`
AMP-030/031/032/034/040/041/042/045 -- confirm those still pass before rebuilding any of it), growth and customer
communication (25-33), automation/reporting/account management (34-42), and the internal operations console (43).

**Give `ventra-frontend`/`ventra-backend` this as the next priority, in this order unless FEATURE_CHECKLIST.md's
release tiers say otherwise:**
1. Business Overview (`/app/[business]`, screen 10) -- the owner's single "what's next" screen. This is the one
   screen that does not exist in ANY form yet (not even as a `/tools/*` test page under the new glass data model),
   so it needs both the read model (aggregate orders/visits/launch-progress from the existing `lib/aimp/*` services)
   and the glass-UI page.
2. Brand kit, Products and bundles, Product editor (11-13) -- port the logic that already works at
   `/start/brand`, `/start/products`, `/start/catalogue` (see `app/start/actions.ts`: `brandAction`, `productsAction`,
   `catalogueAction`) into permanent `/app/[business]/*` pages that work on an existing business, not just during
   the once-through setup journey. Reuse those actions/services -- do not re-implement brand/product/catalogue logic.
3. Owner side of website/checkout/delivery (16-20): Website Studio editing after launch, domains, seller
   payments/payouts, the orders and fulfilment queue, order detail. Backend services for checkout/orders/fulfilment
   are already built (AMP-041/042/045) -- confirm and wire the owner-facing pages to them.
4. Then growth/communication (25-33) and automation/reporting/account management (34-42) per their release labels
   in the spec (several are "Next" or "Expansion", not first release -- do not front-run those ahead of 1-3).
5. Internal operations console (43) last; it is explicitly staff-only and lowest urgency for Dylan's own testing.

**Also note for the coordinator, so it is not surprised by drift in the repo:** this Cowork session made one small
direct edit outside the board tonight, for Dylan's own phone testing, not part of any AMP task:
- `apps/web/app/start/account/account-form.tsx`: email/password fields now default to demo values
  (`demo@example.com` / `PreviewDemo2026!`) instead of blank, so the form can be submitted with no typing. Cosmetic
  only; does not change validation or the auth endpoint.
- New `apps/web/app/start/demo-fast-forward.tsx` (`DemoFastForwardHeader`) and a new exported
  `demoFastForwardAction()` in `apps/web/app/start/actions.ts`: a "Demo dashboard ->" button in the top right of
  `/start` (Welcome) that runs the SAME brandAction/productsAction/catalogueAction/storeAction calls as the real
  steps, with one fixed fixture idea and `defaultInputs()`, then redirects to `/start/store`. Dev/demo convenience
  only (gated by the same `AIMP_TOOLS_ENABLED`/`availability()` check as the rest of the journey) -- not a page from
  the build spec, and should stay out of the FEATURE_CHECKLIST tracker. Typechecked clean (`npx tsc --noEmit`)
  before this note; not re-verified by Playwright. Remove or keep at the coordinator's discretion once a real
  Business Overview exists to demo instead.

Standing rules unchanged: owner approval still required for merges, deploys, migrations, env vars, live payments,
publishing, customer messages and spend.
