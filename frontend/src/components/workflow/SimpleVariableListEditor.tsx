import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export interface SimpleVariable {
    name: string
    type: string
}

interface InternalVariable extends SimpleVariable {
    _id: string
}

interface SimpleVariableListEditorProps {
    value: SimpleVariable[]
    onChange: (value: SimpleVariable[]) => void
    title: string
    type: 'input' | 'output'
}

interface SortableRowProps {
    item: InternalVariable
    onUpdate: (id: string, field: keyof SimpleVariable, value: string) => void
    onRemove: (id: string) => void
}

function SortableRow({ item, onUpdate, onRemove }: SortableRowProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item._id })

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
            className={`flex items-center gap-2 p-2 border rounded-md bg-background ${isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
        >
            <div
                className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4" />
            </div>

            <Input
                value={item.name}
                onChange={(e) => onUpdate(item._id, 'name', e.target.value)}
                placeholder="name"
                className="h-7 text-xs font-mono flex-1 min-w-0"
            />

            <Select
                value={item.type}
                onValueChange={(val) => onUpdate(item._id, 'type', val)}
            >
                <SelectTrigger className="h-7 text-xs w-24 shrink-0">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="boolean">Boolean</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="list">List</SelectItem>
                </SelectContent>
            </Select>

            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => onRemove(item._id)}
            >
                <Trash2 className="h-3 w-3 text-red-500" />
            </Button>
        </div>
    )
}

let idCounter = 0
function generateId(): string {
    return `var_${Date.now()}_${++idCounter}`
}

function toInternal(value: any): InternalVariable[] {
    let list: any[] = []
    if (Array.isArray(value)) {
        list = value
    } else if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                list = parsed
            }
        } catch (e) {
            console.warn('Failed to parse legacy variables', e)
        }
    }
    return list.map((v) => ({ ...v, _id: generateId() }))
}

function toExternal(items: InternalVariable[]): SimpleVariable[] {
    return items.map(({ name, type }) => ({ name, type }))
}

export function SimpleVariableListEditor({ value, onChange, title, type }: SimpleVariableListEditorProps) {
    const [items, setItems] = useState<InternalVariable[]>(() => toInternal(value || []))
    const isLocalChange = useRef(false)

    useEffect(() => {
        if (isLocalChange.current) {
            isLocalChange.current = false
            return
        }
        setItems(toInternal(value || []))
    }, [JSON.stringify(value)])

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const propagateChange = useCallback((newItems: InternalVariable[]) => {
        isLocalChange.current = true
        setItems(newItems)
        onChange(toExternal(newItems))
    }, [onChange])

    const handleAdd = useCallback(() => {
        const newItem: InternalVariable = {
            _id: generateId(),
            name: `var${items.length + 1}`,
            type: 'json',
        }
        propagateChange([...items, newItem])
    }, [items, propagateChange])

    const handleRemove = useCallback((id: string) => {
        propagateChange(items.filter((item) => item._id !== id))
    }, [items, propagateChange])

    const handleUpdate = useCallback((id: string, field: keyof SimpleVariable, value: string) => {
        propagateChange(
            items.map((item) => (item._id === id ? { ...item, [field]: value } : item))
        )
    }, [items, propagateChange])

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const oldIndex = items.findIndex((item) => item._id === active.id)
        const newIndex = items.findIndex((item) => item._id === over.id)
        if (oldIndex !== -1 && newIndex !== -1) {
            propagateChange(arrayMove(items, oldIndex, newIndex))
        }
    }, [items, propagateChange])

    const itemIds = items.map((item) => item._id)

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">{title}</Label>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAdd}
                    className="h-6 text-xs gap-1 px-2"
                >
                    <Plus className="h-3 w-3" />
                    Add
                </Button>
            </div>

            {items.length === 0 ? (
                <div className="p-3 border border-dashed rounded-md text-center">
                    <p className="text-xs text-muted-foreground">
                        {type === 'input' ? 'No input variables' : 'No output variables'}
                    </p>
                </div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1">
                            {items.map((item) => (
                                <SortableRow
                                    key={item._id}
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
