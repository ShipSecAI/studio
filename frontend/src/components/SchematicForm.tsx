import { cn } from '@/lib/utils';
import Form from '@rjsf/shadcn';
import validator from '@rjsf/validator-ajv8';

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
        <div className={cn("w-full", className)}>
            <Form
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
