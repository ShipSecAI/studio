import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';

export interface ReportTemplatePreviewPayload {
  templateId: string;
  versionId: string;
  versionNumber: number;
  kind: 'draft' | 'published';
  html: string;
  css?: string;
  data?: Record<string, unknown>;
}

export function ReportTemplatePreviewCard({ preview }: { preview: ReportTemplatePreviewPayload }) {
  const [expanded, setExpanded] = useState(false);
  const srcDoc = useMemo(() => preview.html, [preview.html]);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm truncate">Report Template Preview</span>
            <Badge variant={preview.kind === 'draft' ? 'secondary' : 'default'}>
              {preview.kind === 'draft' ? 'Draft' : 'Published'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Version {preview.versionNumber} • Template {preview.templateId}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setExpanded((value) => !value)}>
          {expanded ? (
            <>
              Hide Preview
              <ChevronUp className="h-4 w-4 ml-1" />
            </>
          ) : (
            <>
              Show Preview
              <ChevronDown className="h-4 w-4 ml-1" />
            </>
          )}
        </Button>
      </div>
      {expanded && (
        <div className="p-3">
          <iframe
            title="Report template preview"
            srcDoc={srcDoc}
            sandbox=""
            className="w-full min-h-[520px] rounded-md border bg-white"
          />
        </div>
      )}
    </div>
  );
}
