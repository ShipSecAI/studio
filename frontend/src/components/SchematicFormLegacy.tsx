import { cn } from '@/lib/utils';
import { withTheme, type ThemeProps } from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import {
  getTemplate,
  getUiOptions,
  type ArrayFieldItemTemplateProps,
  type FieldTemplateProps,
} from '@rjsf/utils';

const CustomFieldTemplate = ({
  label,
  children,
  errors,
  description,
  hidden,
  required,
  displayLabel,
  schema,
  id,
}: FieldTemplateProps) => {
  if (hidden) {
    return <div className="hidden">{children}</div>;
  }

  const title = schema.title || label;
  const helper = description;

  const isArray = schema.type === 'array';

  if (isArray) {
    return (
      <div>
        {children}
        {errors}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-1.5 mb-2 items-start">
      {(title || helper) && (
        <div className="flex flex-col gap-0.5 pt-0.5 max-w-[9rem]">
          {title && displayLabel && (
            <label htmlFor={id} className="text-[0.65rem] font-medium text-foreground leading-tight">
              {title}
              {required && <span className="text-destructive ml-0.5">*</span>}
            </label>
          )}
          {helper && (
            <div className="text-[0.6rem] text-muted-foreground leading-tight">
              {helper}
            </div>
          )}
        </div>
      )}
      <div className="min-w-0">
        {children}
      </div>
      {errors && (
        <div className="col-start-2 text-[0.55rem] text-destructive mt-0.5">
          {errors}
        </div>
      )}
    </div>
  );
};

const CustomArrayFieldItemTemplate = ({
  buttonsProps,
  children,
  className,
  hasToolbar,
  registry,
  uiSchema,
}: ArrayFieldItemTemplateProps) => {
  const uiOptions = getUiOptions(uiSchema);
  const ArrayFieldItemButtonsTemplate = getTemplate('ArrayFieldItemButtonsTemplate', registry, uiOptions);

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {hasToolbar && (
        <div className="flex items-center gap-1 pt-0.5">
          <ArrayFieldItemButtonsTemplate {...buttonsProps} />
        </div>
      )}
    </div>
  );
};

const customTheme: ThemeProps = {
  templates: {
    FieldTemplate: CustomFieldTemplate,
    ArrayFieldItemTemplate: CustomArrayFieldItemTemplate,
  },
};

const ThemedForm = withTheme(customTheme);

interface SchematicFormProps {
    schema: any;
    data: any;
    onChange: (data: any) => void;
    className?: string;
}

export function SchematicForm({ schema, data, onChange, className }: SchematicFormProps) {
    if (!schema || Object.keys(schema).length === 0) {
        return (
            <div className="p-6 flex flex-col items-center justify-center text-center text-muted-foreground">
                <p className="text-sm">No input schema defined.</p>
                <p className="text-xs opacity-70 mt-1">Add a schema to generate a form.</p>
            </div>
        );
    }

    const handleChange = ({ formData }: any) => {
        onChange(formData);
    };

    return (
        <div className={cn("w-full schematic-form-compact", className)}>
            <style>{`
                .schematic-form-compact fieldset {
                    border: none;
                    padding: 0;
                    margin: 0;
                }
                .schematic-form-compact legend {
                    display: none;
                }
                .schematic-form-compact input,
                .schematic-form-compact select,
                .schematic-form-compact textarea {
                    font-size: 0.7rem !important;
                    padding: 0.25rem 0.375rem !important;
                    min-height: 1.5rem !important;
                    height: auto !important;
                    border: 1px solid hsl(var(--border)) !important;
                    border-radius: 0.25rem !important;
                }
                .schematic-form-compact input[type="checkbox"] {
                    width: 0.75rem !important;
                    height: 0.75rem !important;
                    min-height: 0.75rem !important;
                }
                .schematic-form-compact button {
                    font-size: 0.65rem !important;
                    padding: 0.2rem 0.375rem !important;
                    min-height: 1.25rem !important;
                    height: auto !important;
                }
                .schematic-form-compact button svg {
                    width: 0.7rem !important;
                    height: 0.7rem !important;
                }
            `}</style>
            <ThemedForm
                schema={schema}
                validator={validator}
                formData={data}
                onChange={handleChange}
                liveValidate
                showErrorList={false}
                uiSchema={{
                    "ui:submitButtonOptions": { norender: true }
                }}
            />
        </div>
    );
}
