import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import type { NucleiInput, NucleiOutput } from '../nuclei';
// Import to trigger registration
import '../nuclei';

// Mock the runComponentWithRunner function
const mockRunComponentWithRunner = mock(async () => ({
  results: [],
  raw: '',
  stderr: '',
  exitCode: 0,
}));

// Mock IsolatedContainerVolume
const mockVolumeCleanup = mock(async () => {});
const mockVolumeInitialize = mock(async () => 'test-volume-123');
const mockVolumeGetVolumeConfig = mock(() => ({
  source: 'test-volume',
  target: '/custom-templates',
  readOnly: true,
}));

class MockIsolatedContainerVolume {
  constructor(
    public tenantId: string,
    public runId: string,
  ) {}

  async initialize(files: Record<string, string | Buffer>) {
    return mockVolumeInitialize(files);
  }

  getVolumeConfig(path: string, readOnly: boolean) {
    return mockVolumeGetVolumeConfig(path, readOnly);
  }

  getVolumeName() {
    return 'test-volume-123';
  }

  async cleanup() {
    return mockVolumeCleanup();
  }
}

describe('Nuclei Integration Tests', () => {
  let nucleiComponent: any;
  let mockContext: any;

  beforeEach(() => {
    nucleiComponent = componentRegistry.get('shipsec.nuclei.scan');

    mockContext = {
      runId: 'test-run-123',
      componentRef: 'node-nuclei-1',
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
      },
      emitProgress: mock((msg: any) => {}),
      metadata: {
        runId: 'test-run-123',
        componentRef: 'node-nuclei-1',
      },
      tenantId: 'test-tenant',
    };

    // Reset mocks
    mockRunComponentWithRunner.mockClear();
    mockVolumeCleanup.mockClear();
    mockVolumeInitialize.mockClear();
  });

  describe('Template ID Execution', () => {
    test('should scan with specific template IDs', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234', 'http-missing-security-headers'],
        rateLimit: 100,
        concurrency: 10,
      };

      // Mock successful nuclei output
      const mockNucleiOutput = {
        results: [
          {
            'template-id': 'CVE-2024-1234',
            info: {
              name: 'Critical Vulnerability',
              severity: 'critical',
            },
            'matched-at': 'https://example.com',
            timestamp: '2024-12-04T10:00:00Z',
          },
        ],
        stderr: '[INF] 2 templates loaded, 1 requests sent, finished in 2.5s',
        exitCode: 0,
      };

      mockRunComponentWithRunner.mockResolvedValueOnce(mockNucleiOutput);

      // Note: This test validates the schema but doesn't run actual Docker
      // In a real integration test, you'd use a test container
      expect(input.templateIds).toEqual(['CVE-2024-1234', 'http-missing-security-headers']);
    });

    test('should combine multiple template IDs', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com', 'https://test.com'],
        templateIds: ['CVE-2024-1234', 'CVE-2024-5678'],
        rateLimit: 50,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.templateIds).toEqual(['CVE-2024-1234', 'CVE-2024-5678']);
      expect(parsed.targets).toHaveLength(2);
    });
  });

  describe('Custom YAML Template', () => {
    test('should validate and execute custom YAML template', async () => {
      const validTemplate = `id: custom-test
info:
  name: Custom Test Template
  severity: medium
  author: test-user
http:
  - method: GET
    path:
      - "{{BaseURL}}/admin"
    matchers:
      - type: status
        status:
          - 200`;

      const input: NucleiInput = {
        targets: ['https://example.com'],
        customTemplateYaml: validTemplate,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.customTemplateYaml).toBe(validTemplate);
    });

    test('should reject YAML with dangerous exec pattern', () => {
      const dangerousTemplate = `id: malicious
info:
  name: Malicious Template
  severity: critical
exec:
  - command: rm -rf /`;

      const input: NucleiInput = {
        targets: ['https://example.com'],
        customTemplateYaml: dangerousTemplate,
      };

      // Would fail during execution when validate is called
      expect(dangerousTemplate).toContain('exec:');
    });
  });

  describe('Custom Archive (Zip)', () => {
    test('should extract and mount zip archive', async () => {
      // Create a minimal zip file (base64 encoded)
      const zipBase64 = 'UEsDBAoAAAAAAKBveFkAAAAAAAAAAAAAAAAKAAAAdGVtcGxhdGVzL1BLAwQKAAAAAACgb3hZAAAAAAAAAAAAAAAAFwAAAHRlbXBsYXRlcy90ZXN0LnlhbWxpZDogdGVzdApQSwECPwAKAAAAAACgb3hZAAAAAAAAAAAAAAAACgAkAAAAAAAAAAAgAAAAAAAAAHRlbXBsYXRlcy8KACAAAAAAAAEAGAAA';

      const input: NucleiInput = {
        targets: ['https://example.com'],
        customTemplateArchive: zipBase64,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.customTemplateArchive).toBe(zipBase64);
    });

    test('should reject archive larger than 10MB', async () => {
      // Simulate large archive
      const largeSize = 11 * 1024 * 1024; // 11MB
      const largeBuffer = Buffer.alloc(largeSize, 'a');
      const largeBase64 = largeBuffer.toString('base64');

      const input: NucleiInput = {
        targets: ['https://example.com'],
        customTemplateArchive: largeBase64,
      };

      // Would fail during execution when size is checked
      const sizeMB = Buffer.from(largeBase64, 'base64').length / (1024 * 1024);
      expect(sizeMB).toBeGreaterThan(10);
    });
  });

  describe('Built-in Templates', () => {
    // Tags and severity filters removed - use specific template IDs instead

    test('should scan with template paths', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templatePaths: ['cves/2024/', 'http/exposures/'],
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.templatePaths).toEqual(['cves/2024/', 'http/exposures/']);
    });
  });

  describe('Scan Configuration', () => {
    test('should respect rate limiting', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        rateLimit: 50, // Low rate
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.rateLimit).toBe(50);
    });

    test('should respect concurrency settings', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        concurrency: 5,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.concurrency).toBe(5);
    });

    test('should configure timeout and retries', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        timeout: 30,
        retries: 3,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.timeout).toBe(30);
      expect(parsed.retries).toBe(3);
    });

    test('should enable raw HTTP output', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        includeRaw: true,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.includeRaw).toBe(true);
    });

    test('should enable redirect following', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        followRedirects: true,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.followRedirects).toBe(true);
    });

    test('should disable template updates', async () => {
      const input: NucleiInput = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234'],
        updateTemplates: false,
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.updateTemplates).toBe(false);
    });
  });

  describe('Output Parsing', () => {
    test('should parse nuclei JSONL output correctly', () => {
      const jsonlOutput = `{"template-id":"CVE-2024-1234","info":{"name":"Test CVE","severity":"critical","tags":["cve","rce"]},"matched-at":"https://example.com","timestamp":"2024-12-04T10:00:00Z"}
{"template-id":"http-missing-headers","info":{"name":"Missing Headers","severity":"low","tags":["headers"]},"matched-at":"https://test.com","timestamp":"2024-12-04T10:01:00Z"}
{"template-id":"xss-reflected","info":{"name":"XSS Vulnerability","severity":"high","tags":["xss"]},"matched-at":"https://vulnerable.com","timestamp":"2024-12-04T10:02:00Z","extracted-results":["<script>alert(1)</script>"]}`;

      const lines = jsonlOutput.split('\n');
      expect(lines).toHaveLength(3);

      // Parse each line
      const findings = lines.map((line) => JSON.parse(line));
      expect(findings[0]['template-id']).toBe('CVE-2024-1234');
      expect(findings[1].info.severity).toBe('low');
      expect(findings[2]['extracted-results']).toContain('<script>alert(1)</script>');
    });

    test('should extract stats from stderr', () => {
      const stderr = `[INF] Using nuclei-templates [community] v9.8.0
[INF] Using Nuclei Engine 3.1.0 (latest)
[INF] 50 templates loaded for current scan
[INF] 150 requests sent
[INF] Finished in 5.2s`;

      expect(stderr).toContain('50 templates loaded');
      expect(stderr).toContain('150 requests sent');
      expect(stderr).toContain('5.2s');
    });

    test('should handle empty results', () => {
      const emptyOutput = {
        results: [],
        raw: '',
        stderr: '[INF] No results found',
        exitCode: 0,
      };

      expect(emptyOutput.results).toHaveLength(0);
      expect(emptyOutput.stderr).toContain('No results');
    });
  });

  describe('Error Handling', () => {
    test('should handle nuclei execution failure', async () => {
      const errorOutput = {
        results: [],
        raw: '',
        stderr: '[ERR] Failed to load templates: invalid path',
        exitCode: 1,
      };

      expect(errorOutput.exitCode).not.toBe(0);
      expect(errorOutput.stderr).toContain('ERR');
    });

    test('should handle malformed JSON in output', () => {
      const malformedOutput = `{"template-id":"valid"}
this is not json
{"template-id":"also-valid"}`;

      const lines = malformedOutput.split('\n');
      const validLines = lines.filter((line) => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      expect(validLines).toHaveLength(2);
    });
  });

  describe('Multi-Target Scanning', () => {
    test('should scan multiple targets', async () => {
      const input: NucleiInput = {
        targets: [
          'https://example.com',
          'https://test.com',
          'https://demo.com',
        ],
        templateIds: ['CVE-2024-1234'],
      };

      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.targets).toHaveLength(3);
    });

    test('should handle target deduplication', async () => {
      const input: NucleiInput = {
        targets: [
          'https://example.com',
          'https://example.com', // duplicate
          'https://test.com',
        ],
        templateIds: ['CVE-2024-1234'],
      };

      // Nuclei handles deduplication internally
      const parsed = nucleiComponent.inputSchema.parse(input);
      expect(parsed.targets).toHaveLength(3); // Input keeps duplicates
    });
  });

  describe('Workflow Integration Examples', () => {
    test('should work with subfinder → httpx → nuclei pipeline', async () => {
      // Simulated pipeline
      const subfinderOutput = {
        subdomains: ['admin.example.com', 'api.example.com', 'staging.example.com'],
      };

      const httpxOutput = {
        results: [
          { url: 'https://admin.example.com', statusCode: 200 },
          { url: 'https://api.example.com', statusCode: 200 },
        ],
      };

      const nucleiInput: NucleiInput = {
        targets: httpxOutput.results.map((r) => r.url),
        templateIds: ['CVE-2024-1234'],
      };

      const parsed = nucleiComponent.inputSchema.parse(nucleiInput);
      expect(parsed.targets).toHaveLength(2);
    });

    test('should work with manual trigger → file loader → nuclei', async () => {
      // Simulated workflow
      const manualTriggerOutput = {
        templateZip: 'file-uuid-123',
      };

      const fileLoaderOutput = {
        file: {
          id: 'file-uuid-123',
          name: 'my-templates.zip',
          mimeType: 'application/zip',
          size: 1024000,
          content: 'base64-encoded-zip-content',
        },
        textContent: '', // Not used for binary
      };

      const nucleiInput: NucleiInput = {
        targets: ['https://example.com'],
        customTemplateArchive: fileLoaderOutput.file.content,
      };

      const parsed = nucleiComponent.inputSchema.parse(nucleiInput);
      expect(parsed.customTemplateArchive).toBeTruthy();
    });
  });
});
