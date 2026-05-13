INSERT INTO agent_skills (organization_id, name, description, content, files, allowed_tools, is_enabled)
SELECT
  NULL,
  'security-wiki-maintainer',
  'Maintain a persistent security wiki that future agents can read or edit as durable product memory.',
  'Use this skill whenever an agent is asked to create, update, review, or rely on a security wiki. The wiki is persistent compounding security memory for an engineering organization. It is not a one-time scanner report, a raw file index, or a source dump. Raw repositories, scanner outputs, cloud inventories, tickets, traces, and human notes are evidence. The wiki is the maintained synthesis future agents read first so they do not rediscover the same product facts from scratch. In a given run, the wiki may be mounted read-only, mounted read-write, represented as markdown files in the workspace, or exposed through tools. Detect what access you have before acting. If read-only, use it as context and report proposed edits. If writable, update files directly. If Git tools are available, keep changes reviewable as normal file edits or commits according to the task. Prefer product concepts over repository silos: services, trust boundaries, deployment lineage, data flows, identities, sensitive resources, external integrations, security hotspots, stale claims, contradictions, and open questions. Always preserve evidence paths/resource IDs and write missing bridges explicitly instead of guessing.',
  '[{"path":"README.md","content":"# Security Wiki Maintainer\n\nThis skill teaches an agent how to maintain a durable security wiki.\n\n## Mental Model\n\nThe wiki is the organization memory layer. It should compound across runs. Future isolated agents should be able to read it first and quickly answer: what product exists, what is exposed, what identity it runs as, what data it can reach, which findings matter, which scanner findings are noise, and what evidence is missing.\n\n## Access Modes\n\nThe current run may provide the wiki in one of several ways:\n\n- Read-only markdown directory: read it before analysis and return proposed edits.\n- Writable markdown directory: edit or create pages directly.\n- Git checkout: edit files in-place; if asked, commit or prepare a PR using available Git/GitHub tools.\n- API/tool access: use the available tools to read, write, list, or persist wiki pages.\n- No wiki mounted: produce a clean initial wiki structure as output and state that no existing wiki was available.\n\nNever assume write access. Check the workspace and tools first.\n\n## Operating Rules\n\n- Read existing wiki pages first when available.\n- Update product-level pages before repo-level pages.\n- Convert raw facts into reusable security knowledge.\n- Cite evidence with file paths, resource IDs, run IDs, or tool outputs.\n- Preserve uncertainty and stale/conflicting evidence.\n- Keep pages concise and navigable.\n- Prefer stable page names and sections over ad hoc one-off reports.\n"},{"path":"templates/PRODUCT/overview.md","content":"# Product Overview\n\n## What The Product Does\n\n## Users And Tenants\n\n## Major Capabilities\n\n## Security-Relevant Architecture\n\n## Evidence\n\n## Open Questions\n"},{"path":"templates/PRODUCT/services.md","content":"# Services\n\n| Service | Purpose | Repo | Entrypoints | Dependencies | Runtime | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n\n## Service Boundaries\n\n## Trust Assumptions\n\n## Open Questions\n"},{"path":"templates/PRODUCT/deployment-lineage.md","content":"# Deployment Lineage\n\nTrack repo -> build -> image/artifact -> deployment -> workload -> endpoint -> identity -> data/resource.\n\n## Proven Lineage\n\n## Partial Lineage\n\n## Missing Bridges\n\n## Evidence\n"},{"path":"templates/PRODUCT/auth-and-tenancy.md","content":"# Auth And Tenancy\n\n## Identities\n\n## Tenant Model\n\n## Authn/Authz Enforcement\n\n## Internal Trust Boundaries\n\n## Known Gaps / Questions\n"},{"path":"templates/PRODUCT/data-and-secrets.md","content":"# Data And Secrets\n\n## Data Stores\n\n## Secret Stores And Key Material\n\n## Sensitive Flows\n\n## Runtime Access Paths\n\n## Evidence\n"},{"path":"templates/PRODUCT/external-integrations.md","content":"# External Integrations\n\n## Providers\n\n## Credentials And Scopes\n\n## Webhooks / Callbacks\n\n## Data Shared\n\n## Evidence\n"},{"path":"templates/PRODUCT/security-hotspots.md","content":"# Security Hotspots\n\n## Highest-Risk Code Paths\n\n## Highest-Risk Runtime Surfaces\n\n## Scanner Findings That Need Product Context\n\n## Agent Review Priorities\n"}]'::jsonb,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM agent_skills WHERE organization_id IS NULL AND name = 'security-wiki-maintainer'
);

INSERT INTO agent_skills (organization_id, name, description, content, files, allowed_tools, is_enabled)
SELECT
  NULL,
  'multi-repo-security-review',
  'Reason across cooperating repositories before producing code security findings.',
  'Use this skill when more than one repository is mounted. Start by mapping repository responsibilities, shared auth boundaries, shared secrets/config, API contracts, webhook flows, package/deployment coupling, and trust assumptions. Only then search for concrete exploitable findings. Prefer issues that require understanding more than one repo. Return findings in the workflow-requested JSON shape and include repo names in evidence.',
  '[{"path":"checklists/cross-repo-review.md","content":"# Cross-Repo Security Review Checklist\n\n- Identify every mounted repository and its role.\n- Map inbound HTTP/API/webhook entrypoints per repo.\n- Map auth/session/token handling per repo.\n- Map shared env vars, secrets, encryption keys, and internal tokens.\n- Map deployment boundaries and which repo owns public surfaces.\n- Look for mismatched assumptions between caller and callee repos.\n- Prove findings with file paths and concrete code facts."}]'::jsonb,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM agent_skills WHERE organization_id IS NULL AND name = 'multi-repo-security-review'
);

INSERT INTO agent_skills (organization_id, name, description, content, files, allowed_tools, is_enabled)
SELECT
  NULL,
  'security-wiki-code-ingestion',
  'Build thorough file-first CODE wiki pages that later agents can mount as product context.',
  'Use this skill for security wiki ingestion. Pair it with the security-wiki-maintainer skill. Ingestion should read mounted repositories and any mounted/current wiki, infer the product and platform shape, and produce or update concise markdown pages with evidence paths. Do not stop at repo inventory; convert source facts into durable security knowledge future agents can reuse.',
  '[{"path":"templates/CODE-service-map.md","content":"# Service Map\n\n## Purpose\n\n## Entry Points\n\n## Auth And Trust Boundaries\n\n## Data Stores\n\n## Deployments\n\n## Security Hotspots\n"},{"path":"templates/CODE-auth-map.md","content":"# Auth Map\n\n## Identities\n\n## Tokens / Sessions\n\n## Authorization Checks\n\n## Internal Trust\n\n## Known Gaps / Questions\n"}]'::jsonb,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM agent_skills WHERE organization_id IS NULL AND name = 'security-wiki-code-ingestion'
);
