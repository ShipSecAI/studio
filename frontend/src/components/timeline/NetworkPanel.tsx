import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Globe, ChevronDown, ChevronRight, Clock, Copy, Check, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { cn } from '@/lib/utils';

// HAR Types (simplified from har-format)
interface HarHeader {
  name: string;
  value: string;
}

interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  queryString?: { name: string; value: string }[];
  postData?: {
    mimeType: string;
    text?: string;
  };
  headersSize: number;
  bodySize: number;
}

interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  content: {
    size: number;
    mimeType: string;
    text?: string;
  };
  headersSize: number;
  bodySize: number;
}

interface HarTimings {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  timings: HarTimings;
  cache: object;
}

interface HttpEventData {
  correlationId: string;
  request?: HarRequest;
  har?: HarEntry;
  error?: {
    message: string;
    name?: string;
  };
}

interface NetworkRequest {
  id: string;
  correlationId: string;
  nodeId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  startTime: string;
  duration?: number;
  request?: HarRequest;
  response?: HarResponse;
  timings?: HarTimings;
  error?: { message: string; name?: string };
}

const STATUS_COLORS: Record<string, string> = {
  '2xx': 'text-emerald-600 dark:text-emerald-400',
  '3xx': 'text-blue-600 dark:text-blue-400',
  '4xx': 'text-amber-600 dark:text-amber-400',
  '5xx': 'text-rose-600 dark:text-rose-400',
  error: 'text-rose-600 dark:text-rose-400',
};

const getStatusColor = (status?: number, hasError?: boolean): string => {
  if (hasError) return STATUS_COLORS.error;
  if (!status) return 'text-muted-foreground';
  if (status >= 200 && status < 300) return STATUS_COLORS['2xx'];
  if (status >= 300 && status < 400) return STATUS_COLORS['3xx'];
  if (status >= 400 && status < 500) return STATUS_COLORS['4xx'];
  if (status >= 500) return STATUS_COLORS['5xx'];
  return 'text-muted-foreground';
};

const formatDuration = (ms?: number): string => {
  if (ms === undefined || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatBytes = (bytes?: number): string => {
  if (bytes === undefined || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const parseUrl = (url: string): { host: string; path: string } => {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      path: parsed.pathname + parsed.search,
    };
  } catch {
    return { host: '', path: url };
  }
};

interface HeadersTableProps {
  headers: HarHeader[];
  title: string;
}

function HeadersTable({ headers, title }: HeadersTableProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (value: string, name: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    setTimeout(() => setCopied(null), 1500);
  };

  if (headers.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">No {title.toLowerCase()}</div>;
  }

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </h4>
      <div className="space-y-0.5">
        {headers.map((header, idx) => (
          <div
            key={`${header.name}-${idx}`}
            className="group flex items-start gap-2 py-1 px-2 rounded hover:bg-muted/50 text-xs font-mono"
          >
            <span className="text-muted-foreground min-w-[140px] flex-shrink-0 break-all">
              {header.name}:
            </span>
            <span className="text-foreground break-all flex-1">{header.value}</span>
            <button
              onClick={() => handleCopy(header.value, header.name)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
            >
              {copied === header.name ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TimingBarProps {
  timings: HarTimings;
  totalTime: number;
}

function TimingBar({ timings, totalTime }: TimingBarProps) {
  const segments = [
    { name: 'Blocked', value: timings.blocked, color: 'bg-slate-400' },
    { name: 'DNS', value: timings.dns, color: 'bg-cyan-500' },
    { name: 'Connect', value: timings.connect, color: 'bg-orange-500' },
    { name: 'SSL', value: timings.ssl, color: 'bg-purple-500' },
    { name: 'Send', value: timings.send, color: 'bg-blue-500' },
    { name: 'Wait', value: timings.wait, color: 'bg-emerald-500' },
    { name: 'Receive', value: timings.receive, color: 'bg-sky-500' },
  ].filter((s) => s.value > 0);

  if (segments.length === 0 || totalTime <= 0) {
    return <div className="text-xs text-muted-foreground">No timing data available</div>;
  }

  return (
    <div className="space-y-3">
      <div className="h-6 rounded-md overflow-hidden flex bg-muted">
        {segments.map((segment) => (
          <div
            key={segment.name}
            className={cn(segment.color, 'h-full relative group')}
            style={{
              width: `${(segment.value / totalTime) * 100}%`,
              minWidth: segment.value > 0 ? '2px' : 0,
            }}
            title={`${segment.name}: ${formatDuration(segment.value)}`}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 text-white text-[10px] font-medium transition-opacity">
              {segment.name}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map((segment) => (
          <div key={segment.name} className="flex items-center gap-1.5">
            <div className={cn('w-2.5 h-2.5 rounded-sm', segment.color)} />
            <span className="text-muted-foreground">{segment.name}:</span>
            <span className="font-mono">{formatDuration(segment.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RequestDetailProps {
  request: NetworkRequest;
}

function RequestDetail({ request }: RequestDetailProps) {
  const [activeTab, setActiveTab] = useState('headers');

  const requestHeaders = request.request?.headers || [];
  const responseHeaders = request.response?.headers || [];
  const requestBody = request.request?.postData?.text;
  const responseBody = request.response?.content?.text;

  return (
    <div className="h-full flex flex-col overflow-hidden border-l">
      {/* Request Summary Header */}
      <div className="p-3 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="font-mono text-xs">
            {request.method}
          </Badge>
          <span
            className={cn(
              'font-mono text-sm font-medium',
              getStatusColor(request.status, !!request.error),
            )}
          >
            {request.status || (request.error ? 'ERR' : 'Pending')}
          </span>
          {request.statusText && (
            <span className="text-xs text-muted-foreground">{request.statusText}</span>
          )}
        </div>
        <div className="font-mono text-xs text-muted-foreground break-all">{request.url}</div>
        {request.error && (
          <div className="mt-2 flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{request.error.message}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-9 flex-shrink-0">
          <TabsTrigger value="headers" className="text-xs">
            Headers
          </TabsTrigger>
          <TabsTrigger value="payload" className="text-xs">
            Payload
          </TabsTrigger>
          <TabsTrigger value="response" className="text-xs">
            Response
          </TabsTrigger>
          <TabsTrigger value="timing" className="text-xs">
            Timing
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto min-h-0">
          <TabsContent value="headers" className="m-0 p-3 space-y-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Node:</span>
                  <span className="ml-2 font-mono">{request.nodeId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="ml-2 font-mono">{formatDuration(request.duration)}</span>
                </div>
              </div>
              <HeadersTable headers={requestHeaders} title="Request Headers" />
              <HeadersTable headers={responseHeaders} title="Response Headers" />
            </div>
          </TabsContent>

          <TabsContent value="payload" className="m-0 p-3">
            {requestBody ? (
              <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 whitespace-pre-wrap break-all">
                {tryFormatJson(requestBody)}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">No request body</div>
            )}
          </TabsContent>

          <TabsContent value="response" className="m-0 p-3">
            {request.response?.content && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <span className="ml-2 font-mono">
                      {formatBytes(request.response.content.size)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type:</span>
                    <span className="ml-2 font-mono">{request.response.content.mimeType}</span>
                  </div>
                </div>
              </div>
            )}
            {responseBody ? (
              <pre className="text-xs font-mono bg-muted/30 rounded-md p-3 whitespace-pre-wrap break-all">
                {tryFormatJson(responseBody)}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No response body captured
              </div>
            )}
          </TabsContent>

          <TabsContent value="timing" className="m-0 p-3">
            {request.timings ? (
              <div className="space-y-4">
                <div className="text-xs">
                  <span className="text-muted-foreground">Total Time:</span>
                  <span className="ml-2 font-mono font-medium">
                    {formatDuration(request.duration)}
                  </span>
                </div>
                <TimingBar timings={request.timings} totalTime={request.duration || 0} />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No timing data available
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function tryFormatJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

export function NetworkPanel() {
  const { events, selectedNodeId } = useExecutionTimelineStore();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());

  // Resizable pane state
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null); // null = 50%, number = pixels
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  // Build network requests from HTTP events
  const networkRequests = useMemo(() => {
    const requestMap = new Map<string, NetworkRequest>();

    // Filter to HTTP events only
    const httpEvents = events.filter(
      (e) =>
        e.type === 'HTTP_REQUEST_SENT' ||
        e.type === 'HTTP_RESPONSE_RECEIVED' ||
        e.type === 'HTTP_REQUEST_ERROR',
    );

    // Group by correlation ID
    for (const event of httpEvents) {
      const data = event.data as HttpEventData | undefined;
      if (!data?.correlationId) continue;

      const correlationId = data.correlationId;
      const existing = requestMap.get(correlationId);

      if (event.type === 'HTTP_REQUEST_SENT' && data.request) {
        requestMap.set(correlationId, {
          id: event.id,
          correlationId,
          nodeId: event.nodeId,
          method: data.request.method,
          url: data.request.url,
          startTime: event.timestamp,
          request: data.request,
          ...existing,
        });
      } else if (event.type === 'HTTP_RESPONSE_RECEIVED' && data.har) {
        const existingOrNew = existing || {
          id: event.id,
          correlationId,
          nodeId: event.nodeId,
          method: data.har.request.method,
          url: data.har.request.url,
          startTime: data.har.startedDateTime,
        };
        requestMap.set(correlationId, {
          ...existingOrNew,
          status: data.har.response.status,
          statusText: data.har.response.statusText,
          duration: data.har.time,
          request: data.har.request,
          response: data.har.response,
          timings: data.har.timings,
        });
      } else if (event.type === 'HTTP_REQUEST_ERROR' && data.error) {
        const existingOrNew = existing || {
          id: event.id,
          correlationId,
          nodeId: event.nodeId,
          method: data.request?.method || 'GET',
          url: data.request?.url || '',
          startTime: event.timestamp,
        };
        requestMap.set(correlationId, {
          ...existingOrNew,
          error: data.error,
          request: data.request,
        });
      }
    }

    return Array.from(requestMap.values()).sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [events]);

  // Filter by selected node if any
  const filteredRequests = useMemo(() => {
    if (!selectedNodeId) return networkRequests;
    return networkRequests.filter((r) => r.nodeId === selectedNodeId);
  }, [networkRequests, selectedNodeId]);

  // Group by host
  const requestsByHost = useMemo(() => {
    const groups = new Map<string, NetworkRequest[]>();
    for (const request of filteredRequests) {
      const { host } = parseUrl(request.url);
      const existing = groups.get(host) || [];
      existing.push(request);
      groups.set(host, existing);
    }
    return groups;
  }, [filteredRequests]);

  const selectedRequest = selectedRequestId
    ? filteredRequests.find((r) => r.correlationId === selectedRequestId)
    : null;

  const toggleHost = (host: string) => {
    setExpandedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) {
        next.delete(host);
      } else {
        next.add(host);
      }
      return next;
    });
  };

  // Auto-expand all hosts on first render
  useEffect(() => {
    setExpandedHosts(new Set(requestsByHost.keys()));
  }, [filteredRequests.length]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      const minWidth = 120;
      const maxWidth = containerRect.width * 0.8;
      setLeftPaneWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (filteredRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <Globe className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm font-medium">No HTTP requests recorded</p>
        <p className="text-xs mt-1">
          {selectedNodeId
            ? `No requests from node "${selectedNodeId}"`
            : 'HTTP requests made by components will appear here'}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full">
      {/* Request List */}
      <div
        className="flex flex-col min-h-0 flex-shrink-0"
        style={{
          width: selectedRequest ? (leftPaneWidth !== null ? `${leftPaneWidth}px` : '50%') : '100%',
        }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Network</span>
            <Badge variant="secondary" className="text-[10px]">
              {filteredRequests.length} request{filteredRequests.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          {selectedNodeId && (
            <Badge variant="outline" className="text-[10px]">
              Node: {selectedNodeId}
            </Badge>
          )}
        </div>

        {/* Request List */}
        <div className="flex-1 overflow-auto">
          {Array.from(requestsByHost.entries()).map(([host, requests]) => {
            const isExpanded = expandedHosts.has(host);
            return (
              <div key={host}>
                {/* Host Header */}
                <button
                  onClick={() => toggleHost(host)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs bg-muted/20 hover:bg-muted/40 border-b transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="font-medium">{host}</span>
                  <span className="text-muted-foreground">({requests.length})</span>
                </button>

                {/* Requests */}
                {isExpanded &&
                  requests.map((request) => {
                    const { path } = parseUrl(request.url);
                    const isSelected = selectedRequestId === request.correlationId;

                    return (
                      <button
                        key={request.correlationId}
                        onClick={() =>
                          setSelectedRequestId(isSelected ? null : request.correlationId)
                        }
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs border-b hover:bg-muted/50 transition-colors text-left',
                          isSelected && 'bg-primary/10 border-l-2 border-l-primary',
                        )}
                      >
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-mono text-[10px] w-14 justify-center flex-shrink-0',
                            request.method === 'GET' &&
                              'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
                            request.method === 'POST' &&
                              'border-blue-500/50 text-blue-600 dark:text-blue-400',
                            request.method === 'PUT' &&
                              'border-amber-500/50 text-amber-600 dark:text-amber-400',
                            request.method === 'DELETE' &&
                              'border-rose-500/50 text-rose-600 dark:text-rose-400',
                            request.method === 'PATCH' &&
                              'border-purple-500/50 text-purple-600 dark:text-purple-400',
                          )}
                        >
                          {request.method}
                        </Badge>
                        <span
                          className={cn(
                            'font-mono text-xs w-10 text-center flex-shrink-0',
                            getStatusColor(request.status, !!request.error),
                          )}
                        >
                          {request.status || (request.error ? 'ERR' : '...')}
                        </span>
                        <span className="font-mono text-xs truncate flex-1" title={path}>
                          {path}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(request.duration)}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Resize Handle */}
      {selectedRequest && (
        <div
          onMouseDown={handleResizeStart}
          className="w-1 bg-border hover:bg-primary/50 cursor-col-resize flex-shrink-0 transition-colors group relative"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* Request Detail */}
      {selectedRequest && (
        <div className="flex-1 min-h-0 min-w-0">
          <RequestDetail request={selectedRequest} />
        </div>
      )}
    </div>
  );
}
