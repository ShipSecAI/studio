import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  RunCodeWikiIngestionDto,
  RunCodeWikiIngestionSchema,
  UpsertSecurityWikiConfigDto,
  UpsertSecurityWikiConfigSchema,
} from './dto';
import { SecurityWikisService } from './security-wikis.service';

@ApiTags('security-wikis')
@Controller('security-wikis')
export class SecurityWikisController {
  constructor(private readonly securityWikisService: SecurityWikisService) {}

  @Get('config')
  async getConfig(@CurrentAuth() auth: AuthContext) {
    return this.securityWikisService.getActiveConfig(auth);
  }

  @Post('config')
  async upsertConfig(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpsertSecurityWikiConfigSchema)) body: UpsertSecurityWikiConfigDto,
  ) {
    return this.securityWikisService.upsertConfig(auth, body);
  }

  @Get('runs')
  async listRuns(@CurrentAuth() auth: AuthContext) {
    return this.securityWikisService.listRuns(auth);
  }

  @Get('tree')
  async getTree(@CurrentAuth() auth: AuthContext) {
    return this.securityWikisService.getTree(auth);
  }

  @Get('file')
  async getFile(@CurrentAuth() auth: AuthContext, @Query('path') path?: string) {
    return this.securityWikisService.getFile(auth, path ?? '');
  }

  @Post('runs/code')
  async runCodeWikiIngestion(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(RunCodeWikiIngestionSchema)) body: RunCodeWikiIngestionDto,
  ) {
    return this.securityWikisService.runCodeWikiIngestion(auth, body);
  }
}
