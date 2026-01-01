import { BaseInputTemplateProps, getInputProps } from '@rjsf/utils';
import { cn } from '@/lib/utils';

export const BaseInputTemplate = (props: BaseInputTemplateProps) => {
  const {
    id,
    placeholder,
    readonly,
    disabled,
    type,
    value,
    onChange,
    onBlur,
    onFocus,
    autofocus,
    options,
    schema,
    rawErrors
  } = props;

  const inputProps = getInputProps(schema, type, options);
  const _onChange = ({ target: { value } }: React.ChangeEvent<HTMLInputElement>) => {
    return onChange(value === '' ? options.emptyValue : value);
  };
  const _onBlur = ({ target: { value } }: React.FocusEvent<HTMLInputElement>) => {
    return onBlur(id, value);
  };
  const _onFocus = ({ target: { value } }: React.FocusEvent<HTMLInputElement>) => {
    return onFocus(id, value);
  };

  const hasError = rawErrors && rawErrors.length > 0;

  return (
    <input
      id={id}
      name={id}
      // type is handled by inputProps spread, or we can explicity set it if inputProps doesn't include it. 
      // getInputProps usually includes type.
      value={value || value === 0 ? value : ''}
      onChange={_onChange}
      onBlur={_onBlur}
      onFocus={_onFocus}
      autoFocus={autofocus}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readonly}
      className={cn(
        "flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        hasError && "border-destructive focus-visible:ring-destructive",
        // Compact styles
        "h-8 text-xs" 
      )}
      list={schema.examples ? `examples_${id}` : undefined}
      {...inputProps}
    />
  );
};
