# ShipSec Studio Frontend

React 19 + Vite UI for building and monitoring security workflows with real-time execution visibility.

## Prerequisites
- Bun latest (see root `README.md` for install instructions)
- Infrastructure services running (`just dev` from repo root)

## Development Commands
```bash
# Install workspace dependencies (run once from repo root)
bun install

# Start the UI with hot reload
bun dev

# Type-check and lint before committing
bun run typecheck
bun run lint

# Run component/unit tests (Vitest + Testing Library)
bun run test
```

## Architecture Overview

### Core Technologies
- **React 19** with TypeScript for component development
- **Vite** for fast development and building
- **ReactFlow** for visual workflow editor
- **xterm.js** for real-time terminal display
- **Clerk** for authentication and user management
- **Zustand** for execution timeline state management
- **React Query** for server state management
- **Tailwind CSS** with shadcn/ui components

### Key Features
- **Visual Workflow Builder**: Drag-and-drop workflow canvas with ReactFlow
- **Real-time Terminal Display**: xterm.js integration for live terminal output
- **Execution Timeline**: Interactive timeline with playback controls and seeking
- **Live Updates**: WebSocket/SSE streaming for real-time workflow status
- **Component Catalog**: Extensible library of security components
- **Secrets Management**: Secure credential storage and management
- **OAuth Integrations**: Third-party service connections (GitHub, Zoom, etc.)

## Key Concepts

### State Management
- **Timeline Store**: `src/store/executionTimelineStore.ts` - Zustand-based execution timeline state
- **API State**: React Query for server state synchronization
- **Component State**: Local React state with hooks for UI interactions

### Real-time Features
- **Terminal Streaming**: `src/hooks/useTerminalStream.ts` - Real-time terminal output via SSE
- **Timeline Synchronization**: `src/hooks/useTimelineTerminalStream.ts` - Terminal playback synchronized to timeline position
- **Live Updates**: WebSocket integration for workflow status changes

### API Integration
- **Generated Client**: `@shipsec/backend-client` - Auto-generated TypeScript API client
- **Service Layer**: `src/services/` - Centralized API communication and error handling
- **Authentication**: Clerk-based auth with organization scoping

## Project Structure
```
src/
├── components/
│   ├── workflow/          # Workflow builder components
│   │   ├── WorkflowBuilder.tsx    # Main canvas editor
│   │   └── WorkflowNode.tsx       # Individual workflow nodes
│   ├── terminal/          # Terminal display components
│   │   ├── NodeTerminalPanel.tsx # Real-time terminal viewer
│   │   └── TerminalControls.tsx  # Playback controls
│   ├── timeline/          # Timeline visualization
│   │   └── ExecutionTimeline.tsx # Interactive timeline
│   ├── ui/               # Reusable UI components (shadcn/ui)
│   └── layout/           # Application layout components
├── store/
│   └── executionTimelineStore.ts  # Timeline state management
├── hooks/
│   ├── useTerminalStream.ts       # Terminal streaming
│   ├── useTimelineTerminalStream.ts # Timeline synchronization
│   └── useWorkflowStream.ts       # Workflow status updates
├── services/
│   └── api.ts                     # API service layer
└── lib/                          # Utilities and helpers
```

## Component Development

### UI Components
- Use shadcn/ui components from `src/components/ui/`
- Follow Tailwind CSS conventions for styling
- Implement proper TypeScript interfaces for props
- Use React.memo for performance optimization

### Workflow Components
- Extend ReactFlow node types for custom workflow nodes
- Implement proper data flow between nodes
- Use Zod schemas for input/output validation
- Support both design-time and execution-time rendering

## Where To Read More
- **[Architecture Overview](../docs/architecture.md)** - Complete system design and component interactions
- **[Component Development](../docs/component-development.md)** - Building custom security components
- **[Getting Started](../docs/getting-started.md)** - Development setup and first workflow
- **[Analytics](../docs/analytics.md)** - PostHog integration and privacy