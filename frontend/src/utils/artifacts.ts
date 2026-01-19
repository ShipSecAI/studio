import { z } from 'zod';
import type { ArtifactMetadata, ArtifactRemoteUpload } from '@shipsec/shared';
import { ArtifactRemoteUploadSchema } from '@shipsec/shared';

const RemoteUploadListSchema = z.array(ArtifactRemoteUploadSchema);

export function getRemoteUploads(artifact: ArtifactMetadata): ArtifactRemoteUpload[] {
  const raw = artifact.metadata?.remoteUploads;
  if (!raw) {
    return [];
  }
  const parsed = RemoteUploadListSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
