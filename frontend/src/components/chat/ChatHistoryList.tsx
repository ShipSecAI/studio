import { MessageSquare, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatSession } from '@/store/chatStore';

interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  maxItems?: number;
  variant?: 'default' | 'compact';
}

export function ChatHistoryList({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  maxItems,
  variant = 'default',
}: ChatHistoryListProps) {
  const displaySessions = maxItems ? sessions.slice(0, maxItems) : sessions;

  return (
    <div className="space-y-0.5">
      {displaySessions.map((session) => (
        <div key={session.id} className="flex items-center gap-1 group">
          <button
            onClick={() => onSelectSession(session.id)}
            className={cn(
              'flex-1 flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left truncate',
              variant === 'default' &&
                (session.id === currentSessionId
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'),
              variant === 'compact' &&
                (session.id === currentSessionId
                  ? 'bg-white/10 text-white'
                  : 'text-[#a3a3a3] hover:bg-white/5 hover:text-white'),
            )}
          >
            <MessageSquare
              className={cn(
                'shrink-0 opacity-70',
                variant === 'compact' ? 'h-4 w-4' : 'h-3.5 w-3.5',
              )}
            />
            <span className="truncate">{session.title}</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteSession(session.id);
            }}
            className={cn(
              'opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition-all',
              variant === 'default'
                ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                : 'text-[#888] hover:text-red-400 hover:bg-red-500/20',
            )}
            aria-label="Delete chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
