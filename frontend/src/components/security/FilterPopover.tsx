import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Filter, Search, X } from 'lucide-react';

const SEARCH_THRESHOLD = 8;

export function FilterPopover({
  label,
  options,
  selected,
  onToggle,
  wide,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Use wider popover for long option values (file paths, rule IDs) */
  wide?: boolean;
}) {
  const hasSelection = selected.length > 0;
  const [search, setSearch] = useState('');
  const showSearch = options.length >= SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, search]);

  // Sort: selected items first, then alphabetical
  const sorted = useMemo(() => {
    if (!hasSelection) return filtered;
    const selectedSet = new Set(selected);
    return [...filtered].sort((a, b) => {
      const aSelected = selectedSet.has(a) ? 0 : 1;
      const bSelected = selectedSet.has(b) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return a.localeCompare(b);
    });
  }, [filtered, selected, hasSelection]);

  return (
    <Popover onOpenChange={() => setSearch('')}>
      <PopoverTrigger asChild>
        <Button variant={hasSelection ? 'default' : 'outline'} size="sm" className="h-8 gap-1">
          <Filter className="h-3 w-3" />
          {label}
          {hasSelection && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`${wide ? 'w-72' : 'w-52'} p-2`}>
        {showSearch && (
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder={`Filter ${label.toLowerCase()}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 pr-7 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {hasSelection && (
          <button
            onClick={() => selected.forEach((s) => onToggle(s))}
            className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 mb-1"
          >
            Clear all
          </button>
        )}
        <div className="space-y-0.5 max-h-56 overflow-y-auto">
          {sorted.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">
              {search ? 'No matches' : 'No options'}
            </p>
          )}
          {sorted.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm min-w-0"
              title={opt}
            >
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={() => onToggle(opt)}
                className="flex-shrink-0"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
