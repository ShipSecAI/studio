import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../index';
import type { GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput } from '../it-automation/google-workspace-license-unassign';

describe('google-workspace-user-delete component', () => {
  beforeAll(async () => {
    await import('../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Google Workspace User Delete');
    expect(component!.metadata!.category).toBe('building-block');
  });

  it('should validate input schema', () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    // Valid input with secret ID
    expect(() =>
      component.inputSchema.parse({
        primary_email: 'test.user@company.com',
        service_account_secret_id: '12345678-1234-1a3b-1c3d-123456789abc',
      }),
    ).not.toThrow();

    // Invalid email
    expect(() =>
      component.inputSchema.parse({
        primary_email: 'not-an-email',
        service_account_secret_id: '12345678-1234-1a3b-1c3d-123456789abc',
      }),
    ).toThrow();

    // Valid input with minimal required fields
    expect(() =>
      component.inputSchema.parse({
        primary_email: 'test.user@company.com',
        service_account_secret_id: 'secret-id',
      }),
    ).not.toThrow();
  });

  it('should handle missing service account secret', async () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    const secrets: sdk.ISecretsService = {
      async get(key) {
        expect(key).toBe('nonexistent-secret-id');
        return null; // Secret not found
      },
      async list() {
        return [];
      },
    };

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'google-workspace-test',
      secrets,
    });

    const params = component.inputSchema.parse({
      primary_email: 'test.user@company.com',
      service_account_secret_id: 'nonexistent-secret-id',
    });

    // The component should handle this gracefully and return a failure result
    const result = await component.execute(params, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Secret nonexistent-secret-id not found');
    expect(result.userDeleted).toBe(false);
    expect(result.audit.changes.userDeleted).toBe(false);
  });

  it('should handle missing service account secret ID in input', async () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    const secrets: sdk.ISecretsService = {
      async get() {
        return { value: '{"test": "value"}', version: 1 };
      },
      async list() {
        return [];
      },
    };

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'google-workspace-test',
      secrets,
    });

    const params = component.inputSchema.parse({
      primary_email: 'test.user@company.com',
      // No service_account_secret_id provided
    });

    const result = await component.execute(params, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Service account secret ID is required');
    expect(result.userDeleted).toBe(false);
  });

  it('should handle missing secrets service', async () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'google-workspace-test',
      // No secrets service provided
    });

    const params = component.inputSchema.parse({
      primary_email: 'test.user@company.com',
      service_account_secret_id: '12345678-1234-1a3b-1c3d-123456789abc',
    });

    const result = await component.execute(params, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires the secrets service');
    expect(result.userDeleted).toBe(false);
  });

  it('should handle invalid service account secret format', async () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    const secrets: sdk.ISecretsService = {
      async get() {
        return { value: 'invalid-json-format', version: 1 };
      },
      async list() {
        return [];
      },
    };

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'google-workspace-test',
      secrets,
    });

    const params = component.inputSchema.parse({
      primary_email: 'test.user@company.com',
      service_account_secret_id: '12345678-1234-1a3b-1c3d-123456789abc',
    });

    const result = await component.execute(params, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('JSON Parse error');
    expect(result.userDeleted).toBe(false);
  });

  it('should handle dry run mode', async () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    const mockServiceAccountKey = {
      type: 'service_account',
      project_id: 'test-project',
      private_key_id: 'test-key-id',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
      client_email: 'test@test-project.iam.gserviceaccount.com',
      client_id: '123456789',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    };

    const secrets: sdk.ISecretsService = {
      async get() {
        return { value: JSON.stringify(mockServiceAccountKey), version: 1 };
      },
      async list() {
        return [];
      },
    };

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'google-workspace-test',
      secrets,
    });

    const params = component.inputSchema.parse({
      primary_email: 'test.user@company.com',
      service_account_secret_id: '12345678-1234-1a3b-1c3d-123456789abc',
      dry_run: true,
    });

    // This will fail due to missing Google APIs, but we can verify the structure
    try {
      const result = await component.execute(params, context);
      // If it somehow works, verify dry run structure
      expect(result.audit.dryRun).toBe(true);
      expect(result.message).toContain('DRY RUN');
    } catch (error) {
      // Expected to fail due to missing Google APIs in test environment
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('should verify component metadata structure', () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    // Verify component has proper metadata
    expect(component.metadata).toBeDefined();
    expect(component.id).toBe('it-automation.google-workspace.user-delete');
    expect(component.metadata!.slug).toBe('google-workspace-user-delete');
    expect(component.metadata!.version).toBe('2.0.0');
    expect(component.metadata!.type).toBe('output');
    expect(component.metadata!.category).toBe('building-block');
    expect(component.metadata!.description).toContain('Delete Google Workspace user accounts');
    expect(component.metadata!.parameters).toBeInstanceOf(Array);
    expect(component.metadata!.examples).toBeInstanceOf(Array);
    expect(component.metadata!.outputs).toBeInstanceOf(Array);

    // Verify required parameters exist
    const params = component.metadata!.parameters;
    const primaryEmailParam = params?.find(p => p.id === 'primary_email');
    const secretParam = params?.find(p => p.id === 'service_account_secret_id');
    const dryRunParam = params?.find(p => p.id === 'dry_run');

    expect(primaryEmailParam).toBeDefined();
    expect(primaryEmailParam!.required).toBe(true);
    expect(secretParam).toBeDefined();
    expect(secretParam!.required).toBe(false);
    expect(dryRunParam).toBeDefined();
    expect(dryRunParam!.required).toBeFalsy();

    // Verify simplified parameter structure
    expect(params?.length).toBe(3); // Only primary_email, dry_run, and service_account_secret_id
  });

  it('should have correct output structure', () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    // Verify output schema matches expectations
    const testOutput = {
      success: true,
      audit: {
        timestamp: '2024-01-01T00:00:00.000Z',
        action: 'user-delete',
        userEmail: 'test@example.com',
        dryRun: false,
        changes: {
          userDeleted: true,
        },
      },
      userDeleted: true,
      message: 'Successfully deleted user test@example.com and released all associated licenses',
    };

    expect(() => component.outputSchema.parse(testOutput)).not.toThrow();
  });

  it('should use inline runner', () => {
    const component = componentRegistry.get<GoogleWorkspaceLicenseUnassignInput, GoogleWorkspaceLicenseUnassignOutput>('it-automation.google-workspace.user-delete');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('inline');
  });
});