import { useEffect, useMemo, useState } from 'react';
import { format, subHours, subDays, startOfDay, endOfDay, isAfter } from 'date-fns';
import { CalendarIcon, Clock, Columns3, ListFilter, RefreshCw, X } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const COLUMN_PREFERENCE_STORAGE_KEY = 'audit-log-columns-v2';
const COLUMN_WIDTH_STORAGE_KEY = 'audit-log-column-widths-v1';

type AuditColumnId = 'time' | 'actor' | 'actorType' | 'action' | 'resource' | 'details' | 'ip';
type ColumnWidthMap = Record<AuditColumnId, number>;
interface ActiveResize {
  columnId: AuditColumnId;
  startX: number;
  startWidth: number;
}

interface AuditColumnDefinition {
  id: AuditColumnId;
  label: string;
  width: number;
  minViewport: number;
}

const AUDIT_COLUMNS: readonly AuditColumnDefinition[] = [
  { id: 'time', label: 'Time', width: 176, minViewport: 0 },
  { id: 'actor', label: 'Actor', width: 220, minViewport: 0 },
  { id: 'actorType', label: 'Actor Type', width: 132, minViewport: 640 },
  { id: 'action', label: 'Action', width: 220, minViewport: 0 },
  { id: 'resource', label: 'Resource', width: 220, minViewport: 768 },
  { id: 'details', label: 'Details', width: 360, minViewport: 1024 },
  { id: 'ip', label: 'IP', width: 160, minViewport: 1280 },
] as const;

const COLUMN_LOOKUP = Object.fromEntries(
  AUDIT_COLUMNS.map((column) => [column.id, column]),
) as Record<AuditColumnId, AuditColumnDefinition>;

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
] as const;

type DatePreset = (typeof DATE_PRESETS)[number];

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

function getAutoColumns(viewportWidth: number): AuditColumnId[] {
  if (viewportWidth >= 1280) {
    return ['time', 'actor', 'actorType', 'action', 'resource', 'details', 'ip'];
  }
  if (viewportWidth >= 1024) {
    return ['time', 'actor', 'actorType', 'action', 'resource', 'details'];
  }
  if (viewportWidth >= 768) {
    return ['time', 'actor', 'action', 'resource'];
  }
  return ['time', 'actor', 'action'];
}

function getInitialViewportWidth() {
  return typeof window === 'undefined' ? 1280 : window.innerWidth;
}

function parseStoredColumns(
  raw: string | null,
): { mode: 'auto' | 'custom'; columns: AuditColumnId[] } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      mode?: 'auto' | 'custom';
      columns?: string[];
    };
    if (!parsed.mode || !Array.isArray(parsed.columns)) return null;
    const validColumns = parsed.columns.filter((column): column is AuditColumnId =>
      AUDIT_COLUMNS.some((candidate) => candidate.id === column),
    );
    return {
      mode: parsed.mode,
      columns: validColumns,
    };
  } catch {
    return null;
  }
}

function getDefaultColumnWidths(): ColumnWidthMap {
  return Object.fromEntries(
    AUDIT_COLUMNS.map((column) => [column.id, column.width]),
  ) as ColumnWidthMap;
}

function parseStoredColumnWidths(raw: string | null): ColumnWidthMap | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const defaults = getDefaultColumnWidths();

    return AUDIT_COLUMNS.reduce((acc, column) => {
      const nextWidth = parsed[column.id];
      acc[column.id] =
        typeof nextWidth === 'number' && Number.isFinite(nextWidth)
          ? Math.max(120, Math.min(nextWidth, 520))
          : defaults[column.id];
      return acc;
    }, {} as ColumnWidthMap);
  } catch {
    return null;
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
  const handleToggle = (value: string) => {
    onToggle(value);
  };

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
            const value = typeof option === 'string' ? option : option.value;
            const labelValue = typeof option === 'string' ? option : option.label;
            const isChecked = selectedValues.includes(value);
            return (
              <div
                key={value}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 hover:bg-muted rounded-md cursor-pointer transition-colors select-none',
                  isChecked && 'bg-accent text-accent-foreground',
                )}
                onClick={() => handleToggle(value)}
              >
                <Checkbox
                  checked={isChecked}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() => handleToggle(value)}
                  className="h-4 w-4"
                />
                <span className="text-sm truncate leading-none pt-0.5">{labelValue}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface DateTimeRangePickerProps {
  from: Date | undefined;
  to: Date | undefined;
  onSelect: (range: { from?: Date; to?: Date }) => void;
}

function DateTimeRangePicker({ from, to, onSelect }: DateTimeRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from, to });
  const [startTime, setStartTime] = useState(from ? format(from, 'HH:mm') : '00:00');
  const [endTime, setEndTime] = useState(to ? format(to, 'HH:mm') : '23:59');

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

    if (isAfter(newFrom, newTo)) {
      [newFrom, newTo] = [newTo, newFrom];
    }

    onSelect({ from: newFrom, to: newTo });
    setIsOpen(false);
  };

  const handlePresetSelect = (preset: DatePreset) => {
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
                  onChange={(event) => setStartTime(event.target.value)}
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
                  onChange={(event) => setEndTime(event.target.value)}
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
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [viewportWidth, setViewportWidth] = useState(getInitialViewportWidth);
  const [columnMode, setColumnMode] = useState<'auto' | 'custom'>('auto');
  const [selectedColumns, setSelectedColumns] = useState<AuditColumnId[]>(() =>
    getAutoColumns(getInitialViewportWidth()),
  );
  const [columnWidths, setColumnWidths] = useState<ColumnWidthMap>(() => getDefaultColumnWidths());
  const [columnsInitialized, setColumnsInitialized] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [activeResize, setActiveResize] = useState<ActiveResize | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = parseStoredColumns(window.localStorage.getItem(COLUMN_PREFERENCE_STORAGE_KEY));
    if (stored) {
      setColumnMode(stored.mode);
      setSelectedColumns(
        stored.columns.length > 0 ? stored.columns : getAutoColumns(getInitialViewportWidth()),
      );
    } else {
      setSelectedColumns(getAutoColumns(getInitialViewportWidth()));
    }

    const storedWidths = parseStoredColumnWidths(
      window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY),
    );
    if (storedWidths) {
      setColumnWidths(storedWidths);
    }

    setColumnsInitialized(true);
  }, []);

  const autoColumns = useMemo(() => getAutoColumns(viewportWidth), [viewportWidth]);

  useEffect(() => {
    if (!columnsInitialized || columnMode !== 'auto') return;
    setSelectedColumns(autoColumns);
  }, [autoColumns, columnMode, columnsInitialized]);

  useEffect(() => {
    if (!columnsInitialized || typeof window === 'undefined') return;
    window.localStorage.setItem(
      COLUMN_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        mode: columnMode,
        columns: selectedColumns,
      }),
    );
  }, [columnMode, selectedColumns, columnsInitialized]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (!activeResize) return;

    const handleMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - activeResize.startX;
      updateColumnWidth(activeResize.columnId, activeResize.startWidth + delta);
    };

    const handleMouseUp = () => {
      setActiveResize(null);
    };

    document.documentElement.style.cursor = 'col-resize';
    document.body.style.cursor = 'col-resize';
    document.documentElement.style.userSelect = 'none';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.documentElement.style.cursor = '';
      document.body.style.cursor = '';
      document.documentElement.style.userSelect = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeResize]);

  useEffect(() => {
    setCurrentPageIndex(0);
  }, [selectedActions, selectedResources, dateRange.from, dateRange.to]);

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

  const pages = data?.pages ?? [];
  const currentItems = pages[currentPageIndex]?.items ?? [];
  const loadedEventCount = useMemo(
    () => pages.reduce((count, page) => count + page.items.length, 0),
    [pages],
  );
  const loading = isLoading || (isFetching && !isFetchingNextPage && pages.length === 0);
  const errorMessage = error instanceof Error ? error.message : null;

  const hiddenByViewportCount = useMemo(
    () =>
      selectedColumns.filter((columnId) => {
        const definition = COLUMN_LOOKUP[columnId];
        return definition.minViewport > viewportWidth;
      }).length,
    [selectedColumns, viewportWidth],
  );

  const visibleColumns = useMemo(() => {
    const columns = AUDIT_COLUMNS.filter(
      (column) => selectedColumns.includes(column.id) && viewportWidth >= column.minViewport,
    );
    return columns.length > 0 ? columns : [COLUMN_LOOKUP.action];
  }, [selectedColumns, viewportWidth]);
  const tableWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + columnWidths[column.id], 0),
    [columnWidths, visibleColumns],
  );

  const canGoBack = currentPageIndex > 0;
  const canGoForward = currentPageIndex < pages.length - 1 || Boolean(hasNextPage);

  const clearFilters = () => {
    setSelectedActions([]);
    setSelectedResources([]);
    setDateRange({});
  };

  const toggleAction = (value: string) => {
    setSelectedActions((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const toggleResource = (value: string) => {
    setSelectedResources((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const toggleColumn = (columnId: AuditColumnId) => {
    setColumnMode('custom');
    setSelectedColumns((prev) => {
      if (prev.includes(columnId)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== columnId);
      }
      return [...prev, columnId];
    });
  };

  const resetColumns = () => {
    setColumnMode('auto');
    setSelectedColumns(autoColumns);
  };

  const updateColumnWidth = (columnId: AuditColumnId, nextWidth: number) => {
    setColumnWidths((prev) => ({
      ...prev,
      [columnId]: Math.max(120, Math.min(Math.round(nextWidth), 520)),
    }));
  };

  const resetColumnWidths = () => {
    setColumnWidths(getDefaultColumnWidths());
  };

  const startColumnResize = (columnId: AuditColumnId, clientX: number) => {
    setActiveResize({
      columnId,
      startX: clientX,
      startWidth: columnWidths[columnId],
    });
  };

  const handleNextPage = async () => {
    if (currentPageIndex < pages.length - 1) {
      setCurrentPageIndex((prev) => prev + 1);
      return;
    }

    if (!hasNextPage) return;

    const result = await fetchNextPage();
    const totalPages = result.data?.pages.length ?? pages.length;
    setCurrentPageIndex((prev) => Math.min(prev + 1, totalPages - 1));
  };

  const handlePrevPage = () => {
    if (!canGoBack) return;
    setCurrentPageIndex((prev) => Math.max(prev - 1, 0));
  };

  const renderCellContent = (columnId: AuditColumnId, row: (typeof currentItems)[number]) => {
    switch (columnId) {
      case 'time':
        return (
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            {formatTimestamp(row.createdAt)}
          </div>
        );
      case 'actor':
        return (
          <div className="flex flex-col gap-0.5 min-w-0 text-sm">
            <span className="font-medium truncate">{row.actorDisplay ?? row.actorId ?? '—'}</span>
            <span className="text-xs text-muted-foreground font-mono truncate">
              {row.actorId ?? 'No actor id'}
            </span>
          </div>
        );
      case 'actorType':
        return (
          <Badge variant="outline" className="text-xs font-normal">
            {row.actorType}
          </Badge>
        );
      case 'action':
        return <div className="text-sm font-medium">{row.action}</div>;
      case 'resource':
        return (
          <div className="flex flex-col gap-0.5 min-w-0 text-sm">
            <span className="font-medium truncate">{row.resourceType}</span>
            <span className="text-xs text-muted-foreground font-mono leading-tight truncate">
              {row.resourceName ?? row.resourceId ?? '—'}
            </span>
          </div>
        );
      case 'details':
        return (
          <div className="text-xs text-muted-foreground font-mono truncate">
            {safeJsonPreview(row.metadata)}
          </div>
        );
      case 'ip':
        return (
          <div className="text-xs text-muted-foreground font-mono truncate">{row.ip ?? '—'}</div>
        );
      default:
        return '—';
    }
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Audit Log</h2>
          <p className="text-sm text-muted-foreground">
            Review activity across your organization with stable columns and page-by-page browsing.
          </p>
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

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2">
                  <Columns3 className="h-3.5 w-3.5" />
                  Choose Columns
                  <Badge variant="secondary" className="text-[10px]">
                    {selectedColumns.length}
                  </Badge>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {AUDIT_COLUMNS.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={selectedColumns.includes(column.id)}
                    onCheckedChange={() => toggleColumn(column.id)}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant={columnMode === 'auto' ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={resetColumns}
            >
              Auto Columns
            </Button>

            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={resetColumnWidths}>
              Reset Widths
            </Button>

            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2 text-xs">
                <X className="h-3.5 w-3.5 mr-1.5" />
                Clear all
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{visibleColumns.length} column(s) visible on this screen.</span>
            {hiddenByViewportCount > 0 && (
              <span>
                {hiddenByViewportCount} selected column(s) are hidden until the viewport gets wider.
              </span>
            )}
            <span>Drag a column border in the table header to resize it.</span>
          </div>
        </div>

        <div className="flex flex-col">
          {errorMessage && (
            <div className="bg-destructive/10 px-6 py-3 text-sm text-destructive border-b font-medium">
              Error: {errorMessage}
            </div>
          )}

          <div className="overflow-x-auto">
            <div className="min-h-[320px]">
              <Table className="table-fixed" style={{ width: tableWidth, minWidth: tableWidth }}>
                <colgroup>
                  {visibleColumns.map((column) => (
                    <col
                      key={column.id}
                      style={{ width: columnWidths[column.id], minWidth: columnWidths[column.id] }}
                    />
                  ))}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((column) => (
                      <TableHead
                        key={column.id}
                        className="group relative select-none"
                        style={{
                          width: columnWidths[column.id],
                          minWidth: columnWidths[column.id],
                          maxWidth: columnWidths[column.id],
                        }}
                      >
                        <div className="pr-3">{column.label}</div>
                        <div
                          role="separator"
                          aria-label={`Resize ${column.label} column`}
                          aria-orientation="vertical"
                          className={cn(
                            'absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none',
                            'after:absolute after:right-1 after:top-1/2 after:h-6 after:w-px after:-translate-y-1/2 after:bg-border',
                            'hover:after:bg-foreground/40 focus:outline-none focus:after:bg-foreground/50',
                            activeResize?.columnId === column.id && 'after:bg-foreground/60',
                          )}
                          style={{ cursor: 'col-resize' }}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            startColumnResize(column.id, event.clientX);
                          }}
                          onDragStart={(event) => event.preventDefault()}
                        />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell
                        colSpan={visibleColumns.length}
                        className="h-32 text-center text-sm text-muted-foreground"
                      >
                        Loading audit log page...
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && currentItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length} className="h-32 text-center">
                        <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                          <p className="text-base font-medium text-foreground">No events found</p>
                          <p className="text-sm">Try adjusting your filters to see more results.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {currentItems.map((row) => (
                    <TableRow key={row.id} className="align-top">
                      {visibleColumns.map((column) => (
                        <TableCell
                          key={`${row.id}-${column.id}`}
                          className="align-top"
                          style={{
                            width: columnWidths[column.id],
                            minWidth: columnWidths[column.id],
                            maxWidth: columnWidths[column.id],
                          }}
                        >
                          {renderCellContent(column.id, row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="p-3 border-t flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-muted/5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                Page {pages.length === 0 ? 0 : currentPageIndex + 1}
                {pages.length > 0 ? ` / ${pages.length}` : ''}
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase opacity-70">
              {loadedEventCount} {loadedEventCount === 1 ? 'event' : 'events'} loaded
              {pages.length > 0
                ? ` · viewing ${currentItems.length} on page ${currentPageIndex + 1}`
                : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs px-4"
                onClick={handlePrevPage}
                disabled={!canGoBack}
              >
                Previous Page
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs px-4"
                disabled={!canGoForward || isFetchingNextPage}
                onClick={() => {
                  void handleNextPage();
                }}
              >
                {isFetchingNextPage
                  ? 'Loading...'
                  : currentPageIndex < pages.length - 1
                    ? 'Next Loaded Page'
                    : hasNextPage
                      ? 'Fetch Next Page'
                      : 'No More Pages'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
