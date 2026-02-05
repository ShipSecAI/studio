import React, { memo, useMemo, useCallback, useRef, useEffect, useState } from 'react';
import MarkdownIt from 'markdown-it';
import markdownItLinkAttributes from 'markdown-it-link-attributes';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItHTML5Embed from 'markdown-it-html5-embed';
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

// Initialize mermaid with theme detection
let mermaidInitialized = false;
const initMermaid = () => {
  if (mermaidInitialized) return;

  const isDark = document.documentElement.classList.contains('dark');
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'inherit',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
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
  mermaidInitialized = true;
};

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
    return `<div class="mermaid-diagram" data-mermaid-id="${id}">${str.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
  }

  // Syntax highlighting for code blocks
  if (lang && hljs.getLanguage(lang)) {
    try {
      const highlighted = hljs.highlight(str, {
        language: lang,
        ignoreIllegals: true,
      }).value;
      return `<pre class="hljs code-block" data-language="${lang}"><div class="code-header"><span class="code-language">${lang}</span><button class="copy-button" data-code="${encodeURIComponent(str)}"><svg class="copy-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Copy</span></button></div><code class="language-${lang}">${highlighted}</code></pre>`;
    } catch (e) {
      console.error('Highlight error:', e);
    }
  }

  // Auto-detect language if not specified
  try {
    const detected = hljs.highlightAuto(str);
    const language = detected.language || 'text';
    return `<pre class="hljs code-block" data-language="${language}"><div class="code-header"><span class="code-language">${language}</span><button class="copy-button" data-code="${encodeURIComponent(str)}"><svg class="copy-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Copy</span></button></div><code>${detected.value}</code></pre>`;
  } catch (e) {
    console.error('Highlight auto error:', e);
  }

  // Fallback to plain code block
  return `<pre class="hljs code-block"><div class="code-header"><span class="code-language">text</span><button class="copy-button" data-code="${encodeURIComponent(str)}"><svg class="copy-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Copy</span></button></div><code>${escapeHtml(str)}</code></pre>`;
}

// Initialize markdown-it with plugins and syntax highlighting
const md = new MarkdownIt({
  html: true, // Enable HTML for embeds (iframes are sanitized by the plugin)
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

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

      if (id && code && !diagram.querySelector('svg')) {
        try {
          const { svg } = await mermaid.render(id, code);
          diagram.innerHTML = svg;
          diagram.classList.add('mermaid-rendered');
        } catch (error) {
          console.error('Mermaid render error:', error);
          diagram.innerHTML = `<div class="mermaid-error">Failed to render diagram</div><pre>${code}</pre>`;
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

  // Update copy button states
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !copiedCode) return;

    const copyButtons = container.querySelectorAll('.copy-button');
    copyButtons.forEach((button) => {
      const code = button.getAttribute('data-code');
      const textSpan = button.querySelector('.copy-text');
      if (code && textSpan) {
        if (decodeURIComponent(code) === copiedCode) {
          textSpan.textContent = 'Copied!';
          button.classList.add('copied');
        } else {
          textSpan.textContent = 'Copy';
          button.classList.remove('copied');
        }
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
