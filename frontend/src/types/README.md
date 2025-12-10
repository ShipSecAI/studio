# Types Directory

TypeScript utility types and type helpers for frontend-specific functionality.

## Type Sources

### Shared Types (`@shipsec/shared`)
- Main data structures are defined as Zod schemas in the shared package
- Types are derived using `z.infer<SchemaType>` for type safety
- Includes workflow, component, and execution contract types

### Backend Client Types (`@shipsec/backend-client`)
- Auto-generated TypeScript types from OpenAPI specification
- Provides request/response type definitions for all API endpoints
- Ensures type safety across frontend-backend communication

## Local Utility Types

This directory contains frontend-specific utility types that don't map to backend data structures:

- **Component Props Types**: React component prop interfaces
- **State Management Types**: Zustand store type definitions
- **UI State Types**: Component-specific state interfaces
- **Event Handler Types**: Custom event and callback types
- **Utility Types**: Generic type helpers and transformations

## Type Safety Guidelines

- Always derive types from Zod schemas for data structures
- Use utility types for component props and UI state
- Prefer strict TypeScript configuration
- Use `z.infer<>` instead of manual type definitions
- Implement proper error type handling with discriminated unions

## Examples

```typescript
// From shared schemas (preferred)
type Workflow = z.infer<typeof workflowSchema>;

// Local utility type
type ComponentState = {
  isLoading: boolean;
  error: string | null;
  data: Workflow | null;
};

// Generic utility type
type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};
```