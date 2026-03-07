import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const OnboardingPreferencesSchema = z.object({
  appNavigationTourCompleted: z.boolean().describe('example: true'),
  workflowBuilderTourCompleted: z.boolean().describe('example: false'),
});
export class OnboardingPreferencesDto extends createZodDto(OnboardingPreferencesSchema) {}

export const UpdateOnboardingPreferencesSchema = z.object({
  appNavigationTourCompleted: z.boolean().describe('example: true').optional(),
  workflowBuilderTourCompleted: z.boolean().describe('example: true').optional(),
});
export class UpdateOnboardingPreferencesDto extends createZodDto(
  UpdateOnboardingPreferencesSchema,
) {}
