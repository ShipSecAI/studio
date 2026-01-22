import { useState, ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  label: string;
  value: any;
  description?: string;
  icon?: ReactNode;
}

interface LeanSelectProps {
  value?: any;
  onChange: (value: any) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  loading?: boolean;
  onRefresh?: () => void;
  actionButton?: ReactNode;
  icon?: ReactNode;
  emptyMessage?: string;
  clearable?: boolean;
  selectedLabel?: string;
}

/**
 * LeanSelect - A premium, accessible dropdown component with a consistent look and feel.
 */
export function LeanSelect({
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  disabled = false,
  className,
  loading = false,
  onRefresh,
  actionButton,
  icon,
  emptyMessage = 'No options found',
  clearable = false,
  selectedLabel,
}: LeanSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredOptions = options.filter(
    (option) =>
      option.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (option.description && option.description.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const selectedOption = options.find((o) => o.value === value);

  const handleSelect = (val: any) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className="relative group/lean-select">
      <div className="flex items-center gap-1.5">
        <div
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          tabIndex={disabled ? -1 : 0}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(!isOpen);
            } else if (e.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          className={cn(
            'flex-1 px-3 py-2 text-sm border rounded-md bg-background/50 backdrop-blur-sm',
            'flex items-center justify-between gap-2 transition-all duration-200 cursor-pointer outline-none',
            'hover:bg-muted/40 hover:border-muted-foreground/30',
            'focus:ring-2 focus:ring-primary/20 focus:border-primary/50',
            disabled && 'opacity-50 cursor-not-allowed grayscale pointer-events-none',
            className,
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {icon && (
              <div className="flex-shrink-0 text-muted-foreground group-hover/lean-select:text-primary/70 transition-colors pointer-events-none">
                {icon}
              </div>
            )}
            <span className="truncate font-medium text-left pointer-events-none text-foreground">
              {selectedOption ? selectedOption.label : selectedLabel || placeholder}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {clearable && value && !disabled && (
              <button
                type="button"
                onMouseDown={(e) => {
                  // Prevent focus shift which can cause issues
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleSelect(undefined);
                }}
                className="p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-destructive transition-colors focus:outline-none focus:ring-2 focus:ring-destructive/20"
                title="Clear selection"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 pointer-events-none',
                isOpen && 'rotate-180',
              )}
            />
          </div>
        </div>

        {actionButton}
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="absolute z-50 w-full mt-1.5 bg-background/95 backdrop-blur-md border rounded-lg shadow-xl max-h-[400px] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
            {/* Search Bar */}
            <div className="p-2 border-b bg-muted/10 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                placeholder="Search..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-transparent border-none focus:outline-none focus:ring-0"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            <div className="overflow-auto flex-1 py-1 custom-scrollbar">
              {loading && options.length === 0 ? (
                <div className="px-3 py-10 text-sm text-muted-foreground text-center animate-pulse">
                  Loading...
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
                </div>
              ) : (
                <>
                  {clearable && value && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleSelect(undefined);
                      }}
                      className="w-full px-3 py-2 text-xs text-left text-muted-foreground hover:bg-destructive/5 hover:text-destructive transition-colors border-b border-muted/20"
                    >
                      Clear Selection
                    </button>
                  )}
                  {filteredOptions.map((option) => (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={cn(
                        'w-full px-3 py-2.5 text-sm text-left hover:bg-primary/5 transition-all flex flex-col gap-0.5 group/item',
                        value === option.value && 'bg-primary/10 border-l-2 border-primary',
                      )}
                    >
                      <div className="flex items-center justify-between pointer-events-none">
                        <div className="flex items-center gap-2">
                          {option.icon && (
                            <div
                              className={cn(
                                'flex-shrink-0 opacity-50',
                                value === option.value
                                  ? 'text-primary opacity-100'
                                  : 'group-hover/item:text-primary group-hover/item:opacity-100',
                              )}
                            >
                              {option.icon}
                            </div>
                          )}
                          <span
                            className={cn('font-medium', value === option.value && 'text-primary')}
                          >
                            {option.label}
                          </span>
                        </div>
                        {value === option.value && (
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </div>
                      {option.description && (
                        <div className="text-[11px] text-muted-foreground ml-5.5 line-clamp-1 opacity-70 pointer-events-none">
                          {option.description}
                        </div>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* Bottom Section if Refresh is provided */}
            {onRefresh && (
              <div className="p-2 border-t bg-muted/10">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefresh();
                  }}
                  className="flex items-center justify-center gap-2 w-full py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-md transition-all"
                >
                  Refresh List
                </button>
              </div>
            )}
          </div>

          {/* Backdrop for closing */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
        </>
      )}
    </div>
  );
}
