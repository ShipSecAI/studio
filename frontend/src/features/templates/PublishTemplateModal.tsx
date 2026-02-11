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
import { Loader2, AlertCircle, CheckCircle2, GitPullRequest, X } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';
import { cn } from '@/lib/utils';

interface PublishTemplateModalProps {
  workflowId: string;
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (result: {
    templateId: string;
    pullRequestUrl: string;
    pullRequestNumber: number;
  }) => void;
}

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

export function PublishTemplateModal({
  workflowId,
  workflowName,
  open,
  onOpenChange,
  onSuccess,
}: PublishTemplateModalProps) {
  const { publishTemplate, isLoading } = useTemplateStore();

  const [name, setName] = useState(workflowName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    templateId: string;
    pullRequestUrl: string;
    pullRequestNumber: number;
  } | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!name.trim()) {
        setError('Please enter a template name');
        return;
      }

      if (!category) {
        setError('Please select a category');
        return;
      }

      if (!author.trim()) {
        setError('Please enter your name or organization');
        return;
      }

      try {
        const publishResult = await publishTemplate({
          workflowId,
          name: name.trim(),
          description: description.trim() || undefined,
          category: category || '', // Ensure category is a string
          tags,
          author: author.trim(),
        });

        setResult(publishResult);
        onSuccess?.(publishResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to publish template');
      }
    },
    [workflowId, name, description, category, tags, author, publishTemplate, onSuccess],
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
        setResult(null);
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
            Submit your workflow as a template. A pull request will be created in the templates
            repository.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // Success State
          <div className="py-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Template Submitted!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Your template has been submitted as PR #{result.pullRequestNumber}
                </p>
              </div>
              <div className="w-full p-3 rounded-lg bg-muted/50 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Template ID:</span>
                  <code className="text-xs bg-background px-2 py-0.5 rounded">
                    {result.templateId}
                  </code>
                </div>
                <a
                  href={result.pullRequestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  View Pull Request →
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
                references will be removed and replaced with placeholders. The pull request will be
                created in the templates repository for review.
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
