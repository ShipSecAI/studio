import React, { useState, useRef, useCallback } from 'react';
import {
  Cloud,
  Shield,
  Terminal,
  AlertTriangle,
  Activity,
  CheckCircle2,
  Clock,
  Server,
  Globe,
  Blocks,
  Eye,
  Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ─── Mock Data ──────────────────────────────────────────────────────────────

const awsAccounts = [
  {
    name: 'Production',
    id: '●●●●-4821',
    region: 'us-east-1',
    resources: 142,
    status: 'healthy' as const,
  },
  {
    name: 'Staging',
    id: '●●●●-7293',
    region: 'us-west-2',
    resources: 87,
    status: 'healthy' as const,
  },
  {
    name: 'Development',
    id: '●●●●-1056',
    region: 'eu-west-1',
    resources: 56,
    status: 'warning' as const,
  },
];

const githubOrgs = [
  {
    name: 'shipsec-platform',
    repos: 18,
    lastSync: '2m ago',
    avatar: 'SP',
    topRepos: [
      { name: 'studio-github', lang: 'TypeScript', lastScan: '2m ago' },
      { name: 'api-gateway', lang: 'Go', lastScan: '5m ago' },
      { name: 'mcp-servers', lang: 'Python', lastScan: '8m ago' },
      { name: 'scanner-engine', lang: 'Rust', lastScan: '12m ago' },
    ],
  },
  {
    name: 'shipsec-internal',
    repos: 14,
    lastSync: '5m ago',
    avatar: 'SI',
    topRepos: [
      { name: 'web-app', lang: 'TypeScript', lastScan: '5m ago' },
      { name: 'backend-api', lang: 'Python', lastScan: '10m ago' },
      { name: 'infrastructure', lang: 'HCL', lastScan: '15m ago' },
    ],
  },
];

const scanners = [
  { name: 'Semgrep', type: 'SAST', status: 'active' as const, lastRun: '12m ago' },
  { name: 'Trivy', type: 'Container', status: 'active' as const, lastRun: '15m ago' },
  { name: 'TruffleHog', type: 'Secrets', status: 'active' as const, lastRun: '3m ago' },
  { name: 'Checkov', type: 'IaC', status: 'active' as const, lastRun: '22m ago' },
  { name: 'SonarQube', type: 'Quality', status: 'idle' as const, lastRun: '1h ago' },
];

const mcpTools = [
  { category: 'Security Analysis', count: 12, icon: Shield },
  { category: 'Cloud Operations', count: 8, icon: Cloud },
  { category: 'Code Intelligence', count: 10, icon: Terminal },
  { category: 'Compliance', count: 6, icon: CheckCircle2 },
  { category: 'Threat Intel', count: 6, icon: Globe },
];

const findingsSummary = {
  critical: 12,
  high: 45,
  medium: 89,
  low: 101,
};

const recentActivity = [
  { event: 'AWS Security Hub synced', time: '2m ago', type: 'sync' as const },
  { event: 'GitHub webhook: push to main', time: '4m ago', type: 'webhook' as const },
  { event: 'Semgrep scan completed', time: '12m ago', type: 'scan' as const },
  { event: 'New critical finding detected', time: '18m ago', type: 'alert' as const },
  { event: 'Snyk dependency check done', time: '24m ago', type: 'scan' as const },
];

// ─── Hover Popover Wrapper ──────────────────────────────────────────────────

function HoverPopover({
  children,
  content,
  align = 'center',
  className,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className={cn('w-72', className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

// ─── Individual Status Pill ─────────────────────────────────────────────────

function StatusPill({
  icon: Icon,
  label,
  value,
  dotColor = 'green',
  popoverContent,
  popoverAlign,
  className,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  dotColor?: 'green' | 'amber' | 'red' | 'blue';
  popoverContent: React.ReactNode;
  popoverAlign?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const dotColors = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    blue: 'bg-blue-500',
  };

  const dotGlowColors = {
    green: 'shadow-[0_0_6px_rgba(16,185,129,0.4)]',
    amber: 'shadow-[0_0_6px_rgba(245,158,11,0.4)]',
    red: 'shadow-[0_0_6px_rgba(239,68,68,0.4)]',
    blue: 'shadow-[0_0_6px_rgba(59,130,246,0.4)]',
  };

  return (
    <HoverPopover content={popoverContent} align={popoverAlign}>
      <button
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg',
          'border border-transparent',
          'text-xs font-medium text-muted-foreground',
          'hover:bg-accent hover:text-foreground hover:border-border',
          'transition-all duration-200 cursor-default',
          'select-none whitespace-nowrap',
          className,
        )}
      >
        <Icon className="w-3.5 h-3.5 opacity-70" />
        <span className="hidden sm:inline">{label}</span>
        <span className="font-semibold text-foreground">{value}</span>
        <div
          className={cn(
            'w-1.5 h-1.5 rounded-full ml-0.5',
            dotColors[dotColor],
            dotGlowColors[dotColor],
          )}
        />
      </button>
    </HoverPopover>
  );
}

// ─── GitHub Icon ────────────────────────────────────────────────────────────

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// ─── Popover Content Panels ─────────────────────────────────────────────────

function AwsPopoverContent() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">AWS Accounts</h4>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          All Healthy
        </span>
      </div>
      <div className="space-y-2">
        {awsAccounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between p-2 rounded-md bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  account.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500',
                )}
              />
              <div>
                <p className="text-xs font-medium">{account.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {account.id} &middot; {account.region}
                </p>
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{account.resources} resources</span>
          </div>
        ))}
      </div>
      <div className="pt-1 border-t">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          Security Hub last synced 2m ago
        </p>
      </div>
    </div>
  );
}

function GitHubPopoverContent() {
  const totalRepos = githubOrgs.reduce((sum, org) => sum + org.repos, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">GitHub</h4>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          {totalRepos} Repos
        </span>
      </div>
      <div className="space-y-2.5">
        {githubOrgs.map((org) => {
          const remaining = org.repos - org.topRepos.length;
          return (
            <div key={org.name} className="space-y-1">
              {/* Org header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded bg-foreground/10 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-foreground/70">{org.avatar}</span>
                  </div>
                  <span className="text-[11px] font-semibold">{org.name}</span>
                  <span className="text-[10px] text-muted-foreground">&middot; {org.repos}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{org.lastSync}</span>
              </div>
              {/* Repo list */}
              <div className="ml-6.5 space-y-0.5 pl-1 border-l-2 border-border ml-[11px]">
                {org.topRepos.map((repo) => (
                  <div key={repo.name} className="flex items-center justify-between py-0.5 px-1.5">
                    <span className="text-[10px] text-foreground/80">{repo.name}</span>
                    <span className="text-[9px] text-muted-foreground">{repo.lang}</span>
                  </div>
                ))}
                {remaining > 0 && (
                  <p className="text-[9px] text-muted-foreground px-1.5 py-0.5">
                    +{remaining} more repositories
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pt-1 border-t">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Eye className="w-2.5 h-2.5" />
          Monitoring all branches &middot; Webhooks active
        </p>
      </div>
    </div>
  );
}

function ScannersPopoverContent() {
  const activeCount = scanners.filter((s) => s.status === 'active').length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Security Scanners</h4>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          {activeCount} Active
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {scanners.map((scanner) => (
          <div
            key={scanner.name}
            className="flex items-center gap-1.5 p-1.5 rounded-md bg-muted/50"
          >
            <div
              className={cn(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                scanner.status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              )}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-medium truncate">{scanner.name}</p>
              <p className="text-[9px] text-muted-foreground">{scanner.type}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="pt-1 border-t">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          All scanners reporting &middot; Next scheduled in 8m
        </p>
      </div>
    </div>
  );
}

function McpToolsPopoverContent() {
  const total = mcpTools.reduce((sum, cat) => sum + cat.count, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">MCP Tool Servers</h4>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
          {total} Tools
        </span>
      </div>
      <div className="space-y-1.5">
        {mcpTools.map((cat) => {
          const CatIcon = cat.icon;
          return (
            <div
              key={cat.category}
              className="flex items-center justify-between p-1.5 rounded-md bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <CatIcon className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] font-medium">{cat.category}</span>
              </div>
              <span className="text-[11px] font-semibold text-foreground/80">{cat.count}</span>
            </div>
          );
        })}
      </div>
      <div className="pt-1 border-t">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Server className="w-2.5 h-2.5" />3 MCP servers connected &middot; All healthy
        </p>
      </div>
    </div>
  );
}

function FindingsPopoverContent() {
  const total =
    findingsSummary.critical + findingsSummary.high + findingsSummary.medium + findingsSummary.low;

  const severities = [
    {
      label: 'Critical',
      count: findingsSummary.critical,
      color: 'bg-red-500',
      textColor: 'text-red-600 dark:text-red-400',
      barColor: 'bg-red-500',
    },
    {
      label: 'High',
      count: findingsSummary.high,
      color: 'bg-orange-500',
      textColor: 'text-orange-600 dark:text-orange-400',
      barColor: 'bg-orange-500',
    },
    {
      label: 'Medium',
      count: findingsSummary.medium,
      color: 'bg-amber-500',
      textColor: 'text-amber-600 dark:text-amber-400',
      barColor: 'bg-amber-500',
    },
    {
      label: 'Low',
      count: findingsSummary.low,
      color: 'bg-blue-400',
      textColor: 'text-blue-600 dark:text-blue-400',
      barColor: 'bg-blue-400',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Open Findings</h4>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          {total} Total
        </span>
      </div>

      {/* Severity bar visualization */}
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {severities.map((sev) => (
          <div
            key={sev.label}
            className={cn('h-full transition-all', sev.barColor)}
            style={{ width: `${(sev.count / total) * 100}%` }}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        {severities.map((sev) => (
          <div key={sev.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-sm', sev.color)} />
              <span className="text-[11px]">{sev.label}</span>
            </div>
            <span className={cn('text-[11px] font-semibold', sev.textColor)}>{sev.count}</span>
          </div>
        ))}
      </div>

      <div className="pt-1 border-t">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" />
          {findingsSummary.critical} critical require immediate attention
        </p>
      </div>
    </div>
  );
}

function LivePopoverContent() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Live Activity</h4>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          Monitoring
        </span>
      </div>
      <div className="space-y-1.5">
        {recentActivity.map((item, i) => (
          <div key={i} className="flex items-start gap-2 p-1.5 rounded-md bg-muted/50">
            <div
              className={cn(
                'w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0',
                item.type === 'alert'
                  ? 'bg-red-500'
                  : item.type === 'scan'
                    ? 'bg-blue-500'
                    : 'bg-emerald-500',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium truncate">{item.event}</p>
              <p className="text-[9px] text-muted-foreground">{item.time}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="pt-1 border-t">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Radio className="w-2.5 h-2.5" />
          Real-time webhooks &middot; 15s polling interval
        </p>
      </div>
    </div>
  );
}

// ─── Main StatusBar Component ───────────────────────────────────────────────

interface StatusBarProps {
  className?: string;
}

export function StatusBar({ className }: StatusBarProps) {
  const totalFindings =
    findingsSummary.critical + findingsSummary.high + findingsSummary.medium + findingsSummary.low;
  const totalRepos = githubOrgs.reduce((sum, org) => sum + org.repos, 0);
  const totalMcpTools = mcpTools.reduce((sum, cat) => sum + cat.count, 0);
  const activeScanners = scanners.filter((s) => s.status === 'active').length;

  return (
    <div className={cn('flex items-center border-b bg-background/60 backdrop-blur-sm', className)}>
      <div className="flex items-center gap-0.5 px-3 py-1 overflow-x-auto scrollbar-none">
        {/* AWS */}
        <StatusPill
          icon={Cloud}
          label="AWS"
          value={`${awsAccounts.length}`}
          dotColor="green"
          popoverContent={<AwsPopoverContent />}
          popoverAlign="start"
        />

        {/* Separator */}
        <div className="w-px h-4 bg-border mx-1 hidden sm:block" />

        {/* GitHub */}
        <StatusPill
          icon={GitHubIcon}
          label="GitHub"
          value={`${totalRepos}`}
          dotColor="green"
          popoverContent={<GitHubPopoverContent />}
        />

        {/* Separator */}
        <div className="w-px h-4 bg-border mx-1 hidden sm:block" />

        {/* Scanners */}
        <StatusPill
          icon={Shield}
          label="Scanners"
          value={`${activeScanners}`}
          dotColor="green"
          popoverContent={<ScannersPopoverContent />}
        />

        {/* Separator */}
        <div className="w-px h-4 bg-border mx-1 hidden sm:block" />

        {/* MCP Tools */}
        <StatusPill
          icon={Blocks}
          label="MCP"
          value={`${totalMcpTools}`}
          dotColor="blue"
          popoverContent={<McpToolsPopoverContent />}
        />

        {/* Separator */}
        <div className="w-px h-4 bg-border mx-1 hidden sm:block" />

        {/* Findings */}
        <StatusPill
          icon={AlertTriangle}
          label="Findings"
          value={`${totalFindings}`}
          dotColor="amber"
          popoverContent={<FindingsPopoverContent />}
          className="text-amber-600 dark:text-amber-400"
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Live indicator (right side) */}
        <HoverPopover content={<LivePopoverContent />} align="end">
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-accent transition-all duration-200 cursor-default select-none">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Live</span>
            <span className="text-muted-foreground hidden sm:inline">&middot; 2m ago</span>
          </button>
        </HoverPopover>
      </div>
    </div>
  );
}
