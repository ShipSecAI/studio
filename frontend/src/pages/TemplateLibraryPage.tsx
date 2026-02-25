import { useRef, useState, useMemo } from 'react';
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
  Eye,
  Filter,
  RefreshCw,
  Search,
  Star,
  Tag,
  X,
  CheckCircle2,
  AlertCircle,
  Shield,
  Activity,
  Zap,
  BarChart3,
  Database,
  Link,
  TestTube2,
  MoreHorizontal,
  AlertTriangle,
  Layers,
  ZoomIn,
  ZoomOut,
  Workflow,
  KeyRound,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useTemplates,
  useTemplateCategories,
  useTemplateTags,
  useSyncTemplates,
  type Template,
} from '@/hooks/queries/useTemplateQueries';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import { UseTemplateModal } from '@/features/templates/UseTemplateModal';
import { WorkflowPreview } from '@/features/templates/WorkflowPreview';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Category styling
// ---------------------------------------------------------------------------

interface CategoryStyle {
  icon: LucideIcon;
  badge: string;
  gradient: string;
  accent: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  security: {
    icon: Shield,
    badge:
      'bg-red-100 text-red-700 border-red-200/60 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/40',
    gradient: 'from-red-500/8 via-orange-500/5 to-transparent',
    accent: 'text-red-600 dark:text-red-400',
  },
  monitoring: {
    icon: Activity,
    badge:
      'bg-blue-100 text-blue-700 border-blue-200/60 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/40',
    gradient: 'from-blue-500/8 via-cyan-500/5 to-transparent',
    accent: 'text-blue-600 dark:text-blue-400',
  },
  compliance: {
    icon: CheckCircle2,
    badge:
      'bg-emerald-100 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/40',
    gradient: 'from-emerald-500/8 via-green-500/5 to-transparent',
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  'incident response': {
    icon: AlertTriangle,
    badge:
      'bg-amber-100 text-amber-700 border-amber-200/60 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/40',
    gradient: 'from-amber-500/8 via-yellow-500/5 to-transparent',
    accent: 'text-amber-600 dark:text-amber-400',
  },
  'data processing': {
    icon: Database,
    badge:
      'bg-purple-100 text-purple-700 border-purple-200/60 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/40',
    gradient: 'from-purple-500/8 via-violet-500/5 to-transparent',
    accent: 'text-purple-600 dark:text-purple-400',
  },
  integration: {
    icon: Link,
    badge:
      'bg-teal-100 text-teal-700 border-teal-200/60 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800/40',
    gradient: 'from-teal-500/8 via-cyan-500/5 to-transparent',
    accent: 'text-teal-600 dark:text-teal-400',
  },
  automation: {
    icon: Zap,
    badge:
      'bg-indigo-100 text-indigo-700 border-indigo-200/60 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800/40',
    gradient: 'from-indigo-500/8 via-blue-500/5 to-transparent',
    accent: 'text-indigo-600 dark:text-indigo-400',
  },
  reporting: {
    icon: BarChart3,
    badge:
      'bg-emerald-100 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/40',
    gradient: 'from-emerald-500/8 via-teal-500/5 to-transparent',
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  testing: {
    icon: TestTube2,
    badge:
      'bg-pink-100 text-pink-700 border-pink-200/60 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800/40',
    gradient: 'from-pink-500/8 via-rose-500/5 to-transparent',
    accent: 'text-pink-600 dark:text-pink-400',
  },
  other: {
    icon: MoreHorizontal,
    badge:
      'bg-slate-100 text-slate-700 border-slate-200/60 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/40',
    gradient: 'from-slate-500/8 via-gray-500/5 to-transparent',
    accent: 'text-slate-600 dark:text-slate-400',
  },
};

const DEFAULT_CATEGORY_STYLE: CategoryStyle = CATEGORY_STYLES.other;

function getCategoryStyle(category?: string | null): CategoryStyle {
  if (!category) return DEFAULT_CATEGORY_STYLE;
  return CATEGORY_STYLES[category.toLowerCase()] || DEFAULT_CATEGORY_STYLE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(date: string | Date): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

// ---------------------------------------------------------------------------
// Preview section with zoom
// ---------------------------------------------------------------------------

function PreviewSection({ graph }: { graph?: Record<string, unknown>; category?: string | null }) {
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 }); // percentage-based origin
  const containerRef = useRef<HTMLDivElement>(null);
  const hasGraph =
    graph &&
    (graph as any)?.nodes &&
    Array.isArray((graph as any).nodes) &&
    (graph as any).nodes.length > 0;

  // Track cursor position for zoom origin
  const updateOrigin = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  // Scroll-wheel zoom at cursor position
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    updateOrigin(e);
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => Math.min(Math.max(z + delta, 0.75), 2.5));
  };

  // Button zoom (uses last known cursor position)
  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.min(z + 0.25, 2.5));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.max(z - 0.25, 0.75));
  };

  // Reset zoom on double-click
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom(1);
    setOrigin({ x: 50, y: 50 });
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-44 w-full overflow-hidden rounded-xl',
        hasGraph && 'cursor-zoom-in',
        hasGraph && zoom > 1 && 'cursor-zoom-out',
      )}
      style={{
        background: 'linear-gradient(180deg, #F8FAFF 0%, #F1F5FF 100%)',
      }}
      onWheel={hasGraph ? handleWheel : undefined}
      onMouseMove={hasGraph ? updateOrigin : undefined}
      onDoubleClick={hasGraph ? handleDoubleClick : undefined}
    >
      {/* Dark theme gradient overlay */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background: 'linear-gradient(180deg, #111827 0%, #0B1220 100%)',
        }}
      />
      {/* Subtle radial glow in dark mode */}
      <div
        className="absolute inset-0 hidden dark:block pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.08), transparent 60%)',
        }}
      />

      {/* Subtle dot pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)',
          backgroundSize: '12px 12px',
        }}
      />

      {hasGraph ? (
        <>
          <div
            className="absolute inset-0 flex items-center justify-center p-2 transition-transform duration-300 ease-out group-hover:scale-[1.02]"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: `${origin.x}% ${origin.y}%`,
            }}
          >
            <WorkflowPreview graph={graph} className="w-full h-full" />
          </div>

          {/* "Scroll to zoom" hint — visible on hover, hides once user zooms */}
          {zoom === 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground/5 backdrop-blur-sm text-[9px] font-medium text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="opacity-60">
                <rect
                  x="6"
                  y="1"
                  width="4"
                  height="8"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <line
                  x1="8"
                  y1="4"
                  x2="8"
                  y2="6"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
                <path
                  d="M8 11v2m-2 1h4"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
              Scroll to zoom
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>

          {/* Zoom indicator */}
          {zoom !== 1 && (
            <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-background/70 backdrop-blur-sm text-[9px] font-medium text-muted-foreground border border-border/30">
              {Math.round(zoom * 100)}%
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/30">
          <Workflow className="h-8 w-8" />
          <span className="text-[10px] font-medium">No preview</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  template: Template;
  onUse: (template: Template) => void;
  onPreview: (template: Template) => void;
  canUse: boolean;
}

function TemplateCard({ template, onUse, onPreview, canUse }: TemplateCardProps) {
  const catStyle = getCategoryStyle(template.category);
  const CategoryIcon = catStyle.icon;

  return (
    <div
      className={cn(
        'group flex flex-col rounded-2xl cursor-pointer',
        'bg-white dark:bg-zinc-900',
        'border border-gray-100 dark:border-white/5',
        'shadow-sm',
        'transition-all duration-300 ease-out',
        'hover:shadow-lg hover:-translate-y-1',
        'dark:hover:border-white/10',
      )}
      onClick={() => onPreview(template)}
    >
      {/* Content wrapper with padding */}
      <div className="flex flex-col flex-1 p-5 md:p-6 gap-6">
        {/* Preview */}
        <PreviewSection graph={template.graph} category={template.category} />

        {/* Header: Category badge + Author */}
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className={cn(
              'text-xs font-medium gap-1 rounded-full px-3 py-1 border',
              catStyle.badge,
            )}
          >
            <CategoryIcon className="h-3 w-3" />
            {template.category || 'Automation'}
          </Badge>

          {template.author && (
            <div className="flex items-center gap-1.5">
              <div className="h-5 w-5 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                {template.author.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[80px]">
                {template.author}
              </span>
            </div>
          )}
        </div>

        {/* Title + Description */}
        <div>
          <h3
            className="text-xl font-semibold text-gray-900 dark:text-white leading-tight line-clamp-1"
            title={template.name}
          >
            {toTitleCase(template.name)}
          </h3>

          {template.description && (
            <p
              className="text-sm text-gray-500 dark:text-gray-400 mt-2 line-clamp-2"
              title={template.description}
            >
              {template.description}
            </p>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tags & Metadata */}
        <div className="space-y-2.5">
          {/* Tags */}
          {(() => {
            const categoryLower = (template.category || '').toLowerCase();
            const filteredTags = (template.tags || []).filter(
              (t) => t.toLowerCase() !== categoryLower,
            );
            if (filteredTags.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1.5">
                {filteredTags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      'inline-flex items-center px-3 py-1 rounded-full text-xs',
                      'bg-gray-100 text-gray-700 border border-gray-200',
                      'dark:bg-white/5 dark:text-gray-300 dark:border-white/10',
                    )}
                  >
                    {tag}
                  </span>
                ))}
                {filteredTags.length > 3 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            'inline-flex items-center px-3 py-1 rounded-full text-xs cursor-default',
                            'bg-gray-100 text-gray-700 border border-gray-200',
                            'dark:bg-white/5 dark:text-gray-300 dark:border-white/10',
                          )}
                        >
                          +{filteredTags.length - 3}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{filteredTags.slice(3).join(', ')}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            );
          })()}

          {/* Marketplace metadata */}
          <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            {template.popularity > 0 && (
              <>
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3 text-amber-500" />
                  {template.popularity}
                </span>
                <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              </>
            )}
            {template.requiredSecrets && template.requiredSecrets.length > 0 && (
              <>
                <span className="flex items-center gap-1">
                  <KeyRound className="h-3 w-3" />
                  {template.requiredSecrets.length} secret
                  {template.requiredSecrets.length !== 1 ? 's' : ''}
                </span>
                <span className="text-gray-300 dark:text-gray-600">&middot;</span>
              </>
            )}
            {template.updatedAt && <span>Updated {timeAgo(template.updatedAt)}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className={cn(
              'flex-1 h-11 rounded-xl font-medium gap-2',
              'active:scale-[0.98] transition-all duration-200',
            )}
            onClick={(e) => {
              e.stopPropagation();
              onUse(template);
            }}
            disabled={!canUse}
          >
            Use Template
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Button>

          {template.repository && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'h-11 w-11 rounded-xl p-0 flex-shrink-0',
                      'bg-gray-50 border-gray-200 hover:bg-gray-100',
                      'dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10',
                    )}
                    asChild
                  >
                    <a
                      href={`https://github.com/${template.repository}/blob/${template.branch || 'main'}/${template.path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Eye className="h-4 w-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Preview</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="p-5 md:p-6 space-y-6">
        <Skeleton className="h-44 w-full rounded-xl" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="space-y-2.5">
          <div className="flex gap-1.5">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 w-11 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="relative mb-6">
        <div className="h-20 w-20 rounded-2xl bg-muted/50 flex items-center justify-center">
          <Layers className="h-10 w-10 text-muted-foreground/40" />
        </div>
        <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Search className="h-4 w-4 text-primary/40" />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">No templates found</h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        {hasFilters
          ? "Try adjusting your filters or search query to find what you're looking for."
          : 'No templates available yet. Sync from GitHub to load templates.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template detail modal
// ---------------------------------------------------------------------------

interface TemplateDetailModalProps {
  template: Template | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (template: Template) => void;
  canUse: boolean;
}

function TemplateDetailModal({
  template,
  open,
  onOpenChange,
  onUse,
  canUse,
}: TemplateDetailModalProps) {
  if (!template) return null;

  const catStyle = getCategoryStyle(template.category);
  const CategoryIcon = catStyle.icon;
  const hasGraph =
    template.graph &&
    (template.graph as any)?.nodes &&
    Array.isArray((template.graph as any).nodes) &&
    (template.graph as any).nodes.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0">
        {/* Graph preview */}
        <div
          className="relative w-full h-72 sm:h-80 overflow-hidden rounded-t-lg"
          style={{
            background: 'linear-gradient(180deg, #F8FAFF 0%, #F1F5FF 100%)',
          }}
        >
          <div
            className="absolute inset-0 hidden dark:block"
            style={{
              background: 'linear-gradient(180deg, #111827 0%, #0B1220 100%)',
            }}
          />
          <div
            className="absolute inset-0 hidden dark:block pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.08), transparent 60%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)',
              backgroundSize: '12px 12px',
            }}
          />
          {hasGraph ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <WorkflowPreview graph={template.graph!} className="w-full h-full" />
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/30">
              <Workflow className="h-12 w-12" />
              <span className="text-xs font-medium">No preview</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-xs font-medium gap-1 rounded-full px-3 py-1 border',
                  catStyle.badge,
                )}
              >
                <CategoryIcon className="h-3 w-3" />
                {template.category || 'Automation'}
              </Badge>
              {template.author && (
                <span className="text-xs text-muted-foreground">by {template.author}</span>
              )}
            </div>
            <DialogTitle className="text-2xl font-semibold">
              {toTitleCase(template.name)}
            </DialogTitle>
            {template.description && (
              <DialogDescription className="text-sm mt-2">{template.description}</DialogDescription>
            )}
          </DialogHeader>

          <Button
            className={cn(
              'w-full h-11 rounded-xl font-medium gap-2',
              'active:scale-[0.98] transition-all duration-200',
            )}
            onClick={() => onUse(template)}
            disabled={!canUse}
          >
            Use Template
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function TemplateLibraryPage() {
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);

  // UI-only filter state (not server data, so local useState is correct)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Build filters object for query key
  const filters = useMemo(() => {
    const f: { category?: string; search?: string; tags?: string[] } = {};
    if (selectedCategory) f.category = selectedCategory;
    if (searchQuery) f.search = searchQuery;
    if (selectedTags.length > 0) f.tags = selectedTags;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [selectedCategory, searchQuery, selectedTags]);

  // Server state via TanStack Query
  const { data: templates = [], isLoading, error } = useTemplates(filters);
  const { data: categories = [] } = useTemplateCategories();
  const { data: tags = [] } = useTemplateTags();
  const syncMutation = useSyncTemplates();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isUseModalOpen, setIsUseModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const handleSync = () => {
    syncMutation.mutate();
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category === 'all' ? null : category);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const clearFilters = () => {
    setSelectedCategory(null);
    setSelectedTags([]);
    setSearchQuery('');
  };

  const handleUseTemplate = (template: Template) => {
    if (!canManageWorkflows) return;
    setSelectedTemplate(template);
    setIsUseModalOpen(true);
    track(Events.TemplateUseClicked, {
      template_id: template.id,
      template_name: template.name,
      category: template.category,
    });
  };

  const handleTemplateUseSuccess = (workflowId: string) => {
    setIsUseModalOpen(false);
    setSelectedTemplate(null);
    navigate(`/workflows/${workflowId}`);
  };

  const isSyncing = syncMutation.isPending;
  const hasFilters = Boolean(selectedCategory || selectedTags.length > 0 || searchQuery);

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-6 md:py-8 px-3 md:px-6 max-w-7xl">
        {/* Filters */}
        <div className="mb-6 space-y-3">
          {/* Search + Category + Sync */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 h-9"
              />
            </div>

            <Select value={selectedCategory || 'all'} onValueChange={handleCategoryChange}>
              <SelectTrigger className="w-[180px] h-9">
                <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => {
                  const style = getCategoryStyle(cat.category);
                  const CatIcon = style.icon;
                  return (
                    <SelectItem
                      key={cat.category || 'uncategorized'}
                      value={cat.category || 'uncategorized'}
                    >
                      <span className="flex items-center gap-2">
                        <CatIcon className={cn('h-3.5 w-3.5', style.accent)} />
                        {cat.category || 'Uncategorized'} ({cat.count})
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing || !canManageWorkflows}
              className="gap-2 h-9"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
              <span className="hidden sm:inline">Sync</span>
            </Button>
          </div>

          {/* Tags + Clear */}
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 ml-1">
              <Tag className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
              {tags.slice(0, 12).map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200',
                    'border',
                    selectedTags.includes(tag)
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted hover:border-border',
                  )}
                >
                  {tag}
                </button>
              ))}

              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-7 px-2.5 text-xs gap-1 text-muted-foreground hover:text-foreground ml-1"
                >
                  <X className="h-3 w-3" />
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-destructive">Error loading templates</p>
                <p className="text-xs text-destructive/70 truncate">{error.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onUse={handleUseTemplate}
                onPreview={setPreviewTemplate}
                canUse={canManageWorkflows}
              />
            ))}
          </div>
        )}
      </div>

      {/* Template Detail Modal */}
      <TemplateDetailModal
        template={previewTemplate}
        open={!!previewTemplate}
        onOpenChange={(open) => {
          if (!open) setPreviewTemplate(null);
        }}
        onUse={(template) => {
          setPreviewTemplate(null);
          handleUseTemplate(template);
        }}
        canUse={canManageWorkflows}
      />

      {/* Use Template Modal */}
      {selectedTemplate && (
        <UseTemplateModal
          template={selectedTemplate}
          open={isUseModalOpen}
          onOpenChange={(open) => {
            setIsUseModalOpen(open);
            if (!open) setSelectedTemplate(null);
          }}
          onSuccess={handleTemplateUseSuccess}
        />
      )}
    </div>
  );
}
