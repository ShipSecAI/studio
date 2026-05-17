import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  RunCodeWikiIngestionDto,
  RunCodeWikiIngestionResponseDto,
  RunCodeWikiIngestionSchema,
  SecurityWikiConfigResponseDto,
  SecurityWikiFileResponseDto,
  SecurityWikiRunResponseDto,
  SecurityWikiTreeResponseDto,
  UpsertSecurityWikiConfigDto,
  UpsertSecurityWikiConfigSchema,
} from './dto';
import { SecurityWikisService } from './security-wikis.service';

@ApiTags('security-wikis')
@Controller('security-wikis')
export class SecurityWikisController {
  constructor(private readonly securityWikisService: SecurityWikisService) {}

  @Get('config')
  @ApiOkResponse({ type: SecurityWikiConfigResponseDto })
  async getConfig(@CurrentAuth() auth: AuthContext) {
    return this.securityWikisService.getActiveConfig(auth);
  }

  @Post('config')
  @ApiOkResponse({ type: SecurityWikiConfigResponseDto })
  async upsertConfig(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpsertSecurityWikiConfigSchema)) body: UpsertSecurityWikiConfigDto,
  ) {
    return this.securityWikisService.upsertConfig(auth, body);
  }

  @Get('runs')
  @ApiOkResponse({ type: [SecurityWikiRunResponseDto] })
  async listRuns(@CurrentAuth() auth: AuthContext) {
    return this.securityWikisService.listRuns(auth);
  }

  @Get('tree')
  @ApiOkResponse({ type: SecurityWikiTreeResponseDto })
  async getTree(@CurrentAuth() auth: AuthContext) {
    return this.securityWikisService.getTree(auth);
  }

  @Get('file')
  @ApiQuery({ name: 'path', required: true, type: String })
  @ApiOkResponse({ type: SecurityWikiFileResponseDto })
  async getFile(@CurrentAuth() auth: AuthContext, @Query('path') path?: string) {
    return this.securityWikisService.getFile(auth, path ?? '');
  }

  @Post('runs/code')
  @ApiOkResponse({ type: RunCodeWikiIngestionResponseDto })
  async runCodeWikiIngestion(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(RunCodeWikiIngestionSchema)) body: RunCodeWikiIngestionDto,
  ) {
    return this.securityWikisService.runCodeWikiIngestion(auth, body);
  }
}
