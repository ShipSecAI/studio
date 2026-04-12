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
      <div className="container mx-auto px-4 py-8 space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Report Templates</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Built-in and published organization report templates. Drafts stay chat-only until they
            are promoted.
          </p>
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
                className="cursor-pointer transition-colors hover:border-primary/40"
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
          <DialogContent className="max-w-5xl p-0 overflow-hidden">
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
