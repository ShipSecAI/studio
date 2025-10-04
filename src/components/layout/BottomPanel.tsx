import { useState } from 'react'
import { ChevronUp, ChevronDown, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

const mockLogs: LogEntry[] = [
  {
    id: '1',
    timestamp: '2025-01-04T10:30:00Z',
    level: 'info',
    message: 'Workflow execution started',
  },
  {
    id: '2',
    timestamp: '2025-01-04T10:30:01Z',
    level: 'info',
    message: 'Running subdomain scanner on target.com',
  },
  {
    id: '3',
    timestamp: '2025-01-04T10:30:05Z',
    level: 'warn',
    message: 'Rate limit approaching for API calls',
  },
  {
    id: '4',
    timestamp: '2025-01-04T10:30:10Z',
    level: 'error',
    message: 'Failed to connect to port scanner service',
  },
]

export function BottomPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'results' | 'history'>('logs')

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'info':
        return 'text-blue-500'
      case 'warn':
        return 'text-yellow-500'
      case 'error':
        return 'text-red-500'
      default:
        return 'text-gray-500'
    }
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

        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
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

      {isExpanded && (
        <div className="h-[260px] overflow-y-auto p-4">
          {activeTab === 'logs' && (
            <div className="space-y-2 font-mono text-sm">
              {mockLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3">
                  <span className="text-muted-foreground text-xs">
                    {formatTime(log.timestamp)}
                  </span>
                  <Badge
                    variant={log.level === 'error' ? 'destructive' : 'secondary'}
                    className="text-xs px-1 py-0"
                  >
                    {log.level.toUpperCase()}
                  </Badge>
                  <span className={getLevelColor(log.level)}>{log.message}</span>
                </div>
              ))}
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