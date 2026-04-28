import { z } from 'zod';
import {
  ValidationError,
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import {
  cloudProwlerIngestionInputSchema,
  normalizeProwlerCloudIngestion,
  scannerRunSchema,
  shipsecIngestionBatchSchema,
} from '@shipsec/contracts';

const inputSchema = inputs({
  rawFindings: port(z.array(z.unknown()).optional().default([]), {
    label: 'Prowler Findings',
    description:
      'Prowler ASFF/OCSF records, or normalized Prowler records that still carry rawFinding.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string().optional(), {
    label: 'Raw Prowler Output',
    description: 'Raw JSON or JSONL output from Prowler.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  scanId: port(z.string().optional(), {
    label: 'Scan ID',
    description: 'Scanner run id from the Prowler component.',
  }),
  accountId: port(z.string().optional(), {
    label: 'Account ID',
    description: 'Cloud account id when it is known upstream.',
  }),
  provider: port(z.enum(['aws', 'gcp', 'kubernetes', 'cloud']).optional().default('aws'), {
    label: 'Provider',
    description: 'Cloud provider or Prowler mode for this run.',
  }),
  rawArtifactUri: port(z.string().optional(), {
    label: 'Raw Artifact URI',
    description: 'Durable pointer to the raw Prowler artifact.',
  }),
});

const parameterSchema = parameters({
  sourceVersion: param(z.string().optional().default('prowler'), {
    label: 'Source Version',
    editor: 'text',
    description: 'Prowler version or scanner image tag used for this run.',
  }),
  triggerKind: param(
    z.enum(['manual', 'scheduled', 'webhook', 'workflow', 'retest']).default('workflow'),
    {
      label: 'Trigger Kind',
      editor: 'select',
      options: [
        { label: 'Manual', value: 'manual' },
        { label: 'Scheduled', value: 'scheduled' },
        { label: 'Webhook', value: 'webhook' },
        { label: 'Workflow', value: 'workflow' },
        { label: 'Retest', value: 'retest' },
      ],
      description: 'Why this scanner run exists.',
    },
  ),
});

const outputSchema = outputs({
  ingestionBatch: port(shipsecIngestionBatchSchema(), {
    label: 'ShipSec Ingestion Batch',
    description:
      'North-star cloud ingestion batch for correlation, evidence, graph, and compliance.',
  }),
  scannerRun: port(scannerRunSchema(), {
    label: 'Scanner Run',
    description: 'Run lineage record used by findings and evidence.',
  }),
  observationCount: port(z.number().int().min(0), {
    label: 'Observations',
    description: 'Total normalized observations emitted.',
  }),
  findingCount: port(z.number().int().min(0), {
    label: 'Findings',
    description: 'Total security finding instances emitted.',
  }),
  assetCount: port(z.number().int().min(0), {
    label: 'Assets',
    description: 'Total asset identity candidates emitted.',
  }),
  warnings: port(z.array(z.string()), {
    label: 'Warnings',
    description: 'Non-fatal normalization warnings.',
  }),
});

const definition = defineComponent({
  id: 'shipsec.cloud-findings.normalize',
  label: 'Cloud Findings Normalize',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Normalize Prowler cloud findings into the ShipSec north-star ingestion batch contract.',
  ui: {
    slug: 'shipsec-cloud-findings-normalize',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description:
      'Preserve Prowler evidence, cloud identity, compliance metadata, observations, and finding instances.',
    icon: 'CloudCog',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  toolProvider: {
    kind: 'component',
    name: 'cloud_findings_normalize',
    description: 'Normalize Prowler cloud scanner output into ShipSec product truth.',
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const organizationId = context.organizationId ?? context.metadata.organizationId;
    if (!organizationId) {
      throw new ValidationError('Cloud ingestion normalization requires organizationId context.');
    }

    const observedAt = new Date().toISOString();
    const rawFindings = [...(parsedInputs.rawFindings ?? [])];
    if (parsedInputs.rawOutput && parsedInputs.rawOutput.trim().length > 0) {
      rawFindings.push(parsedInputs.rawOutput);
    }

    const scannerRun = scannerRunSchema().parse({
      id: parsedInputs.scanId ?? `scanner-run:${context.runId}:${context.componentRef}:prowler`,
      organizationId,
      sourceKind: 'prowler',
      sourceVersion: parsedParams.sourceVersion,
      scope: {
        organizationId,
        provider: parsedInputs.provider,
        accountId: parsedInputs.accountId,
        labels: {
          workflowId: context.workflowId ?? '',
          workflowName: context.workflowName ?? '',
          triggerSource: context.triggerSource ?? '',
          triggerType: context.triggerType ?? '',
        },
      },
      triggerKind: parsedParams.triggerKind,
      status: 'completed',
      startedAt: observedAt,
      completedAt: observedAt,
      artifactRefs: parsedInputs.rawArtifactUri
        ? [{ uri: parsedInputs.rawArtifactUri, kind: 'raw_scanner_output' }]
        : [],
      workflowId: context.workflowId,
      runId: context.runId,
      nodeRef: context.componentRef,
    });

    const ingestionInput = cloudProwlerIngestionInputSchema().parse({
      scannerRun,
      rawFindings,
      rawArtifactUri: parsedInputs.rawArtifactUri,
      observedAt,
    });
    const ingestionBatch = normalizeProwlerCloudIngestion(ingestionInput);

    context.logger.info(
      `[CloudFindingsNormalize] observations=${ingestionBatch.stats.observationCount} findings=${ingestionBatch.stats.findingInstanceCount} assets=${ingestionBatch.stats.assetCount} warnings=${ingestionBatch.validation.warnings.length}`,
    );

    return outputSchema.parse({
      ingestionBatch,
      scannerRun: ingestionBatch.scannerRun,
      observationCount: ingestionBatch.stats.observationCount,
      findingCount: ingestionBatch.stats.findingInstanceCount,
      assetCount: ingestionBatch.stats.assetCount,
      warnings: ingestionBatch.validation.warnings,
    });
  },
});

componentRegistry.register(definition);
