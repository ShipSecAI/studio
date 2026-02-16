import { useState } from 'react';
import { Plus, MessageSquare, Search, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore, type ChatSession } from '@/store/chatStore';
import { UserButton } from '@/components/auth/UserButton';

interface ChatHistoryItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

const ChatHistoryItem = ({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: ChatHistoryItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);

  const handleRename = () => {
    if (editTitle.trim() && editTitle.trim() !== session.title) {
      onRename(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(session.title);
    setIsEditing(true);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 overflow-hidden',
        isActive ? 'bg-white/10 text-white' : 'text-[#a3a3a3] hover:bg-white/5 hover:text-white',
      )}
      onClick={onSelect}
    >
      <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-60" />

      {isEditing ? (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename();
            if (e.key === 'Escape') {
              setEditTitle(session.title);
              setIsEditing(false);
            }
          }}
          className="flex-1 bg-white/10 px-2 py-0.5 rounded text-sm text-white outline-none border border-white/20 min-w-0"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span
            className="flex-1 text-sm truncate min-w-0"
            onDoubleClick={handleDoubleClick}
            title="Double-click to rename"
          >
            {session.title}
          </span>
          {/* Delete button - inline in the row, appears on hover */}
          <button
            onClick={handleDelete}
            className={cn(
              'flex-shrink-0 p-1.5 rounded hover:bg-red-500/20 transition-all duration-200',
              'opacity-0 group-hover:opacity-100',
              'text-[#888] hover:text-red-400',
            )}
            title="Delete chat"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
};

interface ChatSidebarProps {
  className?: string;
}

export function ChatSidebar({ className }: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const {
    sessions,
    currentSessionId,
    isLoadingSessions,
    createSession,
    deleteSession,
    setCurrentSession,
    updateSessionTitle,
  } = useChatStore();

  const filteredSessions = sessions.filter((session) =>
    session.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Group sessions by date
  const groupedSessions = filteredSessions.reduce(
    (groups, session) => {
      const date = new Date(session.updatedAt);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      let groupKey: string;
      if (days === 0) groupKey = 'Today';
      else if (days === 1) groupKey = 'Yesterday';
      else if (days < 7) groupKey = 'Previous 7 Days';
      else if (days < 30) groupKey = 'Previous 30 Days';
      else groupKey = 'Older';

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(session);
      return groups;
    },
    {} as Record<string, ChatSession[]>,
  );

  const handleNewChat = () => {
    createSession();
  };

  return (
    <div className={cn('flex flex-col h-full bg-[#171717]', className)}>
      {/* Header with New Chat */}
      <div className="p-3 space-y-3">
        <button
          onClick={handleNewChat}
          className="flex items-center justify-between w-full px-3 py-2.5 text-sm text-white bg-gradient-to-r from-primary/20 to-transparent hover:from-primary/30 rounded-xl transition-all duration-200 group border border-white/5 hover:border-primary/30"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-primary/20 group-hover:bg-primary/30 transition-colors">
              <Plus className="h-4 w-4 text-primary" />
            </div>
            <span className="font-medium">New Conversation</span>
          </div>
          <span className="text-xs text-[#666] group-hover:text-[#888] font-mono">&#x2318;N</span>
        </button>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#666]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white/5 border border-white/5 rounded-lg text-white placeholder:text-[#666] focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {isLoadingSessions ? (
          <div className="px-3 py-8 flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-[#555]" />
            <p className="text-sm text-[#666]">Loading chats...</p>
          </div>
        ) : Object.entries(groupedSessions).length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 text-[#444]" />
            <p className="text-sm text-[#666]">No chats yet</p>
            <p className="text-xs text-[#555] mt-1">Start a new conversation</p>
          </div>
        ) : (
          Object.entries(groupedSessions).map(([group, groupSessions]) => (
            <div key={group} className="mb-3">
              <div className="px-3 py-1.5 text-[10px] font-medium text-[#555] uppercase tracking-wider">
                {group}
              </div>
              <div className="space-y-0.5">
                {groupSessions.map((session) => (
                  <ChatHistoryItem
                    key={session.id}
                    session={session}
                    isActive={session.id === currentSessionId}
                    onSelect={() => setCurrentSession(session.id)}
                    onDelete={() => deleteSession(session.id)}
                    onRename={(title) => updateSessionTitle(session.id, title)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* User Button */}
      <div className="p-3 border-t border-white/5">
        <UserButton
          className="w-full justify-start hover:bg-white/5 text-[#ececec] border-0"
          showUserInfo={true}
        />
      </div>
    </div>
  );
}
