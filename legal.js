/* FareFlow — legal documents, versioned and served to the app.
   These are honest drafts describing how the product ACTUALLY behaves (retention sweeps,
   scrypt hashing, EEA hosting). They are templates pending independent solicitor review
   before commercial rollout — see BILLING-LAYER.md guardrails. */

const TOS_VERSION = '1.0';
const PRIVACY_VERSION = '1.1';
const UPDATED = '8 August 2026';
const CONTACT = 'support@fareflow.uk';

const TERMS_HTML = `
<h3>1. Who we are and what FareFlow is</h3>
<p>FareFlow ("<b>FareFlow</b>", "we", "us") is a software tool — a channel manager and digital diary — for licensed UK private-hire drivers and fleet operators. These Terms &amp; Conditions of Use ("<b>Terms</b>") form a contract between you and FareFlow governing your use of the FareFlow web application, companion features and related services (the "<b>Service</b>").</p>
<p><b>FareFlow is not a private-hire operator.</b> We do not take bookings from the public, do not dispatch work on our own account, do not set fares and do not take payment from riders. Your contracts for transport services remain with the platforms and licensed operators you work for. Accepting private-hire bookings without an operator licence is an offence; FareFlow is software for drivers and operators who hold their own licences.</p>
<h3>2. Your account</h3>
<p>You must be 18 or over and hold (or work under) valid UK private-hire licensing — driver licence, vehicle licence and, where relevant, operator licence — and any local requirements (e.g. Transport for London PCO licensing). <b>Verification:</b> before using the Service you must verify your email address and complete onboarding, providing your full legal name, date of birth, home address, PCO/private-hire licence number, an image of your licence and a driver photo. Onboarding submissions are reviewed; providing false or misleading documents leads to account closure. You must keep your registration details accurate, keep your password confidential and tell us promptly of any unauthorised use. You are responsible for everything done under your account.</p>
<h3>3. What the Service does (and does not do)</h3>
<p>The Service consolidates your work offers and bookings into one diary, prevents double bookings, provides journey/navigation assistance, duty statuses, fleet views, analytics and optional automations. The Service is a productivity aid only:</p>
<ul>
<li>It does not guarantee work, income, acceptance rates, or the accuracy of offers relayed from third-party platforms.</li>
<li>Navigation links open third-party mapping apps (Google Maps / Apple Maps); their terms apply to that navigation.</li>
<li>Journey Lock is a safety aid, not a guarantee — you remain responsible for complying with the law on mobile phone use while driving (fixedpenalties apply). Interact with the device only when legally parked or via lawful hands-free means.</li>
</ul>
<h3>4. Independent of ride-hailing platforms</h3>
<p>FareFlow is independent software. We are <b>not affiliated with, endorsed by, or sponsored by</b> Uber, Bolt, FREE NOW, Gett, Veezu, Addison Lee or any other platform; all trademarks belong to their owners. You remain bound by each platform's terms and your operators' rules. Features described as "integrations" use official operator APIs where available. The optional companion capture feature:</p>
<ul>
<li>runs only on <i>your own device</i>, only after you opt in with a device key, and only reads offer information already displayed to you;</li>
<li>is strictly read-only — it never logs into, taps within, or submits anything to another platform's app or servers;</li>
<li>never triggers FareFlow automations (captured offers are never auto-accepted);</li>
<li>may be paused fleet-wide at any time via the capture kill switch.</li>
</ul>
<h3>5. Acceptable use — fair use</h3>
<p>You must not: misuse the Service; connect devices you do not own or lack authority over; share or sell account access, API keys or device keys; attempt to probe, scrape or disrupt the Service or any third-party platform through it; use the Service to process personal data unlawfully; or misrepresent FareFlow to riders. Optional automations (such as auto-accept) act only inside your FareFlow diary, require your explicit fair-use consent in Settings, and remain your responsibility — verify riders at pickup with their booking code.</p>
<h3>6. Fees</h3>
<p>The Service is currently provided free of charge during its pilot phase. If we introduce paid plans, we will give at least 30 days' notice by email and in-app message, with the option to export your data and leave. Continued use after the notice period constitutes acceptance of the new fees.</p>
<h3>7. Availability and changes</h3>
<p>The Service is provided "as is" and "as available". During the pilot we give no service-level guarantee and may change, suspend or withdraw features (we will aim for minimal disruption and will keep your data exportable). We may update these Terms with 30 days' notice; continued use after that date constitutes acceptance.</p>
<h3>8. Your data</h3>
<p>How we collect, use, secure and retain personal data is described in our <a href="/privacy">Privacy &amp; Data Security Policy</a>, which forms part of these Terms. Between us: you retain ownership of your operational data (diaries, bookings, settings). You grant us the limited right to process it solely to provide the Service to you.</p>
<h3>9. Liability</h3>
<p>Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, fraud, or any liability that cannot be excluded by law. Subject to that: to the maximum extent permitted by law we are not liable for indirect or consequential loss, lost earnings, lost fares, or actions taken by third-party platforms in relation to your accounts (including warnings, suspension or deactivation); and our total liability arising from the Service in any 12-month period is limited to the amounts you paid us for the Service in that period (or £100 if you paid nothing).</p>
<h3>10. Termination</h3>
<p>You may stop using the Service and delete your account at any time (Settings → data &amp; account, or by email). We may suspend or close accounts that breach these Terms, with notice where practicable. On closure we will delete or anonymise personal data in line with the retention schedule in the Privacy Policy.</p>
<h3>11. Governing law</h3>
<p>These Terms are governed by the laws of England and Wales, and the courts of England and Wales have exclusive jurisdiction, except that if you are a consumer resident elsewhere in the UK you may also rely on your local courts and mandatory consumer protections. Nothing in these Terms reduces your statutory rights.</p>
<p class="legal-soft">Questions: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`;

const PRIVACY_HTML = `
<h3>1. Who controls your data</h3>
<p>FareFlow ("we") is the data controller for personal data processed through the Service. Contact for any privacy matter, request or complaint: <a href="mailto:${CONTACT}">${CONTACT}</a>. We comply with the UK GDPR and the Data Protection Act 2018. ICO registration: registration in progress as part of our pre-launch setup (ICO data protection fee ~£40/yr).</p>
<h3>2. What we collect</h3>
<ul>
<li><b>Account data</b> — name, email, mobile number, password (stored only as a salted scrypt hash).</li>
<li><b>Driver profile</b> — vehicle, registration, PCO/licence numbers, platform driver IDs you link.</li>
<li><b>Identity &amp; compliance documents</b> — date of birth, home address, PCO/private-hire licence number, an image of your licence and a driver photo, collected at onboarding to verify your account and reviewed by fleet admins. Visible only to you and fleet review; never shared with platforms or third parties.</li>
<li><b>Operational data</b> — bookings and offers (times, places, fares), rider first name and phone number, rider messages, pickup codes, duty status history, journey timestamps.</li>
<li><b>Technical data</b> — login/session tokens, device-capture heartbeat times, IP and user-agent for security logging.</li>
</ul>
<h3>3. Why we process it (lawful bases)</h3>
<ul>
<li><b>Contract</b> — to run your diary, bookings, clash protection, journeys and fleet views.</li>
<li><b>Consent</b> — optional features you explicitly switch on: fair-use automation (auto-accept) and companion device capture. Each consent is recorded in our consent ledger with a timestamp and version, and can be withdrawn at any time in Settings.</li>
<li><b>Legitimate interests</b> — security, abuse prevention, service improvement using only anonymised/aggregated data.</li>
</ul>
<h3>4. What we never do</h3>
<p><b>We never sell personal data. We never share rider or driver data with advertisers, data brokers, or ride-hailing platforms.</b> We never use rider contact details for marketing. Companion capture is read-only on your own device and only processes what is already shown to you.</p>
<h3>5. Retention — automatic privacy sweeps</h3>
<p>Completed and cancelled bookings, and message bodies, are <b>automatically scrubbed of personal details</b> (rider name, phone, notes) once they are older than your fleet's retention setting — default <b>90 days</b>, configurable to 30 days or 1 year (Settings → Privacy retention). Factual records (dates, fares, distances) are kept anonymised for your earnings history. The system also notifies riders of ETAs by SMS only when a booking is confirmed, using the minimum data needed. Data is removed from active systems at the end of the retention window. Onboarding identity documents (licence image, driver photo and address details) are kept while your account is active and deleted on account closure.</p>
<h3>6. Security</h3>
<ul>
<li>All traffic encrypted in transit (HTTPS/TLS); hosting in the EEA (Frankfurt, EU) on Render.</li>
<li>Passwords stored only as <b>salted scrypt hashes</b>; we can never see your password.</li>
<li>Sessions use random 24-byte tokens in <b>HttpOnly, SameSite</b> cookies; no tracking cookies or third-party analytics.</li>
<li>Access control: drivers see only their own jobs and data; fleet owners see their own fleet; endpoints enforce this server-side.</li>
<li>Device capture keys are 128-bit random, shown once at creation and stored masked; webhooks and API keys are revocable, with a fleet-wide kill switch.</li>
<li>Operational logs avoid rider personal data beyond what the service needs, and are within the retention sweep.</li>
</ul>
<h3>7. Sub-processors &amp; transfers</h3>
<ul>
<li><b>Render</b> (hosting, EEA region) — infrastructure.</li>
<li><b>Stripe</b> — payments, only if paid plans launch (you'll be told first).</li>
<li><b>Twilio</b> — SMS rider notifications, only where enabled by your fleet.</li>
</ul>
<p>Where processing moves outside the UK/EEA we use approved safeguards (UK IDTA / EU SCCs).</p>
<h3>8. Your rights</h3>
<p>You can request at any time: <b>access</b> to your data, <b>correction</b>, <b>deletion</b>, <b>portability</b> (export), <b>restriction</b> or <b>objection</b> to processing, and <b>withdrawal of consent</b> (this won't affect earlier lawful processing). Email <a href="mailto:${CONTACT}">${CONTACT}</a> — we respond within one month. You can also complain to the <b>Information Commissioner's Office</b> (ico.org.uk). If a personal-data breach risks your rights we will notify the ICO within 72 hours where required, and tell you without undue delay.</p>
<h3>9. Cookies</h3>
<p>One strictly-necessary cookie (<code>ff_session</code>) keeps you signed in. That's all — no advertising, analytics or cross-site trackers.</p>
<h3>10. Children</h3>
<p>The Service is for licensed drivers and operators aged 18+. We do not knowingly hold children's data.</p>
<h3>11. Changes</h3>
<p>We will post any changes in-app and, for anything material, notify you 30 days in advance. Previous versions available on request.</p>`;

function legalPage(kind) {
  const isTos = kind === 'terms';
  const title = isTos ? 'Terms & Conditions of Use' : 'Privacy & Data Security Policy';
  const ver = isTos ? TOS_VERSION : PRIVACY_VERSION;
  const body = isTos ? TERMS_HTML : PRIVACY_HTML;
  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FareFlow · ${title}</title>
<style>
  body{margin:0;background:#0A0F1A;color:#E5ECF5;font:15px/1.65 'Segoe UI',system-ui,-apple-system,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:28px 20px 60px}
  .bar{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .bar b{font-size:17px;letter-spacing:.2px}
  .pill{font-size:11px;background:#12203a;border:1px solid #22304a;border-radius:99px;padding:3px 10px;color:#8FA3BF}
  h1{font-size:24px;margin:14px 0 2px}
  h3{color:#7CD4FC;font-size:15.5px;margin:26px 0 6px}
  p,li{color:#C7D3E4}
  ul{padding-left:20px} li{margin:5px 0}
  a{color:#38BDF8}
  code{background:#12203a;border-radius:6px;padding:1px 6px;font-size:13px}
  .meta{color:#8FA3BF;font-size:13px;margin-bottom:6px}
  .soft{margin-top:34px;padding:14px 16px;border:1px dashed #33415c;border-radius:12px;color:#8FA3BF;font-size:12.5px;line-height:1.55}
  .nav{margin-top:26px;display:flex;gap:14px;flex-wrap:wrap;font-size:13.5px}
  .legal-soft{margin-top:20px}
  hr{border:none;border-top:1px solid #1B2940;margin:26px 0}
</style></head><body><div class="wrap">
  <div class="bar"><b>FareFlow</b><span class="pill">Legal v${ver}</span></div>
  <h1>${title}</h1>
  <div class="meta">Version ${ver} · Last updated ${UPDATED}</div>
  <hr>${body}<hr>
  <div class="soft"><b>Drafting note.</b> This document was prepared for FareFlow's pilot phase and is designed to describe the product exactly as built. It does not constitute legal advice; before commercial launch the operator should obtain independent review by a solicitor regulated in England &amp; Wales, confirm company details (company number, registered address) and complete ICO registration.</div>
  <div class="nav"><a href="/">← Open the app</a><a href="/terms">Terms &amp; Conditions</a><a href="/privacy">Privacy &amp; Data Security</a></div>
</div></body></html>`;
}

module.exports = { TOS_VERSION, PRIVACY_VERSION, UPDATED, TERMS_HTML, PRIVACY_HTML, legalPage };
