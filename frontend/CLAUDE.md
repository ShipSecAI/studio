# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

Security Workflow Builder - An open-source, locally-run workflow automation tool for security engineers and bug bounty hunters. Frontend provides no-code/low-code interface similar to n8n/Langflow for security automation tasks.

## Critical Development Rules

1. **ONE CHECKPOINT AT A TIME** - Complete fully before moving to next
2. **TEST AFTER EVERY CHECKPOINT** - Verify in browser, ensure nothing breaks
3. **COMMIT AFTER EVERY CHECKPOINT** - Clear commit message describing what was done
4. **INCREMENTAL CHANGES ONLY** - Max 3-5 files per checkpoint
5. **ASK BEFORE DEVIATING** - Don't assume, clarify with developer
6. **NO PREMATURE OPTIMIZATION** - Make it work first

## Commands

```bash
# Install dependencies (using pnpm)
pnpm install

# Start development server
pnpm run dev

# Build for production
pnpm run build

# Preview production build
pnpm run preview

# Run linting
pnpm run lint

# Run type checking
pnpm run typecheck
```

## Tech Stack (Approved & Final)

- React 18+ with TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- React Flow (workflow canvas)
- Zustand (state management)
- Axios (HTTP client)
- Zod (schema validation & type generation)
- React Router (routing)
- Lucide React (icons)
- Shadcn/ui (UI components)

**NEVER add packages without explicit approval**

## Architecture

### Project Structure
```
src/
├── components/
│   ├── layout/     (TopBar, Sidebar, BottomPanel)
│   ├── workflow/   (Canvas, Nodes)
│   └── ui/         (Button, Input, Badge)
├── pages/          (WorkflowList, WorkflowBuilder)
├── store/          (Zustand stores)
├── services/       (API layer - abstracts backend calls)
├── schemas/        (Zod schemas - single source of truth)
├── hooks/          (Custom React hooks)
├── types/          (TypeScript utility types only)
├── styles/         (globals.css with CSS variables)
├── config/         (env.ts for environment variables)
└── utils/          (Helper functions)
```

Backend assumed at: `http://localhost:8080`

### Schema-First Development with Zod

All data structures defined as Zod schemas in `src/schemas/`:
```typescript
// src/schemas/workflow.ts
export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

// TypeScript type derived from schema
export type Workflow = z.infer<typeof WorkflowSchema>
```

API responses MUST be validated:
```typescript
const workflow = WorkflowSchema.parse(response.data)  // ✅ Runtime validation
// Never use: response.data as Workflow  // ❌ No validation
```

### API Service Pattern

All backend calls through `src/services/api.ts`:
```typescript
import { api } from '@/services/api'

// Automatically validates response with Zod
const workflows = await api.workflows.list()
```

Never import axios directly in components.

### State Management Strategy

**Zustand Store** (in-memory):
- Current workflow being edited
- List of all workflows
- Execution logs
- UI state

**LocalStorage** (UI preferences only):
- Theme preference
- Panel sizes
- NEVER workflow data

**Backend** (source of truth):
- All workflows
- Execution history
- All logs

Store pattern - one per domain:
- `workflowStore.ts` - Workflow data
- `uiStore.ts` - UI preferences
- `executionStore.ts` - Execution state and logs

### Theming System

CSS variables in `globals.css`:
```css
:root {
  --color-primary: #2563eb;
  --color-success: #16a34a;
  --color-warning: #f59e0b;
  --color-error: #dc2626;
  --color-bg-primary: #ffffff;
  --color-text-primary: #0f172a;
}
```

Tailwind maps to these variables. Never hardcode colors in components.

## Development Phases

1. **Foundation** - Project setup, dependencies, theming, shadcn/ui
2. **Core Layout & Routing** - Pages and navigation
3. **Workflow Canvas** - React Flow integration, drag-and-drop
4. **State & Backend** - Zustand, API integration, persistence
5. **Execution & Logs** - Run workflows, real-time feedback
6. **Polish** - Error handling, loading states, documentation

## Node Visual States

- **Idle**: Default white/light background
- **Running**: Yellow/amber background with spinner
- **Success**: Green checkmark, show execution time
- **Error**: Red background with error icon
- **Waiting**: Gray, slightly dimmed

## Code Standards

### Naming Conventions
- Components: PascalCase (`WorkflowNode.tsx`)
- Utils/Services: camelCase (`formatDate.ts`)
- Types: camelCase with `.types.ts` suffix
- Hooks: camelCase with `use` prefix
- Constants: UPPER_SNAKE_CASE

### Git Commits
```
feat(scope): description
fix(scope): description
docs(scope): description
chore(scope): description
```

### TypeScript
- `strict: true` enforced
- No `any` types
- Prefer `interface` over `type` for objects
- Add JSDoc comments to functions/components

## Testing Checklist

After each checkpoint:
- No console errors
- Components render correctly
- User interactions work
- API calls succeed/fail gracefully
- Visual states update properly
- Logs appear in BottomPanel (when applicable)

## React Flow Specific

- Wrap in `<ReactFlowProvider>` when using hooks outside
- Update nodes with `setNodes` and map, never direct mutation
- Use `nodesDraggable={false}` for static nodes to avoid re-renders

## Communication Protocol

**Before checkpoint:** "I will now build [feature]. This will modify [X] files and create [Y] new files."

**After checkpoint:** "Completed [feature]. Changed files: [list]. Test by: [instructions]. Ready for next checkpoint."

**If uncertain:** "I need clarification on [question] before proceeding."