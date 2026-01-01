import { useState } from 'react';
import { ArrayFieldItemTemplateProps } from '@rjsf/utils';
import { ArrowUp, ArrowDown, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ArrayFieldItemTemplate = (props: ArrayFieldItemTemplateProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const {
    children,
    className,
    disabled,
    index,
    readonly,
  } = props;
  
  // Robust extraction logic
  const anyProps = props as any;
  const buttonsProps = anyProps.buttonsProps || {};
  
  const hasMoveUp = anyProps.hasMoveUp || buttonsProps.hasMoveUp;
  const hasMoveDown = anyProps.hasMoveDown || buttonsProps.hasMoveDown;
  const hasRemove = anyProps.hasRemove || buttonsProps.hasRemove;
  
  // Use the specific handlers found in debug logs
  // onReorderClick is standard, onMoveUpItem is what we found in buttonsProps
  const onMoveUpRaw = anyProps.onReorderClick || buttonsProps.onMoveUpItem;
  const onMoveDownRaw = anyProps.onReorderClick || buttonsProps.onMoveDownItem;
  const onRemoveRaw = anyProps.onDropIndexClick || buttonsProps.onRemoveItem;
  
  // Wrap handlers safely
  // Based on "Item 0 works, Item 1 crashes" behavior, the handler in buttonsProps 
  // expects an EVENT, meaning it is ALREADY bound to the index.
  // Passing 'index' makes it treat '1' as a truthy event object => crash.
  
  const onMoveUp = (event: any) => {
      if (buttonsProps.onMoveUpItem) return buttonsProps.onMoveUpItem(event);
      if (onMoveUpRaw) return onMoveUpRaw(index, index - 1);
  };
  
  const onMoveDown = (event: any) => {
      if (buttonsProps.onMoveDownItem) return buttonsProps.onMoveDownItem(event);
      if (onMoveDownRaw) return onMoveDownRaw(index, index + 1);
  };

  const onRemove = (event: any) => {
      if (buttonsProps.onRemoveItem) return buttonsProps.onRemoveItem(event);
      if (onRemoveRaw) return onRemoveRaw(index);
  };

  const btnClass = "p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className={cn("border rounded-md mb-2 bg-card/50", className)}>
      {/* Header Row: Index + Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/10">
        
        <div className="flex items-center gap-2">
            <button 
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-muted-foreground hover:text-foreground transition-colors"
            >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            <span 
                className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider select-none cursor-pointer" 
                onClick={() => setIsExpanded(!isExpanded)}
            >
            Item {index + 1}
            </span>
        </div>

        <div className="flex items-center gap-0.5">
            {(hasMoveUp || hasMoveDown) && (
              <>
                <button
                  type="button"
                  disabled={disabled || readonly || !hasMoveUp}
                  onClick={onMoveUp}
                  className={btnClass}
                  title="Move Up"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={disabled || readonly || !hasMoveDown}
                  onClick={onMoveDown}
                  className={btnClass}
                  title="Move Down"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </>
            )}
            
            {hasRemove && (
              <button
                type="button"
                disabled={disabled || readonly}
                onClick={onRemove}
                className={cn(btnClass, "hover:bg-destructive/5 hover:text-destructive ml-0.5")}
                title="Remove"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="p-2">
            {children}
        </div>
      )}
    </div>
  );
};