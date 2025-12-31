# Report Generation Feature Specification

**Issue:** https://github.com/ShipSecAI/studio/issues/21
**Status:** In Progress
**Last Updated:** 2025-01-15

---

## Overview

A first-class report generation feature that allows users to create AI-generated report templates and deterministically generate PDF reports from workflow outputs.

### Key Principles

1. **AI-assisted, not AI-dependent** - AI helps create templates, but report generation is deterministic
2. **Live preview** - Users see exactly what they'll get before saving
3. **Versioned templates** - Templates are versioned artifacts stored in the database
4. **Standard branding** - ShipSec branding is enforced at render time
5. **Workflow integration** - Reports are generated via `core.report.generator` component

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ShipSec Studio                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐      ┌─────────────────────────────────────────────┐    │
│  │ Template UI    │      │   Report Generation Component               │    │
│  │                │      │                                             │    │
│  │ • Describe     │───▶  │ core.report.generator                       │    │
│  │ • Preview      │      │   - templateId: string                      │    │
│  │ • Edit         │      │   - templateVersion: string                 │    │
│  │ • Version      │      │   - data: <matches schema>                  │    │
│  └────────────────┘      │   - options: {format, branding}             │    │
│         │                │   ────────────────────────────▶ PDF          │    │
│         │                └─────────────────────────────────────────────┘    │
│         ▼                                                                  │
│  ┌────────────────┐                                                         │
│  │ Template Store │                                                         │
│  │ (PostgreSQL)   │                                                         │
│  └────────────────┘                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Report Generator Component

**Location:** `worker/src/components/report/report-generator.ts`

### Component Contract

```typescript
export const reportGenerator = {
  id: 'core.report.generator',

  inputPorts: {
    template: port.contract('shipsec.report.template.v1'),
    data: port.json(),
  },

  outputPorts: {
    report: port.contract('shipsec.file.v1'),
  },
};
```

### Execution Flow

1. Validate input data against template's `inputSchema`
2. Render Preact + HTM template with data
3. Generate PDF via Puppeteer
4. Store PDF as artifact
5. Return artifact ID

---

## Phase 2: Template Database Schema

### Tables

```sql
-- Report Templates
CREATE TABLE report_templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content JSONB NOT NULL,           -- Preact/HTM source code
  input_schema JSONB NOT NULL,       -- Zod schema (serialized)
  sample_data JSONB,                 -- For preview
  version INTEGER NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,   -- ShipSec default templates
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Generated Reports (audit trail)
CREATE TABLE generated_reports (
  id UUID PRIMARY KEY,
  template_id UUID REFERENCES report_templates(id),
  template_version INTEGER,
  workflow_run_id UUID,
  input_data JSONB,
  artifact_id UUID,
  generated_at TIMESTAMPTZ
);

-- Template versions (for history)
CREATE INDEX idx_report_templates_id ON report_templates(id);
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/templates` | List all templates |
| POST | `/templates` | Create new template (AI generates) |
| GET | `/templates/:id` | Get template by ID |
| PUT | `/templates/:id` | Update template |
| GET | `/templates/:id/versions` | Get template history |
| POST | `/templates/:id/preview` | Preview with sample data |
| POST | `/templates/generate` | AI generates template from prompt |

---

## Phase 3: Template Editor UI

### Pages

1. **Templates List** (`/templates`)
   - Standard templates (read-only)
   - My templates (editable)
   - Search and filter
   - Quick actions: Use, Preview, Edit

2. **New Template Modal**
   - Prompt input for AI description
   - Start from template or blank
   - Quick pick from library

3. **Template Editor** (`/templates/:id/edit`)
   - Left panel: Details + AI chat
   - Right panel: Live preview (3-column layout: Details / Preview / Code)
   - AI chat for iterative refinement
   - Save, Save as new version, Publish

### UI Layout

See ASCII art in `.ai/report-generation-layout.txt`

---

## Phase 4: Preact+HTM Renderer + Puppeteer

### Template Structure

```typescript
interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  preactTemplate: string;  // HTM source code
  inputSchema: z.ZodTypeAny;  // serialized as JSON
  sampleData: Record<string, unknown>;
  version: number;
  createdAt: Date;
  createdBy: string;
}
```

### Example Template

```javascript
// AI-generated Preact/HTM
import { html } from 'htm/preact';

export default function Report({ findings, metadata, scope }) {
  const criticalCount = findings.filter(f => f.severity === 'critical').length;

  return html`
    <div class="report">
      <header>
        <img src="${metadata.logo}" class="logo" />
        <h1>Penetration Test Report</h1>
        <p class="meta">${metadata.clientName} • ${metadata.date}</p>
      </header>

      <section class="summary">
        <h2>Executive Summary</h2>
        <p>Testing identified ${findings.length} total findings,
           with ${criticalCount} critical issues.</p>
      </section>

      <section class="findings">
        <h2>Findings</h2>
        ${findings.map(f => html`
          <div class="finding severity-${f.severity}">
            <h3>${f.title}</h3>
            <div class="meta">
              <span class="severity">${f.severity}</span>
              <span class="cve">${f.cve || 'N/A'}</span>
            </div>
            <p>${f.description}</p>
          </div>
        `)}
      </section>
    </div>
  `;
}
```

### Renderer Pipeline

```
Template (string) + Data (JSON)
    ↓
Parse Preact component
    ↓
Render to HTML (with styled-components/Tailwind)
    ↓
Inject ShipSec branding (header/footer)
    ↓
Puppeteer → PDF
    ↓
Store as artifact
```

---

## Phase 5: Workflow Integration

### Report Generator Node

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌───────────────┐
│  Entry  │───▶│  Scan   │───▶│ Parser  │───▶│ Report Gen    │
│  Point  │    │         │    │         │    │               │
└─────────┘    └─────────┘    └─────────┘    └───────┬───────┘
                                                   │
                                        ┌──────────┴──────────┐
                                        │ Template:            │
                                        │ [Select ▼]           │
                                        │                      │
                                        │ Input mappings:      │
                                        │ findings ◄ data      │
                                        │ metadata ◄ config    │
                                        └──────────────────────┘
```

### Component Configuration

| Field | Type | Description |
|-------|------|-------------|
| template | select | Template selector with version |
| inputMappings | object | Map template inputs to workflow outputs |
| format | select | PDF or HTML |
| branding | boolean | Include ShipSec branding (default: true) |

---

## Standard Templates (ShipSec)

| ID | Name | Description | Input Schema |
|----|------|-------------|--------------|
| `pentest-standard-v1` | Penetration Test Report | Standard pentest report with findings table | findings, metadata, scope |
| `vuln-scan-summary` | Vulnerability Scan Summary | Scan results with severity breakdown | scanResults, targets |
| `recon-report` | Reconnaissance Report | Subdomain, port, tech discovery | subdomains, ports, technologies |
| `compliance-checklist` | Compliance Report | PCI/HIPAA/SOC2 style checklist | controls, status, evidence |

---

## Implementation Checklist

- [ ] Phase 1: `core.report.generator` component stub
- [ ] Phase 1: Puppeteer integration for PDF generation
- [ ] Phase 2: Database migrations for templates
- [ ] Phase 2: CRUD API endpoints
- [ ] Phase 3: Templates list page UI
- [ ] Phase 3: New template modal with AI prompt
- [ ] Phase 3: Template editor with live preview
- [ ] Phase 4: Preact+HTM renderer
- [ ] Phase 4: ShipSec branding injection
- [ ] Phase 5: Workflow node configuration UI
- [ ] Phase 5: Report generator in workflow execution
- [ ] Standard template library (3-5 templates)

---

## Open Questions

1. **CSS Framework**: Use Tailwind (inline styles) or custom CSS injected at render time?
2. **Chart Support**: Include chart.js/recharts for visualizations in templates?
3. **Template Sharing**: Can users share templates with their team/org?
4. **Export Formats**: Support HTML export alongside PDF?
