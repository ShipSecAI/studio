import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerAnalyticsTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { securityAnalyticsService } = deps;

  server.registerTool(
    'search_findings',
    {
      description:
        'Search security findings across all scanners (cloud, code, attack surface). ' +
        'Supports filtering by severity, scanner, asset, rule, date range, and free text. ' +
        'Returns deduplicated latest-state findings by default.',
      inputSchema: {
        searchText: z
          .string()
          .optional()
          .describe(
            'Free-text search across finding title, description, rule_id, and asset_key fields.',
          ),
        severity: z
          .enum(['critical', 'high', 'medium', 'low', 'info'])
          .optional()
          .describe('Filter by severity level.'),
        scanner: z
          .string()
          .optional()
          .describe(
            'Filter by scanner name (e.g. "prowler", "nuclei", "trufflehog", "opengrep", "trivy", "dependency").',
          ),
        assetKey: z
          .string()
          .optional()
          .describe(
            'Filter by asset identifier (hostname, file path, package@version, cloud resource).',
          ),
        ruleId: z
          .string()
          .optional()
          .describe('Filter by rule/check ID (e.g. Prowler check_id, Nuclei template-id).'),
        workflowId: z.string().optional().describe('Filter findings from a specific workflow.'),
        runId: z.string().optional().describe('Filter findings from a specific workflow run.'),
        fromDate: z
          .string()
          .optional()
          .describe('Start of date range (ISO 8601). Only applies to event-log queries.'),
        toDate: z
          .string()
          .optional()
          .describe('End of date range (ISO 8601). Only applies to event-log queries.'),
        useLatest: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'If true (default), query the deduplicated latest-state index. If false, query the full event log.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe('Maximum number of findings to return (1-100, default 20).'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe('Pagination offset (default 0).'),
      },
    },
    async (args: {
      searchText?: string;
      severity?: string;
      scanner?: string;
      assetKey?: string;
      ruleId?: string;
      workflowId?: string;
      runId?: string;
      fromDate?: string;
      toDate?: string;
      useLatest?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityAnalyticsService) {
        return errorResult(new Error('Analytics service is not available'));
      }

      try {
        const filters: any[] = [];

        if (args.severity) {
          filters.push({ term: { severity: args.severity } });
        }
        if (args.scanner) {
          filters.push({ term: { scanner: args.scanner } });
        }
        if (args.assetKey) {
          filters.push({ term: { asset_key: args.assetKey } });
        }
        if (args.ruleId) {
          filters.push({
            bool: {
              should: [
                { term: { 'rule_id.keyword': args.ruleId } },
                { term: { check_id: args.ruleId } },
              ],
              minimum_should_match: 1,
            },
          });
        }
        if (args.workflowId) {
          filters.push({ term: { 'shipsec.workflow_id': args.workflowId } });
        }
        if (args.runId) {
          filters.push({ term: { 'shipsec.run_id': args.runId } });
        }
        if (args.fromDate || args.toDate) {
          const range: any = {};
          if (args.fromDate) range.gte = args.fromDate;
          if (args.toDate) range.lte = args.toDate;
          filters.push({ range: { '@timestamp': range } });
        }

        const must: any[] = [];
        if (args.searchText) {
          must.push({
            multi_match: {
              query: args.searchText,
              fields: ['title', 'description', 'rule_id', 'asset_key', 'check_name', 'file'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          });
        }

        const query: any = {
          bool: {
            ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
            ...(filters.length > 0 ? { filter: filters } : {}),
          },
        };

        const result = await securityAnalyticsService.query(auth.organizationId!, {
          query,
          size: args.limit ?? 20,
          from: args.offset ?? 0,
          sort: [{ '@timestamp': { order: 'desc' } }],
          useLatest: args.useLatest ?? true,
        });

        const findings = result.hits.map((hit) => ({
          id: hit._id,
          ...hit._source,
        }));

        return jsonResult({
          total: result.total,
          count: findings.length,
          findings,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_findings_summary',
    {
      description:
        'Get an aggregated summary of security findings: counts by severity, by scanner, and top rules/checks. ' +
        'Useful for understanding the overall security posture at a glance.',
      inputSchema: {
        workflowId: z.string().optional().describe('Scope summary to a specific workflow.'),
        runId: z.string().optional().describe('Scope summary to a specific workflow run.'),
        scanner: z.string().optional().describe('Scope summary to a specific scanner.'),
        fromDate: z.string().optional().describe('Start of date range (ISO 8601).'),
        toDate: z.string().optional().describe('End of date range (ISO 8601).'),
        useLatest: z
          .boolean()
          .optional()
          .default(true)
          .describe('If true (default), summarize from deduplicated latest-state index.'),
      },
    },
    async (args: {
      workflowId?: string;
      runId?: string;
      scanner?: string;
      fromDate?: string;
      toDate?: string;
      useLatest?: boolean;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityAnalyticsService) {
        return errorResult(new Error('Analytics service is not available'));
      }

      try {
        const filters: any[] = [];
        if (args.workflowId) {
          filters.push({ term: { 'shipsec.workflow_id': args.workflowId } });
        }
        if (args.runId) {
          filters.push({ term: { 'shipsec.run_id': args.runId } });
        }
        if (args.scanner) {
          filters.push({ term: { scanner: args.scanner } });
        }
        if (args.fromDate || args.toDate) {
          const range: any = {};
          if (args.fromDate) range.gte = args.fromDate;
          if (args.toDate) range.lte = args.toDate;
          filters.push({ range: { '@timestamp': range } });
        }

        const query: any = filters.length > 0 ? { bool: { filter: filters } } : { match_all: {} };

        const result = await securityAnalyticsService.query(auth.organizationId!, {
          query,
          size: 0,
          useLatest: args.useLatest ?? true,
          aggs: {
            by_severity: {
              terms: { field: 'severity', size: 10 },
            },
            by_scanner: {
              terms: { field: 'scanner', size: 20 },
            },
            top_rules: {
              terms: { field: 'rule_id.keyword', size: 15 },
            },
            top_assets: {
              terms: { field: 'asset_key', size: 15 },
            },
          },
        });

        const extractBuckets = (agg: any) =>
          (agg?.buckets ?? []).map((b: any) => ({
            key: b.key,
            count: b.doc_count,
          }));

        return jsonResult({
          totalFindings: result.total,
          bySeverity: extractBuckets(result.aggregations?.by_severity),
          byScanner: extractBuckets(result.aggregations?.by_scanner),
          topRules: extractBuckets(result.aggregations?.top_rules),
          topAssets: extractBuckets(result.aggregations?.top_assets),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_finding_details',
    {
      description:
        'Get the full details of a specific security finding by its finding hash (unique identifier). ' +
        'Returns the complete finding document including all scanner-specific fields.',
      inputSchema: {
        findingHash: z.string().describe('The finding_hash identifier of the finding to retrieve.'),
      },
    },
    async (args: { findingHash: string }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityAnalyticsService) {
        return errorResult(new Error('Analytics service is not available'));
      }

      try {
        const result = await securityAnalyticsService.query(auth.organizationId!, {
          query: {
            term: { finding_hash: args.findingHash },
          },
          size: 1,
          useLatest: true,
        });

        if (result.hits.length === 0) {
          return jsonResult({ found: false, message: 'No finding found with that hash.' });
        }

        return jsonResult({
          found: true,
          finding: { id: result.hits[0]._id, ...result.hits[0]._source },
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_asset_risk_summary',
    {
      description:
        'Get a risk summary for a specific asset — shows all findings grouped by severity. ' +
        'The asset can be a hostname, file path, package@version, or cloud resource identifier.',
      inputSchema: {
        assetKey: z
          .string()
          .describe(
            'The asset identifier to look up (hostname, file path, package@version, cloud resource).',
          ),
        useLatest: z
          .boolean()
          .optional()
          .default(true)
          .describe('If true (default), use deduplicated latest-state index.'),
      },
    },
    async (args: { assetKey: string; useLatest?: boolean }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityAnalyticsService) {
        return errorResult(new Error('Analytics service is not available'));
      }

      try {
        const result = await securityAnalyticsService.query(auth.organizationId!, {
          query: {
            bool: {
              should: [
                { term: { asset_key: args.assetKey } },
                { wildcard: { asset_key: { value: `*${args.assetKey}*` } } },
              ],
              minimum_should_match: 1,
            },
          },
          size: 0,
          useLatest: args.useLatest ?? true,
          aggs: {
            by_severity: {
              terms: { field: 'severity', size: 10 },
            },
            by_scanner: {
              terms: { field: 'scanner', size: 20 },
            },
            top_rules: {
              terms: { field: 'rule_id.keyword', size: 10 },
            },
            sample_findings: {
              top_hits: {
                size: 10,
                sort: [{ severity: { order: 'asc' } }],
                _source: [
                  'scanner',
                  'severity',
                  'title',
                  'rule_id',
                  'finding_hash',
                  'asset_key',
                  'file',
                  'description',
                  '@timestamp',
                ],
              },
            },
          },
        });

        const extractBuckets = (agg: any) =>
          (agg?.buckets ?? []).map((b: any) => ({
            key: b.key,
            count: b.doc_count,
          }));

        const sampleFindings =
          result.aggregations?.sample_findings?.hits?.hits?.map((h: any) => h._source) ?? [];

        return jsonResult({
          asset: args.assetKey,
          totalFindings: result.total,
          bySeverity: extractBuckets(result.aggregations?.by_severity),
          byScanner: extractBuckets(result.aggregations?.by_scanner),
          topRules: extractBuckets(result.aggregations?.top_rules),
          sampleFindings,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_findings_trend',
    {
      description:
        'Get a time-series trend of findings over a date range, bucketed by day or week. ' +
        'Useful for understanding whether security posture is improving or degrading over time.',
      inputSchema: {
        interval: z
          .enum(['day', 'week'])
          .optional()
          .default('day')
          .describe('Time bucket interval (default "day").'),
        severity: z
          .enum(['critical', 'high', 'medium', 'low', 'info'])
          .optional()
          .describe('Filter trend to a specific severity.'),
        scanner: z.string().optional().describe('Filter trend to a specific scanner.'),
        fromDate: z
          .string()
          .optional()
          .describe('Start of range (ISO 8601). Defaults to 30 days ago.'),
        toDate: z.string().optional().describe('End of range (ISO 8601). Defaults to now.'),
      },
    },
    async (args: {
      interval?: string;
      severity?: string;
      scanner?: string;
      fromDate?: string;
      toDate?: string;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityAnalyticsService) {
        return errorResult(new Error('Analytics service is not available'));
      }

      try {
        const filters: any[] = [];
        if (args.severity) {
          filters.push({ term: { severity: args.severity } });
        }
        if (args.scanner) {
          filters.push({ term: { scanner: args.scanner } });
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const range = {
          gte: args.fromDate ?? thirtyDaysAgo.toISOString(),
          lte: args.toDate ?? now.toISOString(),
        };
        filters.push({ range: { '@timestamp': range } });

        const calendarInterval = args.interval === 'week' ? '1w' : '1d';

        const result = await securityAnalyticsService.query(auth.organizationId!, {
          query: { bool: { filter: filters } },
          size: 0,
          useLatest: false, // trends need the event log
          aggs: {
            over_time: {
              date_histogram: {
                field: '@timestamp',
                calendar_interval: calendarInterval,
                min_doc_count: 0,
                extended_bounds: {
                  min: range.gte,
                  max: range.lte,
                },
              },
              aggs: {
                by_severity: {
                  terms: { field: 'severity', size: 10 },
                },
              },
            },
          },
        });

        const buckets = (result.aggregations?.over_time?.buckets ?? []).map((b: any) => ({
          date: b.key_as_string,
          count: b.doc_count,
          bySeverity: (b.by_severity?.buckets ?? []).reduce(
            (acc: any, s: any) => {
              acc[s.key] = s.doc_count;
              return acc;
            },
            {} as Record<string, number>,
          ),
        }));

        return jsonResult({
          interval: args.interval ?? 'day',
          dataPoints: buckets,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
