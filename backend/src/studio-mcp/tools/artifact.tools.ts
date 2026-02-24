import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { type StudioMcpDeps, checkPermission, jsonResult, errorResult } from './types';

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/yaml'];

function isTextMime(mimeType: string | undefined | null): boolean {
  if (!mimeType) return false;
  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function isLikelyText(buffer: Buffer): boolean {
  // Sample the first 512 bytes for null bytes — a quick binary heuristic
  const sample = buffer.slice(0, 512);
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

export function registerArtifactTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  server.registerTool(
    'list_artifacts',
    {
      description: 'List workspace artifacts with optional filtering by workflow or search term.',
      inputSchema: {
        workflowId: z.string().uuid().optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args: { workflowId?: string; search?: string; limit?: number }) => {
      const gate = checkPermission(auth, 'artifacts.read');
      if (!gate.allowed) return gate.error;

      if (!deps.artifactsService) {
        return errorResult(new Error('Artifacts service is not available.'));
      }

      try {
        const result = await deps.artifactsService.listArtifacts(auth, {
          workflowId: args.workflowId,
          search: args.search,
          limit: args.limit ?? 20,
        });

        // Normalise to a consistent shape regardless of what the service returns
        const artifacts = Array.isArray(result)
          ? result
          : (result?.artifacts ?? result?.items ?? []);
        const summary = artifacts.map((a: any) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          mimeType: a.mimeType ?? a.contentType,
          runId: a.runId,
          createdAt: a.createdAt,
        }));

        return jsonResult(summary);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_run_artifacts',
    {
      description: 'List all artifacts produced by a specific workflow run.',
      inputSchema: {
        runId: z.string(),
      },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'artifacts.read');
      if (!gate.allowed) return gate.error;

      if (!deps.artifactsService) {
        return errorResult(new Error('Artifacts service is not available.'));
      }

      try {
        const result = await deps.artifactsService.listRunArtifacts(auth, args.runId);
        const artifacts = Array.isArray(result) ? result : (result?.artifacts ?? []);
        const summary = artifacts.map((a: any) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          mimeType: a.mimeType ?? a.contentType,
          runId: a.runId,
          createdAt: a.createdAt,
        }));

        return jsonResult(summary);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'view_artifact',
    {
      description:
        'View artifact content with windowing support for large files. ' +
        'For binary files returns metadata only. ' +
        'Use offset/limit to page through large text files.',
      inputSchema: {
        artifactId: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(100000).optional(),
      },
    },
    async (args: { artifactId: string; offset?: number; limit?: number }) => {
      const gate = checkPermission(auth, 'artifacts.read');
      if (!gate.allowed) return gate.error;

      if (!deps.artifactsService) {
        return errorResult(new Error('Artifacts service is not available.'));
      }

      try {
        const { buffer, artifact } = await deps.artifactsService.downloadArtifact(
          auth,
          args.artifactId,
        );

        const totalSize = buffer.length;
        const offset = args.offset ?? 0;
        const limit = args.limit ?? 10000;
        const mimeType = artifact?.mimeType ?? artifact?.contentType;

        // Determine if the artifact is text-readable
        const textByMime = isTextMime(mimeType);
        const textByContent = !mimeType && isLikelyText(buffer);

        if (!textByMime && !textByContent) {
          return jsonResult({
            id: artifact?.id ?? args.artifactId,
            name: artifact?.name,
            mimeType,
            totalSize,
            isText: false,
            message: `Binary file, ${totalSize} bytes, mime: ${mimeType ?? 'unknown'}. Use the download endpoint for full content.`,
          });
        }

        const slice = buffer.slice(offset, offset + limit);
        let content: string;
        try {
          content = slice.toString('utf-8');
        } catch {
          return jsonResult({
            id: artifact?.id ?? args.artifactId,
            name: artifact?.name,
            mimeType,
            totalSize,
            isText: false,
            message: `Could not decode as UTF-8. Binary file, ${totalSize} bytes, mime: ${mimeType ?? 'unknown'}.`,
          });
        }

        return jsonResult({
          id: artifact?.id ?? args.artifactId,
          name: artifact?.name,
          mimeType,
          totalSize,
          offset,
          limit,
          hasMore: offset + limit < totalSize,
          isText: true,
          content,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
