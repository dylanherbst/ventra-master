# AMP-001 · AiMoneyPrinter reuse audit

Written 2026-11-13 by the master session from the files on this Mac (evidence level: **Local**, read-only inspection;
tests not re-run because the worktree's git link is broken — see AMP-001-D). Product reference: *AiMoneyPrinter Master
Business Plan* (Nov 2026, `~/Documents/AI MONEY PRINTER/AIMoneyPrinter Business Plan.pdf`); build order: AMP backlog in
`docs/agents/AIMP_BOARD.json`.

## Where the work lives

| Item | Value |
| --- | --- |
| Worktree | `~/Developer/AIMONEYPRINTER` (git worktree of `~/Developer/VENTRA-CLEAN/.git`) |
| Branch | `aimp/foundation` @ `04e0080` (= `agent/develop` of 12 Nov) |
| Uncommitted | 16 entries: all AiMoneyPrinter work (`lib/aimp/**`, `app/s/**`, `app/plant-lab/**`, `app/tools/storefront/**`, `proxy.ts`, `public/plant/**`, `assets-src/**`, 5 `test/aimp-*` files, `package.json` + lock) |
| Git on the Mac | **Broken**: `.git` → `/sessions/rcw-01wr9hmjcgkambbufoq99eeg/…` (a Cowork VM path). Needs `git worktree repair` (AMP-001-D) before anything can be committed or verified there. |
| Start command | `cd ~/Developer/AIMONEYPRINTER/apps/web && npx next dev --hostname 127.0.0.1 --port 3040` (dashboard preview port for AiMoneyPrinter); `node_modules` present; no `.env.local` (runs on fixtures) |
| Checks | `npm --prefix apps/web run lint`, `typecheck`, `test` (`node --test test/*.test.ts`), `build` |
| Dashboard | Projects → AiMoneyPrinter → Build Steps: `http://127.0.0.1:4177/#/build?app=aimoneyprinter` |

## Module map (reuse / extend / build)

| Area | Real code in the worktree | Class | Evidence and notes |
| --- | --- | --- | --- |
| Auth + workspace | `lib/supabase/*`, `lib/workspace-route.ts`, `lib/ventra-workspace.ts`, `app/api/workspace/*`, migrations (34) with RLS | **Reuse** | VENTRA workspace integration test passed against local Supabase (coordinator cycles 9–12 Nov). One cookie-path issue noted in docs/aimp/README (O2-3). |
| Onboarding | `lib/onboarding.ts`, `app/tools/onboarding-routes`, `(ventra)/onboarding` | **Extend** | VENTRA's Start/Teach/Grow routes; AiMoneyPrinter needs budget/time/interests/skills/effort and resume (AMP-010). |
| Research / opportunities | `lib/aimp/opportunity-scoring.ts` (+ test, 5/5 per README), `lib/aimp/preview/{blueprints,generate,recommend,profit}.ts`, VENTRA `local-market-evidence.ts`, `growth-opportunity.ts` | **Extend** | Deterministic rubric exists; sources/dates/confidence storage and five-idea flow are to build (AMP-012). |
| Blueprints | `lib/aimp/preview/blueprints.ts`, `lib/aimp/contracts.ts` (business models → engines) | **Extend** | Needs versioning and launch-plan generation (AMP-011). |
| Branding | VENTRA `local-brand-direction-draft.ts`, `local-offers.ts`, `local-pricing-scenario.ts` | **Extend** | Drafts only; must feed store + products + marketing (AMP-020). |
| Product factory | VENTRA `course-creator.ts` / `openai-course.ts` (structured generation + persistence pattern) | **Build** (reuse pattern) | No PDF/ZIP renderer yet (AMP-021/022). |
| Website / store | `lib/aimp/storefront/{schema,tenant,load,demo-store}.ts`, `app/s/[store]/{page,products,policies,contact}`, `proxy.ts` host → `/s/<slug>`, `tools/storefront`, demo store `slow-morning` | **Extend** | Renderer with validated config and fail-closed loader; README: 1119 tests (1114 pass, 5 todo), next build passes. Drafts/versions/publish (AMP-031) and DB-loaded configs to build. |
| Checkout / payments | `lib/stripe-checkout.ts`, `lib/stripe-webhook.ts`, `app/api/checkout`, `app/api/stripe/webhook`, `tools/checkout`; commerce SQL proposal `docs/aimp/proposed/aimp_commerce_core.sql` | **Extend** | Test-mode checkout + signed webhook with idempotency exist (VENTRA P2-1/P2-2). Stripe Connect, orders table, fulfilment to build (AMP-040–042). Checkout is scope-frozen in VENTRA (`lib/scope-freeze.ts`). |
| CRM / leads | `lib/front-office/{crm,activity}` (fo_contacts, dedupe), `lead-capture-api-contract.ts`, `local-lead-forms.ts` | **Reuse** | Shared customer record verified in VENTRA A-9; per-store lists + consent for AMP-053. |
| Marketing | `local-content-calendar.ts`, `local-email-campaigns.ts`, `local-ad-concepts.ts`, `marketing/` render pipeline (Playwright + ffmpeg) | **Extend** | Drafts and render pipeline exist; connector (Pinterest) and scheduling to build (AMP-050–052). |
| Workflow / jobs | `lib/front-office/jobs.ts` + `api/front-office/jobs/run` (job runner with retries), `local-workflow-builder.ts` (draft only) | **Extend** | Job runner proven for front-office follow-ups; generalise for AMP-060. |
| Approvals / modes | `lib/front-office/{permissions,pending-actions}` (automatic / owner approval / enquiry only) | **Reuse** | Built in VENTRA A-2; fits AMP-061 merchant approvals. |
| Analytics | `lib/aimp/analytics.ts`, VENTRA `sales-report.ts`, `business-overview.ts`, `front-office/performance` | **Extend** | Real-order reporting for AMP-062. |
| Website (marketing site) | `app/plant-lab/**` (3D plant story, working name "Seedline"), `lib/aimp/site-config.ts` | **Extend** | AMP-065 landing page; brand name pending legal check. |

## Decisions recorded (routine, reversible)

- Pilot product family: downloadable **printable planners** (one document engine) — first blueprint for AMP-011/021.
- First social connector: **Pinterest** (plan §F05; owner's brief allows it) — account access tracked as AMP-052-D.
- Frontend role for AiMoneyPrinter work: `ventra-web-design` (`ventra-frontend` stays reserved for the owner's VENTRA UI).
- All AiMoneyPrinter coding jobs run on **Claude Sonnet** (coordinator dispatches specialists with `model: sonnet`).
