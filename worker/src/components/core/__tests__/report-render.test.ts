import { beforeEach, describe, expect, mock, test, vi } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import { createMockExecutionContext } from '../../../testing/test-utils';

const renderReportTemplateMock = vi.fn();

mock.module('../../../utils/internal-backend-client', () => ({
  createInternalBackendClient: () => ({
    renderReportTemplate: renderReportTemplateMock,
  }),
}));

describe('core.report.render', () => {
  beforeEach(async () => {
    renderReportTemplateMock.mockReset();
    await import('../report-render');
  });

  test('renders a published template and persists the HTML as an artifact when configured', async () => {
    const component = componentRegistry.get('core.report.render');
    expect(component).toBeDefined();

    renderReportTemplateMock.mockResolvedValue({
      data: {
        templateId: 'template-1',
        versionId: 'version-1',
        versionNumber: 2,
        html: '<html><body><h1>Rendered report</h1></body></html>',
      },
    });

    const upload = vi.fn(async () => ({
      artifactId: 'artifact-1',
      fileId: 'file-1',
      name: 'security-review.html',
      destinations: ['run'] as ('run' | 'library')[],
    }));
    const context = createMockExecutionContext({
      organizationId: 'org-1',
      metadata: {
        runId: 'run-1',
        componentRef: 'core.report.render',
        organizationId: 'org-1',
      },
      artifacts: {
        upload,
        download: vi.fn(),
      },
    });

    const result = await (component!.execute as any)(
      {
        inputs: {
          data: { report: { title: 'Security Review' } },
        },
        params: {
          templateId: 'template-1',
          templateVersionId: 'version-1',
          artifactName: 'security-review',
          saveToRunArtifacts: true,
          publishToArtifactLibrary: false,
        },
      },
      context,
    );

    expect(renderReportTemplateMock).toHaveBeenCalledWith('template-1', {
      versionId: 'version-1',
      data: { report: { title: 'Security Review' } },
    });
    expect(upload).toHaveBeenCalled();
    expect(result.artifactId).toBe('artifact-1');
    expect(result.templateVersionId).toBe('version-1');
  });
});
