declare module 'markdown-it-html5-embed' {
  import type MarkdownIt from 'markdown-it';

  interface HTML5EmbedOptions {
    html5embed?: {
      useImageSyntax?: boolean;
      useLinkSyntax?: boolean;
      attributes?: Record<string, string>;
      is?: (url: string) => boolean;
      renderFn?: (code: string, sourceURL: string) => string;
    };
  }

  function markdownItHTML5Embed(md: MarkdownIt, options?: HTML5EmbedOptions): void;

  export = markdownItHTML5Embed;
}
