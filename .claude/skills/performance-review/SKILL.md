---
name: performance-review
description: Review frontend code changes for performance anti-patterns and guideline compliance. Checks query hooks, stale times, bundle impact, rendering patterns, and Zustand selectors.
user_invocable: true
---

# Frontend Performance Review

**Reference:** `frontend/docs/performance.md`

---

## When to Invoke

- Before submitting a PR that adds or modifies query hooks, page components, Zustand stores, or real-time features
- When the user asks for a "performance review" or "perf check"
- As part of the component-development workflow for new pages

## Agent Instructions

When invoked, perform the following checks in order. Report PASS/FAIL/WARN for each. Group failures by severity: **CRITICAL** (must fix before merge), **WARNING** (should fix), **INFO** (consider).

### Step 1: Identify Scope

Read the diff or the files specified by the user. If no files specified, use `git diff --name-only` to find changed frontend files. Identify which categories apply: query hooks, page routes, stores, real-time, bundle.

### Step 2: Query Hook Checks

1. Search for `useState` + `useEffect` + `api.` within 20 lines of each other in changed files. If found: **CRITICAL** — should be a TanStack Query hook.
2. Check that new `useQuery` calls reference a key from `queryKeys.ts`, not an inline array. If inline: **CRITICAL**.
3. Check that new query hook files are named `use<Domain>Queries.ts` and placed in `src/hooks/queries/`. If misplaced: **WARNING**.
4. Check that `useMutation` calls include `onSuccess` with `queryClient.invalidateQueries()`. If missing: **WARNING**.
5. Check for `skipToken` usage on conditional queries vs. `enabled: false`. Flag `enabled: false` without `skipToken` as **WARNING**.

### Step 3: Stale Time Audit

1. For each new `useQuery`, check if `staleTime` is set explicitly or inherits the 30s default appropriately.
2. Cross-reference the data type: if the query fetches components, templates, or providers — flag missing `staleTime: Infinity` as **CRITICAL**.
3. For execution queries, verify they use `executionQueryOptions.ts` factories rather than inline values. Flag inconsistency as **WARNING**.
4. For queries on terminal runs, verify `terminalStaleTime()` is used rather than a hardcoded number.

### Step 4: Bundle Impact

1. For each new page added to `App.tsx`: verify it uses `React.lazy(() => import(...))`. Static imports are **CRITICAL**.
2. Verify new sidebar pages are added to `routePrefetchMap` in `src/lib/prefetch-routes.ts`. Missing entry is **WARNING**.
3. If a new conditionally-visible component imports a library > 100KB (check for `@xterm`, `posthog-js`, `lucide-react` barrel imports): flag as **WARNING** — consider deferred load pattern.

### Step 5: Rendering Checks

1. Search for `const [*, set*] = useState` followed by `set*` inside a `useEffect` that references query data — **CRITICAL** (should use `useMemo`).
2. Look for derived data calculations inline in JSX without `useMemo` involving array operations (filter, sort, reduce) — **WARNING**.
3. Check for `React.memo` usage on new components in `timeline/` or `workflow/` directories that re-render frequently — **INFO** if missing.

### Step 6: Zustand Store Checks

1. Search for `const store = use<X>Store()` or destructuring from `use<X>Store()` without a selector — full store subscription. **WARNING**.
2. For new stores using `persist`, verify `partialize` is present. Missing is **WARNING**.
3. For new `persist` stores, verify action functions are excluded from `partialize`.

### Step 7: Generate Report

Format the output as follows:

```
## Performance Review: [description of scope]

### Critical (must fix before merge)
- [file:line] Description of issue. See: performance.md § [section]

### Warnings (should fix)
- [file:line] Description of issue. See: performance.md § [section]

### Info (consider)
- [file:line] Description. See: performance.md § [section]

### Passed Checks
- [n] query hooks using TanStack Query correctly
- [n] page routes using React.lazy
- [n] Zustand selectors properly scoped
- staleTime: appropriate tiers applied

### Summary
[1-2 sentences on overall performance hygiene of the change]
```

## Rules

- This is a **review only** — do NOT make code changes unless the user explicitly asks
- Always cite the file and line number for each finding
- Always reference `frontend/docs/performance.md` for the relevant pattern section
- If no frontend files are in the diff, report "No frontend changes detected" and exit
