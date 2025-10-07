import { describe, expect, it } from 'bun:test';

import '../../components/register-default-components';
import { componentRegistry } from '../registry';

describe('ComponentRegistry', () => {
  it('exposes default components', () => {
    const ids = componentRegistry.list().map((c) => c.id);
    expect(ids).toContain('core.file.loader');
    expect(ids).toContain('shipsec.subfinder.run');
    expect(ids).toContain('core.webhook.post');
  });
});
