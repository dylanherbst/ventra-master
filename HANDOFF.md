# VENTRA handoff

Shared state between Claude Code and Codex. The assistant that stops updates this file; the one that starts reads it. Template and rules: `docs/agents/CODEX_HANDOFF.md`.

- **Updated:** 2026-11-09
- **Last editor:** claude (Cowork, overnight, owner asleep)
- **Repo:** /Users/dylan/Developer/VENTRA-FEATURES

## FOR THE COORDINATOR: send this to Dylan on Telegram (requested by Dylan, 2026-11-09)

Dylan asked for the mobile app preview link to be sent to him on Telegram. Send this one message with the `reply` tool, then delete this section and commit:

> VENTRA mobile app preview (tap the bottom menu to move between screens): https://claude.ai/artifact/GgRt53mn4e5BKMjWSMy2vE
> The real app is on branch feature/mobile-app. To open it on your phone over Wi-Fi: on the Mac run `cd ~/Developer/VENTRA-FEATURES/apps/web && npx next dev --hostname 0.0.0.0`, then open http://<Mac IP>:3000/app. For a link that works anywhere, run `vercel` in apps/web (preview only).

## Master Coordinator (auto)

- Last cycle: c-f2c38241 at 2026-11-13 02:12 AWST · 3 dispatched (A-20, A-73, A-70) · 3 verified and committed · 0 new owner blockers
- Integration branch: agent/develop @ 31ece45c (a587697b A-20 · 7d6f1e01 A-73 · 31ece45c A-70); board commit follows
- Verification: ventra-verify exit 0 after each task (lint, typecheck, unit tests, build, workspace integration; course + launcher FROZEN, P0-7). Full suite per specialist/QA: 1169 total, 1164 pass, 5 todo, 0 fail.
- Behaviour changes: the Receptionist now asks for the name on the booking or its day and time before moving or cancelling; a wrong answer refuses, changes nothing, tells staff once per call and reveals nothing (A-20). A missing "first report" flag now leaves a staff note instead of failing silently (A-73). Setter prompt versions bumped; the Setter Lab only hands off on a real request for a person (A-70).
- Owner decisions (not blocking): A-20 accepts a first name alone as the second factor; recommend first name + surname when stored (A-74). A failed check hands the contact to a person, which also pauses the Setter for that contact.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: unchanged (A-64, W-1 browser check, A-12, A-60, A-14, A-34, P0-10, P0-7; migrations 202611130001/202611130002 to apply live before A-66 code ships).
- Next up: A-74, A-71, A-75, A-76 (backend), A-63 (needs voice@3 pins in scope), A-65, A-62, A-50.

### Previous cycle c-0ba93875

- Last cycle: c-0ba93875 at 2026-11-13 01:45 AWST · 6 built/reworked (A-67, A-68, A-59, A-69, A-72, A-66) + 7 reviews · 6 verified and committed · 0 new owner blockers (2 migrations to apply live)
- Integration branch: agent/develop @ 26894959 (4fcb7f40 A-68 · 87cd18b2 A-59 · 4677e933 A-67 · 3d59f446 A-69 · a5203666 A-72 · 26894959 A-66); board commit follows
- Verification: npm --prefix apps/web test 1142 total, 1137 pass, 5 todo, 0 fail (1129/1122/7 todo at start); lint 0; typecheck 0; ventra-verify exit 0 (course + launcher FROZEN, P0-7).
- Behaviour changes: customer names, messages and reasons are flattened to one line before reaching staff hand-offs/SMS/email (A-67); the database only stores answers to the business's own questions (A-68); "can I talk to a person" hands off and the AI never claims to be human (A-59); a dropped call creates exactly one call-back (A-66/A-72).
- OWNER, DEPLOY ORDER: migrations 202611130001 (save-details guard) and 202611130002 (voice end first flag) are local only. Apply 202611130002 to the live project BEFORE the A-66 code ships, or dropped-call call-backs stop.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: unchanged (A-64, W-1 browser check, A-12, A-60, A-14, A-34, P0-10, P0-7).
- Next up: A-71 (stored dirty names, G12 exact assert), A-70 (Setter prompt version bump), A-73 (A-66 nits), A-63, A-65, A-62, A-50, A-20.

### Previous cycle c-8409421c

- Last cycle: c-8409421c at 2026-11-12 03:06 AWST · 1 dispatched (A-58, ventra-voice) · 0 verified/committed · 0 new owner blockers (spend cap reached before review)
- Integration branch: agent/develop @ 6a63a3e; board commit follows
- Running / implemented (needs reconciling next cycle): A-58 implemented, uncommitted: apps/web/lib/front-office/receptionist/dropped.ts (new), apps/web/lib/front-office/vapi-route.ts (+7/-1), apps/web/test/front-office-receptionist-dropped.test.ts (new). Coordinator checked: 4/4 new tests pass, typecheck clean. Needs ventra-review (Vapi webhook) + full test/lint, then commit.
- Blocked, needs the owner: unchanged (A-64, W-1 browser check, A-12, A-60, A-14, A-34, P0-10, P0-7).
- Next up: A-58 review+commit, then A-65 (also turn R12/G5 todo at scenarios-receptionist.test.ts:400 into a passing check), A-52, A-59.

### Previous cycle c-b5e908f2

- Last cycle: c-b5e908f2 at 2026-11-12 02:35 AWST · 1 dispatched (A-51, ventra-voice) + 1 review · 1 verified and committed · 0 new owner blockers (small spend cap, one task only)
- Integration branch: agent/develop @ fa0e99ad (A-51); board commit follows
- Verification: npm --prefix apps/web test 1096 total, 1091 pass, 5 todo, 0 fail (was 1078); lint 0; typecheck 0. ventra-verify not run (tests only, no persistence/route change). Review: approve with nits -> A-65.
- Result: Receptionist scenario suite R1-R13 + X5 runs in Demo mode with no network and nothing sent. The 000 emergency rule (A-57) is now a passing check. Still-open code gaps shown as todos: G3 operating modes on bookings (A-56, waits A-14) and G5 dropped-call call-back (A-58).
- Running / implemented (needs reconciling next cycle): none. Backup not refreshed (P0-10 still broken).
- Blocked, needs the owner: unchanged: A-64 (fixed customer lines), W-1 browser check (blocks every W- task), A-12, A-60, A-14 (blocks A-7, A-56), A-34 lab key secret, P0-10, P0-7.
- Next up: A-52 (voice, security scenarios), A-58 (voice, dropped-call call-back), A-59, A-65/A-63/A-62/A-50 nits, A-20, A-18 (backend).

### Previous cycle c-4735b672

- Last cycle: c-4735b672 at 2026-11-12 02:04 AWST · 3 dispatched (A-55, A-54, A-61; all ventra-voice, one at a time) + 2 reviews · 3 verified and committed · 1 new owner item (A-64 wording)
- Integration branch: agent/develop @ 7ddb32f6 (1601301a A-55 · 890222e7 A-54 · 7ddb32f6 A-61); board commit follows
- Verification: npm --prefix apps/web test 1078 total, 1077 pass, 1 todo, 0 fail (was 1058 at start); lint 0; typecheck 0. ventra-verify not run (no migration/persistence change).
- Behaviour changes: (A-55) on every channel using the Setter, a model/API failure now sends "Thanks for your message. Someone from the team will get back to you shortly." and hands the lead to a person, instead of an error (chat route 200, not 503). (A-54) a booked contact writing again on web chat or the Setter Lab is told their booking; move/cancel goes to a person; a model reply claiming a booking changed is never sent. (A-61) the Setter Lab now goes quiet after a hand-off, as live does.
- Running / implemented (needs reconciling next cycle): none. Backup not refreshed (P0-10 still broken).
- Blocked, needs the owner: NEW A-64 (approve the new fixed customer lines in setter/agent.ts). Unchanged: W-1 browser check (blocks every W- task; curl to localhost:3020 refused again this cycle), A-12, A-60, A-14 (blocks A-7, A-56), A-34 lab key secret, P0-10, P0-7.
- Next up: A-51, A-52 (QA scenarios, voice), A-58, A-59, A-63/A-62/A-50 nits, A-64 code nits, A-20, A-18 (backend).

### Previous cycle c-a8a636ff

- Last cycle: c-a8a636ff at 2026-11-12 01:33 AWST · 3 dispatched to build (A-48, A-49, A-57) + 1 QA spec (A-28) + 3 reviews · 3 verified and committed · 2 new owner decisions
- Integration branch: agent/develop @ 975dcf85 (ea570fea A-48 · 570d55fd A-49 · 975dcf85 A-57); board commit follows
- Verification: npm --prefix apps/web test 1058 total, 1054 pass, 4 todo, 0 fail (was 1033 at start); lint 0; typecheck 0. ventra-verify not run (no persistence/route change). Reviews: A-48, A-49, A-57 approve with nits (-> A-50, A-62, A-63).
- QA scenario spec saved: docs/agents/briefs/A-28_QA_SCENARIOS.md (S1-S12, R1-R13, X1-X8, gaps G1-G8). Setter suite done (A-49); Receptionist (A-51), security incl. cross-tenant chat (A-52), live file (A-53) queued.
- Behaviour changes: (A-48) on the email runner, follow-ups, reminders and rescues for a contact with phone and email go by email. (A-57) Receptionist prompt voice@2 tells a caller in danger to hang up and call 000; asks to repeat; reads back details. The owner may want to review that wording.
- Found: Setter Lab keeps replying after a hand-off to a person while live goes quiet (A-61). Gaps planned: A-54 returning booked customer, A-55 Setter API-failure recovery, A-56 Receptionist modes for bookings (waits A-14), A-58 dropped-call call-back, A-59 "real person" rule.
- Running / implemented (needs reconciling next cycle): none. Backup not refreshed (P0-10 still broken).
- Blocked, needs the owner: NEW A-12 (Google OAuth app + where each business's calendar token is stored; env single-account calendar already works), NEW A-60 (may the AI give price estimates?). Unchanged: W-1 browser check (blocks every W- task; curl to localhost:3020 still refused this cycle), P0-10 backup script, A-34 lab key secret, A-14 transfer rule (blocks A-7, A-56), P0-7.
- Next up: A-61 (lab hand-off parity), A-54, A-55, A-51, A-52 (all ventra-voice, one at a time), A-50/A-62/A-63 nits, A-18 (backend; touches voice files, plan with care), A-20.

### Previous cycle c-08120d7a

- Last cycle: c-08120d7a at 2026-11-12 00:56 AWST · 7 dispatched (A-43, A-38, A-6, A-44, A-46, A-45, A-47) + 3 reviews · 6 verified and committed · 0 new owner blockers
- Integration branch: agent/develop @ 28b651db (576c9dd1 A-43 · 8fced048 A-38 · 22732105 A-46 · 46268b2c A-44 · fd0073e5 A-45 · 28b651db A-47); board commit follows
- Verification: npm --prefix apps/web test 1030/1030 (was 990 at start of the previous cycle), lint 0, typecheck 0. ventra-verify (after A-38): lint/typecheck/unit/build/workspace-integration PASSED; course + launcher FAILED as frozen (P0-7). Reviews: A-38, A-45, A-47 approve with nits (A-38/A-45 nits closed by A-46/A-47; A-47 nits -> A-48).
- A-6 QA of the Setter website-chat journey: PARTIAL PASS, 0 FAIL. Real calendar and live chat (FRONT_OFFICE_CHAT_LIVE + key) not tested. A-44 now drives the real chat route through real fo_* SQL in all three modes.
- Behaviour change (A-45/A-47): follow-ups use recorded consent. A web-chat/Instagram/Messenger contact who left a mobile no longer gets an SMS follow-up without a recorded grant; an SMS/email STOP also withdraws that channel's consent. Owner may want a way to record consent by hand (needs a member RPC + UI, Workstream B).
- Migration 202611110004 (consent) is local/PGlite only; applying it to the live project needs the owner. Until then the STOP withdraw call fails safely and is logged.
- Running / implemented (needs reconciling next cycle): none. Backup not refreshed (P0-10 still broken; newest complete 2026-11-09 21:55).
- Blocked, needs the owner: unchanged: W-1 browser check (blocks every W- task), P0-10 backup script, A-34 lab key secret, A-14 transfer rule (blocks A-7), P0-7. Real Live AI in either lab needs ANTHROPIC_API_KEY + FRONT_OFFICE_MODEL.
- Next up: A-48 (voice, email runner preference), A-28 QA scenario suites (spec by qa, tests written by voice), A-18 (backend, one approval queue), A-12 (backend, Google Calendar availability), A-20 (voice, caller identity check).

### Previous cycle c-a72d6105

- Last cycle: c-a72d6105 at 2026-11-12 00:25 AWST · 5 dispatched (A-24 fixes, A-31, A-40, A-41, A-42) + 3 reviews · 5 verified and committed · 0 new owner blockers
- Integration branch: agent/develop @ fcbd653d (614a96c2 A-40 · 67eeaf33 A-24 · 3148c5e4 A-31 · 29755f59 A-41 · fcbd653d A-42); board commit follows
- Verification: npm --prefix apps/web test 990/990, lint 0, typecheck 0. ventra-verify (mid-cycle): lint/typecheck/unit/build/workspace-integration PASSED; course + launcher integration FAILED as frozen (known P0-7). Reviews: A-24 request changes -> fixed; A-31 and A-41 approve with nits -> nits fixed.
- Decision taken (A-31): 13/1300/1800 numbers are refused as a customer's phone (cannot get texts, no E.164 form, shared). Owner may overrule.
- Running / implemented (needs reconciling next cycle): none. Backup not refreshed (P0-10 still broken; newest complete 2026-11-09 21:55).
- Blocked, needs the owner: unchanged — W-1 browser check (also A-41 page not browser-checked), P0-10 backup script (no new backup since 2026-11-09 21:55), A-34 lab key secret, A-14 transfer rule (blocks A-7), P0-7. Real Live AI in either lab needs ANTHROPIC_API_KEY + FRONT_OFFICE_MODEL.
- Next up: A-43 (voice, opted-out wording), A-38 (backend, consent records), A-28 QA scenario suites (deps A-23, A-26 done), A-6 QA of the Setter journey; follow-ups to plan: lab per-user rate limit, Receptionist Lab using the owner's saved business settings (backend loader).

### Previous cycle c-0b02c781

- Last cycle: c-0b02c781 at 2026-11-11 02:46 AWST · 1 dispatched (A-24) · 0 verified · 0 new owner blockers (small spend cap of 1.38 USD, so one task only)
- Integration branch: agent/develop @ 371f84e (no code commit this cycle; board commit follows)
- Verification: A-24 preset test 6/6 pass, typecheck 0 (subagent also reports lint 0). Full npm test, ventra-verify and ventra-review not run (budget). Website: W-1 still blocked, no W- task dispatched.
- Running / implemented (needs reconciling next cycle): A-24 implemented, uncommitted: new files apps/web/lib/front-office/templates/presets.ts and apps/web/test/front-office-presets.test.ts. Next cycle: run ventra-review (344 lines), then the full npm test, then commit. W-1 still uncommitted in VENTRA-WEBSITE (unchanged).
- Blocked, needs the owner: W-1 browser check, P0-10 backup script, A-34 lab key secret, A-14 transfer rule (also blocks A-7 operating-mode enforcement on the phone path, which A-26 review confirmed is not enforced yet), P0-7 exec bit. Real Live AI in either lab needs ANTHROPIC_API_KEY + FRONT_OFFICE_MODEL on the server and the owner’s OK.
- Next up: A-24 review + commit, A-41 Receptionist Lab page voice (feature), A-38 or A-31 (backend), A-40 meta-window cases (voice).

### Previous cycle c-df526914

- Last cycle: c-df526914 at 2026-11-11 01:14 AWST · 6 dispatched (A-30, A-25, A-32, A-33, W-1 QA, W-1 fixes) + 5 reviews · 4 verified and committed · 2 blocked (W-1 browser check, P0-10 backup)
- Integration branch: agent/develop @ 0df39bdc (94019acd A-30 · 1cbd748f A-25 · e7ee82fb A-32 · 0df39bdc A-33)
- Verification: ventra-verify lint, typecheck, unit tests (916), build, workspace-integration PASSED; course/launcher integration FAILED as "paused" (frozen, known P0-7: installed ventra-verify lacks the FROZEN status). New migrations 202611110001/0002 are local/PGlite only.
- Running / implemented (needs reconciling next cycle): none. W-1 website shell is uncommitted in VENTRA-WEBSITE (review fixes done, 751/751, lint 0, typecheck 0); commit after the browser check, excluding apps/web/next-env.d.ts and apps/web/test-results/.
- Blocked, needs the owner: W-1: coordinator sessions may not reach localhost:3020 (curl/Playwright refused); allow it or check 390/1440 + mobile menu yourself. P0-10: ventra-backup create aborts because git ls-files lists the 18 tracked-but-deleted files and tar fails under pipefail (no .head, verify exit 1); script has foreign edits, so the owner applies the fix. A-34: needs a server-only lab key secret (32+ chars) in apps/web/.env.local. P0-7 unchanged.
- Proposed UI step (Workstream B, not done): hide kind='lab' workspaces in any workspace picker once A-35 lands.
- Next up: A-37 (voice, Meta approvals in approval route, before A-11), A-35 (backend, sandbox hygiene), A-34 (voice, wire labs to sandbox, after the secret), A-31, A-36, A-38, A-24, A-26.

### Previous cycle c-ef7fc367
- Last cycle: c-ef7fc367 at 2026-11-11 00:43 AWST · 4 dispatched (A-9, A-10, A-16, A-29) + 4 reviews · 4 verified and committed · 0 new owner blockers
- Committed on agent/develop: c9bd2c8e A-10 GET /api/front-office/performance · 85405836 A-9 GET contacts + activity, AU phone/email normalisation · bc7cfbe7 A-16 knowledge base (Setter prompt setter/qualify@2, Receptionist answer_faq) · 8deb3478 A-29 Meta 24h window guard (ladder step 3 now 20h). API_CONTRACTS.md A-9/A-10 sections updated (board commit).
- Verification: npm --prefix apps/web test 890/890 (baseline 851), typecheck 0, lint 0. ventra-verify not run this cycle (no migrations or routes outside front-office API; next cycle should run it).
- Owner decisions (non-blocking): approve the seeded objection replies (A-16); allow merging a chat visitor into an existing contact (A-9, needs migration); confirm "one owner task then stop" when the Meta window closes (A-29).
- Backup FAILED again this cycle: `ventra-backup create` exit 1, no output. Newest complete backup still 2026-11-09 21:55. Needs ventra-devops diagnosis or the owner.
- Next up: A-30 (voice, knowledge follow-ups), A-32 (voice, before A-11), A-31 (backend, CRM follow-ups), A-24 presets, A-25 lab persistence (A-9 done), A-26 Receptionist browser voice; W-1 still needs Playwright.

### Previous cycle c-90917b1a
- Last cycle: c-90917b1a at 2026-11-11 00:12 AWST · 7 dispatched (A-21 review, A-22, A-23, A-23h, A-23b + review, W-1 QA + finish) · 5 verified and committed · 0 new owner blockers
- Owner note 2026-11-10 07:35 handled: planned A-22, A-23 (server) + A-23b (UI), A-24..A-28, plus A-29 (Meta 24h window guard from research). A-9 priority raised to 2 (A-25 depends on it).
- Committed on agent/develop: 58f4bc6b A-22 research (docs/agents/FRONT_OFFICE_RESEARCH.md) · 4ea05b17 A-21 modes + approval-queue routes · 0b5bd67b A-23 Live AI Test engine · af563b9c A-23h hardening · 6f905221 A-23b Setter Lab UI.
- Integration branch: agent/develop @ 6f90522 (board commit follows)
- Verification: npm --prefix apps/web test 851/851, typecheck 0, lint 0, next build OK. ventra-verify (after A-23): lint/typecheck/unit/build/workspace-integration PASSED; course-integration + launcher-integration FAILED (pre-existing, frozen features, P0-7). All five changes reviewed by ventra-review: approve with nits.
- Setter Lab Live AI Test (milestone 1, partly): /tools/setter-lab → Live AI Test, signed in, real model through the same Setter agent, sandboxed, A$5/day cap (FRONT_OFFICE_LAB_DAILY_CAP_AUD). NOT YET TRIED with a real call or in a browser (no Playwright; local server fetch needs approval). Cap store is per process until A-25. Lab bookings are in-memory until A-25 (not in CRM yet).
- Running / implemented (needs reconciling next cycle): W-1 implemented, UNCOMMITTED in ~/Developer/VENTRA-WEBSITE. This cycle: QA code PASS WITH NITS; --faint contrast fixed (#647176, ≥4.65:1); docs/agents/SITE_DESIGN.md written in the worktree; contrast test added (748/748). Only the 390/1440 browser check is missing → blocked on tooling (Playwright not installed; curl/npx denied to subagents). Then commit in the worktree (exclude next-env.d.ts, test-results/).
- Review follow-ups not yet tasks: A-21 nits (fetch item by id RPC, revision int4 cap, Receptionist owner_approval items can never be approved yet); A-23b nits (per-user rate limit on Live, getLabUsage anonymous).
- HANDOFF note "send mobile preview link to Dylan on Telegram" still open: no Telegram chat id available in coordinator cycles (only incoming messages carry it).
- W-0: docs/agents/WEBSITE_AUDIT.md. Key risks: checkout is frozen (423) in shared scope-freeze.ts; /api/checkout takes the client price (must look up server-side); glass kit not on frontend/website-ui.
- Blocked, needs the owner: unchanged from c-9286948e (A-14 transfer rule, A-2 local migration, M-1, M-2, M-4, P0-7, M-0 items, A-4 emergency wording, P1-6). New owner needs from W-0: Stripe test keys/products/prices, un-freeze checkout decision, domain + analytics account, legal read of privacy/terms.
- Note: pending foreign changes left uncommitted and untouched (same list as before).
- Blocked, new this cycle: browser checks (W-1, A-23b) need Playwright installed as a dev dependency or the owner to run them.
- Backup FAILED: newest good backup 2026-11-09 21:55; `ventra-backup create` exited 1 with no output (twice) and `ventra-backup verify` reports missing ~/Backups/ventra/ventra-20261111-002936-56732fc.head (partial backup left in place, not deleted). scripts/agents/ventra-backup has uncommitted foreign edits; ventra-devops should diagnose next cycle.
- Next up: A-16 knowledge base (voice) → A-24 presets; A-9 (backend) → A-25 lab persistence; A-26 Receptionist browser voice (voice, after A-16 or in parallel with backend); A-29 window guard; W-1 browser check + commit, then W-2/W-8.

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

## VENTRA Glass v2 on glasscn (2026-11-09, owner asked to "use glasscn for whatever uses glass")

- App look is now **VENTRA Glass**, built on glasscn (MIT, kostyniuk/glasscn-components). Reference for building screens: design system https://claude.ai/artifact/GcMeCNBwhLtUB1QBNNsogN (README has the element → glasscn component + glassVariant table). Owner-facing screen designs: https://claude.ai/artifact/MKN6B76iaFZmfNdCWWntfb
- Code: `components/ui/glasscn/*` + `components/ui/*` (shadcn base), `lib/glass-variants.ts`, `lib/utils.ts`, `app/design-system/glass/ventra-glass.css` (Tailwind v4 without preflight + tokens scoped to `.vg-app`), `app/design-system/liquid-glass/components.tsx` (same API as v1, now glasscn), `app.css` (shell + legacy bridge). `globals.css` element rules are now in `@layer base`.
- After pulling: run `npm install` in apps/web (new deps: Tailwind v4, Base UI, lucide-react, fontsource). Vercel installs them itself.
- Commit author for Vercel deploys must be founder@aiventrai.com (the Vercel account email), or the deploy is blocked.

## Mobile app in Liquid Glass (2026-11-09, branch `feature/mobile-app`, off `feature/ventra-website` e011f27)

Owner asked (09 Nov, from the Build Plan + Blueprint + Liquid Glass rules PDFs): start building, mobile first. Not deployed.
The uncommitted pre-Liquid-Glass edits to `design-system/theme.css` + `tokens.css` were parked in `git stash` ("pre-liquid-glass restyle ... parked 2026-11-09"), not deleted.

- App shell rebuilt to the approved look (`app/ui/ventra-shell.tsx`): lit wall → one glass sheet → top bar (wordmark with the new ribbon V, search, notifications, account menu) → content → fixed bottom nav with safe-area inset. From 1024px the nav becomes a glass sidebar with Create and theme. Pearl/Night via `data-theme` on `<html>`.
- Navigation is now the blueprint's five areas: Home `/app` (also `/`), Create, Customers, Grow, Money (`lib/ventra-navigation.ts`). More moved into the account menu. `/app` exists because on aiventra.com.au "/" is the marketing site.
- Library: `app/design-system/liquid-glass/` = tokens.css (scoped to `.vg-app`, type classes prefixed `vg-t-`), glass.css (copy of the approved file), app.css (shell, page patterns, globals.css neutralisers, and the **legacy bridge**), components.tsx (TSX port of components.js + ListRow, SectionHead, PageHead).
- Legacy bridge: screens not rebuilt yet render inside `<Legacy>` (`.ventra-app.vg-legacy`); their `--v-*` tokens point at Liquid Glass tokens so everything sits on the same glass. Tools, workspace, settings, onboarding, services, sales, business, inbox, insights, more use it.
- Native Liquid Glass screens: Home (`app/ui/ventra-home.tsx`), Create/Customers/Grow/Money tops (`app/ui/ventra-areas.tsx`), Growth Audit wizard `/grow/audit`.
- Live numbers: `GET /api/front-office/summary?workspace=&tz=` (members only, RLS, counts only, no contact details; `lib/front-office/summary.ts`), used by `app/ui/live-summary.ts`. Not signed in / not configured = "—" and one honest notice.
- Growth Audit calculator (blueprint §18 formula): `lib/growth-opportunity.ts` + `app/ui/growth-opportunity.tsx`. One question at a time, Back/Skip, resumes from this browser, ranked findings with evidence, confidence and adjustable assumptions, "estimate, not a promise". Test page `/tools/growth-opportunity`.
- AI team settings now has a customer route `/customers/ai-team` (same component as `/tools/front-office-settings`, moved to `app/ui/ai-team-settings.tsx`).
- Installable app: `app/manifest.ts` (start `/app`), `app/icon.png`, `app/apple-icon.png`, `public/brand/*` from the owner's ribbon-V logo; viewport-fit cover + theme colours in `(ventra)/layout.tsx`.
- Tests: new `front-office-summary.test.ts`, `growth-opportunity.test.ts`; `ventra-home.test.ts` updated for the five areas. Cloud container Node 22.23: 610 pass, 0 fail; tsc, eslint and `next build` pass. Playwright at 390px and 1440px, Pearl and Night: no horizontal scroll, no page errors; nav, account menu, search, Create dialog and the full audit flow checked.
- Not done yet: native rebuilds of onboarding, Business/offers, inbox, settings (still on the bridge); live numbers need sign-in + migrations on production; notifications feed is a placeholder card.

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

- App look is now the real `liquid-glass-react` component (wrapper `apps/web/components/ui/liquid-glass-card.tsx`); rules in `docs/design/UI_BIBLE.md`, kit `apps/web/components/glass/`, live gallery `/lab/components` on branch `ui/lab`. The old Liquid Glass spec, UI guide and reference images were retired on 2026-11-09. Old design-system pages on claude.ai deleted. Live screens still use `app/design-system/*` and `components/ui/glasscn` until rebuilt screen by screen.
- Applies to the app only; `apps/web/app/site/**` (marketing website) is unchanged.
- Not started: porting the app shell and Home to this look (owner said go after approving the kit).

## Acceptance criteria

Tracker Phase 0: 0.1 scope freeze, 0.2 orchestrator, 0.3 lead store + state machine, 0.4 handoff schema,
0.5 SMS webhook, 0.6 outbound log with prompt version, 0.7 gate (a text creates a contact with a state).

## Git state (auto)

<!-- git-state:start -->
_Generated 2026-11-13 01:59 by `ventra-handoff snapshot`. Do not hand-edit this block._
- Branch: `agent/develop`
- HEAD: `31ece45 fix(setter): bump prompt versions after the A-59 person-request text (setter/qualify@3, setter/returning-booked@2); Setter Lab only hands off on a real request to talk to a person; tests for booked contacts asking for a person and ordinary messages [A-70]`
- Lock: coordinator (pid 89816, 32 min old)
- Uncommitted changes:
```text
 M HANDOFF.md
 M docs/agents/TASKS.md
 M docs/agents/TASK_BOARD.json
```
- Diff stat vs HEAD:
```text
 HANDOFF.md                  |  11 +++
 docs/agents/TASKS.md        |   9 +-
 docs/agents/TASK_BOARD.json | 236 +++++++++++++++++++++++++++++++++++++++-----
 3 files changed, 226 insertions(+), 30 deletions(-)
```
- Recent commits:
```text
31ece45 fix(setter): bump prompt versions after the A-59 person-request text (setter/qualify@3, setter/returning-booked@2); Setter Lab only hands off on a real request to talk to a person; tests for booked contacts asking for a person and ordinary messages [A-70]
7d6f1e0 fix(receptionist): missing fo_voice_end first flag leaves a staff-visible dispatch event (no call-back, none for settled calls); duplicates stay quiet; shared logDispatch; tests for sequential duplicates, fo_contact_context failure and exact simulator counts [A-73]
a587697 feat(receptionist): caller must confirm the booking name or day and time before reschedule/cancel; a wrong detail refuses, changes nothing, hands off to staff once per call (lock persists across turns via call marker), stored name cannot be overwritten by an unverified caller, no booking details leaked; prompt receptionist/voice@3 [A-20]
74d80b8 chore(coordinator): cycle c-0ba93875 board and handoff
2689495 fix(receptionist): dropped-call call-back only on the first end-of-call report (fo_voice_end first flag), visible dispatch event when the hand-off fails, Lab and simulator use the same recordDroppedCall, explicit endedReason allow-list incl. exceeded-max-duration [A-66]
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
