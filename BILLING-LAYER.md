# FareFlow — Billing Layer (PARKED — do not build yet)

> Status: **saved on the side**, per founder decision (2026-08-08). No code until triggered.
> Build trigger: when ~10 drivers ask "how do I pay?" — that is the signal pricing is validated.

## Agreed pricing model

| Plan | Price | Includes |
|---|---|---|
| **Solo** | £6/mo | Unified diary, journey mode, duty statuses, unlimited channels |
| **Pro** | £9/mo | Solo + auto-accept, demand heatmaps, earnings/tax export |
| **Founding driver** (pilot only, capped) | £4/mo locked for life | In exchange for a review + WhatsApp-group shout-out |
| **Fleet** | £4.50/driver/mo (min 5) | Fleet dashboard, duty map, bulk diary, dispatch bridge |
| **Companion capture** | +£3/mo add-on (any plan) | Read-only on-device offer capture (see CAPTURE-COMPANION-PLAN.md) |
| **Operator dispatch bridge** | £50–150/mo flat | iCabbi/Cordic webhooks → drivers' phones |
| Fleet onboarding | £50–200 one-off | Setup, import, training call |
| SMS rider notifications | ~£0.05/msg bundled (cost ~£0.03) | Sticky, tiny margin |

## What to build when triggered (in order)

1. `plans` on user records: `plan: 'solo'|'pro'|'fleet'`, `addons: ['capture']`, `foundingDriver: bool`, `stripeCustomerId`, `subStatus: 'trialing'|'active'|'past_due'|'canceled'`
2. Driver-facing **#/pricing** page (plan cards, monthly only — no annual for v1)
3. **Stripe Checkout** (test mode first): create-session endpoint, success/cancel URLs
4. **Webhook** `POST /api/billing/stripe-webhook` (signature-verified, idempotent): `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`
5. Entitlement gates: auto-accept/heatmaps/exports → Pro; capture ingest endpoint already consent-gated → add `plan` check (capture add-on or pilot comp)
6. Past-due grace: 7 days read-only, then downgrade to free viewer (never delete diary data)
7. Admin page: revenue view (MRR, active subs, churn), comp/founding-driver toggles

## Guardrails

- **Never** take rider payments — that makes FareFlow a PH operator (needs TfL/council operator licence). Driver SaaS only.
- Stripe fees: 1.4% + 20p (UK cards) — fine at these ARPUs.
- 14-day free trial default; founding-driver price must be a Stripe price created once and grandfathered (never re-priced).
- VAT only becomes relevant at £90k/yr UK turnover — ignore until close.
- No lock-in dark patterns: cancel in-app, one click, keeps export. Reputation is the moat.

## Revenue reference (blended ~£7/driver ARPU)

| Stage | Drivers+Fleets | MRR | Infra+tools cost | Net |
|---|---|---|---|---|
| Pilot | 40 | ~£330 | ~£70 | ~£260 |
| Year 1 | ~260 | ~£1,900 | ~£250 | ~£1,650 |
| Year 2 | ~1,000 | ~£8,500 | ~£1,500 | ~£7,000 |
| Year 3 | ~3,000 | ~£25,000 | ~£5,000 | ~£20,000 |

Cross-refs: [CAPTURE-COMPANION-PLAN.md](CAPTURE-COMPANION-PLAN.md) (companion milestones M0–M5), README go-to-market notes.
