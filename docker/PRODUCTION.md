# Production Deployment Guide

This guide covers deploying the analytics infrastructure with security and SaaS multitenancy enabled.

## Overview

| Environment | Security | Multitenancy | Use Case                          |
| ----------- | -------- | ------------ | --------------------------------- |
| Development | Disabled | No           | Local development, fast iteration |
| Production  | Enabled  | Yes (Strict) | Multi-tenant SaaS deployment      |

## SaaS Multitenancy Model

**Key Principles:**

- Each customer gets complete data isolation by default
- No shared dashboards - sharing is explicitly opt-in
- Each customer has their own index pattern (`{customer_id}-*`)
- Tenants, roles, and users are created dynamically via backend

**Index Naming Convention:**

```
{customer_id}-analytics-*     # Analytics data
{customer_id}-workflows-*     # Workflow results
{customer_id}-scans-*         # Scan results
```

## Quick Start (Production)

```bash
# 1. Generate TLS certificates
./scripts/generate-certs.sh

# 2. Set required environment variables
export OPENSEARCH_ADMIN_PASSWORD="your-secure-admin-password"
export OPENSEARCH_DASHBOARDS_PASSWORD="your-secure-dashboards-password"

# 3. Start with production configuration
docker compose -f docker-compose.infra.yml -f docker-compose.prod.yml up -d
```

## Files Overview

| File                             | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `docker-compose.infra.yml`       | Base infrastructure (dev mode, PM2 on host)         |
| `docker-compose.full.yml`        | Full stack containerized (simple prod, no security) |
| `docker-compose.prod.yml`        | Security overlay (combines with infra.yml for SaaS) |
| `nginx/nginx.dev.conf`           | Nginx routing to host (PM2 services)                |
| `nginx/nginx.prod.conf`          | Nginx routing to containers                         |
| `opensearch-dashboards.yml`      | Dashboards config (dev)                             |
| `opensearch-dashboards.prod.yml` | Dashboards config (prod with multitenancy)          |
| `scripts/generate-certs.sh`      | TLS certificate generator                           |
| `opensearch-security/`           | Security plugin configuration                       |
| `certs/`                         | Generated certificates (gitignored)                 |

See [README.md](README.md) for detailed usage of each compose file.

## Customer Provisioning (Backend Integration)

When a new customer is onboarded, the backend must create:

### 1. Create Customer Tenant

```bash
PUT /_plugins/_security/api/tenants/{customer_id}
{
  "description": "Tenant for customer {customer_id}"
}
```

### 2. Create Customer Role (with Index Isolation)

```bash
PUT /_plugins/_security/api/roles/customer_{customer_id}_rw
{
  "cluster_permissions": ["cluster_composite_ops_ro"],
  "index_permissions": [{
    "index_patterns": ["{customer_id}-*"],
    "allowed_actions": ["read", "write", "create_index", "indices:data/read/*", "indices:data/write/*"]
  }],
  "tenant_permissions": [{
    "tenant_patterns": ["{customer_id}"],
    "allowed_actions": ["kibana_all_write"]
  }]
}
```

### 3. Create Customer User

```bash
PUT /_plugins/_security/api/internalusers/{user_email}
{
  "password": "hashed_password",
  "backend_roles": ["customer_{customer_id}"],
  "attributes": {
    "customer_id": "{customer_id}",
    "email": "{user_email}"
  }
}
```

### 4. Map User to Role

```bash
PUT /_plugins/_security/api/rolesmapping/customer_{customer_id}_rw
{
  "users": ["{user_email}"],
  "backend_roles": ["customer_{customer_id}"]
}
```

## Security Configuration

### TLS Certificates

The `scripts/generate-certs.sh` script generates:

- **root-ca.pem** - Root certificate authority
- **node.pem / node-key.pem** - OpenSearch node certificate
- **admin.pem / admin-key.pem** - Admin certificate for cluster management

For production:

- Use a proper CA (Let's Encrypt, internal PKI)
- Store private keys in a secrets manager (Vault, AWS Secrets Manager)
- Set up certificate rotation before expiration

### System Users

Only two system users are defined (in `internal_users.yml`):

| User           | Purpose                                        |
| -------------- | ---------------------------------------------- |
| `admin`        | Platform operations - DO NOT give to customers |
| `kibanaserver` | Dashboards backend communication               |

Customer users are created dynamically via the Security REST API.

### Password Hashing

Generate password hashes for users:

```bash
docker run -it opensearchproject/opensearch:2.11.1 \
  /usr/share/opensearch/plugins/opensearch-security/tools/hash.sh -p YOUR_PASSWORD
```

## Data Isolation Verification

After setting up a customer, verify isolation:

```bash
# As customer user - should only see their data
curl -u user@customer.com:password \
  "https://localhost:9200/{customer_id}-*/_search"

# Should NOT be able to access other customer's data (403 Forbidden)
curl -u user@customer.com:password \
  "https://localhost:9200/other_customer-*/_search"
```

## Environment Variables

| Variable                         | Required | Description                |
| -------------------------------- | -------- | -------------------------- |
| `OPENSEARCH_ADMIN_PASSWORD`      | Yes      | Admin user password        |
| `OPENSEARCH_DASHBOARDS_PASSWORD` | Yes      | kibanaserver user password |

## Updating Security Configuration

After modifying security files, apply changes:

```bash
docker exec -it shipsec-opensearch \
  /usr/share/opensearch/plugins/opensearch-security/tools/securityadmin.sh \
  -cd /usr/share/opensearch/config/opensearch-security \
  -icl -nhnv \
  -cacert /usr/share/opensearch/config/certs/root-ca.pem \
  -cert /usr/share/opensearch/config/certs/admin.pem \
  -key /usr/share/opensearch/config/certs/admin-key.pem
```

## Troubleshooting

### Container fails to start

Check logs:

```bash
docker logs shipsec-opensearch
docker logs shipsec-opensearch-dashboards
```

Common issues:

- Certificate permissions (should be 600 for keys, 644 for certs)
- Missing environment variables
- Incorrect certificate paths

### Cannot connect to secured cluster

```bash
# Test with curl
curl -k -u admin:PASSWORD https://localhost:9200/_cluster/health
```

### Customer cannot see their dashboards

1. Verify tenant was created for customer
2. Check user has correct backend_roles
3. Verify role has correct tenant_permissions
4. Check index pattern matches customer's indices

### Cross-tenant data leak

If a customer can see another customer's data:

1. Verify index_patterns in role are correctly scoped to `{customer_id}-*`
2. Check role mapping is correct
3. Ensure user's backend_roles match their customer ID

## Switching Between Environments

**Development (no security):**

```bash
docker compose -f docker-compose.infra.yml up -d
```

**Production (with security):**

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.prod.yml up -d
```
