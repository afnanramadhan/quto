# Quto

A no-code browser automation desktop app for non-technical users. Build step-based tasks with variables, map them to CSV columns, and run automations in a visible browser.

## Current Phase
Phase 2 delivers a working React + Tailwind UI with step builder, CSV execution, pause/continue, looping ranges, and SQLite persistence.

## Features (Implemented)
- Step builder with actions: Navigate, Click, Type, Wait, Pause
- Variable injection using double-bracket syntax (example: {{first_name}})
- CSV header validation before execution
- Visible Playwright browser (non-headless)
- Real-time execution logs streamed to the UI
- Loop range: run a subset of steps per CSV row
- Manual resume via Continue button
- Browser stays open after runs with a manual Close Browser button
- Local persistence via SQLite (better-sqlite3)

## Tech Stack
- Electron (Electron Forge + Vite)
- React + TailwindCSS
- Playwright (automation engine)
- SQLite via better-sqlite3
- CSV parsing via csv-parser

## Requirements
- Node.js 18+ (recommended)
- npm 9+
- macOS / Windows / Linux

## Install
```bash
npm install
npx playwright install
```

## Run (Development)
```bash
npm run start
```

## Usage Notes
- CSV file is selected from the UI file picker.
- Loop range (Start Step / End Step) runs that step subset for each CSV row.
- Steps before the loop run once; steps after the loop run once.
- Pause is available as a step action and requires a manual Continue.

## Task Persistence
Tasks are saved to a SQLite database in the project root:
- quto.db

Use the Saved Task dropdown + Load button to restore a task.

Example CSV:
```csv
email,first_name,last_name
user@example.com,Ada,Lovelace
```

Example task:
```json
{
  "id": "uuid-string",
  "name": "Daily CRM Data Entry",
  "steps": [
    { "order": 1, "action": "navigate", "target": "https://example.com/login", "value": "" },
    { "order": 2, "action": "type", "target": "//input[@id=\"username\"]", "value": "{{email}}" },
    { "order": 3, "action": "click", "target": "//button[@type=\"submit\"]", "value": "" },
    { "order": 4, "action": "wait", "target": "", "value": "3000" }
  ],
  "loopStartOrder": 3,
  "loopEndOrder": 6
}
```

## Notes
- XPath is supported when the selector begins with // or xpath=.
- CSS selectors are used by default.

## Next Steps
- Add task delete/rename UI
- Add validation warnings for loop range and variable usage
- Add a browser-open status indicator
