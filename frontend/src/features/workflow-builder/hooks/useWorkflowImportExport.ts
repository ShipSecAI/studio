import { useCallback } from 'react';
import {
  deserializeNodes,
  deserializeEdges,
  serializeNodes,
  serializeEdges,
} from '@/utils/workflowSerializer';
import { WorkflowImportSchema, DEFAULT_WORKFLOW_VIEWPORT } from '@/schemas/workflow';
import {
  cloneNodes,
  cloneEdges,
} from '@/features/workflow-builder/hooks/useWorkflowGraphControllers';
import type { FrontendNodeData } from '@/schemas/node';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';
import { useSecretStore } from '@/store/secretStore';
import { useComponentStore } from '@/store/componentStore';
interface WorkflowMetadataShape {
  id: string | null;
  name: string;
  description: string;
  currentVersionId: string | null;
  currentVersion: number | null;
}

interface UseWorkflowImportExportOptions {
  canManageWorkflows: boolean;
  toast: (params: {
    title: string;
    description?: string;
    variant?: 'default' | 'destructive' | 'warning' | 'success';
  }) => void;
  metadata: WorkflowMetadataShape;
  nodes: ReactFlowNode<FrontendNodeData>[];
  edges: ReactFlowEdge[];
  setDesignNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void;
  setDesignEdges: (edges: ReactFlowEdge[]) => void;
  setExecutionNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void;
  setExecutionEdges: (edges: ReactFlowEdge[]) => void;
  setMetadata: (metadata: Partial<WorkflowMetadataShape>) => void;
  markDirty: () => void;
  resetWorkflow: () => void;
  setMode: (mode: 'design' | 'execution') => void;
}

interface UseWorkflowImportExportResult {
  handleImportWorkflow: (file: File) => Promise<void>;
  handleExportWorkflow: () => void;
}

export function useWorkflowImportExport({
  canManageWorkflows,
  toast,
  metadata,
  nodes,
  edges,
  setDesignNodes,
  setDesignEdges,
  setExecutionNodes,
  setExecutionEdges,
  setMetadata,
  markDirty,
  resetWorkflow,
  setMode,
}: UseWorkflowImportExportOptions): UseWorkflowImportExportResult {
  const handleImportWorkflow = useCallback(
    async (file: File) => {
      if (!canManageWorkflows) {
        toast({
          variant: 'destructive',
          title: 'Insufficient permissions',
          description: 'Only administrators can import workflows.',
        });
        return;
      }

      const contents = await file.text();
      const parsed = WorkflowImportSchema.parse(JSON.parse(contents));

      const graph =
        'graph' in parsed
          ? {
              nodes: parsed.graph.nodes ?? [],
              edges: parsed.graph.edges ?? [],
              viewport: parsed.graph.viewport ?? DEFAULT_WORKFLOW_VIEWPORT,
            }
          : {
              nodes: parsed.nodes ?? [],
              edges: parsed.edges ?? [],
              viewport: parsed.viewport ?? DEFAULT_WORKFLOW_VIEWPORT,
            };

      const workflowGraph = {
        graph: {
          nodes: graph.nodes,
          edges: graph.edges,
          viewport: graph.viewport,
        },
      };

      const normalizedNodes = deserializeNodes(workflowGraph);
      const normalizedEdges = deserializeEdges(workflowGraph);

      // Validate secret references
      const removedSecrets: { param: string; node: string; secretId: string }[] = [];
      try {
        await useSecretStore.getState().fetchSecrets();
        const secrets = useSecretStore.getState().secrets;
        const secretIds = new Set(secrets.map((s) => s.id));

        const componentStore = useComponentStore.getState();
        if (Object.keys(componentStore.components).length === 0) {
          await componentStore.fetchComponents();
        }
        const components = useComponentStore.getState().components;

        normalizedNodes.forEach((node) => {
          const data = node.data as FrontendNodeData;
          const componentRef = data.componentId || data.componentSlug;
          if (!componentRef) return;

          const component =
            componentStore.getComponent(componentRef) ||
            Object.values(components).find((c) => c.slug === componentRef);

          if (!component || !component.parameters) return;

          // Find parameters that are secrets
          const secretParams = component.parameters.filter((p) => p.type === 'secret');
          const configParams = node.data.config.params || {};

          secretParams.forEach((param) => {
            const val = configParams[param.id];
            // If value is a string (ID) and not in available secrets, remove it
            if (typeof val === 'string' && val.trim().length > 0) {
              if (!secretIds.has(val)) {
                console.warn(
                  `[Import] Removing invalid secret reference for param "${param.id}" in node "${node.id}" (secret ID: ${val})`,
                );
                removedSecrets.push({ param: param.id, node: node.id, secretId: val });
                // Set to undefined to clear it
                configParams[param.id] = undefined;
              }
            }
          });
        });
      } catch (error) {
        console.error('Failed to validate secrets during import:', error);
        // Continue with import even if validation fails
      }

      resetWorkflow();
      setDesignNodes(normalizedNodes);
      setDesignEdges(normalizedEdges);
      setExecutionNodes(cloneNodes(normalizedNodes));
      setExecutionEdges(cloneEdges(normalizedEdges));
      setMetadata({
        id: null,
        name: parsed.name,
        description: parsed.description ?? '',
        currentVersion: null,
        currentVersionId: null,
      });
      markDirty();
      setMode('design');

      toast({
        variant: 'success',
        title: 'Workflow imported',
        description: `Loaded ${parsed.name}`,
      });

      // Show warning if any invalid secret references were removed
      if (removedSecrets.length > 0) {
        toast({
          variant: 'warning',
          title: 'Invalid secret references removed',
          description: `${removedSecrets.length} secret reference(s) could not be resolved and were cleared. Please select valid secrets from the Secrets Manager.`,
        });
      }
    },
    [
      canManageWorkflows,
      markDirty,
      resetWorkflow,
      setDesignEdges,
      setDesignNodes,
      setExecutionEdges,
      setExecutionNodes,
      setMetadata,
      setMode,
      toast,
    ],
  );

  const handleExportWorkflow = useCallback(() => {
    if (!canManageWorkflows) {
      toast({
        variant: 'destructive',
        title: 'Insufficient permissions',
        description: 'Only administrators can export workflows.',
      });
      return;
    }

    if (nodes.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot export workflow',
        description: 'Add at least one component before exporting.',
      });
      return;
    }

    try {
      if (typeof window === 'undefined') {
        throw new Error('Export is only available in a browser environment.');
      }

      const exportedNodes = serializeNodes(nodes);
      const exportedEdges = serializeEdges(edges);

      const payload = {
        name: metadata.name || 'Untitled Workflow',
        description: metadata.description || '',
        graph: {
          nodes: exportedNodes,
          edges: exportedEdges,
          viewport: DEFAULT_WORKFLOW_VIEWPORT,
        },
        metadata: {
          workflowId: metadata.id ?? null,
          currentVersionId: metadata.currentVersionId ?? null,
          currentVersion: metadata.currentVersion ?? null,
          exportedAt: new Date().toISOString(),
        },
      };

      const fileContents = JSON.stringify(payload, null, 2);
      const blob = new Blob([fileContents], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeName =
        (metadata.name || 'workflow')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'workflow';

      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        variant: 'success',
        title: 'Workflow exported',
        description: `${safeName}.json saved to your device.`,
      });
    } catch (error) {
      console.error('Failed to export workflow:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to export workflow',
        description: error instanceof Error ? error.message : 'Unknown error occurred.',
      });
    }
  }, [canManageWorkflows, edges, metadata, nodes, toast]);

  return {
    handleImportWorkflow,
    handleExportWorkflow,
  };
}
