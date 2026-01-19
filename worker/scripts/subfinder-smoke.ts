import {
  componentRegistry,
  createExecutionContext,
  runComponentWithRunner,
} from '@shipsec/component-sdk';

import '../src/components/security/subfinder';

async function main() {
  const component = componentRegistry.get('shipsec.subfinder.run');
  if (!component) {
    throw new Error('Subfinder component not registered');
  }

  const context = createExecutionContext({
    runId: 'smoke-run',
    componentRef: 'subfinder-smoke',
  });

  const input = component.inputs.parse({
    domains: ['hackerone.com', 'bugcrowd.com', 'projectdiscovery.io'],
  });

  const result = await runComponentWithRunner(
    component.runner,
    component.execute,
    {
      inputs: input,
      params: {},
    },
    context,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
