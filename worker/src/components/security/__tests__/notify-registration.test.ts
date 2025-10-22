import { describe, expect, test } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import '../notify';

const runNotifyTests = process.env.ENABLE_NOTIFY_COMPONENT_TESTS === 'true';
const describeNotify = runNotifyTests ? describe : describe.skip;

describeNotify('Notify component registration', () => {
  test('registers ProjectDiscovery notify component with expected defaults', () => {
    const component = componentRegistry.get('shipsec.notify.dispatch');
    expect(component).toBeDefined();
    expect(component?.category).toBe('output');
    expect(component?.metadata?.slug).toBe('notify');

    if (component?.runner?.kind === 'docker') {
      expect(component.runner.image).toContain('projectdiscovery/notify');
      expect(component.runner.entrypoint).toBe('sh');
    } else {
      throw new Error('Expected docker runner for notify component');
    }
  });
});
