# Cold Email Setup — Instantly + 4 Domains

Runbook for getting the 4 cold-email domains warm and sending through Instantly. Execute at your pace — each step is reversible and no code deploys are required.

**Domains (bought 2026-04-18):**

- `getharboroffice.com`
- `harbor-office.com`
- `buyharboroffice.com`
- `getharborreceptionist.com`

**Principle:** These domains exist to absorb the reputation risk of cold outreach. Your main product domain (`harborreceptionist.com` today, `harboroffice.ai` later) is NEVER the "From:" on a cold email. If Google/Microsoft decides the cold outreach looks spammy and blacklists a domain, it's a throwaway domain, not your product home.

---

## Phase 1 — DNS per domain (~15 min/domain)

At your registrar, for **each** of the four domains, add these records:

| Type | Host | Value | Notes |
|---|---|---|---|
| A | `@` | point to Cloudflare-proxied IP or skip if using 301 via Cloudflare Page Rules | See Phase 2 |
| MX | `@` | (Google Workspace or Zoho mail host) | Required so mailboxes can exist on this domain |
| TXT | `@` | `v=spf1 include:_spf.google.com include:amazonses.com -all` | SPF — authorizes Instantly and Google to send as you |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@harborreceptionist.com; pct=100` | DMARC in report-only mode for now |
| CNAME | `s1._domainkey` | (Google-provided DKIM selector) | DKIM — per-mailbox signing; Google gives you the exact value during Workspace setup |

**Exact SPF/DKIM values depend on your mail provider.** The list above assumes Google Workspace (which is what I'd recommend because Instantly natively supports GSuite SMTP). If you're using Zoho or another provider, swap the `include:` targets.

**Instantly also issues its own DKIM/SPF requirements** when you add the domain in their UI — follow *both* sets of instructions. Don't skip theirs thinking Google's is enough.

---

## Phase 2 — Redirects per domain (~5 min/domain)

Each domain's root should 301 redirect to `harborreceptionist.com/demo` (or `/` if you prefer). This keeps bounce-back curiosity visitors on your real product page.

**Easiest path: Cloudflare Page Rules** (free tier fine):

1. Add each domain to Cloudflare (nameservers at your registrar → Cloudflare).
2. Wait for activation (~5 min).
3. Under Rules → Redirect Rules, create:
   - **Matching:** `(http.host eq "getharboroffice.com") or (http.host eq "www.getharboroffice.com")`
   - **Then:** Static redirect → `https://harborreceptionist.com/demo` — 301 Permanent.
4. Repeat for the other three domains.

**At cutover time (when you flip to `harboroffice.ai`):** edit each Page Rule's destination URL. Single change per domain, no DNS propagation delay.

**Alternative** if you prefer not to use Cloudflare: most registrars have a built-in "URL forwarding" feature that does the same thing. Namecheap, Squarespace Domains, Porkbun all have it.

---

## Phase 3 — Google Workspace mailboxes (~20 min)

Cold email best practice: **2–3 mailboxes per domain**, rotated by Instantly. Across 4 domains, that's 8–12 mailboxes total. Each mailbox gets a sending volume ceiling (~25–40/day after warmup), so 8 mailboxes = 200–320 cold emails/day total capacity.

**Recommended mailbox naming (avoid obvious "sales"/"marketing" patterns that trigger spam filters):**

- `chance@getharboroffice.com`
- `chanceharbor@getharboroffice.com`
- `chance@harbor-office.com`
- `cwonser@harbor-office.com`
- `chance@buyharboroffice.com`
- `harbor-hello@buyharboroffice.com`
- `chance@getharborreceptionist.com`
- `help@getharborreceptionist.com`

Use your real name (Chance) on the primary mailbox per domain — replies land in a real inbox you can read.

**Google Workspace cost:** $6/user/month × 8 mailboxes = $48/month. If that's too much, Zoho Mail has a free tier for up to 5 users per domain (~$0–$15/month total) and works fine with Instantly.

---

## Phase 4 — Connect to Instantly (~30 min)

1. Sign up at instantly.ai (paid plan needed for multi-domain rotation — the Growth plan is enough).
2. For each of the 8–12 mailboxes:
   - Add the account via Google OAuth (Instantly → Accounts → Add New → Google).
   - Enable **Warmup**. Instantly will automatically send ~5 emails/day to a pool of engaged inboxes, gradually ramping to 40/day over 2–3 weeks. Do not skip this. Cold sending to a cold mailbox = instant Gmail spam flagging.
3. Add all mailboxes to the same **Sending Account Group**. Instantly rotates sends across them so no single mailbox gets overloaded.
4. **Wait at least 14 days** before launching your first real campaign. Check deliverability in the Instantly dashboard — every mailbox should show >95% inbox placement before you go live.

---

## Phase 5 — Campaign setup (after warmup, ~1h)

Once your mailboxes are warm:

1. Upload your lead list (CSV with `first_name`, `last_name`, `email`, `practice_name`, `website` at minimum). Instantly has built-in email verification — enable it, you'll lose 10–20% of leads as invalid but that protects your sender reputation.
2. Write a 3–4 email sequence. Keep each email **under 80 words**, plain text only (no HTML, no images, no tracking pixels — tracking kills deliverability). Personalize via merge tags.
3. Set sending schedule: Tuesday/Wednesday/Thursday, 9 AM–4 PM local time of each recipient. Avoid Mondays (inbox-clearing day) and Fridays (low engagement).
4. Daily send cap: start at 100/day total across all mailboxes. Ramp 10% per week until you hit ~300/day.
5. Monitor reply rate (target ≥2%) and bounce rate (keep <2%). If bounces spike, pause immediately — usually means list hygiene issue.

---

## Phase 6 — Suppression + compliance

- **Unsubscribe handling:** Instantly auto-adds unsubscribe links and honors opt-outs. Do not disable.
- **CAN-SPAM compliance:** Every email must include a physical mailing address. Put yours in the signature.
- **Suppression list:** Upload your existing customers, warm leads, and anyone who's ever emailed you to Instantly's global suppression list so they never get cold emailed.
- **Reply monitoring:** Check each mailbox at least once a day. Hot replies go to your real inbox via forwarding (set up a forwarder from each mailbox to your `chancewonser@gmail.com`).

---

## Switching the redirect target to `harboroffice.ai`

When the main product rebrands (post–A2P 10DLC approval), edit each Cloudflare Page Rule:

- **Change destination** from `https://harborreceptionist.com/demo` → `https://harboroffice.ai/demo`

That's it for the cold email side. No other changes needed — mailboxes keep their domain identity, you just redirect curious visitors to the new home.

---

## Cost summary

| Line item | Monthly |
|---|---|
| 4 domains (annual) | ~$5/mo amortized |
| Google Workspace × 8 | $48 |
| Instantly Growth plan | $37 |
| Cloudflare | $0 |
| **Total** | **~$90/mo** |

Zoho instead of Workspace drops that to ~$45/mo.
