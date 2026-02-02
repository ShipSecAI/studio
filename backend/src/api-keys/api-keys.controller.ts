import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { ApiKeysService } from './api-keys.service';
import {
  ApiKeyResponseDto,
  CreateApiKeyDto,
  CreateApiKeySchema,
  CreateApiKeyResponseDto,
  DeleteApiKeyResponseDto,
  ListApiKeysQueryDto,
  ListApiKeysQuerySchema,
  UpdateApiKeyDto,
  UpdateApiKeySchema,
} from './dto/api-key.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('api-keys')
@Controller('api-keys')
@UseGuards(AuthGuard, RolesGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOkResponse({ type: ApiKeyResponseDto, isArray: true })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(ListApiKeysQuerySchema)) query: ListApiKeysQueryDto,
  ) {
    const keys = await this.apiKeysService.list(auth, query);
    return keys.map((key) => ApiKeyResponseDto.create(key));
  }

  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: CreateApiKeyResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) dto: CreateApiKeyDto,
  ) {
    const { apiKey, plainKey } = await this.apiKeysService.create(auth, dto);
    // Return the response DTO plus the plain key (one-time only)
    return {
      ...ApiKeyResponseDto.create(apiKey),
      plainKey,
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ApiKeyResponseDto })
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const apiKey = await this.apiKeysService.get(auth, id);
    return ApiKeyResponseDto.create(apiKey);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOkResponse({ type: ApiKeyResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateApiKeySchema)) dto: UpdateApiKeyDto,
  ) {
    const apiKey = await this.apiKeysService.update(auth, id, dto);
    return ApiKeyResponseDto.create(apiKey);
  }

  @Post(':id/revoke')
  @Roles('ADMIN')
  @ApiOkResponse({ type: ApiKeyResponseDto })
  async revoke(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const apiKey = await this.apiKeysService.update(auth, id, { isActive: false });
    return ApiKeyResponseDto.create(apiKey);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOkResponse({ type: DeleteApiKeyResponseDto })
  async delete(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    await this.apiKeysService.delete(auth, id);
    return { success: true };
  }
}
