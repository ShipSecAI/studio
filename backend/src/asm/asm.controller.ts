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
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuthGuard } from '../auth/auth.guard';
import { AsmService } from './asm.service';
import { CreateDomainDto, CreateDomainSchema } from './dto/create-domain.dto';
import { UpdateDomainDto, UpdateDomainSchema } from './dto/update-domain.dto';
import { TriggerScanDto, TriggerScanSchema } from './dto/trigger-scan.dto';
import { ListDomainsQueryDto, ListDomainsQuerySchema } from './dto/list-domains.dto';
import { ListAssetsQueryDto, ListAssetsQuerySchema } from './dto/list-assets.dto';
import { ListScansQueryDto, ListScansQuerySchema } from './dto/list-scans.dto';

@ApiTags('asm')
@Controller('asm')
@UseGuards(AuthGuard)
export class AsmController {
  constructor(private readonly asmService: AsmService) {}

  // ── Domains ────────────────────────────────────────────────────────────────

  @Get('domains')
  async listDomains(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(ListDomainsQuerySchema)) query: ListDomainsQueryDto,
  ) {
    return this.asmService.listDomains(auth, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('domains/:id')
  async getDomain(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.asmService.getDomain(auth, id);
  }

  @Post('domains')
  async createDomain(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateDomainSchema)) body: CreateDomainDto,
  ) {
    return this.asmService.createDomain(auth, {
      domain: body.domain,
      scopeInclude: body.scopeInclude,
      scopeExclude: body.scopeExclude,
      scanNow: body.scanNow,
    });
  }

  @Patch('domains/:id')
  async updateDomain(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDomainSchema)) body: UpdateDomainDto,
  ) {
    return this.asmService.updateDomain(auth, id, body);
  }

  @Delete('domains/:id')
  async deleteDomain(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.asmService.deleteDomain(auth, id);
  }

  @Post('domains/:id/scan')
  async triggerScan(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TriggerScanSchema)) body: TriggerScanDto,
  ) {
    return this.asmService.triggerDomainScan(auth, id, body.templateSlug);
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  @Get('assets')
  async listAssets(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(ListAssetsQuerySchema)) query: ListAssetsQueryDto,
  ) {
    return this.asmService.listAssets(auth, {
      limit: query.limit,
      offset: query.offset,
      domainId: query.domainId,
      type: query.type,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get('assets/:id')
  async getAsset(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.asmService.getAsset(auth, id);
  }

  @Post('assets/:id/scan')
  async triggerAssetScan(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TriggerScanSchema)) body: TriggerScanDto,
  ) {
    const asset = await this.asmService.getAsset(auth, id);
    return this.asmService.triggerDomainScan(auth, asset.domainId, body.templateSlug);
  }

  // ── Scans ──────────────────────────────────────────────────────────────────

  @Get('scans')
  async listScans(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(ListScansQuerySchema)) query: ListScansQueryDto,
  ) {
    return this.asmService.listScans(auth, {
      limit: query.limit,
      offset: query.offset,
      status: query.status,
      domainId: query.domainId,
    });
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  @Get('stats')
  async getDashboardStats(@CurrentAuth() auth: AuthContext) {
    return this.asmService.getDashboardStats(auth);
  }
}
