# VENTRA acquisition funnel (M-5)

Status: **proposal for owner review.** Written 2026-11-13 (coordinator run c-dac7ea8b). Nothing here is published,
scheduled, sent or built. No numbers, results or customers are invented: where a measurement does not exist yet, this
document says so.

Source: `marketing/BRIEF.md`, `marketing/profile/PROFILE.md`, `marketing/posts/INDEX.md`,
`docs/agents/TASK_BOARD.json`, `docs/agents/WEBSITE_BOARD.json`, `docs/agents/FRONT_OFFICE_AUDIT.md`,
`apps/web/app/site/_ui/**` (read only).

## The funnel in one line

Instagram content → Instagram profile → landing page / waitlist → AI demo → qualified enquiry → customer.

## The big picture today (plain English)

- The **Instagram content** is drafted: 9 feed posts (54 slides) are rendered and waiting for owner approval. No Reels yet.
- The **profile** package is drafted and waiting for the owner (name, bio, highlights, picture).
- The **website is not live.** The site shell (W-1) is blocked on a browser check, and every website page task
  (W-2 to W-15) is queued behind it. So there is **no waitlist page and no waitlist link** yet.
- The **AI demos** exist only as internal test pages (the Setter Lab and the Receptionist Lab). They are not public,
  and live sending and live calling are off. The website has scripted "simulated preview" demos in code, but the
  website is not online.
- There is **no way to capture an enquiry** from the public yet, and **no customers**.

The weakest link is step 3: until a waitlist page exists, every CTA has nowhere to send people.

---

## Step 1. Instagram content

**Job:** stop the scroll, name the problem (missed calls, slow replies, no follow-up), point to the profile.

**CTA copy (per post type)**
- Problem posts (02, 05): "Sound familiar? Follow for the fix." / "Work out your own number, then follow along."
- Product posts (03, 04, 06): "See how it works: follow for the demo when it's ready."
- Build-story posts (07, Reel 3): "Follow the build."
- Waitlist post (09): "Join the waitlist: link in bio."

No "comment X to get Y" bait and no automated DMs (platform rules in the brief).

**Assets needed and whether they exist**

| Asset | Exists? | Where | Notes |
| --- | --- | --- | --- |
| 9 feed carousels, captions, alt text | Yes, in review | `marketing/posts/*/`, PNGs in `~/Developer/VENTRA-MARKETING/posts/` | Post 09 blocked until a waitlist URL exists |
| Brand kit and render scripts | Yes | `marketing/brand.md`, `marketing/render.mjs`, `marketing/reel.mjs` | |
| 3 Reels from the brief | **No** | only a sample reel in `~/Developer/VENTRA-MARKETING/samples/` | Reel 2 can use lab footage only after the owner confirms it (see demo list) |
| 30-day calendar, pipeline, scheduling notes | Yes (drafts) | `marketing/CALENDAR.md`, `marketing/PIPELINE.md`, `marketing/SCHEDULING.md` | Nothing scheduled |
| Stories | No | | Needed for highlights (a highlight needs one story first) |

**Measurements available today:** none. Nothing is published, so there are no reach, saves, shares or follows to read.
Once posts go out, Instagram Insights (free, needs a Business/Professional account) shows per post: reach, likes,
comments, saves, shares, profile visits and follows. Meta Business Suite shows the same in one place.

---

## Step 2. Instagram profile

**Job:** in three seconds, say who it is for and what to do next.

**CTA copy:** bio last line "Launching soon · join the waitlist ↓" (only once the link exists; until then
"Launching soon"). Link title: "Join the waitlist".

**Assets needed and whether they exist**

| Asset | Exists? | Where |
| --- | --- | --- |
| Display name, bio options, category, setup checklist | Yes, for approval | `marketing/profile/PROFILE.md` |
| Profile picture | Yes | `~/Developer/VENTRA-MARKETING/profile/profile-picture.png` |
| 5 highlight covers | Yes | `~/Developer/VENTRA-MARKETING/profile/highlight-0*.png` |
| Waitlist link in bio | **No** | owner to provide; depends on step 3 |
| Public contact email | **No** | owner to provide |
| High-resolution or SVG logo | **No** | current mark is 176x93 px (soft when enlarged) |

**Measurements available today:** none (profile not set up). After setup, Instagram Insights shows profile visits,
external link taps and follows. Adding UTM tags to the bio link
(`?utm_source=instagram&utm_medium=social&utm_campaign=profile`) lets the website tell Instagram visits apart, once the
website records them (step 3).

---

## Step 3. Landing page / waitlist

**Job:** turn a curious visitor into a name on the list, with permission to contact them.

**CTA copy (proposal):**
- Main button: "Join the waitlist"
- Secondary link: "See how it works" (scrolls to the demo section)
- Under the form: "No obligation. We'll email you launch news and offer a demo set up for a business like yours."
  (Owner to confirm the demo promise; post 09 makes the same promise.)

**Does it exist today?** **No.**
- The website is not live. The site shell (W-1) is **blocked** on a browser check at 390 px and 1440 px.
- W-2 (homepage), W-6 (AI Setter page), W-7 (AI Receptionist page), W-12 (niche landing pages for beauty, fitness and
  trades), W-13 (SEO, analytics plan, UTM conventions) and W-15 (waitlist / request-a-demo form) are all **queued**.
- In code (not online): the old site home at `apps/web/app/site/page.tsx` and a "Get started" panel that offers a chat
  (offline unless live chat is switched on) or "Book a free strategy call by email" (a `mailto:` link, not a form).
  There is no waitlist form and nothing stores a sign-up.

### Landing / waitlist page requirements (proposal for the owner's own frontend work; not built)

This is a list of what the page needs, for the owner to build or assign (W-2, W-12, W-15). It does not replace the
website board.

1. **One promise above the fold.** Example headline: "Answer every call. Reply to every enquiry. Book more work."
   Sub-line: "VENTRA is an AI front office for service businesses. Launching soon." No AI jargon.
2. **Honest status, visible.** A small line near the top: "In testing. Launching soon." Nothing on the page says or
   implies that the product is live for customers.
3. **The five leaks** (slow reply, missed call, no follow-up, no booking link, after-hours silence), one line each,
   matching post 02 so Instagram visitors recognise it.
4. **Two product cards:** AI Receptionist (answers and books calls) and AI Setter (replies to, qualifies and books
   enquiries). Each card links to its own page later (W-6, W-7).
5. **Demo section.** Scripted previews only, each with the words "Concept demonstration" or "Simulated preview" on the
   frame. No real lab footage until the owner confirms it (see the demo list below).
6. **Waitlist form (W-15).** Fields kept short: first name, email, business type (trades / beauty / fitness / clinic /
   other), "What do you lose most?" (missed calls / slow replies / no follow-up / other), optional phone.
   - A clear consent tick box for email updates, not pre-ticked. Phone is only used if the person asks for a call.
   - Sign-ups go into the shared front-office contact record (website channel), as W-15 already specifies, so the
     Setter can follow up later, only when live sending is approved by the owner.
   - Thank-you screen: "You're on the list. Here's what happens next" (the same three steps as post 09).
   - Store the `utm_source` / `utm_campaign` of the visit with the sign-up, so we can see which posts bring people.
7. **Niche versions (W-12):** same layout, wording swapped for trades, beauty and fitness. Proof sections stay empty and
   clearly labelled "coming after launch" until real results exist.
8. **Tracking (W-13):** only after the visitor accepts analytics. The existing `apps/web/app/site/_ui/track.ts` already
   follows this rule (events go nowhere unless the visitor says yes, and no analytics tool is connected). A new
   `waitlist_signup` event would be needed; `email_capture` and `cta_click` already exist.
9. **Basics:** works at 390 px wide, readable contrast, privacy and terms links, page title and description, fast load.
10. **Owner decisions needed:** domain and URL, contact email, which analytics tool (if any, free first), what the
    demo promise is, and who answers waitlist questions.

**Measurements available today:** none. The page does not exist. When it does:
- Sign-ups: count of waitlist contacts (from the contact record W-15 creates).
- Source: UTM fields stored with each sign-up.
- Page events (`page_view`, `cta_click`, demo plays): only from visitors who accept analytics, and only once the owner
  connects an analytics tool. Today they are not collected anywhere.

---

## Step 4. AI demo

**Job:** let a business owner see the Setter and Receptionist handle a conversation like theirs.

**CTA copy (proposal):** "See it handle an enquiry" / "Hear it answer a call" on the landing page; after the demo:
"Want this set up for your business? Join the waitlist" (later: "Request a demo").

**Assets needed and whether they exist**

| Asset | Exists? | Public? |
| --- | --- | --- |
| Setter Lab `/tools/setter-lab` | Yes (A-3, A-23, A-23b done) | **No.** Internal test page. Live AI mode only for a signed-in user, within a daily spend cap. |
| Receptionist Lab `/tools/receptionist-lab` | Yes (A-4, A-26, A-41 done) | **No.** Internal test page. Simulation plus browser voice; no phone calls. |
| Website scripted demos (`apps/web/app/site/_ui/demos.tsx`) | Yes, in code | **No.** The website is not online. Labelled "Simulated preview" / "Sample business". |
| Real phone call recording | **No** | A-13 (real test call with the owner's Vapi account) is queued. |
| Screen recordings of the labs for Reels | **No** | Needs the owner to confirm the labs work in a browser (see below). |

**Measurements available today:** inside the labs only, for internal testing: the Live AI mode shows tokens, response
time and estimated AUD cost per turn and the remaining daily cap. These are test-cost figures, not marketing results,
and must not be quoted publicly. No public demo plays are measured anywhere today.

---

## Step 5. Qualified enquiry

**Job:** a waitlist sign-up becomes a real conversation: right type of business, a real problem, wants a demo.

**CTA copy (proposal, for the owner to send by hand or approve):** a single email to waitlist members at launch:
"Your VENTRA demo is ready. Pick a time and we'll show it on a business like yours." No automated DMs, no cold outreach.

**Assets needed and whether they exist**

| Asset | Exists? |
| --- | --- |
| A simple "qualified" rule: service business, at least one leak ticked, asked for a demo | Proposal only (this file) |
| Contact record that holds waitlist sign-ups | The front-office contact table exists in the app; the website form that writes to it (W-15) is **queued** |
| Demo booking page / calendar link | **No** (profile "Request a demo" link is planned for later) |
| Launch email template | **No** (sending email to the list needs owner approval) |

**Measurements available today:** none. Once W-15 exists: number of sign-ups that meet the rule above, and number who
book a demo. Lead-to-booking reporting in the app (A-10) is not built.

---

## Step 6. Customer

**Job:** a qualified business signs up and pays.

**CTA copy (proposal):** "Start with VENTRA" / "Choose your plan".

**Assets needed and whether they exist**

| Asset | Exists? |
| --- | --- |
| Pricing page (W-8), store (W-9) | **No** (queued) |
| Checkout in Stripe test mode (W-10) | **No** (queued; the checkout route is paused today) |
| Login / sign-up for the website (W-11) | **No** (queued) |
| A product a customer can switch on | **No.** Live sending and calling are off; real phone calls are untested (A-13 queued); operating modes are not enforced on the phone booking path (A-7 queued). |

**Measurements available today:** none. There are no customers and no revenue. Nothing may be claimed about customers,
bookings won or money saved.

---

## Demo list: what is safe to show publicly today

States checked in `docs/agents/TASK_BOARD.json` on 2026-11-13. "Done" on the board means the code is committed, tested
and reviewed. It does **not** mean someone has opened the page in a browser: for all four tasks below the board records
that no browser check was done, and no real Live AI turn or real call has been recorded.

### Genuinely functional (built and tested in code), but internal and not yet confirmed for public footage

| Demo | Board task and state | What really works | What is off or unverified | Public use today |
| --- | --- | --- | --- | --- |
| Setter Lab (demo mode) | **A-3: done** (commit b63570e0) | Type a customer message; scripted AI reply, qualification, CRM record and a simulated booking through the permission check, using the real Setter code | Browser check not done; no real model in demo mode; nothing is sent | **Not yet.** Footage only after the owner opens the page, confirms it works, and the coordinator approves. Even then, label "Test lab, scripted replies, nothing sent". |
| Setter Lab Live AI test | **A-23: done** (0b5bd67b), UI **A-23b: done** (6f905221) | Real AI model through the same Setter code, for signed-in users only, daily cost cap, never sends | "No real Live AI call made" is recorded; needs the owner's model key; browser check not done | **Not yet.** First real Live AI turn will be the owner's. Footage only after that and owner confirmation. |
| Receptionist Lab (simulation) | **A-4: done** (74e037a9) | Simulated inbound call through the real Receptionist code: transcript, tool actions, mode decision, call record | Simulation only, no phone; browser check not done | **Not yet.** If approved later, label "Simulated call in our test lab". |
| Receptionist Lab browser voice | **A-26: done** (dd2efdfc, server), page **A-41: done** (29755f59) | Speak in the browser, hear an Australian-English voice reply through the same Receptionist code, live transcript and summary | Not browser-checked; answers as a demo business; real Live AI needs the owner's model key; not a phone call | **Not yet.** If approved later, label "Browser voice test, not a phone call". |

Also relevant: **A-13** (real phone test call) is **queued**, so there is no real call audio. **A-7** (Receptionist
actions through the permission check) is **queued** and **A-14** (transfer rule) is **blocked** on an owner decision,
so nothing should suggest the Receptionist safely books in every mode on a real line. The Front Office audit
(`docs/agents/FRONT_OFFICE_AUDIT.md`, 2026-11-10, a code reading, not a test run) lists both labs as KEEP and notes the
Setter Lab "proves mode logic, not live routes" and the Receptionist Lab is "simulation only".

### Concept only (must carry "Concept demonstration" on the frame)

| Item | Why concept |
| --- | --- |
| Feed posts 03, 04, 06, 07 product slides | Designed graphics, not product footage (already labelled in `marketing/posts/INDEX.md`) |
| Reel 1 "The call that didn't get answered" | No real call audio (A-13 queued) |
| Reel 2 "From enquiry to booked" | Concept until lab footage is confirmed by the owner and coordinator |
| Website scripted demos (`demos.tsx`: receptionist call, Instagram / SMS / phone setter threads) | Scripted player with a sample business; never calls, sends or books. Site is not online. |
| Any Instagram DM, WhatsApp or real phone booking | Instagram is sandbox only (Meta app review not done), WhatsApp is not built, real calls are untested |
| Any dashboard, results or reporting screen | Lead-to-booking reporting (A-10) is not built; no real data exists |

Rule for every frame: if it is not real product footage confirmed by the coordinator, write "Concept demonstration".

---

## Open questions for the owner

1. Waitlist URL and domain, or approval to prioritise W-15 (waitlist form) once W-1 is unblocked.
2. Public contact email for the profile, the site and the waitlist thank-you message.
3. Will waitlist members be offered a tailored demo (posts 09 and this funnel assume yes)?
4. Please open both labs in a browser once (390 px and desktop) and say whether we may record them for Reel 2 and the
   Demos highlight. Until then all product visuals stay "Concept demonstration".
5. Which analytics tool, if any (free first), and whether UTM source should be stored with each sign-up.
6. Wording check in the website code (not edited by marketing): the SMS preview note in
   `apps/web/app/site/_ui/demos.tsx` reads "Built and being switched on for customers". With live sending off, a
   softer line such as "Preview of the AI Setter by text. In testing." may be safer before the site goes live.
