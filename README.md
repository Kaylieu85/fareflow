---
title: FareFlow
emoji: 🚕
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
---
<!-- ^ front-matter for Hugging Face Spaces — harmless everywhere else -->

# FareFlow — channel manager for UK ride-hailing & private hire drivers & fleets

**One diary. Every app. Every driver.** FareFlow does for drivers what Eviivo does for guesthouses:
instead of running Uber, Bolt, FREE NOW, Gett, Veezu and Addison Lee side-by-side, every booking
request lands in **one inbox** and every accepted job lives in **one diary**. Accept a job — or take
a phone booking over a webhook — and that slot is **blocked on every other app automatically**,
fleet-wide. Zero double bookings, zero app juggling.

Runs as an **installable app on iOS and Android** (PWA): open the live URL in Safari/Chrome →
*Share → Add to Home Screen*. Bottom tab bar, notch-safe layout, offline app shell via service worker.

> Demo build. Channel APIs, the SMS/WhatsApp gateway, rider location simulation and payment figures
> are **simulated locally**. Not affiliated with any operator.

## Run it

```bash
node server.js        # dependency-free Node 16+
# open http://localhost:3000
```

State persists to `data.json` (override with `DATA_FILE=/path/file.json`). Delete it to reseed.

## Deploy — permanent public URL

Everything needed is already in the repo; pick whichever free host you have an account with:

| Host | How | Needs |
|---|---|---|
| **GitHub → Render (current setup)** | Code on GitHub, Docker builds on Render's free plan. Deploy new code: push to `main`, then `POST /v1/services/{id}/deploys` with your Render API key (no repo webhook without OAuth — see TESTING guide). | free GitHub + Render accounts — **live at https://kaylieu-fareflow.onrender.com** |
| **Hugging Face Spaces** | Same `Dockerfile` works (SDK **Docker**); note Docker Spaces need HF **PRO** ($9/mo) since free CPU only runs static Spaces. | HF PRO |
| **Railway / Fly.io / any VPS** | Auto-detected (`Procfile`/`Dockerfile`). | account |
| **Plain Docker anywhere** | `docker build -t fareflow . && docker run -p 3000:7860 fareflow` | Docker |

QR codes were regenerated against the live URL. After any future domain change, **re-point the QR codes once** and they work forever:

```bash
python3 tools/gen_qr.py "https://your-permanent-url/"
# rewrites public/qr/*.png — regenerate & reprint the posters
```

(The `/get` download page loads `/qr/*.png` from its own origin, so the on-site QR cards update automatically.)

### 🔐 Sign in (email or mobile number)

The app is protected by email/phone + password auth, with HttpOnly session cookies (30 days).
**Demo accounts** (tappable quick-fill on the sign-in screen):

| Login | Password | Role |
|---|---|---|
| `admin@fareflow.uk` | `fareflow2026` | Fleet owner |
| `alex@fareflow.uk` | `driver123` | Driver (Alex) |
| `+44 7700 900003` | `driver123` | Driver (Zara) — phone-number login |

`POST /api/auth/register` creates a user **and** their fleet driver profile in one step; sign in
afterwards with the email or the mobile given. Public endpoints stay open: rider tracking
(`/t/:token`), calendar feeds, the operator webhook API (key-authed) and the marketing promo
endpoint. Passwords are salted-SHA256 in this demo.

### 🔗 App connections — company driver numbers

Every operator (Uber, Bolt, FREE NOW, Gett, Veezu, Addison Lee) issues its drivers a unique
driver number. In **Settings → App connections** each driver links each app with their number
(e.g. `UBR-4471290`). The fleet router then offers a channel's jobs **only to online drivers
linked on that channel** — including per-request manual reassignment, which greys out unlinked
drivers. Unlinking takes effect immediately; Channels shows a `x/y drivers linked` count per app.

## Feature tour

| View | Highlights |
|---|---|
| **Diary** | Weekly grid per driver, colour-coded per channel, live per-app push status on every block (✓ blocked / pushing / failed+retry), manual blocks for one driver or the whole fleet, sync log. |
| **Requests** | One inbox, expiry countdowns. Every offer is auto-routed to the first **free online driver**, re-assignable via dropdown (clash/off-duty drivers greyed out). Optional auto-decline (no free driver) and auto-accept (£/mi rule). |
| **Map** | Live UK map: jobs as pickup→dropoff routes (channel colour = app, ring = driver), pulsing next job, pending offers, driver bases. |
| **Demand** | 🔥 Channel-by-channel **day × hour heatmap** (forecast model blended with observed bookings), peak-window callouts, and pickup hotspot overlay on the map. |
| **Fleet** | Add/edit drivers (vehicle, reg, PCO licence, home city), take drivers off duty, per-driver stats. |
| **Channels** | Pause/connect apps fleet-wide; reconnect triggers catch-up sync of the whole diary. |
| **Messages** | Automated SMS/WhatsApp confirmations, ~60-min reminders, cancellation texts — every message carries the pickup code + live **tracking link**. Simulated gateway with queued → sent → delivered ✓✓ receipts. |
| **Earnings** | Today/week, avg £/mile, pickup-code verification rate, per-day chart, channel & driver share, trip ledger. |
| **API** | The integrations console: per-channel API keys, offer-webhook URLs, test-fire, key rotation, webhook log, curl docs. |

### 🔑 Secret pickup code
Every booking gets a 4-digit code. Rider gets it by SMS/WhatsApp; driver sees it on the diary block
and enters it at pickup — proving identity **both ways**. Attempts are tracked; the verification
rate shows in Earnings.

### 📍 Rider tracking link
Every confirmation message includes `fflow.link/t/<token>` (served at `/t/<token>`). It opens a
public, install-free page with: live driver position and ETA (driver simulated approaching),
phase banner (confirmed → on the way → arriving → verified), driver/vehicle/reg card, and the
rider's pickup code. Polls every 4 s; handles cancelled/completed/invalid states.

### 🔥 Demand heatmap
`/api/demand` serves per-channel 7×24 grids — a realistic UK demand model (commuter humps,
Friday/Saturday night peaks) blended 55/45 with your observed bookings. UI: day×hour heat grid,
top-3 peak windows per channel, hotspot overlay on the UK map.

### 🧩 Operator dispatch APIs (the Eviivo-style seam)
Real adapters POST offers into the same pipeline the simulator uses:

```bash
# inject an offer (routed to a free driver instantly)
curl -X POST $HOST/api/integrations/uber/offers \
  -H "Content-Type: application/json" -H "X-FareFlow-Key: <channel key>" \
  -d '{"externalId":"ub_trip_991","rider":"Aisha Khan","pickupName":"Canary Wharf",
       "pickupLat":51.5054,"pickupLng":-0.0235,"dropoffName":"Heathrow T5",
       "pickupAt":"2026-08-08T09:30:00Z","fare":58.40,"distanceMi":22.7,"ttlSec":300}'
# → 202 { requestId, assignedDriver, expiresAt, pickupCode }

# operator fetches their live jobs + tracking URLs
curl -H "X-FareFlow-Key: <key>" $HOST/api/integrations/uber/blocks

# operator cancels → slot released on every app
curl -X POST -H "X-FareFlow-Key: <key>" \
  $HOST/api/integrations/uber/offers/ub_trip_991/cancel
```

All calls (including 401s) land in the **webhook log** in the API view, next to test-fire and
key-rotation tools. Production adapters would add outbound HMAC-signed posts back to the operator
(`offer.accepted / offer.cancelled / block.pushed`).

### Two-way calendar feed
Subscribe from Google/Apple Calendar via `/api/calendar/<token>.ics?driver=` and paste-import any
`.ics` file — imported events block every app. Same as before.

## PWA (iOS & Android)

> 📲 **Device install steps + how we'd connect the real (closed-source) ride-hail apps:**
> see **[TESTING-AND-INTEGRATIONS.md](./TESTING-AND-INTEGRATIONS.md)**.


`manifest.webmanifest` + `sw.js` + full icon set make it an installable app:
- standalone display, portrait lock, business categories, splash colours, home-screen icon
- service worker caches the app shell (offline boot); API/SSE always stay network-fresh
- mobile shell: fixed bottom tab bar with icons, `env(safe-area-inset-*)` notch handling,
  bottom-sheet modals, 44 px touch targets, 16 px inputs (no iOS focus zoom), `shortcuts` to Diary/Requests

## API surface

```
POST /api/auth/login · /api/auth/register · /api/auth/logout      (public)
GET  /api/state · /api/events (SSE) · /api/demand · /api/track/:token
POST /api/requests/:id/accept|decline|assign
POST /api/drivers · /api/drivers/:id/edit · /api/drivers/:id/toggle · /api/drivers/:id/connection
POST /api/blocks · /api/blocks/:id/cancel|verify · /api/bookings/direct · /api/messages/resend
POST /api/drivers · /api/drivers/:id/edit · /api/drivers/:id/toggle
POST /api/channels/:id · /api/master · /api/settings · /api/holds/retry
GET  /api/calendar/:token.ics?driver= · POST /api/calendar/import
POST /api/integrations/:cid/offers · /offers/:ext/cancel · /test · /rotate
GET  /api/integrations/:cid/blocks        (X-FareFlow-Key auth on all of these)
GET  /t/:token  — public rider tracking page
```

## 📣 Marketing site — `/get`

A self-contained animated landing page (`public/site.html`, also at `/site`) advertising the app:
- Hero with **live phone mockups** of the real UI (requests inbox + shared diary), stat counters
- Feature grid, 3-step "how it works", rider-tracking showcase, night-shift banner image
  (`/img/banner.jpg`), demand + fleet split, fictional UK driver testimonials, FAQ accordion
- **Download section**: PWA-aware install buttons (`beforeinstallprompt` on Android/desktop,
  step-by-step *Share → Add to Home Screen* guide on iOS), plus a **"text me the link"** form that
  posts to `POST /api/promo/link` and fires the download URL through the app's SMS gateway
  (validated + rate-limited; appears as a promo thread in the app's Messages view)
- **Social links** in the footer with platform hover styling: Facebook, Instagram and YouTube
  (`facebook.com/fareflowapp`, `instagram.com/fareflowapp`, `youtube.com/@fareflowapp`)

## Architecture

Vanilla-JS SPA ⇄ dependency-free Node server. **Sync engine** pushes each diary block's
availability to every other channel adapter (per-app simulated latency/reliability, auto-retry,
catch-up on reconnect). **Fleet router** scores online drivers by daily load & clash-freedom and
assigns every offer — from the simulator or a webhook — through one pipeline. **Message gateway**
models SMS/WhatsApp receipts. **Tracking service** interpolates driver positions deterministically.
Sweepers: offer expiry, trip progress/completion, 60-min reminders, occasional rider cancellations.
