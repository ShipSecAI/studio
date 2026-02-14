# Template Library Feature

## Overview

The Template Library feature allows users to share and discover workflow templates. Users can publish their workflows as templates, which are submitted via GitHub PR to a templates repository. Other users can browse and use these templates to quickly create new workflows.

## Architecture

### Backend Components

1. **Templates Module** (`backend/src/templates/`)
   - `templates.module.ts` - NestJS module configuration
   - `templates.controller.ts` - API endpoints
   - `templates.service.ts` - Business logic
   - `templates.repository.ts` - Database operations
   - `github-template.service.ts` - GitHub API integration
   - `workflow-sanitization.service.ts` - Secret sanitization

2. **Database Schema** (`backend/src/database/schema/templates.ts`)
   - `templates` table - Stores template metadata (cached from GitHub)
   - `templates_submissions` table - Tracks PR-based submissions

### Frontend Components

1. **Pages**
   - `TemplateLibraryPage.tsx` - Main template library page with filtering

2. **Features**
   - `UseTemplateModal.tsx` - Modal for using a template
   - `PublishTemplateModal.tsx` - Modal for publishing a workflow as template

3. **Store**
   - `templateStore.ts` - Zustand store for template state management

4. **API**
   - Extended `api.ts` with templates API client

## API Endpoints

### Public Endpoints

- `GET /templates` - List all templates with optional filters
  - Query params: `category`, `search`, `tags`
- `GET /templates/:id` - Get template details
- `GET /templates/categories` - Get available categories
- `GET /templates/tags` - Get available tags

### Admin Endpoints

- `POST /templates/publish` - Publish workflow as template (creates PR)
- `POST /templates/:id/use` - Use template to create new workflow
- `POST /templates/sync` - Sync templates from GitHub repository
- `GET /templates/my` - Get user's submitted templates
- `GET /templates/submissions` - Get template submissions

## Environment Variables

### Required

```bash
# GitHub Configuration
GITHUB_TEMPLATE_REPO=org/templates-repo
GITHUB_TOKEN=ghp_xxx # GitHub PAT with repo permissions

# GitHub OAuth (optional, for user authentication)
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

### GitHub Token Permissions

The GitHub personal access token needs the following permissions:
- `repo` (full control of private repositories)
- `pull_requests` (to create PRs)

## Workflow Sanitization

When publishing a workflow as a template, the system:

1. **Removes secret references** - All secret values are removed from the workflow graph
2. **Creates secret placeholders** - Each removed secret is documented as a required secret
3. **Validates the graph** - Ensures the sanitized graph is still valid
4. **Generates a manifest** - Creates metadata about the template

### Required Secrets Schema

```typescript
{
  name: string;        // Secret name
  type: string;        // Secret type (e.g., "api_key", "token")
  description?: string; // What this secret is for
  placeholder?: string; // Example format
}
```

## Template Manifest

Each template has a manifest with the following structure:

```typescript
{
  name: string;           // Template name
  description?: string;   // Template description
  version?: string;       // Version
  author?: string;        // Author name/org
  category?: string;      // Category
  tags?: string[];        // Tags
  requiredSecrets?: RequiredSecret[]; // Required secrets
  entryPoint?: string;    // Entry point reference
}
```

## GitHub PR Workflow

### Publishing a Template

1. User clicks "Publish as Template" in Workflow Builder
2. User fills in template metadata (name, description, category, tags, author)
3. Backend sanitizes the workflow graph (removes secrets)
4. Backend creates a new branch in the templates repository
5. Backend commits the template JSON files
6. Backend creates a pull request
7. User receives PR URL for tracking

### Template File Structure

```
templates/
  ├── security-scanner.json
  ├── incident-response.json
  └── compliance-check.json
```

Each template file contains:

```json
{
  "manifest": { ... },
  "graph": { ... },
  "requiredSecrets": [ ... ]
}
```

## Setup Instructions

### 1. Create Templates Repository

1. Create a new GitHub repository for templates
2. Configure repository settings (private/public based on your needs)
3. Add the repository URL to environment variables

### 2. Configure GitHub App

1. Create a GitHub Personal Access Token or GitHub App
2. Grant necessary permissions
3. Add credentials to environment variables

### 3. Run Database Migration

```bash
# The migration file is at:
backend/drizzle/0020_create-templates.sql
```

### 4. Add Templates Module

The TemplatesModule is already imported in `backend/src/app.module.ts`.

## Usage

### For Users

1. Browse templates in the Template Library
2. Filter by category, search, or tags
3. Click "Use Template" on a template
4. Configure required secrets
5. Create workflow from template

### For Publishers

1. Create a workflow in the Workflow Builder
2. Click "Publish as Template" in the top bar
3. Fill in template metadata
4. Submit - a PR will be created
5. Wait for PR review and merge
6. Template appears in library after sync

## Template Types

### Community Templates
- Submitted by users
- Reviewed before appearing in library
- Tagged with relevant categories

### Official Templates
- Created and maintained by ShipSec team
- Verified and tested
- Marked with "Official" badge

### Enterprise Templates
- Organization-specific templates
- Private to organization
- Custom workflows for internal use

## Troubleshooting

### Templates not appearing after PR merge

1. Run the sync endpoint: `POST /templates/sync`
2. Check the GitHub repository configuration
3. Verify the backend has access to the repository

### Secrets not being sanitized

1. Check the workflow graph structure
2. Verify secret references follow the expected format
3. Check backend logs for sanitization errors

### GitHub PR creation failing

1. Verify `GITHUB_TOKEN` has correct permissions
2. Check `GITHUB_TEMPLATE_REPO` is correct
3. Ensure the repository exists and is accessible
4. Check GitHub rate limits

## Development

### Adding New Template Categories

Edit `TEMPLATE_CATEGORIES` in `PublishTemplateModal.tsx`:

```typescript
const TEMPLATE_CATEGORIES = [
  'Security',
  'Monitoring',
  'Compliance',
  'Incident Response',
  'Data Processing',
  'Integration',
  'Automation',
  'Reporting',
  'Testing',
  'Other',
  // Add your category here
];
```

### Customizing Template Display

Template cards are rendered in `TemplateCard` component within `TemplateLibraryPage.tsx`.

### Modifying Sanitization Rules

Edit `workflow-sanitization.service.ts` to customize how secrets are detected and removed.

## Security Considerations

1. **Secret Sanitization** - All secret values are removed before publishing
2. **PR Review** - Templates require review before being merged
3. **Access Control** - Only admins can publish templates
4. **Repository Permissions** - GitHub token should have minimal required permissions

## Future Enhancements

- [ ] Template versioning and updates
- [ ] Template ratings and reviews
- [ ] Template analytics (usage, popularity)
- [ ] Template preview screenshots
- [ ] Template documentation editor
- [ ] Bulk template operations
- [ ] Template marketplace integration
