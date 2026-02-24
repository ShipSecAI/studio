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
// Template 7: Cloud Security Scan
// Entry Point → AWS Credentials → Prowler → Normalize → Analytics Sink
// ──────────────────────────────────────────────────────────────────────────────
function cloudSecurityScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const awsCreds = nid('node');
  const prowler = nid('node');
  const analytics = nid('node');

  return {
    name: 'Cloud Security Scan',
    slug: 'sys-cloud-security-scan',
    description:
      'Scan AWS accounts with Prowler and index findings into Analytics. Supports single-account or org-wide scanning.',
    category: 'cloud-security',
    icon: 'cloud',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Cloud Security Scan',
      description: 'AWS cloud security scan with Prowler',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0, {
          runtimeInputs: [{ id: 'connectionId', label: 'AWS Account', type: 'text' }],
        }),
        makeNode(
          awsCreds,
          'core.integration.resolve-credentials',
          'Resolve AWS Credentials',
          300,
          0,
          { parameters: { provider: 'aws' } },
        ),
        makeNode(prowler, 'security.prowler.scan', 'Prowler', 600, 0),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 900, 0, {
          dataInputs: [{ id: 'input1', label: 'Prowler Findings', sourceTag: 'prowler' }],
        }),
      ],
      edges: [
        // Entry Point → Resolve Credentials (connectionId)
        makeEdge('e1', entryPoint, awsCreds, 'connectionId', 'connectionId'),
        // Resolve Credentials → Prowler (data→credentials, accountId, regions)
        makeEdge('e2', awsCreds, prowler, 'data', 'credentials'),
        makeEdge('e2b', awsCreds, prowler, 'accountId', 'accountId'),
        makeEdge('e2c', awsCreds, prowler, 'regions', 'regions'),
        // Prowler → Analytics (use results port directly, bypass normalize)
        makeEdge('e3', prowler, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 8: Attack Surface Recon
// Entry Point → Subfinder → DNSx → HTTPx → Dedupe+Enrich → Analytics
// ──────────────────────────────────────────────────────────────────────────────
function attackSurfaceReconTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const subfinder = nid('node');
  const dnsx = nid('node');
  const httpx = nid('node');
  const dedupe = nid('node');
  const analytics = nid('node');

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
        // Dedupe + Enrich → Analytics
        makeEdge('e6', dedupe, analytics, 'results', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.6 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 9: Container Image Scan
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

/**
 * All seed templates. Import and use with the WorkflowTemplatesService to seed the database.
 */
export const SEED_TEMPLATES: SeedTemplate[] = [
  secretScanTemplate(),
  sastScanTemplate(),
  dependencyScanTemplate(),
  fullCodeSecurityTemplate(),
  prSecurityGateTemplate(),
  aiCodeReviewTemplate(),
  cloudSecurityScanTemplate(),
  attackSurfaceReconTemplate(),
  containerImageScanTemplate(),
];
