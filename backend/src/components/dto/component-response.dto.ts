import { createZodDto } from 'nestjs-zod';
import { ComponentListItemSchema, ComponentDetailSchema } from '@shipsec/shared';

export class ComponentListItemDto extends createZodDto(ComponentListItemSchema) {}
export class ComponentDetailDto extends createZodDto(ComponentDetailSchema) {}

// Re-export for convenience
export { ComponentListItemSchema, ComponentDetailSchema };
