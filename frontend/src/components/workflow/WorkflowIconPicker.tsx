import { useState, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CURATED_ICONS = [
  'Shield',
  'ShieldCheck',
  'ShieldAlert',
  'Lock',
  'Unlock',
  'Key',
  'KeyRound',
  'Scan',
  'ScanLine',
  'Bug',
  'Code',
  'Terminal',
  'FileCode',
  'Binary',
  'Radar',
  'Globe',
  'Server',
  'Database',
  'HardDrive',
  'Cpu',
  'Network',
  'Cloud',
  'CloudCog',
  'Wifi',
  'Router',
  'Container',
  'Box',
  'Package',
  'Boxes',
  'Layers',
  'Search',
  'Eye',
  'EyeOff',
  'Fingerprint',
  'UserCheck',
  'AlertTriangle',
  'AlertCircle',
  'Bell',
  'BellRing',
  'Workflow',
  'GitBranch',
  'GitMerge',
  'Blocks',
  'Puzzle',
  'Zap',
  'Bolt',
  'Flame',
  'Target',
  'Crosshair',
  'FileText',
  'ClipboardCheck',
  'ListChecks',
  'CheckCircle2',
  'Mail',
  'Send',
  'Webhook',
  'Link',
  'ExternalLink',
];

// All Lucide icon names — PascalCase exports (forwardRef objects, not plain functions)
const ALL_ICON_NAMES = Object.keys(LucideIcons).filter(
  (key) => /^[A-Z]/.test(key) && LucideIcons[key as keyof typeof LucideIcons] != null,
);

const MAX_SEARCH_RESULTS = 120;

const COLOR_PRESETS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#6b7280', // gray
  '#1e293b', // slate
];

interface WorkflowIconPickerProps {
  icon: string | null;
  iconColor: string | null;
  onChange: (icon: string | null, iconColor: string | null) => void;
  onClose?: () => void;
  disabled?: boolean;
}

export function WorkflowIconPicker({
  icon,
  iconColor,
  onChange,
  onClose,
  disabled,
}: WorkflowIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const currentIconName = icon && icon in LucideIcons ? icon : 'Workflow';
  const CurrentIcon = LucideIcons[
    currentIconName as keyof typeof LucideIcons
  ] as React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

  const searchLower = search.toLowerCase();
  const filteredIcons = search
    ? ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(searchLower)).slice(
        0,
        MAX_SEARCH_RESULTS,
      )
    : CURATED_ICONS;
  const isCurated = !search;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setSearch('');
          onClose?.();
        }
        if (v) setTimeout(() => searchRef.current?.focus(), 0);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 rounded-md flex-shrink-0', !disabled && 'hover:bg-accent')}
          disabled={disabled}
          title="Change workflow icon"
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{ backgroundColor: iconColor ? `${iconColor}20` : undefined }}
          >
            <CurrentIcon className="h-4 w-4" style={iconColor ? { color: iconColor } : undefined} />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Workflow Icon</span>
            {icon && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  onChange(null, null);
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            )}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {COLOR_PRESETS.map((color) => (
              <button
                key={color}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-all',
                  iconColor === color
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:scale-110',
                )}
                style={{ backgroundColor: color }}
                onClick={() => onChange(icon ?? 'Workflow', color)}
                title={color}
              />
            ))}
          </div>

          <div className="relative">
            <LucideIcons.Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search icons..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-input bg-transparent placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {filteredIcons.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No icons found</p>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                {isCurated ? 'Suggested' : `${filteredIcons.length} results`}
              </p>
              <div className="grid grid-cols-8 gap-1 max-h-[200px] overflow-y-auto">
                {filteredIcons.map((name) => {
                  const IconComp = LucideIcons[
                    name as keyof typeof LucideIcons
                  ] as React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
                  if (!IconComp) return null;
                  const isSelected = icon === name;
                  return (
                    <button
                      key={name}
                      className={cn(
                        'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
                        isSelected ? 'bg-accent ring-1 ring-foreground/20' : 'hover:bg-accent/60',
                      )}
                      onClick={() => {
                        onChange(name, iconColor ?? '#3b82f6');
                        setOpen(false);
                      }}
                      title={name}
                    >
                      <IconComp
                        className="h-4 w-4"
                        style={iconColor ? { color: iconColor } : undefined}
                      />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
