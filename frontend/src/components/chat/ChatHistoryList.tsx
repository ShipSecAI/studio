import { useEffect, useState } from 'react';
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

function formatRelativeUpdatedAt(value: string): string {
  const updatedAtMs = new Date(value).getTime();
  if (Number.isNaN(updatedAtMs)) return 'just now';

  const diffMs = Date.now() - updatedAtMs;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

function formatAbsoluteUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingDeleteId && !displaySessions.some((session) => session.id === pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [displaySessions, pendingDeleteId]);

  return (
    <div className="space-y-0.5">
      {displaySessions.map((session) => {
        const timestamp = session.updatedAt || session.createdAt;
        const updatedAtRelative = formatRelativeUpdatedAt(timestamp);
        const updatedAtAbsolute = formatAbsoluteUpdatedAt(timestamp);
        const isActive = session.id === currentSessionId;
        const isDeletePending = pendingDeleteId === session.id;

        return (
          <div key={session.id} className="group relative">
            <button
              type="button"
              onClick={() => {
                if (isDeletePending) return;
                setPendingDeleteId(null);
                onSelectSession(session.id);
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                isDeletePending ? 'pr-20' : 'pr-3',
                variant === 'default' &&
                  (isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'),
                variant === 'compact' &&
                  (isActive
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
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <span className="block truncate flex-1">{session.title}</span>
                <span
                  className={cn(
                    'shrink-0 text-[10px] transition-transform duration-200 group-hover:-translate-x-5 ml-5',
                    variant === 'default' &&
                      (isActive
                        ? 'text-accent-foreground/70'
                        : 'text-muted-foreground/75 group-hover:text-foreground/70'),
                    variant === 'compact' &&
                      (isActive ? 'text-white/70' : 'text-[#8a8a8a] group-hover:text-[#b3b3b3]'),
                  )}
                  title={updatedAtAbsolute || timestamp}
                >
                  {updatedAtRelative}
                </span>
              </div>
            </button>

            {!isDeletePending ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPendingDeleteId(session.id);
                }}
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto p-1 rounded-md transition-all duration-200',
                  variant === 'default'
                    ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                    : 'text-[#888] hover:text-red-400 hover:bg-red-500/20',
                )}
                aria-label={`Delete chat ${session.title}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : (
              <div
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 rounded-full border bg-background/95 border-border/80 px-1 py-0.5 shadow-sm text-[10px]',
                )}
              >
                <span className="px-1 font-medium text-muted-foreground">Delete?</span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDeleteId(null);
                    onDeleteSession(session.id);
                  }}
                  className={cn(
                    'h-5 rounded-full px-1.5 font-medium bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90',
                  )}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDeleteId(null);
                  }}
                  className={cn(
                    'h-5 rounded-full px-1.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted',
                  )}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
