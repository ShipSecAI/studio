import React, { memo, useMemo, useCallback, useRef } from 'react';
import MarkdownIt from 'markdown-it';
import markdownItLinkAttributes from 'markdown-it-link-attributes';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItHTML5Embed from 'markdown-it-html5-embed';
import markdownItImsize from '@/lib/markdown-it-imsize';
import { cn } from '@/lib/utils';

interface MarkdownViewProps {
  content: string;
  className?: string;
  dataTestId?: string;
  // When provided, enables interactive task checkboxes and will be called
  // with the updated markdown string after a toggle.
  onEdit?: (next: string) => void;
}

// Initialize markdown-it with plugins (similar to n8n sticky notes)
const md = new MarkdownIt({
  html: true, // Enable HTML for embeds (iframes are sanitized by the plugin)
  breaks: true, // Convert line breaks to <br>
  linkify: true, // Auto-convert URLs to links
})
  .use(markdownItTaskLists, {
    enabled: true,
    label: true,
  })
  .use(markdownItImsize, {
    autofill: true, // Auto-fill missing dimension to maintain aspect ratio
  })
  .use(markdownItHTML5Embed, {
    html5embed: {
      useImageSyntax: true, // ![](video-url) syntax
      useLinkSyntax: true, // @[youtube](video-id) syntax
    },
  })
  .use(markdownItLinkAttributes, {
    matcher(href: string) {
      // Only apply to external links, not embeds
      return (
        href.startsWith('http') && !href.includes('youtube.com') && !href.includes('vimeo.com')
      );
    },
    attrs: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  });

function toggleNthTask(md: string, index: number): string {
  let counter = 0;
  return md.replace(
    /(^|\n)([\t ]*)([-*]|\d+\.)[\t ]+\[( |x|X)\]/g,
    (match, prefix: string, indent: string, bullet: string, mark: string) => {
      if (counter === index) {
        const next = mark.toLowerCase() === 'x' ? ' ' : 'x';
        counter++;
        return `${prefix}${indent}${bullet} [${next}]`;
      }
      counter++;
      return match;
    },
  );
}

// Track expected content after checkbox toggles to skip re-renders
// Key: dataTestId, Value: expected content string
const pendingCheckboxUpdates = new Map<string, string>();

// Custom comparison for memo - only re-render when content/className/dataTestId change
// Ignore onEdit since it's stored in a ref and changes every parent render
function arePropsEqual(prevProps: MarkdownViewProps, nextProps: MarkdownViewProps): boolean {
  const key = nextProps.dataTestId || '__default__';
  const expectedContent = pendingCheckboxUpdates.get(key);

  // Check if this content change was from a checkbox toggle we already handled
  if (expectedContent !== undefined && nextProps.content === expectedContent) {
    console.log('[MarkdownView] Skipping re-render - checkbox update already applied to DOM');
    pendingCheckboxUpdates.delete(key);
    return true; // Skip re-render, we already updated the DOM
  }

  // Clean up if content doesn't match (user edited content differently)
  if (expectedContent !== undefined) {
    pendingCheckboxUpdates.delete(key);
  }

  const equal =
    prevProps.content === nextProps.content &&
    prevProps.className === nextProps.className &&
    prevProps.dataTestId === nextProps.dataTestId;
  if (!equal) {
    console.log('[MarkdownView] Props changed, will re-render');
  }
  return equal;
}

// Use memo to prevent re-renders when parent state changes (e.g., drag, selection)
// This prevents image flickering caused by dangerouslySetInnerHTML re-injecting the DOM
export const MarkdownView = memo(function MarkdownView({
  content,
  className,
  dataTestId,
  onEdit,
}: MarkdownViewProps) {
  console.log('[MarkdownView] Rendering with content length:', content.length);
  // Store onEdit in a ref so we can use a stable callback without re-renders
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  // Normalize common markdown typos
  const normalized: string = useMemo(
    () =>
      content.replace(/(^|\n)[\t ]*-\[( |x|X)\]/g, (_m, prefix, mark) => `${prefix}- [${mark}]`),
    [content],
  );

  // Parse markdown to HTML
  const html = useMemo(() => {
    const rendered = md.render(normalized);
    // Make checkboxes interactive by removing disabled attribute
    return rendered.replace(/(<input[^>]*type="checkbox"[^>]*)disabled([^>]*>)/g, '$1$2');
  }, [normalized]);

  // Handle clicks on interactive elements - use useCallback for stable reference
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Handle checkbox clicks for interactive task lists
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
      if (!onEditRef.current) {
        // Even if not editable, prevent checkbox toggle and stop propagation
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Find which checkbox was clicked
      const container = e.currentTarget as HTMLDivElement;
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      const index = Array.from(checkboxes).indexOf(target as HTMLInputElement);

      if (index !== -1) {
        // Get current normalized content for toggling
        const currentContent = (container as any).__markdownContent || '';
        const toggled = toggleNthTask(currentContent, index);

        // 1. Toggle the checkbox visually in the DOM (prevents flicker)
        const checkbox = target as HTMLInputElement;
        checkbox.checked = !checkbox.checked;

        // 2. Update the stored content so future toggles work correctly
        (container as any).__markdownContent = toggled;

        // 3. Register expected content to skip the re-render when parent updates
        const key = (container as any).__dataTestId || '__default__';
        pendingCheckboxUpdates.set(key, toggled);

        // 4. Notify parent of the change (for persistence)
        onEditRef.current(toggled);
      }
      return;
    }

    // For links, allow default behavior (open in new tab) but stop propagation
    // to prevent parent node from being selected
    if (target.tagName === 'A' || target.closest('a')) {
      e.stopPropagation();
      return;
    }

    // Stop all other clicks from bubbling to prevent triggering parent handlers
    e.stopPropagation();
  }, []);

  // Use capture phase for mousedown to intercept before React Flow can handle it
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // For checkboxes, prevent React Flow from handling the mousedown
    // This ensures our click handler will work properly
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
      e.stopPropagation();
    }

    // For links, also prevent React Flow interference
    if (target.tagName === 'A' || target.closest('a')) {
      e.stopPropagation();
    }
  }, []);

  // Store normalized content and dataTestId on the DOM element for the click handler
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (el) {
      const element = el as any;
      element.__markdownContent = normalized;
      element.__dataTestId = dataTestId;
    }
  };

  // Prevent wheel events from propagating to React Flow canvas (which would zoom instead of scroll)
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={setRef}
      className={cn(className)}
      data-testid={dataTestId}
      onMouseDownCapture={handleMouseDown}
      onClick={handleClick}
      onWheel={handleWheel}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}, arePropsEqual);

export default MarkdownView;
