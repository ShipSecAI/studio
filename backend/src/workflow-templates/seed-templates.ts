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

const AGENTIC_CODE_REVIEW_MODEL = { provider: 'openai', modelId: 'vertex/claude-haiku-4-5' };

const THREAT_STORY_AGENT_PROMPT = `You are ShipSec's autonomous threat-story analyst.

You turn durable security findings into concrete "what is broken" stories.
Use the ShipSec Studio MCP tools. Do not invent data.

Required workflow:
1. Call list_security_findings with status "open" and a useful limit.
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

Use precise relationship types:
- same_root_cause when findings share the same bug/config source
- enables when one finding makes another exploitable
- same_asset when the same service/resource is affected
- same_control when they fail the same security requirement
- mitigated_by when one finding or action reduces another
- related only when no better type fits

Do not wait for human approval.
Do not merely summarize all findings.
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
  agenticPrCodeReviewTemplate(),
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
