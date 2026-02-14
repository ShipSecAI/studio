# Template Library Architecture

## Overview

The Template Library provides a centralized repository of workflow templates that users can browse and use as starting points for their own workflows. Templates are stored in a **public** GitHub repository and synced to the application database.

### Key Features

- Browse workflow templates by category, tags, or search
- Templates stored in a public GitHub repository (no authentication needed)
- Automatic sync on backend startup
- Manual "Sync from GitHub" button for on-demand refresh
- Workflow sanitization to remove secrets before publishing
- Support for both community and official templates

---

## Publishing Flow

Templates are published via GitHub's web flow, removing the need for backend API authentication tokens.

### Step-by-Step Process

```
User                Frontend           GitHub               Backend
 |                      |                 |                    |
 |  Publish Workflow    |                 |                    |
 |--------------------->|                 |                    |
 |                      |                 |                    |
 |                      |  Open GitHub    |                    |
 |                      |  New File Page  |                    |
 |                      |---------------->|                    |
 |                      |                 |                    |
 |                      |                 |  User Creates PR   |
 |                      |                 |<-------------------|
 |                      |                 |                    |
 |                      |                 |  PR Merged         |
 |                      |<----------------|                    |
 |                      |                 |                    |
 |                      |  Admin clicks   |                    |
 |                      |  "Sync from     |                    |
 |                      |  GitHub"        |                    |
 |                      |---------------->|  Sync Templates    |
 |                      |                 |<-------------------|
 |                      |                 |                    |
 |                      |  Templates       |                    |
 |                      |  Available       |                    |
 |<---------------------|<-----------------|                    |
```

### GitHub Web Flow

1. User clicks "Publish as Template" in the UI
2. Frontend opens a pre-filled GitHub URL for creating a new file
3. User commits the file and creates a pull request
4. After review, PR is merged to the main branch
5. Admin clicks "Sync from GitHub" to pull in the new template (or waits for next backend restart)

---

## Sync Flow

Templates are fetched from a **public** GitHub repository using the GitHub API and stored in the database. No authentication token is needed.

### Sync Triggers

| Trigger          | When                            | How                                     |
| ---------------- | ------------------------------- | --------------------------------------- |
| **Startup sync** | Backend boots                   | `onModuleInit()` in `GitHubSyncService` |
| **Manual sync**  | Admin clicks "Sync from GitHub" | `POST /templates/sync`                  |

A **concurrent sync guard** prevents overlapping syncs from running simultaneously.

### Sync Process

```typescript
// Location: github-sync.service.ts

async syncTemplates() {
  // 0. Guard against concurrent syncs
  if (this.isSyncing) return;

  // 1. Fetch repository config from environment
  const { owner, repo, branch } = getRepoConfig();

  // 2. List all files in /templates directory
  const files = await fetchDirectory('templates');

  // 3. For each JSON file:
  for (const file of files) {
    // a. Fetch file content
    const content = await fetchFileContent(file.path);

    // b. Parse and validate template structure
    const template = parseTemplateJson(content);

    // c. Upsert to database (by repository + path)
    await templatesRepository.upsert({
      name: template._metadata.name,
      manifest: template.manifest,
      graph: template.graph,
      // ... other fields
    });
  }

  return { synced, failed, total };
}
```

### Template JSON Structure

Each template file in GitHub must follow this structure:

```json
{
  "_metadata": {
    "name": "My Workflow Template",
    "description": "Does something useful",
    "category": "automation",
    "tags": ["api", "integration"],
    "author": "username",
    "version": "1.0.0"
  },
  "manifest": {
    "name": "My Workflow Template",
    "version": "1.0.0",
    "entryPoint": "trigger_1",
    "nodeCount": 5,
    "edgeCount": 4
  },
  "graph": {
    "nodes": [...],
    "edges": [...]
  },
  "requiredSecrets": [
    {
      "name": "api_key",
      "type": "string",
      "description": "API key for service"
    }
  ]
}
```

---

## Auto-Sync: Startup

The backend automatically syncs templates on startup:

1. **On startup** -- immediate sync when the backend boots

### Implementation

```typescript
// Location: github-sync.service.ts

@Injectable()
export class GitHubSyncService implements OnModuleInit {
  private isSyncing = false;

  async onModuleInit(): Promise<void> {
    // 1. Log repo config
    const { owner, repo, branch } = this.getRepoConfig();
    this.logger.log(`Template repo: ${owner}/${repo} (branch: ${branch})`);

    // 2. Initial sync on startup
    const result = await this.syncTemplates();
  }
}
```

### Behavior

- Triggers when `TemplatesModule` is initialized
- Runs automatically on backend startup
- Logs results but doesn't fail the application if sync errors occur
- Concurrent sync guard prevents overlapping runs

### How PR Merge -> Database Works

This is the key flow for when a user creates a PR and an admin merges it:

```
1. User publishes template -> Frontend opens GitHub web flow
2. User creates PR on GitHub with template JSON file
3. Admin reviews and merges PR into main branch
4. Admin clicks "Sync from GitHub" in the dashboard
   a. Fetches /templates directory listing from GitHub API
   b. Finds the new .json file from the merged PR
   c. Downloads and parses the template content
   d. Upserts into the database (matched by repository + path)
5. Template appears in the dashboard on next page load
```

---

## Database Schema

### templates Table

Stores synced workflow templates.

| Column             | Type         | Description                                  |
| ------------------ | ------------ | -------------------------------------------- |
| `id`               | uuid         | Primary key                                  |
| `name`             | varchar(255) | Template name                                |
| `description`      | text         | Template description                         |
| `category`         | varchar(100) | Category (e.g., "automation", "integration") |
| `tags`             | jsonb        | Array of tags                                |
| `author`           | varchar(255) | Author username                              |
| `repository`       | varchar(255) | GitHub repo (e.g., "org/templates")          |
| `path`             | varchar(500) | Path to template in repo                     |
| `branch`           | varchar(100) | Git branch (default: "main")                 |
| `version`          | varchar(50)  | Template version                             |
| `commit_sha`       | varchar(100) | Git commit SHA                               |
| `manifest`         | jsonb        | Template metadata                            |
| `graph`            | jsonb        | Sanitized workflow graph                     |
| `required_secrets` | jsonb        | Required secrets for template                |
| `popularity`       | integer      | Usage counter                                |
| `is_official`      | boolean      | Official template flag                       |
| `is_verified`      | boolean      | Verified template flag                       |
| `is_active`        | boolean      | Active status                                |
| `created_at`       | timestamp    | Creation timestamp                           |
| `updated_at`       | timestamp    | Last update timestamp                        |

### templates_submissions Table

Tracks PR-based template submissions (for future workflow).

| Column            | Type         | Description                              |
| ----------------- | ------------ | ---------------------------------------- |
| `id`              | uuid         | Primary key                              |
| `template_name`   | varchar(255) | Template name                            |
| `description`     | text         | Description                              |
| `category`        | varchar(100) | Category                                 |
| `repository`      | varchar(255) | GitHub repo                              |
| `branch`          | varchar(100) | Git branch                               |
| `path`            | varchar(500) | Path to template                         |
| `commit_sha`      | varchar(100) | Git commit SHA                           |
| `pr_number`       | integer      | Pull request number                      |
| `pr_url`          | varchar(500) | Pull request URL                         |
| `status`          | varchar(50)  | Status: pending/approved/rejected/merged |
| `submitted_by`    | varchar(191) | Submitter user ID                        |
| `organization_id` | varchar(191) | Organization ID                          |
| `manifest`        | jsonb        | Template metadata                        |
| `graph`           | jsonb        | Workflow graph                           |
| `feedback`        | text         | Review feedback                          |
| `reviewed_by`     | varchar(191) | Reviewer user ID                         |
| `reviewed_at`     | timestamp    | Review timestamp                         |
| `created_at`      | timestamp    | Creation timestamp                       |
| `updated_at`      | timestamp    | Last update timestamp                    |

---

## API Endpoints

### Public Endpoints

#### GET /templates

List all templates with optional filters.

**Query Parameters:**

- `category` (optional) - Filter by category
- `search` (optional) - Search in name and description
- `tags` (optional) - Comma-separated list of tags

**Response:** Array of template objects

```bash
curl http://localhost:3211/templates?category=automation
```

#### GET /templates/categories

List all categories with template counts.

**Response:** Array of `{ category, count }` objects

```bash
curl http://localhost:3211/templates/categories
```

#### GET /templates/tags

List all available tags.

**Response:** Array of tag strings

```bash
curl http://localhost:3211/templates/tags
```

#### GET /templates/repo-info

Get GitHub repository information.

**Response:** `{ owner, repo, branch, url }`

```bash
curl http://localhost:3211/templates/repo-info
```

#### GET /templates/:id

Get template details by ID.

**Response:** Template object with full details

```bash
curl http://localhost:3211/templates/{id}
```

### Authenticated Endpoints

#### GET /templates/my

Get current user's submitted templates.

**Response:** Array of submission objects

```bash
curl -H "Authorization: Bearer {token}" http://localhost:3211/templates/my
```

#### GET /templates/submissions

Get template submissions for current user.

**Response:** Array of submission objects

```bash
curl -H "Authorization: Bearer {token}" http://localhost:3211/templates/submissions
```

#### POST /templates/publish

Validate a workflow for template submission.

**Request Body:**

```json
{
  "workflowId": "uuid",
  "name": "Template Name",
  "description": "Description",
  "category": "automation",
  "tags": ["tag1", "tag2"],
  "author": "username"
}
```

**Note:** This endpoint currently validates but does not create PRs. Use GitHub web flow instead.

#### POST /templates/:id/use

Use a template to create a new workflow.

**Request Body:**

```json
{
  "workflowName": "My Workflow",
  "secretMappings": {
    "api_key": "secret_reference"
  }
}
```

**Note:** Currently disabled.

### Admin Endpoints

#### POST /templates/sync

Manually trigger template sync from GitHub.

**Response:** Sync result with synced/failed counts

```bash
curl -X POST -H "Authorization: Bearer {admin_token}" \
  http://localhost:3211/templates/sync
```

**Response Example:**

```json
{
  "synced": ["template1", "template2"],
  "failed": [
    {
      "path": "templates/invalid.json",
      "error": "Invalid template format"
    }
  ],
  "total": 2
}
```

---

## Environment Variables

### Required Variables

| Variable               | Description                                   | Example                          |
| ---------------------- | --------------------------------------------- | -------------------------------- |
| `GITHUB_TEMPLATE_REPO` | Public GitHub repository containing templates | `krishna9358/workflow-templates` |

### Optional Variables

| Variable                 | Description             | Default |
| ------------------------ | ----------------------- | ------- |
| `GITHUB_TEMPLATE_BRANCH` | Git branch to sync from | `main`  |

### Example Configuration

```bash
# .env or .env.docker

# GitHub template repository (must be public)
GITHUB_TEMPLATE_REPO=krishna9358/workflow-templates
GITHUB_TEMPLATE_BRANCH=main
```

---

## Architecture Diagram

```
+-------------------------------------------------------------------------+
|                           Template Library                               |
+-------------------------------------------------------------------------+

    +--------------+
    |   Frontend   |
    |              |
    | - Browse     |
    | - Search     |
    | - Publish    |
    +------+-------+
           | HTTP
           v
    +--------------------------------------------------------------------+
    |                        Backend API                                 |
    |                                                                     |
    |  +-----------------+    +-----------------+                        |
    |  | Templates       |    | GitHub Sync     |                        |
    |  | Controller      |<---| Service         |                        |
    |  +--------+--------+    +--------+--------+                        |
    |           |                     |                                  |
    |           v                     v                                  |
    |  +-----------------+    +-----------------+                        |
    |  | Template        |    | Workflow        |                        |
    |  | Service         |    | Sanitization    |                        |
    |  +--------+--------+    +-----------------+                        |
    |           |                                                         |
    |           v                                                         |
    |  +-----------------+                                                |
    |  | Templates       |                                                |
    |  | Repository      |                                                |
    |  +--------+--------+                                                |
    +-----------+--------------------------------------------------------|
                | Drizzle ORM
                v
    +---------------------------------------------------------------------+
    |                        PostgreSQL                                    |
    |                                                                     |
    |  +---------------+              +-----------------------------+    |
    |  | templates     |              | templates_submissions       |    |
    |  | table         |              | table                       |    |
    |  +---------------+              +-----------------------------+    |
    +---------------------------------------------------------------------+

    +---------------------------------------------------------------------+
    |                        GitHub Repository (public)                    |
    |                                                                     |
    |  /templates/                                                         |
    |    +-- automation-template.json                                     |
    |    +-- integration-template.json                                    |
    |    +-- monitoring-template.json                                     |
    +---------------------------------------------------------------------+
                    ^
                    | GitHub API (unauthenticated, public repo)
                    |
    +---------------+-----------------------------------------------------+
    |                     Sync Triggers                                    |
    |                                                                     |
    |  1. Startup sync  --> onModuleInit() --> syncTemplates()            |
    |  2. Manual        --> POST /templates/sync                          |
    +---------------------------------------------------------------------+
```

### Data Flow

#### Template Sync Flow

```
Trigger (startup / manual)
    |
    +-> Check concurrent sync guard (skip if already syncing)
    |
    +-> Fetch templates/ directory from GitHub API
    |
    +-> For each JSON file:
    |   |
    |   +-> Fetch file content
    |   |
    |   +-> Parse and validate template structure
    |   |
    |   +-> Upsert to database (by repository + path)
    |
    +-> Return sync results { synced, failed, total }
```

#### Template Browse Flow

```
Frontend Request
    |
    +-> GET /templates?category=automation
    |
    +-> TemplatesController.listTemplates()
    |
    +-> TemplateService.listTemplates()
    |
    +-> TemplatesRepository.findAll()
    |
    +-> Database Query (Drizzle ORM)
    |
    +-> Return templates array
```

#### Publish Flow (GitHub Web Flow)

```
User Action
    |
    +-> Click "Publish as Template" in Workflow Builder
    |
    +-> Fill in metadata: name, description, category, tags, author
    |
    +-> Frontend sanitizes workflow graph (removes secrets)
    |
    +-> Frontend generates template JSON with metadata + sanitized graph
    |
    +-> Frontend opens GitHub URL in new tab:
    |       https://github.com/{repo}/new/{branch}
    |       ?filename=templates/{name}.json
    |       &value={template_content}
    |       &quick_pull=1
    |
    +-> User reviews content on GitHub, clicks "Propose new file"
    |
    +-> User creates Pull Request for admin review
    |
    +-> Admin reviews and merges PR
    |
    +-> Admin clicks "Sync from GitHub" in the dashboard
    |       (or template is picked up on next backend restart)
    |
    +-> Template appears in dashboard
```

---

## Services

### GitHubSyncService

**Purpose:** Fetch templates from a public GitHub repo and sync to database

**Key Methods:**

- `syncTemplates()` - Main sync operation (with concurrent guard)
- `getRepoConfig()` - Read env vars (`GITHUB_TEMPLATE_REPO`, `GITHUB_TEMPLATE_BRANCH`)
- `fetchDirectory(path)` - List directory contents from GitHub API
- `fetchFileContent(path)` - Get file content from GitHub API
- `parseTemplateJson(content, path)` - Validate template structure
- `getRepositoryInfo()` - Get repo configuration

**Lifecycle:**

- `OnModuleInit` -- initial sync on startup

### TemplateService

**Purpose:** Business logic for template operations

**Key Methods:**

- `listTemplates(filters)` - Get filtered template list
- `getTemplateById(id)` - Get single template
- `getMyTemplates(userId)` - Get user's templates
- `getCategories()` - Get all categories
- `getTags()` - Get all tags

### WorkflowSanitizationService

**Purpose:** Remove secrets from workflows before publishing

**Key Methods:**

- `sanitizeWorkflow(graph)` - Remove secret references
- `validateSanitizedGraph(graph)` - Validate sanitized workflow
- `generateManifest(params)` - Generate template manifest

**Secret Detection Patterns:**

- `connectionType.kind === 'secret'` or `'primitive_secret'`
- Fields named `secretId`, `secret_name`, or `apiKey`
- String patterns: `{{secret:*}}` or `{{secrets.*}}`

### TemplatesRepository

**Purpose:** Database operations for templates

**Key Methods:**

- `findAll(filters)` - Find active templates
- `findById(id)` - Find by primary key
- `findByRepoAndPath(repository, path)` - Find by location
- `upsert(template)` - Create or update template
- `incrementPopularity(id)` - Track usage
- `getCategories()` - Get categories with counts
- `getTags()` - Get all tags

---

## Security Considerations

### Secret Sanitization

All workflows are sanitized before being stored as templates:

1. **Secret Detection:** Service scans graph for secret references
2. **Removal:** Secrets are replaced with placeholders
3. **Documentation:** Removed secrets are documented in `requiredSecrets`
4. **Validation:** Sanitized graph is validated for correctness

### Public API Access

Template browsing endpoints are public (no authentication required):

- `GET /templates`
- `GET /templates/:id`
- `GET /templates/categories`
- `GET /templates/tags`
- `GET /templates/repo-info`

This allows templates to be browsed without login, improving discoverability.

---

## Error Handling

### Sync Failures

Template sync is resilient to failures:

- Individual file failures don't stop the sync
- Failed templates are logged and returned in the `failed` array
- On startup, sync failures don't prevent application from starting

### Invalid Templates

Templates that fail validation are:

- Logged with failure reason
- Included in sync results' `failed` array
- Not stored in the database

Common validation failures:

- Missing `_metadata.name`
- Missing `manifest` object
- Missing `graph` object
- Invalid JSON structure

---

## Future Enhancements

### Planned Features

1. **Official Templates:** Mark templates from verified authors
2. **Template Ratings:** Allow users to rate and review templates
3. **Usage Analytics:** Track template usage patterns
4. **Versioning:** Support multiple versions per template
5. **Template Dependencies:** Allow templates to reference other templates
6. **Automated Testing:** Test templates before syncing

### Scalability Considerations

- **Caching:** Add Redis caching for frequently accessed templates
- **Pagination:** Add cursor-based pagination for template lists
- **Search:** Implement full-text search with PostgreSQL or OpenSearch
- **CDN:** Cache template files in CDN for faster access

---

## Troubleshooting

### Templates Not Showing

1. **Check `GITHUB_TEMPLATE_REPO`** in `.env` -- must match your actual public repo (e.g., `krishna9358/workflow-templates`)
2. **Ensure the repo is public** -- the sync uses unauthenticated GitHub API calls
3. Check branch name in `GITHUB_TEMPLATE_BRANCH`
4. Review backend logs for sync errors (look for `GitHubSyncService` messages)
5. Check the startup log: `Template repo: owner/repo (branch: main)`
6. Manually trigger sync: `POST /templates/sync` (requires admin auth)
7. Click "Sync from GitHub" button in the UI

### Common Errors

| Error                            | Cause                              | Fix                                                         |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `Directory not found: templates` | Wrong repo name or repo is private | Verify `GITHUB_TEMPLATE_REPO` and ensure the repo is public |
| `GitHub API error: 404`          | Repo doesn't exist or is private   | Check repo name and ensure it is public                     |
| `GitHub API error: 403`          | Rate limit exceeded                | Wait 1 hour (unauthenticated limit is 60 req/hr)            |
| `Sync already in progress`       | Concurrent sync guard triggered    | Normal behavior -- wait for current sync to finish          |

### Sync Fails on Startup

- Check network connectivity to GitHub API
- Ensure the repository is public
- Verify API rate limits (60 requests/hr for unauthenticated access)
- Review error logs in backend output

---

## Related Files

```
backend/src/templates/
+-- templates.module.ts           # Module definition
+-- templates.controller.ts       # HTTP endpoints
+-- templates.service.ts          # Business logic
+-- github-sync.service.ts        # GitHub API integration
+-- workflow-sanitization.service.ts  # Secret removal
+-- templates.repository.ts       # Database operations
+-- ARCHITECTURE.md               # This file

backend/src/database/schema/
+-- templates.ts                  # Database schema definitions

frontend/src/features/templates/
+-- components/                   # Template UI components
+-- hooks/                        # Custom React hooks
+-- TemplateLibrary.tsx           # Main page
```

---

## Version History

- **v1.2.0** - Simplified to startup sync + manual sync
  - Removed webhook controller and webhook-based sync
  - Removed `GITHUB_TEMPLATE_TOKEN` and private repo support (repo must be public)
  - Removed periodic sync (`setInterval`, `GITHUB_SYNC_INTERVAL_MS`, `OnModuleDestroy`)
  - Removed `getHeaders()` method and `Authorization` header logic
  - Architecture is now: startup sync + manual "Sync from GitHub" button
  - Only 2 env vars: `GITHUB_TEMPLATE_REPO` and `GITHUB_TEMPLATE_BRANCH`

- **v1.1.0** - Private repo support + periodic sync
  - Added `GITHUB_TEMPLATE_TOKEN` auth for private repositories
  - Added periodic sync (every 5 min) via `setInterval`
  - Added concurrent sync guard to prevent overlapping syncs
  - Fixed `findAll()` query composition (filters + sorting now work correctly)
  - Fixed `.env` repo configuration (was pointing to wrong repo)
  - Improved startup logging with repo config and auth status
  - Configurable sync interval via `GITHUB_SYNC_INTERVAL_MS`

- **v1.0.0** - Initial implementation with GitHub web flow
  - Removed Octokit dependency
  - Implemented startup sync via OnModuleInit
  - Secret sanitization for workflow graphs

---

## Support

For issues or questions about the Template Library:

1. Check this documentation first
2. Review backend logs for error messages
3. Verify environment variables are set correctly
4. Test GitHub repository access manually
