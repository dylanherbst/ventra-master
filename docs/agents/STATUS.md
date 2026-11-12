# VENTRA agent system: verified status

Checked 2026-11-03 on this Mac. "Verified" means I ran a real check this session and saw the result. Re-check before relying on anything that may have changed (processes, logins, limits).

## Verified working

| Item | Evidence |
| --- | --- |
| Claude Code 2.1.317 | `claude --version` |
| 6 specialist agents load | headless Claude run listed `ventra-backend, -feature, -frontend, -qa, -research, -setup` |
| 7 workflow skills | `ventra-bug-fix, -connections, -daily-overview, -feature-acceptance, -new-feature, -ui-design`, then `-codex-handoff` after a fix (it was wrongly hidden from Claude) |
| Research delegation | `ventra-research` subagent really ran read-only and returned file-level findings |
| Feature → QA workflow | `ventra-feature` created a temp file, `ventra-qa` independently verified content and `git status`, I re-checked it by hand, then deleted only that file |
| Edit guard hook | live headless run: Write to an `.env.*` file was blocked with the guard message; no file created. Script test also blocks `VENTRA-CLEAN`, `.openclaw`, and edits while Codex holds the lock |
| Lock logic | temp-repo tests: dead-pid lock reclaimed, live lock blocks other agent, `recover` safe on live lock |
| Repository intact | all 6 branch tips unchanged except the new chore branch; no diff in `apps/`, `supabase/`; `VENTRA-CLEAN`, `VENTRA-UI`, `VENTRA-BACKEND` have no changes |
| Telegram access | owner-only `allowlist` (1 user), no pending codes, token file mode 600; two-way message test passed earlier (owner confirmed a reply) |
| Agent Teams | off (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset) |
| Codex CLI | 0.166.0, `codex login status`: Logged in using ChatGPT |
| GitHub CLI | logged in as `dylanherbst`; the repo has no remote |

## Not working or not verified

| Item | Status |
| --- | --- |
| Codex inspecting VENTRA-FEATURES | BLOCKED: ChatGPT usage limit until 2026-11-04 14:48. Retest with `ventra-codex` |
| Codex handoff end to end | Not demonstrated yet (commands and lock tested; Codex run blocked by the limit) |
| Telegram after the Stage 2 fix | Poller process was restarted and seen running; a fresh end-to-end message test is still needed |
| Mac permissions (Accessibility, Screen Recording) and app/browser interaction | Not verified; needs the owner's macOS permission dialogs |
| `NEW SIMPLE VENTRA BUILD.pdf` | NOT FOUND on this Mac. Other VENTRA PDFs in Downloads are older and were not used as the blueprint |
| Supabase | Not checked (`.env*` files are deliberately not read). Status: unknown |
| AI provider and front-office channels | Checked 2026-11-10: see "Front-office connections" below and `docs/agents/CONNECTIONS.md`. Nothing is Verified yet |
| Telegram bot token | Owner action: it was pasted into chat; rotate via @BotFather `/revoke` then `ventra-telegram-token` |

## Front-office connections (2026-11-10, Connections agent, task A-5)

Status values: Not started, Code present (not configured), Configured (unverified), Verified. Env variable names, routes, owner steps and policy sources are in `docs/agents/CONNECTIONS.md`. Test runs are fixture or scripted tests; no live provider was called.

| Connection | Required or optional | Status | Evidence | Owner action needed |
| --- | --- | --- | --- | --- |
| Model provider (Anthropic) | Required for AI replies | Configured (unverified) | Owner note says key and model are in Vercel (not checked by me). Setter tests 11/11 pass (scripted). Live replay not run. Console balance A$0 | Add funds; make the key a Secret; set a spend limit |
| Website chat `/api/front-office/chat` | Optional | Code present (not configured) | Chat tests 2/2 pass. Channel not created | Run `create_channels.sql`; set chat channel id and key in Vercel; redeploy; test |
| Meta Instagram and Messenger `/api/front-office/meta/webhook` | Optional | Code present (not configured) | Meta tests 5/5 pass. No Meta variable in the owner's Vercel list | Meta app, tester role, App Review and Business Verification before outsiders |
| WhatsApp Business | Optional | Not started | No code or route (name only in `contracts.ts`) | Owner decides whether to build it |
| Vapi AI Receptionist `/api/front-office/voice/vapi/...` | Optional (needed for calls) | Code present (not configured) | Vapi tests 9/9 pass (fixture, not a live call). Vapi account not created; voice live off | Create Vapi account, voice channel, assistant and tools; test call |
| Google Calendar OAuth (booking) | Required for booking | Code present (not configured) | Calendar tests 9/9 pass. No consent route in the app; refresh token not yet made | Make refresh token in OAuth Playground; set four Google variables; share bookings calendar |
| Twilio SMS `/api/front-office/sms/inbound` | Optional | Code present (not configured) | SMS tests 7/7 pass. SID and token in Vercel (owner note); no number or SMS channel | Buy AU mobile number (needs ID); set `TWILIO_FROM_NUMBER`; channel; webhook |
| Postmark email `/api/front-office/email/inbound` | Optional | Code present (not configured) | Email tests 3/3 pass. Token in Vercel (owner note); sender, webhook secret and channel missing | Verify sender domain; set two variables; inbound webhook; channel |

Last verify record (`~/.ventra-dashboard/last-verify.json`, commit 5d5d38d, 2026-11-09) has no front-office step. Node 26 was used for these tests; the repo targets Node 24.

## Course Creator baseline (2026-11-03, Node 26, see `QA_COURSE_CREATOR_BASELINE.md`)

Typecheck, lint, unit tests (269) and production build pass. The browser regression test fails (stale selector at `test/course-creator-browser.mjs:34`). Local integration is BLOCKED (Docker and local Supabase not running). No DEMO/LIVE or connection-state badges. Generate route has no abuse controls. Verdict: FAIL (partial).

Update (same day): the browser regression was repaired (test file only: one selector, two waits, no assertion weakened) and independently re-verified: 3 consecutive passes, a wrong-URL run still fails correctly, lint, typecheck and 269 unit tests pass. Still true: the account half of that test uses mocked API routes; local integration is BLOCKED; no DEMO/LIVE badges; generate route has no abuse controls. Not run after the fix: production build, mobile viewport, Node 24.

## Automation and approval policy (2026-11-03, see `AUTOMATION_POLICY.md`)

Verified: Bash and Edit guard hooks (live run: 8 of 10 forbidden commands blocked, 2 safe ones allowed, nothing changed), guarded Git workflow in a throwaway repo (branch, commit, checks, push to a local bare remote verified, protected-branch and force-push refusals, secret scan, deployment-trigger detection), approval service with real merge execution, owner authentication helper available on this Mac, 29 agent tests plus 77 dashboard tests.
Not enforced yet: GitHub branch protection and approval environments (unavailable for private repos on the free plan); no remote is linked, so automatic pushes are disabled; no production deploy target is configured; the first macOS authentication prompt has not been exercised by a person.

## Known risks

- **One Telegram poller only.** A second plugin server for the same bot kills the first. The plugin is therefore disabled globally and enabled only by `ventra-claude`. Do not run extra `claude --channels` sessions; close old ones.
- **Context bloat.** `~/.claude/agents` holds 282 old agent files (outside this repo), causing the "agent descriptions over 15k tokens" warning in every session. Owner decision pending: move them to a backup folder.
- The edit hook covers Edit/Write/NotebookEdit, not arbitrary shell commands (those use normal permission prompts).
- Stage 2 files live on `chore/agent-setup-handoff` and are not in the other branches until merged (owner decision).
- Untracked OpenClaw leftovers remain in `VENTRA-FEATURES` (`SOUL.md`, `IDENTITY.md`, `USER.md`, `DREAMS.md`, `memory/`); `~/.openclaw` exists and was not touched.

## Connections status (P0-9)

Checked 2026-11-13 by the Connections agent (coordinator run c-6bd94775). Read-only. No `.env*` file was opened, no secret value was read or printed, no external API was called, and nothing was sent, bought or changed.

- Variable names come from code (`apps/web/lib`, `apps/web/app/api`, `apps/web/app/tools`) and docs (`FRONT_OFFICE_AUDIT.md`, `API_CONTRACTS.md`, `CONNECTIONS.md`). Presence was not checked for any variable.
- Owner-side settings (Vercel, production Supabase, Twilio, Postmark, Google, Anthropic) come from the owner note in `OWNER_TODO.md` ("Production status", 2026-11-07). I did not check those dashboards.
- "Configured (unconfirmed)" means the owner says it is set, but I could not confirm it.
- Front-office tests (Setter, Chat, Meta, Vapi, Calendar, SMS, Email) are scripted fixture tests recorded in `CONNECTIONS.md` on 2026-11-10. I did not re-run them. None of them calls a live provider, so none proves a live connection.

| Connection | Required or optional | Status | Evidence (command or source) | Owner action |
| --- | --- | --- | --- | --- |
| Local Supabase (CLI stack) | Required for local tests | Functionally verified | `docker ps --format {{.Names}}` (2026-11-13): 8 containers up (`supabase_db`, `_rest`, `_auth`, `_kong` for `ventra-clean-integration` and `launchpad-local`). `~/.ventra-dashboard/last-verify.json` (2026-11-12T08:37Z, commit ea8e9d8): `workspace-integration` PASSED (runs `npm run test:local-integration`, which calls `supabase status`). Caveat: recorded at ea8e9d8, HEAD is now 04e0080. The supabase CLI call and an API probe were denied, so they were not run. Names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`lib/supabase/client.ts`) | None required. Optional: run `ventra-verify` at the current commit |
| Production Supabase (project "Ventra AI") | Required (live site, data) | Configured (unconfirmed) | `OWNER_TODO.md` 2026-11-07: project exists, "all migrations applied", public settings in Vercel. Not checked by me. Note: the front-office migration `202611080001_front_office_receptionist.sql` was still listed as "apply", and I could not confirm it was applied | Confirm migration `202611080001` is applied. Answer the backup question below |
| Vercel hosting and env vars | Required (live site) | Owner action needed | Site is live per owner note. Env names listed as in Production (`OWNER_TODO.md` 2026-11-07). Open items there: re-save `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `POSTMARK_SERVER_TOKEN`, `FRONT_OFFICE_CRON_SECRET` as Secret; add `CRON_SECRET` (same value); Pro plan needed for the every-minute cron | Do the open Vercel items. Redeploy after each env change |
| Anthropic (AI model: Setter, Receptionist, chat, SMS, email) | Required for AI replies | Owner action needed | `grep` of `apps/web/lib/front-office/llm.ts`: reads `ANTHROPIC_API_KEY`, `FRONT_OFFICE_MODEL`. Owner note 2026-11-07: key and model in Vercel, console balance A$0 (so the AI cannot answer). Scripted Setter tests 11/11 (2026-11-10). No live call (costs money) | Add funds to the Claude Console; make the key a Secret; set a spend limit if offered |
| OpenAI (Course Creator only) | Not required | Not required | `apps/web/lib/openai-course.ts` reads `OPENAI_API_KEY`, `OPENAI_MODEL`. Course Creator is paused (scope freeze) | None now |
| Website chat (`/api/front-office/chat`) | Optional (first channel to test) | Ready to configure | Code present; chat tests 2/2 (2026-11-10). Names: `FRONT_OFFICE_CHAT_CHANNEL_ID`, `FRONT_OFFICE_CHAT_CHANNEL_KEY`, `FRONT_OFFICE_CHAT_LIVE`. Channel not created per owner note | Run `docs/agents/sql/create_channels.sql` in the Supabase SQL editor; set the chat id and key as Secrets in Vercel; redeploy; test |
| Vapi (AI Receptionist phone line) | Optional (needed for calls) | Owner action needed | Code `apps/web/lib/front-office/vapi-route.ts` reads `FRONT_OFFICE_VOICE_CHANNEL_ID`, `FRONT_OFFICE_VOICE_CHANNEL_KEY`, `FRONT_OFFICE_VOICE_LIVE`. Vapi tests 9/9 are fixture only. Owner note: no Vapi account, voice variables not set | Create a Vapi account; create the voice channel; set up assistant and tools; run a test call with live off |
| Twilio SMS (`/api/front-office/sms/inbound`) | Optional | Owner action needed | `apps/web/lib/front-office/sms-send.ts` reads `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Owner note: SID and token in Vercel (token rotated 2026-11-07). Number not bought; `TWILIO_FROM_NUMBER` and SMS channel missing | Buy an AU mobile number (costs money; needs ID); set `TWILIO_FROM_NUMBER`; create the SMS channel; set the webhook |
| Postmark email (`/api/front-office/email/inbound`) | Optional | Owner action needed | `apps/web/lib/front-office/email.ts` reads `POSTMARK_SERVER_TOKEN`. Route reads `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET`. Owner note: token in Vercel; `FRONT_OFFICE_EMAIL_FROM`, webhook secret and email channel missing | Verify the sender domain in Postmark (check the price first); set the two variables; set the inbound webhook; create the channel |
| Meta Instagram and Messenger (`/api/front-office/meta/webhook`) | Optional | Owner action needed | `apps/web/app/api/front-office/meta/webhook/route.ts` reads `META_APP_SECRET`, `META_VERIFY_TOKEN`; `lib/front-office/meta.ts` reads `META_GRAPH_VERSION` and `FRONT_OFFICE_META_AUTOSEND` (set to `1` only for auto-send). Owner note: no META_* variable in Vercel; Meta tests 5/5 are fixture only | Create Meta app and tester role; set the two Meta secrets in Vercel; set the webhook. App Review and Business Verification before outsiders |
| WhatsApp Business | Optional | Not required | No code or route (name only in `lib/front-office/contracts.ts`). Owner to-do: owner decides whether to build it | Owner decision only. Nothing to create yet |
| Stripe (online checkout and webhook) | Optional (not needed for launch) | Not required | Code: `apps/web/app/api/checkout/route.ts` reads `STRIPE_SECRET_KEY`; `apps/web/app/api/stripe/webhook/route.ts` reads `STRIPE_WEBHOOK_SECRET`. Owner to-do: online checkout not built; needs test keys and a payment-provider decision | Decide on payments later. Test keys and any live payments need separate approval |
| Google Calendar (booking, OAuth) | Required for booking | Owner action needed | `apps/web/lib/front-office/calendar/google.ts` reads `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` (all four needed). No consent route in the app. Owner note: refresh token not yet made. Calendar tests 9/9 are fixture only | Make the refresh token in OAuth Playground; set the four variables in Vercel; share the bookings calendar |
| Telegram notifications (approval alerts) | Optional | Configured | Not a product variable. `STATUS.md` (2026-11-03): owner-only allowlist with 1 user, token file mode 600. Not re-checked today. A live test would send a message, so I did not run one | Rotate the bot token (it was pasted into chat): BotFather `/revoke`, then `ventra-telegram-token`. Then run one end-to-end test |
| Codex CLI (backup coder) | Optional | Configured | `codex login status` (2026-11-03): logged in (ChatGPT). Not re-run today | Re-run `codex login status` if Codex is needed |
| GitHub CLI | Optional | Configured | `gh` logged in (2026-11-03). The repo has no remote, so nothing is pushed | None now. Remote is an owner decision |

Commands run for this section (2026-11-13):

1. `docker ps --format {{.Names}}`: exit 0, 8 containers listed (names only).
2. Read `/Users/dylan/.ventra-dashboard/last-verify.json`: at 2026-11-12T08:37:20Z on commit ea8e9d8, lint, typecheck, unit-tests, build and workspace-integration PASSED. course-integration and launcher-integration FAILED because those tools are frozen. Overall `passed: false`. No front-office step is in the record.
3. Grep of `apps/web/lib`, `apps/web/app/api`, `apps/web/app/tools`, and `docs/agents` for env variable names only.
4. Denied by the permission system and not retried: a `curl` probe of `http://127.0.0.1:54321/auth/v1/health` (local API gateway) and `supabase --version`. Local Supabase is therefore not confirmed through its API at HEAD.

Owner questions and actions (in order):

1. **Production database backups.** Do backups exist for the production Supabase project "Ventra AI" (daily backups or point-in-time recovery)? Where to look: Supabase dashboard, project, Database, Backups. You should see a list of backups or a "PITR" status. If you see neither, the project may have no managed backup. The repo backup (`ventra-backup`) covers code and migrations only, not production data, and its newest bundle is older than today (see `TASKS.md` P0-10).
2. Confirm migration `202611080001_front_office_receptionist.sql` is applied in production (Supabase SQL editor, Ventra AI project).
3. Fix the open Vercel items in `OWNER_TODO.md` (Secret types, `CRON_SECRET`).
4. Anthropic: add funds and make the key a Secret.
5. Rotate the Telegram bot token.
6. Channel and provider steps for chat, Vapi, Twilio, Postmark, Meta and Google as listed in the table, in the order your priorities set. Each one that costs money needs your decision first.
