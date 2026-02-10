import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * OpenSearch Tenant Service
 *
 * Handles dynamic tenant provisioning for multi-tenant analytics isolation.
 * Creates OpenSearch Security tenants, roles, role mappings, index templates,
 * seed indices, and index patterns for new organizations.
 *
 * This service is idempotent - safe to call multiple times for the same org.
 * Guarded by OPENSEARCH_SECURITY_ENABLED - no-op when security is disabled.
 */
@Injectable()
export class OpenSearchTenantService {
  private readonly logger = new Logger(OpenSearchTenantService.name);
  private readonly securityEnabled: boolean;
  private readonly opensearchUrl: string;
  private readonly dashboardsUrl: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  constructor(private readonly configService: ConfigService) {
    this.securityEnabled = this.configService.get<string>('OPENSEARCH_SECURITY_ENABLED') === 'true';
    this.opensearchUrl =
      this.configService.get<string>('OPENSEARCH_URL') || 'http://opensearch:9200';
    this.dashboardsUrl =
      this.configService.get<string>('OPENSEARCH_DASHBOARDS_URL') ||
      'http://opensearch-dashboards:5601';
    this.adminUsername = this.configService.get<string>('OPENSEARCH_ADMIN_USERNAME') || 'admin';
    this.adminPassword = this.configService.get<string>('OPENSEARCH_ADMIN_PASSWORD') || '';

    this.logger.log(
      `OpenSearch tenant service initialized (security: ${this.securityEnabled}, url: ${this.opensearchUrl})`,
    );
  }

  /**
   * Validates organization ID format.
   * Must be lowercase alphanumeric with hyphens/underscores, starting with alphanumeric.
   */
  private validateOrgId(orgId: string): boolean {
    return /^[a-z0-9][a-z0-9_-]*$/.test(orgId);
  }

  /**
   * Creates Basic Auth header for OpenSearch API calls.
   */
  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.adminUsername}:${this.adminPassword}`).toString('base64')}`;
  }

  /**
   * Fetch wrapper with retry logic for transient connection errors.
   * Bun's fetch can fail with various messages (ConnectionRefused, "typo in url",
   * "Unable to connect") during concurrent request bursts. Retry all fetch-level
   * errors (not HTTP errors) with exponential backoff.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    label: string,
  ): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fetch(url, options);
      } catch (error: any) {
        if (attempt === MAX_RETRIES) {
          throw error;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `${label}: fetch failed (attempt ${attempt}/${MAX_RETRIES}): ${error?.message}. Retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    // Unreachable, but TypeScript needs it
    throw new Error(`${label}: exhausted retries`);
  }

  /**
   * Ensures all tenant resources exist for the given organization.
   * Creates: tenant, role, role mapping, index template, seed index, index pattern.
   *
   * This method is idempotent - safe to call multiple times.
   * Returns true if all resources were created/verified successfully.
   */
  async ensureTenantExists(orgId: string): Promise<boolean> {
    // No-op when security is disabled (dev mode)
    if (!this.securityEnabled) {
      this.logger.debug(`Tenant provisioning skipped (security disabled): ${orgId}`);
      return true;
    }

    // Normalize to lowercase for consistent tenant naming
    const normalizedOrgId = orgId.toLowerCase();

    // Validate format
    if (!this.validateOrgId(normalizedOrgId)) {
      this.logger.warn(`Invalid org ID format: ${orgId}`);
      return false;
    }

    this.logger.log(`Provisioning tenant for org: ${normalizedOrgId}`);

    try {
      // Brief delay to let the nginx auth_request burst settle before
      // making outbound connections (Bun's fetch can fail during bursts)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Step 1: Create tenant
      await this.createTenant(normalizedOrgId);

      // Step 2: Create read-only role for this customer
      await this.createCustomerRole(normalizedOrgId);

      // Step 3: Create role mapping
      await this.createRoleMapping(normalizedOrgId);

      // Step 4: Create index template with field mappings
      await this.createIndexTemplate(normalizedOrgId);

      // Step 5: Create seed index so the index pattern can resolve fields
      await this.createSeedIndex(normalizedOrgId);

      // Step 6: Create index pattern in Dashboards
      await this.createIndexPattern(normalizedOrgId);

      this.logger.log(`Tenant provisioned successfully: ${normalizedOrgId}`);
      return true;
    } catch (error: any) {
      this.logger.error(
        `Failed to provision tenant ${normalizedOrgId}: ${error?.message || error}`,
      );
      return false;
    }
  }

  /**
   * Creates a tenant in OpenSearch Security.
   */
  private async createTenant(orgId: string): Promise<void> {
    const url = `${this.opensearchUrl}/_plugins/_security/api/tenants/${orgId}`;

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          description: `Tenant for organization ${orgId}`,
        }),
      },
      `createTenant(${orgId})`,
    );

    // 200 = created, 409 = already exists (both are OK)
    if (!response.ok && response.status !== 409) {
      throw new Error(`Failed to create tenant: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Tenant created/verified: ${orgId}`);
  }

  /**
   * Creates a read-only customer role for the organization.
   * Grants read-only access to security findings indices, plus the minimum
   * Dashboards/Notifications permissions required for tenant-scoped UI usage.
   */
  private async createCustomerRole(orgId: string): Promise<void> {
    const roleName = `customer_${orgId}_ro`;
    const url = `${this.opensearchUrl}/_plugins/_security/api/roles/${roleName}`;
    const tenantSavedObjectsPattern = `.kibana_*_${orgId.replace(/[^a-z0-9]/g, '')}*`;

    const roleDefinition = {
      cluster_permissions: [
        'cluster_composite_ops_ro',
        // Required for Dashboards saved objects (bulk writes to .kibana_* tenant indices)
        'indices:data/write/bulk',
        // Alerting: monitor CRUD, execution, alerts, and destinations (legacy endpoints)
        'cluster:admin/opendistro/alerting/monitor/get',
        'cluster:admin/opendistro/alerting/monitor/search',
        'cluster:admin/opendistro/alerting/monitor/write',
        'cluster:admin/opendistro/alerting/monitor/execute',
        'cluster:admin/opendistro/alerting/alerts/get',
        'cluster:admin/opendistro/alerting/alerts/ack',
        'cluster:admin/opendistro/alerting/destination/get',
        'cluster:admin/opendistro/alerting/destination/write',
        'cluster:admin/opendistro/alerting/destination/delete',
        // Notifications plugin (OpenSearch 2.x): channel features + config CRUD
        'cluster:admin/opensearch/notifications/features',
        'cluster:admin/opensearch/notifications/configs/get',
        'cluster:admin/opensearch/notifications/configs/create',
        'cluster:admin/opensearch/notifications/configs/update',
        'cluster:admin/opensearch/notifications/configs/delete',
      ],
      index_permissions: [
        {
          index_patterns: [`security-findings-${orgId}-*`],
          allowed_actions: ['read', 'indices:data/read/*'],
        },
        {
          // Tenant-scoped Dashboards saved objects index alias/index
          index_patterns: [tenantSavedObjectsPattern],
          allowed_actions: [
            'read',
            'write',
            'create_index',
            'indices:data/read/*',
            'indices:data/write/*',
            'indices:admin/mapping/put',
          ],
        },
      ],
      tenant_permissions: [
        {
          tenant_patterns: [orgId],
          allowed_actions: ['kibana_all_write'],
        },
      ],
    };

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(roleDefinition),
      },
      `createCustomerRole(${orgId})`,
    );

    if (!response.ok && response.status !== 409) {
      throw new Error(`Failed to create role: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Role created/verified: ${roleName}`);
  }

  /**
   * Creates a role mapping for the customer role.
   * Maps the role name to backend_roles so nginx proxy auth works.
   */
  private async createRoleMapping(orgId: string): Promise<void> {
    const roleName = `customer_${orgId}_ro`;
    const url = `${this.opensearchUrl}/_plugins/_security/api/rolesmapping/${roleName}`;

    const mappingDefinition = {
      backend_roles: [roleName],
      description: `Role mapping for ${orgId} read-only access`,
    };

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(mappingDefinition),
      },
      `createRoleMapping(${orgId})`,
    );

    if (!response.ok && response.status !== 409) {
      throw new Error(`Failed to create role mapping: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Role mapping created/verified: ${roleName}`);
  }

  /**
   * Creates an index template so all future security-findings-{orgId}-* indices
   * get proper field mappings automatically.
   */
  private async createIndexTemplate(orgId: string): Promise<void> {
    const templateName = `security-findings-${orgId}`;
    const url = `${this.opensearchUrl}/_index_template/${templateName}`;

    const templateDefinition = {
      index_patterns: [`security-findings-${orgId}-*`],
      template: {
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            workflow_id: { type: 'keyword' },
            workflow_name: { type: 'keyword' },
            run_id: { type: 'keyword' },
            node_ref: { type: 'keyword' },
            component_id: { type: 'keyword' },
            asset_key: { type: 'keyword' },
          },
        },
      },
      priority: 100,
    };

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(templateDefinition),
      },
      `createIndexTemplate(${orgId})`,
    );

    if (!response.ok) {
      throw new Error(`Failed to create index template: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Index template created/verified: ${templateName}`);
  }

  /**
   * Creates a seed index with explicit mappings so the Dashboards index pattern
   * can resolve fields (especially @timestamp) before any real data is ingested.
   */
  private async createSeedIndex(orgId: string): Promise<void> {
    const indexName = `security-findings-${orgId}-seed`;
    const url = `${this.opensearchUrl}/${indexName}`;

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          mappings: {
            properties: {
              '@timestamp': { type: 'date' },
              workflow_id: { type: 'keyword' },
              workflow_name: { type: 'keyword' },
              run_id: { type: 'keyword' },
              node_ref: { type: 'keyword' },
              component_id: { type: 'keyword' },
              asset_key: { type: 'keyword' },
            },
          },
        }),
      },
      `createSeedIndex(${orgId})`,
    );

    // 200 = created, 400 with "already exists" = OK
    if (!response.ok && response.status !== 400) {
      throw new Error(`Failed to create seed index: ${response.status} ${response.statusText}`);
    }

    this.logger.debug(`Seed index created/verified: ${indexName}`);
  }

  /**
   * Creates an index pattern in OpenSearch Dashboards for this tenant.
   */
  private async createIndexPattern(orgId: string): Promise<void> {
    const patternId = `security-findings-${orgId}-*`;
    const url = `${this.dashboardsUrl}/analytics/api/saved_objects/index-pattern/${encodeURIComponent(patternId)}`;

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'osd-xsrf': 'true',
          securitytenant: orgId, // Create in tenant's namespace
          'x-proxy-user': this.adminUsername, // Required for Dashboards proxy auth mode
          'x-proxy-roles': 'platform_admin',
          'x-forwarded-for': '127.0.0.1', // Required for proxy auth trust chain
        },
        body: JSON.stringify({
          attributes: {
            title: patternId,
            timeFieldName: '@timestamp',
          },
        }),
      },
      `createIndexPattern(${orgId})`,
    );

    // 200 = created, 409 = already exists (both are OK)
    if (!response.ok && response.status !== 409) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Failed to create index pattern: ${response.status} ${response.statusText} - ${body}`,
      );
    }

    this.logger.debug(`Index pattern created/verified: ${patternId}`);
  }

  /**
   * Check if security mode is enabled.
   */
  isSecurityEnabled(): boolean {
    return this.securityEnabled;
  }
}
