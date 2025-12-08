# Pages Directory

Top-level page components representing application routes.

## Page Structure

- **WorkflowListPage.tsx** - Dashboard with workflow overview and recent runs
- **WorkflowBuilderPage.tsx** - Main workflow editor with canvas and tools
- **SecretsManagerPage.tsx** - Secrets and credential management interface
- **IntegrationsPage.tsx** - OAuth connections and third-party integrations
- **ArtifactLibraryPage.tsx** - File and artifact browser
- **SettingsPage.tsx** - User and organization settings

## Page Architecture

Each page follows this structure:
```typescript
export default function PageName() {
  // Page-level state and hooks
  const { data, isLoading, error } = usePageData();

  // Layout components
  return (
    <PageLayout>
      <PageHeader title="Page Title" actions={<ActionButtons />} />
      <PageContent>
        {/* Page-specific content */}
      </PageContent>
    </PageLayout>
  );
}
```

## Routing

Pages are connected to the React Router configuration in `App.tsx`:
- Protected routes require authentication
- Organization-scoped routes enforce multi-tenancy
- Error boundaries catch and handle page-level errors

## Data Loading

- Use React Query for server state synchronization
- Implement proper loading states and error handling
- Optimistic updates for immediate user feedback
- Background refetching for data freshness

## Best Practices

- Keep page components focused on layout and orchestration
- Extract business logic into hooks and services
- Use consistent layout components across pages
- Implement proper error boundaries and loading states
- Support deep linking and browser navigation