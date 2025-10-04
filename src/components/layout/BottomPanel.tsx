import { useState, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useExecutionStore } from '@/store/executionStore'

export function BottomPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'results' | 'history'>('logs')
  const { logs, status } = useExecutionStore()
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isExpanded && activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, isExpanded, activeTab])

  // Auto-expand when execution starts
  useEffect(() => {
    if (status === 'running' && !isExpanded) {
      setIsExpanded(true)
    }
  }, [status, isExpanded])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'info':
        return 'text-blue-500'
      case 'warn':
        return 'text-yellow-500'
      case 'error':
        return 'text-red-500'
      case 'debug':
        return 'text-gray-500'
      default:
        return 'text-gray-500'
    }
  }

  const getLevelBadgeVariant = (level: string) => {
    switch (level) {
      case 'error':
        return 'destructive' as const
      case 'warn':
        return 'warning' as const
      default:
        return 'secondary' as const
    }
  }

  const clearLogs = () => {
    useExecutionStore.getState().reset()
  }

  return (
    <div
      className={`border-t bg-background transition-all duration-300 ${
        isExpanded ? 'h-[300px]' : 'h-[40px]'
      }`}
    >
      <div className="h-[40px] flex items-center px-4 border-b">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('logs')}
              className={`text-sm font-medium ${
                activeTab === 'logs' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              Logs
              {logs.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({logs.length})
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`text-sm font-medium ${
                activeTab === 'results' ? 'text-foreground' : 'text-muted-foreground'
              }`}
              disabled
            >
              Results
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`text-sm font-medium ${
                activeTab === 'history' ? 'text-foreground' : 'text-muted-foreground'
              }`}
              disabled
            >
              History
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {logs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={clearLogs}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="h-[260px] overflow-y-auto p-4">
          {activeTab === 'logs' && (
            <div className="space-y-2 font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-muted-foreground text-center py-8">
                  No logs yet. Run a workflow to see execution logs.
                </div>
              ) : (
                <>
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3">
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {formatTime(log.timestamp)}
                      </span>
                      <Badge
                        variant={getLevelBadgeVariant(log.level)}
                        className="text-xs px-1.5 py-0 whitespace-nowrap"
                      >
                        {log.level.toUpperCase()}
                      </Badge>
                      {log.nodeId && (
                        <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                          [{log.nodeId}]
                        </span>
                      )}
                      <span className={getLevelColor(log.level)}>{log.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </>
              )}
            </div>
          )}

          {activeTab === 'results' && (
            <div className="text-muted-foreground">Results will appear here</div>
          )}

          {activeTab === 'history' && (
            <div className="text-muted-foreground">Execution history will appear here</div>
          )}
        </div>
      )}
    </div>
  )
}
