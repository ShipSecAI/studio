import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerAssetTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { assetDiscoveryService, asmService } = deps;

  // ── Cloud Asset Discovery ─────────────────────────────────────────────────

  if (assetDiscoveryService) {
    server.registerTool(
      'list_cloud_assets',
      {
        description:
          'List discovered cloud assets (EC2, S3, IAM, Lambda, RDS, etc). ' +
          'Filter by provider, asset type, region, or status. Returns name, ARN, type, region, metadata.',
        inputSchema: {
          provider: z.string().optional().describe('Cloud provider (e.g. aws)'),
          assetType: z
            .string()
            .optional()
            .describe('Asset type (e.g. ec2_instance, s3_bucket, iam_role)'),
          region: z.string().optional().describe('AWS region (e.g. us-east-1)'),
          status: z
            .enum(['active', 'stale', 'removed'])
            .optional()
            .describe('Asset status (default: active)'),
          search: z.string().optional().describe('Search by name'),
          limit: z.number().optional().describe('Max results (default 50)'),
          offset: z.number().optional().describe('Pagination offset'),
        },
      },
      async (params) => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const assets = await assetDiscoveryService.listAssets(auth, {
            provider: params.provider,
            assetType: params.assetType,
            region: params.region,
            status: params.status ?? 'active',
            search: params.search,
            limit: params.limit ?? 50,
            offset: params.offset ?? 0,
          });
          return jsonResult(assets);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'get_cloud_asset',
      {
        description:
          'Get detailed information about a specific cloud asset by ID. ' +
          'Returns full metadata including configuration, tags, and discovery timestamps.',
        inputSchema: {
          assetId: z.string().describe('The asset UUID'),
        },
      },
      async (params) => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const asset = await assetDiscoveryService.getAsset(auth, params.assetId);
          return jsonResult(asset);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'get_cloud_asset_summary',
      {
        description:
          'Get a summary of all discovered cloud assets — counts by type, status, and region.',
      },
      async () => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const summary = await assetDiscoveryService.getSummary(auth);
          return jsonResult(summary);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'list_asset_sync_runs',
      {
        description:
          'List recent asset discovery sync runs. Shows status, stats (discovered/created/updated/stale), and covered regions.',
        inputSchema: {
          integrationId: z.string().optional().describe('Filter by integration/connection ID'),
          limit: z.number().optional().describe('Max results (default 10)'),
        },
      },
      async (params) => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const runs = await assetDiscoveryService.listSyncRuns(auth, {
            integrationId: params.integrationId,
            limit: params.limit ?? 10,
          });
          return jsonResult(runs);
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  // ── Attack Surface Management (ASM) ───────────────────────────────────────

  if (asmService) {
    server.registerTool(
      'list_asm_domains',
      {
        description:
          'List domains in the attack surface scope. Returns domain name, monitoring status, ' +
          'asset count, tech stack, and last scan time.',
        inputSchema: {
          limit: z.number().optional().describe('Max results (default 50)'),
          offset: z.number().optional().describe('Pagination offset'),
        },
      },
      async (params) => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const domains = await asmService.listDomains(auth, {
            limit: params.limit ?? 50,
            offset: params.offset ?? 0,
          });
          return jsonResult(domains);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'list_asm_assets',
      {
        description:
          'List discovered attack surface assets — hostnames, IPs, ports, TLS info, tech stack, risk scores. ' +
          'Filter by domain, type, or search by hostname.',
        inputSchema: {
          domainId: z.string().optional().describe('Filter by domain ID'),
          type: z.string().optional().describe('Asset type filter'),
          search: z.string().optional().describe('Search by hostname'),
          limit: z.number().optional().describe('Max results (default 25)'),
          offset: z.number().optional().describe('Pagination offset'),
        },
      },
      async (params) => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const result = await asmService.listAssets(auth, {
            domainId: params.domainId,
            type: params.type,
            search: params.search,
            limit: params.limit ?? 25,
            offset: params.offset ?? 0,
          });
          return jsonResult(result);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'get_asm_asset',
      {
        description:
          'Get detailed attack surface asset info — hostname, IPs, ports, DNS records, TLS info, tech stack, risk score.',
        inputSchema: {
          assetId: z.string().describe('The ASM asset UUID'),
        },
      },
      async (params) => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const asset = await asmService.getAsset(auth, params.assetId);
          return jsonResult(asset);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'get_attack_surface_stats',
      {
        description: 'Get attack surface dashboard stats — total domains and assets count.',
      },
      async () => {
        const gate = checkPermission(auth, 'assets.list');
        if (!gate.allowed) return gate.error;
        try {
          const stats = await asmService.getDashboardStats(auth);
          return jsonResult(stats);
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
}
