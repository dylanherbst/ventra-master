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
