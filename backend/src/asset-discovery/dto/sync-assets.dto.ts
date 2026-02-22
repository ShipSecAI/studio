import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TriggerSyncDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  integrationId!: string;
}
