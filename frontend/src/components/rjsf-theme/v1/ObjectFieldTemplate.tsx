import { ObjectFieldTemplateProps } from '@rjsf/utils';

export const ObjectFieldTemplate = (props: ObjectFieldTemplateProps) => {
  const {
    properties,
  } = props;

  return (
    <div className="w-full">
      {/* 
        We rely on FieldTemplate to render the Title and Description for the Object.
        Here we just render the properties (children).
        We don't use fieldset/legend to keep it compact and styling consistent.
      */}
      <div className="flex flex-col gap-0.5">
        {properties.map((element) => (
          <div key={element.name} className="">
            {element.content}
          </div>
        ))}
      </div>
    </div>
  );
};
