import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSecretDto {
  @ApiProperty({ description: 'Human-readable unique secret name' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Secret plaintext value' })
  @IsString()
  @MinLength(1)
  value!: string;

  @ApiPropertyOptional({ description: 'Optional description for operators' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Optional tags to help organize secrets', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class RotateSecretDto {
  @ApiProperty({ description: 'New plaintext secret value' })
  @IsString()
  @MinLength(1)
  value!: string;
}

export class UpdateSecretDto {
  @ApiPropertyOptional({ description: 'Updated secret name (must remain unique)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ description: 'Updated description for the secret' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: 'Updated tags for the secret', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[] | null;
}

export class SecretVersionResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  createdBy?: string | null;
}

export class SecretSummaryResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  tags?: string[] | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({
    type: () => SecretVersionResponse,
    description: 'Metadata about the active version (value is never returned)',
  })
  activeVersion?: SecretVersionResponse | null;
}

export class SecretValueResponse {
  @ApiProperty()
  secretId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ description: 'Decrypted secret value' })
  value!: string;
}
