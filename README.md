# DumbPark

A small Electron app for the **Tieto Booking Sluppen P40** parking permit.

## Run

```powershell
npm install
npm start
```

## Share with Windows users

Build the one-click Windows installer on a Windows computer:

```powershell
npm ci
npm run dist:win
```

Share `dist/DumbPark-Setup.exe`. Recipients run the installer and open DumbPark from the Start menu or desktop shortcut; they do not need Node.js. The installer includes the app code and icon, but never the signed-in session or saved cars from your Windows profile. Sign in on each recipient's computer.

For GitHub downloads, push a version tag matching `package.json`, such as `v0.1.0`. The release workflow builds the installer and adds it to GitHub Releases. Share the [latest release page](https://github.com/mads-b/dumbpark/releases/latest) or the [direct installer link](https://github.com/mads-b/dumbpark/releases/latest/download/DumbPark-Setup.exe).

The installer is currently unsigned. For broad distribution, sign the Windows build so recipients do not encounter an untrusted publisher warning.

The icon source is `desktop/assets/dumbpark.svg`. Run `npm run icon` after changing it to regenerate the PNG and Windows ICO files.

Sign in to SmartPark with your phone number and SMS code if prompted. DumbPark saves the session and your vehicle plates encrypted for your Windows account. Use **+** to add a car and the dropdown to choose which one to book. **Sign out of SmartPark** clears the saved session and cars.

When signed in, DumbPark checks for an active Tieto permit at startup and highlights a missing booking in red. When you arrive at work, click **I'm at work now**. DumbPark checks the permit again. If none exists, it finds the current product, verifies that the option is free and available for today's Oslo date, then sends one booking request for the selected car. It waits for SmartPark to confirm the permit and blocks a second request while the outcome is pending.

## Tests

```powershell
npm test
```
