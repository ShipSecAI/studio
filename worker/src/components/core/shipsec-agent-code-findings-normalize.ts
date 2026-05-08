import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ValidationError,
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import {
  assetIdentitySchema,
  evidenceItemSchema,
  findingInstanceSchema,
  observationSchema,
  scannerRunSchema,
  shipsecIngestionBatchSchema,
} from '@shipsec/contracts';

const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info', 'unknown']);
const reviewModeSchema = z.enum(['baseline', 'pr']);
const findingLifecycleHintSchema = z.enum([
  'introduced',
  'existing',
  'worsened',
  'fixed_candidate',
  'unchanged_existing',
  'uncertain',
  'false_positive',
]);

const confidenceSchema = z.preprocess((value) => {
  if (typeof value === 'number' && value > 1 && value <= 100) return value / 100;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'high') return 0.9;
    if (normalized === 'medium') return 0.7;
    if (normalized === 'low') return 0.4;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  }
  return value;
}, z.number().min(0).max(1));

const lifecycleHintInputSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const aliases: Record<string, z.infer<typeof findingLifecycleHintSchema>> = {
    confirmed: 'existing',
    open: 'existing',
    active: 'existing',
    new: 'introduced',
    fixed: 'fixed_candidate',
    resolved: 'fixed_candidate',
    mitigated: 'fixed_candidate',
    unchanged: 'unchanged_existing',
    false_positive_candidate: 'false_positive',
  };
  return aliases[normalized] ?? normalized;
}, findingLifecycleHintSchema);

const agentCodeFindingSchema = z.object({
  title: z.string().min(1),
  severity: severitySchema.default('unknown'),
  confidence: confidenceSchema.default(0.7),
  category: z.string().optional(),
  weaknessClass: z.string().optional(),
  status: lifecycleHintInputSchema.optional().default('existing'),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  endpoint: z.string().optional(),
  functionName: z.string().optional(),
  packageName: z.string().optional(),
  imageRef: z.string().optional(),
  description: z.string().optional(),
  attackerPrerequisite: z.string().optional(),
  impact: z.string().optional(),
  evidence: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  fix: z.string().optional(),
  verification: z.string().optional(),
  linkedFindingKeys: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const threatCandidateSchema = z.object({
  title: z.string().min(1),
  linkedFindingKeys: z.array(z.string()).default([]),
  impact: z.string().optional(),
  confidence: confidenceSchema.default(0.7),
  evidence: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const agentCodeReviewOutputSchema = z.object({
  findings: z.array(agentCodeFindingSchema).default([]),
  threatCandidates: z.array(threatCandidateSchema).default([]),
  wikiUpdates: z.array(z.unknown()).default([]),
});

const inputSchema = inputs({
  agentReport: port(z.string().min(1), {
    label: 'Agent Report',
    description:
      'Structured JSON report emitted by a Codex/OpenCode security review agent. Fenced JSON is accepted.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  repository: port(z.string().optional(), {
    label: 'Repository',
    description: 'Repository full name, for example shipsec/studio.',
  }),
  branch: port(z.string().optional(), {
    label: 'Branch',
    description: 'Reviewed branch.',
  }),
  commitSha: port(z.string().optional(), {
    label: 'Commit SHA',
    description: 'Reviewed commit SHA.',
  }),
  prNumber: port(z.union([z.string(), z.number()]).optional(), {
    label: 'PR Number',
    description: 'Pull request number when this is a PR review.',
    connectionType: { kind: 'primitive', name: 'text' },
    allowAny: true,
    reason: 'Workflow entrypoints may provide PR numbers as text or number.',
  }),
  context: port(z.unknown().optional(), {
    label: 'Review Context',
    description: 'Optional workflow context such as PR metadata, wiki refs, or prior findings.',
    allowAny: true,
    reason: 'Review context is dynamic JSON.',
  }),
  rawArtifactUri: port(z.string().optional(), {
    label: 'Raw Agent Artifact URI',
    description: 'Durable URI pointing at the raw agent report when available.',
  }),
});

const parameterSchema = parameters({
  reviewMode: param(reviewModeSchema.default('baseline'), {
    label: 'Review Mode',
    editor: 'select',
    options: [
      { label: 'Baseline', value: 'baseline' },
      { label: 'Pull Request', value: 'pr' },
    ],
    description: 'Whether this run reviewed current code or a pull request diff.',
  }),
  sourceVersion: param(z.string().optional().default('agent-code-review-v1'), {
    label: 'Source Version',
    editor: 'text',
    description: 'Agentic code finding schema or prompt version.',
  }),
});

const outputSchema = outputs({
  ingestionBatch: port(shipsecIngestionBatchSchema(), {
    label: 'ShipSec Ingestion Batch',
    description: 'Normalized agentic code findings ready for security ingestion persistence.',
  }),
  scannerRun: port(scannerRunSchema(), {
    label: 'Agent Review Run',
    description: 'Run lineage record for the agentic code review.',
  }),
  findingCount: port(z.number().int().min(0), {
    label: 'Findings',
    description: 'Number of normalized agent code findings.',
  }),
  threatCandidateCount: port(z.number().int().min(0), {
    label: 'Threat Candidates',
    description: 'Number of linked threat candidates carried in normalized metadata.',
  }),
  warnings: port(z.array(z.string()), {
    label: 'Warnings',
    description: 'Non-fatal normalization warnings.',
  }),
});

type AgentCodeFinding = z.infer<typeof agentCodeFindingSchema>;
type ThreatCandidate = z.infer<typeof threatCandidateSchema>;

function stableHash(...parts: unknown[]): string {
  return createHash('sha256')
    .update(
      parts
        .map((part) => {
          if (part == null) return '';
          if (typeof part === 'string') return part.trim().toLowerCase();
          return JSON.stringify(part);
        })
        .join('|'),
    )
    .digest('hex')
    .slice(0, 24);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${stableHash(...parts)}`;
}

function normalizeKeyPart(value: string | undefined, fallback = 'unknown'): string {
  return (value?.trim().toLowerCase().replace(/\s+/g, '-') || fallback)
    .replace(/[|]/g, '-')
    .slice(0, 180);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findString(value: unknown, keys: string[]): string | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
  }
  return undefined;
}

function extractJsonPayload(report: string): unknown {
  const trimmed = report.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fenced/block extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue with first object extraction.
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error('Agent report did not contain parseable JSON.');
}

function evidenceToStrings(evidence: AgentCodeFinding['evidence']): string[] {
  return evidence.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
}

function semanticLocation(finding: AgentCodeFinding): string {
  return (
    finding.endpoint?.trim() ||
    finding.functionName?.trim() ||
    finding.file?.trim() ||
    finding.packageName?.trim() ||
    finding.imageRef?.trim() ||
    normalizeKeyPart(finding.title, 'finding')
  );
}

function assetKindForFinding(finding: AgentCodeFinding) {
  if (finding.endpoint) return 'api_route' as const;
  if (finding.packageName) return 'package' as const;
  if (finding.imageRef) return 'container_image' as const;
  if (finding.file) return 'file' as const;
  return 'repository' as const;
}

function assetStableKey(repository: string, finding: AgentCodeFinding): string {
  const location = semanticLocation(finding);
  const kind = assetKindForFinding(finding);
  return ['code', normalizeKeyPart(repository), kind, normalizeKeyPart(location)].join(':');
}

function findingKey(repository: string, finding: AgentCodeFinding): string {
  if (
    ['fixed_candidate', 'false_positive', 'unchanged_existing', 'worsened'].includes(
      finding.status,
    ) &&
    finding.linkedFindingKeys.length > 0
  ) {
    return finding.linkedFindingKeys[0]!;
  }

  const weakness = normalizeKeyPart(finding.weaknessClass ?? finding.category, 'security-review');
  return `code:${normalizeKeyPart(repository)}:${weakness}:${normalizeKeyPart(semanticLocation(finding))}`;
}

function findingStatus(hint: AgentCodeFinding['status']) {
  if (hint === 'false_positive') return 'false_positive' as const;
  // A PR can suggest a fix, but the durable baseline finding is only fixed after merge/retest.
  if (hint === 'fixed_candidate') return 'in_progress' as const;
  return 'open' as const;
}

function threatRefsForFinding(
  repository: string,
  finding: AgentCodeFinding,
  threats: ThreatCandidate[],
): string[] {
  const key = findingKey(repository, finding);
  return threats
    .filter((threat) =>
      threat.linkedFindingKeys.some(
        (linked) => linked === key || linked.includes(key) || key.includes(linked),
      ),
    )
    .map((threat) => threat.title);
}

const definition = defineComponent({
  id: 'shipsec.agent-code-findings.normalize',
  label: 'Normalize Agent Code Findings',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Normalize structured Codex/OpenCode security review findings into ShipSec product-truth ingestion batches.',
  ui: {
    slug: 'shipsec-agent-code-findings-normalize',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description:
      'Turn agent-discovered code findings and threat candidates into durable security observations and finding instances.',
    icon: 'Bot',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  toolProvider: {
    kind: 'component',
    name: 'agent_code_findings_normalize',
    description: 'Normalize structured agentic code review findings into product truth.',
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const organizationId = context.organizationId ?? context.metadata.organizationId;
    if (!organizationId) {
      throw new ValidationError(
        'Agent code finding normalization requires organizationId context.',
      );
    }

    const warnings: string[] = [];
    const contextRecord = asRecord(parsedInputs.context);
    const repository =
      parsedInputs.repository ??
      findString(contextRecord, ['repository', 'repoFullName', 'fullName']) ??
      'unknown/repository';
    const branch = parsedInputs.branch ?? findString(contextRecord, ['branch', 'headBranch']);
    const commitSha = parsedInputs.commitSha ?? findString(contextRecord, ['commitSha', 'headSha']);
    const prNumber = parsedInputs.prNumber ?? findString(contextRecord, ['prNumber', 'pullNumber']);

    let parsedReport: z.infer<typeof agentCodeReviewOutputSchema>;
    try {
      parsedReport = agentCodeReviewOutputSchema.parse(
        extractJsonPayload(parsedInputs.agentReport),
      );
    } catch (error) {
      throw new ValidationError(
        `Agent code review report must be structured JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const observedAt = new Date().toISOString();
    const scannerRun = scannerRunSchema().parse({
      id: stableId(
        'scanner-run',
        organizationId,
        'ai_code_review',
        repository,
        branch,
        commitSha,
        prNumber,
        context.runId,
      ),
      organizationId,
      sourceKind: 'ai_code_review',
      sourceVersion: parsedParams.sourceVersion,
      scope: {
        organizationId,
        repository,
        branch,
        labels: {
          reviewMode: parsedParams.reviewMode,
          commitSha: commitSha ?? '',
          prNumber: prNumber == null ? '' : String(prNumber),
          workflowId: context.workflowId ?? '',
          workflowName: context.workflowName ?? '',
        },
      },
      triggerKind: parsedParams.reviewMode === 'pr' ? 'webhook' : 'workflow',
      status: 'completed',
      startedAt: observedAt,
      completedAt: observedAt,
      artifactRefs: parsedInputs.rawArtifactUri
        ? [{ uri: parsedInputs.rawArtifactUri, kind: 'agent_output' }]
        : [],
      workflowId: context.workflowId,
      runId: context.runId,
      nodeRef: context.componentRef,
    });

    const repoAsset = assetIdentitySchema().parse({
      id: stableId('asset', organizationId, 'repository', repository),
      organizationId,
      assetKind: 'repository',
      nativeId: repository,
      stableKey: `code:${normalizeKeyPart(repository)}:repository`,
      displayName: repository,
      aliases: [repository],
      confidence: 'deterministic',
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      metadata: { branch, commitSha, prNumber, reviewMode: parsedParams.reviewMode },
    });

    const assetByKey = new Map<string, ReturnType<typeof assetIdentitySchema>['_output']>();
    assetByKey.set(repoAsset.stableKey, repoAsset);
    const evidenceItems: ReturnType<typeof evidenceItemSchema>['_output'][] = [];
    const observations: ReturnType<typeof observationSchema>['_output'][] = [];
    const findingInstances: ReturnType<typeof findingInstanceSchema>['_output'][] = [];

    parsedReport.findings.forEach((finding, index) => {
      const key = findingKey(repository, finding);
      const stableAssetKey = assetStableKey(repository, finding);
      const asset = assetIdentitySchema().parse({
        id: stableId('asset', organizationId, stableAssetKey),
        organizationId,
        assetKind: assetKindForFinding(finding),
        nativeId: semanticLocation(finding),
        stableKey: stableAssetKey,
        displayName: semanticLocation(finding),
        aliases: [semanticLocation(finding)].filter(Boolean),
        confidence:
          finding.endpoint || finding.file || finding.packageName ? 'deterministic' : 'candidate',
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        metadata: {
          repository,
          branch,
          commitSha,
          prNumber,
          file: finding.file,
          line: finding.line,
          endpoint: finding.endpoint,
          functionName: finding.functionName,
          packageName: finding.packageName,
          imageRef: finding.imageRef,
        },
      });
      assetByKey.set(stableAssetKey, asset);

      const artifactUri =
        parsedInputs.rawArtifactUri ?? `memory://${scannerRun.id}/agent-code-finding/${index + 1}`;
      const evidence = evidenceItemSchema().parse({
        id: stableId('evidence', organizationId, scannerRun.id, key, 'agent-output'),
        organizationId,
        kind: 'agent_output',
        sourceKind: 'ai_code_review',
        scannerRunId: scannerRun.id,
        artifactUri,
        summary: `${finding.title}: ${evidenceToStrings(finding.evidence).slice(0, 3).join(' | ')}`,
        capturedAt: observedAt,
        retentionClass: 'audit',
        metadata: {
          findingKey: key,
          evidence: finding.evidence,
          reportIndex: index,
        },
      });
      evidenceItems.push(evidence);

      const observation = observationSchema().parse({
        id: stableId('obs', organizationId, scannerRun.id, key, finding.status),
        organizationId,
        scannerRunId: scannerRun.id,
        sourceKind: 'ai_code_review',
        sourceRuleId: finding.weaknessClass ?? finding.category ?? 'agent-code-review',
        assetRef: asset.id,
        status: finding.status,
        severity: finding.severity,
        title: finding.title,
        rawArtifactRef: { uri: artifactUri, kind: 'agent_output' },
        evidenceRefs: [evidence.id],
        observedAt,
        normalized: {
          repository,
          branch,
          commitSha,
          prNumber,
          reviewMode: parsedParams.reviewMode,
          findingKey: key,
          category: finding.category,
          weaknessClass: finding.weaknessClass,
          file: finding.file,
          line: finding.line,
          endpoint: finding.endpoint,
          functionName: finding.functionName,
          packageName: finding.packageName,
          imageRef: finding.imageRef,
          attackerPrerequisite: finding.attackerPrerequisite,
          impact: finding.impact,
          fix: finding.fix,
          verification: finding.verification,
          linkedFindingKeys: finding.linkedFindingKeys,
          threatRefs: threatRefsForFinding(repository, finding, parsedReport.threatCandidates),
          lifecycleHint: finding.status,
          agentFinding: finding,
        },
      });
      observations.push(observation);

      findingInstances.push(
        findingInstanceSchema().parse({
          id: stableId('finding', organizationId, key),
          organizationId,
          scannerRunId: scannerRun.id,
          observationRefs: [observation.id],
          assetRef: asset.id,
          findingKey: key,
          status: findingStatus(finding.status),
          severity: finding.severity,
          confidence: finding.confidence,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          evidenceRefs: [evidence.id],
          suppressionRef:
            finding.status === 'false_positive' ? `agent:${scannerRun.id}` : undefined,
        }),
      );
    });

    if (parsedReport.findings.length === 0) {
      warnings.push('Agent report contained no findings.');
    }

    const ingestionBatch = shipsecIngestionBatchSchema().parse({
      id: stableId('ingest', organizationId, scannerRun.id, 'agent-code-findings'),
      organizationId,
      sourceKind: 'ai_code_review',
      scannerRun,
      assets: Array.from(assetByKey.values()),
      observations,
      findingInstances,
      evidenceItems,
      stats: {
        rawRecordCount: parsedReport.findings.length,
        assetCount: assetByKey.size,
        observationCount: observations.length,
        findingInstanceCount: findingInstances.length,
        evidenceItemCount: evidenceItems.length,
        passedCount: 0,
        failedCount: parsedReport.findings.length,
        warningCount: warnings.length,
        unknownCount: 0,
      },
      validation: {
        status: warnings.length > 0 ? 'warn' : 'pass',
        errors: [],
        warnings,
      },
      createdAt: observedAt,
    });

    context.logger.info(
      `[AgentCodeFindingsNormalize] findings=${findingInstances.length} threats=${parsedReport.threatCandidates.length} assets=${assetByKey.size} warnings=${warnings.length}`,
    );

    return outputSchema.parse({
      ingestionBatch,
      scannerRun,
      findingCount: findingInstances.length,
      threatCandidateCount: parsedReport.threatCandidates.length,
      warnings,
    });
  },
});

componentRegistry.register(definition);
