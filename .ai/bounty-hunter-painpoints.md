# Bounty Hunter Workflow Pain Points & ShipSec Fit

## Friction Today
- **Fragile tmux scripts**: multi-hour recon pipelines (Subfinder → HTTPX → Naabu → Nuclei) collapse on laptop sleep or network hiccups.
- **Scattered inputs/secrets**: `.env` files and ad-hoc args cause credential mix-ups between programs.
- **Manual dedupe/prioritization**: outputs from multiple tools require custom scripts; new vulns get buried.
- **Collaboration overhead**: sharing findings via zips/Sheets; reporting consumes hours.
- **Tool churn**: integrating new ProjectDiscovery releases or niche scanners breaks existing scripts.
- **Post-recon glue**: notifying Slack, creating tickets, or triggering follow-up scans done by hand.

## How ShipSec Studio Helps
- Visual DAG builder with Temporal backbone keeps runs resilient and resumable.
- Parameterized nodes + secrets vault prevent config drift.
- Built-in transforms and artifact diffing highlight new assets/vulns.
- Run history, logs, and downloadable artifacts streamline collaboration and reporting.
- Module marketplace fast-tracks adoption of new tools; sandboxed execution avoids dependency fights.
- Action nodes extend recon into notifications, ticketing, and follow-up automation.
