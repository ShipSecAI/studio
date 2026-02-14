import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useTemplateStore, type Template } from '@/store/templateStore';

interface UseTemplateModalProps {
  template: Template;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (workflowId: string) => void;
}

export function UseTemplateModal({
  template,
  open,
  onOpenChange,
  onSuccess,
}: UseTemplateModalProps) {
  const { useTemplate, isLoading } = useTemplateStore();

  const [workflowName, setWorkflowName] = useState(`${template.name} - Copy`);
  const [secretMappings, setSecretMappings] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize secret mappings with placeholder values
  const requiredSecrets = template.requiredSecrets || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!workflowName.trim()) {
      setError('Please enter a workflow name');
      return;
    }

    // Check if all required secrets have mappings
    const unmappedSecrets = requiredSecrets.filter((secret) => !secretMappings[secret.name]);

    if (unmappedSecrets.length > 0) {
      setError(
        `Please provide values for all required secrets: ${unmappedSecrets.map((s) => s.name).join(', ')}`,
      );
      return;
    }

    try {
      const result = await useTemplate(template.id, workflowName, secretMappings);
      onSuccess(result.workflowId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow from template');
    }
  };

  const handleSecretMappingChange = (secretName: string, value: string) => {
    setSecretMappings((prev) => ({
      ...prev,
      [secretName]: value,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Use Template: {template.name}</DialogTitle>
          <DialogDescription>
            Create a new workflow from this template. Configure the required secrets below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Workflow Name */}
          <div className="space-y-2">
            <Label htmlFor="workflow-name">Workflow Name</Label>
            <Input
              id="workflow-name"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Enter workflow name"
            />
          </div>

          {/* Template Info */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Category:</span>
              <Badge variant="outline">{template.category || 'Uncategorized'}</Badge>
            </div>
            {template.description && (
              <p className="text-sm text-muted-foreground">{template.description}</p>
            )}
            {template.tags && template.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Required Secrets */}
          {requiredSecrets.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Required Secrets ({requiredSecrets.length})
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="gap-1"
                >
                  {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showSecrets ? 'Hide' : 'Show'}
                </Button>
              </div>

              <div className="space-y-3">
                {requiredSecrets.map((secret) => (
                  <div key={secret.name} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`secret-${secret.name}`} className="text-sm">
                        {secret.name}
                      </Label>
                      <Badge variant="outline" className="text-xs">
                        {secret.type}
                      </Badge>
                    </div>
                    {secret.description && (
                      <p className="text-xs text-muted-foreground">{secret.description}</p>
                    )}
                    <Input
                      id={`secret-${secret.name}`}
                      type={showSecrets ? 'text' : 'password'}
                      value={secretMappings[secret.name] || ''}
                      onChange={(e) => handleSecretMappingChange(secret.name, e.target.value)}
                      placeholder={`Enter value for ${secret.name}`}
                      className="font-mono text-sm"
                    />
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                These secrets will be created in your organization and referenced in the workflow.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">
                This template doesn&apos;t require any secrets. You can customize the workflow after
                creating it.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
