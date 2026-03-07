import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, LayoutTemplate, Loader2, Mouse, TrendingUp } from 'lucide-react';
import type { WorkflowTemplate, ToolInfo } from './types';
import { WorkflowPreviewCanvas } from './WorkflowPreviewCanvas';

interface TemplateDetailDialogProps {
  template: WorkflowTemplate | null;
  open: boolean;
  onClose: () => void;
  onUseTemplate: (template: any) => void | Promise<void>;
  isInstantiating: boolean;
  tools: ToolInfo[];
  categoryLabel: string;
}

export function TemplateDetailDialog({
  template,
  open,
  onClose,
  onUseTemplate,
  isInstantiating,
  tools,
  categoryLabel,
}: TemplateDetailDialogProps) {
  if (!template) return null;

  const runCount = template.runCount ?? 0;
  const hasGraph = (template.graph?.nodes?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden max-h-[90vh]">
        <div className="overflow-y-auto max-h-[90vh]">
          {/* Preview area */}
          <div className="h-[40vh] w-full bg-muted/50 flex items-center justify-center overflow-hidden border-b border-border relative">
            {hasGraph ? (
              <WorkflowPreviewCanvas
                nodes={template.graph!.nodes!}
                edges={template.graph!.edges ?? []}
              />
            ) : template.screenshotUrl ? (
              <img
                src={template.screenshotUrl}
                alt={`${template.name} workflow preview`}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                width={672}
                height={378}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            {!hasGraph && (
              <div
                className={`flex flex-col items-center gap-2 text-muted-foreground ${template.screenshotUrl ? 'hidden' : ''}`}
              >
                <LayoutTemplate className="h-12 w-12" />
                <span className="text-sm">Workflow preview</span>
              </div>
            )}
            {hasGraph && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] text-muted-foreground/60 bg-background/60 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
                <Mouse className="h-3 w-3" />
                <span>Scroll to zoom</span>
              </div>
            )}
          </div>

          <div className="px-6 pb-2">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">{template.name}</DialogTitle>
                <Badge variant="secondary" className="text-xs">
                  {categoryLabel}
                </Badge>
              </div>
              <DialogDescription className="text-sm mt-2">{template.description}</DialogDescription>
            </DialogHeader>

            {/* Runs & Tools row */}
            <div className="flex items-center justify-between mt-4">
              {runCount > 0 && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span className="text-xs">{runCount.toLocaleString()} runs</span>
                </div>
              )}
              {tools.length > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground font-medium">Tools:</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {tools.map((tool) => (
                      <div
                        key={tool.key}
                        className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1"
                      >
                        <img
                          src={tool.logo}
                          alt={tool.label}
                          className="w-4 h-4 rounded-sm object-contain"
                          loading="lazy"
                          decoding="async"
                          width={16}
                          height={16}
                        />
                        <span className="text-xs">{tool.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Components */}
            {template.graph?.nodes && template.graph.nodes.length > 0 && (
              <div className="mt-4">
                <span className="text-xs text-muted-foreground font-medium">Components:</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Array.from(new Set(template.graph.nodes.map((n) => n.type).filter(Boolean))).map(
                    (type) => (
                      <Badge key={type} variant="outline" className="text-xs font-mono">
                        {type}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Docs link */}
            <div className="mt-4">
              <a
                href="https://docs.shipsec.io/templates"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                View template documentation
              </a>
            </div>
          </div>

          <DialogFooter className="px-6 pb-6">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => onUseTemplate(template)} disabled={isInstantiating}>
              {isInstantiating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Creating...
                </>
              ) : (
                'Use Template'
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
