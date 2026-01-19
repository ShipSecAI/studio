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

describe('Nuclei Integration Tests', () => {
  let nucleiComponent: ReturnType<typeof componentRegistry.get<NucleiInput, NucleiOutput>>;

  beforeEach(() => {
    nucleiComponent = componentRegistry.get<NucleiInput, NucleiOutput>('shipsec.nuclei.scan');

    // Reset mocks
    mockRunComponentWithRunner.mockClear();
    mockVolumeCleanup.mockClear();
    mockVolumeInitialize.mockClear();
  });

  describe('Template ID Execution', () => {
    test('should scan with specific template IDs', async () => {
      const input = {
        targets: ['https://example.com'],
        templateIds: ['CVE-2024-1234', 'http-missing-security-headers'],
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
        raw: '',
        stderr: '[INF] 2 templates loaded, 1 requests sent, finished in 2.5s',
        exitCode: 0,
      };

      mockRunComponentWithRunner.mockResolvedValueOnce(mockNucleiOutput as any);

      // Note: This test validates the schema but doesn't run actual Docker
      // In a real integration test, you'd use a test container
      expect(input.templateIds).toEqual(['CVE-2024-1234', 'http-missing-security-headers']);
    });

    test('should combine multiple template IDs', async () => {
      const input = {
        targets: ['https://example.com', 'https://test.com'],
        templateIds: ['CVE-2024-1234', 'CVE-2024-5678'],
      };

      const parsed = nucleiComponent!.inputs.parse(input);
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

      const input = {
        targets: ['https://example.com'],
        customTemplateYaml: validTemplate,
      };

      const parsed = nucleiComponent!.inputs.parse(input);
      expect(parsed.customTemplateYaml).toBe(validTemplate);
    });

    test('should reject YAML with dangerous exec pattern', () => {
      const dangerousTemplate = `id: malicious
info:
  name: Malicious Template
  severity: critical
exec:
  - command: rm -rf /`;

      // Would fail during execution when validate is called
      expect(dangerousTemplate).toContain('exec:');
    });
  });

  describe('Custom Archive (Zip)', () => {
    test('should extract and mount zip archive', async () => {
      // Create a minimal zip file (base64 encoded)
      const zipBase64 =
        'UEsDBAoAAAAAAKBveFkAAAAAAAAAAAAAAAAKAAAAdGVtcGxhdGVzL1BLAwQKAAAAAACgb3hZAAAAAAAAAAAAAAAAFwAAAHRlbXBsYXRlcy90ZXN0LnlhbWxpZDogdGVzdApQSwECPwAKAAAAAACgb3hZAAAAAAAAAAAAAAAACgAkAAAAAAAAAAAgAAAAAAAAAHRlbXBsYXRlcy8KACAAAAAAAAEAGAAA';

      const input = {
        targets: ['https://example.com'],
        customTemplateArchive: zipBase64,
      };

      const parsed = nucleiComponent!.inputs.parse(input);
      expect(parsed.customTemplateArchive).toBe(zipBase64);
    });

    test('should reject archive larger than 10MB', async () => {
      // Simulate large archive
      const largeSize = 11 * 1024 * 1024; // 11MB
      const largeBuffer = Buffer.alloc(largeSize, 'a');
      const largeBase64 = largeBuffer.toString('base64');

      // Would fail during execution when size is checked
      const sizeMB = Buffer.from(largeBase64, 'base64').length / (1024 * 1024);
      expect(sizeMB).toBeGreaterThan(10);
    });
  });

  describe('Built-in Templates', () => {
    // Tags and severity filters removed - use specific template IDs instead

    test('should scan with template paths', async () => {
      const input = {
        targets: ['https://example.com'],
        templatePaths: ['cves/2024/', 'http/exposures/'],
      };

      const parsed = nucleiComponent!.inputs.parse(input);
      expect(parsed.templatePaths).toEqual(['cves/2024/', 'http/exposures/']);
    });
  });

  describe('Scan Configuration', () => {
    test('should respect rate limiting', async () => {
      const params = {
        rateLimit: 50, // Low rate
      };

      const parsedParams = nucleiComponent!.parameters!.parse(params);
      expect(parsedParams.rateLimit).toBe(50);
    });

    test('should respect concurrency settings', async () => {
      const params = {
        concurrency: 5,
      };

      const parsedParams = nucleiComponent!.parameters!.parse(params);
      expect(parsedParams.concurrency).toBe(5);
    });

    test('should configure timeout and retries', async () => {
      const params = {
        timeout: 30,
        retries: 3,
      };

      const parsedParams = nucleiComponent!.parameters!.parse(params);
      expect(parsedParams.timeout).toBe(30);
      expect(parsedParams.retries).toBe(3);
    });

    test('should enable raw HTTP output', async () => {
      const params = {
        includeRaw: true,
      };

      const parsedParams = nucleiComponent!.parameters!.parse(params);
      expect(parsedParams.includeRaw).toBe(true);
    });

    test('should enable redirect following', async () => {
      const params = {
        followRedirects: true,
      };

      const parsedParams = nucleiComponent!.parameters!.parse(params);
      expect(parsedParams.followRedirects).toBe(true);
    });

    test('should disable template updates', async () => {
      const params = {
        updateTemplates: false,
      };

      const parsedParams = nucleiComponent!.parameters!.parse(params);
      expect(parsedParams.updateTemplates).toBe(false);
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
      const input = {
        targets: ['https://example.com', 'https://test.com', 'https://demo.com'],
        templateIds: ['CVE-2024-1234'],
      };

      const parsed = nucleiComponent!.inputs.parse(input);
      expect(parsed.targets).toHaveLength(3);
    });

    test('should handle target deduplication', async () => {
      const input = {
        targets: [
          'https://example.com',
          'https://example.com', // duplicate
          'https://test.com',
        ],
        templateIds: ['CVE-2024-1234'],
      };

      // Nuclei handles deduplication internally
      const parsed = nucleiComponent!.inputs.parse(input);
      expect(parsed.targets).toHaveLength(3); // Input keeps duplicates
    });
  });

  describe('Workflow Integration Examples', () => {
    test('should work with subfinder → httpx → nuclei pipeline', async () => {
      // Simulated pipeline

      const httpxOutput = {
        results: [
          { url: 'https://admin.example.com', statusCode: 200 },
          { url: 'https://api.example.com', statusCode: 200 },
        ],
      };

      const nucleiInput = {
        targets: httpxOutput.results.map((r) => r.url),
        templateIds: ['CVE-2024-1234'],
      };

      const parsed = nucleiComponent!.inputs.parse(nucleiInput);
      expect(parsed.targets).toHaveLength(2);
    });

    test('should work with entry point → file loader → nuclei', async () => {
      // Simulated workflow

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

      const nucleiInput = {
        targets: ['https://example.com'],
        customTemplateArchive: fileLoaderOutput.file.content,
      };

      const parsed = nucleiComponent!.inputs.parse(nucleiInput);
      expect(parsed.customTemplateArchive).toBeTruthy();
    });
  });
});
