# FareFlow Capture Companion — Architecture & Rollout Plan

Version 1 · 2026-08-07
Companion doc to the running system at https://kaylieu-fareflow.onrender.com

---

## 0. Why this plan exists (what killed the others)

| Failed/hurt app | Failure mode | FareFlow countermeasure — **shipped in v11** |
| --- | --- | --- |
| **Para** (shut down) | Acted inside platform apps on their infrastructure | FareFlow core never logs into or acts inside platform apps. Every beat of the product works without touching them |
| **Mystro** (Uber C&Ds) | Auto-accept operating tapping inside apps, no consent trail | Auto-accept lives **only** inside the FareFlow diary and is gated behind a recorded **fair-use consent** (`state.compliance`, v1, timestamped, per account) |
| **Maxymo** (fragility, 1-dev breakage) | UI-scraping breaks weekly on platform updates; core app depends on it | Capture is a **plug-in**: core PWA + operator webhooks work with zero capture. Each capture adapter is per-platform, version-fingerprinted, remotely killable |
| **Lyft deactivation warnings** | Drivers punished silently by association | Driver-safety-by-default: capture guidance opt-in per driver, **no auto-accept of captured offers**, device keys revocable, **fleet-wide kill switch** (`settings.captureKill`), ToS risk disclosed in-product |
| **GDPR/rider data** (everyone's soft spot) | Hoarding rider PII | **Privacy retention scrubber** (`privacySweep`, hourly + on boot): rider name/phone/notes/messages auto-scrubbed after `retentionDays` (default 90) while bookings and earnings aggregates survive |

## 1. The three-tier data strategy

### Tier 1 — On-device capture, read-only ("the GigU model")
An Android companion app reads offers **the driver's own device already displays**, then pushes them into FareFlow. We never touch Uber/Bolt servers, accounts, or traffic. This is the model that withstood Uber's lawsuit in Brazil (GigU, antitrust complaint accepted by CADE).

### Tier 2 — Operator/dispatch webhooks (fully clean)
Licensed operators and dispatch platforms (iCabbi, Cordic, Autocab, Cab9…) push their own bookings into FareFlow's existing `POST /api/integrations/{channel}/offers` endpoint (`X-FareFlow-Key` backed). Rider data here flows under the operator's licence and DPA. This is the revenue-carrying tier for fleets.

### Tier 3 — Driver self-entry (already live)
Direct bookings, iCal import/export, phone work.

**Design rule:** FareFlow is valuable at Tier 3 alone. Everything above is additive. If any tier is legally squeezed, we lose a feature, not the company.

## 2. Capture companion — technical architecture

### 2.1 Components

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│  Android device (driver's) │        │  FareFlow server (live now) │
│                            │        │                             │
│  Companion service         │        │  POST /api/capture/:drv/    │
│  ├─ NotificationListener   │  HTTPS │  offers  (X-FareFlow-Key:   │
│  │   (offer cards as notifs)│──────▶│  device key, no session)    │
│  └─ AccessibilityService   │  gzip  │                             │
│      (read offer screen)   │        │  → createRequest(source=    │
│                            │        │    'capture', forceDriver)  │
│  Local parser per platform │        │  → pending request, TTL     │
│  ├─ bolt.driver (vX.Y)     │        │    10–60s, driver consent   │
│  ├─ uber.driver   (vX.Y)   │        │    shown in app             │
│  └─ freenow.pro   (vX.Y)   │        │  → SSE pops on all screens  │
└────────────────────────────┘        └─────────────────────────────┘
```

### 2.2 Already shipped (server side, v11)

- `POST /api/drivers/:id/capture` — opt in/out per driver (self only, consent-gated), issues one device key, shown in full exactly once, masked thereafter (`deviceKeyMasked`).
- `POST /api/capture/:driverId/offers` — key-authenticated ingest. Validates channel, sanitises payloads, stamps `source: 'capture'`, **forces the request to that driver only** (the offer appeared on their screen), TTL 10–60s (default 25s matching real app cards).
- `settings.captureKill` — remote kill switch, one toggle pauses every device.
- Captured requests **never auto-accept** (`source !== 'capture'` guard) — accept in FareFlow diary does nothing actionable inside platform apps; the driver confirms there.
- `lastCaptureAt` heartbeat surfaced in Settings so a silent adapter is visible ("Waiting for first offer…").

### 2.3 The companion service (to build)

**Platform support strategy — read-only by default:**

| Platform app | Capture surface | Notes |
| --- | --- | --- |
| Bolt Driver | Notification + offer Activity text tree | Multiple locales (£ GBP) |
| Uber Driver | Notification + "Uber Partner" offer sheet | Upfront fare layout varies by market |
| FREE NOW Pro | Notification + offer sheet | |
| Gett Driver | Notification | Thin UK presence — deprioritise |
| Veezu | In-app offer screen | UK-focused, add after Bolt |

**Hardening against the Maxymo failure mode:**
- Parsers are data-driven: a per-platform, per-app-version selector map (JSON) that can be **remotely updated from the server** without shipping a new APK. If Bolt updates its offer layout, we push a parser config, not an app release.
- Adapter self-diagnosis: if selectors miss for N consecutive offers, the adapter marks itself degraded and reports `{platform, appVersion, parserVersion}` to `POST /api/capture/:drv/health` (to add); Settings shows amber instead of silent failure.
- Version pinning: adapter knows exactly which app versions its selectors were validated against; unknown versions fall back to notification-only capture (lowest fragility).

**Legal posture implemented in code:**
- No automation APIs used for input injection by default. The accessibility service is used to **read** text only; `performAction`/click dispatch is not shipped in v1 (that line is what separates GigU from Mystro).
- No credentials requested: the companion never asks for Uber/Bolt logins. It only holds its FareFlow device key.
- Foreground-service notification with clear text: "FareFlow mirror is running — tapping nothing in your apps; offers you see are copied to your diary." Transparency is a defence, not a weakness.
- Battery/data respect: parse on-device; send only normalised fields `{channelId, fare, distanceMi, durationMin, pickupAt, pickupName, dropoffName, ttlSec, externalId}`.

### 2.4 Data minimisation in transit
- Rider first name only, no surnames/no phone captured from offer cards (we don't need them — pickup codes handle identity).
- HTTPS, gzip; device key in header; no analytics SDKs in the companion (no third-party data processors = cleaner DPIA).

## 3. Milestones

1. **M0 — Done (v11):** consent ledger, privacy scrubber, capture ingest endpoint, kill switch, per-driver device keys, fair-use UI, FAQ.
2. **M1 — Foundations:** host move to always-on (no cold starts), custom domain `fareflow.uk`, Web Push (so offers and even journey events alert with app closed), `/legal` pages (ToS + Privacy reviewed by solicitor).
3. **M2 — Companion POC (Android, Kotlin):** NotificationListener only; one platform (Bolt Driver UK); 5-driver private pilot; verify payloads against real offer cards; measure end-to-end latency (target < 2s from card to diary pop).
4. **M3 — Parser hardening:** accessibility text-tree capture for Bolt + Uber Driver; remote parser config; degraded-state reporting; 20-driver pilot across 2 cities.
5. **M4 — Fleet wedge:** iCabbi/Cab9 partner application; 1 licensed operator pushing real bookings through Tier 2; pricing live (£5–10/driver/month).
6. **M5 — Platform diplomacy intake:** with pilot metrics (drivers, trips, acceptance health), open conversations about official status; the GigU/Brazil antitrust precedent is part of the file.

## 4. Non-negotiables checklist (run before every release)

- [ ] No code path performs input gestures inside other apps
- [ ] No platform credentials stored anywhere
- [ ] Captured offers still dismissible/declinable; never auto-accepted (`CREATE` guard intact)
- [ ] Kill switch works and is exercised in tests
- [ ] Privacy sweep ran within the last hour on prod (`LOG: Privacy retention: auto-scrubbed …`)
- [ ] Consent recorded before auto-accept or capture enable attempts (412 contract intact)
- [ ] Device keys never appear unmasked in `/api/state`

## 5. Open questions

- Which single city for M2 pilot? (Recommend one of Birmingham/Manchester — high multi-app density, your home networks)
- Pricing for the companion feature: bundled with core, or premium tier (+£2/driver)?
- iOS stance: no automation possible (Apple) — ship read-only notification mirroring only, or skip iOS v1? (Recommend: notification-mirror only, same parser config, honest feature flag in marketing.)
