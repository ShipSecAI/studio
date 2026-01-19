import { Button, ButtonProps } from '@/components/ui/button';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SaveButtonProps extends ButtonProps {
  isDirty: boolean;
  isSaving: boolean;
  label?: string;
}

export function SaveButton({
  isDirty,
  isSaving,
  label,
  className,
  disabled,
  ...props
}: SaveButtonProps) {
  const saveState = isSaving ? 'saving' : isDirty ? 'dirty' : 'clean';

  const saveLabel =
    label || (saveState === 'clean' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save');
  const saveBadgeText =
    saveState === 'clean' ? 'Synced' : saveState === 'saving' ? 'Syncing' : 'Pending';

  const saveBadgeTone =
    saveState === 'clean'
      ? '!bg-emerald-50 !text-emerald-700 !border-emerald-300 dark:!bg-emerald-900 dark:!text-emerald-100 dark:!border-emerald-500'
      : saveState === 'saving'
        ? '!bg-blue-50 !text-blue-700 !border-blue-300 dark:!bg-blue-900 dark:!text-blue-100 dark:!border-blue-500'
        : '!bg-amber-50 !text-amber-700 !border-amber-300 dark:!bg-amber-900 dark:!text-amber-100 dark:!border-amber-500';

  const saveButtonClasses = cn(
    'gap-2 min-w-0 transition-all duration-200',
    saveState === 'clean' && 'border-emerald-200 dark:border-emerald-700',
    saveState === 'dirty' && 'border-gray-300 dark:border-gray-600',
    saveState === 'saving' && 'border-blue-300 dark:border-blue-700',
    className,
  );

  const saveIcon =
    saveState === 'clean' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
    ) : saveState === 'saving' ? (
      <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
    ) : (
      <Save className="h-4 w-4" />
    );

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || saveState === 'clean'}
      className={saveButtonClasses}
      {...props}
    >
      {saveIcon}
      <span className="hidden xl:inline">{saveLabel}</span>
      <span
        className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded border ml-0 xl:ml-1',
          saveBadgeTone,
          'hidden sm:inline-block',
        )}
      >
        {saveBadgeText}
      </span>
    </Button>
  );
}
