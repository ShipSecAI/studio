# Security Workflow Builder - Frontend Development

**Date:** October 4, 2025  
**From:** UI/UX Design & Architecture Planning  
**To:** Development Agent  
**Project:** Security Workflow Builder (Open Source)

---

## 🎯 Project Mission

Build an open-source, locally-run workflow builder for security engineers and bug bounty hunters. Think n8n/Langflow but specifically for security automation tasks (subdomain scanning, port scanning, vulnerability checks, etc.).

---

## 🚨 CRITICAL INSTRUCTIONS FOR LLM CODING AGENT

### Development Rules
1. **ONE CHECKPOINT AT A TIME** - Complete fully before moving to next
2. **TEST AFTER EVERY CHECKPOINT** - Verify in browser, ensure nothing breaks
3. **COMMIT AFTER EVERY CHECKPOINT** - Clear commit message describing what was done
4. **INCREMENTAL CHANGES ONLY** - Max 3-5 files per checkpoint
5. **ASK BEFORE DEVIATING** - Don't assume, clarify with developer
6. **NO PREMATURE OPTIMIZATION** - Make it work first
7. **Don't Reinvent the Wheel** - Use proven libraries for common UI components (shadcn/ui, Lucide icons). Build custom components only for workflow-specific features. However, that doesn't mean adding libraries for everything.

---

## 📋 What's Been Decided

### Core Decisions Made

1. **Tech Stack (Approved & Final)**
   - React 18+ with TypeScript
   - Vite (build tool)
   - Tailwind CSS (styling)
   - React Flow (workflow canvas)
   - Zustand (state management)
   - Axios (HTTP client)
   - Zod (schema validation & type generation)
   - React Router (routing)
   - Lucide React (icons)
   - Shadcn (for components)

2. **Architecture Pattern**
   - Frontend ONLY handles UI and HTTP requests
   - NO database in frontend (no SQLite, no PostgreSQL, no ORM)
   - Backend handles all data persistence (separate repo)
   - Service layer abstracts API calls for easy protocol switching

3. **Theming System**
   - CSS variables in `globals.css` define all colors
   - Tailwind config maps to these CSS variables
   - Theme switching = change CSS variable values
   - NO hardcoded colors anywhere in components

4. **Development Approach**
   - Build incrementally, one checkpoint at a time
   - Test in browser after every checkpoint
   - Commit after every checkpoint with clear messages
   - Ask before making assumptions or adding features

---

## 🗃️ Project Structure

```
security-workflow-builder/          (Frontend - THIS repo)
├── src/
│   ├── components/
│   │   ├── layout/                 (TopBar, Sidebar, BottomPanel)
│   │   ├── workflow/               (Canvas, Nodes)
│   │   └── ui/                     (Button, Input, Badge)
│   ├── pages/                      (WorkflowList, WorkflowBuilder)
│   ├── store/                      (Zustand stores)
│   ├── services/                   (API layer - abstracts backend calls)
│   ├── schemas/                    (Zod schemas - single source of truth)
│   ├── hooks/                      (Custom React hooks)
│   ├── types/                      (TypeScript utility types only)
│   ├── styles/                     (globals.css with CSS variables)
│   ├── config/                     (env.ts for environment variables)
│   └── utils/                      (Helper functions)
├── .env                            (VITE_BACKEND_URL=http://localhost:8080)
├── package.json
└── README.md
```

---

## 🎨 UI/UX Design Overview

### WorkflowList Page (Home)
- Header: "Security Workflow Builder"
- Prominent "New Workflow" button
- Grid/list of existing workflows (name, last updated timestamp)
- Empty state: "No workflows yet. Create your first workflow!"
- Click workflow → navigate to builder

### WorkflowBuilder Page (Main Interface)
**Layout:**
```
┌─────────────────────────────────────────────────┐
│ TopBar: [← Back] | Workflow Name | [Save] [Run] │  60px height
├─────────┬───────────────────────────────────────┤
│ Side    │                                        │
│ bar     │        Canvas (React Flow)             │  flex-1
│ 280px   │                                        │
│         │                                        │
├─────────┴───────────────────────────────────────┤
│ BottomPanel: Logs (collapsible)                 │  40px collapsed
└─────────────────────────────────────────────────┘  300px expanded
```

**TopBar:**
- Left: Back button (arrow icon) → navigate to home
- Center: Workflow name (editable inline)
- Right: Save button + Run button
- Show loading state on buttons when saving/running

**Sidebar:**
- Component palette with categories: Input, Scan, Process, Output
- Each node shows icon + label
- Draggable nodes
- Example nodes:
  - Input: Target Input, File Upload
  - Scan: Subdomain Scanner, Port Scanner, Vulnerability Scanner
  - Process: Filter, Transform, Merge
  - Output: Export, Alert, Report

**Canvas (React Flow):**
- Grid background
- Zoom/pan controls (bottom-left)
- Minimap (bottom-right)
- Drag nodes from sidebar onto canvas
- Connect nodes with edges
- Visual node states:
  - Idle: white/default background
  - Running: yellow/amber with spinner
  - Success: green with checkmark
  - Error: red with error icon

**BottomPanel:**
- Collapsible logs panel
- Tabs: Logs | Results | History (only Logs functional in v1)
- Log format: [timestamp] [level] message
- Color-coded: info (blue), warn (amber), error (red)
- Auto-scroll to bottom when new logs arrive
- Toggle button to expand/collapse

---

## 📌 Backend

You are to assume the backend is on http://localhost:8080

### API Contract (Expected Endpoints)

```
GET    /workflows              # List all workflows
GET    /workflows/:id          # Get specific workflow
POST   /workflows              # Create new workflow
PUT    /workflows/:id          # Update workflow
DELETE /workflows/:id          # Delete workflow
POST   /workflows/:id/execute  # Start execution
GET    /executions/:id         # Get execution status
GET    /executions/:id/logs    # Get logs for execution
```

**API Abstraction Layer:**
All backend calls must go through `src/services/api.ts` - never import axios directly in components. This allows easy switching from REST to GraphQL later if needed.

---

## 📦 State Management Strategy

### Where Data Lives

**1. Zustand Store (In-Memory)**
- Current workflow being edited (nodes, edges)
- List of all workflows (fetched from backend)
- Execution logs (current session)
- UI state (sidebar collapsed, logs panel open)

**2. LocalStorage (UI Preferences Only)**
- Theme preference (light/dark)
- Panel sizes
- Layout preferences
- **NEVER store workflow data here**

**3. Backend (Source of Truth)**
- All workflows (permanent storage)
- Execution history
- All logs

### Data Flow
```
User creates workflow
    ↓
Zustand store updates (local state)
    ↓
User clicks Save
    ↓
API call to backend via service layer
    ↓
Backend saves to database
    ↓
Backend returns saved workflow
    ↓
Zustand store updates with backend response
```

### When to Use Zustand vs Local State

**Use Local State (useState) when:**
- Data is only used in one component
- Data doesn't need to persist across navigation
- Simple UI state (open/closed, hover, etc.)

**Use Zustand Store when:**
- Data is shared across multiple components
- Data needs to persist across navigation
- Global UI state (theme, user preferences)
- Data from API that's used in multiple places

### Zustand Store Pattern

```typescript
// src/store/workflowStore.ts
interface WorkflowStore {
  // State
  workflows: Workflow[]
  currentWorkflow: Workflow | null
  
  // Actions
  setWorkflows: (workflows: Workflow[]) => void
  setCurrentWorkflow: (workflow: Workflow) => void
  
  // Computed (if needed)
  getCurrentWorkflowNodes: () => Node[]
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  
  setWorkflows: (workflows) => set({ workflows }),
  setCurrentWorkflow: (workflow) => set({ currentWorkflow: workflow }),
  
  getCurrentWorkflowNodes: () => get().currentWorkflow?.nodes || []
}))
```

**One store per domain:**
- `workflowStore.ts` - Workflow data
- `uiStore.ts` - UI preferences (theme, panel sizes)
- `executionStore.ts` - Execution state and logs

### API Service Layer Pattern

**All API calls go through `src/services/api.ts`:**

```typescript
// src/services/api.ts
import axios from 'axios'
import { z } from 'zod'
import { WorkflowSchema } from '@/schemas'
import { env } from '@/config/env'

const apiClient = axios.create({
  baseURL: env.BACKEND_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Centralized error handling
    console.error('API Error:', error)
    return Promise.reject(error)
  }
)

export const api = {
  workflows: {
    list: async () => {
      const response = await apiClient.get('/workflows')
      return z.array(WorkflowSchema).parse(response.data)
    },
    get: async (id: string) => {
      const response = await apiClient.get(`/workflows/${id}`)
      return WorkflowSchema.parse(response.data)
    },
    create: async (data: Partial<Workflow>) => {
      const response = await apiClient.post('/workflows', data)
      return WorkflowSchema.parse(response.data)
    },
    update: async (id: string, data: Partial<Workflow>) => {
      const response = await apiClient.put(`/workflows/${id}`, data)
      return WorkflowSchema.parse(response.data)
    },
    delete: (id: string) => apiClient.delete(`/workflows/${id}`)
  },
  
  executions: {
    start: (workflowId: string) => apiClient.post(`/workflows/${workflowId}/execute`),
    getStatus: (executionId: string) => apiClient.get(`/executions/${executionId}`),
    getLogs: (executionId: string) => apiClient.get(`/executions/${executionId}/logs`)
  }
}
```

**Usage in components:**
```typescript
// ✅ Correct
import { api } from '@/services/api'

const { data } = await api.workflows.list()

// ❌ Wrong - don't import axios directly
import axios from 'axios'
const { data } = await axios.get('http://localhost:8080/workflows')
```

**Why:** Centralized error handling, easy to switch protocols (REST → GraphQL), typed responses

### Error Handling Patterns
```typescript
// Component error handling
try {
  await api.workflows.create(data)
  showToast('Workflow saved!')
} catch (error) {
  // Log for debugging
  console.error('Failed to save workflow:', error)
  // Show user-friendly message
  showToast('Failed to save workflow. Please try again.')
}
```
---

## 🎨 Theming System (Critical!)

### How It Works

**Step 1: Define CSS Variables** (`src/styles/globals.css`)
```css
:root {
  --color-primary: #2563eb;
  --color-success: #16a34a;
  --color-warning: #f59e0b;
  --color-error: #dc2626;
  --color-bg-primary: #ffffff;
  --color-text-primary: #0f172a;
  /* ... all colors as variables */
}

[data-theme="dark"] {
  --color-bg-primary: #0f172a;
  --color-text-primary: #f1f5f9;
  /* ... override for dark theme */
}
```

**Step 2: Map to Tailwind** (`tailwind.config.js`)
```js
colors: {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  bg: {
    primary: 'var(--color-bg-primary)',
  },
  text: {
    primary: 'var(--color-text-primary)',
  }
}
```

**Step 3: Use in Components**
```tsx
// ✅ Correct
<div className="bg-bg-primary text-text-primary border-border">

// ❌ Wrong - NEVER do this
<div style={{ backgroundColor: '#ffffff' }}>
```

**Theme Switching:**
```tsx
// Just change HTML attribute
document.documentElement.setAttribute('data-theme', 'dark');
// All CSS variables update automatically!
```

---

## ⚠️ Critical Rules (READ THIS!)

### Dependencies - DO NOT VIOLATE
- ✅ **ONLY use approved packages** listed in spec
- ❌ **NEVER add packages without explicit approval**
- ❌ No database libraries in frontend (no sqlite3, no pg, no prisma)
- ❌ No packages with <1000 GitHub stars
- ❌ No unmaintained packages

### Development Discipline
- ✅ One checkpoint at a time - complete fully before moving on
- ✅ Test after every checkpoint in browser
- ✅ Commit after every checkpoint
- ✅ Ask before assuming or deviating from spec
- ❌ Don't refactor working code unless asked
- ❌ Don't add features not in the checkpoint
- ❌ Don't skip testing

### Code Quality
- ✅ Use TypeScript properly (define interfaces, avoid `any`)
- ✅ Add JSDoc comments to functions/components
- ✅ Use meaningful variable names
- ✅ Keep components small (<200 lines)
- ✅ Use CSS variables via Tailwind, never hardcode colors
- ❌ Don't write inline styles
- ❌ Don't import axios directly in components (use service layer)

### OSS Best Practices
- ✅ Write clear comments
- ✅ Create README in complex directories
- ✅ Make code easy for contributors to understand
- ✅ Follow existing patterns in codebase
- ❌ Don't use obscure patterns
- ❌ Don't over-engineer

---

## 📐 Code Standards & Conventions

### File Naming Conventions
- Components: PascalCase (`Button.tsx`, `WorkflowNode.tsx`)
- Utilities/Services: camelCase (`api.ts`, `formatDate.ts`)
- Types: camelCase with `.types.ts` suffix (`workflow.types.ts`)
- Hooks: camelCase with `use` prefix (`useWorkflow.ts`)
- Constants: UPPER_SNAKE_CASE in `constants.ts` files

### Import Order (Must Follow)
```typescript
// 1. React imports
import { useState, useEffect } from 'react'

// 2. Third-party libraries
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

// 3. Local components
import { WorkflowNode } from './WorkflowNode'

// 4. Types
import type { Workflow } from '@/types'

// 5. Utils/Services
import { api } from '@/services/api'
import { cn } from '@/utils'

// 6. Styles (if any)
import './styles.css'
```
**Why:** Consistency across all files, easier code reviews, clear dependencies

### Component Organization
- One component per file (exception: small helper components can be co-located)
- Component-specific types: Define in same file before component
- Component-specific hooks: Extract to `hooks/` folder if >20 lines or reusable
- Props: Use `interface Props` pattern, destructure in function signature
- Split component when:
  - File exceeds 200 lines
  - Component has >3 useState calls
  - Logic is reused elsewhere
  - Component does more than 1 thing

**Example:**
```typescript
// WorkflowNode.tsx
import { useState } from 'react'

interface WorkflowNodeProps {
  id: string
  type: string
  data: NodeData
}

export function WorkflowNode({ id, type, data }: WorkflowNodeProps) {
  // component logic
}
```

### Console Logging Guidelines 
- Remove console.logs before committing (except error handling)
- Use descriptive messages: ❌ console.log(data) ✅ console.log('Fetched workflows:', data)

### TypeScript Standards
- `strict: true` (enforced)
- No `any` types - use `unknown` if type is truly unknown
- Define interfaces for all props and data structures
- Use type inference where obvious, explicit types where helpful
- Prefer `interface` over `type` for object shapes

### Schema Validation with Zod

**Single Source of Truth:**
- All data structures defined as Zod schemas in `src/schemas/`
- TypeScript types derived from schemas using `z.infer<>`
- API layer validates all responses using `.parse()`

**Schema Organization:**
```typescript
// src/schemas/workflow.ts
import { z } from 'zod'

export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

// Export TypeScript type (derived from schema)
export type Workflow = z.infer<typeof WorkflowSchema>
```

**File Structure:**
```
src/schemas/
├── workflow.ts      # WorkflowSchema
├── node.ts          # NodeSchema
├── edge.ts          # EdgeSchema
├── execution.ts     # ExecutionSchema
└── index.ts         # Re-export all
```
**Always validate API responses:**

```typescript
// ✅ Correct - validates at runtime
const workflow = WorkflowSchema.parse(response.data)

// ❌ Wrong - no validation, type assertion only
const workflow = response.data as Workflow
Error Handling:
typescriptimport { ZodError } from 'zod'

try {
  const workflow = await api.workflows.get(id)
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Invalid API response:', error.errors)
    showToast('Received invalid data from server')
  } else {
    console.error('API error:', error)
    showToast('Failed to fetch workflow')
  }
}
```
**Benefits:**
- Runtime type safety (catches API contract breaks immediately)
- Single source of truth (no duplicate type definitions)
- Clear validation error messages
- Easy GraphQL migration path (swap Zod with codegen)

### Git Commit Format (CRITICAL)
Follow Conventional Commits:

```md
<type>(<scope>): <description>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes (formatting, no logic change)
- refactor: Code refactoring
- test: Adding/updating tests
- chore: Maintenance tasks

Examples:
feat(workflow): add drag-and-drop node functionality
fix(api): handle timeout errors gracefully
docs(readme): add setup instructions
chore(deps): update react-flow to v11.10
```

**After each checkpoint:**
```bash
git add .
git commit -m "feat(phase-1): complete project initialization and shadcn setup"
```

### Loading & Error States Pattern
```typescript
const [data, setData] = useState<Workflow | null>(null)
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)

// Always handle all 3 states in UI
if (loading) return <Spinner />
if (error) return <ErrorMessage>{error}</ErrorMessage>
if (!data) return null
return <WorkflowDisplay data={data} />
```
---

## ♿ Accessibility Standards (Critical for OSS)

### Why This Matters
Security tools should be accessible to all engineers, including those using assistive technologies.

### Requirements

**1. Semantic HTML**
- Use proper elements: `<button>` not `<div onClick>`
- Use `<nav>`, `<main>`, `<aside>`, `<header>` for layout
- Use heading hierarchy (h1 → h2 → h3, no skipping)

**2. Keyboard Navigation**
- All interactive elements must be keyboard accessible
- Visible focus indicators (don't remove outline without replacement)
- Logical tab order (use `tabIndex` sparingly, only when needed)
- Escape key closes modals/dropdowns

**3. ARIA Labels (When Needed)**
- Icon-only buttons need `aria-label`: `<button aria-label="Save workflow">`
- Loading states: `aria-busy="true"` and `aria-live="polite"` for status updates
- Custom components: Add appropriate ARIA roles if not using semantic HTML

**4. Color & Contrast**
- Don't rely on color alone to convey information
- Use icons + color for states (green checkmark + green color for success)
- Ensure text contrast ratios meet WCAG AA (4.5:1 for normal text)

**5. Focus Management**
- When opening modal, move focus inside
- When closing modal, return focus to trigger element
- Use focus trap in modals

### shadcn/ui Handles Most of This
Our components from shadcn/ui are already accessible. Focus on:
- Using them correctly (don't strip ARIA attributes)
- Adding `aria-label` to icon-only buttons
- Maintaining keyboard navigation in custom components

---

## 📝 Documentation Standards

### Component Documentation
Every exported component needs JSDoc:
```typescript
/**
 * WorkflowNode component displays a single node in the workflow canvas.
 * 
 * @param id - Unique identifier for the node
 * @param type - Node type (input, scan, process, output)
 * @param data - Node configuration and state
 * 
 * @example
 * ```tsx
 * <WorkflowNode 
 *   id="node-1" 
 *   type="scan" 
 *   data={{ name: "Port Scanner" }} 
 * />
 * ```
 */
export function WorkflowNode({ id, type, data }: WorkflowNodeProps) {
  // ...
}
```

### Function Documentation
Complex functions (>10 lines or non-obvious logic) need comments:
```typescript
/**
 * Validates node connections to prevent cycles and enforce type compatibility.
 * Returns error message if invalid, null if valid.
 */
function validateConnection(source: Node, target: Node): string | null {
  // implementation
}
```

### Inline Comments
- Explain "why" not "what"
- Use for complex logic, workarounds, or non-obvious behavior
```typescript
// ✅ Good
// Using setTimeout to defer focus to next tick due to React Flow rendering delay
setTimeout(() => nodeRef.current?.focus(), 0)

// ❌ Bad (obvious from code)
// Set loading to true
setLoading(true)
```

### README Files
Add `README.md` in these directories:
- `/src/components/` - Overview of component structure
- `/src/services/` - API service pattern explanation
- `/src/store/` - State management approach
- `/src/types/` - TypeScript conventions used

Keep READMEs short (5-15 lines), focus on "why" and patterns used.

---

## 🛠️ Development Environment

### Requirements
- **Node.js:** >= 18.0.0 (use `node -v` to check)
- **Package Manager:** pnpm (comes with Node.js)
- **Git:** Latest version

### Recommended VSCode Extensions
```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "dsznajder.es7-react-js-snippets"
  ]
}
```
*(This file will be created in Phase 1 as `.vscode/extensions.json`)*

### ESLint & Prettier
Configuration will be set up in Phase 1. **Do not modify** these configs without approval:
- ESLint: Catches code errors and enforces standards
- Prettier: Auto-formats code on save

If you see linting errors:
1. Try to fix them (often auto-fixable)
2. If unclear, ask before disabling the rule

### Common Pitfalls to Avoid

1. React Flow: Don't modify nodes array directly, always create new array
2. Zustand: Don't destructure store values (breaks reactivity)
3. Async: Always cleanup useEffect subscriptions
4. State: Don't store derived data (compute from existing state)

---

## 📝 Development Workflow

### Your Process (Step-by-Step)

**For Each Checkpoint:**

1. **Before Starting:**
   - Announce: "Starting Checkpoint X.Y: [Goal]"
   - List files you'll create/modify
   - Estimate: "This will take ~15 minutes"

2. **During Development:**
   - Make changes incrementally
   - Keep changes focused (max 3-5 files)
   - Add comments to complex logic
   - Use TypeScript properly (no `any` types)

3. **After Completing:**
   - Test in browser thoroughly
   - Verify no console errors
   - Check responsive layout
   - Run `pnpm run lint` and fix issues
   - Commit with clear message

4. **Report Back:**
   - "Completed Checkpoint X.Y"
   - "Files changed: [list]"
   - "Test by: [specific instructions]"
   - "Ready for next checkpoint? (Y/N)"

5. **If Stuck:**
   - Explain the issue clearly
   - Show what you've tried
   - Ask specific question
   - Don't assume or skip - ASK!

---

## 🚀 Development Phases (Your Roadmap)

### Phase 1: Foundation ✅ (Start Here)
**Checkpoints 1.1 - 1.8**

Goal: Setup project, install dependencies, setup reusable UI component system

- Initialize Vite + React + TypeScript project
- Install all approved dependencies (including Zod)
- Configure Tailwind with CSS variables
- Setup shadcn/ui for reusable components (Button, Input, Badge, Select, Dialog)
- Setup Zod schemas structure (`src/schemas/`)
- Define initial schemas (Workflow, Node, Edge)
- Setup environment variables
- Create directory structure with README files
- Write root documentation (README, CONTRIBUTING, ARCHITECTURE)
- Document component choices and schema validation approach

**Done When:** Can run project, see styled buttons, no errors

---

### Phase 2: Core Layout & Routing
**Checkpoints 2.1 - 2.5**

Goal: Build main layout and navigation

- Setup React Router (two routes: / and /workflow/:id)
- Build WorkflowList page with mock data
- Build TopBar component
- Build Sidebar with node palette
- Build BottomPanel (collapsible logs)
- Assemble WorkflowBuilder page layout

**Done When:** Can navigate between pages, see complete layout structure

---

### Phase 3: Workflow Canvas
**Checkpoints 3.1 - 3.6**

Goal: Integrate React Flow, enable workflow building

- Integrate React Flow (grid, controls, minimap)
- React Flow Specific Gotchas
  - Must wrap in <ReactFlowProvider> if using hooks outside
  - Node data updates: Use `setNodes` with map, not direct mutation
  - Position changes trigger re-renders: Use `nodesDraggable={false}` for static nodes
- Implement drag-and-drop from sidebar to canvas
- Create WorkflowNode component with visual states
- Implement node connections (edges)
- Add connection validation
- Enable node/edge deletion

**Done When:** Can drag nodes, connect them, delete them, canvas is interactive

---

### Phase 4: State Management & Backend
**Checkpoints 4.1 - 4.4**

Goal: Connect to backend (mock or real)

- Setup JSON Server mock backend
- Create Zustand workflow store
- Build API service layer (src/services/api.ts)
- Implement workflow save/load
- Add auto-save (every 30 seconds)
- Connect WorkflowList to backend data

**Done When:** Workflows persist, can reload and see saved workflows

---

### Phase 5: Execution & Logs
**Checkpoints 5.1 - 5.5**

Goal: Run workflows and show real-time feedback

- Implement Run button functionality
- Send execution request to backend
- Poll for execution status
- Update node visual states during execution
- Stream logs to BottomPanel
- Display results on completion

**Done When:** Click Run → see nodes change states, logs appear in real-time

---

### Phase 6: Polish & Documentation
**Checkpoints 6.1 - 6.5**

Goal: Production-ready UX

- Add error boundaries
- Handle backend errors gracefully
- Create empty states
- Add loading states everywhere
- Implement keyboard shortcuts (Ctrl+S, Ctrl+Enter)
- Write comprehensive component documentation
- Add screenshots to README

**Done When:** App feels polished, errors handled well, documented

---

## 🎯 Success Criteria

### MVP Complete When:
- [ ] User can navigate to WorkflowList page
- [ ] User can click "New Workflow" → go to builder
- [ ] User can drag nodes from sidebar onto canvas
- [ ] User can connect nodes with edges
- [ ] User can save workflow (persists to backend/mock)
- [ ] User can load existing workflows
- [ ] User can run workflow (execution starts)
- [ ] Node states update during execution (yellow → green/red)
- [ ] Logs appear in BottomPanel in real-time
- [ ] Errors are handled gracefully with user-friendly messages
- [ ] No console errors
- [ ] Code is well-documented

---

## 📞 When to Ask for Help

### Ask Developer When:
- Unclear about a requirement
- Want to deviate from spec
- Want to add a dependency
- Stuck on a bug for >30 minutes
- Backend API contract details needed
- Unsure about design decision

### Don't Assume:
- "This feature probably needs X" → ASK
- "I'll add this library, it's popular" → ASK
- "This isn't in the spec but makes sense" → ASK
- "The backend probably works like Y" → ASK

---

## 🔧 Environment Setup (First Task)

### Before Starting Development:

```bash
cd frontend
pnpm install
pnpm run dev
# Opens http://localhost:5173
```

**Verify:**
- Frontend runs without errors
- Mock backend responds: `curl http://localhost:8080/workflows`
- Can see Vite + React default page

---

## 📚 Reference Documentation

### Essential Reading:
- Project README.md (overview, setup)
- CONTRIBUTING.md (code standards, commit format)
- ARCHITECTURE.md (design decisions, patterns)
- Development spec document (detailed checkpoints)

### Library Documentation:
- React Flow: https://reactflow.dev/
- Tailwind CSS: https://tailwindcss.com/
- Zustand: https://github.com/pmndrs/zustand
- React Router: https://reactrouter.com/

---

## 🎁 What You're Receiving

1. **Complete Development Spec** - Detailed checkpoints and goals
2. **Approved Tech Stack** - No decisions needed, everything chosen
3. **Design System** - CSS variables + Tailwind approach defined
4. **Mock Backend Strategy** - JSON Server setup instructions
5. **UI/UX Guidelines** - Layout, components, interactions specified
6. **This KT Document** - Everything you need to start

---

## ✅ Your First Actions

1. **Read this KT document fully** ✓ (You're doing this now!)
2. **Read the Development Spec document** (detailed checkpoints)
3. **Setup environment** (install Node.js, git clone repo)
4. **Verify approved dependencies** (check they're all <6 months old, no security issues)
5. **Ask clarifying questions** if anything is unclear
6. **Start Phase 1, Checkpoint 1.1** when ready

---

## 💬 Communication Template

**Starting Checkpoint:**
```
🚀 Starting Checkpoint X.Y: [Goal]

What I'll do:
- [Task 1]
- [Task 2]

Files I'll modify:
- src/...
- src/...

Estimated time: ~15 minutes

Any concerns before I proceed?
```

**Completed Checkpoint:**
```
✅ Completed Checkpoint X.Y: [Goal]

Changes made:
- [Summary]

Files changed:
- src/... (created)
- src/... (modified)

Test by:
1. Run pnpm run dev
2. Navigate to...
3. Verify...

Current status: No errors, ready for next checkpoint.

Proceed to Checkpoint X.Y+1? (Y/N)
```

**When Stuck:**
```
❓ Need Clarification - Checkpoint X.Y

Issue: [Describe problem]

What I've tried:
- [Attempt 1]
- [Attempt 2]

Specific question:
[Clear question]

Should I:
A) [Option 1]
B) [Option 2]
C) Skip for now and return later
```

---

## 🎯 Your Goal

Build a production-ready, open-source security workflow builder that security engineers love to use. Focus on:
- **Simplicity** - Easy to understand and contribute to
- **Quality** - Well-tested, well-documented
- **Usability** - Intuitive interface, clear feedback
- **Maintainability** - Clean code, good patterns

You have everything you need to start. Follow the spec checkpoint-by-checkpoint, test thoroughly, communicate clearly, and ask when uncertain.

**Remember:** Incremental progress > Perfect code. Make it work, then make it better.

Start with Phase 1, Checkpoint 1.1 when ready.