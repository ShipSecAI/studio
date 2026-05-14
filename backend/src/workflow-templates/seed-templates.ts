/**
 * Seed data for pre-built workflow templates.
 *
 * Each template contains a complete workflow graph (nodes + edges)
 * that can be instantiated via the /workflow-templates/:id/instantiate endpoint.
 *
 * Node type values correspond to component IDs registered in the component registry.
 * Edge sourceHandle/targetHandle values must match actual component output/input port IDs.
 */

import type { NewWorkflowTemplate } from '../database/schema/workflow-templates';

export type SeedTemplate = NewWorkflowTemplate & { slug: string };

// Helper to generate unique IDs for nodes/edges within a template
let counter = 0;
function nid(prefix: string) {
  return `${prefix}-${++counter}`;
}

function resetCounter() {
  counter = 0;
}

function makeNode(
  id: string,
  type: string,
  label: string,
  x: number,
  y: number,
  config?: Record<string, unknown>,
  inputOverrides?: Record<string, unknown>,
  extraConfig?: Record<string, unknown>,
) {
  return {
    id,
    type,
    position: { x, y },
    data: {
      label,
      config: {
        params: config ?? {},
        inputOverrides: inputOverrides ?? {},
        ...(extraConfig ?? {}),
      },
    },
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
) {
  return {
    id,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
  };
}

const AGENTIC_CODE_FINDINGS_PROMPT = `You are a senior application security engineer.

Your job is to find real exploitable security issues in this codebase.
Do not summarize scanners. Scanners are optional evidence only.
Use the repository mounted at /workspace/repo-workspace/repo as source of truth.
Use /workspace/context.json when present for PR metadata, changed files, prior findings, wiki context, and deployment context.

Return ONLY JSON. Do not include markdown, prose, code fences, or debug notes.

The JSON must match this shape:
{
  "findings": [
    {
      "title": "string",
      "severity": "critical|high|medium|low|info|unknown",
      "confidence": 0.0,
      "category": "authorization|authentication|injection|secrets|crypto|data-exposure|ssrf|rce|business-logic|dependency|configuration|other",
      "weaknessClass": "short stable class such as idor, ssrf, rce, missing-authz",
      "status": "introduced|existing|worsened|fixed_candidate|unchanged_existing|uncertain|false_positive",
      "file": "relative/path.ts",
      "line": 123,
      "endpoint": "HTTP method and path when applicable",
      "functionName": "handler or function when applicable",
      "description": "what is vulnerable",
      "attackerPrerequisite": "what the attacker needs",
      "impact": "real impact",
      "evidence": ["specific code facts you verified"],
      "fix": "specific remediation",
      "verification": "test or retest plan",
      "linkedFindingKeys": []
    }
  ],
  "threatCandidates": [
    {
      "title": "string",
      "linkedFindingKeys": ["code:<repo>:<weakness>:<semantic-location>"],
      "impact": "blast radius",
      "confidence": 0.0,
      "evidence": ["why these findings belong together"]
    }
  ],
  "wikiUpdates": []
}

For baseline review, find issues that already exist in the reviewed branch or release.
For PR review, compare changed code against existing behavior and classify findings as introduced, worsened, fixed_candidate, unchanged_existing, uncertain, or false_positive.
Every finding must be evidence-backed and concrete. If you cannot prove a finding, put it under uncertain or omit it.`;

const MULTI_REPO_AGENTIC_CODE_FINDINGS_PROMPT = `${AGENTIC_CODE_FINDINGS_PROMPT}

Multi-repo mode:
- Inspect every repository under /workspace/repo-workspace/repos before concluding.
- First build a mental map of how the repositories call, deploy, authenticate, and trust each other.
- Prefer cross-repository bugs: mismatched auth assumptions, shared secrets, webhook/API trust boundaries, deployment coupling, package boundaries, and one repo fixing assumptions another repo breaks.
- Include the repository name in each finding title, file path, endpoint, or evidence wherever possible.`;

const AGENTIC_CODE_REVIEW_MODEL = {
  provider: process.env.CHAT_AI_PROVIDER?.trim() || 'opencode-go',
  modelId: process.env.CHAT_AI_MODEL_ID?.trim() || 'deepseek-v4-flash',
};

const THREAT_STORY_AGENT_PROMPT = `You are ShipSec's autonomous threat-story analyst.

You turn durable security findings into concrete "what is broken" stories.
Use the ShipSec Studio MCP tools. Do not invent data.

Required workflow:
1. Call list_security_findings with status "open", userVisibleOnly true, and a useful limit.
2. For findings that look related, call get_security_finding and list_finding_links.
3. Record missing evidence-backed links with record_finding_link.
4. Record one or more threat stories with record_threat_story.

A threat story is not a scanner finding. It is an attacker-relevant narrative over findings.
Good stories answer:
- what exposed endpoint, service, identity, cloud resource, or code path is affected
- which findings support the story
- how the findings combine into impact
- what action fixes the story
- how confident you are and why

Markdown requirements:
- Write summary, impact, attackPath, recommendedAction, and finding rationales as clean GitHub-flavored Markdown. The product renders these fields directly.
- Use short paragraphs, bullets, and compact tables where useful.
- Do not write walls of text.
- Include exact findingKey or finding id text whenever referencing a finding so the UI can turn it into a clickable link.
- Recommended actions should be concrete checklist-style steps, not prose blobs. Separate owner action, validation, and expected end state when you can.
- Write attackPath as an ordered attacker path: entry point -> enabling weakness -> privilege/data/resource impact. Each step must name the exact findingKey/id and the affected service/resource/endpoint/identity.
- Prefer a compact markdown table for attackPath with columns Step, Finding, Surface, Why it matters.
- Assign meaningful findingRoles so the UI can draw the evidence chain: attack_vector, root_cause, enabler, evidence, indicator, impact.
- Write findingRationales as concise markdown that explains why that finding has its role in the chain, not a duplicate of the title. Mention concrete evidence, not generic risk.
- Put affected cloud assets, services, endpoints, identities, repos, files, or data stores into affectedAssetRefs whenever they are known.
- Do not create a story unless you can describe at least one affected surface and at least two evidence points, or one very high-confidence single finding with direct product impact.

Use precise relationship types:
- same_root_cause when findings share the same bug/config source
- enables when one finding makes another exploitable
- same_asset when the same service/resource is affected
- same_control when they fail the same security requirement
- mitigated_by when one finding or action reduces another
- related only when no better type fits

Do not wait for human approval.
Do not merely summarize all findings.
Do not create links or stories for findings whose latest assessment is not_relevant or false_positive.
Prefer fewer, stronger stories over noisy grouping.
If the data is insufficient, record no story and explain what evidence is missing in the final report.`;

const THREAT_STORY_AGENT_TASK = `Analyze current durable security findings and record linked threat stories.

Use these MCP tools as your source of truth:
- list_security_findings
- get_security_finding
- list_finding_links
- record_finding_link
- list_threat_stories
- record_threat_story

Final answer format:
- stories_recorded: number
- links_recorded: number
- skipped_reason: short text if no story could be proven
- notes: concise explanation of the highest-impact story.`;

const FINDING_ASSESSMENT_AGENT_PROMPT = `You are ShipSec's autonomous finding assessment agent.

Your job is to turn scanner output into product judgment. Scanner findings are signals, not truth.
Use the ShipSec Studio MCP tools. Do not invent data.

The security wiki is the durable source of product context. If /workspace/wiki exists, you must inspect it before deciding relevance. Static scanner checks are often noisy: a check can be technically true but not important if the affected cloud service, account, repo, endpoint, identity, resource, or data path is not part of the active product/runtime described by the wiki. Treat the wiki, inventory, and finding evidence together as the basis for judgment.

Required workflow:
1. Check whether /workspace/wiki exists. If it does, read the overview/index pages, deployment/runtime maps, security surfaces, assumptions/open questions, and any pages that mention the provider/service/resource family you are assessing.
2. Fetch currently open findings, across all source kinds. Prefer list_finding_assessment_candidates for triage because it preserves scanner rule/status/message/provider/resource fields in a compact shape. Use list_security_findings or get_security_finding only when you need full evidence/details. The tool limit is 200; never request a larger limit. Use offset for pagination.
3. Inspect the mix of findings and compare repeated scanner families against the wiki. Decide your own batching and parallelization strategy. Use subagents/parallel workers when the runtime supports them.
4. For each candidate, call get_security_finding when the list result is not enough. For scanner findings, inspect the observation/evidence/raw normalized fields before deciding. The human title may be misleading; source_rule_id, status/status_code, normalized.message, normalized.status_detail, normalized.provider, normalized.projectId/accountId, resourceType, resourceId, and remediation/risk fields are more authoritative.
5. Read prior notes with list_finding_assessments before changing a finding that already has context.
6. Record one assessment per reviewed finding with record_finding_assessment.
7. Only after assessment, record links/stories for findings that remain actionable, need context, or are accepted risk.

Do not stop while there are open findings in the current scope that lack a proper assessment note.
The goal is complete coverage: every currently open finding should end with a useful markdown reasoning note, even if the verdict is noise or not relevant.
If the current run cannot finish all findings, record assessments for every reviewed finding and explicitly report the exact remaining unreviewed finding IDs.

Verdicts:
- actionable: product-owned, reachable, exploitable, materially risky, or clearly violates a security requirement that matters.
- not_relevant: scanner result is real but outside the active product/runtime/scope.
- false_positive: scanner claim appears wrong.
- accepted_risk: issue is real but intentionally tolerated; explain why.
- needs_context: cannot decide without a specific missing bridge/evidence.
- resolved_candidate: evidence suggests a previously open issue may now be fixed, but a validating scan/review is still needed.

Importance:
- critical/high/medium/low for user-facing items.
- noise for not_relevant or false_positive items.

Reasoning requirements:
- Write reasoningMarkdown as clean, readable GitHub-flavored Markdown. It will be rendered directly in the product.
- Use short sections with Markdown h2 headings, bullets, and compact tables when they make the assessment easier to scan.
- Do not write one giant paragraph. Keep paragraphs under 3 lines where possible.
- Always include these sections:
  - ## Verdict
  - ## Stack relevance
  - ## Evidence
  - ## Why this matters or ## Why this is hidden
  - ## Next step
- In the Stack relevance section, include provider/account/project/resource, whether it appears in wiki, whether inventory confirms it, whether it is on an active runtime path, whether it touches customer data, whether it is public-facing, and what evidence is missing.
- Always write metadata.stackRelevance with: seenInWiki, seenInInventory, activeRuntimePath, customerImpactPath, publicExposure, evidence, missingEvidence.
- Explain why the issue still matters or why it should be hidden.
- Cite concrete evidence refs, asset names, service names, wiki paths, run IDs, or observed missing evidence.
- When referencing another finding, include its exact findingKey or finding id in the markdown text so the product can turn it into a clickable link.
- Be aggressive about reducing noise when the product/wiki/inventory does not show the service/resource/identity as part of the active product.
- For cloud scanner findings, explicitly ask: "Is this provider/account/project/service/resource actually used by the product according to the wiki or cloud inventory?" If not, mark not_relevant/noise and cite the missing/negative evidence.
- Never invert or rewrite a scanner check from the title alone. For positive-control scanner findings whose title says a good control is present (for example "does not allow admin", "has MFA enabled", "does not expose SSH"), verify the actual failed condition from source_rule_id and normalized.message/status_detail/risk_details before marking actionable. If the raw message says "does exposes SSH", say exactly that; do not call it "does not expose SSH".
- Preserve provider context exactly. A GCP project must not become an AWS account in reasoning. If a generated script cannot preserve provider/account/project/resource fields per finding, do not use that script for writes.
- For high-cardinality repeated checks, assess the root family and then record concise per-finding notes. Mark repeated low-impact hardening checks as low/noise unless the wiki shows they protect an active critical path.
- Public ingress, internet-exposed management ports, product-owned data stores, product-owned workloads, and cluster/network control-plane add-ons should not be marked pure noise when stack relevance is confirmed. Use actionable for material exploit paths, accepted_risk for expected-but-real hardening debt, or needs_context when impact is unclear.
- Do not link or story findings marked not_relevant or false_positive.
- Prefer fewer stronger links and stories over broad vague grouping.
- If you write helper scripts, first run them in read-only/dry-run mode on 5 representative findings across providers/source kinds and inspect the proposed notes. Only perform bulk record_finding_assessment calls after the sample output preserves provider/resource/rule/message correctly and includes noise/not_relevant decisions where wiki/inventory cannot prove relevance.

If a security wiki is mounted at /workspace/wiki, cite wiki paths in wikiRefs whenever the wiki affects a verdict. If no wiki is mounted, say that clearly in the final answer and be more conservative with needs_context.`;

const FINDING_ASSESSMENT_AGENT_TASK = `Review the current open unassessed durable findings and append agent assessments.

Use these MCP tools as your source of truth:
- list_finding_assessment_candidates
- list_security_findings
- get_security_finding
- list_finding_assessments
- record_finding_assessment
- list_finding_links
- record_finding_link
- list_threat_stories
- record_threat_story

Operating strategy:
- Start by reading /workspace/wiki/README.md, /workspace/wiki/overview.md, /workspace/wiki/runtime-deployment-map.md, /workspace/wiki/security-surfaces.md, and /workspace/wiki/assumptions-and-open-questions.md if they exist.
- Build a short working map of active product surfaces before assessing scanner output: cloud providers/accounts/projects, Kubernetes clusters, repos, data stores, public ingress, identities/service accounts, secrets, and agent/workflow runtime.
- First fetch enough findings to understand the source kinds, providers, and repeated patterns.
- Use list_finding_assessment_candidates with assessmentVerdict "unassessed" for the first pass; it is designed for noise reduction and safer bulk review.
- Decide how to parallelize after seeing the data. Use subagents/parallel workers where useful, but reconcile and write final assessments yourself.
- If you generate code to process findings, make it evidence-preserving: extract provider/account/project/resource/rule/status/message from each finding's own observations/evidence and do not hard-code a provider/account/project across a mixed batch.
- Do a dry-run sample before bulk writes. If sample notes hallucinate provider, invert the scanner result, or ignore wiki relevance, fix the script/prompt and retry before writing assessments.
- Keep going until every currently open finding in scope has an assessment, or report the exact remaining IDs if a hard runtime limit stops you.
- Keep product-owned runtime, identity, secret, ingress, network, database, data access, and agent/workflow execution findings visible.
- Mark findings not_relevant/noise when wiki + inventory do not show a meaningful active service, identity, endpoint, data path, customer impact, or compliance impact.
- Prefer "needs_context" over "actionable" when the finding might matter but the wiki/inventory cannot prove the affected resource is part of the active product.

Final answer format:
- assessed: number
- actionable: number
- noise_or_not_relevant: number
- needs_context: number
- links_recorded: number
- stories_recorded: number
- notes: concise explanation of the highest-impact remaining issues and highest-volume noise class.`;

// ──────────────────────────────────────────────────────────────────────────────
// Template 1: Secret Scan
// Entry Point → Clone Repo → TruffleHog → Normalize → [Markdown, Analytics Sink]
// ──────────────────────────────────────────────────────────────────────────────
function secretScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const trufflehog = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');
  const analytics = nid('node');

  return {
    name: 'Secret Scan',
    slug: 'sys-secret-scan',
    description:
      'Scan a repository for exposed secrets, API keys, and credentials using TruffleHog.',
    category: 'code-security',
    icon: 'shield',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Secret Scan',
      description: 'Scan for exposed secrets using TruffleHog',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [],
        }),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 600, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 900, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, -100),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1200, 100, {
          dataInputs: [{ id: 'input1', label: 'Secret Findings', sourceTag: 'trufflehog' }],
        }),
      ],
      edges: [
        // entrypoint → clone: repo info injected via componentParams at trigger time
        makeEdge('e1', entryPoint, cloneRepo),
        // clone → trufflehog: pass volume name so scanner can access cloned files
        makeEdge('e2', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        // trufflehog → normalize: pass raw findings
        makeEdge('e3', trufflehog, normalize, 'findings', 'rawFindings'),
        // normalize → markdown: pass normalized findings
        makeEdge('e4', normalize, markdown, 'findings', 'findings'),
        // trufflehog → analytics: index findings for dashboards (bypass normalize)
        makeEdge('e5', trufflehog, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 2: SAST Scan
// Entry Point → Clone Repo → OpenGrep → Normalize → [Markdown, Analytics Sink]
// ──────────────────────────────────────────────────────────────────────────────
function sastScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const opengrep = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');
  const analytics = nid('node');

  return {
    name: 'SAST Scan',
    slug: 'sys-sast-scan',
    description:
      'Static Application Security Testing using OpenGrep (Semgrep) to find code vulnerabilities.',
    category: 'code-security',
    icon: 'search',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'SAST Scan',
      description: 'Static analysis with OpenGrep',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [],
        }),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 600, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 900, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, -100),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1200, 100, {
          dataInputs: [{ id: 'input1', label: 'SAST Findings', sourceTag: 'opengrep' }],
        }),
      ],
      edges: [
        makeEdge('e1', entryPoint, cloneRepo),
        makeEdge('e2', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e3', opengrep, normalize, 'findings', 'rawFindings'),
        makeEdge('e4', normalize, markdown, 'findings', 'findings'),
        // opengrep → analytics: index findings for dashboards (bypass normalize)
        makeEdge('e5', opengrep, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 3: Dependency Scan
// Entry Point → Clone Repo → Dependency Scanner → Normalize → [Markdown, Analytics Sink]
// ──────────────────────────────────────────────────────────────────────────────
function dependencyScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const depScanner = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');
  const analytics = nid('node');

  return {
    name: 'Dependency Scan',
    slug: 'sys-dependency-scan',
    description: 'Scan dependencies for known vulnerabilities using dependency analysis.',
    category: 'code-security',
    icon: 'package',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Dependency Scan',
      description: 'Dependency vulnerability analysis',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [],
        }),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 600, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 900, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, -100),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1200, 100, {
          dataInputs: [{ id: 'input1', label: 'Dependency Findings', sourceTag: 'dependency' }],
        }),
      ],
      edges: [
        makeEdge('e1', entryPoint, cloneRepo),
        makeEdge('e2', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        makeEdge('e3', depScanner, normalize, 'findings', 'rawFindings'),
        makeEdge('e4', normalize, markdown, 'findings', 'findings'),
        // depScanner → analytics: index findings for dashboards (bypass normalize)
        makeEdge('e5', depScanner, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 4: Full Code Security
// Entry Point → Clone Repo → [TruffleHog, OpenGrep, Dep Scanner] (parallel)
//   each scanner → Normalize → Markdown → Text Joiner (unified summary)
//   each Normalize → Analytics Sink (indexed findings)
// ──────────────────────────────────────────────────────────────────────────────
function fullCodeSecurityTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const trufflehog = nid('node');
  const opengrep = nid('node');
  const depScanner = nid('node');
  const dedupe = nid('node');
  const analytics = nid('node');

  return {
    name: 'Full Code Security',
    slug: 'sys-full-code-security',
    description:
      'Multi-scanner analysis: secrets, SAST, and dependency vulnerabilities in parallel with cross-scanner deduplication.',
    category: 'code-security',
    icon: 'shield-check',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Full Code Security',
      description: 'Secrets + SAST + Dependencies in parallel, deduped',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [],
        }),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        // Scanners (parallel)
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 600, -200),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 600, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 600, 200),
        // Cross-scanner deduplication
        makeNode(dedupe, 'core.security.findings-dedupe', 'Findings Dedupe', 900, 0),
        // Analytics sink (deduped findings)
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1200, 0, {
          dataInputs: [
            { id: 'input1', label: 'All Findings (Deduped)', sourceTag: 'code-security' },
          ],
        }),
      ],
      edges: [
        // Entry → Clone (repo info injected via componentParams at trigger time)
        makeEdge('e1', entryPoint, cloneRepo),
        // Clone → Scanners (volume name)
        makeEdge('e2', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        makeEdge('e3', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e4', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        // Scanners → Dedupe (results ports)
        makeEdge('e5', trufflehog, dedupe, 'results', 'secretResults'),
        makeEdge('e6', opengrep, dedupe, 'results', 'sastResults'),
        makeEdge('e7', depScanner, dedupe, 'results', 'depResults'),
        // Dedupe → Analytics Sink
        makeEdge('e8', dedupe, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.5 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 5: PR Security Gate
// PR Context → Clone Repo → [TruffleHog, OpenGrep, Dep Scanner] (parallel)
//   each → Normalize → Markdown → Joiner → [PR Comment, Check Run]
//   each Normalize → Analytics Sink (indexed findings)
// ──────────────────────────────────────────────────────────────────────────────
function prSecurityGateTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const prContext = nid('node');
  const cloneRepo = nid('node');
  const trufflehog = nid('node');
  const opengrep = nid('node');
  const depScanner = nid('node');
  const normSecrets = nid('node');
  const normSast = nid('node');
  const normDeps = nid('node');
  const mdSecrets = nid('node');
  const mdSast = nid('node');
  const mdDeps = nid('node');
  const reportArray = nid('node');
  const joiner = nid('node');
  const prComment = nid('node');
  const checkRun = nid('node');
  const analytics = nid('node');

  return {
    name: 'PR Security Gate',
    slug: 'sys-pr-security-gate',
    description:
      'Auto-scan every PR with secrets, SAST, and dependency checks. Posts results as PR comment and check run.',
    category: 'code-security',
    icon: 'git-pull-request',
    isFeatured: false,
    isDefault: true,
    graph: {
      name: 'PR Security Gate',
      description: 'Auto-scan PRs and post results',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            { id: 'installationId', label: 'Installation ID', type: 'number' },
            { id: 'repository', label: 'Repository', type: 'text' },
            { id: 'owner', label: 'Owner', type: 'text' },
            { id: 'repo', label: 'Repository Name', type: 'text' },
            { id: 'prNumber', label: 'PR Number', type: 'number' },
          ],
        }),
        makeNode(prContext, 'github.pr.context', 'PR Context', 300, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 600, 0),
        // Scanners
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 900, -200),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 900, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 900, 200),
        // Normalize per scanner
        makeNode(normSecrets, 'security.findings.normalize', 'Normalize Secrets', 1200, -200),
        makeNode(normSast, 'security.findings.normalize', 'Normalize SAST', 1200, 0),
        makeNode(normDeps, 'security.findings.normalize', 'Normalize Deps', 1200, 200),
        // Markdown per scanner
        makeNode(mdSecrets, 'security.findings.markdown', 'Secrets Report', 1500, -200),
        makeNode(mdSast, 'security.findings.markdown', 'SAST Report', 1500, 0),
        makeNode(mdDeps, 'security.findings.markdown', 'Deps Report', 1500, 200),
        // Collect markdown outputs into list<text> for joiner
        makeNode(reportArray, 'core.array.pack', 'Pack Reports', 1700, 0),
        // Unified summary
        makeNode(joiner, 'core.text.joiner', 'Combined Report', 1900, 0, {
          separator: '\n\n---\n\n',
        }),
        // PR outputs
        makeNode(prComment, 'github.pr.comment', 'PR Comment', 2200, -150),
        makeNode(checkRun, 'github.check.create', 'Check Run', 2200, 0, undefined, {
          name: 'Security Gate',
          status: 'completed',
          conclusion: 'neutral',
        }),
        // Analytics sink (all scanner findings)
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 2200, 150, {
          dataInputs: [
            { id: 'input1', label: 'Secret Findings', sourceTag: 'trufflehog' },
            { id: 'input2', label: 'SAST Findings', sourceTag: 'opengrep' },
            { id: 'input3', label: 'Dependency Findings', sourceTag: 'dependency' },
          ],
        }),
      ],
      edges: [
        // Entry Point → PR Context (required PR lookup inputs)
        makeEdge('e1', entryPoint, prContext, 'installationId', 'installationId'),
        makeEdge('e2', entryPoint, prContext, 'owner', 'owner'),
        makeEdge('e3', entryPoint, prContext, 'repo', 'repo'),
        makeEdge('e4', entryPoint, prContext, 'prNumber', 'pullNumber'),
        // Entry Point + PR Context → Clone
        makeEdge('e5', entryPoint, cloneRepo, 'installationId', 'installationId'),
        makeEdge('e6', entryPoint, cloneRepo, 'repository', 'repository'),
        makeEdge('e7', prContext, cloneRepo, 'headBranch', 'branch'),
        makeEdge('e8', prContext, cloneRepo, 'headSha', 'ref'),
        // PR Context → Scanners (pass changed files for diff-only scanning)
        makeEdge('e9', prContext, trufflehog, 'changedFiles', 'changedFiles'),
        makeEdge('e10', prContext, opengrep, 'changedFiles', 'changedFiles'),
        // Clone → Scanners
        makeEdge('e11', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        makeEdge('e12', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e13', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        // Scanners → Normalize
        makeEdge('e14', trufflehog, normSecrets, 'findings', 'rawFindings'),
        makeEdge('e15', opengrep, normSast, 'findings', 'rawFindings'),
        makeEdge('e16', depScanner, normDeps, 'findings', 'rawFindings'),
        // Normalize → Markdown
        makeEdge('e17', normSecrets, mdSecrets, 'findings', 'findings'),
        makeEdge('e18', normSast, mdSast, 'findings', 'findings'),
        makeEdge('e19', normDeps, mdDeps, 'findings', 'findings'),
        // Markdown → Array Pack → Joiner
        makeEdge('e20', mdSecrets, reportArray, 'markdown', 'a'),
        makeEdge('e21', mdSast, reportArray, 'markdown', 'b'),
        makeEdge('e22', mdDeps, reportArray, 'markdown', 'c'),
        makeEdge('e23', reportArray, joiner, 'items', 'items'),
        // Joiner → PR Comment
        makeEdge('e24', joiner, prComment, 'text', 'body'),
        makeEdge('e25', entryPoint, prComment, 'installationId', 'installationId'),
        makeEdge('e26', entryPoint, prComment, 'owner', 'owner'),
        makeEdge('e27', entryPoint, prComment, 'repo', 'repo'),
        makeEdge('e28', entryPoint, prComment, 'prNumber', 'prNumber'),
        // PR Context + Entry Point → Check Run
        makeEdge('e29', entryPoint, checkRun, 'installationId', 'installationId'),
        makeEdge('e30', entryPoint, checkRun, 'owner', 'owner'),
        makeEdge('e31', entryPoint, checkRun, 'repo', 'repo'),
        makeEdge('e32', prContext, checkRun, 'headSha', 'headSha'),
        // Scanners → Analytics (bypass normalize, use results port directly)
        makeEdge('e33', trufflehog, analytics, 'results', 'input1'),
        makeEdge('e34', opengrep, analytics, 'results', 'input2'),
        makeEdge('e35', depScanner, analytics, 'results', 'input3'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.45 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 6: AI Code Review
// PR Context → Clone → [Scanners] → Normalize → Markdown → Joiner → AI Agent → PR Comment
//   each Normalize → Analytics Sink (indexed findings)
// ──────────────────────────────────────────────────────────────────────────────
function aiCodeReviewTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const prContext = nid('node');
  const cloneRepo = nid('node');
  const opengrep = nid('node');
  const trufflehog = nid('node');
  const depScanner = nid('node');
  const normSast = nid('node');
  const normSecrets = nid('node');
  const normDeps = nid('node');
  const mdSast = nid('node');
  const mdSecrets = nid('node');
  const mdDeps = nid('node');
  const reportArray = nid('node');
  const joiner = nid('node');
  const aiAgent = nid('node');
  const prComment = nid('node');
  const analytics = nid('node');

  return {
    name: 'AI Code Review',
    slug: 'sys-ai-code-review',
    description:
      'AI-powered code review: scans PR with SAST, secrets, and dependencies, then uses AI to analyze findings in context and post a review.',
    category: 'code-security',
    icon: 'sparkles',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'AI Code Review',
      description: 'AI-powered security analysis on PRs',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            { id: 'installationId', label: 'Installation ID', type: 'number' },
            { id: 'repository', label: 'Repository', type: 'text' },
            { id: 'owner', label: 'Owner', type: 'text' },
            { id: 'repo', label: 'Repository Name', type: 'text' },
            { id: 'prNumber', label: 'PR Number', type: 'number' },
          ],
        }),
        makeNode(prContext, 'github.pr.context', 'PR Context', 300, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 600, 0),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 900, -200),
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 900, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 900, 200),
        makeNode(normSast, 'security.findings.normalize', 'Normalize SAST', 1200, -200),
        makeNode(normSecrets, 'security.findings.normalize', 'Normalize Secrets', 1200, 0),
        makeNode(normDeps, 'security.findings.normalize', 'Normalize Deps', 1200, 200),
        makeNode(mdSast, 'security.findings.markdown', 'SAST Report', 1500, -200),
        makeNode(mdSecrets, 'security.findings.markdown', 'Secrets Report', 1500, 0),
        makeNode(mdDeps, 'security.findings.markdown', 'Deps Report', 1500, 200),
        makeNode(reportArray, 'core.array.pack', 'Pack Reports', 1700, 0),
        makeNode(joiner, 'core.text.joiner', 'Combined Report', 1900, 0, {
          separator: '\n\n---\n\n',
        }),
        makeNode(aiAgent, 'core.ai.agent', 'AI Agent', 2200, -100, {
          systemPrompt:
            'You are a security code reviewer. Analyze the following security scan report from a pull request. For each finding, assess whether it is actionable or a likely false positive. Provide clear remediation guidance and prioritize the most critical issues.',
        }),
        makeNode(prComment, 'github.pr.comment', 'PR Comment', 2500, -100),
        // Analytics sink (all scanner findings)
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 2200, 150, {
          dataInputs: [
            { id: 'input1', label: 'SAST Findings', sourceTag: 'opengrep' },
            { id: 'input2', label: 'Secret Findings', sourceTag: 'trufflehog' },
            { id: 'input3', label: 'Dependency Findings', sourceTag: 'dependency' },
          ],
        }),
      ],
      edges: [
        // Entry Point → PR Context
        makeEdge('e1', entryPoint, prContext, 'installationId', 'installationId'),
        makeEdge('e2', entryPoint, prContext, 'owner', 'owner'),
        makeEdge('e3', entryPoint, prContext, 'repo', 'repo'),
        makeEdge('e4', entryPoint, prContext, 'prNumber', 'pullNumber'),
        // Entry Point + PR Context → Clone
        makeEdge('e5', entryPoint, cloneRepo, 'installationId', 'installationId'),
        makeEdge('e6', entryPoint, cloneRepo, 'repository', 'repository'),
        makeEdge('e7', prContext, cloneRepo, 'headBranch', 'branch'),
        makeEdge('e8', prContext, cloneRepo, 'headSha', 'ref'),
        // PR Context → Scanners (changed files)
        makeEdge('e9', prContext, opengrep, 'changedFiles', 'changedFiles'),
        makeEdge('e10', prContext, trufflehog, 'changedFiles', 'changedFiles'),
        // Clone → Scanners
        makeEdge('e11', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e12', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        makeEdge('e13', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        // Scanners → Normalize
        makeEdge('e14', opengrep, normSast, 'findings', 'rawFindings'),
        makeEdge('e15', trufflehog, normSecrets, 'findings', 'rawFindings'),
        makeEdge('e16', depScanner, normDeps, 'findings', 'rawFindings'),
        // Normalize → Markdown
        makeEdge('e17', normSast, mdSast, 'findings', 'findings'),
        makeEdge('e18', normSecrets, mdSecrets, 'findings', 'findings'),
        makeEdge('e19', normDeps, mdDeps, 'findings', 'findings'),
        // Markdown → Array Pack → Joiner
        makeEdge('e20', mdSast, reportArray, 'markdown', 'a'),
        makeEdge('e21', mdSecrets, reportArray, 'markdown', 'b'),
        makeEdge('e22', mdDeps, reportArray, 'markdown', 'c'),
        makeEdge('e23', reportArray, joiner, 'items', 'items'),
        // Joiner → AI Agent (combined report as user input)
        makeEdge('e24', joiner, aiAgent, 'text', 'userInput'),
        // AI Agent → PR Comment
        makeEdge('e25', aiAgent, prComment, 'responseText', 'body'),
        makeEdge('e26', entryPoint, prComment, 'installationId', 'installationId'),
        makeEdge('e27', entryPoint, prComment, 'owner', 'owner'),
        makeEdge('e28', entryPoint, prComment, 'repo', 'repo'),
        makeEdge('e29', entryPoint, prComment, 'prNumber', 'prNumber'),
        // Scanners → Analytics (bypass normalize, use results port directly)
        makeEdge('e30', opengrep, analytics, 'results', 'input1'),
        makeEdge('e31', trufflehog, analytics, 'results', 'input2'),
        makeEdge('e32', depScanner, analytics, 'results', 'input3'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.4 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 7: AWS Cloud Security Scan
// Entry Point → Resolve AWS Credentials → Prowler → [Analytics Sink, Normalize → Persist]
// ──────────────────────────────────────────────────────────────────────────────
function awsCloudSecurityScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const awsCreds = nid('node');
  const prowler = nid('node');
  const analytics = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'AWS Cloud Security Scan',
    slug: 'sys-aws-cloud-security-scan',
    description:
      'Scan AWS accounts with Prowler, index analytics, and persist product-grade findings.',
    category: 'cloud-security',
    icon: 'cloud',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'AWS Cloud Security Scan',
      description: 'AWS cloud security scan with explicit AWS credential resolution',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [{ id: 'connectionId', label: 'AWS Account', type: 'text' }],
        }),
        makeNode(
          awsCreds,
          'core.integration.resolve-aws-credentials',
          'Resolve AWS Credentials',
          300,
          0,
          {},
        ),
        makeNode(prowler, 'security.prowler.scan', 'Prowler', 600, 0),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 900, 0, {
          dataInputs: [{ id: 'input1', label: 'Prowler Findings', sourceTag: 'prowler' }],
        }),
        makeNode(
          normalize,
          'shipsec.cloud-findings.normalize',
          'Normalize Cloud Findings',
          900,
          180,
          {},
          { provider: 'aws' },
        ),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist Findings', 1200, 180),
      ],
      edges: [
        // Entry Point → Resolve Credentials (connectionId)
        makeEdge('e1', entryPoint, awsCreds, 'connectionId', 'connectionId'),
        // Resolve Credentials → Prowler (AWS credentials, accountId, regions)
        makeEdge('e2', awsCreds, prowler, 'credentials', 'credentials'),
        makeEdge('e2b', awsCreds, prowler, 'accountId', 'accountId'),
        makeEdge('e2c', awsCreds, prowler, 'regions', 'regions'),
        // Prowler → Analytics for fast charts
        makeEdge('e3', prowler, analytics, 'results', 'input1'),
        // Prowler → Normalize → Persist for product graph/compliance surfaces
        makeEdge('e4', prowler, normalize, 'findings', 'rawFindings'),
        makeEdge('e5', prowler, normalize, 'rawOutput', 'rawOutput'),
        makeEdge('e6', prowler, normalize, 'scanId', 'scanId'),
        makeEdge('e7', awsCreds, normalize, 'accountId', 'accountId'),
        makeEdge('e8', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 8: GCP Cloud Security Scan
// Entry Point → Resolve GCP Credentials → Prowler → [Analytics Sink, Normalize → Persist]
// ──────────────────────────────────────────────────────────────────────────────
function gcpCloudSecurityScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const gcpCreds = nid('node');
  const prowler = nid('node');
  const analytics = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'GCP Cloud Security Scan',
    slug: 'sys-gcp-cloud-security-scan',
    description:
      'Scan Google Cloud projects and organizations with Prowler and index findings into Analytics.',
    category: 'cloud-security',
    icon: 'cloud',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'GCP Cloud Security Scan',
      description: 'Google Cloud security scan with explicit GCP credential resolution',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [{ id: 'connectionId', label: 'GCP Account', type: 'text' }],
        }),
        makeNode(
          gcpCreds,
          'core.integration.resolve-gcp-credentials',
          'Resolve GCP Credentials',
          300,
          0,
          {},
        ),
        makeNode(prowler, 'security.prowler.scan', 'Prowler', 600, 0, { scanMode: 'gcp' }),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 900, 0, {
          dataInputs: [{ id: 'input1', label: 'Prowler Findings', sourceTag: 'prowler' }],
        }),
        makeNode(
          normalize,
          'shipsec.cloud-findings.normalize',
          'Normalize Cloud Findings',
          900,
          180,
          {},
          { provider: 'gcp' },
        ),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist Findings', 1200, 180),
      ],
      edges: [
        makeEdge('e1', entryPoint, gcpCreds, 'connectionId', 'connectionId'),
        makeEdge('e2', gcpCreds, prowler, 'gcpCredential', 'gcpCredential'),
        makeEdge('e2b', gcpCreds, prowler, 'accountId', 'accountId'),
        makeEdge('e2c', gcpCreds, prowler, 'regions', 'regions'),
        makeEdge('e3', prowler, analytics, 'results', 'input1'),
        makeEdge('e4', prowler, normalize, 'findings', 'rawFindings'),
        makeEdge('e5', prowler, normalize, 'rawOutput', 'rawOutput'),
        makeEdge('e6', prowler, normalize, 'scanId', 'scanId'),
        makeEdge('e7', gcpCreds, normalize, 'accountId', 'accountId'),
        makeEdge('e8', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 9: Kubernetes Security Scan
// Entry Point → Prowler(kubernetes) → [Analytics Sink, Normalize → Persist]
// ──────────────────────────────────────────────────────────────────────────────
function kubernetesSecurityScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const secretFetch = nid('node');
  const prowler = nid('node');
  const analytics = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'Kubernetes Security Scan',
    slug: 'sys-kubernetes-security-scan',
    description:
      'Scan Kubernetes clusters with Prowler using a supplied kubeconfig and index findings into Analytics.',
    category: 'cloud-security',
    icon: 'container',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Kubernetes Security Scan',
      description: 'Kubernetes cluster posture scan with kubeconfig input',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            {
              id: 'kubeconfigSecretId',
              label: 'Kubeconfig Secret',
              type: 'secret',
              required: true,
              description:
                'Secret ID or name containing the kubeconfig YAML for the target cluster.',
            },
          ],
        }),
        makeNode(secretFetch, 'core.secret.fetch', 'Load Kubeconfig Secret', 300, 0, {
          outputFormat: 'raw',
        }),
        makeNode(prowler, 'security.prowler.scan', 'Prowler', 650, 0, {
          scanMode: 'kubernetes',
        }),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1050, 0, {
          dataInputs: [{ id: 'input1', label: 'Prowler Findings', sourceTag: 'prowler' }],
        }),
        makeNode(
          normalize,
          'shipsec.cloud-findings.normalize',
          'Normalize Cluster Findings',
          1050,
          180,
          {},
          { provider: 'kubernetes' },
        ),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist Findings', 1350, 180),
      ],
      edges: [
        makeEdge('e1', entryPoint, secretFetch, 'kubeconfigSecretId', 'secretId'),
        makeEdge('e2', secretFetch, prowler, 'secret', 'kubeconfig'),
        makeEdge('e3', prowler, analytics, 'results', 'input1'),
        makeEdge('e4', prowler, normalize, 'findings', 'rawFindings'),
        makeEdge('e5', prowler, normalize, 'rawOutput', 'rawOutput'),
        makeEdge('e6', prowler, normalize, 'scanId', 'scanId'),
        makeEdge('e7', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 10: Attack Surface Recon
// Entry Point → Subfinder → DNSx → HTTPx → Dedupe+Enrich → [Analytics, ASM Assets, Normalize → Persist]
// ──────────────────────────────────────────────────────────────────────────────
function attackSurfaceReconTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const subfinder = nid('node');
  const dnsx = nid('node');
  const httpx = nid('node');
  const dedupe = nid('node');
  const analytics = nid('node');
  const asmAssets = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'Attack Surface Recon',
    slug: 'sys-attack-surface-recon',
    description:
      'Recon pipeline: subdomain discovery, DNS resolution, HTTP probing, and deduplicated enrichment.',
    category: 'attack-surface',
    icon: 'globe',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Attack Surface Recon',
      description: 'Domain → Subdomains → DNS → HTTP → Dedupe',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [],
        }),
        makeNode(subfinder, 'shipsec.subfinder.run', 'Subfinder', 300, 0),
        makeNode(dnsx, 'shipsec.dnsx.run', 'DNSx', 600, 0),
        makeNode(httpx, 'shipsec.httpx.scan', 'HTTPx', 900, -80, { techDetect: true }),
        makeNode(dedupe, 'core.asm.recon-dedupe', 'Dedupe + Enrich', 1200, 0),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1500, 0, {
          dataInputs: [{ id: 'input1', label: 'Recon Assets', sourceTag: 'asm-recon' }],
        }),
        makeNode(asmAssets, 'core.asm.assets-upsert', 'ASM Assets', 1500, 160),
        makeNode(normalize, 'shipsec.asm-findings.normalize', 'Normalize ASM Findings', 1500, 320),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist ASM Findings', 1800, 320),
      ],
      edges: [
        // Entry Point → Subfinder (domains injected at trigger time)
        makeEdge('e1', entryPoint, subfinder),
        // Subfinder → DNSx (pass discovered subdomains)
        makeEdge('e2', subfinder, dnsx, 'subdomains', 'domains'),
        // DNSx → HTTPx (pass resolved hosts)
        makeEdge('e3', dnsx, httpx, 'resolvedHosts', 'targets'),
        // DNSx + HTTPx → Dedupe + Enrich
        makeEdge('e4', dnsx, dedupe, 'results', 'dnsResults'),
        makeEdge('e5', httpx, dedupe, 'results', 'httpResults'),
        // Dedupe + Enrich → Analytics + ASM asset inventory
        makeEdge('e6', dedupe, analytics, 'results', 'input1'),
        makeEdge('e7', dedupe, asmAssets, 'results', 'results'),
        // Raw source families → Normalize → Persist for product graph/compliance surfaces
        makeEdge('e8', dnsx, normalize, 'results', 'dnsResults'),
        makeEdge('e9', httpx, normalize, 'results', 'httpResults'),
        makeEdge('e10', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.6 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 11: Container Image Scan
// Entry Point → Trivy (image scan) → Normalize → [Markdown, Analytics Sink]
// ──────────────────────────────────────────────────────────────────────────────
function containerImageScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const trivy = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');
  const analytics = nid('node');

  return {
    name: 'Container Image Scan',
    slug: 'sys-container-image-scan',
    description:
      'Scan container images from any registry (Docker Hub, ECR, GCR, GHCR) for vulnerabilities using Trivy. Supports public and private images with registry credentials.',
    category: 'cloud-security',
    icon: 'container',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Container Image Scan',
      description: 'Scan container images for vulnerabilities',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            {
              id: 'imageRef',
              label: 'Image Reference',
              type: 'text',
              required: true,
              description:
                'Container image to scan (e.g., nginx:latest, 123456.dkr.ecr.us-east-1.amazonaws.com/app:v1)',
            },
          ],
        }),
        makeNode(trivy, 'scanner.trivy', 'Trivy Image Scan', 400, 0, {
          scanType: 'image',
        }),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 800, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, -100),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1200, 100, {
          dataInputs: [{ id: 'input1', label: 'Container Findings', sourceTag: 'trivy' }],
        }),
      ],
      edges: [
        // Entry Point → Trivy: pass image reference
        makeEdge('e1', entryPoint, trivy, 'imageRef', 'imageRef'),
        // Trivy → Normalize → Markdown: pass findings for report
        makeEdge('e2', trivy, normalize, 'findings', 'rawFindings'),
        makeEdge('e3', normalize, markdown, 'findings', 'findings'),
        // Trivy → Analytics: use results port directly (bypass normalize)
        makeEdge('e4', trivy, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.7 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 10: Index Infra
// Entry Point → Asset Inventory Sync
// ──────────────────────────────────────────────────────────────────────────────
function indexInfraTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const assetSync = nid('node');

  return {
    name: 'Index Infra',
    slug: 'sys-index-infra',
    description:
      'Index connected cloud infrastructure into Cartography and update ShipSec cloud inventory state.',
    category: 'cloud-security',
    icon: 'database-zap',
    isFeatured: false,
    isDefault: true,
    graph: {
      name: 'Index Infra',
      description: 'Sync cloud inventory into Cartography and update cloud inventory metadata',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            {
              id: 'integrationId',
              label: 'Integration ID',
              type: 'text',
              required: false,
              description:
                'Optional cloud integration connection ID. Leave empty to use the first available supported cloud connection for the organization.',
            },
          ],
        }),
        makeNode(assetSync, 'security.asset-inventory.sync', 'Asset Inventory Sync', 420, 0, {
          logTailLength: 4000,
        }),
      ],
      edges: [makeEdge('e1', entryPoint, assetSync, 'integrationId', 'integrationId')],
      viewport: { x: 0, y: 0, zoom: 0.9 },
    },
  };
}

function cloudflareSyncTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cartographySync = nid('node');
  return {
    name: 'Cloudflare Sync',
    slug: 'sys-cloudflare-sync',
    description: 'Sync Cloudflare zones and DNS records into the Cartography graph.',
    category: 'cloud-security',
    icon: 'cloud',
    isFeatured: false,
    isDefault: true,
    graph: {
      name: 'Cloudflare Sync',
      description: 'Ingest Cloudflare resources with native Cartography',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            {
              id: 'cloudflareToken',
              label: 'Cloudflare API Token',
              type: 'secret',
              required: true,
            },
          ],
        }),
        makeNode(
          cartographySync,
          'security.cartography.sync',
          'Cloudflare Cartography Sync',
          320,
          0,
          {
            selectedModules: ['cloudflare'],
          },
        ),
      ],
      edges: [makeEdge('e1', entryPoint, cartographySync, 'cloudflareToken', 'cloudflareToken')],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template: Agentic Baseline Code Review
// Entry Point → Clone Repo → OpenCode Agent → Normalize Agent Findings → Persist
// ──────────────────────────────────────────────────────────────────────────────
function agenticBaselineCodeReviewTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const agent = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'Agentic Baseline Code Review',
    slug: 'sys-agentic-baseline-code-review',
    description:
      'Run an autonomous security engineer over the current branch or release and persist agent-discovered code findings as product truth.',
    category: 'code-security',
    icon: 'bot',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Agentic Baseline Code Review',
      description: 'Agent-first code security review for current production-equivalent code',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            { id: 'installationId', label: 'Installation ID', type: 'number', required: false },
            { id: 'repository', label: 'Repository', type: 'text', required: true },
            { id: 'branch', label: 'Branch', type: 'text', required: false },
            { id: 'commitSha', label: 'Commit SHA', type: 'text', required: false },
          ],
        }),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repository', 300, 0, { depth: 1 }),
        makeNode(
          agent,
          'core.ai.opencode',
          'Agentic Security Review',
          650,
          0,
          {
            systemPrompt: AGENTIC_CODE_FINDINGS_PROMPT,
            skills: ['code-security-review', 'linked-finding-reconciliation'],
          },
          {
            task: 'Perform a baseline security review of the mounted repository. Find real issues in the current code and return only structured JSON.',
            model: AGENTIC_CODE_REVIEW_MODEL,
          },
        ),
        makeNode(
          normalize,
          'shipsec.agent-code-findings.normalize',
          'Normalize Agent Findings',
          1000,
          0,
          { reviewMode: 'baseline' },
        ),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist Agent Findings', 1350, 0),
      ],
      edges: [
        makeEdge('e1', entryPoint, cloneRepo, 'installationId', 'installationId'),
        makeEdge('e2', entryPoint, cloneRepo, 'repository', 'repository'),
        makeEdge('e3', entryPoint, cloneRepo, 'branch', 'branch'),
        makeEdge('e4', entryPoint, cloneRepo, 'commitSha', 'ref'),
        makeEdge('e5', cloneRepo, agent, 'volumeName', 'workspaceVolumeName'),
        makeEdge('e6', agent, normalize, 'report', 'agentReport'),
        makeEdge('e7', cloneRepo, normalize, 'repository', 'repository'),
        makeEdge('e8', cloneRepo, normalize, 'branch', 'branch'),
        makeEdge('e9', cloneRepo, normalize, 'commitSha', 'commitSha'),
        makeEdge('e10', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template: Multi-Repo Agentic Code Review
// Entry Point → Clone Repos → OpenCode Agent → Normalize Agent Findings → Persist
// ──────────────────────────────────────────────────────────────────────────────
function multiRepoAgenticCodeReviewTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepos = nid('node');
  const agent = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'Multi-Repo Agentic Code Review',
    slug: 'sys-multi-repo-agentic-code-review',
    description:
      'Run an autonomous security engineer across multiple cooperating repositories and persist cross-repo findings.',
    category: 'code-security',
    icon: 'bot',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Multi-Repo Agentic Code Review',
      description: 'Agent-first code security review over a repo set',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            { id: 'installationId', label: 'Installation ID', type: 'number', required: false },
            {
              id: 'repositories',
              label: 'Repositories',
              type: 'array',
              required: true,
              description:
                'Select cooperating repos as owner/repo values. Example: ["ShipSecAI/studio-cloud","ShipSecAI/studio-oss"]',
            },
            { id: 'branch', label: 'Branch', type: 'text', required: false },
          ],
        }),
        makeNode(cloneRepos, 'github.repos.clone-many', 'Clone Repositories', 300, 0, {
          depth: 1,
        }),
        makeNode(
          agent,
          'core.ai.opencode',
          'Cross-Repo Security Review',
          650,
          0,
          {
            systemPrompt: MULTI_REPO_AGENTIC_CODE_FINDINGS_PROMPT,
            skills: [
              'multi-repo-security-review',
              'code-security-review',
              'linked-finding-reconciliation',
            ],
            timeoutSeconds: 2400,
          },
          {
            task: 'Perform a multi-repository baseline security review. Reason through how the mounted repositories work together and return only structured JSON.',
            model: AGENTIC_CODE_REVIEW_MODEL,
          },
        ),
        makeNode(
          normalize,
          'shipsec.agent-code-findings.normalize',
          'Normalize Agent Findings',
          1000,
          0,
          { reviewMode: 'baseline' },
        ),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist Agent Findings', 1350, 0),
      ],
      edges: [
        makeEdge('e1', entryPoint, cloneRepos, 'installationId', 'installationId'),
        makeEdge('e2', entryPoint, cloneRepos, 'repositories', 'repositories'),
        makeEdge('e3', entryPoint, cloneRepos, 'branch', 'branch'),
        makeEdge('e4', cloneRepos, agent, 'volumeName', 'workspaceVolumeName'),
        makeEdge('e5', cloneRepos, agent, 'commitMap', 'context'),
        makeEdge('e6', agent, normalize, 'report', 'agentReport'),
        makeEdge('e7', cloneRepos, normalize, 'repository', 'repository'),
        makeEdge('e8', cloneRepos, normalize, 'branch', 'branch'),
        makeEdge('e9', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template: Agentic PR Code Review
// PR Context + Clone Repo → OpenCode Agent → Normalize Agent Findings → Persist
// ──────────────────────────────────────────────────────────────────────────────
function agenticPrCodeReviewTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const prContext = nid('node');
  const cloneRepo = nid('node');
  const agent = nid('node');
  const normalize = nid('node');
  const persist = nid('node');

  return {
    name: 'Agentic PR Code Review',
    slug: 'sys-agentic-pr-code-review',
    description:
      'Run an autonomous security review on a pull request, classify new/fixed/worsened findings, and persist them as durable code findings.',
    category: 'code-security',
    icon: 'git-pull-request',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Agentic PR Code Review',
      description: 'Agent-first PR security review with durable finding output',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            { id: 'installationId', label: 'Installation ID', type: 'number', required: true },
            { id: 'repository', label: 'Repository', type: 'text', required: true },
            { id: 'owner', label: 'Owner', type: 'text', required: true },
            { id: 'repo', label: 'Repository Name', type: 'text', required: true },
            { id: 'prNumber', label: 'PR Number', type: 'number', required: true },
          ],
        }),
        makeNode(prContext, 'github.pr.context', 'PR Context', 300, -120),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone PR Head', 300, 120, { depth: 1 }),
        makeNode(
          agent,
          'core.ai.opencode',
          'Agentic PR Security Review',
          650,
          0,
          {
            systemPrompt: AGENTIC_CODE_FINDINGS_PROMPT,
            skills: ['code-security-review', 'linked-finding-reconciliation'],
          },
          {
            task: 'Perform a PR security review. Compare the diff and mounted repository against existing behavior. Return only structured JSON with introduced, worsened, fixed_candidate, unchanged_existing, uncertain, or false_positive findings.',
            model: AGENTIC_CODE_REVIEW_MODEL,
          },
        ),
        makeNode(
          normalize,
          'shipsec.agent-code-findings.normalize',
          'Normalize Agent Findings',
          1000,
          0,
          { reviewMode: 'pr' },
        ),
        makeNode(persist, 'shipsec.ingestion.persist', 'Persist Agent Findings', 1350, 0),
      ],
      edges: [
        makeEdge('e1', entryPoint, prContext, 'installationId', 'installationId'),
        makeEdge('e2', entryPoint, prContext, 'owner', 'owner'),
        makeEdge('e3', entryPoint, prContext, 'repo', 'repo'),
        makeEdge('e4', entryPoint, prContext, 'prNumber', 'pullNumber'),
        makeEdge('e5', entryPoint, cloneRepo, 'installationId', 'installationId'),
        makeEdge('e6', entryPoint, cloneRepo, 'repository', 'repository'),
        makeEdge('e7', prContext, cloneRepo, 'headBranch', 'branch'),
        makeEdge('e8', prContext, cloneRepo, 'headSha', 'ref'),
        makeEdge('e9', cloneRepo, agent, 'volumeName', 'workspaceVolumeName'),
        makeEdge('e10', prContext, agent, 'changedFilesDetailed', 'context'),
        makeEdge('e11', agent, normalize, 'report', 'agentReport'),
        makeEdge('e12', entryPoint, normalize, 'repository', 'repository'),
        makeEdge('e13', prContext, normalize, 'headBranch', 'branch'),
        makeEdge('e14', prContext, normalize, 'headSha', 'commitSha'),
        makeEdge('e15', entryPoint, normalize, 'prNumber', 'prNumber'),
        makeEdge('e16', prContext, normalize, 'changedFilesDetailed', 'context'),
        makeEdge('e17', normalize, persist, 'ingestionBatch', 'ingestionBatch'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template: Security Wiki CODE Ingestion
// Security Wiki Context → Codex Agent
// ──────────────────────────────────────────────────────────────────────────────
function securityWikiCodeIngestionTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const wikiContext = nid('node');
  const codexAgent = nid('node');

  return {
    name: 'CODE Wiki Ingestion',
    slug: 'sys-code-wiki-ingestion',
    description:
      'System workflow that runs Codex in Docker to update the agent-owned security wiki for a repository.',
    category: 'code-security',
    icon: 'book-open',
    isFeatured: false,
    isDefault: true,
    graph: {
      name: 'CODE Wiki Ingestion',
      description:
        'Mount a repo read-only and org security wiki writable, then run Codex CODE ingestion.',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [],
        }),
        makeNode(wikiContext, 'security.wiki.context', 'Security Wiki Context', 320, 0, {
          wikiPath: '/tmp/shipsec-security-wiki',
          wikiAccess: 'write',
          repoPath: '/tmp/shipsec-wiki-repo-bundle',
          repoSlug: 'security-wiki',
          mode: 'repo-security',
          agentName: 'security-wiki-maintainer',
        }),
        makeNode(codexAgent, 'core.ai.codex', 'Codex Agent', 680, 0),
      ],
      edges: [makeEdge('e1', wikiContext, codexAgent, 'wikiContext', 'wikiContext')],
      viewport: { x: 0, y: 0, zoom: 0.9 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template: Threat Story Analysis
// Entry Point → Studio MCP Tools → OpenCode Agent
// ──────────────────────────────────────────────────────────────────────────────
function threatStoryAnalysisTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const studioMcp = nid('node');
  const agent = nid('node');

  return {
    name: 'Threat Story Analysis',
    slug: 'sys-threat-story-analysis',
    description:
      'Run an autonomous analyst over durable findings and links, then record concrete threat stories for the What is broken dashboard.',
    category: 'attack-surface',
    icon: 'bot',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Threat Story Analysis',
      description: 'Agent-first linked finding and threat story analysis',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            {
              id: 'studioApiKey',
              label: 'Studio API Key',
              type: 'secret',
              required: true,
            },
          ],
        }),
        makeNode(
          studioMcp,
          'mcp.group.studio',
          'Studio MCP Tools',
          320,
          0,
          {},
          {},
          { mode: 'tool' },
        ),
        makeNode(
          agent,
          'core.ai.opencode',
          'Threat Story Analyst',
          680,
          0,
          {
            systemPrompt: THREAT_STORY_AGENT_PROMPT,
            skills: ['linked-finding-reconciliation'],
          },
          {
            task: THREAT_STORY_AGENT_TASK,
            model: AGENTIC_CODE_REVIEW_MODEL,
          },
        ),
      ],
      edges: [
        makeEdge('e1', entryPoint, studioMcp, 'studioApiKey', 'apiKey'),
        makeEdge('e2', studioMcp, agent, 'tools', 'tools'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

function findingAssessmentAnalysisTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const wikiContext = nid('node');
  const studioMcp = nid('node');
  const agent = nid('node');

  return {
    name: 'Finding Assessment Analysis',
    slug: 'sys-finding-assessment-analysis',
    description:
      'Run a cheap autonomous OpenCode analyst over unassessed scanner findings to mark what is actionable, noisy, irrelevant, or needs more context before users see it.',
    category: 'attack-surface',
    icon: 'bot',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Finding Assessment Analysis',
      description: 'Agent-first scanner noise reduction and finding assessment',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [
            {
              id: 'studioApiKey',
              label: 'Studio API Key',
              type: 'secret',
              required: true,
            },
          ],
        }),
        makeNode(wikiContext, 'security.wiki.context', 'Security Wiki Context', 320, -180, {
          wikiPath: process.env.SECURITY_WIKI_PATH?.trim() || '../.local/security-wiki',
          wikiAccess: 'read',
          repoSlug: 'shipsec-platform',
          mode: 'general',
          agentName: 'finding-assessment-agent',
        }),
        makeNode(
          studioMcp,
          'mcp.group.studio',
          'Studio MCP Tools',
          320,
          0,
          {},
          {},
          { mode: 'tool' },
        ),
        makeNode(
          agent,
          'core.ai.opencode',
          'Finding Assessment Agent',
          680,
          0,
          {
            systemPrompt: FINDING_ASSESSMENT_AGENT_PROMPT,
            skills: ['finding-assessment-triage', 'linked-finding-reconciliation'],
            timeoutSeconds: 2400,
          },
          {
            task: FINDING_ASSESSMENT_AGENT_TASK,
            model: AGENTIC_CODE_REVIEW_MODEL,
          },
        ),
      ],
      edges: [
        makeEdge('e1', entryPoint, studioMcp, 'studioApiKey', 'apiKey'),
        makeEdge('e2', studioMcp, agent, 'tools', 'tools'),
        makeEdge('e3', wikiContext, agent, 'wikiContext', 'wikiContext'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

/**
 * All seed templates. Import and use with the WorkflowTemplatesService to seed the database.
 */
export const SEED_TEMPLATES: SeedTemplate[] = [
  secretScanTemplate(),
  sastScanTemplate(),
  dependencyScanTemplate(),
  fullCodeSecurityTemplate(),
  prSecurityGateTemplate(),
  agenticBaselineCodeReviewTemplate(),
  multiRepoAgenticCodeReviewTemplate(),
  agenticPrCodeReviewTemplate(),
  securityWikiCodeIngestionTemplate(),
  findingAssessmentAnalysisTemplate(),
  threatStoryAnalysisTemplate(),
  aiCodeReviewTemplate(),
  awsCloudSecurityScanTemplate(),
  gcpCloudSecurityScanTemplate(),
  kubernetesSecurityScanTemplate(),
  attackSurfaceReconTemplate(),
  containerImageScanTemplate(),
  indexInfraTemplate(),
  cloudflareSyncTemplate(),
];
