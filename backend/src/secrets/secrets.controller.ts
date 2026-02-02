import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { SecretsService } from './secrets.service';
import {
  CreateSecretDto,
  UpdateSecretDto,
  RotateSecretDto,
  SecretSummaryResponse,
  SecretValueResponse,
} from './secrets.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('secrets')
@Controller('secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Get()
  @ApiOkResponse({ type: [SecretSummaryResponse] })
  async listSecrets(@CurrentAuth() auth: AuthContext | null): Promise<SecretSummaryResponse[]> {
    return this.secretsService.listSecrets(auth);
  }

  @Get(':id')
  @ApiOkResponse({ type: SecretSummaryResponse })
  async getSecret(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SecretSummaryResponse> {
    return this.secretsService.getSecret(auth, id);
  }

  @Get(':id/value')
  @ApiOkResponse({ type: SecretValueResponse })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Optional secret version to retrieve (defaults to active version)',
    type: Number,
  })
  async getSecretValue(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Query('version') version?: string,
  ): Promise<SecretValueResponse> {
    const parsedVersion = version !== undefined ? Number(version) : undefined;
    if (parsedVersion !== undefined && Number.isNaN(parsedVersion)) {
      throw new BadRequestException('version must be a number');
    }

    // Check if id is a UUID (with hyphens) or a secret name
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

    if (isUUID) {
      return this.secretsService.getSecretValue(auth, id, parsedVersion);
    } else {
      // Treat as secret name
      return this.secretsService.getSecretValueByName(auth, id, parsedVersion);
    }
  }

  @Post()
  @ApiCreatedResponse({ type: SecretSummaryResponse })
  async createSecret(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateSecretDto,
  ): Promise<SecretSummaryResponse> {
    return this.secretsService.createSecret(auth, body);
  }

  @Put(':id/rotate')
  @ApiOkResponse({ type: SecretSummaryResponse })
  async rotateSecret(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RotateSecretDto,
  ): Promise<SecretSummaryResponse> {
    return this.secretsService.rotateSecret(auth, id, body);
  }

  @Patch(':id')
  @ApiOkResponse({ type: SecretSummaryResponse })
  async updateSecret(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateSecretDto,
  ): Promise<SecretSummaryResponse> {
    return this.secretsService.updateSecret(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteSecret(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.secretsService.deleteSecret(auth, id);
  }
}
