import { useState } from 'react'
import {
    Trash2,
    Globe,
    MousePointer2,
    Type,
    Camera,
    Code2,
    Search,
    FileJson,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
    Card,
    CardContent,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface BrowserAction {
    type: string
    [key: string]: any
}

interface BrowserActionsEditorProps {
    value: BrowserAction[]
    onChange: (value: BrowserAction[]) => void
}

const ACTION_TYPES = [
    { value: 'goto', label: 'Navigate', icon: Globe, description: 'Go to a URL' },
    { value: 'click', label: 'Click', icon: MousePointer2, description: 'Click an element' },
    { value: 'fill', label: 'Fill', icon: Type, description: 'Enter text into a field' },
    { value: 'screenshot', label: 'Screenshot', icon: Camera, description: 'Capture the page' },
    { value: 'waitFor', label: 'Wait for Element', icon: Search, description: 'Wait for a selector' },
    { value: 'hover', label: 'Hover', icon: MousePointer2, description: 'Hover over an element' },
    { value: 'scroll', label: 'Scroll', icon: ChevronDown, description: 'Scroll the page or to an element' },
    { value: 'select', label: 'Select', icon: FileJson, description: 'Select a dropdown option' },
    { value: 'evaluate', label: 'Script', icon: Code2, description: 'Run custom JavaScript' },
    { value: 'getText', label: 'Get Text', icon: Type, description: 'Extract text from element' },
    { value: 'getHTML', label: 'Get HTML', icon: Code2, description: 'Extract HTML from element' },
]

export function BrowserActionsEditor({ value = [], onChange }: BrowserActionsEditorProps) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(value.length > 0 ? value.length - 1 : null)

    const addAction = (type: string) => {
        const defaults: Record<string, any> = {
            goto: { type: 'goto', url: '', waitUntil: 'load' },
            click: { type: 'click', selector: '', waitForSelector: true },
            fill: { type: 'fill', selector: '', value: '' },
            screenshot: { type: 'screenshot', name: 'screenshot', fullPage: false },
            waitFor: { type: 'waitFor', selector: '', state: 'visible' },
            hover: { type: 'hover', selector: '' },
            scroll: { type: 'scroll', position: 'bottom' },
            select: { type: 'select', selector: '', value: '' },
            evaluate: { type: 'evaluate', script: '' },
            getText: { type: 'getText', selector: '' },
            getHTML: { type: 'getHTML', selector: '' },
        }

        const newActions = [...value, defaults[type] || { type }]
        onChange(newActions)
        setExpandedIndex(newActions.length - 1)
    }

    const removeAction = (index: number) => {
        const newActions = value.filter((_, i) => i !== index)
        onChange(newActions)
        if (expandedIndex === index) setExpandedIndex(null)
        else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1)
    }

    const updateAction = (index: number, updates: Partial<BrowserAction>) => {
        const newActions = value.map((a, i) => (i === index ? { ...a, ...updates } : a))
        onChange(newActions)
    }

    const moveAction = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return
        if (direction === 'down' && index === value.length - 1) return

        const newActions = [...value]
        const targetIndex = direction === 'up' ? index - 1 : index + 1
            ;[newActions[index], newActions[targetIndex]] = [newActions[targetIndex], newActions[index]]

        onChange(newActions)
        if (expandedIndex === index) setExpandedIndex(targetIndex)
        else if (expandedIndex === targetIndex) setExpandedIndex(index)
    }

    return (
        <div className="space-y-4">
            {/* Actions List */}
            <div className="space-y-2">
                {value.map((action, index) => (
                    <ActionItem
                        key={index}
                        index={index}
                        action={action}
                        isExpanded={expandedIndex === index}
                        onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
                        onRemove={() => removeAction(index)}
                        onUpdate={(updates) => updateAction(index, updates)}
                        onMoveUp={() => moveAction(index, 'up')}
                        onMoveDown={() => moveAction(index, 'down')}
                        isFirst={index === 0}
                        isLast={index === value.length - 1}
                    />
                ))}
                {value.length === 0 && (
                    <div className="text-center py-8 border-2 border-dashed rounded-lg bg-muted/20">
                        <p className="text-sm text-muted-foreground">No actions defined yet.</p>
                        <p className="text-xs text-muted-foreground mt-1 text-balance">Add your first action using the buttons below.</p>
                    </div>
                )}
            </div>

            {/* Add Action Buttons */}
            <div className="border-t pt-4">
                <p className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Add Action</p>
                <div className="grid grid-cols-2 gap-2">
                    {ACTION_TYPES.map((type) => {
                        const Icon = type.icon
                        return (
                            <Button
                                key={type.value}
                                variant="outline"
                                size="sm"
                                className="justify-start gap-2 h-9"
                                onClick={() => addAction(type.value)}
                            >
                                <Icon className="h-4 w-4 text-primary" />
                                <span className="truncate">{type.label}</span>
                            </Button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

interface ActionItemProps {
    index: number
    action: BrowserAction
    isExpanded: boolean
    onToggle: () => void
    onRemove: () => void
    onUpdate: (updates: Partial<BrowserAction>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    isFirst: boolean
    isLast: boolean
}

function ActionItem({
    index,
    action,
    isExpanded,
    onToggle,
    onRemove,
    onUpdate,
    onMoveUp,
    onMoveDown,
    isFirst,
    isLast
}: ActionItemProps) {
    const typeConfig = ACTION_TYPES.find(t => t.value === action.type) || ACTION_TYPES[0]
    const Icon = typeConfig.icon

    return (
        <Card className={cn(
            "overflow-hidden transition-all border-l-4",
            isExpanded ? "border-l-primary shadow-sm" : "border-l-muted hover:border-l-primary/50"
        )}>
            <div
                className="flex items-center gap-3 px-3 py-2 cursor-pointer bg-card"
                onClick={onToggle}
            >
                <div className="flex flex-col gap-0.5">
                    <Button
                        variant="ghost" size="icon" className="h-5 w-5"
                        disabled={isFirst}
                        onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
                    >
                        <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                        variant="ghost" size="icon" className="h-5 w-5"
                        disabled={isLast}
                        onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
                    >
                        <ChevronDown className="h-3 w-3" />
                    </Button>
                </div>

                <div className="p-1.5 rounded bg-muted">
                    <Icon className="h-4 w-4 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{typeConfig.label}</span>
                        <Badge variant="secondary" className="text-[10px] py-0 h-4">#{index + 1}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                        {getActionSummary(action)}
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
            </div>

            {isExpanded && (
                <CardContent className="p-4 pt-2 border-t bg-muted/10 space-y-4">
                    <ActionForm action={action} onUpdate={onUpdate} />
                </CardContent>
            )}
        </Card>
    )
}

function getActionSummary(action: BrowserAction): string {
    switch (action.type) {
        case 'goto': return action.url || 'No URL specified'
        case 'click': return action.selector || 'No selector'
        case 'fill': return `${action.selector || '?'} ➔ ${action.value || '?'}`
        case 'screenshot': return action.name || 'screenshot'
        case 'waitFor': return `Wait for ${action.selector || '?'}`
        case 'evaluate': return action.script ? `Execute: ${action.script.slice(0, 30)}...` : 'No script'
        default: return action.selector || action.url || ''
    }
}

function ActionForm({ action, onUpdate }: { action: BrowserAction, onUpdate: (updates: Partial<BrowserAction>) => void }) {
    const common = (
        <div className="grid grid-cols-2 gap-3 pb-2 border-b">
            <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">Timeout (ms)</Label>
                <Input
                    type="number"
                    value={action.timeout ?? ''}
                    onChange={e => onUpdate({ timeout: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Use default"
                    className="h-8 text-xs"
                />
            </div>
        </div>
    )

    switch (action.type) {
        case 'goto':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">URL</Label>
                        <Input
                            value={action.url || ''}
                            onChange={e => onUpdate({ url: e.target.value })}
                            placeholder="https://example.com"
                            className="h-8 text-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Wait Until</Label>
                        <Select
                            value={action.waitUntil || 'load'}
                            onValueChange={v => onUpdate({ waitUntil: v })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="load">Load</SelectItem>
                                <SelectItem value="domcontentloaded">DOM Content Loaded</SelectItem>
                                <SelectItem value="networkidle">Network Idle</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {common}
                </div>
            )
        case 'click':
        case 'hover':
        case 'getText':
        case 'getHTML':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Selector</Label>
                        <Input
                            value={action.selector || ''}
                            onChange={e => onUpdate({ selector: e.target.value })}
                            placeholder="e.g. button#login"
                            className="h-8 text-xs font-mono"
                        />
                    </div>
                    {action.type === 'click' && (
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Wait for Selector</Label>
                            <Switch
                                checked={action.waitForSelector ?? true}
                                onCheckedChange={v => onUpdate({ waitForSelector: v })}
                            />
                        </div>
                    )}
                    {common}
                </div>
            )
        case 'fill':
        case 'select':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Selector</Label>
                        <Input
                            value={action.selector || ''}
                            onChange={e => onUpdate({ selector: e.target.value })}
                            placeholder="e.g. input[name='username']"
                            className="h-8 text-xs font-mono"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">{action.type === 'fill' ? 'Value' : 'Option Value'}</Label>
                        <Input
                            value={action.value || ''}
                            onChange={e => onUpdate({ value: e.target.value })}
                            placeholder={action.type === 'fill' ? 'Text to type...' : 'Option value to select'}
                            className="h-8 text-xs"
                        />
                    </div>
                    {common}
                </div>
            )
        case 'screenshot':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input
                            value={action.name || ''}
                            onChange={e => onUpdate({ name: e.target.value })}
                            placeholder="screenshot"
                            className="h-8 text-xs"
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Full Page</Label>
                        <Switch
                            checked={action.fullPage || false}
                            onCheckedChange={v => onUpdate({ fullPage: v })}
                        />
                    </div>
                </div>
            )
        case 'waitFor':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Selector</Label>
                        <Input
                            value={action.selector || ''}
                            onChange={e => onUpdate({ selector: e.target.value })}
                            placeholder="e.g. .success-message"
                            className="h-8 text-xs font-mono"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">State</Label>
                        <Select
                            value={action.state || 'visible'}
                            onValueChange={v => onUpdate({ state: v })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="visible">Visible</SelectItem>
                                <SelectItem value="hidden">Hidden</SelectItem>
                                <SelectItem value="attached">Attached</SelectItem>
                                <SelectItem value="detached">Detached</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {common}
                </div>
            )
        case 'scroll':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Scroll To</Label>
                        <Select
                            value={action.position || (action.selector ? 'selector' : 'bottom')}
                            onValueChange={v => {
                                if (v === 'selector') onUpdate({ position: undefined, selector: action.selector || '' })
                                else onUpdate({ position: v, selector: undefined })
                            }}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="top">Top of Page</SelectItem>
                                <SelectItem value="bottom">Bottom of Page</SelectItem>
                                <SelectItem value="selector">Specific Element</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {(!action.position || action.selector !== undefined) && (
                        <div className="space-y-1.5">
                            <Label className="text-xs">Selector</Label>
                            <Input
                                value={action.selector || ''}
                                onChange={e => onUpdate({ selector: e.target.value, position: undefined })}
                                placeholder="e.g. #footer"
                                className="h-8 text-xs font-mono"
                            />
                        </div>
                    )}
                    {common}
                </div>
            )
        case 'evaluate':
            return (
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">JavaScript Script</Label>
                        <textarea
                            value={action.script || ''}
                            onChange={e => onUpdate({ script: e.target.value })}
                            placeholder="() => { return document.title; }"
                            className="w-full h-24 p-2 text-[11px] font-mono border rounded-md bg-background resize-none"
                        />
                    </div>
                </div>
            )
        default:
            return <div className="text-xs text-muted-foreground italic">No specific configuration for this action type.</div>
    }
}
