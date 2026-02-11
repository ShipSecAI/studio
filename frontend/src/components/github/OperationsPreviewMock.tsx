import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, CalendarClock, Clock3, PauseCircle, PlayCircle } from 'lucide-react';

interface MockLiveScan {
  id: string;
  repository: string;
  source: string;
  workflow: string;
  status: 'running' | 'queued';
  progress: number;
  startedAt: string;
}

interface MockScheduledScan {
  id: string;
  name: string;
  repository: string;
  branch: string;
  cadence: string;
  nextRun: string;
  lastResult: 'success' | 'failure' | 'none';
}

const MOCK_LIVE_SCANS: MockLiveScan[] = [
  {
    id: 'live-1',
    repository: 'LuD1161/dvwa',
    source: 'PR #87',
    workflow: 'Unified AI Security Review',
    status: 'running',
    progress: 68,
    startedAt: 'Started 2m ago',
  },
  {
    id: 'live-2',
    repository: 'ShipSecAI/code-review-test-repo',
    source: 'Manual',
    workflow: 'Security Scan with PR Comments',
    status: 'queued',
    progress: 12,
    startedAt: 'Queued 30s ago',
  },
  {
    id: 'live-3',
    repository: 'LuD1161/git-test-repo',
    source: 'Push main',
    workflow: 'PR Security Check Run',
    status: 'running',
    progress: 44,
    startedAt: 'Started 5m ago',
  },
];

const MOCK_SCHEDULED_SCANS: MockScheduledScan[] = [
  {
    id: 'sched-1',
    name: 'Nightly Dependency Audit',
    repository: 'LuD1161/dvwa',
    branch: 'main',
    cadence: 'Daily at 02:00 UTC',
    nextRun: 'Tonight, 02:00 UTC',
    lastResult: 'success',
  },
  {
    id: 'sched-2',
    name: 'Weekly Full Security Sweep',
    repository: 'ShipSecAI/code-review-test-repo',
    branch: 'main',
    cadence: 'Every Monday, 06:00 UTC',
    nextRun: 'Mon, Feb 16 at 06:00 UTC',
    lastResult: 'failure',
  },
  {
    id: 'sched-3',
    name: 'Hourly Secret Detection',
    repository: 'LuD1161/git-test-repo',
    branch: 'main',
    cadence: 'Every hour',
    nextRun: 'In 24 minutes',
    lastResult: 'none',
  },
];

function ResultBadge({ result }: { result: MockScheduledScan['lastResult'] }) {
  if (result === 'success') {
    return (
      <Badge variant="secondary" className="text-emerald-700 border-emerald-200 bg-emerald-50">
        Success
      </Badge>
    );
  }
  if (result === 'failure') {
    return <Badge variant="destructive">Failure</Badge>;
  }
  return <Badge variant="outline">No runs yet</Badge>;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

export function OperationsPreviewMock() {
  const runningCount = MOCK_LIVE_SCANS.filter((scan) => scan.status === 'running').length;
  const queuedCount = MOCK_LIVE_SCANS.filter((scan) => scan.status === 'queued').length;

  return (
    <div className="space-y-4">
      <Card className="border-primary/25 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Operations Preview (Mock Data)
          </CardTitle>
          <CardDescription>
            UX-only mock: demonstrates how users can monitor live and scheduled scans in one place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Running now</p>
              <p className="text-lg font-semibold mt-1">{runningCount}</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Queued</p>
              <p className="text-lg font-semibold mt-1">{queuedCount}</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Scheduled active</p>
              <p className="text-lg font-semibold mt-1">{MOCK_SCHEDULED_SCANS.length}</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Need attention</p>
              <p className="text-lg font-semibold mt-1">0</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PlayCircle className="h-4 w-4" />
            Live Scans
          </CardTitle>
          <CardDescription>
            Current executions across manual, push, and PR triggers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {MOCK_LIVE_SCANS.map((scan) => (
            <div key={scan.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{scan.repository}</p>
                <Badge variant={scan.status === 'running' ? 'default' : 'outline'}>
                  {scan.status === 'running' ? 'Running' : 'Queued'}
                </Badge>
                <span className="text-xs text-muted-foreground">{scan.source}</span>
                <span className="text-xs text-muted-foreground">{scan.startedAt}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{scan.workflow}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar value={scan.progress} />
                </div>
                <span className="text-xs text-muted-foreground w-10 text-right">
                  {scan.progress}%
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline">
                  View Live Run
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground">
                  <PauseCircle className="h-3.5 w-3.5 mr-1" />
                  Stop
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Scheduled Scans
          </CardTitle>
          <CardDescription>
            Recurring scans with next-run visibility and one-click run now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {MOCK_SCHEDULED_SCANS.map((schedule) => (
            <div key={schedule.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{schedule.name}</p>
                <ResultBadge result={schedule.lastResult} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {schedule.repository} • {schedule.branch}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5" />
                  {schedule.cadence}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Next: {schedule.nextRun}
                </span>
              </div>
              <div className="mt-3">
                <Button size="sm" variant="outline">
                  Run now
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
