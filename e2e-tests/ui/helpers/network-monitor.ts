import type { Page, Request } from '@playwright/test';

interface TrackedRequest {
  url: string;
  method: string;
  timestamp: number;
}

// Endpoints that poll or are expected to be called multiple times
const DEFAULT_POLLING_EXCLUSIONS = [
  '/health',
  '/sse',
  '/ws',
];

export class NetworkMonitor {
  private requests: TrackedRequest[] = [];
  private listening = false;

  constructor(private page: Page) {}

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.page.on('request', this.handleRequest);
  }

  stop(): void {
    this.page.off('request', this.handleRequest);
    this.listening = false;
  }

  reset(): void {
    this.requests = [];
  }

  private handleRequest = (request: Request): void => {
    const url = request.url();
    if (url.includes('/api/v1/')) {
      this.requests.push({
        url,
        method: request.method(),
        timestamp: Date.now(),
      });
    }
  };

  getCallsTo(pattern: string | RegExp): TrackedRequest[] {
    return this.requests.filter((r) => {
      if (typeof pattern === 'string') return r.url.includes(pattern);
      return pattern.test(r.url);
    });
  }

  /**
   * Assert no API endpoint is called more than once (excludes polling endpoints).
   */
  assertNoDuplicates(excludePatterns: string[] = []): void {
    const exclusions = [...DEFAULT_POLLING_EXCLUSIONS, ...excludePatterns];
    const counts = new Map<string, number>();

    for (const req of this.requests) {
      // Normalize URL: strip query params
      const normalized = `${req.method} ${new URL(req.url).pathname}`;
      const isExcluded = exclusions.some((p) => normalized.includes(p));
      if (isExcluded) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    if (duplicates.length > 0) {
      const details = duplicates.map(([url, count]) => `  ${url}: ${count} calls`).join('\n');
      throw new Error(`Duplicate API calls detected:\n${details}`);
    }
  }

  /**
   * Assert that during a burst window (e.g. first 5s after navigation),
   * specific endpoints are each called at most once.
   */
  assertNoDuplicatesInBurst(endpoints: string[], burstWindowMs = 5_000): void {
    if (this.requests.length === 0) return;
    const firstTimestamp = this.requests[0].timestamp;
    const burstRequests = this.requests.filter(
      (r) => r.timestamp - firstTimestamp <= burstWindowMs,
    );

    for (const endpoint of endpoints) {
      const calls = burstRequests.filter((r) => r.url.includes(endpoint));
      if (calls.length > 1) {
        throw new Error(
          `Duplicate burst call to ${endpoint}: ${calls.length} calls within ${burstWindowMs}ms`,
        );
      }
    }
  }
}
