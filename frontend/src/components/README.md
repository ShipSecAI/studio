# Components Directory

This directory contains all React components organized by domain and functionality.

## Directory Structure

- **layout/** - Application layout components (TopBar, Sidebar, BottomPanel)
- **workflow/** - Workflow builder specific components (Canvas, Nodes, Controls)
- **terminal/** - Terminal display and streaming components (xterm.js integration)
- **timeline/** - Execution timeline visualization and controls
- **ui/** - Reusable UI components from shadcn/ui (Button, Input, Badge, etc.)
- **integrations/** - OAuth and third-party integration components
- **secrets/** - Secrets management and credential handling components

## Key Components

### Workflow Builder Components
- **WorkflowBuilder.tsx** - Main ReactFlow canvas for visual workflow editing
- **WorkflowNode.tsx** - Individual workflow node rendering with execution states
- **ComponentPalette.tsx** - Drag-and-drop component catalog
- **NodeConfigPanel.tsx** - Component parameter configuration interface

### Terminal Components
- **NodeTerminalPanel.tsx** - Real-time terminal display using xterm.js
- **TerminalControls.tsx** - Terminal playback controls (play, pause, seek)
- **TerminalResize.tsx** - Resizable terminal container

### Timeline Components
- **ExecutionTimeline.tsx** - Interactive timeline with node visualization
- **TimelineControls.tsx** - Playback controls and speed adjustment
- **TimelineSeeker.tsx** - Timeline position seeking interface

### UI Components
- All components follow the shadcn/ui design system
- Built with Tailwind CSS for consistent styling
- TypeScript strict mode with proper prop interfaces
- React.memo optimization for performance

## Component Development Guidelines

### Workflow Components
- Extend ReactFlow node types for custom workflow nodes
- Support both design-time and execution-time rendering states
- Use Zod schemas for input/output validation
- Implement proper error boundaries and loading states

### Real-time Components
- Use React Query for data synchronization
- Implement proper cleanup for WebSocket/SSE connections
- Handle connection errors and reconnection logic
- Use React.memo with custom comparison functions for performance

### UI Components
- Follow shadcn/ui patterns and conventions
- Use proper TypeScript interfaces for props
- Implement accessibility features (ARIA labels, keyboard navigation)
- Support both light and dark themes

## Performance Considerations

- Use React.memo for expensive components
- Implement proper key props for list rendering
- Debounce user input and search operations
- Lazy load heavy components and images
- Optimize re-renders with useCallback and useMemo

All components follow TypeScript strict mode and use proper prop interfaces for type safety.