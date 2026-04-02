# LockIn App

Local-first website usage analytics for Zen + Safari, with daily AI accountability summaries on email.

## What is implemented

- Local collector API (`apps/collector-service`) that receives usage events and stores them in SQLite.
- Realtime dashboard UI at `/dashboard` for live timeline, top domains, browser split, recent events, and per-day history cards.
- Usage-day analytics window is custom: `06:00` to `02:00` (next day), with day navigation in the dashboard.
- Focus-quality scoring policy:
  - YouTube videos are classified by AI per video ID (Gemini or OpenAI via env provider).
  - Non-YouTube domains are classified manually from the dashboard.
  - `x.com`/`twitter.com` and `reddit.com` are always marked BAD.
- Daily summarizer CLI that aggregates the latest completed usage day and creates an AI accountability message (with strong warning text when high waste usage is detected).
- Optional SMTP email sender with a rich HTML report (charts + current text summary).
- Zen extension (`apps/zen-extension`) that sends focused tab heartbeats every 5 seconds plus instant pulses on tab/window activity.
- Safari extension (`apps/safari-extension`) that sends focused tab heartbeats every minute plus instant pulses on tab/window activity.
- Localhost and loopback URLs (`localhost`, `127.0.0.1`, etc.) are ignored during ingestion.

## Quick start

1. Install dependencies:
   - `npm install`
2. Create environment file:
   - `cp .env.example .env`
   - Fill in SMTP email credentials (`SMTP_*`, `EMAIL_TO`).
   - Set `CLASSIFIER_PROVIDER=gemini` and `GEMINI_API_KEY` for YouTube classification.
3. Start local collector:
   - `npm run dev:collector`
   - Open `http://127.0.0.1:4317/dashboard`
4. Extension setup (Zen temporary + Safari build/rebuild guide):
   - [`docs/extensions.md`](/Users/aarsh/Codes/lockinapp/docs/extensions.md)

## Daily summary commands

- Preview latest completed usage day only:
  - `npm run summarize`
- Preview specific date:
  - `npm run summarize -- --date 2026-03-31`
- Send email report:
  - `npm run summarize -- --send`
- Run built-in daily scheduler (auto-send):
  - `npm run schedule`
  - Optional custom time: `npm run schedule -- --time 12:30`
- Run collector + scheduler together:
  - `npm run dev:collector-mail`

## Scheduler setup (macOS)

Built-in scheduler runs inside Node and sends once per usage-day at the configured minute.
Defaults:

- `EMAIL_SCHEDULE_TIME=12:30`
- `EMAIL_SCHEDULE_POLL_SECONDS=30`
- State file defaults to `.lockin-email-scheduler.json` beside your SQLite DB

If you prefer OS-level scheduling, use cron or launchd. Example cron entry at 12:30 PM local time:

`30 12 * * * cd /Users/aarsh/Codes/lockinapp && /usr/bin/env npm run summarize -- --send >> /tmp/lockin-summary.log 2>&1`

## Tests

- `npm test`
