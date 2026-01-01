/**
 * E2E Tests - Report Templates
 *
 * Validates the report template CRUD operations.
 *
 * These tests require:
 * - Backend API running on http://localhost:3211
 * - Database running with migrations applied
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

// Only run E2E tests when RUN_E2E is set
const runE2E = process.env.RUN_E2E === 'true';

// Check if services are available synchronously
const servicesAvailableSync = (() => {
  if (!runE2E) {
    return false;
  }
  try {
    const result = Bun.spawnSync([
      'curl', '-sf', '--max-time', '1',
      '-H', `x-internal-token: ${HEADERS['x-internal-token']}`,
      `${API_BASE}/health`
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

// Async service check used in beforeAll
async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) {
    return false;
  }
  try {
    const healthRes = await fetch(`${API_BASE}/health`, { 
      headers: HEADERS,
      signal: AbortSignal.timeout(2000),
    });
    return healthRes.ok;
  } catch {
    return false;
  }
}

const e2eDescribe = (runE2E && servicesAvailableSync) ? describe : describe.skip;

function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>
): void {
  if (runE2E && servicesAvailableSync) {
    if (typeof optionsOrFn === 'function') {
      test(name, optionsOrFn);
    } else if (fn) {
      (test as any)(name, optionsOrFn, fn);
    } else {
      test(name, optionsOrFn as any);
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

// Track created resources for cleanup
const createdTemplateIds: string[] = [];

// Setup and teardown
beforeAll(async () => {
  if (!runE2E) {
    console.log('\n🧪 E2E Test Suite: Report Templates');
    console.log('  ⏭️  Skipping E2E tests (RUN_E2E not set)');
    console.log('  💡 Set RUN_E2E=true to enable E2E tests');
    return;
  }

  console.log('\n🧪 E2E Test Suite: Report Templates');
  console.log('  Prerequisites: Backend API must be running');
  console.log('  Verifying services...');

  const available = await checkServicesAvailable();
  if (!available) {
    console.log('  ⚠️  Backend API is not available. Tests will be skipped.');
    return;
  }

  console.log('  ✅ Backend API is running');
  console.log('');
});

afterAll(async () => {
  // Cleanup created templates
  console.log('');
  console.log('🧹 Cleaning up test templates...');
  for (const id of createdTemplateIds) {
    try {
      await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: HEADERS });
      console.log(`  ✓ Deleted template ${id}`);
    } catch (e) {
      console.log(`  ⚠ Failed to delete template ${id}`);
    }
  }
});

e2eDescribe('Report Templates E2E Tests', () => {
  let testTemplateId: string;

  e2eTest('List templates - returns array', { timeout: 10000 }, async () => {
    console.log('\n  Test: List templates');

    const res = await fetch(`${API_BASE}/templates`, { headers: HEADERS });
    expect(res.ok).toBe(true);
    
    const templates = await res.json();
    expect(Array.isArray(templates)).toBe(true);
    console.log(`  Found ${templates.length} templates`);
  });

  e2eTest('List system templates - returns array', { timeout: 10000 }, async () => {
    console.log('\n  Test: List system templates');

    const res = await fetch(`${API_BASE}/templates/system`, { headers: HEADERS });
    expect(res.ok).toBe(true);
    
    const templates = await res.json();
    expect(Array.isArray(templates)).toBe(true);
    console.log(`  Found ${templates.length} system templates`);
  });

  e2eTest('Create template - creates new template', { timeout: 10000 }, async () => {
    console.log('\n  Test: Create template');

    const newTemplate = {
      name: 'E2E Test Template',
      description: 'Created by E2E test suite',
      content: {
        html: '<h1>{{title}}</h1><p>{{description}}</p>',
      },
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title'],
      },
      sampleData: {
        title: 'Sample Report',
        description: 'This is a sample report description',
      },
    };

    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(newTemplate),
    });

    expect(res.ok).toBe(true);
    
    const template = await res.json();
    expect(template.id).toBeDefined();
    expect(template.name).toBe('E2E Test Template');
    expect(template.version).toBe(1);
    expect(template.isSystem).toBe(false);
    
    testTemplateId = template.id;
    createdTemplateIds.push(template.id);
    console.log(`  Created template: ${template.id}`);
  });

  e2eTest('Get template by ID - returns template', { timeout: 10000 }, async () => {
    console.log('\n  Test: Get template by ID');
    
    expect(testTemplateId).toBeDefined();

    const res = await fetch(`${API_BASE}/templates/${testTemplateId}`, { headers: HEADERS });
    expect(res.ok).toBe(true);
    
    const template = await res.json();
    expect(template.id).toBe(testTemplateId);
    expect(template.name).toBe('E2E Test Template');
    console.log(`  Retrieved template: ${template.name} v${template.version}`);
  });

  e2eTest('Update template - creates new version', { timeout: 10000 }, async () => {
    console.log('\n  Test: Update template');
    
    expect(testTemplateId).toBeDefined();

    const updateData = {
      name: 'E2E Test Template Updated',
      description: 'Updated by E2E test suite',
      content: {
        html: '<h1>{{title}}</h1><h2>{{subtitle}}</h2><p>{{description}}</p>',
      },
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title'],
      },
    };

    const res = await fetch(`${API_BASE}/templates/${testTemplateId}`, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify(updateData),
    });

    expect(res.ok).toBe(true);
    
    const template = await res.json();
    expect(template.name).toBe('E2E Test Template Updated');
    expect(template.version).toBeGreaterThanOrEqual(1);
    console.log(`  Updated template: ${template.name} v${template.version}`);
  });

  e2eTest('Preview template - renders HTML', { timeout: 10000 }, async () => {
    console.log('\n  Test: Preview template');
    
    expect(testTemplateId).toBeDefined();

    const previewData = {
      data: {
        title: 'Preview Test',
        subtitle: 'Subtitle Here',
        description: 'This is a preview test.',
      },
    };

    const res = await fetch(`${API_BASE}/templates/${testTemplateId}/preview`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(previewData),
    });

    expect(res.ok).toBe(true);
    
    const preview = await res.json();
    expect(preview.templateId).toBe(testTemplateId);
    console.log(`  Preview generated for template: ${preview.templateId}`);
  });

  e2eTest('Generate report - returns generated report', { timeout: 15000 }, async () => {
    console.log('\n  Test: Generate report');
    
    expect(testTemplateId).toBeDefined();

    const generateData = {
      templateId: testTemplateId,
      data: {
        title: 'Generated Report',
        subtitle: 'Automated Test',
        description: 'This report was generated by E2E tests.',
      },
      format: 'html',
    };

    const res = await fetch(`${API_BASE}/templates/generate`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(generateData),
    });

    expect(res.ok).toBe(true);
    
    const result = await res.json();
    expect(result.templateId).toBe(testTemplateId);
    expect(result.format).toBe('html');
    console.log(`  Generated report from template: ${result.templateId}`);
  });

  e2eTest('Delete template - removes template', { timeout: 10000 }, async () => {
    console.log('\n  Test: Delete template');
    
    expect(testTemplateId).toBeDefined();

    const res = await fetch(`${API_BASE}/templates/${testTemplateId}`, {
      method: 'DELETE',
      headers: HEADERS,
    });

    expect(res.status).toBe(204);
    console.log(`  Deleted template: ${testTemplateId}`);
    
    // Remove from cleanup list since we already deleted it
    const idx = createdTemplateIds.indexOf(testTemplateId);
    if (idx > -1) {
      createdTemplateIds.splice(idx, 1);
    }

    // Verify it's gone
    const verifyRes = await fetch(`${API_BASE}/templates/${testTemplateId}`, { headers: HEADERS });
    expect(verifyRes.status).toBe(404);
    console.log(`  Verified template is deleted`);
  });
});
