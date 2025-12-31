# Report Generation Feature Specification

**Issue:** https://github.com/ShipSecAI/studio/issues/21
**Status:** In Progress - Phases 1-4 Complete, Phase 5 In Progress
**Last Updated:** 2025-12-31
**Files Changed:** 21 (13 modified + 8 new)

## Summary

**Official Vercel AI SDK Integration Complete!**

- Upgraded to **AI SDK 3.0 (v3)** (`@ai-sdk/react@3.0.5`)
- Refactored chat architecture to use `DefaultChatTransport` and `UIMessage.parts`
- Integrated **AI Elements** components from Vercel (`shadcn@latest add https://registry.ai-sdk.dev/*`)
- Full chat UI with thinking states, streaming responses, and message bubbles
- Two AI endpoints: streaming (`ai-generate`) and structured output (`ai-generate-structured`)

## AI Elements Installed

```bash
npx shadcn@latest add https://registry.ai-sdk.dev/message.json
npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json
npx shadcn@latest add https://registry.ai-sdk.dev/reasoning.json
npx shadcn@latest add https://registry.ai-sdk.dev/prompt-input.json
npx shadcn@latest add https://registry.ai-sdk.dev/code-block.json
npx shadcn@latest add https://registry.ai-sdk.dev/sources.json
npx shadcn@latest add https://registry.ai-sdk.dev/loader.json
```

---

## Overview

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

## Phase 1: Report Generator Component ✅ COMPLETE

**Location:** `worker/src/components/report/report-generator.ts`

### Completed

- Component definition with `core.report.generator` ID
- Input/output schemas: findings, metadata, scope, templates
- Default HTML report template with ShipSec branding
- Severity-coded findings display (critical/high/medium/low/info)
- Artifact storage integration
- Inline runner implementation

### Still Required

- Puppeteer integration for PDF generation (blocked on component availability)

---

## Phase 2: Template Database Schema ✅ COMPLETE

### Files Created

| File | Description |
|------|-------------|
| `backend/drizzle/0019_create-report-templates.sql` | Migration for `report_templates` and `generated_reports` tables |
| `backend/src/database/schema/report-templates.ts` | Drizzle ORM schema definitions |
| `backend/src/report-templates/dto/template.dto.ts` | DTOs for API validation (including GenerateTemplateDto) |
| `backend/src/report-templates/report-templates.service.ts` | Business logic layer |
| `backend/src/report-templates/report-templates.controller.ts` | REST API endpoints with AI streaming |
| `backend/src/report-templates/report-templates.module.ts` | NestJS module |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/templates` | List all templates (paginated, filterable) |
| GET | `/api/v1/templates/system` | List system templates |
| POST | `/api/v1/templates` | Create new template |
| GET | `/api/v1/templates/:id` | Get template by ID |
| PUT | `/api/v1/templates/:id` | Update template (creates new version) |
| DELETE | `/api/v1/templates/:id` | Delete template |
| GET | `/api/v1/templates/:id/versions` | Get template version history |
| POST | `/api/v1/templates/:id/preview` | Preview with sample data |
| POST | `/api/v1/templates/generate` | Generate report from template |
| POST | `/api/v1/templates/ai-generate` | **AI template generation (streaming)** |
| POST | `/api/v1/templates/ai-generate-structured` | **AI template with structured output** |

**Note:** OpenAPI spec generated successfully with `backend/scripts/generate-openapi.ts` and backend-client types regenerated with `packages/backend-client/generate`.

---

## Phase 3: Template Editor UI ✅ COMPLETE (with AI SDK)

### Files Created

| File | Description |
|------|-------------|
| `frontend/src/store/templateStore.ts` | Zustand store for template state management |
| `frontend/src/pages/TemplatesPage.tsx` | Templates list page |
| `frontend/src/pages/TemplateEditor.tsx` | Template editor with live preview and AI tab |
| `frontend/src/components/ai/TemplateChat.tsx` | AI chat component using official AI Elements |

### AI Integration (Official Vercel AI SDK + AI Elements)

#### Components Used

| Component | Source | Purpose |
|-----------|--------|---------|
| `useChat` | `@ai-sdk/react` | Chat state management with streaming |
| `Conversation` | AI Elements | Chat container |
| `Message` | AI Elements | Chat message bubbles |
| `MessageContent` | AI Elements | Message content wrapper |
| `MessageUser` | AI Elements | User message styling |
| `MessageAssistant` | AI Elements | AI message styling |
| `MessageResponse` | AI Elements | AI response display |
| `MessageLoading` | AI Elements | Loading state |
| `Reasoning` | AI Elements | Thinking process display |
| `Shimmer` | AI Elements | Streaming text animation |
| `PromptInput` | AI Elements | Chat input with actions |
| `PromptInputTextarea` | AI Elements | Textarea input |
| `PromptInputSubmit` | AI Elements | Submit button |
| `PromptInputActions` | AI Elements | Action buttons container |
| `PromptInputAction` | AI Elements | Individual action button |
| `Loader` | AI Elements | Loading indicator |

#### Installation Commands

```bash
# Install AI Elements via shadcn CLI
npx shadcn@latest add https://registry.ai-sdk.dev/message.json
npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json
npx shadcn@latest add https://registry.ai-sdk.dev/reasoning.json
npx shadcn@latest add https://registry.ai-sdk.dev/prompt-input.json
npx shadcn@latest add https://registry.ai-sdk.dev/code-block.json
npx shadcn@latest add https://registry.ai-sdk.dev/sources.json
npx shadcn@latest add https://registry.ai-sdk.dev/loader.json
```

### Pages

1. **Templates List** (`/templates`)
   - Filter by: All, My Templates, System Templates
   - Quick actions: Edit, Delete (user templates only)
   - New template modal

2. **Template Editor** (`/templates/:id/edit`)
   - Left panel: Details + Sample Data
   - Tabs: Content, Schema, Preview, **AI Chat**
   - AI chat sidebar with streaming responses
   - Insert AI-generated template directly
   - Save functionality

---

## Phase 4: Custom Template Renderer ✅ COMPLETE

### Files Created

| File | Description |
|------|-------------|
| `worker/src/components/report/renderer.ts` | Template rendering engine with custom syntax |

### Features

- **Custom Template Syntax**: Handlebars-like `{{variable}}`, `{{#each}}`, `{{#if}}`
- **Data Binding**: Pass JSON data to templates
- **Built-in Helpers**: Severity color coding, formatting
- **ShipSec Branding**: Automatic header/footer injection

### Template Syntax

```html
<h1>{{metadata.reportTitle}}</h1>
{{#each findings as finding}}
<div class="finding {{finding.severity}}">
  <h3>{{finding.title}}</h3>
  <span class="severity-badge {{finding.severity}}">{{finding.severity}}</span>
</div>
{{/each}}
```

### Renderer API

```typescript
import { renderTemplate, generateDefaultTemplate } from './renderer';

const result = renderTemplate({
  template: '<h1>{{title}}</h1>',
  data: { title: 'Hello World' },
  includeBranding: true,
});

console.log(result.html);  // Full HTML document
console.log(result.size);  // Size in bytes
```

---

## Phase 5: Workflow Integration 🚧 IN PROGRESS

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

## Standard Templates (ShipSec) ✅ COMPLETE

### Templates Library

| ID | Name | Description |
|----|------|-------------|
| `pentest-standard-v1` | Penetration Test Report | Standard pentest report with findings table |
| `vuln-scan-summary-v1` | Vulnerability Scan Summary | Scan results with severity breakdown |
| `recon-report-v1` | Reconnaissance Report | Subdomain, port, tech discovery |
| `compliance-checklist-v1` | Compliance Report | PCI/HIPAA/SOC2 style checklist |

### Files Created

| File | Description |
|------|-------------|
| `worker/src/components/report/templates.ts` | Standard templates library |

---

## All Files Created

### Backend

| File | Description |
|------|-------------|
| `backend/drizzle/0019_create-report-templates.sql` | Migration for `report_templates` and `generated_reports` tables |
| `backend/src/database/schema/report-templates.ts` | Drizzle ORM schema definitions |
| `backend/src/report-templates/dto/template.dto.ts` | DTOs for API validation |
| `backend/src/report-templates/report-templates.service.ts` | Business logic layer |
| `backend/src/report-templates/report-templates.controller.ts` | REST API endpoints |
| `backend/src/report-templates/report-templates.module.ts` | NestJS module |

### Frontend

| File | Description |
|------|-------------|
| `frontend/src/store/templateStore.ts` | Zustand store for template state management |
| `frontend/src/pages/TemplatesPage.tsx` | Templates list page |
| `frontend/src/pages/TemplateEditor.tsx` | Template editor with live preview |

### Worker

| File | Description |
|------|-------------|
| `worker/src/components/report/renderer.ts` | Template rendering engine |
| `worker/src/components/report/templates.ts` | Standard templates library |
| `worker/src/components/report/templates.ts` | Standard templates library |
| `worker/src/components/report/report-generator.ts` | Updated to use renderer |

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/templates` | List all templates (paginated, filterable) |
| POST | `/api/v1/templates` | Create new template (AI generates or blank) |
| GET | `/api/v1/templates/:id` | Get template by ID |
| PUT | `/api/v1/templates/:id` | Update template (creates new version) |
| GET | `/api/v1/templates/:id/versions` | Get template version history |
| POST | `/api/v1/templates/:id/preview` | Preview with sample data |
| POST | `/api/v1/templates/generate` | AI generates template from prompt |
| DELETE | `/api/v1/templates/:id` | Delete template (soft delete or archive) |
| GET | `/api/v1/reports` | List generated reports |
| GET | `/api/v1/reports/:id` | Get generated report details |

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

- [x] Phase 1: `core.report.generator` component stub
- [x] Phase 1: HTML report generation with ShipSec branding
- [x] Phase 1: Findings schema and severity display
- [x] Phase 1: Artifact storage integration
- [ ] Phase 1: Puppeteer integration for PDF generation
- [x] Phase 2: Database migrations for templates (`0019_create-report-templates.sql`)
- [x] Phase 2: ORM schema definitions (`report-templates.ts`)
- [x] Phase 2: CRUD API endpoints for templates
- [x] Phase 2: Template DTOs and validation
- [x] Phase 2: AI template generation endpoints (`ai-generate`, `ai-generate-structured`)
- [x] Phase 2: OpenAPI spec generation ✅
- [x] Phase 3: Templates list page UI (`TemplatesPage.tsx`)
- [x] Phase 3: Template editor with AI chat (`TemplateEditor.tsx`)
- [x] Phase 3: AI Elements integration (`TemplateChat.tsx`)
- [x] Phase 3: AI SDK `useChat` hook for streaming
- [x] Phase 4: Custom template renderer (`renderer.ts`)
- [x] Phase 4: ShipSec branding injection (header/footer)
- [x] Phase 4: Standard templates library (4 templates)
- [ ] Phase 5: Workflow node configuration UI (workflow builder integration)
- [ ] Phase 5: Report generator in workflow execution (temporal workflow)

---

## Remaining Work

### High Priority

1. **Puppeteer Integration** (Phase 1)
   - Add puppeteer dependency
   - Create PDF generation function
   - Update report-generator.ts to use Puppeteer for PDF output

2. **Workflow Node Configuration** (Phase 5)
   - Add report generator node to workflow builder
   - Template selector component
   - Input mappings UI

### Medium Priority

1. **Report Generation in Workflows** (Phase 5)
   - Add report generator to workflow DSL schema
   - Create Temporal activity for report generation

---

## Open Questions

1. **CSS Framework**: Using inline styles for simplicity. Tailwind via CDN could be added.
2. **Chart Support**: Could add chart.js for visualizations in templates.
3. **Template Sharing**: Templates are org-scoped. Team sharing not yet implemented.
4. **Export Formats**: HTML export working. PDF requires Puppeteer integration.
5. **Version History**: Database schema supports versions but UI not yet implemented.
