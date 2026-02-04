import React, { memo, useMemo, useCallback, useRef } from 'react';
import MarkdownIt from 'markdown-it';
import markdownItLinkAttributes from 'markdown-it-link-attributes';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItHTML5Embed from 'markdown-it-html5-embed';
import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';
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

const TRUSTED_IFRAME_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'vimeo.com',
  'player.vimeo.com',
];

// Type definitions for DOMPurify hooks
interface SanitizeElementHookEvent {
  tagName: string;
  allowedTags: Record<string, boolean>;
}

interface SanitizeAttributeHookEvent {
  attrName: string;
  attrValue: string;
  keepAttr: boolean;
}

// Configure DOMPurify with security-focused settings
function configureDOMPurify(): void {
  // Hook to validate iframes before allowing them
  DOMPurify.addHook('uponSanitizeElement' as any, (node: Element, data: any) => {
    const hookData = data as SanitizeElementHookEvent;
    if (hookData.tagName === 'iframe') {
      const src = node.getAttribute('src') || '';
      try {
        const url = new URL(src);
        const hostname = url.hostname.toLowerCase();

        // Check if the iframe source is from a trusted domain
        const isTrusted = TRUSTED_IFRAME_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith('.' + domain),
        );

        if (!isTrusted) {
          // Remove untrusted iframes entirely
          node.remove();
        }
      } catch {
        // Invalid URL - remove the iframe
        node.remove();
      }
    }
  });

  // Hook to validate attributes and block dangerous patterns
  DOMPurify.addHook('uponSanitizeAttribute' as any, (_node: Element, data: any) => {
    const hookData = data as SanitizeAttributeHookEvent;
    // Block javascript: and data: URLs in href/src attributes
    if (hookData.attrName === 'href' || hookData.attrName === 'src') {
      const value = hookData.attrValue.toLowerCase().trim();
      if (
        value.startsWith('javascript:') ||
        value.startsWith('data:') ||
        value.startsWith('vbscript:')
      ) {
        hookData.keepAttr = false;
      }
    }

    // Block event handlers (onclick, onerror, etc.)
    if (hookData.attrName.startsWith('on')) {
      hookData.keepAttr = false;
    }
  });
}

// Initialize DOMPurify configuration once
configureDOMPurify();

// DOMPurify configuration object
const DOMPURIFY_CONFIG: Config = {
  // Only allow safe HTML tags
  ALLOWED_TAGS: [
    // Text formatting
    'p',
    'br',
    'b',
    'i',
    'em',
    'strong',
    'u',
    's',
    'strike',
    'del',
    'ins',
    'mark',
    'small',
    'sub',
    'sup',
    'code',
    'pre',
    'kbd',
    'samp',
    'var',
    // Headings
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    // Lists
    'ul',
    'ol',
    'li',
    // Links and media (sanitized by hooks)
    'a',
    'img',
    'iframe',
    'video',
    'audio',
    'source',
    // Tables
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'colgroup',
    'col',
    // Block elements
    'div',
    'span',
    'blockquote',
    'hr',
    'figure',
    'figcaption',
    // Task lists (from markdown-it-task-lists)
    'input',
    'label',
    // Definition lists
    'dl',
    'dt',
    'dd',
    // Other safe elements
    'abbr',
    'address',
    'cite',
    'q',
    'details',
    'summary',
    'time',
  ],
  // Only allow safe attributes
  ALLOWED_ATTR: [
    // Common attributes
    'class',
    'id',
    'title',
    'alt',
    // Links
    'href',
    'target',
    'rel',
    // Media
    'src',
    'width',
    'height',
    'controls',
    'autoplay',
    'loop',
    'muted',
    'poster',
    'preload',
    // Iframes (src validated by hook)
    'allow',
    'allowfullscreen',
    'frameborder',
    'loading',
    // Tables
    'colspan',
    'rowspan',
    'scope',
    // Task list checkboxes
    'type',
    'checked',
    'disabled',
    // Accessibility
    'aria-label',
    'aria-hidden',
    'aria-describedby',
    'role',
    // Data attributes (commonly used by plugins)
    'data-testid',
    'data-task',
    'data-video',
  ],
  // Force all links to open in new tab with security attributes
  ADD_ATTR: ['target', 'rel'],
  // Allow data: URLs only for images (base64 encoded images in markdown)
  ALLOW_DATA_ATTR: true,
  // Return a string, not a DOM element
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
};

/**
 * Sanitizes HTML content to prevent XSS attacks.
 *
 * @param html - Raw HTML string from markdown rendering
 * @returns Sanitized HTML safe for dangerouslySetInnerHTML
 */
function sanitizeHTML(html: string): string {
  // Use .toString() to ensure we return a string even if Trusted Types are enabled
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG).toString();
}

// Initialize markdown-it with plugins (similar to n8n sticky notes)
const md = new MarkdownIt({
  html: true, // Enable HTML for embeds (now safely sanitized by DOMPurify)
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

  // Parse markdown to HTML and sanitize for XSS protection
  const html = useMemo(() => {
    const rendered = md.render(normalized);
    // Make checkboxes interactive by removing disabled attribute
    const withInteractiveCheckboxes = rendered.replace(
      /(<input[^>]*type="checkbox"[^>]*)disabled([^>]*>)/g,
      '$1$2',
    );
    // SECURITY: Sanitize HTML to prevent XSS attacks
    return sanitizeHTML(withInteractiveCheckboxes);
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
