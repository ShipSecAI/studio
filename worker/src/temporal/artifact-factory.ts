import type { IArtifactService } from '@shipsec/component-sdk';

export interface ArtifactScope {
  runId: string;
  workflowId: string;
  workflowVersionId?: string | null;
  componentId: string;
  componentRef: string;
  organizationId?: string | null;
}

export type ArtifactServiceFactory = (scope: ArtifactScope) => IArtifactService;
