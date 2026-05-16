import React, { memo, useMemo, useCallback, useRef, useEffect, useState } from 'react';
import MarkdownIt from 'markdown-it';
import markdownItLinkAttributes from 'markdown-it-link-attributes';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItHTML5Embed from 'markdown-it-html5-embed';
import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';
import markdownItImsize from '@/lib/markdown-it-imsize';
import hljs from 'highlight.js';
import mermaid from 'mermaid';
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
    // Code block copy button and SVG icon
    'button',
    'svg',
    'rect',
    'path',
    'polyline',
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
    'data-code',
    'data-mermaid-id',
    // SVG attributes (for code block copy icon)
    'viewBox',
    'stroke',
    'stroke-width',
    'fill',
    'points',
    'd',
    'x',
    'y',
    'rx',
    'ry',
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

// Initialize mermaid with theme detection. Mermaid keeps global config, so
// refresh when the app theme changes instead of only doing it once forever.
let mermaidTheme: 'default' | 'dark' | null = null;
const initMermaid = () => {
  const isDark = document.documentElement.classList.contains('dark');
  const theme = isDark ? 'dark' : 'default';
  if (mermaidTheme === theme) return;

  mermaid.initialize({
    startOnLoad: false,
    theme,
    suppressErrorRendering: true,
    securityLevel: 'strict',
    fontFamily: 'inherit',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: false,
      curve: 'basis',
    },
    themeVariables: isDark
      ? {
          primaryColor: '#f97316',
          primaryTextColor: '#fff',
          primaryBorderColor: '#f97316',
          lineColor: '#666',
          secondaryColor: '#374151',
          tertiaryColor: '#1f2937',
          background: '#171717',
          mainBkg: '#1f2937',
          nodeBorder: '#f97316',
          textColor: '#e5e7eb',
        }
      : {
          primaryColor: '#f97316',
          primaryTextColor: '#000',
          primaryBorderColor: '#f97316',
          lineColor: '#374151',
          secondaryColor: '#f3f4f6',
          tertiaryColor: '#e5e7eb',
        },
  });
  mermaidTheme = theme;
};

function cleanupMermaidRenderArtifacts(id: string, owner: Element): void {
  for (const artifactId of [id, `d${id}`, `i${id}`]) {
    const artifact = document.getElementById(artifactId);
    if (artifact && !owner.contains(artifact)) {
      artifact.remove();
    }
  }
}

function renderMermaidFallback(diagram: Element, code: string): void {
  diagram.replaceChildren();
  const errorEl = document.createElement('div');
  errorEl.className = 'mermaid-error';
  errorEl.textContent = 'Diagram could not be rendered';
  const pre = document.createElement('pre');
  pre.textContent = code;
  diagram.append(errorEl, pre);
  diagram.classList.add('mermaid-failed');
  diagram.setAttribute('data-mermaid-rendered', 'true');
}

// Helper function to escape HTML - standalone to avoid circular reference
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Syntax highlighting function with explicit return type
function highlightCode(str: string, lang: string): string {
  // Handle mermaid diagrams - return placeholder that will be processed
  if (lang === 'mermaid') {
    const id = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
    return `<div class="mermaid-diagram" data-mermaid-id="${id}">${escapeHtml(str)}</div>`;
  }

  // Syntax highlighting for code blocks
  if (lang && hljs.getLanguage(lang)) {
    try {
      const highlighted = hljs.highlight(str, {
        language: lang,
        ignoreIllegals: true,
      }).value;
      return `<pre class="hljs code-block" data-language="${lang}"><div class="code-header"><span class="code-language">${lang}</span><button class="copy-button" data-code="${encodeURIComponent(str)}"><svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div><code class="language-${lang}">${highlighted}</code></pre>`;
    } catch (e) {
      console.error('Highlight error:', e);
    }
  }

  // Auto-detect language if not specified or not recognized
  try {
    const detected = hljs.highlightAuto(str);
    // Prefer the originally specified language label over auto-detected one
    const language = lang || detected.language || 'text';
    return `<pre class="hljs code-block" data-language="${language}"><div class="code-header"><span class="code-language">${language}</span><button class="copy-button" data-code="${encodeURIComponent(str)}"><svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div><code>${detected.value}</code></pre>`;
  } catch (e) {
    console.error('Highlight auto error:', e);
  }

  // Fallback to plain code block
  return `<pre class="hljs code-block"><div class="code-header"><span class="code-language">text</span><button class="copy-button" data-code="${encodeURIComponent(str)}"><svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div><code>${escapeHtml(str)}</code></pre>`;
}

// Initialize markdown-it with plugins and syntax highlighting
const md = new MarkdownIt({
  html: true, // Enable HTML for embeds (now safely sanitized by DOMPurify)
  breaks: true, // Convert line breaks to <br>
  linkify: true, // Auto-convert URLs to links
  highlight: highlightCode,
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
  // Store onEdit in a ref so we can use a stable callback without re-renders
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

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

  // Initialize mermaid and render diagrams
  useEffect(() => {
    initMermaid();

    const container = containerRef.current;
    if (!container) return;

    // Find and render mermaid diagrams
    const mermaidDiagrams = container.querySelectorAll('.mermaid-diagram');
    mermaidDiagrams.forEach(async (diagram) => {
      const id = diagram.getAttribute('data-mermaid-id');
      const code = diagram.textContent;

      if (id && code && diagram.getAttribute('data-mermaid-rendered') !== 'true') {
        try {
          const parseResult = await mermaid.parse(code, { suppressErrors: true });
          if (!parseResult) {
            throw new Error('Invalid Mermaid diagram syntax');
          }
          const { svg } = await mermaid.render(id, code);
          diagram.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          }).toString();
          diagram.classList.add('mermaid-rendered');
          diagram.setAttribute('data-mermaid-rendered', 'true');
        } catch (error) {
          console.warn('Mermaid render skipped:', error);
          cleanupMermaidRenderArtifacts(id, diagram);
          renderMermaidFallback(diagram, code);
        }
      }
    });
  }, [html]);

  // Handle copy button clicks
  const handleCopyClick = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);

  // Handle clicks on interactive elements - use useCallback for stable reference
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;

      // Handle copy button clicks
      if (target.closest('.copy-button')) {
        e.preventDefault();
        e.stopPropagation();
        const button = target.closest('.copy-button') as HTMLButtonElement;
        const code = button.getAttribute('data-code');
        if (code) {
          handleCopyClick(decodeURIComponent(code));
        }
        return;
      }

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
    },
    [handleCopyClick],
  );

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

    // For copy buttons
    if (target.closest('.copy-button')) {
      e.stopPropagation();
    }
  }, []);

  // Store normalized content and dataTestId on the DOM element for the click handler
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

  // Update copy button states — swap icon between copy and check
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const copyIcon =
      '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const checkIcon =
      '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    const copyButtons = container.querySelectorAll('.copy-button');
    copyButtons.forEach((button) => {
      const code = button.getAttribute('data-code');
      if (!code) return;
      if (copiedCode && decodeURIComponent(code) === copiedCode) {
        button.innerHTML = checkIcon;
        button.classList.add('copied');
      } else {
        button.innerHTML = copyIcon;
        button.classList.remove('copied');
      }
    });
  }, [copiedCode]);

  return (
    <div
      ref={setRef}
      className={cn('markdown-content', className)}
      data-testid={dataTestId}
      onMouseDownCapture={handleMouseDown}
      onClick={handleClick}
      onWheel={handleWheel}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}, arePropsEqual);

export default MarkdownView;
