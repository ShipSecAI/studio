#!/usr/bin/env bun

import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';

async function main() {
  await import('../src/components/index');
  const provider = componentRegistry.get('core.provider.gemini');
  const generator = componentRegistry.get('core.ai.generate-text');
  if (!provider || !generator) {
    console.error('Provider or generator component not found');
    process.exit(1);
  }

  const providerContext = createExecutionContext({
    runId: 'test-run',
    componentRef: 'gemini-provider',
  });
  const generateContext = createExecutionContext({
    runId: 'test-run',
    componentRef: 'gemini-generate',
  });

  const providerParams = provider.inputs.parse({
    model: 'gemini-2.5-flash',
    apiKey: process.env.GEMINI_API_KEY ?? 'replace-with-real-key',
  });
  const providerOutput = await provider.execute(
    {
      inputs: providerParams,
      params: {},
    },
    providerContext,
  );

  const generateParams = generator.inputs.parse({
    systemPrompt: 'You are helpful.',
    userPrompt: 'What is 2+2?',
    chatModel: providerOutput.chatModel,
  });

  const output = await generator.execute(
    {
      inputs: generateParams,
      params: {},
    },
    generateContext,
  );
  console.log(output);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
