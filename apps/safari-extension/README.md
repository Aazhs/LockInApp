# Safari Extension Setup

1. Convert the web extension into an Xcode Safari extension project:
   - `xcrun safari-web-extension-converter /Users/aarsh/Codes/lockinapp/apps/safari-extension`
2. Open the generated Xcode project.
3. Enable the extension target and run it once.
4. In Safari, enable the extension from **Settings > Extensions**.
5. Keep the collector service running locally on `http://127.0.0.1:4317`.

The Safari extension emits one heartbeat event per minute and instant pulses on tab/window activity.
It ignores localhost/loopback URLs (`localhost`, `127.x.x.x`, `::1`).
