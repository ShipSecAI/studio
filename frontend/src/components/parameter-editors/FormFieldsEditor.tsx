import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

export interface FormField {
    id: string
    label: string
    type: string
    required: boolean
    placeholder?: string
    description?: string
    options?: string // For select/enum, comma separated
}

interface InternalFormField extends FormField {
    _uid: string
}

interface FormFieldsEditorProps {
    value: FormField[]
    onChange: (value: FormField[]) => void
}

interface SortableRowProps {
    item: InternalFormField
    onUpdate: (uid: string, updates: Partial<FormField>) => void
    onRemove: (uid: string) => void
}

function SortableRow({ item, onUpdate, onRemove }: SortableRowProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item._uid })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.9 : 1,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex flex-col gap-2 p-3 border rounded-md bg-background ${isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
        >
            <div className="flex items-center gap-2">
                <div
                    className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4" />
                </div>

                <div className="flex-1 grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-muted-foreground px-1">Field ID</Label>
                        <Input
                            value={item.id}
                            onChange={(e) => onUpdate(item._uid, { id: e.target.value })}
                            placeholder="e.g. email"
                            className="h-8 text-xs font-mono"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-muted-foreground px-1">Label / Title</Label>
                        <Input
                            value={item.label}
                            onChange={(e) => onUpdate(item._uid, { label: e.target.value })}
                            placeholder="e.g. Your Email"
                            className="h-8 text-xs"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-1 items-end min-w-[80px]">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id={`req-${item._uid}`}
                            checked={item.required}
                            onCheckedChange={(checked) => onUpdate(item._uid, { required: !!checked })}
                        />
                        <Label htmlFor={`req-${item._uid}`} className="text-[10px] uppercase cursor-pointer">Req</Label>
                    </div>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                                <Settings2 className="h-3 w-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-3 space-y-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Field Type</Label>
                                <Select
                                    value={item.type}
                                    onValueChange={(val) => onUpdate(item._uid, { type: val })}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="string">Text</SelectItem>
                                        <SelectItem value="number">Number</SelectItem>
                                        <SelectItem value="boolean">Checkbox</SelectItem>
                                        <SelectItem value="enum">Dropdown / Select</SelectItem>
                                        <SelectItem value="textarea">Multiline Text</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs">Placeholder / Help Text</Label>
                                <Input
                                    value={item.placeholder || ''}
                                    onChange={(e) => onUpdate(item._uid, { placeholder: e.target.value })}
                                    className="h-8 text-xs"
                                />
                            </div>

                            {item.type === 'enum' && (
                                <div className="space-y-1">
                                    <Label className="text-xs">Options (comma separated)</Label>
                                    <Input
                                        value={item.options || ''}
                                        onChange={(e) => onUpdate(item._uid, { options: e.target.value })}
                                        placeholder="Option 1, Option 2"
                                        className="h-8 text-xs"
                                    />
                                </div>
                            )}

                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full h-7 text-xs gap-2"
                                onClick={() => onRemove(item._uid)}
                            >
                                <Trash2 className="h-3 w-3" />
                                Remove Field
                            </Button>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        </div>
    )
}

let idCounter = 0
function generateUid(): string {
    return `field_${Date.now()}_${++idCounter}`
}

function toInternal(value: any): InternalFormField[] {
    let list: any[] = []
    if (Array.isArray(value)) {
        list = value
    } else if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                list = parsed
            } else if (parsed && typeof parsed === 'object' && parsed.properties) {
                // Handle legacy JSON Schema format
                list = Object.entries(parsed.properties).map(([id, prop]: [string, any]) => ({
                    id,
                    label: prop.title || id,
                    type: prop.type || 'string',
                    required: Array.isArray(parsed.required) ? parsed.required.includes(id) : false,
                    placeholder: prop.description || '',
                }))
            }
        } catch (e) {
            console.warn('Failed to parse legacy form fields', e)
        }
    }
    return list.map((v: any) => ({ ...v, _uid: generateUid() }))
}

function toExternal(items: InternalFormField[]): FormField[] {
    return items.map(({ _uid, ...rest }) => rest)
}

export function FormFieldsEditor({ value, onChange }: FormFieldsEditorProps) {
    const [items, setItems] = useState<InternalFormField[]>(() => toInternal(value))
    const isLocalChange = useRef(false)

    useEffect(() => {
        if (isLocalChange.current) {
            isLocalChange.current = false
            return
        }
        setItems(toInternal(value))
    }, [JSON.stringify(value)])

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const propagateChange = useCallback((newItems: InternalFormField[]) => {
        isLocalChange.current = true
        setItems(newItems)
        onChange(toExternal(newItems))
    }, [onChange])

    const handleAdd = useCallback(() => {
        const newItem: InternalFormField = {
            _uid: generateUid(),
            id: `field_${items.length + 1}`,
            label: `Field ${items.length + 1}`,
            type: 'string',
            required: false,
        }
        propagateChange([...items, newItem])
    }, [items, propagateChange])

    const handleRemove = useCallback((uid: string) => {
        propagateChange(items.filter((item) => item._uid !== uid))
    }, [items, propagateChange])

    const handleUpdate = useCallback((uid: string, updates: Partial<FormField>) => {
        propagateChange(
            items.map((item) => (item._uid === uid ? { ...item, ...updates } : item))
        )
    }, [items, propagateChange])

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const oldIndex = items.findIndex((item) => item._uid === active.id)
        const newIndex = items.findIndex((item) => item._uid === over.id)
        if (oldIndex !== -1 && newIndex !== -1) {
            propagateChange(arrayMove(items, oldIndex, newIndex))
        }
    }, [items, propagateChange])

    const itemIds = items.map((item) => item._uid)

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Form Fields</Label>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAdd}
                    className="h-7 text-xs gap-1.5 px-3 border-dashed hover:border-primary hover:text-primary transition-all"
                >
                    <Plus className="h-3.5 w-3.5" />
                    Add Field
                </Button>
            </div>

            {items.length === 0 ? (
                <div className="p-8 border border-dashed rounded-lg bg-muted/20 flex flex-col items-center justify-center gap-2">
                    <p className="text-xs text-muted-foreground">No fields defined yet</p>
                    <Button variant="link" size="sm" onClick={handleAdd} className="h-auto p-0 text-xs">Create your first field</Button>
                </div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                            {items.map((item) => (
                                <SortableRow
                                    key={item._uid}
                                    item={item}
                                    onUpdate={handleUpdate}
                                    onRemove={handleRemove}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </div>
    )
}
