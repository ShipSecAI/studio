import { useMemo, useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSecretStore, type SecretStore } from '@/store/secretStore';
import { useComponentStore } from '@/store/componentStore';
import { getNodeValidationWarnings } from '@/utils/connectionValidation';
import type { Node, Edge } from 'reactflow';
import type { NodeData, FrontendNodeData } from '@/schemas/node';

interface ValidationIssue {
  nodeId: string;
  nodeLabel: string;
  message: string;
}

interface ValidationDockProps {
  nodes: Node<NodeData>[];
  edges: Edge[];
  mode: string;
  onNodeClick: (nodeId: string) => void;
}

const COLLAPSE_THRESHOLD = 2; // Collapse when more than 2 issues

// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

export function ValidationDock({ nodes, edges, mode, onNodeClick }: ValidationDockProps) {
  const { getComponent } = useComponentStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  // Only show validation in design mode
  const isDesignMode = mode === 'design';

  const secrets = useSecretStore((state: SecretStore) => state.secrets);

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    if (!isDesignMode) return [];

    const issues: ValidationIssue[] = [];

    nodes.forEach((node) => {
      const nodeData = node.data as any;
      const componentRef = nodeData.componentId ?? nodeData.componentSlug;
      const component = getComponent(componentRef);

      if (!component) return;

      // Get validation warnings using the existing utility
      // FrontendNodeData extends NodeData, so this cast is safe
      const warnings = getNodeValidationWarnings(
        node as Node<FrontendNodeData>,
        edges,
        component,
        secrets,
      );

      warnings.forEach((warning: string) => {
        issues.push({
          nodeId: node.id,
          nodeLabel: nodeData.label || component.name || node.id,
          message: warning,
        });
      });
    });

    return issues;
  }, [nodes, edges, getComponent, isDesignMode, secrets]);

  const totalIssues = validationIssues.length;
  const hasIssues = totalIssues > 0;
  const shouldCollapse = totalIssues > COLLAPSE_THRESHOLD;

  // Don't show dock if not in design mode
  if (!isDesignMode) {
    return null;
  }

  // Handle node click in mobile view - close sheet after clicking
  const handleMobileNodeClick = (nodeId: string) => {
    onNodeClick(nodeId);
    setIsMobileSheetOpen(false);
  };

  // Mobile: Compact floating button + bottom sheet
  if (isMobile) {
    return (
      <>
        {/* Floating button - bottom left */}
        <button
          type="button"
          onClick={() => setIsMobileSheetOpen(true)}
          className={cn(
            'absolute bottom-3 left-3 z-[30]',
            'flex items-center gap-1.5 px-2.5 py-2 rounded-full shadow-lg',
            'bg-background/95 backdrop-blur-sm border',
            'transition-all duration-200 active:scale-95',
            hasIssues
              ? 'border-red-500/50 hover:border-red-500'
              : 'border-green-500/50 hover:border-green-500',
          )}
        >
          {hasIssues ? (
            <>
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-medium">{totalIssues}</span>
            </>
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
        </button>

        {/* Bottom sheet backdrop */}
        {isMobileSheetOpen && (
          <div
            className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileSheetOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Bottom sheet */}
        <div
          className={cn(
            'fixed left-0 right-0 bottom-0 z-[60]',
            'bg-background border-t rounded-t-2xl shadow-2xl',
            'transition-transform duration-300 ease-out',
            'max-h-[60vh] flex flex-col',
            isMobileSheetOpen ? 'translate-y-0' : 'translate-y-full',
          )}
        >
          {/* Handle bar */}
          <div className="flex justify-center py-2">
            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pb-3 border-b">
            <div className="flex items-center gap-2">
              {hasIssues ? (
                <AlertCircle className="h-4 w-4 text-red-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              <span className="text-sm font-medium">
                {hasIssues
                  ? `${totalIssues} ${totalIssues === 1 ? 'issue' : 'issues'}`
                  : 'All validated'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsMobileSheetOpen(false)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Issue list */}
          <div className="flex-1 overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
            {hasIssues ? (
              <div className="divide-y divide-border">
                {validationIssues.map((issue, index) => (
                  <button
                    key={`${issue.nodeId}-${index}`}
                    type="button"
                    onClick={() => handleMobileNodeClick(issue.nodeId)}
                    className={cn(
                      'w-full text-left px-4 py-3 flex items-start gap-2',
                      'hover:bg-red-50/50 dark:hover:bg-red-950/30',
                      'transition-colors cursor-pointer active:bg-muted',
                    )}
                  >
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{issue.nodeLabel}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{issue.message}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No validation issues found</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop: Original inline dock
  return (
    <div
      className={cn(
        'absolute bottom-3 z-50',
        'bg-background/95 backdrop-blur-sm border rounded-md shadow-md',
        'max-w-lg w-auto',
        'transition-all duration-200',
        hasIssues ? 'border-red-500/50' : 'border-green-500/50',
      )}
      style={{
        left: '40%', // 50% - 10% = 40%
        transform: 'translateX(-50%)',
      }}
    >
      {hasIssues ? (
        <>
          <button
            type="button"
            onClick={() => shouldCollapse && setIsExpanded(!isExpanded)}
            className={cn(
              'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/50',
              shouldCollapse && 'cursor-pointer hover:bg-muted/50 transition-colors',
            )}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
              <span className="text-[11px] font-medium">
                {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            {shouldCollapse && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <span className="text-[10px]">{isExpanded ? 'Collapse' : 'Expand'}</span>
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronUp className="h-3 w-3" />
                )}
              </div>
            )}
          </button>
          <div
            className={cn(
              'divide-y divide-border/50 overflow-hidden transition-all duration-200',
              shouldCollapse && !isExpanded && 'max-h-0',
              (!shouldCollapse || isExpanded) && 'max-h-[300px] overflow-y-auto',
            )}
            onWheel={(e) => e.stopPropagation()}
          >
            {validationIssues.map((issue, index) => (
              <button
                key={`${issue.nodeId}-${index}`}
                type="button"
                onClick={() => onNodeClick(issue.nodeId)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]',
                  'hover:bg-red-50/50 dark:hover:bg-red-950/30',
                  'transition-colors cursor-pointer',
                  'group',
                )}
              >
                <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
                <span className="font-medium text-foreground group-hover:text-red-600 dark:group-hover:text-red-400 truncate">
                  {issue.nodeLabel}
                </span>
                <span className="text-muted-foreground truncate">· {issue.message}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          <span className="text-[11px] text-muted-foreground">All validated</span>
        </div>
      )}
    </div>
  );
}
