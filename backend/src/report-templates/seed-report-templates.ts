import type {
  NewReportTemplate,
  NewReportTemplateVersion,
  ReportTemplateScope,
  ReportTemplateStatus,
  ReportTemplateVisibility,
  ReportTemplateVersionKind,
} from '../database/schema/report-templates';

export interface SeedReportTemplate {
  template: Omit<
    NewReportTemplate,
    'publishedVersionId' | 'draftVersionId' | 'draftSessionId' | 'createdAt' | 'updatedAt'
  >;
  publishedVersion: Omit<NewReportTemplateVersion, 'templateId' | 'createdAt'>;
}

function executiveSummaryTemplate(): SeedReportTemplate {
  return {
    template: {
      organizationId: null,
      name: 'Executive Security Summary',
      slug: 'builtin-executive-security-summary',
      description:
        'High-level report for leaders with risk posture, key findings, and remediation priorities.',
      category: 'executive',
      status: 'published' satisfies ReportTemplateStatus,
      scope: 'builtin' satisfies ReportTemplateScope,
      visibility: 'library' satisfies ReportTemplateVisibility,
      createdBy: 'system',
      publishedAt: new Date(),
    },
    publishedVersion: {
      versionNumber: 1,
      kind: 'published' satisfies ReportTemplateVersionKind,
      name: 'Executive Security Summary',
      description:
        'High-level report for leaders with risk posture, key findings, and remediation priorities.',
      htmlTemplate: `
<section class="report-shell">
  <header class="hero">
    <div>
      <p class="eyebrow">{{ organization.name }}</p>
      <h1>{{ report.title }}</h1>
      <p class="subtitle">{{ report.subtitle }}</p>
    </div>
    <div class="score-card">
      <span class="score-label">Risk Score</span>
      <strong class="score">{{ report.riskScore }}</strong>
      <span class="score-range">{{ report.riskRating }}</span>
    </div>
  </header>

  <section class="grid stats">
    <article class="stat"><span>Total Findings</span><strong>{{ summary.totalFindings }}</strong></article>
    <article class="stat"><span>Critical</span><strong>{{ summary.critical }}</strong></article>
    <article class="stat"><span>High</span><strong>{{ summary.high }}</strong></article>
    <article class="stat"><span>Assets Reviewed</span><strong>{{ summary.assetsReviewed }}</strong></article>
  </section>

  <section class="section">
    <h2>Executive Summary</h2>
    <p>{{ summary.executiveNarrative }}</p>
  </section>

  <section class="section">
    <h2>Top Risks</h2>
    <div class="finding-list">
      {% for finding in findings %}
      <article class="finding">
        <div class="finding-header">
          <span class="severity severity-{{ finding.severity | downcase }}">{{ finding.severity }}</span>
          <h3>{{ finding.title }}</h3>
        </div>
        <p>{{ finding.summary }}</p>
        <p class="meta">Affected asset: {{ finding.asset }}</p>
      </article>
      {% endfor %}
    </div>
  </section>
</section>`,
      css: `
:root {
  --bg: #f4f6fb;
  --panel: #ffffff;
  --text: #0f172a;
  --muted: #475569;
  --line: #dbe4f0;
  --accent: #0f766e;
  --critical: #b91c1c;
  --high: #c2410c;
  --medium: #92400e;
  --low: #1d4ed8;
}
body {
  margin: 0;
  padding: 32px;
  background: linear-gradient(180deg, #eef4ff 0%, var(--bg) 100%);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.report-shell { max-width: 960px; margin: 0 auto; }
.hero, .section, .stat, .finding { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; }
.hero { display: flex; justify-content: space-between; gap: 24px; padding: 28px; }
.eyebrow { text-transform: uppercase; letter-spacing: .16em; color: var(--accent); font-size: 12px; margin: 0 0 8px; }
h1 { margin: 0; font-size: 40px; line-height: 1.05; }
.subtitle { margin-top: 12px; color: var(--muted); max-width: 560px; }
.score-card { min-width: 180px; padding: 20px; border-radius: 16px; background: #0f172a; color: white; display: grid; gap: 8px; align-content: start; }
.score { font-size: 52px; line-height: 1; }
.grid.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
.stat { padding: 18px; display: grid; gap: 8px; }
.stat span { color: var(--muted); font-size: 13px; }
.stat strong { font-size: 30px; }
.section { padding: 24px; margin-top: 18px; }
.section h2 { margin-top: 0; }
.finding-list { display: grid; gap: 14px; }
.finding { padding: 18px; }
.finding-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.finding-header h3 { margin: 0; font-size: 20px; }
.severity { display: inline-flex; align-items: center; justify-content: center; min-width: 92px; height: 28px; border-radius: 999px; color: white; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.severity-critical { background: var(--critical); }
.severity-high { background: var(--high); }
.severity-medium { background: var(--medium); }
.severity-low { background: var(--low); }
.meta { color: var(--muted); font-size: 13px; }
@media print { body { padding: 0; background: white; } }
`,
      inputSchema: {
        type: 'object',
        required: ['organization', 'report', 'summary', 'findings'],
      },
      sampleData: {
        organization: { name: 'Acme Corp' },
        report: {
          title: 'Q2 Security Executive Summary',
          subtitle:
            'High-level review of the most important security risks and remediation priorities.',
          riskScore: 74,
          riskRating: 'Elevated',
        },
        summary: {
          totalFindings: 18,
          critical: 2,
          high: 5,
          assetsReviewed: 47,
          executiveNarrative:
            'Overall security posture improved from the previous quarter, but exposed credentials and public access paths remain the highest-priority issues.',
        },
        findings: [
          {
            severity: 'Critical',
            title: 'Public S3 bucket with sensitive exports',
            summary: 'A public object path exposes backup exports containing customer metadata.',
            asset: 'prod-data-exports',
          },
          {
            severity: 'High',
            title: 'Unrotated CI credential',
            summary:
              'A long-lived CI token is still active and has access to production deployment workflows.',
            asset: 'github-actions',
          },
        ],
      },
      createdBy: 'system',
    },
  };
}

function technicalFindingsTemplate(): SeedReportTemplate {
  return {
    template: {
      organizationId: null,
      name: 'Technical Findings Register',
      slug: 'builtin-technical-findings-register',
      description: 'Detailed findings register for engineering and security teams.',
      category: 'technical',
      status: 'published' satisfies ReportTemplateStatus,
      scope: 'builtin' satisfies ReportTemplateScope,
      visibility: 'library' satisfies ReportTemplateVisibility,
      createdBy: 'system',
      publishedAt: new Date(),
    },
    publishedVersion: {
      versionNumber: 1,
      kind: 'published' satisfies ReportTemplateVersionKind,
      name: 'Technical Findings Register',
      description: 'Detailed findings register for engineering and security teams.',
      htmlTemplate: `
<section class="shell">
  <header class="topbar">
    <div>
      <h1>{{ report.title }}</h1>
      <p>{{ report.generatedAt }}</p>
    </div>
    <div class="badge">{{ report.scope }}</div>
  </header>

  <section class="section">
    <h2>Findings Register</h2>
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Title</th>
          <th>Asset</th>
          <th>Owner</th>
          <th>Remediation</th>
        </tr>
      </thead>
      <tbody>
        {% for finding in findings %}
        <tr>
          <td><span class="pill sev-{{ finding.severity | downcase }}">{{ finding.severity }}</span></td>
          <td>{{ finding.title }}</td>
          <td>{{ finding.asset }}</td>
          <td>{{ finding.owner }}</td>
          <td>{{ finding.remediation }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </section>
</section>`,
      css: `
body {
  margin: 0;
  padding: 24px;
  background: #f8fafc;
  color: #0f172a;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.shell { max-width: 1040px; margin: 0 auto; }
.topbar, .section { background: white; border: 1px solid #e2e8f0; border-radius: 16px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; margin-bottom: 18px; }
.topbar h1 { margin: 0 0 8px; font-size: 34px; }
.topbar p { margin: 0; color: #64748b; }
.badge { background: #dbeafe; color: #1d4ed8; padding: 8px 12px; border-radius: 999px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
.section { padding: 20px 22px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 14px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #475569; }
.pill { display: inline-block; padding: 6px 10px; border-radius: 999px; color: white; font-size: 12px; font-weight: 700; }
.sev-critical { background: #b91c1c; }
.sev-high { background: #c2410c; }
.sev-medium { background: #a16207; }
.sev-low { background: #2563eb; }
`,
      inputSchema: {
        type: 'object',
        required: ['report', 'findings'],
      },
      sampleData: {
        report: {
          title: 'Engineering Findings Register',
          generatedAt: 'Generated on 2026-04-11',
          scope: 'Platform Security',
        },
        findings: [
          {
            severity: 'High',
            title: 'Broad IAM role trust policy',
            asset: 'prod-deployer-role',
            owner: 'Platform Team',
            remediation:
              'Restrict the trust policy to the CI role and rotate the existing credentials.',
          },
          {
            severity: 'Medium',
            title: 'Missing HSTS on edge endpoint',
            asset: 'app.shipsec.ai',
            owner: 'Web Team',
            remediation: 'Enable HSTS with a one-year max-age and includeSubDomains.',
          },
        ],
      },
      createdBy: 'system',
    },
  };
}

export const SEED_REPORT_TEMPLATES: SeedReportTemplate[] = [
  executiveSummaryTemplate(),
  technicalFindingsTemplate(),
];
