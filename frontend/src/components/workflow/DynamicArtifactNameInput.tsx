import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DynamicParameter {
  placeholder: string;
  description: string;
}

const DYNAMIC_PARAMETERS: DynamicParameter[] = [
  { placeholder: '{{run_id}}', description: 'Full workflow run ID' },
  { placeholder: '{{node_id}}', description: 'Component node ID in workflow' },
  { placeholder: '{{timestamp}}', description: 'Unix timestamp (ms)' },
  { placeholder: '{{date}}', description: 'Date (YYYY-MM-DD)' },
  { placeholder: '{{time}}', description: 'Time (HH-MM-SS)' },
];

interface DynamicArtifactNameInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DynamicArtifactNameInput({
  value,
  onChange,
  disabled = false,
  placeholder = '{{run_id}}-{{timestamp}}',
}: DynamicArtifactNameInputProps) {
  const currentValue = value || '';

  const handleInsertPlaceholder = (selectedPlaceholder: string) => {
    if (disabled) return;
    // Insert at the end of current value
    const newValue = currentValue ? `${currentValue}${selectedPlaceholder}` : selectedPlaceholder;
    onChange(newValue);
  };

  return (
    <div className="space-y-2">
      <Input
        type="text"
        value={currentValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm font-mono"
        disabled={disabled}
      />

      <div className="flex items-center gap-2">
        <Select disabled={disabled} onValueChange={handleInsertPlaceholder} value="">
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Insert placeholder..." />
          </SelectTrigger>
          <SelectContent>
            {DYNAMIC_PARAMETERS.map((param) => (
              <SelectItem key={param.placeholder} value={param.placeholder} className="text-xs">
                <span className="font-mono">{param.placeholder}</span>
                <span className="ml-2 text-muted-foreground">— {param.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Type directly or select a placeholder to insert. Example: scan-{'{{date}}'}-{'{{time}}'}
      </p>
    </div>
  );
}
