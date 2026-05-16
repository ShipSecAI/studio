# ShipSec Design Identity

## Direction

ShipSec uses a restrained developer-security control-plane identity: neutral, precise, canvas-first, and quiet under load. The workflow builder is the reference surface. Other product areas should feel like they belong to the same system: low chrome, compact controls, clear hierarchy, and one primary action per view.

## References

- Vercel Geist for typography, product restraint, and developer-tool clarity.
- GitHub Primer for durable product UI primitives, accessibility, and token-led consistency.
- ShipSec workflow builder for the local interaction model: persistent shell, hairline panels, compact toolbars, and focused side panels.

## Foundations

- **Fonts:** Geist for interface text. Geist Mono for identifiers, code, timestamps, hashes, and compact metrics.
- **Palette:** neutral zinc/graphite base with ShipSec blue as the primary action and focus swatch. The live color source is `frontend/src/styles/color-swatch.css`; change that file to switch product colors.
- **Status colors:** green, amber, red only for status semantics. They should never become layout decoration.
- **Surfaces:** flat backgrounds, hairline borders, subtle inset highlights, and very soft diffusion shadows. Avoid stacked cards and decorative gradients.
- **Radius:** medium rounded rectangles for controls and panels. Badges are small rounded rectangles, not pills by default.
- **Typography:** sentence-case labels, compact page titles, tabular numbers, balanced headings.
- **Motion:** short, interruptible transitions on color, opacity, transform, and box-shadow only.

## Product Surfaces

- **Command Center:** Home, Sentinel, Security Wiki. These are posture and risk surfaces.
- **ShipSec AI:** Chat and operator workflows.
- **Source Control:** GitHub repositories, repo scans, pull-request security workflows.
- **Cloud Estate:** AWS/GCP accounts, inventory, and cloud scan jobs. Findings route to Sentinel.
- **Attack Surface:** domains, internet assets, and ASM scans. Findings route to Sentinel.
- **Automation:** workflow builder, templates, schedules, webhooks, and approvals.
- **Manage:** integrations, secrets, API keys, MCP, skills, artifacts, audit, billing, and environment settings.

## Rules

- Do not create another dashboard language. If a page summarizes findings, link into Sentinel.
- Do not use purple-blue AI gradients or cyberpunk security visuals.
- Do not use colored cards as categories. Use text, spacing, icons, and status labels.
- Do not ship dead header buttons or view switchers.
- Favor page-level structure over cards inside cards.
