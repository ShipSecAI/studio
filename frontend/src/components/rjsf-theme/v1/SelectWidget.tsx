import { WidgetProps } from '@rjsf/utils';
import { cn } from '@/lib/utils';

export const SelectWidget = (props: WidgetProps) => {
  const {
    id,
    options,
    value,
    required,
    disabled,
    readonly,
    multiple,
    autofocus,
    onChange,
    onBlur,
    onFocus,
    placeholder,
  } = props;

  const { enumOptions, enumDisabled } = options;

  const emptyValue = multiple ? [] : '';

  return (
    <select
      id={id}
      name={id}
      multiple={multiple}
      className={cn(
        "flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        // Compact styles matching BaseInputTemplate
        "h-8 text-xs appearance-none" 
      )}
      value={typeof value === 'undefined' ? emptyValue : value}
      required={required}
      disabled={disabled || readonly}
      autoFocus={autofocus}
      onBlur={
        onBlur &&
        ((event) => {
          const newValue = getValue(event, multiple);
          onBlur(id, newValue);
        })
      }
      onFocus={
        onFocus &&
        ((event) => {
          const newValue = getValue(event, multiple);
          onFocus(id, newValue);
        })
      }
      onChange={(event) => {
        const newValue = getValue(event, multiple);
        onChange(newValue);
      }}
    >
      {!multiple && schemaRequiresTrueValue(props.schema) === false && (
        <option value="">{placeholder}</option>
      )}
      {(enumOptions as any).map(({ value, label, disabled }: any, i: number) => {
        const disabledOption = enumDisabled && (enumDisabled as any).indexOf(value) !== -1;
        return (
          <option key={i} value={value} disabled={disabled || disabledOption}>
            {label}
          </option>
        );
      })}
    </select>
  );
};

// Helper function to handle value extraction
function getValue(event: React.ChangeEvent<HTMLSelectElement>, multiple?: boolean) {
  if (multiple) {
    return Array.from(event.target.options)
      .slice()
      .filter((o) => o.selected)
      .map((o) => o.value);
  }
  return event.target.value;
}

// Helper to check if schema requires a value (to show placeholder/empty option)
function schemaRequiresTrueValue(schema: any) {
  // Simple heuristic, can be improved based on RJSF utils
  return schema.default !== undefined; 
}
