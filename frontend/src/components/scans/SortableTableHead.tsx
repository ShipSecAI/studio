import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface SortableTableHeadProps<T extends string> {
  column: T;
  label: string;
  currentSort: T;
  currentDir: 'asc' | 'desc';
  onSort: (column: T) => void;
  className?: string;
}

export function SortableTableHead<T extends string>({
  column,
  label,
  currentSort,
  currentDir,
  onSort,
  className,
}: SortableTableHeadProps<T>) {
  const isActive = currentSort === column;
  const Icon = isActive ? (currentDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead
      className={cn('cursor-pointer select-none hover:bg-muted/50', className)}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        <Icon
          className={cn('h-3.5 w-3.5', isActive ? 'text-foreground' : 'text-muted-foreground/50')}
        />
      </div>
    </TableHead>
  );
}
