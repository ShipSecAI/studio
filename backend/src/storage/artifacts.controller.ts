import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express';

import { ArtifactsService } from './artifacts.service';
import { ListArtifactsQuerySchema, type ListArtifactsQuery, ArtifactIdParamDto, ArtifactIdParamSchema } from './dto/artifacts.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('artifacts')
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  @Get()
  @ApiOkResponse({
    description: 'List workspace artifacts',
  })
  async listArtifacts(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListArtifactsQuerySchema)) query: ListArtifactsQuery,
  ) {
    return this.artifactsService.listArtifacts(auth, query);
  }

  @Get(':id/download')
  @ApiOkResponse({
    description: 'Download artifact binary',
  })
  async downloadArtifact(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(ArtifactIdParamSchema)) params: ArtifactIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { artifact, buffer, file } = await this.artifactsService.downloadArtifact(auth, params.id);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
    res.setHeader('Content-Length', file.size.toString());

    return new StreamableFile(buffer);
  }
}
