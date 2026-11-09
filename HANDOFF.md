# VENTRA handoff

Shared state between Claude Code and Codex. The assistant that stops updates this file; the one that starts reads it. Template and rules: `docs/agents/CODEX_HANDOFF.md`.

- **Updated:** 2026-11-09
- **Last editor:** claude
- **Repo:** /Users/dylan/Developer/VENTRA-FEATURES

## Current task (approved scope only)

Owner approved the pivot on 2026-11-06 (Ventra Pivot Master Plan + Implementation Tracker): build only the AI front office
(Setter, Sales, Receptionist) and freeze everything else in the backend. Branch `feature/front-office-pivot`, made from
`frontend/glass-dashboard-reference` at b611bed. Work done from a Cowork session (Claude, Linux VM on this Mac's folders).
Committed from the Cowork VM with plain git at the owner's request (ventra-git only runs on the Mac). Same secret scan as ventra-git: 0 hits. Only the files below were staged.

## Production (2026-11-07, owner approved hosting)

- Live: https://www.aiventra.com.au (Vercel team `ventra14`, project `ventra`, Pro trial; GoDaddy DNS A @ 216.198.79.1,
  CNAME www to Vercel). Deployed by the owner with `vercel --prod` from `apps/web` (`.vercelignore` keeps uploads small).
- DB: Supabase "Ventra AI" (ref `radmzhrdgqooukzhtdgg`), all 27 migrations applied via the SQL editor. Auth Site URL
  https://www.aiventra.com.au/workspace. Google OAuth app published.
- Vercel env present: see `docs/agents/OWNER_TODO.md` > Production status. Four secrets were saved as Config and need
  re-saving as Secret. Claude Console balance is A$0 (Setter cannot answer until funded).
- Added on `feature/ventra-website` (not deployed until the owner redeploys): Vercel Cron for the job runner (`vercel.json`,
  GET + `CRON_SECRET`), the runner now covers every configured channel (SMS, chat, email), `docs/agents/sql/create_channels.sql`
  for the owner to create channels, a "person can step in" line on the site chat, and the Sales agent foundation
  (`lib/front-office/sales/`, not wired live).

## AI front office for gyms + AI Receptionist (2026-11-08, owner decisions)

Owner decided: the Setter and Receptionist are a product for gym clients, tested on Ventra first; voice through Vapi (its
Custom LLM is an HTTP endpoint that works on Vercel; Retell's needs a WebSocket server); the Receptionist answers FAQs,
books/moves/cancels, qualifies new callers, transfers or takes messages. On `feature/ventra-website`, not deployed:

- Migration `202611080001_front_office_receptionist.sql`: `fo_agent_settings` (owner-only `fo_get/save_agent_settings`
  with a revision check, `fo_channel_settings` for webhooks), `fo_calls` + `fo_voice_turn/contact/reply/outcome/end`,
  `fo_reschedule`, `fo_cancel_booking`, event kinds call/booking/message. Not yet applied to production.
- `lib/front-office/settings.ts` + `templates/gym.ts` (gym FAQs and hours deliberately empty) + `templates/ventra.ts`.
  Chat, SMS, email, Meta and the job runner load each channel's business settings (fallback: Ventra's own config).
- `/tools/front-office-settings` + `GET/POST /api/front-office/settings` (owners).
- `lib/front-office/receptionist/` (prompt `receptionist/voice@1`, tools, streamed turns), `lib/front-office/vapi.ts`
  (request/event parsing, chunk format, doc URLs), `lib/front-office/vapi-route.ts`, routes under
  `/api/front-office/voice/vapi/` (env channel) and `/api/front-office/voice/vapi/<channel id>/` (one per business).
  Auth: the voice channel key as Vapi's Bearer token. Answers only with `FRONT_OFFICE_VOICE_LIVE=1` + saved settings with
  Receptionist and phone switched on; otherwise an honest "not switched on" line, a call-back message, hang up.
- Streaming Anthropic client (`anthropicStream`); calendar move/cancel; `rescheduleSlot`, `cancelBooking`.
- Tests: `front-office-receptionist-db` (PGlite), `front-office-receptionist` (scripted model, Vapi fixtures),
  `front-office-ventra-e2e`; `test/live/setter-live.ts` now also replays five Receptionist calls.
- Not verified against a live Vapi call (needs the owner's Vapi account). The exact Vapi request body fields used
  (`call.id`, `call.customer.number`) and the transferCall/endCall function-call shape follow Vapi's docs and support
  threads; confirm on the first test call.

## App UI: Liquid Glass (2026-11-08, owner approved)

- Spec to follow when building any app screen: `docs/design/LIQUID_GLASS_SPEC.md`. Approved render: `docs/design/reference/kit-approved.png` (left half). Home in light/dark: `docs/design/reference/home-approved.png`.
- Library files: `docs/design/ventra-ui/` (tokens.css, glass.css, components.js on `window.VentraGlass`, components.d.ts, tokens.json). Port to TSX keeping `vg-*` class names; wire via `apps/web/app/design-system/liquid-glass/` (not done yet).
- Live design system: https://claude.ai/artifact/1BSxDcrQ9HNoTR2XdUsskY · UI guide canvas: https://claude.ai/artifact/2sik8p22KKEJfZ9W8jK6J4 · PDF/ZIP: `docs/design/VENTRA-App-UI-Guide.*`.
- Applies to the app only; `apps/web/app/site/**` (marketing website) is unchanged.
- 2026-11-09 (Cowork VM, branch `feature/liquid-glass-ui`, commits 9ed36d2, 5c59e60, 4cbf4be, 4cc87d8): first increment shipped.
  - Design system: `apps/web/app/design-system/liquid-glass/` = `tokens.css` (scoped to `.vg-app`, dark via `data-theme` on html or root), `glass.css` (kit CSS, Google font import dropped), `shell.css` (layout, menu, rows, tiles, legacy bridge), `icons.tsx` (Lucide-style inline SVG), `components.tsx` (AppFrame, TopBar, BottomNav, SideNav, GlassCard, StatCard, AnalyticsCard, GlassButton, IconButton, Chip, Badge, SearchField, TextField, SelectPill, SegmentedTabs, Toggle, Checkbox, IconTile, Wordmark, PromoCard, EmptyState, PageHeading, ListRow, ProductTile), `menu.tsx` (portalled anchored GlassMenu), `nav.ts` (five items + `activeNav` + `isLiquidRoute`), `lighting.ts`, `index.ts`.
  - Shell: `app/ui/liquid-shell.tsx` replaces `ventra-shell.tsx` in `app/(ventra)/layout.tsx` and `app/workspace/layout.tsx` (`ventra-shell.tsx` and `ventra-home.tsx` are kept, unused by routes, because `test/ventra-home.test.ts` and `test/feature-registry.test.ts` pin them). Legacy pages render inside `.ventra-app.vg-legacy[data-theme]` so their styles keep applying. `/tools/**` still use the old shell.
  - Routes: Home `/` → `app/ui/liquid-home.tsx`; new `/ai-team` (`liquid-ai-team.tsx`, status from `GET /api/front-office/settings`), `/ai-team/settings` (renders the existing `tools/front-office-settings` editor), `/bookings` (`liquid-bookings.tsx`, honest empty state), `/more` (`liquid-more.tsx`), `/notifications` (`liquid-notifications.tsx`, existing NotificationsCentre). Nav map: Leads → `/customers` (also lights for `/inbox`, `/sales`); More also covers `/settings`, `/services`, `/insights`, `/business`, `/create`, `/grow`, `/onboarding`, `/workspace`. Every old route still resolves.
  - Spec vs rulebook reconciliations: `docs/design/DECISIONS.md`.
  - Verified (Node 22.23.4): `eslint . --max-warnings 0` pass; `tsc --noEmit` pass; `node --experimental-strip-types --test test/*.test.ts` 601 pass, 0 fail; `next build` exit 0. Playwright against `next start`: `/`, `/ai-team`, `/bookings`, `/more`, `/inbox` at 390 (DPR 2) and 1440, light and dark, plus `/`, `/more` at 320 and `/workspace`, `/ai-team/settings`, `/customers`, `/settings`, `/notifications` at 390 → `/home/claude/vf-shots/` (32 PNGs + `report.json`). scrollWidth == clientWidth on every page (no horizontal overflow); last content bottom above the bottom nav on `/`, `/more`, `/ai-team`, `/inbox`, `/settings`; stat and account menus anchor inside the viewport, Escape returns focus; period select persists for the visit; theme switch stores `ventra.theme.v1`; reduced motion removes toggle transitions; both AgentCard toggles disabled. No page errors (the `/api/workspace` 503 in this VM is the missing Supabase env).
  - Not done: Leads list screen (rulebook 5B); restyling legacy page content (Customers, Inbox, Settings, Grow, Business, Services, Onboarding, Insights, Sales) beyond the chrome; `/tools/**` still on the old shell; real booking and conversation counts need a client-readable API (none exists); unread count on the bell; glass login redesign (left as approved, inside the new shell); `PromoCard`/`SearchField`/`SegmentedTabs`/`TextField` ported but unused on screens; refraction filter (`enableRefraction`) not ported (optional in spec).
  - Next: Leads screen on `/customers` data (LeadRow, filter rail); port Customers/Inbox content; a small `GET` for bookings/conversation counts so Home shows real numbers; owner to decide whether `/tools/front-office-settings` should move into the customer app properly (today `/ai-team/settings` reuses it).

## Acceptance criteria

Tracker Phase 0: 0.1 scope freeze, 0.2 orchestrator, 0.3 lead store + state machine, 0.4 handoff schema,
0.5 SMS webhook, 0.6 outbound log with prompt version, 0.7 gate (a text creates a contact with a state).

## Git state (auto)

<!-- git-state:start -->
_Generated 2026-11-03 16:47 by `ventra-handoff snapshot`. Do not hand-edit this block._
- Branch: `chore/agent-setup-handoff`
- HEAD: `f4d57c1 chore: add agent setup, Claude/Codex handoff and role agents`
- Lock: claude (pid 49645, 0 min old)
- Uncommitted changes:
```text
D  .claude/agents/backend.md
D  .claude/agents/feature.md
D  .claude/agents/frontend.md
D  .claude/agents/qa.md
 M .gitignore
 M AGENTS.md
 M CLAUDE.md
 M HANDOFF.md
?? .claude/
?? docs/
?? scripts/agents/
```
- Diff stat vs HEAD:
```text
 .claude/agents/backend.md  |  6 ----
 .claude/agents/feature.md  |  6 ----
 .claude/agents/frontend.md |  6 ----
 .claude/agents/qa.md       |  6 ----
 .gitignore                 |  6 ++--
 AGENTS.md                  | 35 +++++++++++++----------
 CLAUDE.md                  | 70 ++++++++++++++++++++++++----------------------
 HANDOFF.md                 | 41 ++++++++++++++-------------
 8 files changed, 82 insertions(+), 94 deletions(-)
```
- Recent commits:
```text
f4d57c1 chore: add agent setup, Claude/Codex handoff and role agents
f8cfd9f feat(course-creator): add account save and load
476be49 Connect configurable authenticated AI generation and integrate isolated course UI and persistence
a5ac294 Add browser regression for course authoring and reload persistence
fe8a1ad Keep restored course textarea accessible names stable
```
<!-- git-state:end -->

## Changed files and why

- `docs/agents/SCOPE_FREEZE.md`, `docs/agents/PARKED.md`: tracker 0.1.
- `apps/web/lib/scope-freeze.ts` (new), `lib/api-errors.ts` (`feature_paused` = 423): backend freeze.
  Paused: `/api/courses`, `/api/courses/generate`, `/api/workspace/courses`, `/api/workspace/course-generation`,
  `/api/checkout` (423), `/api/stripe/webhook` (503 so Stripe retries), and every launcher draft kind except
  crm-contacts, crm-pipeline, lead-forms, lead-scoring, lead-followups, booking-page, notification-prefs. No data deleted.
  Override for local debugging only: `VENTRA_SCOPE_FREEZE=off`.
- `supabase/migrations/202611060001_front_office.sql` (new): fo_channels, fo_contacts (state machine), fo_messages
  (prompt version required on automated sends), fo_events, fo_handoffs, and the RPCs fo_create_channel,
  fo_list_channels, fo_ingest_sms, fo_log_dispatch, fo_log_outbound, fo_set_state, fo_record_handoff. Not applied anywhere.
- `apps/web/lib/front-office/` (new): state.ts, handoff.ts, router.ts, opt-out.ts, twilio.ts, orchestrator.ts.
- `apps/web/app/api/front-office/sms/inbound/route.ts` (new): Twilio webhook. Needs TWILIO_AUTH_TOKEN (and
  FRONT_OFFICE_PUBLIC_ORIGIN behind a proxy). `lib/rate-limit.ts`: smsWebhookGlobal limiter.
- `apps/web/app/tools/front-office/page.tsx` (new): isolated DEMO test page.
- Tests: new `test/scope-freeze.test.ts`, `test/front-office.test.ts`, `test/front-office-db.test.ts`;
  `route-audit`, `route-rate-limits`, `workspace-routes` set `VENTRA_SCOPE_FREEZE=off` because they test the logic behind the freeze.
- Left untouched: the 2 uncommitted UI files from the frontend branch (`theme.css`, `next-env.d.ts`).

### Phase 1 (calendar and booking, tracker 1.2 and 1.3), owner chose Google Calendar on 2026-11-06

- `lib/front-office/calendar/slots.ts`: open slots from weekly hours in the client's time zone, minus busy time, buffer and notice; offers 2-3 spread-out times.
- `lib/front-office/calendar/google.ts`: Google Calendar over REST (OAuth refresh token), free/busy, event insert with invite (`sendUpdates=all`), idempotent by deterministic event id.
  Env: GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_CALENDAR_ID.
- `lib/front-office/booking.ts`: offerTimes, bookSlot (re-checks the slot, creates the event, records it, logs then sends the confirmation SMS).
- `lib/front-office/sms-send.ts`: Twilio Messages API sender. Real sends only with FRONT_OFFICE_SEND_LIVE=1 plus TWILIO_ACCOUNT_SID / TWILIO_FROM_NUMBER; otherwise dry run (logged, not sent).
- `supabase/migrations/202611060002_front_office_appointments.sql`: fo_appointments, fo_book (records + moves the contact to booked atomically), fo_booking_for_event.
- `app/tools/front-office-booking/page.tsx`: DEMO slot-offer test page. Tests: `test/front-office-calendar.test.ts`, more in `front-office-db.test.ts`.
- Not yet wired to an agent: the Setter (1.1 qualification prompt) will call offerTimes/bookSlot.

### Phase 1 continued (Setter agent, follow-ups, reminders, handoffs: tracker 1.1, 1.4 to 1.7, 1.10, 1.13)

- `lib/front-office/setter/config.ts`: per-client Setter config (questions as config). Ventra defaults drafted by Claude: OWNER to check.
- `lib/front-office/setter/prompt.ts` (`setter/qualify@1`), `setter/agent.ts` (one turn: context, tool loop, guardrails),
  `lib/front-office/llm.ts` (Anthropic Messages API; ANTHROPIC_API_KEY + FRONT_OFFICE_MODEL, no default model).
- Tools: save_answers, set_stage (qualified only with required answers), offer_times, book_time (only offered times),
  handoff_receptionist (1.7), escalate_human. Booking records the Sales handoff (1.6) and schedules 24 h and 2 h reminders (1.5).
- `lib/front-office/jobs.ts`: follow-up ladder 5 min, 1 h, 1 d, 3 d, 7 d, then monthly (1.4); reminders; no-show rescue
  (`markNoShow`). `POST /api/front-office/jobs/run` (Bearer FRONT_OFFICE_CRON_SECRET) runs due jobs.
- SMS webhook: when the AI is configured, the Setter replies after the webhook answers (`after()`), through the sender
  (logged only unless FRONT_OFFICE_SEND_LIVE=1).
- Migration `202611060003_front_office_setter.sql`: contact answers, fo_contact_context, fo_save_answers, fo_jobs,
  fo_schedule_job, fo_claim_jobs, fo_finish_job; fo_ingest_sms now cancels follow-ups and rescues on any reply.
- Tests: `test/front-office-setter.test.ts` = the scripted Setter set (happy path, angry, wrong number, existing customer,
  discount ask, guardrails, jobs). The model is scripted; a live replay against the real model is still to build.
- Owner actions are listed in `docs/agents/OWNER_TODO.md`.

### Web chat, email and the live replay (tracker 1.8, 1.9, 1.10)

- Migration `202611060004_front_office_chat_email.sql`: web chat visitors as contacts, generic `fo_ingest` for chat and email,
  `fo_save_details` (answers + name/email/mobile, never silently merges records), `fo_chat_history`.
- `POST/GET /api/front-office/chat` + `/tools/front-office-chat` test page: AI answers only with FRONT_OFFICE_CHAT_LIVE=1.
- `lib/front-office/email.ts` (Postmark, assumed) + `POST /api/front-office/email/inbound`: basic-auth secret, only the new
  part of the email is read, replies thread with In-Reply-To. The job runner emails follow-ups to contacts with no mobile.
- Setter is channel-aware (style and length per channel; asks for mobile or email before booking on chat and email).
- `apps/web/test/live/setter-live.ts`: replays the scenarios against the real model (needs the key; not part of `npm test`).

## Tests run and results

2026-11-08: Node 24.21 in the Cowork VM: 601 pass, 0 fail; tsc and eslint pass.
2026-11-07: Node 24.21 in the Cowork VM: 582 pass, 0 fail; tsc and eslint pass. Earlier run (Node 22.23):
- `tsc --noEmit`: pass. `eslint . --max-warnings 0`: pass.
- `node --experimental-strip-types --test test/*.test.ts`: 557 pass, 0 fail (514 before the pivot). Gate 0.7 covered by
  `front-office-db.test.ts` on PGlite with the real migration (fixture Auth, NOT Supabase integration).
- One flaky timing test seen once (`local-service-client-portal-draft`, "source drift"); passes on rerun, untouched code.
- NOT run: `next build` (node_modules hold macOS binaries) and `npm run test:local-integration`.

## Blockers

- Gate 0.7 on a real number needs: the migration applied to the local Supabase stack, a Twilio number, TWILIO_AUTH_TOKEN,
  and a channel created with fo_create_channel. Production steps need owner approval.
- Feature tiles in the UI still show frozen tools (feature-registry.ts is presentation, tested against FEATURES.md); the
  backend refuses them. Hide them in a frontend task if wanted.
- Agent lock in the worktree still names claude pid 49645 (2026-11-03). Run `ventra-handoff status` / `recover` on the Mac.
- Earlier: Telegram token rotation; Codex inspection not verified.

## Next steps

1. Owner: `docs/agents/OWNER_TODO.md` > "Next, in order (production)": Secret re-save, Claude funds, workspace, run
   create_channels.sql, CRON_SECRET, Google refresh token, redeploy, test chat, approvals.
2. Owner: Vapi steps in `docs/agents/OWNER_TODO.md` > "AI Receptionist (Vapi)"; apply migration 202611080001 in the
   Supabase SQL editor; fill in /tools/front-office-settings.
3. Build next: Sales payment step once a provider is chosen (2.9), wire `AgentHooks.sales` on approval, 1.11 reactivation
   (needs consent confirmed), 1.12 Google Business replies (needs profile access).

## Do not touch

`VENTRA-CLEAN`, `.env*`, OpenClaw leftovers.
