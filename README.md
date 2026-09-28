# DumbPark

A one-click app for the **Tieto Booking Sluppen P40** parking permit. The Windows and Android apps can sign in and book. The [GitHub Pages website](https://mads-b.github.io/dumbpark/) shares its interface and parking code, but SmartPark does not yet provide the browser sign-in callback it needs. The site clearly displays this limitation and does not pretend a booking was made.

## Run

```powershell
npm install
npm start
```

## Website

```powershell
npm ci
npm run build:web
```

`dist-web/` is the static GitHub Pages artifact. The workflow publishes it on pushes to `main` after GitHub Pages has been enabled with **GitHub Actions** as its source. The browser adapter currently saves selected vehicles in a site-scoped cookie; it cannot sign in or book yet.

SmartPark's mobile API rejects ordinary browser user agents with `403 Unsupported Client`. Its verification page reports the challenge token through `window.webkit.messageHandlers`, which is available in Electron but not a normal browser. Its Cloudflare Turnstile site key is tied to SmartPark's domain. A gateway alone can handle the API's user-agent requirement, but it cannot supply a legitimate web verification callback. A supported SmartPark web login/API flow or vendor cooperation is needed before browser bookings can be enabled. A JavaScript-readable cookie would not solve sign-in and would expose its token to scripts on the same origin, so DumbPark does not store a token that way.

The shared parking protocol, booking checks, and vehicle logic live in `shared/`; Electron's encrypted storage and verification window live in `desktop/`; Android's geofences, notifications, encrypted storage, network bridge and verification window live in `android/`; the browser adapter lives in `web/`; and all three modes render `ui/`. There are no duplicated booking rules.

## Android

Build a test APK with Android SDK API 36, JDK 17, Node.js 22 and Gradle 8.13:

```powershell
npm ci
npm run build:android-assets
gradle -p android :app:assembleDebug
```

Install `android/app/build/outputs/apk/debug/app-debug.apk` on a device with Google Play services and a current Android System WebView. Sign in with SmartPark and choose a saved vehicle. Tap **Enable arrival reminders**, then allow notifications, precise location and **Allow all the time** location. The app monitors two 200 m circles centered on the parking lot (63.3994293, 10.3980961) and office (63.3984618, 10.3956557). After a five-minute dwell in either, it checks SmartPark for a current Tieto P40 permit for the selected car. It posts at most one reminder per Oslo calendar day, only when SmartPark confirms no such permit exists. If the session is unavailable or the check fails, it stays quiet. Tapping a reminder opens DumbPark and invokes the same permit check and booking flow as the green button. The background check never books a permit.

Android may deliver geofence events a few minutes late, depending on location and battery settings. Location remains on the device; DumbPark also makes a read-only SmartPark permit request after a geofence dwell. The APK published by the release workflow is **debug signed** for testing. To distribute a trusted production APK, configure a stable private release signing key in CI and change the workflow to build `assembleRelease`; never commit the key to this repository.

## Share with Windows users

Build the one-click Windows installer on a Windows computer:

```powershell
npm ci
npm run dist:win
```

Share `dist/DumbPark-Setup.exe`. Recipients run the installer and open DumbPark from the Start menu or desktop shortcut; they do not need Node.js. The installer includes the app code and icon, but never the signed-in session or saved cars from your Windows profile. Sign in on each recipient's computer.

For GitHub downloads, push a version tag matching `package.json` (for example, `v0.3.4` for version `0.3.4`). The release workflow builds the Windows installer and Android test APK and adds both to GitHub Releases. Share the [latest release page](https://github.com/mads-b/dumbpark/releases/latest), the [direct installer link](https://github.com/mads-b/dumbpark/releases/latest/download/DumbPark-Setup.exe), or the [Android test APK](https://github.com/mads-b/dumbpark/releases/latest/download/DumbPark-Android-debug.apk).

The installer is currently unsigned. For broad distribution, sign the Windows build so recipients do not encounter an untrusted publisher warning.

The icon source is `ui/assets/dumbpark.svg`. Run `npm run icon` after changing it to regenerate the PNG and Windows ICO files.

Sign in to SmartPark with your phone number and SMS code if prompted. DumbPark saves the session and your vehicle plates encrypted for your Windows account. Use **+** to add a car and the dropdown to choose which one to book. **Sign out of SmartPark** clears the saved session and cars.

When signed in, DumbPark checks for an active Tieto permit at startup and highlights a missing booking in red. When you arrive at work, click **I'm at work now**. DumbPark checks the permit again. If none exists, it finds the current product, verifies that the option is free and available for today's Oslo date, then sends one booking request for the selected car. It waits for SmartPark to confirm the permit and blocks a second request while the outcome is pending.

When the window regains focus or the laptop wakes, DumbPark checks the displayed permit's expiry immediately. An expired permit switches to the red booking prompt while the app checks SmartPark for a newer one.

## Tests

```powershell
npm test
```
