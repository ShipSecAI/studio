# Text Block Component

The text-block component provides markdown-based documentation capabilities within workflows. It allows users to add notes, checklists, and rich documentation directly on the workflow canvas.

## Overview

- **Component ID**: `core.ui.text`
- **Slug**: `text-block`
- **Type**: UI-only (not executed during workflow runs)

## Features

### Markdown Rendering
Uses [markdown-it](https://github.com/markdown-it/markdown-it) for rendering with the following plugins:
- **Task lists**: Interactive checkboxes with `- [ ]` and `- [x]` syntax
- **Link attributes**: External links open in new tabs with `rel="noopener noreferrer"`
- **Image sizing**: Custom `=WxH` syntax for inline image dimensions
- **HTML5 embeds**: Support for embedded media

### Resizable Container
- Drag handles on edges and corners for resizing
- Size persists across saves via `__ui` config field
- Minimum size constraints to prevent unusable blocks

### Interactive Checkboxes
Checkboxes can be toggled directly in the rendered view:
- Clicking updates both the visual state and underlying markdown
- Changes are saved to workflow state automatically

### Double-Click to Edit
In design mode, double-clicking a text block opens the config panel for editing.

## Technical Decisions

### Why markdown-it over react-markdown?
We switched from react-markdown to markdown-it because:
1. **n8n compatibility**: Follows n8n's proven approach
2. **Plugin ecosystem**: Better plugin support for task lists and custom extensions
3. **Performance**: Faster rendering for large documents
4. **Control**: Direct HTML output allows more styling control

### Image Flickering Prevention
Several techniques prevent image flickering during interactions:

1. **CSS hover instead of React state**: Using `:hover` pseudo-classes instead of `isHovered` state prevents re-renders that cause images to reload.

2. **React.memo with custom comparison**: The `MarkdownView` component uses `React.memo` with a custom `arePropsEqual` function that:
   - Ignores `onEdit` callback changes (stored in a ref)
   - Only re-renders when `content` or `className` actually changes

3. **Pending checkbox updates tracking**: When toggling checkboxes:
   - DOM is updated immediately for instant feedback
   - Expected content is tracked in a module-level Map
   - Re-render is skipped when content matches expected value
   - Data still flows through React state for persistence

### Custom markdown-it-imsize Plugin
The standard `markdown-it-imsize` plugin uses `<img width="X" height="Y">` attributes, but these don't work well with Tailwind's responsive utilities. Our custom implementation:
- Uses inline `style` attributes instead
- Supports both `=WxH` and `=Wx` (auto height) syntax
- Is browser-compatible (no Node.js dependencies)

### UI-Only Component Flag
Components with `uiOnly: true` in metadata are:
- Stored in workflow definitions (for display)
- Excluded from execution graph
- Not included in topological sort for execution order

This prevents documentation nodes from interfering with workflow execution.

## File Structure

```
frontend/src/
├── components/
│   ├── ui/
│   │   └── markdown.tsx          # MarkdownView component
│   └── workflow/
│       └── WorkflowNode.tsx      # Text block rendering in nodes
├── lib/
│   └── markdown-it-imsize.ts     # Custom image sizing plugin
└── types/
    ├── markdown-it-html5-embed.d.ts
    └── markdown-it-task-lists.d.ts

worker/src/components/core/
└── text-block.ts                 # Component definition

backend/src/dsl/
└── compiler.ts                   # Filters uiOnly components
```

## Usage

### Adding to Workflow
1. Drag "Text" component from the component palette
2. Click to select and open config panel
3. Enter markdown content in the textarea
4. Resize using drag handles if needed

### Markdown Syntax Examples

```markdown
# Workflow Documentation

## Checklist
- [x] Configure input parameters
- [ ] Add error handling
- [ ] Test with sample data

## Notes
This workflow processes **security scans** and outputs results.

## Images
![diagram](./diagram.png =400x300)
```

## Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| content | textarea | `""` | Markdown content for notes |

## Related

- [Component Development Guide](./component-development.md)
- [Component SDK Documentation](../.ai/component-sdk.md)
