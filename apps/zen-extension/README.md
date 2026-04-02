# Zen Extension Setup

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Click **Load Temporary Add-on**.
3. Select [`manifest.json`](/Users/aarsh/Codes/lockinapp/apps/zen-extension/manifest.json).
4. Keep the collector service running locally on `http://127.0.0.1:4317`.

The extension samples active tab usage every 5 seconds and emits instant pulses when tab/window activity changes.
It ignores localhost/loopback URLs (`localhost`, `127.x.x.x`, `::1`).
On startup, it also backfills today's earlier browsing history once, so same-day data before extension load is imported.
