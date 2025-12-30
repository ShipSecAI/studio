import { randomUUID } from 'node:crypto';
import { Client } from 'minio';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';

import type { ArtifactServiceFactory, ArtifactScope } from '../temporal/artifact-factory';
import type {
  ArtifactDestination,
  ArtifactDownloadResult,
  ArtifactUploadRequest,
  ArtifactUploadResult,
  IArtifactService,
} from '@shipsec/component-sdk';
import { NotFoundError } from '@shipsec/component-sdk';
import * as schema from './schema';

export class ArtifactAdapter {
  constructor(
    private readonly minioClient: Client,
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly bucketName: string,
  ) {}

  factory(): ArtifactServiceFactory {
    return (scope) => this.createScopedService(scope);
  }

  private createScopedService(scope: ArtifactScope): IArtifactService {
    return {
      upload: (input: ArtifactUploadRequest) => this.uploadArtifact(scope, input),
      download: (artifactId: string) => this.downloadArtifact(scope, artifactId),
    };
  }

  private async uploadArtifact(
    scope: ArtifactScope,
    input: ArtifactUploadRequest,
  ): Promise<ArtifactUploadResult> {
    const fileId = randomUUID();
    const artifactId = randomUUID();
    const destinations: ArtifactDestination[] =
      input.destinations && input.destinations.length > 0
        ? input.destinations
        : (['run'] as ArtifactDestination[]);

    await this.minioClient.putObject(
      this.bucketName,
      fileId,
      input.content,
      input.content.length,
      { 'Content-Type': input.mimeType },
    );

    await this.db.insert(schema.files).values({
      id: fileId,
      fileName: input.name,
      mimeType: input.mimeType,
      size: input.content.length,
      storageKey: fileId,
      organizationId: scope.organizationId ?? null,
    });

    await this.db.insert(schema.artifacts).values({
      id: artifactId,
      runId: scope.runId,
      workflowId: scope.workflowId,
      workflowVersionId: scope.workflowVersionId ?? null,
      componentId: scope.componentId,
      componentRef: scope.componentRef,
      fileId,
      name: input.name,
      mimeType: input.mimeType,
      size: input.content.length,
      destinations,
      metadata: input.metadata ?? null,
      organizationId: scope.organizationId ?? null,
    });

    return {
      artifactId,
      fileId,
      name: input.name,
      destinations,
    };
  }

  private async downloadArtifact(
    scope: ArtifactScope,
    artifactId: string,
  ): Promise<ArtifactDownloadResult> {
    const artifact = await this.findArtifact(artifactId, scope.organizationId);
    if (!artifact) {
      throw new NotFoundError(`Artifact not found: ${artifactId}`, {
        resourceType: 'artifact',
        resourceId: artifactId,
        details: { organizationId: scope.organizationId },
      });
    }

    const fileRecord = await this.findFile(artifact.fileId, scope.organizationId);
    if (!fileRecord) {
      throw new NotFoundError(`File metadata missing for artifact ${artifactId}`, {
        resourceType: 'file',
        resourceId: artifact.fileId,
        details: { artifactId, organizationId: scope.organizationId },
      });
    }

    const stream = await this.minioClient.getObject(this.bucketName, fileRecord.storageKey);
    const buffer = await this.streamToBuffer(stream);

    return {
      buffer,
      metadata: {
        artifactId: artifact.id,
        fileId: artifact.fileId,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
        createdAt: artifact.createdAt ?? new Date(),
        destinations: artifact.destinations ?? ['run'],
        componentRef: artifact.componentRef,
      },
    };
  }

  private async findArtifact(id: string, organizationId?: string | null) {
    const conditions = [eq(schema.artifacts.id, id)];
    if (organizationId) {
      conditions.push(eq(schema.artifacts.organizationId, organizationId));
    }
    const where = conditions.length > 1 ? and(...conditions) : conditions[0];
    const [artifact] = await this.db.select().from(schema.artifacts).where(where).limit(1);
    return artifact;
  }

  private async findFile(id: string, organizationId?: string | null) {
    const filters = [eq(schema.files.id, id)];
    if (organizationId) {
      filters.push(eq(schema.files.organizationId, organizationId));
    }
    const where = filters.length > 1 ? and(...filters) : filters[0];
    const [file] = await this.db.select().from(schema.files).where(where).limit(1);
    return file;
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}
