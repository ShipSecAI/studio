# Supabase Misconfiguration Scan Component

The `shipsec.supabase.misconfig` component audits a Supabase project using only the
service role credentials. It combines Postgres inspections with Supabase admin APIs to
surface risky defaults across Auth, Database, Storage, and Edge Functions.

## Runtime Expectations
- Runner: inline (Node.js). No Docker dependency required.
- Inputs:
  - `supabaseUrl` (required) – project URL (`https://<project-ref>.supabase.co`).
  - `serviceRoleKey` (required) – Supabase service role key.
  - `projectRef` (optional) – inferred from URL when omitted.
  - `outputFormat` (optional) – `json` (default) or `csv`.
  - `includeEnvScan` (optional) – scan provided env files for leaked keys.
  - `includeEdgeFunctions` (optional) – fetch Edge Function metadata.
  - `envFiles` (optional) – array of `{ fileName, content }` objects to analyse when `includeEnvScan` is true.

## Checks Implemented
- **Database** – RLS coverage, missing policies, unexpected superusers, public function
  access, logging/SSL configuration, risky extensions.
- **Auth** – auto-confirm, MFA enforcement, password policy strength, signup toggles,
  JWT expiry.
- **Storage** – public buckets, overly permissive bucket policies.
- **Edge Functions** – flags functions with `verify_jwt=false` (behind
  `includeEdgeFunctions`).
- **Environment** – alerts when service role keys appear in supplied env files.

Each check emits a `pass`, `fail`, or `error` status. Failed checks contribute to a
score penalty based on severity: high (-10), medium (-5), low (-2), informational (0).

## Outputs
- `summary` – aggregate score plus pass/fail counts.
- `findings` – failed checks with severity, message, and remediation.
- `checks` – full list of check results (pass/fail/error) and evidence.
- `metadata` – project reference, Supabase URL, execution timestamp.
- `rawReport` – JSON or CSV encoding of the report (matches `outputFormat`).
- `errors` – optional array when some checks returned `error`.

Progress events surface scan milestones (`Initialising`, per-check status, `Complete`)
to keep traces noisy enough for observability dashboards.

## Testing Notes
- Unit coverage mocks `pg` and `fetch` to exercise both clean and failing scenarios.
- Full suite currently requires installing `pg` headers but no live Supabase project.

## Workflow Template
- Entry point collects two runtime inputs:
  - `supabaseUrl` (`text`)
  - `serviceRoleKey` (`secret`) – ensure the workflow node maps this secret port.
- The component schema still expects default values at compile time, so placeholders are
  stored with the node configuration (`https://placeholder.supabase.co`,
  `service-role-key-placeholder`). Runtime inputs overwrite these when the workflow runs.
- After seeding the workflow, run it from the UI, supply your real Supabase URL and
  service role key, and the component will infer the project reference automatically
  unless you set it manually.
