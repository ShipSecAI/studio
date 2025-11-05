# Analytics (PostHog)

This project uses PostHog for product analytics and session recording in the frontend (Vite + React).

## Environment

Frontend variables (set in hosting provider too):

- `VITE_PUBLIC_POSTHOG_KEY` – Project API key
- `VITE_PUBLIC_POSTHOG_HOST` – PostHog host (e.g. https://us.i.posthog.com, EU host, or self-hosted base URL)

See `frontend/.env.example` for a template.

## Initialization

`frontend/src/main.tsx` mounts a `PostHogProvider` when both variables are present. Session recording is enabled with sensible privacy defaults (`maskAllInputs: true`, `maskAllText: false`), exceptions are captured, and pageviews are captured by a router listener.

## SPA Pageviews

`frontend/src/features/analytics/AnalyticsRouterListener.tsx` captures `$pageview` on `react-router` navigation.

## User Identification

`frontend/src/features/analytics/PostHogClerkBridge.tsx` bridges Clerk auth to PostHog:

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
- `ui_secret_created` — secret created; props: `name?`, `has_tags?`
- `ui_secret_deleted` — secret deleted; props: `name?`

Helpers live in `frontend/src/features/analytics/events.ts` and validate payloads with `zod`.
