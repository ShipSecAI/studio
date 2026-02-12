import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Copy,
  ExternalLink,
  Filter,
  Package,
  RefreshCw,
  Search,
  Star,
  Tag,
  X,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import { useTemplateStore, type Template } from '@/store/templateStore';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import { UseTemplateModal } from '@/features/templates/UseTemplateModal';
import { cn } from '@/lib/utils';

export function TemplateLibraryPage() {
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);

  const {
    templates,
    categories,
    tags,
    isLoading,
    error,
    selectedCategory,
    selectedTags,
    searchQuery,
    fetchTemplates,
    fetchCategories,
    fetchTags,
    syncTemplates,
    setSelectedCategory,
    setSelectedTags,
    setSearchQuery,
    clearError,
  } = useTemplateStore();

  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isUseModalOpen, setIsUseModalOpen] = useState(false);

  // Load initial data
  useEffect(() => {
    fetchTemplates();
    fetchCategories();
    fetchTags();
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncTemplates();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category === 'all' ? null : category);
  };

  const toggleTag = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(newTags);
  };

  const clearFilters = () => {
    setSelectedCategory(null);
    setSelectedTags([]);
    setSearchQuery('');
  };

  const handleUseTemplate = (template: Template) => {
    if (!canManageWorkflows) {
      return;
    }
    setSelectedTemplate(template);
    setIsUseModalOpen(true);
    track(Events.TemplateUseClicked, {
      templateId: template.id,
      templateName: template.name,
      category: template.category,
    });
  };

  const handleTemplateUseSuccess = (workflowId: string) => {
    setIsUseModalOpen(false);
    setSelectedTemplate(null);
    navigate(`/workflows/${workflowId}`);
  };

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-1">Template Library</h1>
              <p className="text-muted-foreground">
                Browse and use pre-built workflow templates to accelerate your automation
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing || !canManageWorkflows}
              className="gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
              <span className="hidden sm:inline">Sync from GitHub</span>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Category and Tag Filters */}
          <div className="flex flex-wrap gap-3">
            {/* Category Select */}
            <Select value={selectedCategory || 'all'} onValueChange={handleCategoryChange}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem
                    key={cat.category || 'uncategorized'}
                    value={cat.category || 'uncategorized'}
                  >
                    {cat.category || 'Uncategorized'} ({cat.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Tag Pills */}
            {tags.slice(0, 10).map((tag) => (
              <Badge
                key={tag}
                variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => toggleTag(tag)}
              >
                <Tag className="h-3 w-3 mr-1" />
                {tag}
              </Badge>
            ))}

            {/* Clear Filters */}
            {(selectedCategory || selectedTags.length > 0 || searchQuery) && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-2">
                <X className="h-4 w-4" />
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <div className="flex-1">
                <p className="font-medium text-destructive">Error loading templates</p>
                <p className="text-sm text-destructive/80">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearError();
                  fetchTemplates();
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Templates Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-4 space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-card">
            <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No templates found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || selectedCategory || selectedTags.length > 0
                ? 'Try adjusting your filters or search query'
                : 'No templates available yet. Sync from GitHub to load templates.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onUse={handleUseTemplate}
                canUse={canManageWorkflows}
              />
            ))}
          </div>
        )}
      </div>

      {/* Use Template Modal */}
      {selectedTemplate && (
        <UseTemplateModal
          template={selectedTemplate}
          open={isUseModalOpen}
          onOpenChange={setIsUseModalOpen}
          onSuccess={handleTemplateUseSuccess}
        />
      )}
    </div>
  );
}

interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  canUse: boolean;
}

function TemplateCard({ template, onUse, canUse }: TemplateCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={cn(
        'flex flex-col border rounded-lg p-4 transition-all duration-200 bg-card',
        isHovered && 'shadow-md border-primary/50',
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h3 className="font-semibold truncate max-w-[180px]" title={template.name}>
            {template.name}
          </h3>
        </div>
        {template.isOfficial && (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Official
          </Badge>
        )}
      </div>

      {/* Content area - grows to fill available space */}
      <div className="flex-1">
        {/* Description */}
        {template.description && (
          <p
            className="text-sm text-muted-foreground mb-3 line-clamp-2"
            title={template.description}
          >
            {template.description}
          </p>
        )}

        {/* Tags */}
        {template.tags && template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {template.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {template.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{template.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
          {template.category && (
            <span className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              {template.category}
            </span>
          )}
          {template.author && (
            <span className="flex items-center gap-1" title={template.author}>
              <Copy className="h-3 w-3" />
              {template.author.length > 15 ? `${template.author.slice(0, 15)}...` : template.author}
            </span>
          )}
          {template.popularity > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {template.popularity}
            </span>
          )}
        </div>

        {/* Required Secrets Badge */}
        {template.requiredSecrets && template.requiredSecrets.length > 0 && (
          <div className="mb-3 p-2 rounded bg-muted/50 text-xs">
            <span className="font-medium">
              Requires {template.requiredSecrets.length} secret
              {template.requiredSecrets.length > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Actions - pinned to bottom */}
      <div className="flex gap-2 mt-auto pt-2">
        <Button size="sm" className="flex-1" onClick={() => onUse(template)} disabled={!canUse}>
          Use Template
        </Button>
        {template.repository && (
          <Button size="sm" variant="outline" asChild>
            <a
              href={`https://github.com/${template.repository}/blob/${template.branch || 'main'}/${template.path}`}
              target="_blank"
              rel="noopener noreferrer"
              title="View on GitHub"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
