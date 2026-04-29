import 'reflect-metadata';
import { describe, expect, it, mock } from 'bun:test';

import { AsmService } from '../asm.service';
import type { AuthContext } from '../../auth/types';

const auth: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'local',
};

describe('AsmService triggerDomainScan', () => {
  it('injects ASM domain context into the asset inventory sink', async () => {
    const run = mock(async () => ({ runId: 'run-1' }));
    const service = Object.create(AsmService.prototype) as any;

    service.getDomain = async () => ({ id: 'domain-1', domain: 'shipsec.ai' });
    service.checkScanRateLimit = () => undefined;
    service.resolveWorkflowIdForTemplate = async () => 'workflow-1';
    service.workflowsService = { run };
    service.logger = { log: () => undefined };

    const result = await (service as AsmService).triggerDomainScan(auth, 'domain-1');

    expect(result).toEqual({ runId: 'run-1', domain: 'shipsec.ai' });
    expect(run).toHaveBeenCalledTimes(1);

    const calls = run.mock.calls as unknown as any[][];
    const [, request, passedAuth, options] = calls[0] ?? [];
    expect(request).toEqual({ inputs: { domain: 'shipsec.ai' } });
    expect(passedAuth).toBe(auth);
    expect(options.componentParams['shipsec.subfinder.run']).toEqual({
      domain: 'shipsec.ai',
    });
    expect(options.componentParams['core.asm.assets-upsert']).toEqual({
      domain: 'shipsec.ai',
      domainId: 'domain-1',
    });
  });
});
