import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Filter } from 'lucide-react';

export function FilterPopover({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const hasSelection = selected.length > 0;
  return (
    <Popover>
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
      <PopoverContent align="start" className="w-48 p-2">
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {options.length === 0 && <p className="text-xs text-muted-foreground p-2">No options</p>}
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm"
            >
              <Checkbox checked={selected.includes(opt)} onCheckedChange={() => onToggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
