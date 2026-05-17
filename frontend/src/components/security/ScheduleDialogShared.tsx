import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Search } from 'lucide-react';

import { CadencePicker } from '@/components/schedules/CadencePicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function ScheduleDialogTitle({
  onBack,
  children,
}: {
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center mr-2 text-muted-foreground hover:text-foreground transition-colors align-middle"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      {children}
    </>
  );
}

export interface ScheduleScanOption {
  id: string;
  name: string;
  description: string;
}

export function ScheduleScanTypePicker({
  scans,
  selectedScan,
  onSelect,
  columns = 1,
}: {
  scans: ScheduleScanOption[];
  selectedScan: string | null;
  onSelect: (scanId: string) => void;
  columns?: 1 | 2;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Scan type</Label>
      {scans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Some scan types are unavailable for your organization. Contact your admin.
        </p>
      ) : (
        <div className={columns === 2 ? 'grid grid-cols-2 gap-2' : 'grid gap-2'}>
          {scans.map((scan) => (
            <button
              key={scan.id}
              type="button"
              onClick={() => onSelect(scan.id)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                selectedScan === scan.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="font-medium">{scan.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{scan.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScheduleCadenceAndNameFields({
  cronExpression,
  humanLabel,
  scheduleName,
  onCadenceChange,
  onScheduleNameChange,
}: {
  cronExpression: string;
  humanLabel: string;
  scheduleName: string;
  onCadenceChange: (cron: string, label: string) => void;
  onScheduleNameChange: (name: string) => void;
}) {
  return (
    <>
      <CadencePicker
        cronExpression={cronExpression}
        humanLabel={humanLabel}
        onChange={onCadenceChange}
      />

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Schedule name</Label>
        <Input
          value={scheduleName}
          onChange={(e) => onScheduleNameChange(e.target.value)}
          className="text-sm"
        />
      </div>
    </>
  );
}

export function ScheduleDuplicateWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2.5 text-sm">
      <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
      <span className="text-yellow-800 dark:text-yellow-200">{children}</span>
    </div>
  );
}

export function ScheduleDialogActions({
  onCancel,
  onSubmit,
  isPending,
  isValid,
  hasDuplicate,
  disabled = false,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  isPending: boolean;
  isValid: boolean;
  hasDuplicate: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" disabled={!isValid || isPending || disabled} onClick={onSubmit}>
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {hasDuplicate ? 'Create anyway' : 'Create schedule'}
      </Button>
    </div>
  );
}

export function SearchableSelectionList<T>({
  items,
  isLoading,
  search,
  onSearchChange,
  searchPlaceholder,
  emptyMessage,
  renderItem,
  getKey,
  showSearch = true,
  listClassName,
}: {
  items: T[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  emptyMessage: ReactNode;
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  showSearch?: boolean;
  listClassName?: string;
}) {
  return (
    <div className="space-y-3 py-2">
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      )}
      <div className={cn('max-h-64 overflow-y-auto space-y-1', listClassName)}>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">{emptyMessage}</p>
        ) : (
          items.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>)
        )}
      </div>
    </div>
  );
}
