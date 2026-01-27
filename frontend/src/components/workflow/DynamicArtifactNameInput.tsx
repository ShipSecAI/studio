import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DynamicParameter {
  placeholder: string;
  description: string;
}

const DYNAMIC_PARAMETERS: DynamicParameter[] = [
  { placeholder: '{{timestamp}}', description: 'Current timestamp' },
  { placeholder: '{{run_id}}', description: 'Run ID' },
  { placeholder: '{{dataset}}', description: 'Dataset name' },
  { placeholder: '{{task}}', description: 'Task name' },
  { placeholder: '{{run_name}}', description: 'Run name' },
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
  const [isParamsOpen, setIsParamsOpen] = useState(true);
  const currentValue = value || '';

  const handleInsertPlaceholder = (placeholder: string) => {
    if (disabled) return;
    // Insert at the end of current value
    const newValue = currentValue ? `${currentValue}${placeholder}` : placeholder;
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
      <p className="text-[10px] text-muted-foreground">
        e.g., task123-1617181920
      </p>

      {/* Dynamic Parameters Section */}
      <div className="rounded-md border bg-muted/30">
        <button
          type="button"
          onClick={() => setIsParamsOpen(!isParamsOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        >
          {isParamsOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">Dynamic parameters</span>
        </button>

        {isParamsOpen && (
          <div className="px-3 pb-3 border-t">
            <p className="text-[10px] text-muted-foreground py-2">
              These can be used in the name for the artifact.
            </p>
            <div className="space-y-1">
              {DYNAMIC_PARAMETERS.map((param) => (
                <button
                  key={param.placeholder}
                  type="button"
                  onClick={() => handleInsertPlaceholder(param.placeholder)}
                  disabled={disabled}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors',
                    'hover:bg-primary/10 group',
                    disabled && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center w-5 h-5 rounded-full',
                      'bg-primary/10 text-primary',
                      'group-hover:bg-primary group-hover:text-primary-foreground',
                      'transition-colors'
                    )}
                  >
                    <Plus className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-foreground">
                      {param.placeholder}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {param.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
