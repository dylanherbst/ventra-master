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

- Last cycle: c-79d5e30f at 2026-11-14 03:25 AWST · 2 dispatched (AMP-041, AMP-034, both Sonnet) + 1 review (approve) · 2 verified locally, 0 committed · 0 new owner blockers
- Integration branch: agent/develop @ a94d531 (board commit follows). AMP repo: ~/Developer/AIMONEYPRINTER aimp/foundation @ 2085c70 + UNCOMMITTED verified work (now 18 tasks). Coordinator checks: lint 0, typecheck 0, npm test 1508 / 1502 pass / 0 fail / 1 skipped / 5 todo.
- AMP-005-D re-checked: `cd ~/Developer/AIMONEYPRINTER` is refused (only VENTRA-FEATURES allowed). Not worked around.
- Commit these when AMP-005-D clears (after the lists below, one commit per task):
  - AMP-034: apps/web/lib/aimp/storefront/schema.ts apps/web/lib/aimp/site-versions/store.ts apps/web/test/aimp-site-versions-rework.test.ts (after AMP-030, AMP-031, AMP-032, which share these files)
  - AMP-041: apps/web/lib/aimp/orders/ apps/web/lib/aimp/checkout/ apps/web/app/api/aimp/checkout/ apps/web/app/api/aimp/webhooks/ apps/web/app/tools/aimp-checkout/ apps/web/test/aimp-checkout-service.test.ts apps/web/test/aimp-orders-paid.test.ts (after AMP-023, AMP-024, AMP-040)
- AMP-041 follow-ups: orders + payment_events migration (unique (workspace_id, listing_id, idempotency_key), unique checkout_session_id, event_id PK, conditional pending→paid update); store directory is a demo table (resolve from published site version later); review lows: failed order not retryable with same key, replay does not compare buyerEmail, in-memory growth, body cap counts chars. AMP-042 can use checkout.onOrderPaid / isDeliverable / createOrderBook.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: AMP-005-D (add ~/Developer/AIMONEYPRINTER as an allowed directory for coordinator cycles; 18 verified tasks waiting), AMP-043-D Stripe test keys, AMP-052-D Pinterest app.
- Leftover temp files (safe to delete, not committed): docs/agents/.cycle-c79d*.{mjs,json,jq} plus older .cycle-* files.
- Next up: commit the 18 tasks; then AMP-042 (fulfilment, now unblocked by AMP-041), AMP-050, AMP-053, AMP-045, AMP-061, AMP-062.

### Previous cycle c-712dc75a

- Last cycle: c-712dc75a at 2026-11-14 03:00 AWST · 3 dispatched (AMP-023, AMP-032, AMP-060, all Sonnet) + 3 reviews (1 approve, 2 request changes) + 3 fix rounds · 3 verified locally, 0 committed · 0 new owner blockers
- Integration branch: agent/develop @ d03c51c (board commit follows). AMP repo: ~/Developer/AIMONEYPRINTER aimp/foundation @ 2085c70 + UNCOMMITTED verified work (now 16 tasks). Coordinator checks: lint 0, typecheck 0, npm test 1487 / 1481 pass / 0 fail / 1 skipped (qpdf) / 5 todo.
- AMP-005-D re-checked this cycle: `ventra-git` in the AMP repo still answers "requires approval". Not worked around.
- Commit these when AMP-005-D clears (after the lists below, one commit per task):
  - AMP-023: apps/web/lib/aimp/catalogue/ apps/web/app/tools/catalogue/ apps/web/test/aimp-catalogue-pricing.test.ts apps/web/test/aimp-catalogue-service.test.ts (after AMP-020, AMP-022, AMP-024)
  - AMP-032: apps/web/lib/aimp/hosts/ apps/web/proxy.ts apps/web/app/sitemap.ts apps/web/app/robots.ts apps/web/lib/aimp/storefront/tenant.ts apps/web/lib/aimp/storefront/load.ts "apps/web/app/s/[store]/" apps/web/test/aimp-hosts-resolve.test.ts apps/web/test/aimp-hosts-seo.test.ts (after AMP-030 and AMP-031; shares load.ts and layout.tsx with AMP-030)
  - AMP-060: apps/web/lib/aimp/jobs/ apps/web/app/tools/aimp-jobs/ apps/web/test/aimp-jobs-runner.test.ts apps/web/test/aimp-jobs-handlers.test.ts (after AMP-004)
- Owner decisions (non-blocking, reversible): catalogue platform fee 0% (estimate), price bounds A$3–A$100, family default price bands invented; `www.<root>` treated as platform host; /api reachable on store hosts until AMP-041; failed jobs can be retried with the same key. New env NAMES only (no values): AIMP_STORE_TEST_DOMAIN, AIMP_PUBLIC_ASSET_HOSTS.
- Follow-ups queued: AMP-034 (slug 63→42 in storefront/schema.ts and site-versions), AMP-045 (provider idempotency keys). Also: jobs migration + runner trigger route, DB-backed StoreRegistry (live sitemap empty until then), wire catalogue listings into storefront and checkout (AMP-041).
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: AMP-005-D (add ~/Developer/AIMONEYPRINTER as an allowed directory for coordinator cycles; 16 verified tasks waiting), AMP-043-D Stripe test keys, AMP-052-D Pinterest app.
- Leftover temp files (safe to delete, not committed): docs/agents/.cycle-c712*.{mjs,json,jq} plus older .cycle-* files. Foreign uncommitted changes left alone: README.md, COORDINATOR.md, STATUS.md, scripts/agents/ventra-coord, ventra-coordinator, ventra-master.
- Next up: commit the 16 tasks; then AMP-041 (checkout + order records, now unblocked by AMP-023), AMP-050 (launch campaign, unblocked by AMP-023), AMP-053 (opt-in/CRM, unblocked by AMP-032), AMP-034, AMP-045, AMP-061.

### Previous cycle c-f428b679

- Last cycle: c-f428b679 at 2026-11-14 01:34 AWST · 3 dispatched (AMP-020, AMP-024, AMP-031, all Sonnet) + 3 reviews (all "request changes") + 3 rework rounds · 3 verified locally, 0 committed · 0 new blockers
- Integration branch: agent/develop @ 8e55095 (board commit follows). AMP repo: ~/Developer/AIMONEYPRINTER aimp/foundation @ 2085c70 + UNCOMMITTED verified work (now 13 tasks). Coordinator checks after rework: lint 0, typecheck 0, npm test 1376 / 1370 pass / 0 fail / 1 skipped (qpdf) / 5 todo.
- Commit these when AMP-005-D clears (after the lists below, one commit per task):
  - AMP-020: apps/web/lib/aimp/branding/ apps/web/app/tools/aimp-branding/ apps/web/test/aimp-branding-generate.test.ts apps/web/test/aimp-branding-service.test.ts
  - AMP-024: apps/web/lib/aimp/files/ "apps/web/app/api/aimp/files/[token]/route.ts" apps/web/app/tools/secure-files/ apps/web/test/aimp-files-delivery.test.ts (imports products: commit after AMP-022)
  - AMP-031: apps/web/lib/aimp/site-versions/ apps/web/app/tools/site-publish/ apps/web/test/aimp-site-versions-lifecycle.test.ts apps/web/test/aimp-site-versions-isolation.test.ts apps/web/test/aimp-site-versions-rework.test.ts (imports storefront: commit after AMP-030)
- Follow-ups: store renders named themes only, not the exact brand palette (AMP-020 → storefront); live file storage + download_grants table not built, live route answers 503 (AMP-024); wire /s/[store] to published versions, align slug length rules, site-version DB mapping (carried onto AMP-032). New env NAMES only (no values set): AIMP_FILES_SIGNING_SECRET, AIMP_TOOLS_ENABLED.
- Owner decision made by the coordinator on review advice (reversible): a paid buyer keeps downloading the version they bought after a newer version is approved; withdrawing a faulty file needs a separate recall.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: AMP-005-D (add ~/Developer/AIMONEYPRINTER as an allowed directory for coordinator cycles; 13 verified tasks waiting), AMP-043-D Stripe test keys, AMP-052-D Pinterest app.
- Leftover temp files (safe to delete, not committed): docs/agents/.cycle-cf42*.{mjs,json} and older .cycle-c960*/.cycle-*.jq. Foreign uncommitted changes left alone: README.md, COORDINATOR.md, STATUS.md, scripts/agents/ventra-coord, ventra-coordinator, ventra-master.
- Next up: commit the 13 tasks; then AMP-023 (catalogue and pricing, now unblocked by AMP-020 + AMP-022), AMP-060 (job orchestration), AMP-032 (hostname routing + /s/[store] wiring, unblocked by AMP-031).

### Previous cycle c-960d5bfe

- Last cycle: c-960d5bfe at 2026-11-14 01:40 AWST · 4 dispatched (AMP-013, AMP-021, AMP-040, AMP-022, all Sonnet) + 4 reviews + 4 rework rounds · 4 verified locally, 0 committed · 0 new blockers
- Integration branch: agent/develop @ a4a22e0 (board commit follows). AMP repo: ~/Developer/AIMONEYPRINTER aimp/foundation @ 2085c70 + UNCOMMITTED verified work (now 10 tasks). Coordinator checks: lint 0, typecheck 0, npm test 1285 / 1279 pass / 0 fail / 1 skipped (qpdf not installed) / 5 todo.
- Commit these when AMP-005-D clears (after the c-a7fe8df1 and c-aa359f36 lists below, one commit per task):
  - AMP-013: apps/web/lib/aimp/selection/ apps/web/app/tools/opportunity-select/ apps/web/test/aimp-selection-select.test.ts
  - AMP-021: apps/web/lib/aimp/factory/ apps/web/app/tools/product-factory/ apps/web/test/aimp-factory-pdf.test.ts apps/web/test/aimp-factory-zip.test.ts apps/web/test/aimp-factory-request.test.ts
  - AMP-040: apps/web/lib/aimp/sellers/ apps/web/app/tools/seller-readiness/ apps/web/test/aimp-sellers-readiness.test.ts
  - AMP-022: apps/web/lib/aimp/products/ apps/web/app/tools/product-review/ apps/web/test/aimp-products-lifecycle.test.ts (imports factory: commit after AMP-021)
  - Do NOT commit apps/web/test/.tmp/ (test output; add `apps/web/test/.tmp/` to the AMP repo .gitignore).
- Independent check: coordinator rendered a 48-page wedding planner PDF from the factory and opened it in macOS Quartz (sips); cover renders cleanly with the DEMO footer. Other pages not viewed. No browser checks of the four /tools pages (local HTTP needs approval).
- Follow-ups: merchant_accounts needs details_submitted, disabled_reason, past_due, capability statuses, last_event_created (AMP-040); Stripe webhook signature check before applyAccountUpdated (AMP-043-D); storefront purchaseState should use checkoutGate (AMP-041); approved product bytes are re-rendered, not stored (AMP-024); selection needs a DB select_business_once RPC + jobs table (AMP-060); live LLM adapter does not exist yet.
- Owner decisions (non-blocking): regenerate limit 5 per product; buyer file = ZIP (A4 + Letter PDFs + README); default demo price A$12 in selection preview.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: AMP-005-D (add ~/Developer/AIMONEYPRINTER as an allowed directory for coordinator cycles; 10 verified tasks waiting), AMP-043-D Stripe test keys, AMP-052-D Pinterest app.
- Leftover temp files from this cycle (safe to delete, not committed): docs/agents/.cycle-c960*.{mjs,json,jq,ts,pdf,png}. Foreign uncommitted changes left alone: README.md, COORDINATOR.md, STATUS.md, scripts/agents/ventra-coord, ventra-coordinator, ventra-master, scripts/agents/.cycle-*.jq.
- Next up: commit the ten tasks; then AMP-020 (branding, unblocked by AMP-013), AMP-024 (private master files, unblocked by AMP-022), AMP-060 (job orchestration), AMP-023 after AMP-020.

### Previous cycle c-a7fe8df1

- Last cycle: c-a7fe8df1 at 2026-11-14 01:15 AWST · 4 dispatched (AMP-004, AMP-011, AMP-012, AMP-010, all Sonnet) + 3 reviews + 4 rework rounds · 4 verified locally, 0 committed · 0 new blockers
- Integration branch: agent/develop @ 8cff670 (board commit follows). AMP repo: ~/Developer/AIMONEYPRINTER aimp/foundation @ 2085c70 + UNCOMMITTED verified work. Coordinator checks: lint 0, typecheck 0, npm test 1212 / 1207 pass / 5 todo / 0 fail.
- Commit these when AMP-005-D clears (one commit per task; AMP-003 and AMP-030 file lists below under c-aa359f36):
  - AMP-004: apps/web/lib/aimp/flags.ts apps/web/lib/aimp/providers/ apps/web/test/aimp-providers-registry.test.ts
  - AMP-011: apps/web/lib/aimp/blueprints/ apps/web/test/aimp-blueprint-library.test.ts
  - AMP-012: apps/web/lib/aimp/opportunities/ apps/web/app/tools/opportunity-finder/ apps/web/test/aimp-opportunity-finder.test.ts
  - AMP-010: apps/web/lib/aimp/onboarding/ apps/web/app/tools/aimp-onboarding/ apps/web/test/aimp-onboarding-model.test.ts apps/web/test/aimp-onboarding-store.test.ts (imports opportunities: commit after AMP-012)
- Not browser-checked: /tools/opportunity-finder, /tools/aimp-onboarding, /s/iron-and-oak (local HTTP needs approval in coordinator sessions).
- Owner decisions (non-blocking): provider credential variable names in providers/status.ts are guesses; blueprint input ranges and A$ cost defaults are placeholders; finder startup cost includes the optional A$20 promotion; onboarding uses a demo identity key until a sign-in hook is wired.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: AMP-005-D (add ~/Developer/AIMONEYPRINTER as an allowed directory for coordinator cycles; 6 verified tasks waiting), AMP-043-D Stripe test keys, AMP-052-D Pinterest app.
- Leftover: scripts/agents/.cycle-*.jq from the previous cycle (temp, safe to delete). Foreign uncommitted changes left alone: README.md, COORDINATOR.md, STATUS.md, scripts/agents/ventra-coord, ventra-coordinator, ventra-master.
- Next up: commit the six tasks; then AMP-013 (opportunity preview and selection, now unblocked), AMP-021 (Product Factory v1, unblocked by AMP-011 + AMP-004), AMP-060 (job orchestration).

### Previous cycle c-aa359f36

- Last cycle: c-aa359f36 at 2026-11-14 00:45 AWST · 2 dispatched (AMP-003, AMP-030, both Sonnet) + 1 review + 1 rework · 2 verified locally, 0 committed · 1 new owner blocker (AMP-005-D)
- Workstream: AiMoneyPrinter only (owner note 2026-11-13 20:55 handled; 21 queued VENTRA tasks on TASK_BOARD/WEBSITE_BOARD set to deferred, note "VENTRA archived 2026-11-13").
- AMP repo: ~/Developer/AIMONEYPRINTER aimp/foundation @ 2085c70 + UNCOMMITTED verified work. Checks by coordinator: lint 0, typecheck 0, npm test 1147 / 1142 pass / 5 todo / 0 fail.
- Commit these when AMP-005-D clears (one commit per task):
  - AMP-003: supabase/migrations/202611140001_aimp_commerce_core.sql apps/web/lib/aimp/contracts.ts apps/web/lib/aimp/data/rows.ts apps/web/lib/aimp/data/index.ts apps/web/test/aimp-data-isolation.test.ts apps/web/test/aimp-data-rows.test.ts apps/web/test/aimp-data-chain.test.ts (re-review the rework diff first: composite FKs, lab refusal, engines_for_model, asset qa_status).
  - AMP-030: apps/web/lib/aimp/storefront/demo-store-b.ts apps/web/lib/aimp/storefront/render-config.ts apps/web/lib/aimp/storefront/load.ts "apps/web/app/s/[store]/layout.tsx" apps/web/test/aimp-storefront-multi.test.ts
- Follow-ups: docs/aimp/proposed/aimp_commerce_core.sql is superseded (mark or remove); load.ts line-1 comment still says only one fixture; checkNewProduct now needs the business model; browser check of /s/iron-and-oak not done.
- Running / implemented (needs reconciling next cycle): none (AMP-003, AMP-030 verified, uncommitted).
- Blocked, needs the owner: AMP-005-D (allow coordinator cycles to work in ~/Developer/AIMONEYPRINTER: add it as an allowed directory in the launcher); AMP-043-D Stripe test keys; AMP-052-D Pinterest app.
- Leftover: scripts/agents/.cycle-aimp.jq and .cycle-defer.jq (temporary, created this cycle; deleting was refused). Safe to delete. Foreign uncommitted changes left alone: README.md, COORDINATOR.md, STATUS.md, scripts/agents/ventra-coord, ventra-coordinator, ventra-master.
- Next up: commit AMP-003/030, then AMP-004 (env/adapters/flags) and AMP-011 (blueprint library), both now unblocked.

### Previous cycle c-a3429447

- Last cycle: c-a3429447 at 2026-11-13 04:40 AWST · 4 dispatched (A-65, A-62, A-50, A-53) + 4 reviews · 4 verified and committed · 1 new owner decision (A-79)
- Integration branch: agent/develop @ 599b2522 (cc44355a A-65 · 252a3d4b A-62 · 045e4e9c A-50 · 599b2522 A-53); board commit follows
- Verification: ventra-verify PASSED after each of A-62, A-50, A-53 (lint, typecheck, unit tests, build, workspace integration; course + launcher FROZEN, P0-7).
- Changes (tests only, plus one comment in jobs.ts): scenario suites now say plainly which checks are scripted (not real-model coverage); the 000 emergency rule is asserted by its text; S12b is its own scenario; the recorder never hides the original failure. New live-model QA file (A-53) runs only with FRONT_OFFICE_QA_LIVE=1, a key and a model id, capped (default 100 calls / A$3); never run by the coordinator. A-28 umbrella closed.
- OWNER: A-79 decide email-runner reminders/rescues (email first even with a mobile; SMS fallback not consent-checked as transactional; recommendation keep). Optional: run the live QA file yourself (chargeable).
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: A-79, A-64, A-14 (blocks A-7/A-56/A-13), A-60, A-12, P0-10, P0-7, W-1 browser check (localhost:3020 still needs approval; blocks all W- tasks), M-1/M-2/M-4 review; lab secret FRONT_OFFICE_LAB_KEY_SECRET (see previous cycle).
- Cycle c-ceead848: A-80 done (7159570b), ventra-verify PASSED. Note: single-file `node --test` needs a permission prompt for subagents; the full unit-tests glob covers it.
- Next up: A-11 (WhatsApp inbound remains, Meta exists; owner should be ventra-voice), lab-usage price table lacks Claude 5.x ids (new task), M-3 Reels when budget allows.

### Previous cycle c-4f349d12

- Last cycle: c-4f349d12 at 2026-11-13 04:15 AWST · 2 reconciled (A-27, A-63) + 2 dispatched (A-34, A-78) + 2 reviews · 4 verified and committed · 1 owner action (lab secret)
- Integration branch: agent/develop @ 26d51e5e (e01a0994 A-63 · 4aed25bb A-27 · 2af933aa A-34 · 26d51e5e A-78); board commit follows
- Verification: ventra-verify exit 0 after A-78 (lint, typecheck, unit tests, build, workspace integration; course + launcher FROZEN, P0-7). Suite: 1215 total, 1210 pass, 5 todo, 0 fail.
- Behaviour changes: Receptionist tells unsure callers to call 000 and ends the call only after the note offer is answered (voice@4, A-63). New /tools/front-office-lab overview: both labs, modes, spend, cross-channel check that recognises a Setter-qualified contact only after the identity check (A-27). Setter and Receptionist Labs now save to a per-user lab sandbox in Supabase (reset, save/load scenarios, persistence indicator), else run in memory and say why; lab errors never show raw database text (A-34, A-78).
- OWNER: add FRONT_OFFICE_LAB_KEY_SECRET (any random string of 32+ characters, server-only) to apps/web/.env.local, restart the dev server, sign in and try both lab pages; until then the labs run in memory. Commit-scanner note: never name a constant *SECRET* when it holds a long string (the env-name constant is LAB_KEY_ENV_NAME).
- OWNER, DEPLOY ORDER: unchanged: migration 202611130004 joins 202611130001-0003 for the live front-office release.
- Running / implemented (needs reconciling next cycle): none.
- Blocked, needs the owner: A-64, W-1 browser check, A-12, A-60, A-14 (transfer decision, blocks A-7/A-56/A-13), P0-10, P0-7; A-34 database mode needs the lab secret above. Backup refreshed: ventra-20261113-040418-26d51e5 created and verified PASS (restore, commit 26d51e5 present, 1124 files).
- Next up: A-65, A-62, A-50 (voice review nits), A-53 (live QA file), A-11 (Meta/WhatsApp inbound: owner should be ventra-voice, scope is code), A-27 review nits; A-34 known limits (past-dated bookings in fo_contact_context needs a migration; jobs runner lab-workspace guard) worth new tasks.

### Previous cycle c-f2c38241

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
_Generated 2026-11-14 02:52 by `ventra-handoff snapshot`. Do not hand-edit this block._
- Branch: `agent/develop`
- HEAD: `a94d531 chore(coordinator): cycle c-712dc75a board and handoff; AMP-023, AMP-032, AMP-060 verified locally (Sonnet, reviewed, reworked, 1487 tests 0 fail), held uncommitted in the AMP repo by AMP-005-D; follow-ups AMP-034, AMP-045`
- Lock: coordinator (pid 20686, 10 min old)
- Uncommitted changes:
```text
 M HANDOFF.md
 M README.md
 M docs/agents/AIMP_BOARD.json
 M docs/agents/COORDINATOR.md
 M docs/agents/STATUS.md
 M docs/agents/TASKS.md
 M scripts/agents/ventra-coord
 M scripts/agents/ventra-coordinator
 M scripts/agents/ventra-master
?? docs/agents/.cycle-c712-1.json
?? docs/agents/.cycle-c712-2.json
?? docs/agents/.cycle-c712-3.json
?? docs/agents/.cycle-c712-4.json
?? docs/agents/.cycle-c712-5.json
?? docs/agents/.cycle-c712-6.json
?? docs/agents/.cycle-c712-run.jq
?? docs/agents/.cycle-c712.mjs
?? docs/agents/.cycle-c79d-1.json
?? docs/agents/.cycle-c79d-2.json
?? docs/agents/.cycle-c79d-start.jq
?? docs/agents/.cycle-c79d.mjs
?? docs/agents/.cycle-c960-1.json
?? docs/agents/.cycle-c960-2.json
?? docs/agents/.cycle-c960-3.json
?? docs/agents/.cycle-c960-p1.png
?? docs/agents/.cycle-c960-pdf.ts
?? docs/agents/.cycle-c960-sample.pdf
?? docs/agents/.cycle-c960.jq
?? docs/agents/.cycle-c960.mjs
?? docs/agents/.cycle-cf42-1.json
?? docs/agents/.cycle-cf42-2.json
?? docs/agents/.cycle-cf42-3.json
?? docs/agents/.cycle-cf42-4.json
?? docs/agents/.cycle-cf42-5.json
?? docs/agents/.cycle-cf42.mjs
?? scripts/agents/.cycle-aimp.jq
?? scripts/agents/.cycle-defer.jq
```
- Diff stat vs HEAD:
```text
 HANDOFF.md                        |  14 +++++
 README.md                         |   2 +
 docs/agents/AIMP_BOARD.json       | 126 ++++++++++++++++++++++++++++++--------
 docs/agents/COORDINATOR.md        |  46 +++++++++++++-
 docs/agents/STATUS.md             |   2 +
 docs/agents/TASKS.md              |   3 +-
 scripts/agents/ventra-coord       |   6 ++
 scripts/agents/ventra-coordinator |  33 ++++++----
 scripts/agents/ventra-master      |   3 +-
 9 files changed, 192 insertions(+), 43 deletions(-)
```
- Recent commits:
```text
a94d531 chore(coordinator): cycle c-712dc75a board and handoff; AMP-023, AMP-032, AMP-060 verified locally (Sonnet, reviewed, reworked, 1487 tests 0 fail), held uncommitted in the AMP repo by AMP-005-D; follow-ups AMP-034, AMP-045
d03c51c chore(coordinator): cycle c-f428b679 board and handoff; AMP-020, AMP-024, AMP-031 verified locally (Sonnet, reviewed, reworked, 1376 tests 0 fail), held uncommitted in the AMP repo by AMP-005-D
8e55095 chore(coordinator): cycle c-960d5bfe board and handoff; AMP-013, AMP-021, AMP-040, AMP-022 verified locally (Sonnet, reviewed, 1285 tests 0 fail), held uncommitted in the AMP repo by AMP-005-D
a4a22e0 chore(coordinator): cycle c-a7fe8df1 board and handoff; AMP-004, AMP-011, AMP-012, AMP-010 verified locally (Sonnet, reviewed, 1212 tests 0 fail), held uncommitted in the AMP repo by AMP-005-D
8cff670 chore(coordinator): cycle c-aa359f36 board and handoff; AiMoneyPrinter only: AMP-001/001-D done, AMP-003/030 verified (uncommitted in AMP repo, AMP-005-D), VENTRA queued tasks deferred, AMP audit added
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
