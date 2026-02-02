import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { destinationWriterSchema } from '@shipsec/contracts';
import { type DestinationConfig } from '@shipsec/shared';

const inputSchema = inputs({});

const parameterSchema = parameters({
  saveToRunArtifacts: param(z.boolean().default(true), {
    label: 'Save to run timeline',
    editor: 'boolean',
  }),
  publishToArtifactLibrary: param(z.boolean().default(false), {
    label: 'Publish to Artifact Library',
    editor: 'boolean',
  }),
  label: param(z.string().max(120).optional(), {
    label: 'Label override',
    editor: 'text',
  }),
  description: param(z.string().max(240).optional(), {
    label: 'Description',
    editor: 'textarea',
  }),
});

const outputSchema = outputs({
  destination: port(destinationWriterSchema(), {
    label: 'Destination',
    description: 'Connect this to writer components to store outputs in the artifact store.',
  }),
});

const definition = defineComponent({
  id: 'core.destination.artifact',
  label: 'Artifact Destination',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Produces a destination configuration that saves files to the run timeline and/or the shared Artifact Library.',
  ui: {
    slug: 'destination-artifact',
    version: '1.0.0',
    type: 'process',
    category: 'output',
    description: 'Configure the built-in artifact destination for writers.',
    icon: 'HardDriveDownload',
  },
  async execute({ params }, context) {
    const destinations: ('run' | 'library')[] = [];
    if (params.saveToRunArtifacts) {
      destinations.push('run');
    }
    if (params.publishToArtifactLibrary) {
      destinations.push('library');
    }
    if (destinations.length === 0) {
      destinations.push('run');
    }

    context.logger.info(
      `[ArtifactDestination] Configured destinations: ${destinations.join(', ')}`,
    );

    const destination: DestinationConfig = {
      adapterId: 'artifact',
      config: { destinations },
      metadata: {
        label: params.label,
        description: params.description,
      },
    };

    return { destination };
  },
});

componentRegistry.register(definition);
