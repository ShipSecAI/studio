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
  asmIngestionInputSchema,
  normalizeAsmIngestion,
  scannerRunSchema,
  shipsecIngestionBatchSchema,
} from '@shipsec/contracts';

const sourceArrayPort = (label: string, description: string) =>
  port(z.array(z.unknown()).optional().default([]), {
    label,
    description,
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  });

const inputSchema = inputs({
  dnsResults: sourceArrayPort('DNS Results', 'DNSx/Subfinder-style DNS discovery records.'),
  httpResults: sourceArrayPort('HTTP Results', 'HTTPx-style HTTP service records.'),
  portResults: sourceArrayPort('Port Results', 'Naabu-style open port records.'),
  nucleiResults: sourceArrayPort('Nuclei Results', 'Nuclei vulnerability or exposure records.'),
  domain: port(z.string().optional(), {
    label: 'Domain',
    description: 'Primary root domain for the ASM run when known.',
  }),
  scanId: port(z.string().optional(), {
    label: 'Scan ID',
    description: 'Scanner run id for this ASM normalization pass.',
  }),
  rawArtifactUri: port(z.string().optional(), {
    label: 'Raw Artifact URI',
    description: 'Durable pointer to the raw ASM artifact.',
  }),
});

const parameterSchema = parameters({
  sourceVersion: param(z.string().optional().default('asm-recon'), {
    label: 'Source Version',
    editor: 'text',
    description: 'ASM workflow/scanner version used for this run.',
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
      description: 'Why this ASM run exists.',
    },
  ),
});

const outputSchema = outputs({
  ingestionBatch: port(shipsecIngestionBatchSchema(), {
    label: 'ShipSec Ingestion Batch',
    description: 'North-star ASM ingestion batch for correlation, evidence, graph, and compliance.',
  }),
  scannerRun: port(scannerRunSchema(), {
    label: 'Scanner Run',
    description: 'Run lineage record used by ASM observations and evidence.',
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
    description: 'Total ASM asset identity candidates emitted.',
  }),
  warnings: port(z.array(z.string()), {
    label: 'Warnings',
    description: 'Non-fatal normalization warnings.',
  }),
});

const definition = defineComponent({
  id: 'shipsec.asm-findings.normalize',
  label: 'ASM Findings Normalize',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Normalize ASM DNS, HTTP, port, and nuclei outputs into the ShipSec north-star ingestion batch contract.',
  ui: {
    slug: 'shipsec-asm-findings-normalize',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description:
      'Preserve ASM evidence, host/service identity, observations, risky exposures, and nuclei findings.',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  toolProvider: {
    kind: 'component',
    name: 'asm_findings_normalize',
    description: 'Normalize attack-surface scanner output into ShipSec product truth.',
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const organizationId = context.organizationId ?? context.metadata.organizationId;
    if (!organizationId) {
      throw new ValidationError('ASM ingestion normalization requires organizationId context.');
    }

    const observedAt = new Date().toISOString();
    const scannerRun = scannerRunSchema().parse({
      id: parsedInputs.scanId ?? `scanner-run:${context.runId}:${context.componentRef}:asm`,
      organizationId,
      sourceKind: 'asm',
      sourceVersion: parsedParams.sourceVersion,
      scope: {
        organizationId,
        domain: parsedInputs.domain,
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

    const ingestionInput = asmIngestionInputSchema().parse({
      scannerRun,
      dnsResults: parsedInputs.dnsResults,
      httpResults: parsedInputs.httpResults,
      portResults: parsedInputs.portResults,
      nucleiResults: parsedInputs.nucleiResults,
      rawArtifactUri: parsedInputs.rawArtifactUri,
      observedAt,
    });
    const ingestionBatch = normalizeAsmIngestion(ingestionInput);

    context.logger.info(
      `[AsmFindingsNormalize] observations=${ingestionBatch.stats.observationCount} findings=${ingestionBatch.stats.findingInstanceCount} assets=${ingestionBatch.stats.assetCount} warnings=${ingestionBatch.validation.warnings.length}`,
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
