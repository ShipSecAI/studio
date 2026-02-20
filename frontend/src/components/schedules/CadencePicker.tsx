import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CadencePreset {
  label: string;
  cron: string;
  humanLabel: string;
}

const PRESETS: CadencePreset[] = [
  { label: 'Daily', cron: '0 2 * * *', humanLabel: 'Daily at 2 AM' },
  { label: 'Weekly', cron: '0 2 * * MON', humanLabel: 'Weekly on Monday at 2 AM' },
  { label: 'Weekdays', cron: '0 2 * * MON-FRI', humanLabel: 'Weekdays at 2 AM' },
  { label: 'Monthly', cron: '0 2 1 * *', humanLabel: 'Monthly on the 1st at 2 AM' },
];

interface CadencePickerProps {
  cronExpression: string;
  humanLabel: string;
  onChange: (cron: string, label: string) => void;
}

export function CadencePicker({ cronExpression, humanLabel, onChange }: CadencePickerProps) {
  const activePreset = PRESETS.find((p) => p.cron === cronExpression);
  const isCustom = !activePreset;
  const [showCustom, setShowCustom] = useState(isCustom && cronExpression !== '');

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Cadence</Label>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant={activePreset?.cron === preset.cron && !showCustom ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setShowCustom(false);
              onChange(preset.cron, preset.humanLabel);
            }}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={showCustom ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setShowCustom(true);
            if (!isCustom) {
              onChange('', '');
            }
          }}
        >
          Custom
        </Button>
      </div>
      {showCustom && (
        <div className="space-y-1.5 pt-1">
          <Input
            placeholder="e.g. 0 9 * * MON-FRI"
            value={cronExpression}
            onChange={(e) => onChange(e.target.value, humanLabel || 'Custom schedule')}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Enter a cron expression (minute hour day month weekday)
          </p>
        </div>
      )}
    </div>
  );
}
