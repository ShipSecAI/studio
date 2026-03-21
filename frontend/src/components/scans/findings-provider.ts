import type { ScanFinding, GitHubScanResult } from '@/store/githubStore';

export interface FindingsQuery {
  scanId: string;
  severity?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface FindingsResult {
  findings: ScanFinding[];
  total: number;
  hasMore: boolean;
}

export interface FindingsProvider {
  getFindings(query: FindingsQuery): Promise<FindingsResult>;
  getFinding(scanId: string, findingId: string): Promise<ScanFinding | null>;
}

/**
 * Reads findings from the scan result's embedded findings array.
 * This is the current implementation — findings are returned inline
 * with the scan result from GET /api/v1/github/scans/:id.
 *
 * TODO: swap to analytics-backed provider that queries ClickHouse directly.
 */
export class EmbeddedFindingsProvider implements FindingsProvider {
  constructor(private getScanResult: (id: string) => Promise<GitHubScanResult>) {}

  async getFindings(query: FindingsQuery): Promise<FindingsResult> {
    const scan = await this.getScanResult(query.scanId);
    let findings = scan.findings ?? [];

    if (query.severity?.length) {
      findings = findings.filter((f) => query.severity!.includes(f.severity));
    }

    if (query.search) {
      const term = query.search.toLowerCase();
      findings = findings.filter(
        (f) =>
          f.message.toLowerCase().includes(term) ||
          f.file.toLowerCase().includes(term) ||
          f.type.toLowerCase().includes(term),
      );
    }

    const total = findings.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? findings.length;

    return {
      findings: findings.slice(offset, offset + limit),
      total,
      hasMore: offset + limit < total,
    };
  }

  async getFinding(scanId: string, findingId: string): Promise<ScanFinding | null> {
    const scan = await this.getScanResult(scanId);
    return scan.findings?.find((f) => f.id === findingId) ?? null;
  }
}
