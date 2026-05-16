import { useState } from 'react';
import {
  useReportTemplate,
  useReportTemplatePreview,
  useReportTemplates,
} from '@/hooks/queries/useReportTemplateQueries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Layers, Sparkles } from 'lucide-react';
import { ReportTemplatePreviewCard } from '@/components/ai-elements/report-template-preview-card';

export function ReportTemplatesPage() {
  const { data: templates = [], isLoading } = useReportTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: selectedTemplate } = useReportTemplate(selectedId ?? undefined);
  const { data: selectedPreview } = useReportTemplatePreview(
    selectedTemplate?.id,
    (selectedTemplate?.publishedVersion?.sampleData as Record<string, unknown> | undefined) ??
      undefined,
  );

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 py-4 md:px-6 md:py-8">
        <div className="rounded-lg border border-border/70 bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Report templates</h1>
                  <p className="text-sm text-muted-foreground">
                    Published report layouts for AI-generated security briefings.
                  </p>
                </div>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Drafts stay in chat until promoted. This surface is the reusable template shelf for
                operational reports, evidence packets, and stakeholder summaries.
              </p>
            </div>
            <Badge variant="secondary" className="w-fit">
              {templates.length} templates
            </Badge>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <Card
                key={template.id}
                className="cursor-pointer border-border/70 transition-colors hover:border-primary/40 hover:bg-primary/5"
                onClick={() => setSelectedId(template.id)}
              >
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-lg leading-tight">{template.name}</CardTitle>
                    <Badge variant={template.scope === 'builtin' ? 'secondary' : 'default'}>
                      {template.scope === 'builtin' ? 'Built-in' : 'Org'}
                    </Badge>
                  </div>
                  <CardDescription>
                    {template.description ?? 'No description provided.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Layers className="h-4 w-4" />
                    <span>{template.category}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4" />
                    <span>Published version {template.publishedVersion?.versionNumber ?? '—'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
          <DialogContent className="max-w-5xl overflow-hidden p-0">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>{selectedTemplate?.name ?? 'Report Template'}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[80vh] px-6 pb-6">
              {selectedTemplate?.publishedVersion ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {selectedTemplate.description ?? 'No description provided.'}
                  </p>
                  <ReportTemplatePreviewCard
                    preview={{
                      templateId: selectedPreview?.templateId ?? selectedTemplate.id,
                      versionId: selectedPreview?.versionId ?? selectedTemplate.publishedVersion.id,
                      versionNumber:
                        selectedPreview?.versionNumber ??
                        selectedTemplate.publishedVersion.versionNumber,
                      kind: 'published',
                      html: selectedPreview?.html ?? selectedTemplate.publishedVersion.htmlTemplate,
                    }}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No published snapshot is available.</p>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
