import { BadRequestException } from '@nestjs/common';
import { Liquid } from 'liquidjs';

export interface RenderedReportTemplate {
  html: string;
  css: string;
}

const liquid = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

function mergeCssIntoHtml(html: string, css: string): string {
  if (!css.trim()) {
    return html;
  }

  const styleTag = `<style>${css}</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleTag}</head>`);
  }

  if (/<html[\s>]/i.test(html) || /<body[\s>]/i.test(html)) {
    return `${styleTag}${html}`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${styleTag}
  </head>
  <body>
    ${html}
  </body>
</html>`;
}

export async function renderReportTemplateDocument(input: {
  htmlTemplate: string;
  css?: string;
  data: Record<string, unknown>;
}): Promise<RenderedReportTemplate> {
  try {
    const renderedCss = input.css ? await liquid.parseAndRender(input.css, input.data) : '';
    const renderedHtml = await liquid.parseAndRender(input.htmlTemplate, input.data);

    return {
      html: mergeCssIntoHtml(renderedHtml, renderedCss),
      css: renderedCss,
    };
  } catch (error) {
    throw new BadRequestException(
      `Failed to render report template: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
