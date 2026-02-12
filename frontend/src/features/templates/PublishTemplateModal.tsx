import { useState, useCallback } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertCircle, CheckCircle2, GitPullRequest, X, ExternalLink } from 'lucide-react';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';
import { cn } from '@/lib/utils';

interface PublishTemplateModalProps {
  workflowId: string;
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// GitHub repository configuration for templates
const GITHUB_TEMPLATE_REPO = 'krishna9358/workflow-templates'; // format: owner/repo
const GITHUB_BRANCH = 'main';

const TEMPLATE_CATEGORIES = [
  'Security',
  'Monitoring',
  'Compliance',
  'Incident Response',
  'Data Processing',
  'Integration',
  'Automation',
  'Reporting',
  'Testing',
  'Other',
];

const COMMON_TAGS = [
  'security',
  'monitoring',
  'automation',
  'integration',
  'api',
  'notification',
  'compliance',
  'scanning',
  'analysis',
  'reporting',
  'incident',
  'response',
  'forensics',
  'enrichment',
  'detection',
];

interface WorkflowResponse {
  id: string;
  name: string;
  description?: string;
  manifest: Record<string, unknown>;
  graph: Record<string, unknown>;
}

interface TemplateMetadata {
  name: string;
  description?: string;
  category: string;
  tags: string[];
  author: string;
  version: string;
}

interface TemplateJson {
  _metadata: TemplateMetadata;
  graph: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string }[];
}

// Max URL length before falling back to clipboard (GitHub rejects ~8KB+ URLs)
const MAX_URL_LENGTH = 7500;

/**
 * Sanitize secrets from the workflow graph by replacing secret references with placeholders
 */
function sanitizeGraphForTemplate(graph: Record<string, unknown>): Record<string, unknown> {
  const sanitized = JSON.parse(JSON.stringify(graph)); // Deep clone

  // Helper to recursively sanitize secret references
  const traverseAndSanitize = (obj: unknown): unknown => {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(traverseAndSanitize);
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Check for secret reference patterns
        if (
          key === 'secretId' ||
          key === 'secret_name' ||
          key === 'secretName' ||
          key === 'secret_ref' ||
          key === 'secretRef'
        ) {
          result[key] = '{{SECRET_PLACEHOLDER}}';
        } else if (
          typeof value === 'string' &&
          (value.includes('${secrets.') ||
            value.includes('${secret.') ||
            value.includes('{{secret.'))
        ) {
          // Replace secret interpolation expressions with placeholder
          result[key] = value
            .replace(/\$\{secrets\.[^}]+\}/g, '{{SECRET_PLACEHOLDER}}')
            .replace(/\$\{secret\.[^}]+\}/g, '{{SECRET_PLACEHOLDER}}')
            .replace(/\{\{secret\.[^}]+\}\}/g, '{{SECRET_PLACEHOLDER}}');
        } else {
          result[key] = traverseAndSanitize(value);
        }
      }
      return result;
    }
    return obj;
  };

  return traverseAndSanitize(sanitized) as Record<string, unknown>;
}

/**
 * Extract secret requirements from the graph for documentation
 */
function extractRequiredSecrets(
  graph: Record<string, unknown>,
): { name: string; type: string; description?: string }[] {
  const secrets = new Map<string, { type: string; description?: string }>();

  const traverseAndExtract = (obj: unknown, path: string[] = []) => {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => traverseAndExtract(item, [...path, String(idx)]));
        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        if (key === 'secretId' || key === 'secret_name' || key === 'secretName') {
          if (typeof value === 'string') {
            // Infer type from context
            const context = path[path.length - 2] || 'generic';
            const type = context.toLowerCase().includes('api')
              ? 'api_key'
              : context.toLowerCase().includes('token')
                ? 'token'
                : context.toLowerCase().includes('password')
                  ? 'password'
                  : 'generic';
            secrets.set(value, { type, description: `Secret for ${context}` });
          }
        } else if (typeof value === 'object' && value !== null) {
          traverseAndExtract(value, [...path, key]);
        }
      }
    }
  };

  traverseAndExtract(graph);
  return Array.from(secrets.entries()).map(([name, info]) => ({
    name,
    type: info.type,
    description: info.description,
  }));
}

/**
 * Strip viewport and node positions from graph to reduce JSON size.
 * These are UI layout hints and not needed for the template's functionality.
 */
function stripLayoutData(graph: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...graph };
  delete stripped.viewport;

  if (Array.isArray(stripped.nodes)) {
    stripped.nodes = (stripped.nodes as Record<string, unknown>[]).map((node) => {
      const { position, ...rest } = node;
      return rest;
    });
  }

  return stripped;
}

/**
 * Generate the template JSON structure with metadata
 */
function generateTemplateJson(workflow: WorkflowResponse, metadata: TemplateMetadata): string {
  const sanitizedGraph = sanitizeGraphForTemplate(workflow.graph);
  const compactGraph = stripLayoutData(sanitizedGraph);
  const requiredSecrets = extractRequiredSecrets(workflow.graph);

  const template: TemplateJson = {
    _metadata: metadata,
    graph: compactGraph,
    requiredSecrets,
  };

  return JSON.stringify(template, null, 2);
}

/**
 * Generate GitHub URL for creating a new file.
 * Includes template content in URL when possible; returns whether content was embedded.
 */
function generateGitHubUrl(
  owner: string,
  repo: string,
  branch: string,
  filename: string,
  templateName: string,
  content: string,
): { url: string; contentInUrl: boolean } {
  const baseUrl = `https://github.com/${owner}/${repo}/new/${branch}`;
  const params = new URLSearchParams();
  params.set('filename', filename);
  params.set('value', content);
  params.set('message', `Add template: ${templateName}`);
  params.set('quick_pull', '1');

  const fullUrl = `${baseUrl}?${params.toString()}`;

  if (fullUrl.length <= MAX_URL_LENGTH) {
    return { url: fullUrl, contentInUrl: true };
  }

  // URL too long — drop content, user will paste from clipboard
  params.delete('value');
  return { url: `${baseUrl}?${params.toString()}`, contentInUrl: false };
}

/**
 * Sanitize filename to be safe for use in URLs
 */
function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.json'
  );
}

export function PublishTemplateModal({
  workflowId,
  workflowName,
  open,
  onOpenChange,
  onSuccess,
}: PublishTemplateModalProps) {
  const [name, setName] = useState(workflowName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [usedClipboard, setUsedClipboard] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsLoading(true);

      if (!name.trim()) {
        setError('Please enter a template name');
        setIsLoading(false);
        return;
      }

      if (!category) {
        setError('Please select a category');
        setIsLoading(false);
        return;
      }

      if (!author.trim()) {
        setError('Please enter your name or organization');
        setIsLoading(false);
        return;
      }

      try {
        // Fetch the workflow data from the backend
        const headers = await getApiAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/v1/workflows/${workflowId}`, {
          headers,
        });
        if (!response.ok) {
          throw new Error('Failed to fetch workflow data');
        }

        const workflow: WorkflowResponse = await response.json();

        // Generate the template JSON
        const metadata: TemplateMetadata = {
          name: name.trim(),
          description: description.trim() || undefined,
          category: category || '',
          tags,
          author: author.trim(),
          version: '1.0.0',
        };

        const templateJson = generateTemplateJson(workflow, metadata);
        const filename = `templates/${sanitizeFilename(name.trim())}`;

        // Parse the GitHub repo config
        const [owner, repo] = GITHUB_TEMPLATE_REPO.split('/');

        // Try to embed content in URL; falls back to clipboard for large templates
        const { url: githubUrl, contentInUrl } = generateGitHubUrl(
          owner,
          repo,
          GITHUB_BRANCH,
          filename,
          name.trim(),
          templateJson,
        );

        if (!contentInUrl) {
          await navigator.clipboard.writeText(templateJson);
          setUsedClipboard(true);
        }

        // Open the GitHub URL in a new tab
        window.open(githubUrl, '_blank', 'noopener,noreferrer');

        // Show success state
        setSuccess(true);
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to prepare template for publishing');
      } finally {
        setIsLoading(false);
      }
    },
    [workflowId, name, description, category, tags, author, onSuccess],
  );

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleAddCommonTag = (tag: string) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
      // Reset form after a delay to avoid visual glitch
      setTimeout(() => {
        setName(workflowName);
        setDescription('');
        setCategory('');
        setTags([]);
        setAuthor('');
        setError(null);
        setSuccess(false);
        setUsedClipboard(false);
      }, 200);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            Publish as Template
          </DialogTitle>
          <DialogDescription>
            Submit your workflow as a template to the GitHub repository.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          // Success State
          <div className="py-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Template Ready for Submission!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {usedClipboard
                    ? 'Template JSON copied to clipboard. A new tab has opened on GitHub.'
                    : 'A new tab has opened with your template pre-filled on GitHub.'}
                </p>
              </div>
              <div className="w-full p-3 rounded-lg bg-muted/50 space-y-3 text-sm">
                <p className="text-left">
                  <strong>Next steps:</strong>
                </p>
                <ol className="text-left list-decimal list-inside space-y-2 text-muted-foreground">
                  {usedClipboard && (
                    <li>
                      <strong>Paste</strong> the template content into the editor (Ctrl+V / Cmd+V)
                    </li>
                  )}
                  <li>
                    <strong>Review</strong> the template content in the opened tab
                  </li>
                  <li>
                    <strong>Important:</strong> Click &quot;Propose new file&quot; (NOT &quot;Commit
                    directly&quot;)
                  </li>
                  <li>
                    <strong>Create Pull Request</strong> to submit your template for review
                  </li>
                </ol>
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded text-xs">
                  <strong>Note:</strong> Creating a PR allows reviewers to check your template
                  before it&apos;s added to the library.
                </div>
                <a
                  href={`https://github.com/${GITHUB_TEMPLATE_REPO}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  View Repository on GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="text-xs text-muted-foreground max-w-sm">
                Your workflow will be reviewed before being added to the template library.
                You&apos;ll be notified once it&apos;s approved.
              </p>
            </div>
          </div>
        ) : (
          // Form
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Template Name */}
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Security Template"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this template does..."
                rows={3}
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat.toLowerCase()}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add a tag..."
                />
                <Button type="button" variant="outline" onClick={handleAddTag}>
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => handleRemoveTag(tag)} />
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {COMMON_TAGS.slice(0, 8).map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className={cn(
                      'cursor-pointer',
                      tags.includes(tag) && 'bg-primary text-primary-foreground',
                    )}
                    onClick={() => handleAddCommonTag(tag)}
                  >
                    + {tag}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Author */}
            <div className="space-y-2">
              <Label htmlFor="author">Author / Organization *</Label>
              <Input
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name or organization"
              />
            </div>

            {/* Info Box */}
            <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <p>
                <strong>Note:</strong> Your workflow will be sanitized before publishing. All secret
                references will be removed and replaced with placeholders. Clicking submit will open
                GitHub in a new tab where you can review and create a pull request.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit Template
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
