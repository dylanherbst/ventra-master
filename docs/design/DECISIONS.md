# App UI decisions: Liquid Glass spec vs the UI rulebook

Two documents describe the app UI: this repo's `LIQUID_GLASS_SPEC.md` (approved library, `reference/kit-approved.png`,
`reference/home-approved.png`) and the owner's newer `VENTRA_UI_RULEBOOK.md` (information architecture, honesty and
responsive rules, delivered outside the repo). Where they disagree: the spec and kit win for the look; the rulebook wins for
structure, status honesty, the five-item navigation and accessibility. One line per reconciliation (2026-11-09):

- Canvas: rulebook asks for a near-white canvas; the spec's lit mauve wall with bokeh (`.vg-stage`) is kept because it is the approved render.
- Cards: rulebook wants neutral glass only; the spec's clear floating cards (`.vg-card.vg-glass`) are neutral already, so both agree. `PromoCard` (aurora fill) is not used on any screen yet.
- Primary action: both agree on one violet liquid pill per screen; the teal secondary is kept from the spec.
- Navigation: rulebook's five items `Home | Leads | AI Team | Bookings | More` replace the old `Home | Create | Grow | Customers | More`. `lib/ventra-navigation.ts` is unchanged (tests pin it); the new map lives in `app/design-system/liquid-glass/nav.ts`.
- Leads: no new list screen this round; the Leads item opens the existing `/customers` (contacts and deals), and `/inbox` and `/sales` light up the same item.
- Home: rulebook's four modules on the spec's StatCard/AnalyticsCard. Values are "—" with a caption because no calendar or channel is connected to the app; the chart is labelled "Sample data" as the spec allows.
- AI Receptionist: rulebook says "Coming soon" with a disabled toggle until live calling is verified; followed, even when the saved settings have it switched on (the card says so).
- AI Setter: never shows "Active". It shows "Switched on in settings" / "Switched off" / "Needs setup" from `GET /api/front-office/settings`; channel connections are a separate check.
- Toggles on AgentCards are read-only (disabled) and mirror saved settings; switching happens in the settings editor with a save, as the spec requires a confirm step for anything that sends messages.
- Bookings: rulebook's day strip and utility rows on glass; the list is an honest empty state ("No calendar connected") because the app has no bookings API for the client.
- More: rulebook's 2×2 tiles hold the four other products (Course and Mentor Builder, Business Creator, Business Booster, Website Builder) instead of the rulebook's settings tiles; settings, connections, account, insights, all tools and help follow as rows.
- Fonts: the kit's `glass.css` imported Plus Jakarta Sans from Google Fonts; dropped (system stack first, no external request), which also matches the rulebook's "system sans" rule.
- Tokens: the kit defines tokens on `:root`; they are scoped to `.vg-app` so `app/site/**` and `globals.css` are untouched. Dark mode: `data-theme="dark"` on `<html>` (set by the shell) and on the app root.
- Lighting: rulebook's time-of-day lighting is implemented as a `data-ventra-light` attribute that only shifts the wall's glow colours; glass never changes.
- Legacy pages: every existing route renders unchanged inside the new chrome, wrapped in the old `.ventra-app` scope so its styles keep applying. They are restyled screen by screen later.
- Login (`/workspace`): the rulebook says keep the approved login unchanged; left as is inside the new shell (not redesigned this round).
