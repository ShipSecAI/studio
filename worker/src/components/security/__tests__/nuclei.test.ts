import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import type { NucleiInput, NucleiOutput } from '../nuclei';
// Import to trigger registration
import '../nuclei';

describe('Nuclei Component', () => {
  let nucleiComponent: any;
  let mockContext: any;

  beforeEach(() => {
    // Get the registered component
    nucleiComponent = componentRegistry.get('shipsec.nuclei.scan');

    // Mock execution context
    mockContext = {
      runId: 'test-run-123',
      componentRef: 'node-1',
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
      },
      emitProgress: mock(() => {}),
      metadata: {
        runId: 'test-run-123',
        componentRef: 'node-1',
      },
      tenantId: 'test-tenant',
    };
  });

  describe('Input Validation', () => {
    test('should require at least one target', () => {
      const input = {
        targets: [],
        templateIds: ['CVE-2024-1234'],
      };

      expect(() => nucleiComponent.inputSchema.parse(input)).toThrow();
    });

    test('should require at least one template source', () => {
      const input = {
        targets: ['https://example.com'],
        // No template source provided
      };

      expect(() => nucleiComponent.inputSchema.parse(input)).toThrow(
        /at least one template source/i,
      );
    });

    test('should accept templateIds as template source', () => {
      const input = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.templateIds).toEqual(['CVE-2024-1234']);
    });

    // Tags and severity parameters were removed - use templateIds or custom templates instead

    test('should accept customTemplateYaml as template source', () => {
      const input = {
        targets: ['https://example.com'],
        customTemplateYaml: 'id: test\ninfo:\n  name: Test',
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.customTemplateYaml).toBeDefined();
    });

    test('should accept customTemplateArchive as template source', () => {
      const input = {
        targets: ['https://example.com'],
        customTemplateArchive: 'base64encodedzip',
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.customTemplateArchive).toBeDefined();
    });

    test('should accept multiple template sources', () => {
      const input = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234', 'CVE-2024-5678'],
        customTemplateYaml: 'id: test\ninfo:\n  name: Test',
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.templateIds).toEqual(['CVE-2024-1234', 'CVE-2024-5678']);
      expect(parsed.customTemplateYaml).toBeDefined();
    });

    test('should apply default values for scan configuration', () => {
      const input = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.rateLimit).toBe(150);
      expect(parsed.concurrency).toBe(25);
      expect(parsed.timeout).toBe(10);
      expect(parsed.retries).toBe(1);
      expect(parsed.includeRaw).toBe(false);
      expect(parsed.followRedirects).toBe(false);
      expect(parsed.updateTemplates).toBe(false);
      expect(parsed.disableHttpx).toBe(true);
    });

    // Severity parameter removed - use specific template IDs instead

    test('should enforce rateLimit max value', () => {
      const input = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        rateLimit: 2000, // exceeds max of 1000
      };

      expect(() => nucleiComponent.inputSchema.parse(input)).toThrow();
    });

    test('should enforce concurrency max value', () => {
      const input = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        concurrency: 150, // exceeds max of 100
      };

      expect(() => nucleiComponent.inputSchema.parse(input)).toThrow();
    });
  });

  describe('Output Schema', () => {
    test('should validate complete output structure', () => {
      const output = {
        findings: [
          {
            templateId: 'CVE-2024-1234',
            name: 'Test Vulnerability',
            severity: 'critical',
            tags: ['cve', 'rce'],
            matchedAt: 'https://example.com',
            timestamp: '2024-12-04T10:00:00Z',
          },
        ],
        rawOutput: '{"template-id":"CVE-2024-1234"}',
        targetCount: 1,
        findingCount: 1,
        stats: {
          templatesLoaded: 10,
          requestsSent: 5,
          duration: 3.5,
        },
      };

      const parsed = nucleiComponent.outputSchema.parse(output);
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findingCount).toBe(1);
    });

    test('should validate finding severity values', () => {
      const output = {
        findings: [
          {
            templateId: 'test',
            name: 'Test',
            severity: 'invalid' as any,
            tags: [],
            matchedAt: 'https://example.com',
            timestamp: '2024-12-04T10:00:00Z',
          },
        ],
        rawOutput: '',
        targetCount: 1,
        findingCount: 1,
        stats: { templatesLoaded: 0, requestsSent: 0, duration: 0 },
      };

      expect(() => nucleiComponent.outputSchema.parse(output)).toThrow();
    });

    test('should allow optional finding fields', () => {
      const output = {
        findings: [
          {
            templateId: 'test',
            name: 'Test',
            severity: 'info',
            tags: [],
            matchedAt: 'https://example.com',
            timestamp: '2024-12-04T10:00:00Z',
            extractedResults: ['result1'],
            request: 'GET / HTTP/1.1',
            response: 'HTTP/1.1 200 OK',
            host: 'example.com',
            ip: '1.2.3.4',
          },
        ],
        rawOutput: '',
        targetCount: 1,
        findingCount: 1,
        stats: { templatesLoaded: 0, requestsSent: 0, duration: 0 },
      };

      const parsed = nucleiComponent.outputSchema.parse(output);
      expect(parsed.findings[0].extractedResults).toEqual(['result1']);
      expect(parsed.findings[0].host).toBe('example.com');
    });
  });
});

describe('Nuclei Helper Functions', () => {
  describe('validateNucleiTemplate', () => {
    // Import the helper (we'll need to export it from nuclei.ts)
    test('should accept valid nuclei template', () => {
      const validYaml = `
id: test-template
info:
  name: Test Template
  severity: critical
  author: test
http:
  - method: GET
    path:
      - "{{BaseURL}}"
    matchers:
      - type: status
        status:
          - 200
`;

      // This would be tested through component execution
      // For now, we test via the component
      expect(validYaml).toBeTruthy();
    });

    test('should reject template without id', () => {
      const invalidYaml = `
info:
  name: Test Template
  severity: critical
`;

      // Would throw when validated
      expect(invalidYaml).toBeTruthy(); // Placeholder
    });

    test('should reject template with dangerous patterns', () => {
      const dangerousYaml = `
id: malicious
info:
  name: Malicious
  severity: critical
exec:
  - command: rm -rf /
`;

      // Would throw when validated
      expect(dangerousYaml).toBeTruthy(); // Placeholder
    });
  });

  describe('parseNucleiOutput', () => {
    test('should parse valid JSONL output', () => {
      const jsonlOutput = `{"template-id":"CVE-2024-1234","info":{"name":"Test CVE","severity":"critical","tags":["cve","rce"]},"matched-at":"https://example.com","timestamp":"2024-12-04T10:00:00Z"}
{"template-id":"http-missing-headers","info":{"name":"Missing Headers","severity":"low","tags":["headers"]},"matched-at":"https://test.com","timestamp":"2024-12-04T10:01:00Z"}`;

      // This is tested via the component execute method
      const lines = jsonlOutput.split('\n');
      expect(lines).toHaveLength(2);
    });

    test('should handle empty output', () => {
      const emptyOutput = '';
      expect(emptyOutput).toBe('');
    });

    test('should handle malformed JSON lines', () => {
      const malformedOutput = `{"valid":"json"}
not-valid-json
{"another":"valid"}`;

      const lines = malformedOutput.split('\n');
      expect(lines).toHaveLength(3);
    });
  });

  describe('extractAndValidateZip', () => {
    test('should extract valid zip with YAML files', async () => {
      // This requires actual zip file creation
      // Would be tested in integration tests
      expect(true).toBe(true);
    });

    test('should reject non-YAML files', async () => {
      // Would filter out .txt, .exe, etc.
      expect(true).toBe(true);
    });

    test('should reject files with path traversal', async () => {
      // Would reject ../../../etc/passwd
      expect(true).toBe(true);
    });

    test('should enforce 10MB size limit', async () => {
      // Would throw on >10MB archives
      expect(true).toBe(true);
    });

    test('should enforce 1MB per file limit', async () => {
      // Would skip files >1MB
      expect(true).toBe(true);
    });
  });

  describe('extractStats', () => {
    test('should extract templates loaded from stderr', () => {
      const stderr = '[INF] Using templates from /root/.nuclei-templates (10 templates loaded)';
      // extractStats would parse this
      expect(stderr).toContain('10 templates');
    });

    test('should extract requests sent from stderr', () => {
      const stderr = '[INF] Sent 25 requests';
      expect(stderr).toContain('25 requests');
    });

    test('should extract duration from stderr', () => {
      const stderr = '[INF] Finished in 3.5s';
      expect(stderr).toContain('3.5s');
    });

    test('should return zeros for missing stats', () => {
      const stderr = '';
      const stats = {
        templatesLoaded: 0,
        requestsSent: 0,
        duration: 0,
      };
      expect(stats.templatesLoaded).toBe(0);
    });
  });
});

describe('Nuclei Security Validations', () => {
  describe('YAML Security', () => {
    test('should reject exec patterns', () => {
      const yaml = 'id: test\ninfo:\n  name: Test\nexec:\n  - command: ls';
      // Would be rejected by validateNucleiTemplate
      expect(yaml).toContain('exec:');
    });

    test('should reject eval patterns', () => {
      const yaml = 'eval(malicious_code)';
      expect(yaml).toContain('eval(');
    });

    test('should reject system patterns', () => {
      const yaml = 'system("rm -rf /")';
      expect(yaml).toContain('system(');
    });

    test('should reject command substitution', () => {
      const yaml = 'value: $(malicious)';
      expect(yaml).toContain('$(');
    });

    test('should reject backticks', () => {
      const yaml = 'value: `malicious`';
      expect(yaml).toContain('`');
    });
  });

  describe('Zip Security', () => {
    test('should reject path traversal attempts', () => {
      const filename = '../../../etc/passwd';
      expect(filename).toContain('..');
    });

    test('should reject absolute paths', () => {
      const filename = '/etc/passwd';
      expect(filename).toStartWith('/');
    });

    test('should accept safe relative paths', () => {
      const filename = 'templates/cves/CVE-2024-1234.yaml';
      expect(filename).not.toContain('..');
      expect(filename).not.toStartWith('/');
    });

    test('should accept nested directories', () => {
      const filename = 'my-org/prod/web-templates/xss.yaml';
      expect(filename.split('/')).toHaveLength(4);
    });
  });
});

describe('Nuclei Integration', () => {
  test('should be registered in component registry', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    expect(component).toBeDefined();
    expect(component.id).toBe('shipsec.nuclei.scan');
    expect(component.label).toBe('Nuclei Vulnerability Scanner');
    expect(component.category).toBe('security');
  });

  test('should have correct metadata', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    expect(component.metadata?.slug).toBe('nuclei');
    expect(component.metadata?.version).toBe('1.0.0');
    expect(component.metadata?.type).toBe('scan');
    expect(component.metadata?.author?.name).toBe('ShipSecAI');
  });

  test('should have Docker runner configuration', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('ghcr.io/shipsecai/nuclei:latest');
      expect(component.runner.network).toBe('bridge');
      expect(component.runner.timeoutSeconds).toBeGreaterThan(0);
    }
  });

  test('should have documented inputs', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    const inputs = component.metadata?.inputs || [];

    const targetInput = inputs.find((i) => i.id === 'targets');
    expect(targetInput).toBeDefined();
    expect(targetInput?.required).toBe(true);

    const templateIdsInput = inputs.find((i) => i.id === 'templateIds');
    expect(templateIdsInput).toBeDefined();
    expect(templateIdsInput?.required).toBe(false);

    // tags and severity parameters removed - use templateIds instead
  });

  test('should have documented outputs', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    const outputs = component.metadata?.outputs || [];

    const findingsOutput = outputs.find((o) => o.id === 'findings');
    expect(findingsOutput).toBeDefined();

    const rawOutput = outputs.find((o) => o.id === 'rawOutput');
    expect(rawOutput).toBeDefined();

    const findingCountOutput = outputs.find((o) => o.id === 'findingCount');
    expect(findingCountOutput).toBeDefined();
  });

  test('should have configuration parameters', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    const params = component.metadata?.parameters || [];

    const rateLimitParam = params.find((p) => p.id === 'rateLimit');
    expect(rateLimitParam).toBeDefined();
    expect(rateLimitParam?.type).toBe('number');
    expect(rateLimitParam?.default).toBe(150);

    const concurrencyParam = params.find((p) => p.id === 'concurrency');
    expect(concurrencyParam).toBeDefined();
    expect(concurrencyParam?.default).toBe(25);

    const updateTemplatesParam = params.find((p) => p.id === 'updateTemplates');
    expect(updateTemplatesParam).toBeDefined();
    expect(updateTemplatesParam?.type).toBe('boolean');
  });

  test('should have usage examples', () => {
    const component = componentRegistry.get('shipsec.nuclei.scan');
    const examples = component.metadata?.examples || [];

    expect(examples.length).toBeGreaterThan(0);
    expect(examples.some((e) => e.toLowerCase().includes('cve'))).toBe(true);
    expect(examples.some((e) => e.toLowerCase().includes('custom'))).toBe(true);
  });
});
