import {
  componentRegistry,
  ComponentDefinition,
  port,
  type ComponentRetryPolicy,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ValidationError,
} from '@shipsec/component-sdk';
import {
  browserAutomationInputSchema,
  browserAutomationOutputSchema,
  type BrowserAutomationInput as Input,
  type BrowserAutomationOutput as Output,
} from '@shipsec/shared';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Harness Code (Injected into Docker)
// ============================================================================

// Load the compiled harness from the browser-harness package
// This file is built from packages/browser-harness/src/main.ts
const harnessPath = path.resolve(__dirname, '../../../../packages/browser-harness/dist/main.js');
const harnessCode = fs.readFileSync(harnessPath, 'utf8');

// ============================================================================
// Component Definition
// ============================================================================

const browserAutomationRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: [
    'ValidationError',
    'ConfigurationError',
  ],
};


const definition: ComponentDefinition<Input, Output> = {
  id: 'browser.automation',
  label: 'Browser Automation',
  category: 'security',
  parameters: [
    {
      id: 'actions',
      label: 'Actions',
      type: 'browser-actions',
      default: [],
      description: 'Array of browser actions to execute in sequence (click, fill, wait, etc).',
    },
    {
      id: 'options.headless',
      label: 'Headless Mode',
      type: 'boolean',
      default: true,
      description: 'Run browser without visible UI.',
    },
    {
      id: 'options.timeout',
      label: 'Default Timeout',
      type: 'number',
      default: 30000,
      description: 'Default timeout for actions in milliseconds.',
    },
    {
      id: 'options.viewport',
      label: 'Viewport',
      type: 'json',
      default: { width: 1280, height: 720 },
      description: 'Browser window dimensions.',
    },
    {
      id: 'options.blockTracking',
      label: 'Block Tracking',
      type: 'boolean',
      default: true,
      description: 'Block common tracking and analytics scripts.',
    },
    {
      id: 'options.screenshotOnEnd',
      label: 'Screenshot on End',
      type: 'boolean',
      default: true,
      description: 'Take a screenshot after all actions complete.',
    },
  ],
  retryPolicy: browserAutomationRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'mcr.microsoft.com/playwright:v1.49.1-focal',
    entrypoint: 'sh',
    command: ['-c', 'node /harness.mjs'],
    network: 'bridge',
    timeoutSeconds: 300,
  },
  inputSchema: browserAutomationInputSchema as any,
  outputSchema: browserAutomationOutputSchema as any,
  docs: 'Automate browser interactions using Playwright. Supports navigation, clicking, form filling, screenshots, HTML extraction, and JavaScript evaluation. Ideal for web scraping, UI testing, and phishing link investigation.',
  metadata: {
    slug: 'browser-automation',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Automate browser interactions with headless Chrome including screenshots, console logs, and HTML extraction.',
    documentation: 'Uses Playwright to control Chromium. Supports selectors, waits, screenshots, and JavaScript evaluation.',
    documentationUrl: 'https://playwright.dev/docs/api/class-page',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'url',
        label: 'Starting URL',
        dataType: port.text(),
        required: true,
        description: 'The initial URL to navigate to.',
      },
    ],
    outputs: [
      {
        id: 'results',
        label: 'Action Results',
        dataType: port.json(),
        description: 'Detailed results for each action executed.',
      },
      {
        id: 'screenshots',
        label: 'Screenshots',
        dataType: port.json(),
        description: 'Array of screenshot artifacts with MinIO IDs.',
      },
      {
        id: 'consoleLogs',
        label: 'Console Logs',
        dataType: port.json(),
        description: 'Browser console output captured during execution.',
      },
      {
        id: 'finalUrl',
        label: 'Final URL',
        dataType: port.text(),
        description: 'The URL after all redirects and actions.',
      },
      {
        id: 'pageTitle',
        label: 'Page Title',
        dataType: port.text(),
        description: 'The final page title.',
      },
      {
        id: 'success',
        label: 'Success',
        dataType: port.boolean(),
        description: 'True if all actions completed successfully.',
      },
    ],
  },

  async execute(input, context) {
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      context.emitProgress('Preparing browser environment...');
      
      const harnessB64 = Buffer.from(harnessCode).toString('base64');
      const shellCommand = `echo "${harnessB64}" | base64 -d > /harness.mjs && node /harness.mjs`;

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: 'mcr.microsoft.com/playwright:v1.49.1-focal',
        entrypoint: 'sh',
        command: ['-c', shellCommand],
        network: 'bridge',
        env: {
          SHIPSEC_INPUT: JSON.stringify(input),
        },
        volumes: [
          volume.getVolumeConfig('/outputs', false),
        ],
      };

      const raw = await runComponentWithRunner<Input, any>(
        runnerConfig,
        async () => { throw new Error('Docker runner failed'); },
        input,
        context,
      );

      let result: any = {};
      if (typeof raw === 'string') {
        const match = raw.match(/---RESULT_START---([\s\S]*)---RESULT_END---/);
        if (match) {
          result = JSON.parse(match[1].trim());
        }
      }

      const finalScreenshots: any[] = [];
      if (result.screenshots && Array.isArray(result.screenshots) && context.artifacts) {
        context.emitProgress(`Uploading \${result.screenshots.length} screenshots...`);
        
        for (const s of result.screenshots) {
          try {
             const buffer = await volume.readFileFromVolumeAsBuffer(s.path);
             const uploadResult = await context.artifacts.upload({
               name: s.path,
               content: buffer,
               mimeType: 'image/png',
               destinations: ['run'],
               metadata: {
                 componentRef: context.componentRef,
                 timestamp: s.timestamp,
               }
             });

             finalScreenshots.push({
               ...s,
               artifactId: uploadResult.artifactId,
               fileId: uploadResult.fileId,
             });
          } catch (err) {
            context.logger.warn(`Failed to process screenshot \${s.name}: \${err.message}`);
            finalScreenshots.push(s);
          }
        }
      }

      return {
        success: result.success ?? false,
        results: result.results ?? [],
        screenshots: finalScreenshots,
        consoleLogs: result.consoleLogs ?? [],
        finalUrl: result.finalUrl,
        pageTitle: result.pageTitle,
        error: result.error,
      };

    } finally {
      await volume.cleanup();
    }
  },
};

componentRegistry.register(definition);

export { definition };
