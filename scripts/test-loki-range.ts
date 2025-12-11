#!/usr/bin/env bun

/**
 * Quick helper that compares Loki query_range responses with and without
 * explicit start/end timestamps. Useful for demonstrating that the default
 * window (now − 1h … now) omits historical runs.
 *
 * Usage:
 *   bun run scripts/test-loki-range.ts <runId> <startISO> <endISO> [limit]
 */

const [, , runId, startIso, endIso, limitArg] = process.argv;

if (!runId || !startIso || !endIso) {
  console.error('Usage: bun run scripts/test-loki-range.ts <runId> <startISO> <endISO> [limit]');
  process.exit(1);
}

const limit = Number(limitArg ?? '50');
const baseUrl = (process.env.LOKI_URL ?? 'http://localhost:3100').replace(/\/+$/, '');

function toNanoseconds(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return (BigInt(date.getTime()) * 1000000n).toString();
}

async function queryLoki(params: Record<string, string>) {
  const search = new URLSearchParams({
    query: `{run_id="${runId}"}`,
    limit: String(limit),
    direction: 'forward',
    ...params,
  });
  const url = `${baseUrl}/loki/api/v1/query_range?${search.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Loki query failed (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as {
    data?: { result?: Array<{ values?: [string, string][] }> };
  };
  const results = payload.data?.result ?? [];
  const values = results.flatMap((result) => result.values ?? []);
  return { streamCount: results.length, lineCount: values.length };
}

const startNs = toNanoseconds(startIso);
const endNs = toNanoseconds(endIso);

const [defaultWindow, explicitWindow] = await Promise.all([
  queryLoki({}), // relies on Loki default (≈ last hour)
  queryLoki({ start: startNs, end: endNs }),
]);

console.log(
  JSON.stringify(
    {
      runId,
      lokiUrl: baseUrl,
      defaultWindow,
      explicitWindow,
    },
    null,
    2,
  ),
);
