# Analytics (PostHog)

This project uses PostHog for product analytics and session recording in the frontend (Vite + React). The integration is gated so local clones without env variables continue to work without errors.

## Environment

Frontend variables (set in hosting provider too):

- `VITE_PUBLIC_POSTHOG_KEY` – Project API key
- `VITE_PUBLIC_POSTHOG_HOST` – PostHog host (e.g. https://us.i.posthog.com, EU host, or self-hosted base URL)

See `frontend/.env.example` for a template. If these are not set, analytics is fully disabled at runtime (no client init, helpers no‑op).

## Initialization

`frontend/src/main.tsx` initialises the global `posthog` client via `posthog.init(...)` and mounts `PostHogProvider` as `<PostHogProvider client={posthog}>` when both variables are present. Session recording is enabled with privacy defaults (`maskAllInputs: true`, `maskAllText: false`), exceptions are captured, and pageviews are captured by a router listener.

## SPA Pageviews

`frontend/src/features/analytics/AnalyticsRouterListener.tsx` captures `$pageview` on `react-router` navigation. It checks `isAnalyticsEnabled()` before sending.

## User Identification

`frontend/src/features/analytics/PostHogClerkBridge.tsx` bridges Clerk auth to PostHog (only when analytics is enabled and Clerk is the active provider):

- Calls `posthog.identify(user.id, { email, name, username })`
- Sets the `organization` group when available
- Calls `posthog.reset()` on sign-out

## Local Verification

1. Run the frontend and log in.
2. Navigate between pages; verify `$pageview` events in PostHog Live Events.
3. Confirm a session recording is created and inputs are masked.

## Event Taxonomy (Initial)

- `ui_workflow_list_viewed` — when the workflow list loads; props: `workflows_count?`
- `ui_workflow_create_clicked` — user clicked create workflow CTA
- `ui_workflow_builder_loaded` — builder opened; props: `workflow_id?`, `is_new`, `node_count?`
- `ui_workflow_created` — after successful create; props: `workflow_id`, `node_count`, `edge_count`
- `ui_workflow_saved` — after successful update; props: `workflow_id`, `node_count`, `edge_count`
- `ui_workflow_run_started` — run kicked off; props: `workflow_id`, `run_id?`, `node_count?`
- `ui_node_added` — component dropped on canvas; props: `workflow_id?`, `component_slug`
- `ui_secret_created` — secret created; props: `has_tags?`, `tag_count?`, `name_length?`
- `ui_secret_deleted` — secret deleted; props: `name_length?`

Helpers live in `frontend/src/features/analytics/events.ts` and validate payloads with `zod`. All helper calls no‑op when analytics is disabled.

## Privacy & Controls

- Do Not Track respected via `respect_dnt: true`.
- Session recording: inputs masked, on‑screen text unmasked for useful context.
- Secrets Manager events never send raw secret identifiers; payloads only include derived metadata (tag counts and name length).
- Local/dev safety: analytics only initialises when both env vars are present.
- Optional runtime kill‑switch can be added later (e.g. `VITE_ENABLE_ANALYTICS=false`).

## Troubleshooting

- “Events not arriving”: ensure both env vars are set and `main.tsx` initialises `posthog` (search for `posthog.init`).
- “Helpers send but nothing recorded”: confirm provider uses `<PostHogProvider client={posthog}>` (not apiKey prop) so the global singleton is the same instance.
- “Compile error '@/config/env'”: ensure `frontend/src/config/env.ts` exists; it provides typed access to optional branch labels used by Sidebar.
