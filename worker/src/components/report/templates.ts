import { SEVERITY_COLORS } from './renderer';

export interface StandardTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  inputSchema: Record<string, unknown>;
}

export const STANDARD_TEMPLATES: StandardTemplate[] = [
  {
    id: 'pentest-standard-v1',
    name: 'Penetration Test Report',
    description: 'Standard penetration testing report with findings table and severity breakdown',
    template: generatePentestTemplate(),
    inputSchema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
              title: { type: 'string' },
              description: { type: 'string' },
              cve: { type: 'string' },
              cvss: { type: 'number' },
              proof: { type: 'string' },
              remediation: { type: 'string' },
            },
            required: ['severity', 'title', 'description'],
          },
        },
        metadata: {
          type: 'object',
          properties: {
            clientName: { type: 'string' },
            projectName: { type: 'string' },
            date: { type: 'string' },
            reportTitle: { type: 'string' },
            preparedBy: { type: 'string' },
          },
        },
        scope: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  target: { type: 'string' },
                  type: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    },
  },
  {
    id: 'vuln-scan-summary-v1',
    name: 'Vulnerability Scan Summary',
    description: 'Summary of vulnerability scan results with severity breakdown',
    template: generateVulnScanTemplate(),
    inputSchema: {
      type: 'object',
      properties: {
        scanResults: {
          type: 'object',
          properties: {
            totalHosts: { type: 'number' },
            totalVulnerabilities: { type: 'number' },
            critical: { type: 'number' },
            high: { type: 'number' },
            medium: { type: 'number' },
            low: { type: 'number' },
            info: { type: 'number' },
          },
        },
        targets: {
          type: 'array',
          items: { type: 'string' },
        },
        metadata: {
          type: 'object',
          properties: {
            scanDate: { type: 'string' },
            scannerType: { type: 'string' },
            reportTitle: { type: 'string' },
          },
        },
      },
    },
  },
  {
    id: 'recon-report-v1',
    name: 'Reconnaissance Report',
    description: 'Discovery report for subdomains, ports, and technologies',
    template: generateReconTemplate(),
    inputSchema: {
      type: 'object',
      properties: {
        subdomains: {
          type: 'array',
          items: { type: 'string' },
        },
        ports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              host: { type: 'string' },
              port: { type: 'number' },
              service: { type: 'string' },
              version: { type: 'string' },
            },
          },
        },
        technologies: {
          type: 'array',
          items: { type: 'string' },
        },
        metadata: {
          type: 'object',
          properties: {
            target: { type: 'string' },
            scanDate: { type: 'string' },
            reportTitle: { type: 'string' },
          },
        },
      },
    },
  },
  {
    id: 'compliance-checklist-v1',
    name: 'Compliance Report',
    description: 'PCI/HIPAA/SOC2 style compliance checklist',
    template: generateComplianceTemplate(),
    inputSchema: {
      type: 'object',
      properties: {
        framework: { type: 'string', enum: ['PCI-DSS', 'HIPAA', 'SOC2', 'ISO27001'] },
        controls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string', enum: ['pass', 'fail', 'warning', 'na'] },
              evidence: { type: 'string' },
              notes: { type: 'string' },
            },
          },
        },
        metadata: {
          type: 'object',
          properties: {
            organization: { type: 'string' },
            assessmentDate: { type: 'string' },
            auditor: { type: 'string' },
          },
        },
      },
    },
  },
];

function generatePentestTemplate(): string {
  return `
<div class="container">
  <h1>{{metadata.reportTitle || 'Penetration Test Report'}}</h1>
  <p class="meta">
    <strong>Client:</strong> {{metadata.clientName || 'Not specified'}} &nbsp;|&nbsp;
    <strong>Date:</strong> {{metadata.date || new Date().toISOString().split('T')[0]}} &nbsp;|&nbsp;
    <strong>Prepared by:</strong> {{metadata.preparedBy || 'ShipSec Security Team'}}
  </p>

  <h2>Executive Summary</h2>
  <p style="margin-bottom: 16px;">
    This security assessment was conducted to identify vulnerabilities and security weaknesses
    in the specified targets. A total of <strong>{{findings.length}}</strong> findings were identified.
  </p>

  <div class="summary-grid">
    <div class="summary-card critical">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.critical}">{{#each findings as finding}}{{#if finding.severity === 'critical'}}1{{/if}}{{/each}}</div>
      <div class="summary-label">Critical</div>
    </div>
    <div class="summary-card high">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.high}">{{#each findings as finding}}{{#if finding.severity === 'high'}}1{{/if}}{{/each}}</div>
      <div class="summary-label">High</div>
    </div>
    <div class="summary-card medium">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.medium}">{{#each findings as finding}}{{#if finding.severity === 'medium'}}1{{/if}}{{/each}}</div>
      <div class="summary-label">Medium</div>
    </div>
    <div class="summary-card low">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.low}">{{#each findings as finding}}{{#if finding.severity === 'low'}}1{{/if}}{{/each}}</div>
      <div class="summary-label">Low</div>
    </div>
    <div class="summary-card info">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.info}">{{#each findings as finding}}{{#if finding.severity === 'info'}}1{{/if}}{{/each}}</div>
      <div class="summary-label">Info</div>
    </div>
  </div>

  <div class="page-break"></div>

  <h2>Detailed Findings</h2>
  {{#each findings as finding}}
  <div class="finding {{finding.severity}}">
    <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 12px;">
      <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #1f2937;">
        {{finding.title}}
      </h3>
      <span class="severity-badge {{finding.severity}}">{{finding.severity}}</span>
    </div>
    {{#if finding.cve}}
    <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280;"><strong>CVE:</strong> {{finding.cve}}</p>
    {{/if}}
    {{#if finding.cvss}}
    <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280;"><strong>CVSS:</strong> {{finding.cvss}}</p>
    {{/if}}
    <p style="margin: 0 0 12px 0; font-size: 14px; line-height: 1.6; color: #374151;">{{finding.description}}</p>
    {{#if finding.proof}}
    <div style="margin-bottom: 12px;">
      <strong style="font-size: 13px; color: #374151;">Proof:</strong>
      <pre style="margin: 8px 0; padding: 12px; background: #1f2937; color: #e5e7eb; border-radius: 6px; font-size: 12px; overflow-x: auto;">{{finding.proof}}</pre>
    </div>
    {{/if}}
    {{#if finding.remediation}}
    <div>
      <strong style="font-size: 13px; color: #374151;">Remediation:</strong>
      <p style="margin: 8px 0 0 0; font-size: 14px; line-height: 1.6; color: #374151;">{{finding.remediation}}</p>
    </div>
    {{/if}}
  </div>
  {{/each}}

  {{#if scope.length}}
  <div class="page-break"></div>
  <h2>Scope</h2>
  <table>
    <thead>
      <tr>
        <th>Target</th>
        <th>Type</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      {{#each scope as item}}
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; color: #374151;">{{#if typeof item === 'string'}}{{item}}{{else}}{{item.target}}{{/if}}</td>
        <td style="padding: 12px; color: #6b7280;">{{#if typeof item === 'string'}}-{{else}}{{item.type || '-'}}{{/if}}</td>
        <td style="padding: 12px; color: #6b7280;">{{#if typeof item === 'string'}}-{{else}}{{item.description || '-'}}{{/if}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  {{/if}}

  <h2>Methodology</h2>
  <p style="color: #6b7280;">
    This assessment was conducted following industry-standard penetration testing methodologies
    including OWASP Testing Guide, PTES, and OSSTMM. Testing included automated vulnerability
    scanning, manual testing, and validation of findings.
  </p>
</div>
`;
}

function generateVulnScanTemplate(): string {
  return `
<div class="container">
  <h1>{{metadata.reportTitle || 'Vulnerability Scan Summary'}}</h1>
  <p class="meta">
    <strong>Target:</strong> {{metadata.target || 'Not specified'}} &nbsp;|&nbsp;
    <strong>Scan Date:</strong> {{metadata.scanDate || new Date().toISOString().split('T')[0]}} &nbsp;|&nbsp;
    <strong>Scanner:</strong> {{metadata.scannerType || 'ShipSec Scanner'}}
  </p>

  <h2>Executive Summary</h2>
  <p style="margin-bottom: 16px;">
    The vulnerability scan identified <strong>{{scanResults.totalVulnerabilities}}</strong> vulnerabilities
    across <strong>{{scanResults.totalHosts}}</strong> target hosts.
  </p>

  <div class="summary-grid">
    <div class="summary-card critical">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.critical}">{{scanResults.critical || 0}}</div>
      <div class="summary-label">Critical</div>
    </div>
    <div class="summary-card high">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.high}">{{scanResults.high || 0}}</div>
      <div class="summary-label">High</div>
    </div>
    <div class="summary-card medium">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.medium}">{{scanResults.medium || 0}}</div>
      <div class="summary-label">Medium</div>
    </div>
    <div class="summary-card low">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.low}">{{scanResults.low || 0}}</div>
      <div class="summary-label">Low</div>
    </div>
    <div class="summary-card info">
      <div class="summary-count" style="color: ${SEVERITY_COLORS.info}">{{scanResults.info || 0}}</div>
      <div class="summary-label">Info</div>
    </div>
  </div>

  {{#if targets.length}}
  <h2>Scanned Targets</h2>
  <table>
    <thead>
      <tr>
        <th>Target</th>
      </tr>
    </thead>
    <tbody>
      {{#each targets as target}}
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; color: #374151;">{{target}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  {{/if}}
</div>
`;
}

function generateReconTemplate(): string {
  return `
<div class="container">
  <h1>{{metadata.reportTitle || 'Reconnaissance Report'}}</h1>
  <p class="meta">
    <strong>Target:</strong> {{metadata.target || 'Not specified'}} &nbsp;|&nbsp;
    <strong>Scan Date:</strong> {{metadata.scanDate || new Date().toISOString().split('T')[0]}}
  </p>

  <h2>Executive Summary</h2>
  <p style="margin-bottom: 16px;">
    Reconnaissance identified <strong>{{subdomains.length}}</strong> subdomains,
    <strong>{{ports.length}}</strong> open ports, and <strong>{{technologies.length}}</strong> technologies.
  </p>

  {{#if subdomains.length}}
  <h2>Discovered Subdomains</h2>
  <div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0;">
    {{#each subdomains as subdomain}}
    <span style="padding: 4px 12px; background: #f3f4f6; border-radius: 4px; font-size: 13px;">{{subdomain}}</span>
    {{/each}}
  </div>
  {{/if}}

  {{#if ports.length}}
  <h2>Open Ports</h2>
  <table>
    <thead>
      <tr>
        <th>Host</th>
        <th>Port</th>
        <th>Service</th>
        <th>Version</th>
      </tr>
    </thead>
    <tbody>
      {{#each ports as port}}
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; color: #374151;">{{port.host}}</td>
        <td style="padding: 12px; color: #374151;">{{port.port}}</td>
        <td style="padding: 12px; color: #6b7280;">{{port.service}}</td>
        <td style="padding: 12px; color: #6b7280;">{{port.version || '-'}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  {{/if}}

  {{#if technologies.length}}
  <h2>Identified Technologies</h2>
  <div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0;">
    {{#each technologies as tech}}
    <span style="padding: 4px 12px; background: #eff6ff; color: #2563eb; border-radius: 4px; font-size: 13px;">{{tech}}</span>
    {{/each}}
  </div>
  {{/if}}
</div>
`;
}

function generateComplianceTemplate(): string {
  return `
<div class="container">
  <h1>{{framework}} Compliance Report</h1>
  <p class="meta">
    <strong>Organization:</strong> {{metadata.organization || 'Not specified'}} &nbsp;|&nbsp;
    <strong>Assessment Date:</strong> {{metadata.assessmentDate || new Date().toISOString().split('T')[0]}} &nbsp;|&nbsp;
    <strong>Auditor:</strong> {{metadata.auditor || 'ShipSec Team'}}
  </p>

  <h2>Compliance Summary</h2>
  <p style="margin-bottom: 16px;">
    This report documents the compliance status against the {{framework}} framework.
  </p>

  {{#if controls.length}}
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Control</th>
        <th>Status</th>
        <th>Evidence</th>
      </tr>
    </thead>
    <tbody>
      {{#each controls as control}}
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; color: #374151;">{{control.id}}</td>
        <td style="padding: 12px; color: #374151;">
          <strong>{{control.name}}</strong>
          {{#if control.description}}
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">{{control.description}}</p>
          {{/if}}
        </td>
        <td style="padding: 12px;">
          <span class="severity-badge {{control.status}}">{{control.status}}</span>
        </td>
        <td style="padding: 12px; color: #6b7280; font-size: 13px;">{{control.evidence || '-'}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  {{/if}}
</div>
`;
}

export function getStandardTemplate(id: string): StandardTemplate | undefined {
  return STANDARD_TEMPLATES.find((t) => t.id === id);
}

export function listStandardTemplates(): StandardTemplate[] {
  return STANDARD_TEMPLATES;
}
