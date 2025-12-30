import type { DestinationAdapterRegistration, DestinationSaveInput, DestinationSaveResult } from '../registry';
import type { ArtifactDestination } from '@shipsec/shared';
import { ConfigurationError } from '@shipsec/component-sdk';

interface ArtifactAdapterConfig {
  destinations?: ArtifactDestination[];
}

export const artifactDestinationAdapter: DestinationAdapterRegistration = {
  id: 'artifact',
  label: 'Run / Artifact Library',
  description: 'Save files to the current run timeline and/or the shared Artifact Library.',
  parameters: [
    {
      id: 'destinations',
      label: 'Destinations',
      type: 'select',
      description: 'run -> attach to current run; library -> publish to workspace library',
      options: [
        { label: 'Run timeline', value: 'run' },
        { label: 'Artifact Library', value: 'library' },
      ],
    },
  ],
  create(config) {
    const destinations = Array.isArray(config?.destinations)
      ? (config.destinations as ArtifactDestination[])
      : (['run'] as ArtifactDestination[]);

    return {
      async save(input: DestinationSaveInput, context): Promise<DestinationSaveResult> {
        if (!context.artifacts) {
          throw new ConfigurationError(
            'Artifact service is not available in this execution context. Enable artifact storage to use this destination.',
            { configKey: 'artifacts' },
          );
        }

        const normalized = destinations.length > 0 ? destinations : (['run'] as ArtifactDestination[]);

        const upload = await context.artifacts.upload({
          name: input.fileName,
          mimeType: input.mimeType,
          content: input.buffer,
          destinations: normalized,
          metadata: input.metadata,
        });

        return {
          artifactId: upload.artifactId,
          destinations: normalized,
        };
      },
    };
  },
};
