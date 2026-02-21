import { useMemo, useState } from 'react';
import { format, subHours, subDays, startOfDay, endOfDay, isAfter } from 'date-fns';
import { CalendarIcon, RefreshCw, X, ListFilter, Clock } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useAuditLogs } from '@/hooks/queries/useAuditLogQueries';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { hasAdminRole } from '@/utils/auth';

const RESOURCE_TYPE_OPTIONS = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'secret', label: 'Secret' },
  { value: 'api_key', label: 'API Key' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'artifact', label: 'Artifact' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'mcp_server', label: 'MCP Server' },
  { value: 'mcp_group', label: 'MCP Group' },
  { value: 'human_input', label: 'Human Input' },
] as const;

const ACTION_OPTIONS = [
  'analytics.query',
  'api_key.create',
  'api_key.update',
  'api_key.revoke',
  'api_key.reactivate',
  'api_key.delete',
  'artifact.download',
  'artifact.delete',
  'human_input.resolve',
  'mcp_group.import_template',
  'mcp_group.create',
  'mcp_group.update',
  'mcp_group.delete',
  'mcp_server.create',
  'mcp_server.update',
  'mcp_server.toggle',
  'mcp_server.delete',
  'schedule.create',
  'schedule.update',
  'schedule.delete',
  'schedule.pause',
  'schedule.resume',
  'schedule.trigger',
  'secret.create',
  'secret.rotate',
  'secret.access',
  'secret.update',
  'secret.delete',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'webhook.regenerate_path',
  'webhook.url_access',
  'workflow.create',
  'workflow.update',
  'workflow.update_metadata',
  'workflow.commit',
  'workflow.run',
  'workflow.delete',
] as const;

function formatTimestamp(iso: string) {
  return format(new Date(iso), 'MMM d, HH:mm:ss');
}

function safeJsonPreview(value: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) return '—';
  try {
    const str = JSON.stringify(value);
    if (str === '{}') return '—';
    return str;
  } catch {
    return '—';
  }
}

interface MultiSelectFilterProps {
  label: string;
  selectedValues: string[];
  options: readonly string[] | readonly { value: string; label: string }[];
  onToggle: (value: string) => void;
  onClear: () => void;
}

function MultiSelectFilter({
  label,
  selectedValues,
  options,
  onToggle,
  onClear,
}: MultiSelectFilterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs gap-1.5 px-3 border-dashed bg-background hover:bg-muted/50 transition-colors font-medium',
            selectedValues.length > 0 && 'border-primary/50 bg-primary/5 text-primary',
          )}
        >
          <ListFilter className="h-3.5 w-3.5 opacity-70" />
          <span>{label}</span>
          {selectedValues.length > 0 && (
            <>
              <div className="w-px h-3.5 bg-border mx-1.5" />
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-bold bg-primary/10 text-primary border-none min-w-[1.25rem] justify-center"
              >
                {selectedValues.length}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-3 border-b flex items-center justify-between bg-muted/20">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {selectedValues.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-6 text-[10px] px-2 hover:bg-destructive/10 hover:text-destructive uppercase font-bold tracking-tight"
            >
              Clear
            </Button>
          )}
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {options.map((option) => {
            const val = typeof option === 'string' ? option : option.value;
            const lab = typeof option === 'string' ? option : option.label;
            const isChecked = selectedValues.includes(val);
            return (
              <div
                key={val}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 hover:bg-muted rounded-md cursor-pointer transition-colors select-none',
                  isChecked && 'bg-accent text-accent-foreground',
                )}
                onClick={() => onToggle(val)}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggle(val)}
                  className="h-4 w-4"
                />
                <span className="text-sm truncate leading-none pt-0.5">{lab}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const DATE_PRESETS = [
  { label: 'Today', getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  {
    label: 'Yesterday',
    getValue: () => {
      const yesterday = subDays(new Date(), 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
  },
  { label: 'Last 24 hours', getValue: () => ({ from: subHours(new Date(), 24), to: new Date() }) },
  { label: 'Last 7 days', getValue: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: 'Last 30 days', getValue: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
];

interface DateTimeRangePickerProps {
  from: Date | undefined;
  to: Date | undefined;
  onSelect: (range: { from?: Date; to?: Date }) => void;
}

function DateTimeRangePicker({ from, to, onSelect }: DateTimeRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Internal state for the picker, committed on Apply
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from, to });
  const [startTime, setStartTime] = useState(from ? format(from, 'HH:mm') : '00:00');
  const [endTime, setEndTime] = useState(to ? format(to, 'HH:mm') : '23:59');

  // Reset internal state when prop changes or popover opens
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setDateRange({ from, to });
      setStartTime(from ? format(from, 'HH:mm') : '00:00');
      setEndTime(to ? format(to, 'HH:mm') : '23:59');
    }
  };

  const handleApply = () => {
    if (!dateRange?.from) {
      onSelect({ from: undefined, to: undefined });
      setIsOpen(false);
      return;
    }

    let newFrom = new Date(dateRange.from);
    const [startH, startM] = startTime.split(':').map(Number);
    newFrom.setHours(startH || 0, startM || 0, 0, 0);

    let newTo = dateRange.to ? new Date(dateRange.to) : new Date(newFrom);
    const [endH, endM] = endTime.split(':').map(Number);
    newTo.setHours(endH || 0, endM || 0, 59, 999);

    // Swap if needed
    if (isAfter(newFrom, newTo)) {
      [newFrom, newTo] = [newTo, newFrom];
    }

    onSelect({ from: newFrom, to: newTo });
    setIsOpen(false);
  };

  const handlePresetSelect = (preset: (typeof DATE_PRESETS)[0]) => {
    const range = preset.getValue();
    setDateRange({ from: range.from, to: range.to });
    setStartTime(format(range.from, 'HH:mm'));
    setEndTime(format(range.to, 'HH:mm'));
  };

  const displayText = useMemo(() => {
    if (!from) return 'Date Range';
    if (!to) return `${format(from, 'MMM d, HH:mm')} - ...`;
    return `${format(from, 'MMM d, HH:mm')} - ${format(to, 'MMM d, HH:mm')}`;
  }, [from, to]);

  const hasSelection = !!(from || to);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs gap-2 px-3 border-dashed bg-background hover:bg-muted/50 transition-colors font-medium',
            hasSelection && 'border-primary/50 bg-primary/5 text-primary',
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 opacity-70" />
          <span>{hasSelection ? 'Time' : 'Date Range'}</span>
          {hasSelection && (
            <>
              <div className="w-px h-3.5 bg-border mx-1" />
              <span className="text-[11px] font-semibold text-primary truncate max-w-[200px]">
                {displayText}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Presets Sidebar */}
          <div className="border-r w-[140px] p-2 flex flex-col gap-1 bg-muted/10">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Presets
            </div>
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="justify-start h-8 text-xs font-normal"
                onClick={() => handlePresetSelect(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Calendar & Time */}
          <div className="p-4 flex flex-col gap-4">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from ? undefined : subDays(new Date(), 30)}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              className="rounded-md border shadow-sm"
            />

            <div className="flex items-center gap-4 pt-2 border-t">
              <div className="flex-1 space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Start Time
                </div>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> End Time
                </div>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="flex items-end gap-2 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateRange(undefined);
                    setStartTime('00:00');
                    setEndTime('23:59');
                  }}
                  className="h-8 text-xs"
                >
                  Reset
                </Button>
                <Button size="sm" onClick={handleApply} className="h-8 text-xs">
                  Apply Range
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AuditLogSettings() {
  const roles = useAuthStore((state) => state.roles);
  const isAdmin = hasAdminRole(roles);

  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);

  // Consolidated date range state
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});

  const filters = useMemo(
    () => ({
      action: selectedActions.length > 0 ? selectedActions.join(',') : undefined,
      resourceType: selectedResources.length > 0 ? selectedResources.join(',') : undefined,
      from: dateRange.from ? dateRange.from.toISOString() : undefined,
      to: dateRange.to ? dateRange.to.toISOString() : undefined,
      limit: 50,
    }),
    [selectedActions, selectedResources, dateRange],
  );

  const hasActiveFilters =
    selectedActions.length > 0 ||
    selectedResources.length > 0 ||
    dateRange.from !== undefined ||
    dateRange.to !== undefined;

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error,
  } = useAuditLogs(filters, isAdmin);
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const loading = isLoading || (isFetching && !isFetchingNextPage);
  const errorMessage = error instanceof Error ? error.message : null;

  const clearFilters = () => {
    setSelectedActions([]);
    setSelectedResources([]);
    setDateRange({});
  };

  const toggleAction = (val: string) => {
    setSelectedActions((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  };

  const toggleResource = (val: string) => {
    setSelectedResources((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  };

  if (!isAdmin) {
    return (
      <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
        Audit logs are available to organization admins only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Audit Log</h2>
          <p className="text-sm text-muted-foreground">Review activity across your organization.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => void refetch()}
            disabled={loading}
            title="Refresh logs"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Filter Bar Above Table */}
      <div className="flex flex-wrap items-center gap-3 pb-2">
        <MultiSelectFilter
          label="Action"
          selectedValues={selectedActions}
          options={ACTION_OPTIONS}
          onToggle={toggleAction}
          onClear={() => setSelectedActions([])}
        />

        <MultiSelectFilter
          label="Resource"
          selectedValues={selectedResources}
          options={RESOURCE_TYPE_OPTIONS}
          onToggle={toggleResource}
          onClear={() => setSelectedResources([])}
        />

        <DateTimeRangePicker from={dateRange.from} to={dateRange.to} onSelect={setDateRange} />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 text-xs text-muted-foreground hover:text-foreground px-3 gap-1.5 group font-medium"
          >
            <X className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
            Clear all
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card shadow-sm overflow-hidden flex flex-col">
        {errorMessage && (
          <div className="bg-destructive/10 px-6 py-3 text-sm text-destructive border-b font-medium">
            Error: {errorMessage}
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Time</TableHead>
                <TableHead className="min-w-[120px]">Actor</TableHead>
                <TableHead className="min-w-[200px]">Action</TableHead>
                <TableHead className="min-w-[180px]">Resource</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && !isFetching && (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                      <p className="text-base font-medium text-foreground">No events found</p>
                      <p className="text-sm">Try adjusting your filters to see more results.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-normal">
                      {row.actorType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{row.action}</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{row.resourceType}</span>
                      <span className="text-xs text-muted-foreground font-mono leading-tight truncate max-w-[180px]">
                        {row.resourceName ?? row.resourceId ?? '—'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                    {safeJsonPreview(row.metadata)}
                  </TableCell>
                </TableRow>
              ))}
              {isFetchingNextPage && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground animate-pulse"
                  >
                    Loading more events...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="p-3 border-t flex items-center justify-between bg-muted/5">
          <div className="text-[10px] text-muted-foreground ml-2 font-bold tracking-widest uppercase opacity-70">
            {items.length} {items.length === 1 ? 'Event' : 'Events'} Loaded
          </div>
          {hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs px-4"
              disabled={isFetchingNextPage}
              onClick={() => {
                if (!hasNextPage) return;
                void fetchNextPage();
              }}
            >
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
