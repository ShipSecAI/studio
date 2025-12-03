# Components Directory

This directory contains all React components organized by domain:

- **layout/** - Application layout components (TopBar, Sidebar, BottomPanel)
- **workflow/** - Workflow builder specific components (Canvas, Nodes)
- **ui/** - Reusable UI components from shadcn/ui (Button, Input, Badge, etc.)

## Key Components

### ui/markdown.tsx
Markdown rendering component using markdown-it with interactive features (checkboxes, links, images). Used by the text-block workflow component. See [docs/text-block.md](../../../docs/text-block.md) for details.

All components follow TypeScript strict mode and use proper prop interfaces.