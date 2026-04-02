# LockIn App

## Project Overview
LockIn App is a local-first website usage analytics application tailored for Zen and Safari browsers. It tracks website usage via browser extensions and sends those events to a local collector service. 

**Key Features:**
- **Local Collector API:** Built with Node.js, Express, better-sqlite3, Zod, and TypeScript. Receives usage events and stores them locally.
- **Real-Time Dashboard:** Served locally to visualize active timelines, top domains, browser splits, recent events, and historical daily usage.
- **Custom Usage-Day Analytics:** Uses a custom day boundary from 06:00 to 02:00 (next day).
- **AI Classification & Summaries:** Uses Gemini or OpenAI to classify YouTube video IDs and generate daily accountability summaries.
- **Email Reporting:** Sends rich HTML reports via SMTP containing daily usage statistics and AI summaries.
- **Extensions:** Browser extensions for Zen (`apps/zen-extension`) and Safari (`apps/safari-extension`). The Safari extension is wrapped in a native Xcode project (`LockIn Usage Tracker (Safari)`).

## Architecture
The project is a monorepo managed with npm workspaces:
- `apps/collector-service/`: The backend API and CLI for scheduling and summarizing usage. Includes a vanilla HTML/CSS/JS frontend in `public/` for the dashboard.
- `apps/safari-extension/`: Source for the Safari extension (Manifest V3).
- `apps/zen-extension/`: Source for the Zen (Firefox-based) extension (Manifest V2).
- `packages/shared/`: Shared domain logic and TypeScript types.
- `LockIn Usage Tracker (Safari)/`: Native macOS/iOS Xcode project that wraps and distributes the Safari extension.

## Building and Running

**Prerequisites:** Node.js, npm, and an environment file (`.env` copied from `.env.example`).

### Install Dependencies
```bash
npm install
```

### Running the Local Collector
Start the collector service and real-time dashboard:
```bash
npm run dev:collector
# Dashboard is available at http://127.0.0.1:4317/dashboard
```

### CLI Commands (Summary & Email)
- Preview latest usage summary: `npm run summarize`
- Preview a specific date: `npm run summarize -- --date YYYY-MM-DD`
- Send email report: `npm run summarize -- --send`
- Run auto-send scheduler: `npm run schedule` (can customize time with `--time HH:MM`)
- Run collector and scheduler together: `npm run dev:collector-mail`

### Building the Project
```bash
npm run build
```

## Testing
The project uses Vitest for testing the Node backend.
```bash
npm run test
```

## Development Conventions
- **TypeScript:** The collector service and shared packages are written in TypeScript.
- **Database:** Uses `better-sqlite3` for local synchronous database operations.
- **Monorepo:** Uses `npm workspaces`. Script commands in the root `package.json` run tasks in specific workspaces (e.g., `-w @lockin/collector-service`).
- **Extensions:** The setup instructions for extensions can be found in `docs/extensions.md`.
