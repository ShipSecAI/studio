import { ThemeProps } from '@rjsf/core';
import { FieldTemplate } from './FieldTemplate';
import { ArrayFieldTemplate } from './ArrayFieldTemplate';
import { ArrayFieldItemTemplate } from './ArrayFieldItemTemplate';
import { BaseInputTemplate } from './BaseInputTemplate';
import { ObjectFieldTemplate } from './ObjectFieldTemplate';
import { SelectWidget } from './SelectWidget';

export const Theme: ThemeProps = {
  templates: {
    FieldTemplate,
    ArrayFieldTemplate,
    ArrayFieldItemTemplate,
    BaseInputTemplate,
    ObjectFieldTemplate,
  },
  widgets: {
    SelectWidget,
  }
};
