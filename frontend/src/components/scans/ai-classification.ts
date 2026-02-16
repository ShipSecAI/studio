import type { ScanFinding } from '@/store/githubStore';

export type AIClassification = 'actionable' | 'deprioritized';

export interface ClassifiedFinding {
  finding: ScanFinding;
  classification: AIClassification;
  reason: string;
}

export interface AIStats {
  total: number;
  actionable: number;
  deprioritized: number;
  noiseReductionPercent: number;
  breakdown: {
    testFiles: number;
    unverified: number;
    other: number;
  };
}

const TEST_PATH_PATTERNS = [
  /\/test\//i,
  /\/__test__\//i,
  /\/__tests__\//i,
  /\/fixtures?\//i,
  /\/mocks?\//i,
  /\/spec\//i,
  /\.test\./i,
  /\.spec\./i,
  /\/\.github\//i,
  /\/testdata\//i,
];

function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function classifyFinding(finding: ScanFinding): ClassifiedFinding {
  // Check if finding is in test/fixture files
  if (finding.file && isTestFile(finding.file)) {
    return {
      finding,
      classification: 'deprioritized',
      reason: 'Finding in test/fixture file',
    };
  }

  // All other findings are actionable
  return {
    finding,
    classification: 'actionable',
    reason: 'Confirmed finding in production code',
  };
}

export function classifyFindings(findings: ScanFinding[]): ClassifiedFinding[] {
  return findings.map(classifyFinding);
}

export function computeAIStats(findings: ScanFinding[]): AIStats {
  const classified = classifyFindings(findings);
  const actionable = classified.filter((c) => c.classification === 'actionable');
  const deprioritized = classified.filter((c) => c.classification === 'deprioritized');

  const testFiles = deprioritized.filter((c) => c.reason.includes('test/fixture')).length;
  const unverified = deprioritized.filter((c) => c.reason.includes('nverified')).length;

  return {
    total: findings.length,
    actionable: actionable.length,
    deprioritized: deprioritized.length,
    noiseReductionPercent:
      findings.length > 0 ? Math.round((deprioritized.length / findings.length) * 100) : 0,
    breakdown: {
      testFiles,
      unverified,
      other: deprioritized.length - testFiles - unverified,
    },
  };
}
