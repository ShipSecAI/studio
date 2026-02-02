import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface SelectionOption {
  label: string;
  value: string;
}

interface InternalOption extends SelectionOption {
  _uid: string;
}

interface SelectionOptionsEditorProps {
  value: SelectionOption[] | string[];
  onChange: (value: SelectionOption[]) => void;
}

interface SortableRowProps {
  item: InternalOption;
  onUpdate: (uid: string, field: keyof SelectionOption, value: string) => void;
  onRemove: (uid: string) => void;
}

function SortableRow({ item, onUpdate, onRemove }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item._uid,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    opacity: isDragging ? 0.9 : 1,
  };

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

      <div className="flex-1 grid grid-cols-2 gap-2">
        <Input
          value={item.label}
          onChange={(e) => onUpdate(item._uid, 'label', e.target.value)}
          placeholder="Label (e.g. Red)"
          className="h-7 text-xs"
        />
        <Input
          value={item.value}
          onChange={(e) => onUpdate(item._uid, 'value', e.target.value)}
          placeholder="Value (e.g. red)"
          className="h-7 text-xs font-mono"
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => onRemove(item._uid)}
      >
        <Trash2 className="h-3 w-3 text-red-500" />
      </Button>
    </div>
  );
}

let idCounter = 0;
function generateUid(): string {
  return `opt_${Date.now()}_${++idCounter}`;
}

function toInternal(value: any): InternalOption[] {
  let list: any[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch (_e) {
      // Might be comma separated string if it failed parsing
      list = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  return list.map((v) => {
    if (typeof v === 'string') {
      return { label: v, value: v, _uid: generateUid() };
    }
    return { ...v, _uid: generateUid() };
  });
}

function toExternal(items: InternalOption[]): SelectionOption[] {
  return items.map(({ label, value }) => ({ label, value }));
}

export function SelectionOptionsEditor({ value, onChange }: SelectionOptionsEditorProps) {
  const [items, setItems] = useState<InternalOption[]>(() => toInternal(value));
  const isLocalChange = useRef(false);

  useEffect(() => {
    if (isLocalChange.current) {
      isLocalChange.current = false;
      return;
    }
    setItems(toInternal(value));
  }, [JSON.stringify(value)]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const propagateChange = useCallback(
    (newItems: InternalOption[]) => {
      isLocalChange.current = true;
      setItems(newItems);
      onChange(toExternal(newItems));
    },
    [onChange],
  );

  const handleAdd = useCallback(() => {
    const newItem: InternalOption = {
      _uid: generateUid(),
      label: `Option ${items.length + 1}`,
      value: `option_${items.length + 1}`,
    };
    propagateChange([...items, newItem]);
  }, [items, propagateChange]);

  const handleRemove = useCallback(
    (uid: string) => {
      propagateChange(items.filter((item) => item._uid !== uid));
    },
    [items, propagateChange],
  );

  const handleUpdate = useCallback(
    (uid: string, field: keyof SelectionOption, value: string) => {
      propagateChange(
        items.map((item) => (item._uid === uid ? { ...item, [field]: value } : item)),
      );
    },
    [items, propagateChange],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = items.findIndex((item) => item._uid === active.id);
      const newIndex = items.findIndex((item) => item._uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        propagateChange(arrayMove(items, oldIndex, newIndex));
      }
    },
    [items, propagateChange],
  );

  const itemIds = items.map((item) => item._uid);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Selection Options
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAdd}
          className="h-6 text-xs gap-1 px-2 hover:text-primary transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add Option
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="p-4 border border-dashed rounded-md text-center bg-muted/10">
          <p className="text-[11px] text-muted-foreground">Add at least one option</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
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
  );
}
