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
) {
  return {
    id,
    type,
    position: { x, y },
    data: {
      label,
      config: {
        params: config ?? {},
        inputOverrides: {},
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
// Entry Point → Clone Repo → TruffleHog → Normalize → Markdown
// ──────────────────────────────────────────────────────────────────────────────
function secretScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const trufflehog = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');

  return {
    name: 'Secret Scan',
    slug: 'secret-scan',
    description:
      'Scan a repository for exposed secrets, API keys, and credentials using TruffleHog.',
    category: 'code-security',
    icon: 'shield',
    screenshotUrl: '/templates/secret-scan.png',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Secret Scan',
      description: 'Scan for exposed secrets using TruffleHog',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 600, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 900, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, 0),
      ],
      edges: [
        // entrypoint → clone: pass repository name
        makeEdge('e1', entryPoint, cloneRepo, 'input1', 'repository'),
        // clone → trufflehog: pass volume name so scanner can access cloned files
        makeEdge('e2', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        // trufflehog → normalize: pass raw findings
        makeEdge('e3', trufflehog, normalize, 'findings', 'rawFindings'),
        // normalize → markdown: pass normalized findings
        makeEdge('e4', normalize, markdown, 'findings', 'findings'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 2: SAST Scan
// Entry Point → Clone Repo → OpenGrep → Normalize → Markdown
// ──────────────────────────────────────────────────────────────────────────────
function sastScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const opengrep = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');

  return {
    name: 'SAST Scan',
    slug: 'sast-scan',
    description:
      'Static Application Security Testing using OpenGrep (Semgrep) to find code vulnerabilities.',
    category: 'code-security',
    icon: 'search',
    screenshotUrl: '/templates/sast-scan.png',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'SAST Scan',
      description: 'Static analysis with OpenGrep',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 600, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 900, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, 0),
      ],
      edges: [
        makeEdge('e1', entryPoint, cloneRepo, 'input1', 'repository'),
        makeEdge('e2', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e3', opengrep, normalize, 'findings', 'rawFindings'),
        makeEdge('e4', normalize, markdown, 'findings', 'findings'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 3: Dependency Scan
// Entry Point → Clone Repo → Dependency Scanner → Normalize → Markdown
// ──────────────────────────────────────────────────────────────────────────────
function dependencyScanTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const cloneRepo = nid('node');
  const depScanner = nid('node');
  const normalize = nid('node');
  const markdown = nid('node');

  return {
    name: 'Dependency Scan',
    slug: 'dependency-scan',
    description: 'Scan dependencies for known vulnerabilities using dependency analysis.',
    category: 'code-security',
    icon: 'package',
    screenshotUrl: '/templates/dependency-scan.png',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Dependency Scan',
      description: 'Dependency vulnerability analysis',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 600, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 900, 0),
        makeNode(markdown, 'security.findings.markdown', 'Findings Report', 1200, 0),
      ],
      edges: [
        makeEdge('e1', entryPoint, cloneRepo, 'input1', 'repository'),
        makeEdge('e2', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        makeEdge('e3', depScanner, normalize, 'findings', 'rawFindings'),
        makeEdge('e4', normalize, markdown, 'findings', 'findings'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 4: Full Code Security
// Entry Point → Clone Repo → [TruffleHog, OpenGrep, Dep Scanner] (parallel)
//   each scanner → Normalize → Markdown → Text Joiner (unified summary)
// ──────────────────────────────────────────────────────────────────────────────
function fullCodeSecurityTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
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
  const joiner = nid('node');

  return {
    name: 'Full Code Security',
    slug: 'full-code-security',
    description:
      'Multi-scanner analysis: secrets, SAST, and dependency vulnerabilities in parallel.',
    category: 'code-security',
    icon: 'shield-check',
    screenshotUrl: '/templates/full-code-security.png',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Full Code Security',
      description: 'Secrets + SAST + Dependencies in parallel',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        // Scanners (parallel)
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 600, -200),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 600, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 600, 200),
        // Normalize per scanner
        makeNode(normSecrets, 'security.findings.normalize', 'Normalize Secrets', 900, -200),
        makeNode(normSast, 'security.findings.normalize', 'Normalize SAST', 900, 0),
        makeNode(normDeps, 'security.findings.normalize', 'Normalize Deps', 900, 200),
        // Markdown per scanner
        makeNode(mdSecrets, 'security.findings.markdown', 'Secrets Report', 1200, -200),
        makeNode(mdSast, 'security.findings.markdown', 'SAST Report', 1200, 0),
        makeNode(mdDeps, 'security.findings.markdown', 'Deps Report', 1200, 200),
        // Unified summary
        makeNode(joiner, 'core.text.joiner', 'Combined Report', 1500, 0, {
          separator: '\n\n---\n\n',
        }),
      ],
      edges: [
        // Entry → Clone
        makeEdge('e1', entryPoint, cloneRepo, 'input1', 'repository'),
        // Clone → Scanners (volume name)
        makeEdge('e2', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        makeEdge('e3', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e4', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        // Scanners → Normalize
        makeEdge('e5', trufflehog, normSecrets, 'findings', 'rawFindings'),
        makeEdge('e6', opengrep, normSast, 'findings', 'rawFindings'),
        makeEdge('e7', depScanner, normDeps, 'findings', 'rawFindings'),
        // Normalize → Markdown
        makeEdge('e8', normSecrets, mdSecrets, 'findings', 'findings'),
        makeEdge('e9', normSast, mdSast, 'findings', 'findings'),
        makeEdge('e10', normDeps, mdDeps, 'findings', 'findings'),
        // Markdown → Joiner (combine all reports into one)
        makeEdge('e11', mdSecrets, joiner, 'markdown', 'items'),
        makeEdge('e12', mdSast, joiner, 'markdown', 'items'),
        makeEdge('e13', mdDeps, joiner, 'markdown', 'items'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.5 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 5: PR Security Gate
// PR Context → Clone Repo → [TruffleHog, OpenGrep, Dep Scanner] (parallel)
//   each → Normalize → Markdown → Joiner → [PR Comment, Check Run]
// ──────────────────────────────────────────────────────────────────────────────
function prSecurityGateTemplate(): SeedTemplate {
  resetCounter();
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
  const joiner = nid('node');
  const prComment = nid('node');
  const checkRun = nid('node');

  return {
    name: 'PR Security Gate',
    slug: 'pr-security-gate',
    description:
      'Auto-scan every PR with secrets, SAST, and dependency checks. Posts results as PR comment and check run.',
    category: 'code-security',
    icon: 'git-pull-request',
    screenshotUrl: '/templates/pr-security-gate.png',
    isFeatured: false,
    isDefault: true,
    graph: {
      name: 'PR Security Gate',
      description: 'Auto-scan PRs and post results',
      nodes: [
        makeNode(prContext, 'github.pr.context', 'PR Context', 0, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        // Scanners
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 600, -200),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 600, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 600, 200),
        // Normalize per scanner
        makeNode(normSecrets, 'security.findings.normalize', 'Normalize Secrets', 900, -200),
        makeNode(normSast, 'security.findings.normalize', 'Normalize SAST', 900, 0),
        makeNode(normDeps, 'security.findings.normalize', 'Normalize Deps', 900, 200),
        // Markdown per scanner
        makeNode(mdSecrets, 'security.findings.markdown', 'Secrets Report', 1200, -200),
        makeNode(mdSast, 'security.findings.markdown', 'SAST Report', 1200, 0),
        makeNode(mdDeps, 'security.findings.markdown', 'Deps Report', 1200, 200),
        // Unified summary
        makeNode(joiner, 'core.text.joiner', 'Combined Report', 1500, 0, {
          separator: '\n\n---\n\n',
        }),
        // PR outputs
        makeNode(prComment, 'github.pr.comment', 'PR Comment', 1800, -75),
        makeNode(checkRun, 'github.check.create', 'Check Run', 1800, 75),
      ],
      edges: [
        // PR Context → Clone (pass repo info)
        makeEdge('e1', prContext, cloneRepo, 'cloneUrl', 'repository'),
        // PR Context → Scanners (pass changed files for diff-only scanning)
        makeEdge('e2a', prContext, trufflehog, 'changedFiles', 'changedFiles'),
        makeEdge('e2b', prContext, opengrep, 'changedFiles', 'changedFiles'),
        // Clone → Scanners
        makeEdge('e3', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        makeEdge('e4', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e5', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        // Scanners → Normalize
        makeEdge('e6', trufflehog, normSecrets, 'findings', 'rawFindings'),
        makeEdge('e7', opengrep, normSast, 'findings', 'rawFindings'),
        makeEdge('e8', depScanner, normDeps, 'findings', 'rawFindings'),
        // Normalize → Markdown
        makeEdge('e9', normSecrets, mdSecrets, 'findings', 'findings'),
        makeEdge('e10', normSast, mdSast, 'findings', 'findings'),
        makeEdge('e11', normDeps, mdDeps, 'findings', 'findings'),
        // Markdown → Joiner
        makeEdge('e12', mdSecrets, joiner, 'markdown', 'items'),
        makeEdge('e13', mdSast, joiner, 'markdown', 'items'),
        makeEdge('e14', mdDeps, joiner, 'markdown', 'items'),
        // Joiner → PR Comment
        makeEdge('e15', joiner, prComment, 'text', 'body'),
        // PR Context → Check Run (pass SHA and repo info)
        makeEdge('e16', prContext, checkRun, 'headSha', 'headSha'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.45 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 6: AI Code Review
// PR Context → Clone → [Scanners] → Normalize → Markdown → Joiner → AI Agent → PR Comment
// ──────────────────────────────────────────────────────────────────────────────
function aiCodeReviewTemplate(): SeedTemplate {
  resetCounter();
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
  const joiner = nid('node');
  const aiAgent = nid('node');
  const prComment = nid('node');

  return {
    name: 'AI Code Review',
    slug: 'ai-code-review',
    description:
      'AI-powered code review: scans PR with SAST, secrets, and dependencies, then uses AI to analyze findings in context and post a review.',
    category: 'code-security',
    icon: 'sparkles',
    screenshotUrl: '/templates/ai-code-review.png',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'AI Code Review',
      description: 'AI-powered security analysis on PRs',
      nodes: [
        makeNode(prContext, 'github.pr.context', 'PR Context', 0, 0),
        makeNode(cloneRepo, 'github.repo.clone', 'Clone Repo', 300, 0),
        makeNode(opengrep, 'scanner.opengrep', 'OpenGrep', 600, -200),
        makeNode(trufflehog, 'scanner.trufflehog', 'TruffleHog', 600, 0),
        makeNode(depScanner, 'scanner.dependency', 'Dependency Scanner', 600, 200),
        makeNode(normSast, 'security.findings.normalize', 'Normalize SAST', 900, -200),
        makeNode(normSecrets, 'security.findings.normalize', 'Normalize Secrets', 900, 0),
        makeNode(normDeps, 'security.findings.normalize', 'Normalize Deps', 900, 200),
        makeNode(mdSast, 'security.findings.markdown', 'SAST Report', 1200, -200),
        makeNode(mdSecrets, 'security.findings.markdown', 'Secrets Report', 1200, 0),
        makeNode(mdDeps, 'security.findings.markdown', 'Deps Report', 1200, 200),
        makeNode(joiner, 'core.text.joiner', 'Combined Report', 1500, 0, {
          separator: '\n\n---\n\n',
        }),
        makeNode(aiAgent, 'core.ai.agent', 'AI Agent', 1800, 0, {
          systemPrompt:
            'You are a security code reviewer. Analyze the following security scan report from a pull request. For each finding, assess whether it is actionable or a likely false positive. Provide clear remediation guidance and prioritize the most critical issues.',
        }),
        makeNode(prComment, 'github.pr.comment', 'PR Comment', 2100, 0),
      ],
      edges: [
        // PR Context → Clone
        makeEdge('e1', prContext, cloneRepo, 'cloneUrl', 'repository'),
        // PR Context → Scanners (changed files)
        makeEdge('e1a', prContext, opengrep, 'changedFiles', 'changedFiles'),
        makeEdge('e1b', prContext, trufflehog, 'changedFiles', 'changedFiles'),
        // Clone → Scanners
        makeEdge('e2', cloneRepo, opengrep, 'volumeName', 'volumeName'),
        makeEdge('e3', cloneRepo, trufflehog, 'volumeName', 'volumeName'),
        makeEdge('e4', cloneRepo, depScanner, 'volumeName', 'volumeName'),
        // Scanners → Normalize
        makeEdge('e5', opengrep, normSast, 'findings', 'rawFindings'),
        makeEdge('e6', trufflehog, normSecrets, 'findings', 'rawFindings'),
        makeEdge('e7', depScanner, normDeps, 'findings', 'rawFindings'),
        // Normalize → Markdown
        makeEdge('e8', normSast, mdSast, 'findings', 'findings'),
        makeEdge('e9', normSecrets, mdSecrets, 'findings', 'findings'),
        makeEdge('e10', normDeps, mdDeps, 'findings', 'findings'),
        // Markdown → Joiner
        makeEdge('e11', mdSast, joiner, 'markdown', 'items'),
        makeEdge('e12', mdSecrets, joiner, 'markdown', 'items'),
        makeEdge('e13', mdDeps, joiner, 'markdown', 'items'),
        // Joiner → AI Agent (combined report as user input)
        makeEdge('e14', joiner, aiAgent, 'text', 'userInput'),
        // AI Agent → PR Comment
        makeEdge('e15', aiAgent, prComment, 'responseText', 'body'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.4 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 7: AWS Org-Wide Prowler Scan
// AWS Credentials → Prowler → Normalize → Analytics Sink
// ──────────────────────────────────────────────────────────────────────────────
function awsOrgWideProwlerScanTemplate(): SeedTemplate {
  resetCounter();
  const awsCreds = nid('node');
  const prowler = nid('node');
  const normalize = nid('node');
  const analytics = nid('node');

  return {
    name: 'AWS Org-Wide Prowler Scan',
    slug: 'aws-org-prowler-scan',
    description:
      'Resolves AWS org credentials, scans all member accounts with Prowler, and indexes aggregated findings into Analytics.',
    category: 'cloud-security',
    icon: 'cloud',
    screenshotUrl: '/templates/aws-prowler-scan.png',
    isFeatured: false,
    isDefault: true,
    graph: {
      name: 'AWS Org-Wide Prowler Scan',
      description: 'Org-wide Prowler scan across all AWS member accounts',
      nodes: [
        makeNode(awsCreds, 'core.credentials.aws', 'AWS Credentials', 0, 0),
        makeNode(prowler, 'security.prowler.scan', 'Prowler', 300, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 600, 0),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 900, 0),
      ],
      edges: [
        // AWS Creds → Prowler
        makeEdge('e1', awsCreds, prowler, 'credentials', 'credentials'),
        // Prowler → Normalize
        makeEdge('e2', prowler, normalize, 'findings', 'rawFindings'),
        // Normalize → Analytics
        makeEdge('e3', normalize, analytics, 'findings', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Template 8: Attack Surface Recon
// Entry Point → Subfinder → DNSx → [HTTPx, Naabu] → Nuclei → Normalize → [Analytics, Slack]
// ──────────────────────────────────────────────────────────────────────────────
function attackSurfaceReconTemplate(): SeedTemplate {
  resetCounter();
  const entryPoint = nid('node');
  const subfinder = nid('node');
  const dnsx = nid('node');
  const httpx = nid('node');
  const naabu = nid('node');
  const nuclei = nid('node');
  const normalize = nid('node');
  const analytics = nid('node');

  return {
    name: 'Attack Surface Recon',
    slug: 'attack-surface-recon',
    description:
      'Full recon pipeline: subdomain discovery, DNS resolution, HTTP probing, port scanning, and vulnerability scanning.',
    category: 'attack-surface',
    icon: 'globe',
    screenshotUrl: '/templates/attack-surface-recon.png',
    isFeatured: true,
    isDefault: true,
    graph: {
      name: 'Attack Surface Recon',
      description: 'Domain → Subdomains → Ports → Vulns',
      nodes: [
        makeNode(entryPoint, 'core.workflow.entrypoint', 'Entry Point', 0, 0),
        makeNode(subfinder, 'shipsec.subfinder.run', 'Subfinder', 300, 0),
        makeNode(dnsx, 'shipsec.dnsx.run', 'DNSx', 600, 0),
        makeNode(httpx, 'shipsec.httpx.scan', 'HTTPx', 900, -100),
        makeNode(naabu, 'shipsec.naabu.scan', 'Naabu', 900, 100),
        makeNode(nuclei, 'shipsec.nuclei.scan', 'Nuclei', 1200, 0),
        makeNode(normalize, 'security.findings.normalize', 'Normalize Findings', 1500, 0),
        makeNode(analytics, 'core.analytics.sink', 'Analytics Sink', 1800, 0),
      ],
      edges: [
        // Entry Point → Subfinder (pass domains)
        makeEdge('e1', entryPoint, subfinder, 'input1', 'domains'),
        // Subfinder → DNSx (pass discovered subdomains)
        makeEdge('e2', subfinder, dnsx, 'subdomains', 'domains'),
        // DNSx → HTTPx + Naabu (pass resolved hosts)
        makeEdge('e3', dnsx, httpx, 'resolvedHosts', 'targets'),
        makeEdge('e4', dnsx, naabu, 'resolvedHosts', 'targets'),
        // HTTPx → Nuclei (pass live hosts as targets)
        makeEdge('e5', httpx, nuclei, 'responses', 'targets'),
        // Nuclei → Normalize
        makeEdge('e6', nuclei, normalize, 'findings', 'rawFindings'),
        // Normalize → Analytics
        makeEdge('e7', normalize, analytics, 'findings', 'input1'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.6 },
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
  awsOrgWideProwlerScanTemplate(),
  attackSurfaceReconTemplate(),
];
