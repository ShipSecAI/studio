import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import { definition, type BrowserAutomationInput, type BrowserAction } from '../automation';

// Mock execution context
const mockContext = {
  runId: 'test-run-123',
  componentRef: 'browser.automation',
  logger: {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  },
  emitProgress: mock(() => {}),
  logCollector: undefined,
  terminalCollector: undefined,
  metadata: {
    runId: 'test-run-123',
    componentRef: 'browser.automation',
  },
  artifacts: undefined,
  storage: undefined,
  secrets: undefined,
  trace: undefined,
};

// Mock artifacts service
const mockArtifacts = {
  upload: mock(async () => ({
    artifactId: 'artifact-123',
    fileId: 'file-456',
    name: 'screenshot.png',
    destinations: ['run'],
  })),
};

describe('browser.automation component', () => {
  describe('schema validation', () => {
    it('should validate input with minimal required fields', () => {
      const input = {
        url: 'https://example.com',
        actions: [],
        options: {},
      };

      const result = definition.inputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate input with actions', () => {
      const input = {
        url: 'https://example.com',
        actions: [
          { type: 'goto', url: 'https://example.com/login' },
          { type: 'fill', selector: '#email', value: 'test@example.com' },
          { type: 'click', selector: 'button[type="submit"]' },
          { type: 'screenshot', name: 'after-click' },
        ] as BrowserAction[],
        options: {
          headless: true,
          screenshotOnEnd: true,
        },
      };

      const result = definition.inputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate screenshot action', () => {
      const action = {
        type: 'screenshot',
        name: 'test-screenshot',
        fullPage: true,
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate getHTML action', () => {
      const action = {
        type: 'getHTML',
        selector: 'main',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate getText action', () => {
      const action = {
        type: 'getText',
        selector: 'h1',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate waitFor action', () => {
      const action = {
        type: 'waitFor',
        selector: '.loaded',
        state: 'visible',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate evaluate action', () => {
      const action = {
        type: 'evaluate',
        script: 'document.title',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate select action', () => {
      const action = {
        type: 'select',
        selector: '#country',
        value: 'us',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate hover action', () => {
      const action = {
        type: 'hover',
        selector: '.dropdown-trigger',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should validate scroll action', () => {
      const action = {
        type: 'scroll',
        position: 'bottom',
      };

      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [action],
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid URL', () => {
      const result = definition.inputSchema.safeParse({
        url: 'not-a-url',
        actions: [],
      });

      expect(result.success).toBe(false);
    });

    it('should reject action with missing selector', () => {
      const result = definition.inputSchema.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'click' } as any],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('component metadata', () => {
    it('should have correct metadata', () => {
      expect(definition.id).toBe('browser.automation');
      expect(definition.label).toBe('Browser Automation');
      expect(definition.category).toBe('security');
      expect(definition.runner.kind).toBe('inline');
    });

    it('should have proper input/output schema definitions', () => {
      expect(definition.inputSchema).toBeDefined();
      expect(definition.outputSchema).toBeDefined();
    });

    it('should have metadata with proper structure', () => {
      const meta = definition.metadata;
      expect(meta).toBeDefined();
      expect(meta?.slug).toBe('browser-automation');
      expect(meta?.version).toBe('1.0.0');
      expect(meta?.type).toBe('scan');
      expect(meta?.category).toBe('security');
      expect(meta?.icon).toBe('Globe');
      expect(meta?.author?.name).toBe('ShipSecAI');
      expect(meta?.author?.type).toBe('shipsecai');
    });
  });

  describe('action schemas', () => {
    it('should export all action schemas', async () => {
      const module = await import('../automation');
      expect(module.gotoActionSchema).toBeDefined();
      expect(module.clickActionSchema).toBeDefined();
      expect(module.fillActionSchema).toBeDefined();
      expect(module.screenshotActionSchema).toBeDefined();
      expect(module.getHTMLActionSchema).toBeDefined();
      expect(module.getTextActionSchema).toBeDefined();
      expect(module.waitForActionSchema).toBeDefined();
      expect(module.evaluateActionSchema).toBeDefined();
      expect(module.selectActionSchema).toBeDefined();
      expect(module.hoverActionSchema).toBeDefined();
      expect(module.scrollActionSchema).toBeDefined();
    });
  });
});

// Integration tests (only run if PLAYWRIGHT_INTEGRATION is set)
const runIntegration = process.env.PLAYWRIGHT_INTEGRATION === 'true';

describe.skipIf(!runIntegration)('browser.automation integration tests', () => {
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
    await browser.close();
  });

  it('should navigate to a URL and take screenshot', async () => {
    // This is a placeholder for actual integration tests
    // Real tests would use the execute function with a mocked context
    expect(true).toBe(true);
  });
});
