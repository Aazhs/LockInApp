# Extension Setup Guide

## Zen (Temporary Extension)

1. Start collector:
   - `npm run dev:collector`
2. Open Zen and go to:
   - `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**.
4. Select:
   - `/Users/aarsh/Codes/lockinapp/apps/zen-extension/manifest.json`
5. Keep the collector running at:
   - `http://127.0.0.1:4317`
6. Browse a few sites, then confirm data appears on:
   - `http://127.0.0.1:4317/dashboard`

## Safari (Build + Rebuild)

1. Start collector:
   - `npm run dev:collector`
2. Convert web extension to Safari/Xcode project (first time only):
   - `xcrun safari-web-extension-converter /Users/aarsh/Codes/lockinapp/apps/safari-extension`
3. Open generated Xcode project.
4. Build and run the extension target once from Xcode.
5. In Safari:
   - Settings -> Extensions -> enable the LockIn extension
   - Grant website access (All Websites)
6. Browse a few normal `https://` sites for 1-2 minutes.
7. Refresh dashboard and verify Safari events:
   - `http://127.0.0.1:4317/dashboard`

## Rebuild Safari After Code Changes

1. Re-open the generated Xcode project.
2. Build + Run the extension target again.
3. In Safari Settings -> Extensions:
   - Disable and re-enable the extension once.
4. Re-test by browsing and checking dashboard updates.
