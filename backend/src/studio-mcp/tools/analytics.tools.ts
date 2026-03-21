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
          .describe('Filter by rule/check ID prefix (e.g. "php.", "java.lang.security").'),
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
            'If true (default), query the deduplicated latest-state table. If false, query the full event log.',
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
        const filters: { field: string; op: string; value: any }[] = [];

        if (args.severity) {
          filters.push({ field: 'severity', op: 'eq', value: args.severity });
        }
        if (args.scanner) {
          filters.push({ field: 'scanner', op: 'eq', value: args.scanner });
        }
        if (args.assetKey) {
          filters.push({ field: 'asset_key', op: 'eq', value: args.assetKey });
        }
        if (args.ruleId) {
          filters.push({ field: 'rule_id', op: 'prefix', value: args.ruleId });
        }
        if (args.workflowId) {
          filters.push({ field: 'workflow_id', op: 'eq', value: args.workflowId });
        }
        if (args.runId) {
          filters.push({ field: 'run_id', op: 'eq', value: args.runId });
        }
        if (args.fromDate) {
          filters.push({ field: 'timestamp', op: 'gte', value: args.fromDate });
        }
        if (args.toDate) {
          filters.push({ field: 'timestamp', op: 'lte', value: args.toDate });
        }

        const result = await securityAnalyticsService.query(auth.organizationId!, {
          filters,
          search: args.searchText,
          size: args.limit ?? 20,
          from: args.offset ?? 0,
          sort: [{ field: 'timestamp', direction: 'desc' }],
          useLatest: args.useLatest ?? true,
        });

        return jsonResult({
          total: result.total,
          count: result.results.length,
          findings: result.results,
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
          .describe('If true (default), summarize from deduplicated latest-state table.'),
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
        const filters: { field: string; op: string; value: any }[] = [];
        if (args.workflowId) {
          filters.push({ field: 'workflow_id', op: 'eq', value: args.workflowId });
        }
        if (args.runId) {
          filters.push({ field: 'run_id', op: 'eq', value: args.runId });
        }
        if (args.scanner) {
          filters.push({ field: 'scanner', op: 'eq', value: args.scanner });
        }
        if (args.fromDate) {
          filters.push({ field: 'timestamp', op: 'gte', value: args.fromDate });
        }
        if (args.toDate) {
          filters.push({ field: 'timestamp', op: 'lte', value: args.toDate });
        }

        const aggs = [
          { name: 'by_severity', field: 'severity' },
          { name: 'by_scanner', field: 'scanner' },
          { name: 'by_rule_id', field: 'rule_id', size: 20 },
          { name: 'by_asset_key', field: 'asset_key', size: 20 },
        ];

        const result = await securityAnalyticsService.query(auth.organizationId!, {
          filters,
          size: 0,
          useLatest: args.useLatest ?? true,
          aggs,
        });

        return jsonResult({
          totalFindings: result.total,
          bySeverity: result.aggregations?.by_severity ?? [],
          byScanner: result.aggregations?.by_scanner ?? [],
          topRules: result.aggregations?.by_rule_id ?? [],
          topAssets: result.aggregations?.by_asset_key ?? [],
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
          filters: [{ field: 'finding_hash', op: 'eq', value: args.findingHash }],
          size: 1,
          useLatest: true,
        });

        if (result.results.length === 0) {
          return jsonResult({ found: false, message: 'No finding found with that hash.' });
        }

        return jsonResult({
          found: true,
          finding: result.results[0],
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
          .describe('If true (default), use deduplicated latest-state table.'),
      },
    },
    async (args: { assetKey: string; useLatest?: boolean }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityAnalyticsService) {
        return errorResult(new Error('Analytics service is not available'));
      }

      try {
        const filters: { field: string; op: string; value: any }[] = [
          { field: 'asset_key', op: 'eq', value: args.assetKey },
        ];

        const aggs = [
          { name: 'by_severity', field: 'severity' },
          { name: 'by_scanner', field: 'scanner' },
          { name: 'by_rule_id', field: 'rule_id', size: 20 },
        ];

        const [aggResult, sampleResult] = await Promise.all([
          securityAnalyticsService.query(auth.organizationId!, {
            filters,
            size: 0,
            useLatest: args.useLatest ?? true,
            aggs,
          }),
          securityAnalyticsService.query(auth.organizationId!, {
            filters,
            size: 10,
            useLatest: args.useLatest ?? true,
            sort: [{ field: 'severity', direction: 'asc' }],
          }),
        ]);

        return jsonResult({
          asset: args.assetKey,
          totalFindings: aggResult.total,
          bySeverity: aggResult.aggregations?.by_severity ?? [],
          byScanner: aggResult.aggregations?.by_scanner ?? [],
          topRules: aggResult.aggregations?.by_rule_id ?? [],
          sampleFindings: sampleResult.results,
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
        const filters: { field: string; op: string; value: any }[] = [];
        if (args.severity) {
          filters.push({ field: 'severity', op: 'eq', value: args.severity });
        }
        if (args.scanner) {
          filters.push({ field: 'scanner', op: 'eq', value: args.scanner });
        }

        // Calculate days from date range or default to 30
        let days = 30;
        const now = new Date();

        if (args.fromDate) {
          const fromMs = new Date(args.fromDate).getTime();
          const toMs = args.toDate ? new Date(args.toDate).getTime() : now.getTime();
          days = Math.max(1, Math.ceil((toMs - fromMs) / 86_400_000));
          filters.push({ field: 'timestamp', op: 'gte', value: args.fromDate });
        } else {
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          filters.push({ field: 'timestamp', op: 'gte', value: thirtyDaysAgo.toISOString() });
        }
        if (args.toDate) {
          filters.push({ field: 'timestamp', op: 'lte', value: args.toDate });
        }

        const interval = (args.interval === 'week' ? 'week' : 'day') as 'day' | 'week';

        const result = await securityAnalyticsService.timeSeries(auth.organizationId!, {
          filters,
          interval,
          days,
        });

        // Pivot buckets into date → { count, bySeverity }
        const dateMap: Record<string, { count: number; bySeverity: Record<string, number> }> = {};
        for (const b of result.buckets) {
          if (!dateMap[b.date]) {
            dateMap[b.date] = { count: 0, bySeverity: {} };
          }
          dateMap[b.date].count += b.count;
          dateMap[b.date].bySeverity[b.severity] = b.count;
        }

        const dataPoints = Object.entries(dateMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({
            date,
            count: data.count,
            bySeverity: data.bySeverity,
          }));

        return jsonResult({
          interval: args.interval ?? 'day',
          dataPoints,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
