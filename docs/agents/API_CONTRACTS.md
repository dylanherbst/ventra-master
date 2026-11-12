# Front-office API contracts (AI Setter and AI Receptionist)

The shapes named here (`Contact`, `Message`, `PendingAction`, ...) are defined once, with runtime validators, in
`apps/web/lib/front-office/contracts.ts`. The UI checks every response with the matching `parse*` function before using
it. Tests: `apps/web/test/front-office-contracts.test.ts` (they also fail if a value list drifts from the database).

Status: **EXISTS** = in the repo today (file given). **PLANNED** = agreed shape, built in the named task. Planned
shapes may gain optional fields; existing fields do not change meaning without a note here.

## Common rules

- **Auth, signed-in endpoints.** Supabase session cookie. Workspace in the query: `?workspace=<uuid>`. Reads run under
  the caller's own token, so row-level security limits them to that workspace. State-changing calls must be same-origin
  JSON (`Content-Type: application/json`).
- **Auth, webhooks.** No user session. Each channel has an id and a key; only the key's SHA-256 is stored. Keys and
  provider tokens never appear in any response.
- **Errors (signed-in endpoints).** `{ "error": "<plain English>", "code": "<code>" }` with the status from
  `lib/api-errors.ts`: `signed_out` 401, `session_revoked` 401, `forbidden_origin` 403, `no_workspace_access` 403,
  `invalid_request` 400, `too_large` 413, `conflict` 409, `rate_limited` 429 (with `Retry-After`), `feature_paused` 423,
  `upstream_failed` 502, `not_configured` 503, `storage_unavailable` 503. Messages never contain provider details.
- **Revision conflicts.** Anything the owner edits carries a `revision`. Send the revision you loaded; `0` creates. Someone
  saved first: `409 conflict`, reload and retry. Nothing is overwritten silently.
- **DEMO / LIVE.** Nothing reaches a real customer unless the owner switched it on with a server flag (names only:
  `FRONT_OFFICE_CHAT_LIVE`, `FRONT_OFFICE_DEMO_LIVE`, `FRONT_OFFICE_SEND_LIVE`, `FRONT_OFFICE_VOICE_LIVE`,
  `FRONT_OFFICE_META_AUTOSEND`). Request data can never turn these on. A connection reports `mode: "LIVE"` only when it is
  `verified`.
- **Operating modes** (`OperatingMode`, per business, per product): `automatic` performs within the business rules;
  `owner_approval` holds the action as a `PendingAction` and commits only after approval; `enquiry_only` answers and
  captures the enquiry but never books, changes, sends or transfers. Default `enquiry_only`. Every book, reschedule,
  cancel, send, follow-up and transfer goes through one shared permission check (A-2), which answers `perform`,
  `hold_for_approval` or `refuse` (`PermissionDecision`).

## Endpoints that exist today

### POST /api/front-office/chat (website chat; Setter demo)
EXISTS: `apps/web/app/api/front-office/chat/route.ts`
- Auth: none (public widget). Origin must be this app or listed in `FRONT_OFFICE_CHAT_ORIGINS`. Rate limited per
  visitor, per client address (demo) and overall.
- Request: `{ visitor: string (16-64 of A-Z a-z 0-9 _ -), message: string (1-2000), id: string (8-64, unique per
  message; a retry with the same id is not recorded twice), demo?: { audit: <saved Growth Audit> } }`. Max 8 KB (40 KB with `demo`).
- Response 200: `ChatReply` (`parseChatReply` fills `demo`, `booked`, `state`, `note` when absent).
  `live: false` means the message was recorded and a person will follow up; `note` says so.
- Errors: `{ error }` (no `code` yet): 400 invalid message, 403 origin, 413 too large, 415 not JSON, 429 busy,
  503 `{ configured: false }` not connected, 503 unavailable.
- DEMO/LIVE: the AI answers only with `FRONT_OFFICE_CHAT_LIVE=1` (demo: `FRONT_OFFICE_DEMO_LIVE=1`). Demo runs on its own
  channel; nothing is sent, booked or scheduled.

### GET /api/front-office/chat?visitor=<id>
EXISTS: same file. The visitor's own conversation for redrawing the widget: `{ messages: { direction, body, at }[] }`
(at most 40). Errors as above.

### GET /api/front-office/settings?workspace=<id>[&template=gym|ventra|custom]
### POST /api/front-office/settings?workspace=<id>
EXISTS: `apps/web/app/api/front-office/settings/route.ts`
- Auth: signed in, workspace **owner** only.
- GET response: `{ settings: AgentSettings, revision: number, saved: boolean, updatedAt?: string }`. Not saved yet:
  the template, `revision: 0`. (`AgentSettings` is defined and validated in `lib/front-office/settings.ts`.)
- POST request: `{ settings: AgentSettings, revision: number }`; response `{ settings, revision, saved: true }`.
  Body max 256,000 bytes (A-36; the shared JSON cap). A maximum-size knowledge base plus 40 maximum FAQs is about
  150 KB, so it fits. Over the cap: **413** `too_large`, "These settings are too large to save (over 256 KB). Shorten
  some service, offer, policy or FAQ text and try again."; nothing is read or written.
- `settings.knowledge` on POST (A-30): key **omitted** = the stored knowledge base is kept unchanged (nothing stored
  yet: empty lists). Key **present** = it replaces the stored one; `null` or empty lists clear it. The response
  `settings` always carries the knowledge that was saved. Omitted and the stored row cannot be read: fails closed
  (403 `no_workspace_access` for a non-owner, otherwise 503 `storage_unavailable`, "Unable to load settings. Check
  that the database is up to date."); no save is attempted and no database text is returned.
- Errors: `no_workspace_access` (not owner), `invalid_request` (first bad field named), `conflict` (revision),
  `too_large` (413, body over the cap), `storage_unavailable`.

#### Knowledge base shape (`settings.knowledge`, type `KnowledgeBase` in `lib/front-office/settings.ts`, A-16)
`{ services: Service[], offers: KnowledgeOffer[], policies: Policy[], objections: ObjectionRule[] }`. Each list
optional (missing or `null` = empty). Settings saved before A-16 read as empty lists. FAQs stay in `settings.faqs`.
Text is trimmed. `id` (every item): optional, lower case `[a-z][a-z0-9_-]{0,39}`, unique within its list; default
`service_1`, `offer_1`, `policy_1`, `objection_1` by position.
- `Service` (max 50): `name` text 1-120 required, `description` text max 400, `priceAud` number or `null`,
  `priceUnit` text max 40 (e.g. `per session`), `durationMinutes` integer 5-1440 or `null`.
- `KnowledgeOffer` (max 20): `name` 1-120 required, `details` 1-600 required, `priceAud` number or `null`,
  `validUntil` `"YYYY-MM-DD"` or `null`.
- `Policy` (max 30): `topic` 1-80 required, `text` 1-800 required.
- `ObjectionRule` (max 20): `triggers` 1-10 phrases, each 4-60 chars (stored lower case, spaces collapsed);
  `response` 1-500 required; `escalate` boolean (only `true` counts; a person follows up).
- Prices (`priceAud`): AUD, 0 to 1,000,000, at most 2 decimals; a number or a string like `"29.50"` / `"$29"`.
  Blank or `null` = no price on file: the AI never states, ranges or estimates one, it says the team will check.
  `0` reads as "free".
- Offer expiry: `validUntil` is inclusive, in the business `timeZone`. An offer is active through the end of that
  day; after it, the offer stays stored (the owner sees it) but is filtered out in code (`activeOffers`) before the
  Setter prompt and the Receptionist `answer_faq` see it. `null` = no end date.
- One source: the Setter prompt (`setterConfigFor` -> `knowledgeLines`) and the Receptionist `answer_faq`
  (`knowledgeAnswer`) both read this stored `settings.knowledge`; no copy is kept anywhere else.

### GET /api/front-office/summary?workspace=<id>&tz=<IANA zone>
EXISTS: `apps/web/app/api/front-office/summary/route.ts`
- Auth: signed in, workspace member. Counts only; no names, numbers or message text.
- Response: `{ summary: FrontOfficeSummary, partial: boolean }` (`lib/front-office/summary.ts`, check with
  `parseSummary`). `partial: true` when the calls or approvals tables are not migrated yet.

### GET /api/front-office/outbox?workspace=<id>
### POST /api/front-office/outbox?workspace=<id>
EXISTS: `apps/web/app/api/front-office/outbox/route.ts` (Instagram and Messenger reply approval; superseded by the
pending-actions queue in A-2, kept working until then).
- Auth: signed in, workspace member.
- GET: `{ items: { id, contact_id, body, prompt_version, created_at, channel_id }[] }` (raw rows, oldest first, at most 100).
- POST: `{ id: uuid, decision: "approved" | "rejected", text?: string (edited reply, max 1000) }` ->
  `{ status: "rejected" | "sent" | "failed", note? }`. Outside Meta's 24-hour window it is approved but not sent.
- Errors: `invalid_request`, `conflict` (already handled or contact opted out).

### Webhooks (not called by the UI)
EXISTS. Shown so the UI knows where data comes from.
- `POST /api/front-office/sms/inbound?channel&key` (Twilio, signed). `apps/web/app/api/front-office/sms/inbound/route.ts`
- `POST /api/front-office/email/inbound?channel&key` (Postmark, basic auth). `.../email/inbound/route.ts`
- `GET|POST /api/front-office/meta/webhook?channel&key` (Meta verify and DMs). `.../meta/webhook/route.ts`
- `POST /api/front-office/voice/vapi[/<channel>]/chat/completions` and `.../webhook` (Vapi custom LLM and call events;
  Bearer = voice channel key). `.../voice/vapi/**/route.ts`, logic in `lib/front-office/vapi-route.ts`. The AI answers only
  with `FRONT_OFFICE_VOICE_LIVE=1`, saved settings, Receptionist and voice switched on.
- `GET|POST /api/front-office/jobs/run` (cron; Bearer secret). Follow-ups and reminders; sent only with `FRONT_OFFICE_SEND_LIVE=1`.

### Receptionist Lab Live AI Test server actions (A-41, test page only)
EXISTS. Next.js Server Actions (not REST routes) in `apps/web/app/tools/receptionist-lab/actions.ts`, used only by the
isolated test page `/tools/receptionist-lab`. Logic in `apps/web/app/tools/receptionist-lab/live.ts`; engine is
`lib/front-office/receptionist/lab-live.ts` (A-26). Sandboxed: real model only; store, calendar, SMS/email in memory,
nothing placed, booked or sent. Shapes: `ReceptionistLabState`, `ReceptionistCallSummary` (lab-live.ts), `LabUsageToday`
(lab-usage.ts).
- Result of every call action: `{ state: ReceptionistLabState | null, error: string | null, liveAi?: "configured" |
  "not_configured", signIn?: "verified" | "refused" }`. `state` is null on any error; the page keeps its last state.
- `startLiveCall()` -> result. Free (fixed greeting, no model). No sign-in needed.
- `sendLiveTurn(state, says: string)` -> result. PAID (one Receptionist turn on the real model). Order of checks: `state`
  shape and size (`checkedReceptionistLab`, before any cookie read), then the caller is built ONLY from the server session
  (`lp-access` cookie -> `auth.getUser` + `session_active`, shared `verifiedCaller` from `tools/setter-lab/live-auth.ts`;
  no user id is accepted from the browser), then the engine checks model config and the shared daily lab cap before any
  model call. Business settings are chosen on the server (demo business for now), never sent by the page. `says` is
  trimmed and capped at 600 characters by the engine; 30 caller turns per call.
  Errors (plain English): sign-in required / account sign-in not connected / could not check sign-in (`signIn: "refused"`,
  no model call); `LIVE_NOT_CONFIGURED` (`liveAi: "not_configured"`); today's cap reached; "This lab call has ended / is
  too long / could not be read. Start a new call."; "Say something first."; anything else -> generic "Live AI Test failed".
  A model or tool failure during the turn is not an error: it lands in the turn as `route: "error"` with the phone apology.
- `endLiveCall(state)` -> result with `state.ended = { reason, summary }`. Free (no model).
- `getLiveUsage()` -> `LabUsageToday` (same shared cap as the Setter Lab's `getLabUsage`).
- Page indicators: LIVE only when the server reports a configured model (`!!anthropicConfigFromEnv()`, a yes/no only);
  speech-to-text (Web Speech API, `en-AU`) and spoken replies (`speechSynthesis`, `en-AU`) are optional, keyboard input
  always works.

### Setter Lab and Receptionist Lab sandbox (A-34, test pages only)
EXISTS. Server Actions (not REST routes) in `apps/web/app/tools/setter-lab/actions.ts` and
`apps/web/app/tools/receptionist-lab/actions.ts`. Shared types live in `lib/front-office/contracts.ts`: `LabPersistence`,
`LabScenarioInfo`, `LabProductName`, `LabRowCountsInfo`. Logic: `lib/front-office/lab-session.ts` (`openLabSession`,
`sandboxRpc`, `sandboxEmail`), `apps/web/app/tools/setter-lab/sandbox.ts` (token to session, reset, scenarios) over
`lib/supabase/lab-sandbox.ts` (A-25, the `fo_lab_*` functions, migration 202611110001).
- Where data lives: `LabPersistence = { mode: "database", workspaceId, created } | { mode: "memory", reason }`. Database mode
  needs BOTH the server-only env secret `FRONT_OFFICE_LAB_KEY_SECRET` (at least 32 characters; the per-user lab channel key is
  an HMAC of the user id under it; never sent to the browser) AND a server-verified signed-in user. Otherwise the lab keeps its
  in-memory store and `reason` says why in plain English (secret not set / too short / not signed in / database not
  available). The page shows DEMO and "Persistence: MEMORY ONLY (reason)". Nothing is created or written in memory mode.
- Database mode: the Setter Lab runs the real pipeline over the sandbox's `lab:sms:<id>` channel, the Receptionist Lab live
  call over its `lab:voice:<id>` channel, using the real `fo_*` functions (contacts, messages, bookings, jobs, hand-offs). A lab
  booking is therefore a row in the sandbox workspace and is returned by `GET /api/front-office/contacts?workspace=<sandbox id>`
  for its owner. The calendar, the held-action queue (Setter) and the recording senders stay in the lab state; nothing is sent
  and `FRONT_OFFICE_*_LIVE` switches are not read. The fixture simulation on the Receptionist page (`runLab`) stays in memory.
- Sandbox contacts only take test email domains (`example.com/net/org`, `*.test`, `*.example`, `*.invalid`, `*.localhost`). An
  email the model writes that looks real is stored as `<name>@lab-sandbox.test` and the turn records a write line saying so; the
  turn does not fail.
- Setter actions: `getLabSession()` -> `{ persistence, scenarios }`; `startLab(mode)` and `resetLab(mode)` delete the sandbox
  conversation rows (database mode) and return a fresh state; `sendMessage`, `sendLiveMessage`, `decideAction` as before, now
  also `persistence`; `saveScenario(state, name)`, `loadScenario(name)`, `deleteScenario(name)` -> `LabResult`
  `{ state, error, persistence?, scenarios?, notice?, liveAi? }`. Scenarios (max 20 per lab, name 1 to 80 characters) store the
  lab state plus a snapshot of the sandbox rows; load resets the sandbox and restores them in one transaction.
- Receptionist actions: `getReceptionistLabSession()`, `startLiveCall()`, `sendLiveTurn(state, says)`, `endLiveCall(state)`,
  `resetLiveLab()`, `saveCallScenario(state, name)`, `loadCallScenario(name)`, `deleteCallScenario(name)` -> `LiveCallResult`
  `{ state, error, liveAi?, signIn?, persistence?, scenarios?, notice? }`. In database mode the page does not start a call on
  load (no writes on a page visit); each call gets its own `call_lab_<hex>` id.
- Known limit: `fo_contact_context` only returns bookings that end after the database's real clock, while the labs use a fixed
  lab time in the past. The lab pages therefore find the booking from the lab calendar (`fo_booking_for_event`), but the Setter's
  returning-booked answer (which reads the context) will say there is no upcoming booking in database mode.

## Planned endpoints

All planned endpoints: signed-in, `?workspace=<id>`, common errors above, lists capped and newest first unless stated.

### Operating modes and the approval queue (A-2 logic, routes A-21)
EXISTS: `apps/web/app/api/front-office/modes/route.ts`, `.../pending-actions/route.ts`, `.../pending-actions/[id]/route.ts`
(shared helpers in `.../pending-actions/shared.ts`). Tests: `apps/web/test/front-office-modes-api.test.ts`.
All take `?workspace=<id>`. Not signed in: `401`. Not a member, not the owner where required, or an item of another
business: the same generic `403 no_workspace_access` (nothing about the other business is returned).
- `GET /api/front-office/modes` -> `{ modes: OperatingModes, revision: number, updatedAt: string | null }`. Member reads.
  Never saved: both `enquiry_only`, `revision: 0`. A stored value the app does not know reads as `enquiry_only`.
- `PUT /api/front-office/modes` `{ modes: { setter, receptionist }, revision }` (same-origin JSON) -> `{ modes, revision,
  saved: true }`. Owner only. Each mode must be `automatic`, `owner_approval` or `enquiry_only` (else `400`).
  `409 conflict` on a stale revision or when the business settings were never saved. Items already held stay held.
- `GET /api/front-office/pending-actions[?status=<PendingActionStatus>][&limit=1..500]` -> `{ items: PendingActionView[] }`.
  Member reads, newest first, default 100. Overdue items are expired before listing. `PendingActionView` is the
  `PendingAction` contract plus `committedAt` and `invalid` (payload `null` when invalid); the idempotency key and
  channel id stay on the server.
- `POST /api/front-office/pending-actions/<id>` `{ decision: "approve" | "reject", note?: string (max 500) }` (same-origin
  JSON) -> `{ outcome: "performed" | "failed" | "rejected" | "expired" | "already_decided", item: PendingActionView }`.
  **Owner only.** Approve performs the held Setter action exactly once through `approvePendingAction` with the same
  executor as a direct action (`createJobsExecutor(createSetterExecutor(...))`) on the channel it came from; texts are a
  dry run unless `FRONT_OFFICE_SEND_LIVE=1`. A repeat decision returns `200 already_decided` and changes nothing; an item
  past its expiry returns `200 expired` and is never performed. `409 conflict` (item stays pending) when it cannot be
  performed here yet: a Receptionist item (no Receptionist approval executor yet), or the item's channel is not
  configured on this server (`FRONT_OFFICE_*_CHANNEL_ID/KEY`).
- Instagram and Messenger items (A-37; tests `apps/web/test/front-office-meta-window-route.test.ts`). Channels are
  found from the env pairs `FRONT_OFFICE_INSTAGRAM_CHANNEL_ID` / `FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY` and
  `FRONT_OFFICE_MESSENGER_CHANNEL_ID` / `FRONT_OFFICE_MESSENGER_CHANNEL_KEY` (id a UUID, key at least 32 characters; a
  channel already listed as SMS/chat/email/voice is not listed again), the same pairs the jobs runner uses. A `send` or
  `follow_up` payload on `instagram` or `messenger` is checked again against Meta's 24-hour reply window at approval
  (`fo_social_window` on the item's channel; an opted-out contact, no Meta id, an unreadable window or a future time
  count as closed):
  - Inside the window: `outcome: "performed"`, note "Approved. It goes out at its next scheduled check ...". Nothing is
    sent from the route; the jobs runner sends it, through Meta only while the window is open and only when
    `FRONT_OFFICE_META_AUTOSEND=1` and Meta is configured (otherwise a logged dry run, `sent: false`).
  - Closed: `outcome: "failed"`, `item.note` is the `META_WINDOW_CLOSED_AT_APPROVAL` text (`pending-actions.ts`), the
    executor never runs, and exactly one owner task is queued (`fo_queue_outbound` with the held text; none for an
    opted-out contact). A repeat approve is `already_decided` and queues nothing. If the owner task cannot be saved,
    the note is `META_WINDOW_CLOSED_AT_APPROVAL` followed by `META_OWNER_TASK_FAILED` ("The reminder to reply could not
    be saved either."); the database error is never stored or returned.
  - Channel not configured here: `409 conflict`, the item stays pending.

### Receptionist actions (A-7)
- Existing Vapi endpoints enforce the mode: `owner_approval` holds book, reschedule, cancel and transfer and the caller is
  told honestly ("I have asked the team to confirm"); `enquiry_only` takes a message instead. Each caller turn produces a
  `ReceptionistRunResult` (logged; `pendingActionIds` lists what was held).
- `POST /api/front-office/receptionist/simulate` `{ conversation: { role: "user" | "assistant", content }[], caller?: E.164,
  callId?: string }` -> `{ result: ReceptionistRunResult, call: CallRecord | null }`. Sandbox only: scripted model unless
  the AI is configured, fake or sandbox calendar, nothing sent or dialled. For the receptionist lab.

### Setter actions and follow-ups (A-8)
- The chat, SMS, email and Meta paths enforce the mode for booking, confirmations, follow-up sends and handoffs.
- `POST /api/front-office/setter/simulate` `{ message: string (1-2000), visitor?: string, channel?: ChannelKind }` ->
  `{ result: SetterRunResult, contact: Contact, activity: ActivityEvent[] }`. Sandbox only, same rules as above. For the
  setter lab.

### One customer record and history (A-9)
EXISTS (read path): `apps/web/app/api/front-office/contacts/route.ts`, `.../activity/route.ts`; logic in
`lib/front-office/crm.ts` and `lib/front-office/activity.ts`. Tests: `test/front-office-crm.test.ts`,
`test/front-office-crm-db.test.ts`. Signed-in members; not a member gets `403 no_workspace_access`.
- `GET /api/front-office/contacts?state=<ContactState>&q=<name | email | phone>&limit=1..200 (50)&before=<createdAt>&beforeId=<id>`
  -> `{ items: Contact[], next: { before, beforeId } | null }`. Newest first. Phone search accepts AU local formats
  (0412 345 678) and is exact; email search is the lower-cased value; name search allows letters, digits, space and
  `' . -` only; anything else is `400`.
- `GET /api/front-office/activity?contact=<id>&limit=1..200 (50)&before=<activity id>` -> `{ items: ActivityEvent[],
  next: number | null }` (`fo_events` newest first; pass `next` back as `before`). A contact from another workspace gets
  an empty list, the same as an unknown id.
- Writers pass phone and email through `normalisePhone` and `normaliseEmail` (crm.ts) before any `fo_*` call.
- Still planned below: `contacts/<id>`, conversations, messages, bookings.
- `GET /api/front-office/contacts/<id>` -> `{ contact: Contact, bookings: Booking[], calls: CallRecord[] }`; an id from
  another workspace gets the same `invalid_request` answer as an unknown id, so it never reveals that the record exists.
- `GET /api/front-office/conversations` -> `{ items: Conversation[] }`.
- `GET /api/front-office/messages?contact=<id>&before=<createdAt>` -> `{ items: Message[] }` (oldest first, 100 max).
- `GET /api/front-office/bookings?from=<ISO>&to=<ISO>` -> `{ items: Booking[] }`.
- One contact per person per workspace: phone (E.164) and email (lower case) are unique; no silent merges.

### Consent records (A-38, local/PGlite only until the owner approves the migration)
EXISTS (database): `supabase/migrations/202611110004_front_office_consent.sql`, tests `test/front-office-consent-db.test.ts`.
- Table `fo_contact_consents` (one row per grant; history kept): `channel` `sms|email`, `granted_at`, `granted_source`,
  `withdrawn_at`, `withdrawn_source`. Members can read their workspace's rows; nobody writes directly.
- `fo_grant_consent(channel, channel_key, contact, consent_channel, source, given_at?)` ->
  `{ id, channel, granted: true, grantedAt, grantedSource, created }` (`created: false` when already open).
- `fo_withdraw_consent(channel, channel_key, contact, consent_channel, source, withdrawn?)` ->
  `{ id, channel, granted: false, changed: true, withdrawnAt, withdrawnSource }` or `{ channel, granted: false, changed: false }`.
- `fo_contact_context` adds `contact.consent: { sms: boolean, email: boolean }` (false without an open grant).
  Consent never overrides `optedOut`: callers refuse opted-out contacts first.
- No member-facing RPC to record consent by hand yet (planned with the owner UI).

### GET /api/front-office/performance?workspace=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&tz=<IANA zone> (A-10)
EXISTS: `apps/web/app/api/front-office/performance/route.ts` (logic `lib/front-office/performance.ts`). Tests:
`apps/web/test/front-office-performance.test.ts`.
- Auth: signed in, workspace member (reads under the caller's token, so RLS applies). Counts only; no names, numbers or text.
- Range: from/to inclusive local days in tz (default Australia/Sydney), at most 366 days.
- Response: `{ performance: { workspaceId, range{from,to,timeZone,startsAt,endsAt}, asOf, empty, business: StageCounts,
  byChannel: [{ channel: ChannelKind|'unattributed', ...StageCounts }], reasons{ attended? } } }`.
  StageCounts = `{ enquiries, qualified, booked, attended: number|null, lost, conversion{ qualifiedFromEnquiry,
  bookedFromQualified, bookedFromEnquiry, attendedFromBooked, lostFromEnquiry } }`; a ratio is null when its denominator
  is 0 or its stage is null.
- Cohort: enquiries = contacts created in range; later stages are what those contacts have reached as of `asOf`.
  Channel = 'created' event detail, else first 'inbound' event. qualified = state event to qualified/booked, a booking,
  or state qualified/booked/no-show now. booked = any fo_appointments row of any status (cancelled included) or state
  event to booked. lost = now disqualified or opted out (may overlap booked). attended = null with a reason until
  something records attendance.
- Reads are paged (1000 rows) and events/appointments are read only for cohort contacts; past the caps (5000 contacts,
  20000 events, 5000 appointments) the route refuses with `too_large` and never returns a partial count.
- Errors: `signed_out`, `session_revoked`, `no_workspace_access`, `invalid_request` (bad dates, to<from, >366 days),
  `too_large`, `storage_unavailable`, `rate_limited`.

### Connections and calendar (A-12)
- `GET /api/front-office/connections` -> `{ items: ChannelConnectionState[] }`, one per `ConnectionTarget`. Never returns
  keys, tokens or secrets; `address` is the public number, inbox or page name only. (Channel rows come from the A-5
  inventory; the calendar row from A-12.)
- `GET /api/front-office/calendar/connect` -> redirect to Google consent (owner only). `GET .../calendar/callback`
  stores the connection server-side and redirects to the settings page. `POST .../calendar/disconnect` `{}` ->
  `{ item: ChannelConnectionState }`. Until the owner connects a real account, booking uses a sandbox calendar and the
  calendar row reports `mode: "DEMO"`.

## Field mapping (database -> contract)

The routes map rows; the UI never reads raw columns. `fo_contacts`: `workspace_id` -> `workspaceId`, `web_visitor` ->
`webVisitor`, `instagram_id` -> `instagramId`, `messenger_id` -> `messengerId`, `opted_out_at` -> `optedOutAt` and
`optedOut`, `created_at`/`updated_at` -> `createdAt`/`updatedAt`. `fo_messages`: `contact_id`, `channel_id`,
`prompt_version` -> camelCase; `channel` is the joined `fo_channels.kind`; `provider_id` is internal. `fo_appointments`:
`starts_at`/`ends_at` -> `startsAt`/`endsAt`; `provider_event_id` is internal. `fo_events`: `from_state`/`to_state` ->
`fromState`/`toState`. `fo_calls`: `provider_call_id` and `transcript` are internal (transcript via a later detail call).
