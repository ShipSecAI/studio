import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import { AbuseIPDBInput, AbuseIPDBOutput } from '../abuseipdb';

describe('abuseipdb component', () => {
  beforeAll(async () => {
    // Ensure registry is populated
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered with correct metadata', () => {
    const component = componentRegistry.get('security.abuseipdb.check');
    expect(component).toBeDefined();
    expect(component!.label).toBe('AbuseIPDB Check');
    expect(component!.category).toBe('security');
  });

  it('should have parameters defined in metadata', () => {
    const metadata = componentRegistry.getMetadata('security.abuseipdb.check');
    expect(metadata).toBeDefined();
    expect(metadata!.parameters).toBeDefined();
    expect(metadata!.parameters).toHaveLength(2);
  });

  it('should execute successfully with valid input', async () => {
    const component = componentRegistry.get<AbuseIPDBInput, AbuseIPDBOutput>(
      'security.abuseipdb.check',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'abuseipdb-test',
    });

    const executePayload = {
      inputs: {
        ipAddress: '127.0.0.1',
        apiKey: 'test-key',
      },
      params: {
        maxAgeInDays: 90,
        verbose: false,
      },
    };

    const mockResponse = {
      data: {
        ipAddress: '127.0.0.1',
        isPublic: true,
        ipVersion: 4,
        isWhitelisted: false,
        abuseConfidenceScore: 100,
        countryCode: 'US',
        usageType: 'Data Center',
        isp: 'Test ISP',
        domain: 'example.com',
        totalReports: 10,
        numDistinctUsers: 5,
        lastReportedAt: '2023-01-01T00:00:00Z',
      },
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await component.execute(executePayload, context);

    expect(fetchSpy).toHaveBeenCalled();
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toContain('https://api.abuseipdb.com/api/v2/check');
    expect(callArgs[0]).toContain('ipAddress=127.0.0.1');

    expect(result.ipAddress).toBe('127.0.0.1');
    expect(result.abuseConfidenceScore).toBe(100);
    expect(result.isp).toBe('Test ISP');
    expect(result.full_report).toEqual(mockResponse);
  });

  it('should handle 404', async () => {
    const component = componentRegistry.get<AbuseIPDBInput, AbuseIPDBOutput>(
      'security.abuseipdb.check',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'abuseipdb-test',
    });

    const executePayload = {
      inputs: {
        ipAddress: '0.0.0.0',
        apiKey: 'test-key',
      },
      params: {
        maxAgeInDays: 90,
        verbose: false,
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 404,
      }),
    );

    const result = await component.execute(executePayload, context);
    expect(result.abuseConfidenceScore).toBe(0);
    expect(result.full_report.error).toBe('Not Found');
  });

  it('should throw error on failure', async () => {
    const component = componentRegistry.get('security.abuseipdb.check');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'abuseipdb-test',
    });

    const executePayload = {
      inputs: {
        ipAddress: '1.1.1.1',
        apiKey: 'test-key',
      },
      params: {
        maxAgeInDays: 90,
        verbose: false,
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', {
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    await expect(component.execute(executePayload, context)).rejects.toThrow();
  });

  it('should throw ValidationError when ipAddress is missing', async () => {
    const component = componentRegistry.get<AbuseIPDBInput, AbuseIPDBOutput>(
      'security.abuseipdb.check',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'abuseipdb-test',
    });

    const executePayload = {
      inputs: {
        ipAddress: '',
        apiKey: 'test-key',
      },
      params: {
        maxAgeInDays: 90,
        verbose: false,
      },
    };

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      'IP Address is required',
    );
  });

  it('should throw ConfigurationError when apiKey is missing', async () => {
    const component = componentRegistry.get<AbuseIPDBInput, AbuseIPDBOutput>(
      'security.abuseipdb.check',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'abuseipdb-test',
    });

    const executePayload = {
      inputs: {
        ipAddress: '1.1.1.1',
        apiKey: '',
      },
      params: {
        maxAgeInDays: 90,
        verbose: false,
      },
    };

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      'AbuseIPDB API Key is required',
    );
  });

  it('should include verbose parameter in request when enabled', async () => {
    const component = componentRegistry.get<AbuseIPDBInput, AbuseIPDBOutput>(
      'security.abuseipdb.check',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'abuseipdb-test',
    });

    const executePayload = {
      inputs: {
        ipAddress: '8.8.8.8',
        apiKey: 'test-key',
      },
      params: {
        maxAgeInDays: 30,
        verbose: true,
      },
    };

    const mockResponse = {
      data: {
        ipAddress: '8.8.8.8',
        abuseConfidenceScore: 0,
        reports: [],
      },
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await component.execute(executePayload, context);

    const callUrl = fetchSpy.mock.calls[0][0] as string;
    expect(callUrl).toContain('verbose=true');
    expect(callUrl).toContain('maxAgeInDays=30');
  });
});
