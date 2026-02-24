import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  port,
  analyticsResultSchema,
  type AnalyticsResult,
  type Severity,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  secretResults: port(z.array(analyticsResultSchema()).optional().default([]), {
    label: 'Secret Results',
    description: 'Analytics-ready TruffleHog results.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  sastResults: port(z.array(analyticsResultSchema()).optional().default([]), {
    label: 'SAST Results',
    description: 'Analytics-ready OpenGrep results.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  depResults: port(z.array(analyticsResultSchema()).optional().default([]), {
    label: 'Dependency Results',
    description: 'Analytics-ready Dependency Scanner results.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
});

const outputSchema = outputs({
  results: port(z.array(analyticsResultSchema()), {
    label: 'Deduplicated Results',
    description:
      'Cross-scanner deduplicated findings with preserved finding_hash from the winning scanner.',
  }),
  uniqueCount: port(z.number().int(), {
    label: 'Unique Findings',
    description: 'Total unique findings after deduplication.',
  }),
  duplicateCount: port(z.number().int(), {
    label: 'Duplicates Removed',
    description: 'Number of duplicate findings removed.',
  }),
  secretCount: port(z.number().int(), {
    label: 'Secret Findings',
    description: 'Number of unique secret findings.',
  }),
  sastCount: port(z.number().int(), {
    label: 'SAST Findings',
    description: 'Number of unique SAST findings.',
  }),
  depCount: port(z.number().int(), {
    label: 'Dependency Findings',
    description: 'Number of unique dependency findings.',
  }),
});

type FindingCategory = 'secret' | 'sast' | 'dependency';

type GenericRecord = Record<string, unknown>;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  none: 0,
};

const SPECIALIST_SCANNER: Record<FindingCategory, string> = {
  secret: 'trufflehog',
  sast: 'opengrep',
  dependency: 'dependency',
};

const SECRET_RULE_PATTERNS = [
  /^generic\.secrets\./,
  /\.secrets\./,
  /^detected-.*-(key|token|secret)$/,
];

function classifyFinding(record: GenericRecord, sourceScanner: string): FindingCategory {
  if (sourceScanner === 'trufflehog') return 'secret';
  if (sourceScanner === 'dependency') return 'dependency';

  // OpenGrep: infer from rule_id and field presence
  const ruleId = typeof record.rule_id === 'string' ? record.rule_id : '';

  // Check if it looks like a secret detection rule
  if (SECRET_RULE_PATTERNS.some((pattern) => pattern.test(ruleId))) {
    return 'secret';
  }

  // Check if it has all dependency fields
  if (
    typeof record.package === 'string' &&
    typeof record.version === 'string' &&
    typeof record.vulnerability_id === 'string'
  ) {
    return 'dependency';
  }

  // Default for OpenGrep
  return 'sast';
}

function computeDedupeKey(
  record: GenericRecord,
  category: FindingCategory,
  sourceScanner: string,
): string {
  const file = typeof record.file === 'string' ? record.file : '';
  const line = typeof record.line === 'number' && record.line > 0 ? record.line : 0;

  switch (category) {
    case 'secret': {
      // Discriminator: secret_type (TruffleHog) or last segment of rule_id (OpenGrep)
      let discriminator: string;
      if (sourceScanner === 'trufflehog') {
        discriminator = typeof record.secret_type === 'string' ? record.secret_type : 'unknown';
      } else {
        const ruleId = typeof record.rule_id === 'string' ? record.rule_id : 'unknown';
        const segments = ruleId.split('.');
        discriminator = segments[segments.length - 1] || 'unknown';
      }
      return line > 0
        ? `secret:${file}:${line}:${discriminator}`
        : `secret:${file}:${discriminator}`;
    }
    case 'sast': {
      const ruleId = typeof record.rule_id === 'string' ? record.rule_id : '';
      return `sast:${ruleId}:${file}:${line}`;
    }
    case 'dependency': {
      const pkg = typeof record.package === 'string' ? record.package : '';
      const version = typeof record.version === 'string' ? record.version : '';
      const vulnId = typeof record.vulnerability_id === 'string' ? record.vulnerability_id : '';
      return `dep:${pkg}:${version}:${vulnId}`;
    }
  }
}

function severityRank(severity: unknown): number {
  if (typeof severity !== 'string') return 0;
  return SEVERITY_ORDER[severity] ?? 0;
}

function maxSeverity(a: unknown, b: unknown): Severity {
  const rankA = severityRank(a);
  const rankB = severityRank(b);
  const winner = rankA >= rankB ? a : b;
  return typeof winner === 'string' && winner in SEVERITY_ORDER ? (winner as Severity) : 'info';
}

interface TaggedFinding {
  record: GenericRecord;
  category: FindingCategory;
  dedupeKey: string;
  sourceScanner: string;
}

const definition = defineComponent({
  id: 'core.security.findings-dedupe',
  label: 'Findings Dedupe',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Deduplicate security findings across scanners (TruffleHog, OpenGrep, Dependency). Prefers specialist scanners and computes max severity across grouped duplicates.',
  ui: {
    slug: 'findings-dedupe',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Merge and deduplicate findings from multiple security scanners.',
    icon: 'Combine',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute({ inputs }, context) {
    // Tag all findings with their source scanner and classify them
    const tagged: TaggedFinding[] = [];

    for (const entry of inputs.secretResults ?? []) {
      const record = (entry && typeof entry === 'object' ? entry : {}) as GenericRecord;
      const scanner = typeof record.scanner === 'string' ? record.scanner : 'trufflehog';
      const category = classifyFinding(record, scanner);
      tagged.push({
        record,
        category,
        dedupeKey: computeDedupeKey(record, category, scanner),
        sourceScanner: scanner,
      });
    }

    for (const entry of inputs.sastResults ?? []) {
      const record = (entry && typeof entry === 'object' ? entry : {}) as GenericRecord;
      const scanner = typeof record.scanner === 'string' ? record.scanner : 'opengrep';
      const category = classifyFinding(record, scanner);
      tagged.push({
        record,
        category,
        dedupeKey: computeDedupeKey(record, category, scanner),
        sourceScanner: scanner,
      });
    }

    for (const entry of inputs.depResults ?? []) {
      const record = (entry && typeof entry === 'object' ? entry : {}) as GenericRecord;
      const scanner = typeof record.scanner === 'string' ? record.scanner : 'dependency';
      const category = classifyFinding(record, scanner);
      tagged.push({
        record,
        category,
        dedupeKey: computeDedupeKey(record, category, scanner),
        sourceScanner: scanner,
      });
    }

    // Group by dedupeKey
    const groups = new Map<string, TaggedFinding[]>();
    for (const finding of tagged) {
      const group = groups.get(finding.dedupeKey);
      if (group) {
        group.push(finding);
      } else {
        groups.set(finding.dedupeKey, [finding]);
      }
    }

    // Pick winner per group
    const dedupedResults: AnalyticsResult[] = [];
    let secretCount = 0;
    let sastCount = 0;
    let depCount = 0;
    let duplicateCount = 0;

    for (const [dedupeKey, group] of groups) {
      const category = group[0]!.category;
      const specialist = SPECIALIST_SCANNER[category];

      // Sort: specialist first, then by severity (descending)
      const sorted = [...group].sort((a, b) => {
        const aIsSpecialist = a.sourceScanner === specialist ? 1 : 0;
        const bIsSpecialist = b.sourceScanner === specialist ? 1 : 0;
        if (aIsSpecialist !== bIsSpecialist) return bIsSpecialist - aIsSpecialist;
        return severityRank(b.record.severity) - severityRank(a.record.severity);
      });

      const winner = sorted[0]!;

      // Compute max_severity across all grouped duplicates
      let groupMaxSeverity: Severity = (winner.record.severity as Severity) ?? 'info';
      for (const finding of group) {
        groupMaxSeverity = maxSeverity(groupMaxSeverity, finding.record.severity);
      }

      // Collect all source scanners
      const sourceScanners = [...new Set(group.map((f) => f.sourceScanner))];

      duplicateCount += group.length - 1;

      // Track per-category counts
      switch (category) {
        case 'secret':
          secretCount++;
          break;
        case 'sast':
          sastCount++;
          break;
        case 'dependency':
          depCount++;
          break;
      }

      dedupedResults.push({
        ...winner.record,
        // Original finding_hash preserved from winner
        dedupe_key: dedupeKey,
        source_scanners: sourceScanners,
        max_severity: groupMaxSeverity,
        is_duplicate: false,
      } as unknown as AnalyticsResult);
    }

    context.logger.info(
      `[FindingsDedupe] total=${tagged.length} unique=${dedupedResults.length} duplicates=${duplicateCount} secrets=${secretCount} sast=${sastCount} deps=${depCount}`,
    );

    return {
      results: dedupedResults,
      uniqueCount: dedupedResults.length,
      duplicateCount,
      secretCount,
      sastCount,
      depCount,
    };
  },
});

componentRegistry.register(definition);
