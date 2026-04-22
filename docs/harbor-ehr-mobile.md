# Harbor EHR — iOS + Android patient app

The patient portal ships as a **thin Capacitor wrapper** around the
live web portal. Patients download "Harbor" from the App Store or Play
Store, the app opens to `harborreceptionist.com/portal`, and they use
the full portal inside a WebView.

This approach is deliberate:

- **One codebase.** Every feature we build for `/portal/*` on the web
  instantly works in the mobile apps. No mobile-specific fork, no
  duplicate screens, no "available on web only" asterisks.
- **Instant updates.** Server-rendered content means we can ship a
  portal improvement and every patient sees it next time they open
  the app — no App Store review cycle for content changes.
- **Native where it matters.** Capacitor's plugin model lets us add
  true native features (biometric login, push notifications, Apple
  Wallet pass for appointment reminders) later without rebuilding.

---

## One-time setup (per developer laptop)

Run these once per machine that's going to build mobile artifacts.

```bash
cd E:\Harbor\harbor-ehr

# Install Capacitor CLI + core + platform packages
npm install --save-dev @capacitor/cli @capacitor/core
npm install --save @capacitor/ios @capacitor/android

# Generate native projects
npx cap init Harbor com.harbor.app --web-dir out
npx cap add ios
npx cap add android
```

After this, two new folders exist: `ios/` and `android/`. Both are
committed to git (Capacitor convention) so every laptop builds the
same thing.

## Building for testing

```bash
# Sync the capacitor.config.ts URL into the native projects
npx cap sync

# iOS (requires macOS + Xcode)
npx cap open ios
# ...then in Xcode: pick a simulator, ⌘R

# Android (requires Android Studio)
npx cap open android
# ...then in Android Studio: pick an emulator, Run
```

## Production release checklist

**Apple App Store:**

1. Apple Developer Program membership ($99/yr)
2. App ID + provisioning profiles configured
3. App Store Connect listing (name, description, screenshots, privacy
   policy link, category = Medical)
4. Privacy disclosures: "Does this app collect data?" → Yes;
   categories = Health & Fitness (assessments), Contact Info
   (name, email, phone), Financial Info (invoices), User Content
   (messages, mood check-ins). Tie every item to purpose = "App
   Functionality".
5. Build + submit via Xcode Archive → Upload. Review typically
   24–48h. First submission often gets a BAA question from Apple
   reviewers because it's a medical app — answer: "Harbor has
   HIPAA-compliant backend infrastructure and Business Associate
   Agreements in place with all subprocessors that handle PHI."

**Google Play Store:**

1. Google Play Developer Program ($25 one-time)
2. Play Console listing
3. Data safety form — same categories as Apple
4. Build AAB from Android Studio, upload to Play Console
5. Play Store review is typically faster (12–24h)

## Secrets & signing

Both platforms need signing certificates. **Do not commit signing
keys to git.** Capacitor's default `.gitignore` covers this.

Store production signing material (keystore password, API key JSON)
in a password manager. Distribute to devs who build releases.

## Feature coverage audit

Every portal surface already works in a mobile WebView — no special
handling required:

| Feature | Mobile behavior |
|---|---|
| Login via magic-link URL | Link opens in browser → tap "Open in Harbor app" → session sticks |
| Daily mood check-in | Native — slider works on touch |
| Complete assessment (PHQ-9 etc.) | Native — tap-to-select response cards |
| Messages | Native — keyboard pushes content up correctly |
| Invoices | Stripe hosted page opens in the in-app browser, returns cleanly |
| Superbills | Browser print-to-PDF on iOS / Android share sheet on Android |
| Telehealth (Jitsi) | Opens Jitsi in-app; camera + mic permissions work |
| Voice dictation | **Web Speech API not supported in iOS WebViews.** Whisper fallback kicks in automatically. |

## Push notifications (future)

Capacitor's `@capacitor/push-notifications` plugin integrates with
Firebase Cloud Messaging. Good candidates for push once the app is
live:

- New message from therapist
- Appointment approved / declined
- Assessment assigned
- Reminder the day of an appointment
- Homework due tomorrow

Each needs a backend push dispatcher + patient-side permission prompt.
Infrastructure is ready for it; build when we have 50+ active portal
users to justify the ops lift.

## Deep-link strategy

When we eventually rebrand to `getharboroffice.com` / universal links,
Capacitor's deep-link plugin will route `harborreceptionist://portal/...`
URLs directly into the app. Not needed for v1; the server.url approach
handles initial launch cleanly.
