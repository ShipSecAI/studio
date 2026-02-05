import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Workflow,
  Play,
  History,
  Settings,
  HelpCircle,
  Plus,
  Trash2,
  Search,
  Code,
  Bug,
  BookOpen,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chatStore';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'chat' | 'workflow' | 'navigation' | 'actions';
  action: () => void;
  keywords?: string[];
}

interface ChatCommandPaletteProps {
  onSelectPrompt?: (prompt: string) => void;
}

export function ChatCommandPalette({ onSelectPrompt }: ChatCommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    createSession,
    clearSession,
    currentSessionId,
  } = useChatStore();

  // Define all commands
  const commands: CommandItem[] = useMemo(() => {
    const baseCommands: CommandItem[] = [
      // Chat commands
      {
        id: 'new-chat',
        label: 'New Conversation',
        description: 'Start a new conversation',
        icon: Plus,
        category: 'chat',
        action: () => {
          createSession();
          setCommandPaletteOpen(false);
        },
        keywords: ['create', 'start', 'conversation'],
      },
      {
        id: 'clear-chat',
        label: 'Clear Chat',
        description: 'Clear current conversation',
        icon: Trash2,
        category: 'chat',
        action: () => {
          if (currentSessionId) {
            clearSession(currentSessionId);
          }
          setCommandPaletteOpen(false);
        },
        keywords: ['delete', 'remove', 'reset'],
      },

      // Workflow commands
      {
        id: 'create-workflow',
        label: 'Create Workflow',
        description: 'Build a new automation workflow',
        icon: Workflow,
        category: 'workflow',
        action: () => {
          navigate('/workflows/new');
          setCommandPaletteOpen(false);
        },
        keywords: ['automation', 'build', 'new'],
      },
      {
        id: 'run-workflow',
        label: 'Run Workflow',
        description: 'Execute an existing workflow',
        icon: Play,
        category: 'workflow',
        action: () => {
          navigate('/workflows');
          setCommandPaletteOpen(false);
        },
        keywords: ['execute', 'start', 'trigger'],
      },
      {
        id: 'view-history',
        label: 'Run History',
        description: 'View recent workflow executions',
        icon: History,
        category: 'workflow',
        action: () => {
          navigate('/runs');
          setCommandPaletteOpen(false);
        },
        keywords: ['logs', 'executions', 'past'],
      },

      // Navigation commands
      {
        id: 'go-workflows',
        label: 'Go to Workflows',
        description: 'View all workflows',
        icon: Workflow,
        category: 'navigation',
        action: () => {
          navigate('/workflows');
          setCommandPaletteOpen(false);
        },
        keywords: ['navigate', 'open'],
      },
      {
        id: 'go-components',
        label: 'Go to Components',
        description: 'Browse available components',
        icon: Code,
        category: 'navigation',
        action: () => {
          navigate('/components');
          setCommandPaletteOpen(false);
        },
        keywords: ['navigate', 'open', 'nodes'],
      },
      {
        id: 'go-settings',
        label: 'Settings',
        description: 'Open application settings',
        icon: Settings,
        category: 'navigation',
        action: () => {
          navigate('/settings');
          setCommandPaletteOpen(false);
        },
        keywords: ['preferences', 'config', 'configure'],
      },

      // Action commands (prompts)
      {
        id: 'prompt-analyze',
        label: 'Analyze Code',
        description: 'Get code analysis and suggestions',
        icon: Code,
        category: 'actions',
        action: () => {
          onSelectPrompt?.('Analyze this code and suggest improvements:');
          setCommandPaletteOpen(false);
        },
        keywords: ['review', 'code', 'suggestions'],
      },
      {
        id: 'prompt-debug',
        label: 'Debug Issue',
        description: 'Get help debugging a problem',
        icon: Bug,
        category: 'actions',
        action: () => {
          onSelectPrompt?.('Help me debug this issue:');
          setCommandPaletteOpen(false);
        },
        keywords: ['fix', 'error', 'problem'],
      },
      {
        id: 'prompt-explain',
        label: 'Explain Concept',
        description: 'Learn about a concept or feature',
        icon: BookOpen,
        category: 'actions',
        action: () => {
          onSelectPrompt?.('Explain to me how');
          setCommandPaletteOpen(false);
        },
        keywords: ['learn', 'understand', 'teach'],
      },
      {
        id: 'help',
        label: 'Help & Documentation',
        description: 'Get help and view docs',
        icon: HelpCircle,
        category: 'navigation',
        action: () => {
          navigate('/docs');
          setCommandPaletteOpen(false);
        },
        keywords: ['docs', 'documentation', 'support'],
      },
    ];

    return baseCommands;
  }, [
    navigate,
    createSession,
    clearSession,
    currentSessionId,
    setCommandPaletteOpen,
    onSelectPrompt,
  ]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;

    const lowerQuery = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lowerQuery) ||
        cmd.description?.toLowerCase().includes(lowerQuery) ||
        cmd.keywords?.some((k) => k.toLowerCase().includes(lowerQuery)),
    );
  }, [commands, query]);

  // Group filtered commands by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  const categoryLabels: Record<string, string> = {
    chat: 'Chat',
    workflow: 'Workflows',
    navigation: 'Navigation',
    actions: 'Quick Actions',
  };

  const categoryOrder = ['chat', 'workflow', 'actions', 'navigation'];

  // Flatten for keyboard navigation
  const flatCommands = useMemo(() => {
    return categoryOrder
      .filter((cat) => groupedCommands[cat])
      .flatMap((cat) => groupedCommands[cat]);
  }, [groupedCommands]);

  // Keyboard navigation
  useEffect(() => {
    if (selectedIndex >= flatCommands.length) {
      setSelectedIndex(Math.max(0, flatCommands.length - 1));
    }
  }, [flatCommands.length, selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatCommands.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatCommands[selectedIndex]) {
            flatCommands[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          setCommandPaletteOpen(false);
          break;
      }
    },
    [flatCommands, selectedIndex, setCommandPaletteOpen],
  );

  // Reset state when opened
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  // Global keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
      if (
        e.key === '/' &&
        !isCommandPaletteOpen &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent
        className="max-w-[560px] p-0 gap-0 bg-background border-border rounded-2xl shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 outline-none"
          />
          <kbd className="px-2 py-1 text-[10px] font-mono text-muted-foreground bg-muted rounded border border-border">
            ESC
          </kbd>
        </div>

        {/* Commands List */}
        <div
          ref={listRef}
          className="max-h-[400px] overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-border"
        >
          {flatCommands.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Search className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No commands found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Try a different search term</p>
            </div>
          ) : (
            categoryOrder
              .filter((cat) => groupedCommands[cat])
              .map((category) => (
                <div key={category} className="mb-2">
                  <div className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {categoryLabels[category]}
                  </div>
                  {groupedCommands[category].map((cmd) => {
                    const Icon = cmd.icon;
                    const isSelected = flatCommands[selectedIndex]?.id === cmd.id;

                    return (
                      <button
                        key={cmd.id}
                        onClick={cmd.action}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150',
                          isSelected
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <div
                          className={cn(
                            'p-1.5 rounded-lg transition-colors',
                            isSelected ? 'bg-primary/20' : 'bg-muted',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{cmd.label}</div>
                          {cmd.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {cmd.description}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">↓</kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">↵</kbd>
              <span>Select</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">⌘</kbd>
            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border">K</kbd>
            <span>Toggle</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
