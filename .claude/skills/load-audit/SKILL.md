---
name: load-audit
description: Run a frontend load testing audit. Seeds data, tests all pages via Chrome DevTools MCP, records network calls, TanStack queries, DOM sizes, and generates a timestamped report.
user_invocable: true
---

# Frontend Load Testing Audit

**Testing plan:** `frontend/docs/load-testing-plan.md`
**Previous reports:** `frontend/docs/audits/`

---

## Agent Instructions

When the user invokes `/load-audit`, perform a full frontend load testing audit:

### 1. Setup

1. Read the testing plan at `frontend/docs/load-testing-plan.md` for the full methodology
2. Seed data: `bun backend/scripts/seed-stress-test.ts --tier medium`
3. Verify nginx is responding on `localhost` (not the direct Vite port)

### 2. Discover Routes

1. Read `frontend/src/App.tsx` and extract all `<Route path="...">` entries
2. Compare against the **Known Pages** table in the testing plan
3. Add any new routes to the audit list; skip removed routes and note them in the report
4. For parameterized routes (e.g., `/workflows/:id`), use real entities from seeded data

### 3. Audit Every Page

Follow the discovered route list (Known Pages + any new routes). For each page:

1. Navigate via `localhost` (nginx reverse proxy) — **never use the direct Vite dev server port**
2. Wait for data to load (spinners gone, tables populated)
3. Take a screenshot and save to `.context/`
4. Record all fetch/XHR network requests with timing
5. Extract TanStack Query cache state using the snippet in the testing plan
6. Measure DOM element count: `document.querySelectorAll('*').length`
7. Note anomalies: ghost queries, duplicate calls, missing pagination, large payloads

For Page 1 (Workflow List), also run a Chrome performance trace to get LCP, CLS, TTFB.

### 4. Generate Report

1. Compile all per-page data into a report following the format of previous reports in `frontend/docs/audits/`
2. Include cross-page analysis: DOM comparison, API call counts, shared queries, pagination gaps
3. Summarize findings with severity ratings (MEDIUM/LOW/INFO)
4. Save the report as `frontend/docs/audits/load-audit-<YYYY-MM-DDTHH-MM>.md` using the current datetime
5. If a previous report exists, note any improvements or regressions compared to the most recent one

### 5. Important Rules

- This is an **audit only** — do NOT make any code changes or fixes
- All testing must go through `localhost` (nginx), not the direct Vite dev server port
- Use Chrome DevTools MCP tools for all browser interaction
- Save screenshots to `.context/` directory
