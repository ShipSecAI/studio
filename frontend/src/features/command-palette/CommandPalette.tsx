import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useThemeStore } from '@/store/themeStore'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
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
    Command,
    CornerDownLeft,
} from 'lucide-react'
import { env } from '@/config/env'
import type { WorkflowMetadataNormalized } from '@/schemas/workflow'
import { WorkflowMetadataSchema } from '@/schemas/workflow'

// Command types
type CommandCategory = 'navigation' | 'workflows' | 'actions' | 'settings'

interface BaseCommand {
    id: string
    label: string
    description?: string
    category: CommandCategory
    icon?: React.ComponentType<{ className?: string }>
    keywords?: string[]
}

interface NavigationCommand extends BaseCommand {
    type: 'navigation'
    href: string
}

interface ActionCommand extends BaseCommand {
    type: 'action'
    action: () => void
}

interface WorkflowCommand extends BaseCommand {
    type: 'workflow'
    workflowId: string
}

type Command = NavigationCommand | ActionCommand | WorkflowCommand

// Category labels and order
const categoryLabels: Record<CommandCategory, string> = {
    navigation: 'Navigation',
    workflows: 'Workflows',
    actions: 'Quick Actions',
    settings: 'Settings',
}

const categoryOrder: CommandCategory[] = ['actions', 'navigation', 'workflows', 'settings']

export function CommandPalette() {
    const { isOpen, close } = useCommandPaletteStore()
    const navigate = useNavigate()
    const location = useLocation()
    const { theme, startTransition } = useThemeStore()
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [workflows, setWorkflows] = useState<WorkflowMetadataNormalized[]>([])
    const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setQuery('')
            setSelectedIndex(0)
            // Focus input after a short delay for animation
            setTimeout(() => {
                inputRef.current?.focus()
            }, 50)
        }
    }, [isOpen])

    // Load workflows when palette opens
    useEffect(() => {
        if (isOpen && workflows.length === 0) {
            setIsLoadingWorkflows(true)
            api.workflows
                .list()
                .then((data) => {
                    const normalized = data.map((w) => WorkflowMetadataSchema.parse(w))
                    setWorkflows(normalized)
                })
                .catch(() => {
                    // Silent fail - workflows just won't appear in search
                })
                .finally(() => {
                    setIsLoadingWorkflows(false)
                })
        }
    }, [isOpen, workflows.length])

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
                    navigate('/workflows/new')
                    close()
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
                    startTransition()
                    close()
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
        ]

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
            })
        }

        return commands
    }, [theme, navigate, close, startTransition])

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
        }))
    }, [workflows])

    // Combine all commands
    const allCommands = useMemo<Command[]>(() => {
        return [...staticCommands, ...workflowCommands]
    }, [staticCommands, workflowCommands])

    // Filter commands based on query
    const filteredCommands = useMemo(() => {
        if (!query.trim()) {
            // Show all commands when no query, limited workflows
            return [
                ...staticCommands,
                ...workflowCommands.slice(0, 5), // Show first 5 workflows
            ]
        }

        const searchTerms = query.toLowerCase().split(' ').filter(Boolean)

        return allCommands.filter((cmd) => {
            const searchableText = [
                cmd.label,
                cmd.description || '',
                ...(cmd.keywords || []),
            ]
                .join(' ')
                .toLowerCase()

            return searchTerms.every((term) => searchableText.includes(term))
        })
    }, [query, allCommands, staticCommands, workflowCommands])

    // Group commands by category
    const groupedCommands = useMemo(() => {
        const groups: Record<CommandCategory, Command[]> = {
            navigation: [],
            workflows: [],
            actions: [],
            settings: [],
        }

        filteredCommands.forEach((cmd) => {
            groups[cmd.category].push(cmd)
        })

        // Return sorted by category order, filtering empty categories
        return categoryOrder
            .filter((cat) => groups[cat].length > 0)
            .map((cat) => ({
                category: cat,
                label: categoryLabels[cat],
                commands: groups[cat],
            }))
    }, [filteredCommands])

    // Flat list for keyboard navigation
    const flatCommandList = useMemo(() => {
        return groupedCommands.flatMap((group) => group.commands)
    }, [groupedCommands])

    // Clamp selected index
    useEffect(() => {
        if (selectedIndex >= flatCommandList.length) {
            setSelectedIndex(Math.max(0, flatCommandList.length - 1))
        }
    }, [flatCommandList.length, selectedIndex])

    // Execute command
    const executeCommand = useCallback(
        (command: Command) => {
            switch (command.type) {
                case 'navigation':
                    navigate(command.href)
                    close()
                    break
                case 'action':
                    command.action()
                    break
                case 'workflow':
                    navigate(`/workflows/${command.workflowId}`)
                    close()
                    break
            }
        },
        [navigate, close]
    )

    // Keyboard handling
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    setSelectedIndex((prev) => Math.min(prev + 1, flatCommandList.length - 1))
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    setSelectedIndex((prev) => Math.max(prev - 1, 0))
                    break
                case 'Enter':
                    e.preventDefault()
                    if (flatCommandList[selectedIndex]) {
                        executeCommand(flatCommandList[selectedIndex])
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    close()
                    break
            }
        },
        [flatCommandList, selectedIndex, executeCommand, close]
    )

    // Scroll selected item into view
    useEffect(() => {
        const listEl = listRef.current
        if (!listEl) return

        const selectedEl = listEl.querySelector('[data-selected="true"]')
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    // Close on location change
    useEffect(() => {
        close()
    }, [location.pathname, close])

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
            <DialogContent
                className="max-w-2xl p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl"
                // Hide close button for cleaner look
                onPointerDownOutside={(e) => {
                    e.preventDefault()
                    close()
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
                            setQuery(e.target.value)
                            setSelectedIndex(0)
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Search commands, workflows, settings..."
                        className="flex-1 bg-transparent border-none outline-none text-base placeholder:text-muted-foreground/60"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border/50 bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                        ESC
                    </kbd>
                </div>

                {/* Command list */}
                <div
                    ref={listRef}
                    className="max-h-[400px] overflow-y-auto overflow-x-hidden"
                >
                    {isLoadingWorkflows && query && (
                        <div className="px-4 py-3 text-sm text-muted-foreground">
                            Loading workflows...
                        </div>
                    )}

                    {!isLoadingWorkflows && flatCommandList.length === 0 && (
                        <div className="px-4 py-8 text-center">
                            <Hash className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">No results found</p>
                            <p className="text-xs text-muted-foreground/60 mt-1">
                                Try a different search term
                            </p>
                        </div>
                    )}

                    {groupedCommands.map((group, groupIndex) => {
                        // Calculate starting index for this group
                        let startIndex = 0
                        for (let i = 0; i < groupIndex; i++) {
                            startIndex += groupedCommands[i].commands.length
                        }

                        return (
                            <div key={group.category} className="py-2">
                                <div className="px-4 py-1.5">
                                    <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                                        {group.label}
                                    </span>
                                </div>
                                {group.commands.map((command, cmdIndex) => {
                                    const flatIndex = startIndex + cmdIndex
                                    const isSelected = flatIndex === selectedIndex
                                    const Icon = command.icon

                                    return (
                                        <button
                                            key={command.id}
                                            data-selected={isSelected}
                                            onClick={() => executeCommand(command)}
                                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                                            className={cn(
                                                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-75',
                                                isSelected
                                                    ? 'bg-accent text-accent-foreground'
                                                    : 'hover:bg-accent/50'
                                            )}
                                        >
                                            {Icon && (
                                                <Icon
                                                    className={cn(
                                                        'w-4 h-4 flex-shrink-0',
                                                        isSelected ? 'text-accent-foreground' : 'text-muted-foreground'
                                                    )}
                                                />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm truncate">
                                                    {command.label}
                                                </div>
                                                {command.description && (
                                                    <div
                                                        className={cn(
                                                            'text-xs truncate',
                                                            isSelected
                                                                ? 'text-accent-foreground/70'
                                                                : 'text-muted-foreground'
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
                                    )
                                })}
                            </div>
                        )
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
    )
}
