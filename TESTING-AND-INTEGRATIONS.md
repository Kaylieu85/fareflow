# FareFlow — Testing Guide & Real-World Integration Strategy

## Part 1 — How to download & test the app

FareFlow is a **PWA (Progressive Web App)** — no app store needed. You install it straight from the browser and it behaves like a native app: own icon, fullscreen launch, no URL bar, offline shell, home-screen shortcuts.

### Where to open it

**Permanent link: https://kaylieu-fareflow.onrender.com**

Marketing/download page: `https://kaylieu-fareflow.onrender.com/get`
> Free-tier note: after ~15 quiet minutes the app naps — the first tap takes up to ~60s to wake it, then it's instant.

### Android (Chrome / Edge / Samsung Internet)

1. Open the app URL in **Chrome**.
2. Either:
   - tap the **“Install FareFlow”** button on the marketing page (`/get`), or
   - tap Chrome's **⋮ menu → “Install app” / “Add to Home screen”**.
3. The FareFlow icon lands on your home screen. Launch it → fullscreen, standalone app.
4. Long-press the icon to get shortcuts straight to **Diary** and **Requests**.

### iPhone / iPad (must use Safari)

Apple blocks install prompts from other browsers — Safari only:

1. Open the app URL in **Safari**.
2. Tap the **Share** button (square with an up-arrow).
3. Scroll down → **“Add to Home Screen”** → **Add**.
4. Launch from the FareFlow icon → fullscreen app experience.

### Desktop (Chrome / Edge)

Click the **install icon** (monitor/⊕ symbol) at the right of the address bar → **Install**. FareFlow opens in its own window. On Mac, it sits in the Dock like a native app.

### Demo accounts to test with

| Login | Password | Role |
|---|---|---|
| `admin@fareflow.uk` | `fareflow2026` | Fleet owner — sees all drivers, routing, fleet tools |
| `alex@fareflow.uk` | `driver123` | Single driver (London, Uber/Bolt/FreeNow linked) |
| `+44 7700 900003` | `driver123` | Zara — proves **phone-number login** works |

### 10-minute test drive

1. Log in → **Requests**: a new offer arrives every 10–24 seconds. Watch the accept countdown (that's the real per-app TTL).
2. **Accept** one → open **Diary** → see the booking plus automatic **cross-app conflict blocks** on every connected app.
3. Rider gets an SMS/WhatsApp-style confirmation with a **`fflow.link/t/...` tracking link** → open it in an incognito tab to see the live driver position + phase updates.
4. Open the booking → ask the rider for the **4-digit pickup code** → **Verify pickup**.
5. **Map** shows live driver positions; **Demand** shows the weekly heatmap (check Friday 23:00).
6. **Settings → App connections**: link/unlink a driver using their **company-issued driver number** (e.g. `UBR-4471290`) — only linked apps route work to that driver.
7. **Settings → Fleet calendar**: copy the `.ics` feed URL into Google/Apple Calendar (two-way: import external calendars too).
8. **Messages**: the SMS/WhatsApp gateway threads, incl. the website download-link request flow.
9. **Earnings**: per-channel/per-driver split.
10. **API**: per-channel API keys + copy-paste `curl` examples.

### Getting it into real testers' hands

- **Share the URL** — anyone with the address can install it as above.
- **Deploy somewhere permanent** (the sandbox preview is temporary): it's dependency-free Node — `node server.js`, respects `PORT`. One-command deploy on Render / Railway / Fly.io / any VPS.
- **Actual store listings** (optional): [PWABuilder](https://www.pwabuilder.com) wraps this exact PWA into a Play Store **AAB/APK** and an App Store **iOS package** — no code changes, icons and manifest are already in place.

---

## Part 2 — Connecting to the real ride-hail apps (closed-source APIs)

Straight answer: **Uber Driver, Bolt Driver, FreeNow, Gett etc. publish no public API, and their job offers travel over private push channels.** You cannot poll them, and automating a driver's account (session scraping, UI bots in the cloud) violates their ToS and gets drivers deactivated. But there are four legitimate routes — and FareFlow is already architected for each:

### Route 1 — Partner / operator programmes (the durable way)

The "closed" APIs aren't closed to *everyone* — they're closed to individuals. They open to **licensed private-hire operators, fleets and approved tech partners**:

- **Uber**: Uber for Business + fleet/partner integrations
- **Bolt**: Bolt Business / Bolt Fleet API
- **FreeNow**: B2B & operator partnerships
- **Gett**: Gett for Business / marketplace partners

In the UK the practical fast path is partnering **through a licensed operator** (the Veezu model) — they already hold the API relationships and can legally allocate work. This is exactly why FareFlow links drivers by their **company-issued driver number** (`Settings → App connections`): that ID is the join key an operator-side integration uses.

When partnership access is granted, each **simulated channel adapter in `server.js`** gets swapped for real HTTPS calls — the internal interface (`offers → route → accept/decline → cross-app block`) already matches the real job lifecycle, so the rest of the product doesn't change.

### Route 2 — Let them push to you (the Eviivo model)

Eviivo doesn't scrape Booking.com — Booking.com **pushes** into Eviivo. FareFlow already exposes the receiving side of that relationship, live today:

```
POST /api/integrations/:channel/offers        ← operator/network pushes a job offer
POST /api/integrations/:channel/offers/:ext/cancel
GET  /api/integrations/:channel/blocks        ← pulls cross-app availability blocks
GET  /api/integrations/:channel/test          ← handshake
Auth: X-FareFlow-Key: <per-channel key>
```

Per-channel API keys are generated in-app (**Channels → API**), and every call is authenticated and logged (bad keys get 401s in the audit log). To an operator or middleware company, *this API is the product*: "push offers in, get routed, cross-app-blocked bookings out."

### Route 3 — On-device Android companion (how real multi-apping tools work today)

US tools for rideshare multi-apping (Gridwise, Maxymo, Mystro) prove this pattern: an **Android companion app on the driver's own phone** with an opt-in **Accessibility Service + Notification Listener** reads job cards as the driver apps render them and mirrors them up to FareFlow (offer text → structured request → back through our integrations API).

- ✅ Works with genuinely closed apps, no partnership needed; driver-authorised on their own device.
- ⚠️ ToS grey zone; can break when apps redesign their UI; acceptance taps may be restricted by the apps.
- ❌ Not possible on stock iOS — iPhones rely on Routes 1, 2 and 4. (iOS Shortcuts/Focus filters can do limited notification-based triggers, but not card reading.)

### Route 4 — Dispatch middleware & open standards

UK fleets largely run dispatch platforms (iCabbi, Autocab/Cordic ecosystems) that *already* aggregate app work. Integrating FareFlow with the **dispatcher API** is often one partnership instead of five. Longer term, our integrations API (above) is deliberately shaped like an open offer standard — publish it, invite networks to adopt it, and FareFlow becomes the default receive-point.

### The honest caveat table

| Approach | Who it's for | ToS-safe | iOS doable | Effort |
|---|---|---|---|---|
| 1. Partner/operator API | Productised integration | ✅ | ✅ | Slow (approvals) |
| 2. Push webhooks to FareFlow | Operators/middleware | ✅ | ✅ | Done — built |
| 3. Android companion app | Individual drivers, today | ⚠️ grey | ❌ | Medium, fragile |
| 4. Dispatcher middleware | Fleets | ✅ | ✅ | Medium (per vendor) |

**What we won't build:** credential-based automation (logging in as the driver server-side), app scraping, or anything that reads another app without the driver's on-device consent — those violate ToS and UK data-protection expectations and would get the product and its drivers banned.

### Recommended roadmap

1. **Now** — simulators + live integrations API (demo & partnership pitches with real data shapes).
2. **Next** — Android companion proof-of-concept reading one app's offer cards.
3. **Goal** — one signed operator partnership to light up Route 1 for real.
