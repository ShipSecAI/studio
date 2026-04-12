import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { renderReportTemplateDocument } from '../report-template-renderer';

describe('report-template-renderer', () => {
  test('renders Liquid HTML and CSS with strict variable substitution', async () => {
    const rendered = await renderReportTemplateDocument({
      htmlTemplate: '<section><h1>{{ report.title }}</h1><p>{{ summary.text }}</p></section>',
      css: 'body { color: {{ branding.color }}; }',
      data: {
        report: { title: 'Q2 Security Review' },
        summary: { text: 'Everything is on fire, but in a manageable way.' },
        branding: { color: '#0f766e' },
      },
    });

    expect(rendered.html).toContain('Q2 Security Review');
    expect(rendered.html).toContain('Everything is on fire');
    expect(rendered.html).toContain('color: #0f766e');
  });

  test('throws a validation-friendly error when required Liquid variables are missing', async () => {
    await expect(
      renderReportTemplateDocument({
        htmlTemplate: '<section>{{ report.title }}</section>',
        css: '',
        data: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
