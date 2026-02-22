import { IsUUID } from 'class-validator';

export class TriggerSyncDto {
  @IsUUID()
  integrationId!: string;
}
