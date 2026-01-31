import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useThemeStore } from '@/store/themeStore';
import { useComponentStore } from '@/store/componentStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { usePlacementStore } from '@/components/layout/sidebar-state';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import {
  Workflow,
  KeyRound,
  Shield,
  CalendarClock,
  Archive,
  Plug,
  Plus,
  Sun,
  Moon,
  Search,
  ArrowRight,
  Hash,
  CornerDownLeft,
  Box,
  Puzzle,
} from 'lucide-react';
import { env } from '@/config/env';
import type { WorkflowMetadataNormalized } from '@/schemas/workflow';
import { WorkflowMetadataSchema } from '@/schemas/workflow';
import type { ComponentMetadata } from '@/schemas/component';

// Command types
type CommandCategory = 'navigation' | 'workflows' | 'actions' | 'settings' | 'components';

interface BaseCommand {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon?: React.ComponentType<{ className?: string }>;
  iconUrl?: string; // For component logos
  keywords?: string[];
}

interface NavigationCommand extends BaseCommand {
  type: 'navigation';
  href: string;
}

interface ActionCommand extends BaseCommand {
  type: 'action';
  action: () => void;
}

interface WorkflowCommand extends BaseCommand {
  type: 'workflow';
  workflowId: string;
}

interface ComponentCommand extends BaseCommand {
  type: 'component';
  componentId: string;
  componentName: string;
}

type Command = NavigationCommand | ActionCommand | WorkflowCommand | ComponentCommand;

// Category labels and order
const categoryLabels: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  workflows: 'Workflows',
  actions: 'Quick Actions',
  settings: 'Settings',
  components: 'Add Component',
};

const categoryOrder: CommandCategory[] = [
  'actions',
  'components',
  'navigation',
  'workflows',
  'settings',
];

export function CommandPalette() {
  const { isOpen, close } = useCommandPaletteStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, startTransition } = useThemeStore();
  const { fetchComponents, loading: componentsLoading } = useComponentStore();
  // Subscribe to components from store to trigger re-renders when they load
  const storeComponents = useComponentStore((state) => state.components);
  const mode = useWorkflowUiStore((state) => state.mode);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [workflows, setWorkflows] = useState<WorkflowMetadataNormalized[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [componentsFetched, setComponentsFetched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Check if we're on a workflow builder page
  const isOnWorkflowPage =
    location.pathname.startsWith('/workflows/') && location.pathname !== '/workflows/new';
  const isOnNewWorkflowPage = location.pathname === '/workflows/new';
  const canPlaceComponents = (isOnWorkflowPage || isOnNewWorkflowPage) && mode === 'design';

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a short delay for animation
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Load workflows when palette opens
  useEffect(() => {
    if (isOpen && workflows.length === 0) {
      setIsLoadingWorkflows(true);
      api.workflows
        .list()
        .then((data) => {
          const normalized = data.map((w) => WorkflowMetadataSchema.parse(w));
          setWorkflows(normalized);
        })
        .catch(() => {
          // Silent fail - workflows just won't appear in search
        })
        .finally(() => {
          setIsLoadingWorkflows(false);
        });
    }
  }, [isOpen, workflows.length]);

  // Fetch components when palette opens (if not already fetched)
  useEffect(() => {
    if (isOpen && !componentsFetched && Object.keys(storeComponents).length === 0) {
      setComponentsFetched(true);
      fetchComponents().catch(() => {
        // Silent fail
      });
    }
  }, [isOpen, componentsFetched, storeComponents, fetchComponents]);

  // Get all components (filtered same as Sidebar)
  // Depend on storeComponents to re-render when they're loaded
  const allComponents = useMemo(() => {
    const components = Object.values(storeComponents);
    return components.filter((component) => {
      // Filter out entry point
      if (component.id === 'core.workflow.entrypoint' || component.slug === 'entry-point') {
        return false;
      }
      // Filter out IT ops if disabled
      if (!env.VITE_ENABLE_IT_OPS && component.category === 'it_ops') {
        return false;
      }
      // Filter out demo components
      const name = component.name.toLowerCase();
      const slug = component.slug.toLowerCase();
      const category = component.category.toLowerCase();
      const id = component.id.toLowerCase();
      if (
        category === 'demo' ||
        name.includes('demo') ||
        slug.includes('demo') ||
        name.includes('(test)') ||
        name === 'live event' ||
        name === 'parallel sleep' ||
        slug === 'live-event' ||
        slug === 'parallel-sleep' ||
        id.startsWith('test.') ||
        id === 'docker-echo'
      ) {
        return false;
      }
      return true;
    });
  }, [storeComponents]);

  // Handle component placement
  const setPlacement = usePlacementStore((state) => state.setPlacement);
  const currentWorkflowId = useWorkflowStore((state) => state.metadata.id);

  const handleComponentSelect = useCallback(
    (component: ComponentMetadata) => {
      // If not on workflow page, navigate to new workflow first
      if (!isOnWorkflowPage && !isOnNewWorkflowPage) {
        // Navigate to new workflow - user will need to add component after
        navigate('/workflows/new');
        close();
        return;
      }

      // Set up placement state scoped to the current workflow
      // The canvas will detect this and place the component when clicked
      setPlacement(component.id, component.name, currentWorkflowId);

      // Close the command palette
      close();
    },
    [isOnWorkflowPage, isOnNewWorkflowPage, navigate, close, setPlacement, currentWorkflowId],
  );

  // Build static commands
  const staticCommands = useMemo<Command[]>(() => {
    const commands: Command[] = [
      // Quick Actions
      {
        id: 'new-workflow',
        type: 'action',
        label: 'Create New Workflow',
        description: 'Start building a new automation workflow',
        category: 'actions',
        icon: Plus,
        keywords: ['new', 'create', 'add', 'workflow'],
        action: () => {
          navigate('/workflows/new');
          close();
        },
      },
      {
        id: 'toggle-theme',
        type: 'action',
        label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        description: 'Toggle between light and dark themes',
        category: 'settings',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
        action: () => {
          startTransition();
          close();
        },
      },
      // Navigation
      {
        id: 'nav-workflows',
        type: 'navigation',
        label: 'Workflows',
        description: 'View and manage your workflows',
        category: 'navigation',
        icon: Workflow,
        keywords: ['workflows', 'list', 'home'],
        href: '/',
      },
      {
        id: 'nav-schedules',
        type: 'navigation',
        label: 'Schedules',
        description: 'Manage workflow schedules',
        category: 'navigation',
        icon: CalendarClock,
        keywords: ['schedules', 'cron', 'timer', 'recurring'],
        href: '/schedules',
      },
      {
        id: 'nav-secrets',
        type: 'navigation',
        label: 'Secrets',
        description: 'Manage API keys and credentials',
        category: 'navigation',
        icon: KeyRound,
        keywords: ['secrets', 'credentials', 'passwords', 'tokens'],
        href: '/secrets',
      },
      {
        id: 'nav-api-keys',
        type: 'navigation',
        label: 'API Keys',
        description: 'Manage your API keys',
        category: 'navigation',
        icon: Shield,
        keywords: ['api', 'keys', 'authentication'],
        href: '/api-keys',
      },
      {
        id: 'nav-artifacts',
        type: 'navigation',
        label: 'Artifact Library',
        description: 'Browse stored artifacts',
        category: 'navigation',
        icon: Archive,
        keywords: ['artifacts', 'files', 'storage', 'library'],
        href: '/artifacts',
      },
    ];

    // Add connections navigation if enabled
    if (env.VITE_ENABLE_CONNECTIONS) {
      commands.push({
        id: 'nav-connections',
        type: 'navigation',
        label: 'Connections',
        description: 'Manage third-party integrations',
        category: 'navigation',
        icon: Plug,
        keywords: ['connections', 'integrations', 'oauth'],
        href: '/integrations',
      });
    }

    return commands;
  }, [theme, navigate, close, startTransition]);

  // Build workflow commands
  const workflowCommands = useMemo<Command[]>(() => {
    return workflows.map((workflow) => ({
      id: `workflow-${workflow.id}`,
      type: 'workflow' as const,
      label: workflow.name,
      description: `Open workflow · ${workflow.nodes.length} nodes`,
      category: 'workflows' as const,
      icon: Workflow,
      workflowId: workflow.id,
      keywords: [workflow.name.toLowerCase(), 'workflow', 'open'],
    }));
  }, [workflows]);

  // Build component commands
  const componentCommands = useMemo<Command[]>(() => {
    return allComponents.map((component) => {
      // Get icon component if available
      const iconName = component.icon && component.icon in LucideIcons ? component.icon : null;
      const IconComponent = iconName
        ? (LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{
            className?: string;
          }>)
        : Box;

      return {
        id: `component-${component.id}`,
        type: 'component' as const,
        label: component.name,
        description: component.description || `Add ${component.name} to canvas`,
        category: 'components' as const,
        icon: IconComponent,
        iconUrl: component.logo || undefined,
        componentId: component.id,
        componentName: component.name,
        keywords: [
          component.name.toLowerCase(),
          component.slug.toLowerCase(),
          component.category.toLowerCase(),
          'component',
          'add',
          'node',
          ...(component.description?.toLowerCase().split(' ') || []),
        ],
      };
    });
  }, [allComponents]);

  // Combine all commands
  const allCommands = useMemo<Command[]>(() => {
    return [...staticCommands, ...workflowCommands, ...componentCommands];
  }, [staticCommands, workflowCommands, componentCommands]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Show all static commands and limited workflows/components when no query
      return [
        ...staticCommands,
        ...(canPlaceComponents ? componentCommands.slice(0, 5) : []), // Show first 5 components if on workflow page
        ...workflowCommands.slice(0, 5), // Show first 5 workflows
      ];
    }

    const searchTerms = query.toLowerCase().split(' ').filter(Boolean);

    return allCommands.filter((cmd) => {
      const searchableText = [cmd.label, cmd.description || '', ...(cmd.keywords || [])]
        .join(' ')
        .toLowerCase();

      return searchTerms.every((term) => searchableText.includes(term));
    });
  }, [query, allCommands, staticCommands, workflowCommands, componentCommands, canPlaceComponents]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups: Record<CommandCategory, Command[]> = {
      navigation: [],
      workflows: [],
      actions: [],
      settings: [],
      components: [],
    };

    filteredCommands.forEach((cmd) => {
      groups[cmd.category].push(cmd);
    });

    // Return sorted by category order, filtering empty categories
    return categoryOrder
      .filter((cat) => groups[cat].length > 0)
      .map((cat) => ({
        category: cat,
        label: categoryLabels[cat],
        commands: groups[cat],
      }));
  }, [filteredCommands]);

  // Flat list for keyboard navigation
  const flatCommandList = useMemo(() => {
    return groupedCommands.flatMap((group) => group.commands);
  }, [groupedCommands]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatCommandList.length) {
      setSelectedIndex(Math.max(0, flatCommandList.length - 1));
    }
  }, [flatCommandList.length, selectedIndex]);

  // Execute command
  const executeCommand = useCallback(
    (command: Command) => {
      switch (command.type) {
        case 'navigation':
          navigate(command.href);
          close();
          break;
        case 'action':
          command.action();
          break;
        case 'workflow':
          navigate(`/workflows/${command.workflowId}`);
          close();
          break;
        case 'component': {
          const component = allComponents.find((c) => c.id === command.componentId);
          if (component) {
            handleComponentSelect(component);
          }
          break;
        }
      }
    },
    [navigate, close, allComponents, handleComponentSelect],
  );

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatCommandList.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatCommandList[selectedIndex]) {
            executeCommand(flatCommandList[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    },
    [flatCommandList, selectedIndex, executeCommand, close],
  );

  // Scroll selected item into view
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;

    const selectedEl = listEl.querySelector('[data-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on location change
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl"
        // Hide close button for cleaner look
        onPointerDownOutside={(e) => {
          e.preventDefault();
          close();
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              canPlaceComponents
                ? 'Search commands, components, workflows...'
                : 'Search commands, workflows, settings...'
            }
            className="flex-1 bg-transparent border-none outline-none text-base placeholder:text-muted-foreground/60"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border/50 bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto overflow-x-hidden">
          {(isLoadingWorkflows || componentsLoading) && query && (
            <div className="px-4 py-3 text-sm text-muted-foreground">Loading...</div>
          )}

          {!isLoadingWorkflows && !componentsLoading && flatCommandList.length === 0 && (
            <div className="px-4 py-8 text-center">
              <Hash className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
            </div>
          )}

          {groupedCommands.map((group, groupIndex) => {
            // Calculate starting index for this group
            let startIndex = 0;
            for (let i = 0; i < groupIndex; i++) {
              startIndex += groupedCommands[i].commands.length;
            }

            return (
              <div key={group.category} className="py-2">
                <div className="px-4 py-1.5 flex items-center gap-2">
                  {group.category === 'components' && (
                    <Puzzle className="w-3 h-3 text-muted-foreground/70" />
                  )}
                  <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                    {group.label}
                  </span>
                  {group.category === 'components' && !canPlaceComponents && (
                    <span className="text-xs text-muted-foreground/50 normal-case tracking-normal">
                      (open a workflow first)
                    </span>
                  )}
                </div>
                {group.commands.map((command, cmdIndex) => {
                  const flatIndex = startIndex + cmdIndex;
                  const isSelected = flatIndex === selectedIndex;
                  const Icon = command.icon;
                  const isComponent = command.type === 'component';
                  const hasLogo = isComponent && 'iconUrl' in command && command.iconUrl;

                  return (
                    <button
                      key={command.id}
                      data-selected={isSelected}
                      onClick={() => executeCommand(command)}
                      onMouseEnter={() => setSelectedIndex(flatIndex)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-75',
                        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                        isComponent && !canPlaceComponents && 'opacity-50',
                      )}
                      disabled={isComponent && !canPlaceComponents}
                    >
                      {/* Icon or Logo */}
                      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                        {hasLogo ? (
                          <img
                            src={(command as ComponentCommand & { iconUrl: string }).iconUrl}
                            alt=""
                            className="w-5 h-5 object-contain"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : Icon ? (
                          <Icon
                            className={cn(
                              'w-4 h-4',
                              isSelected ? 'text-accent-foreground' : 'text-muted-foreground',
                            )}
                          />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{command.label}</div>
                        {command.description && (
                          <div
                            className={cn(
                              'text-xs truncate',
                              isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground',
                            )}
                          >
                            {command.description}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <ArrowRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border/50 bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↑
              </kbd>
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↓
              </kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
                <CornerDownLeft className="w-3 h-3" />
              </kbd>
              <span>Select</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
              ESC
            </kbd>
            <span>Close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
