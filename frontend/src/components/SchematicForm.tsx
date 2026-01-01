import { cn } from '@/lib/utils';
import { withTheme } from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { ThemeV1 } from './rjsf-theme/v1';

const ThemedForm = withTheme(ThemeV1);

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
        <div className={cn("w-full schematic-form-v1", className)}>
             {/* 
                We use a specific class scope 'schematic-form-v1' if we need any global CSS overrides 
                that can't be handled by Tailwind classes in templates.
            */}
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
