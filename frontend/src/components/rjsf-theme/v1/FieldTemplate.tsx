import { FieldTemplateProps } from '@rjsf/utils';
import { cn } from '@/lib/utils';

export const FieldTemplate = (props: FieldTemplateProps) => {
  const {
    id,
    label,
    children,
    errors,
    help,
    description,
    hidden,
    required,
    displayLabel,
    schema,
  } = props;

  if (hidden) {
    return <div className="hidden">{children}</div>;
  }

  // Heuristic: specific types use block layout to avoid squashing
  const isComplex = schema.type === 'object' || schema.type === 'array';
  
  // If it's an object/array, we render the Label/Description on top, and children below.
  // This avoids deep indentation shifts for the main inputs.
  if (isComplex) {
    return (
      <div className="mb-2 w-full">
        {displayLabel && label ? (
          <div className="mb-1 border-b pb-0.5">
             <label htmlFor={id} className="text-sm font-semibold text-foreground block">
              {label}
              {required && <span className="text-destructive ml-1">*</span>}
            </label>
            {description && (
                <div className="text-xs text-muted-foreground mt-0.5 opacity-80">
                  {description}
                </div>
            )}
          </div>
        ) : null}
        <div className="w-full">
            {children}
        </div>
        {errors && <div className="mt-1 text-xs text-destructive">{errors}</div>}
        {help && <div className="mt-1 text-xs text-muted-foreground">{help}</div>}
      </div>
    );
  }

  // For primitive types (string, number, boolean, etc.), we use the side-by-side layout.
  // Left: Label + Help. Right: Input + Errors.
  return (
    <div className={cn("flex gap-4 mb-1.5 items-start", "group")}>
      <div className="w-48 shrink-0 pt-2">
        {displayLabel && label && (
          <label htmlFor={id} className="text-sm font-medium text-foreground block leading-none">
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </label>
        )}
        {(description || help) && (
          <div className="text-[0.7rem] text-muted-foreground mt-1 leading-snug opacity-80">
            {description || help}
          </div>
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        {children}
        {errors && <div className="mt-1.5 text-xs text-destructive font-medium">{errors}</div>}
      </div>
    </div>
  );
};
