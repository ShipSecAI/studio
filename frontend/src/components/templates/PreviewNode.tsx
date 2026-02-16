import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import * as LucideIcons from 'lucide-react';
import { cn } from '@/lib/utils';
import { useComponentStore } from '@/store/componentStore';
import {
  getCategoryHeaderBackgroundColor,
  getCategorySeparatorColor,
} from '@/utils/categoryColors';
import { useThemeStore } from '@/store/themeStore';
import { getNodeVisual } from './nodeTypeVisuals';

interface PreviewNodeData {
  nodeType: string;
  label?: string;
}

function PreviewNodeInner({ data }: { data: PreviewNodeData }) {
  const { getComponent } = useComponentStore();
  const theme = useThemeStore((state) => state.theme);
  const isDarkMode = theme === 'dark';

  const component = getComponent(data.nodeType);
  const visual = getNodeVisual(data.nodeType);

  // Use component store data when available, fall back to nodeTypeVisuals
  const label = data.label || component?.name || visual.label;
  const logo = component?.logo || visual.iconUrl;
  const category = component?.category ?? 'input';
  const isEntryPoint = component?.id === 'core.workflow.entrypoint';

  const iconName =
    component?.icon && component.icon in LucideIcons ? component.icon : visual.lucideIcon || 'Box';
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{
    className?: string;
  }>;

  const separatorColor = getCategorySeparatorColor(category, isDarkMode);
  const headerBgColor = getCategoryHeaderBackgroundColor(category, isDarkMode);

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <div
        className={cn(
          'shadow-md border-2 bg-background transition-none',
          isEntryPoint ? 'rounded-[1.5rem]' : 'rounded-lg',
          'border-border',
        )}
        style={{ minWidth: 180, maxWidth: 220 }}
      >
        {/* Header - matches WorkflowNode header */}
        <div
          className={cn(
            'px-2.5 py-1.5 border-b',
            isEntryPoint ? 'rounded-t-[1.5rem]' : 'rounded-t-lg',
          )}
          style={{
            borderColor: separatorColor || 'hsl(var(--border) / 0.5)',
            backgroundColor: headerBgColor || undefined,
          }}
        >
          <div className="flex items-center gap-1.5">
            {logo ? (
              <img
                src={logo}
                alt=""
                className="h-4 w-4 flex-shrink-0 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            {IconComponent && (
              <IconComponent
                className={cn('h-4 w-4 flex-shrink-0 text-foreground', logo && 'hidden')}
              />
            )}
            <span className="text-xs font-semibold truncate">{label}</span>
          </div>
        </div>

        {/* Minimal body to match node proportions */}
        <div className="px-2.5 py-1.5">
          {component && !isEntryPoint && (
            <div className="text-[10px] text-muted-foreground truncate">
              {component.description
                ? component.description.length > 50
                  ? component.description.slice(0, 50) + '…'
                  : component.description
                : component.id}
            </div>
          )}
          {!component && (
            <div className="text-[10px] text-muted-foreground truncate">{data.nodeType}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
    </>
  );
}

export const PreviewNode = memo(PreviewNodeInner);
