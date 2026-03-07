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
import { ApiTags, ApiQuery, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
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
import {
  AsmDomainDto,
  AsmDomainWithStatsDto,
  AsmDomainCreateResponseDto,
  AsmAssetDto,
  AsmAssetListResponseDto,
  AsmDeleteResponseDto,
  AsmScanTriggerResponseDto,
  AsmScanListResponseDto,
  AsmDashboardStatsDto,
} from './dto/asm-response.dto';

@ApiTags('asm')
@Controller('asm')
@UseGuards(AuthGuard)
export class AsmController {
  constructor(private readonly asmService: AsmService) {}

  // ── Domains ────────────────────────────────────────────────────────────────

  @Get('domains')
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items to return (default 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Items to skip (default 0)',
  })
  @ApiOkResponse({
    description: 'List of ASM domains',
    type: AsmDomainWithStatsDto,
    isArray: true,
  })
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
  @ApiOkResponse({
    description: 'Single ASM domain',
    type: AsmDomainDto,
  })
  async getDomain(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.asmService.getDomain(auth, id);
  }

  @Post('domains')
  @ApiCreatedResponse({
    description: 'Newly created ASM domain',
    type: AsmDomainCreateResponseDto,
  })
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
  @ApiOkResponse({
    description: 'Updated ASM domain',
    type: AsmDomainDto,
  })
  async updateDomain(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDomainSchema)) body: UpdateDomainDto,
  ) {
    return this.asmService.updateDomain(auth, id, body);
  }

  @Delete('domains/:id')
  @ApiOkResponse({
    description: 'Domain deleted',
    type: AsmDeleteResponseDto,
  })
  async deleteDomain(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.asmService.deleteDomain(auth, id);
  }

  @Post('domains/:id/scan')
  @ApiCreatedResponse({
    description: 'Scan triggered',
    type: AsmScanTriggerResponseDto,
  })
  async triggerScan(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TriggerScanSchema)) body: TriggerScanDto,
  ) {
    return this.asmService.triggerDomainScan(auth, id, body.templateSlug);
  }

  // ── Assets ─────────────────────────────────────────────────────────────────

  @Get('assets')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'domainId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['hostname', 'type', 'riskScore', 'firstSeen', 'lastSeen'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({
    description: 'List of ASM assets',
    type: AsmAssetListResponseDto,
  })
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
  @ApiOkResponse({
    description: 'Single ASM asset',
    type: AsmAssetDto,
  })
  async getAsset(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.asmService.getAsset(auth, id);
  }

  @Post('assets/:id/scan')
  @ApiCreatedResponse({
    description: 'Asset scan triggered',
    type: AsmScanTriggerResponseDto,
  })
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
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['running', 'completed', 'failed', 'timed_out'],
  })
  @ApiQuery({ name: 'domainId', required: false, type: String })
  @ApiOkResponse({
    description: 'List of ASM scans',
    type: AsmScanListResponseDto,
  })
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
  @ApiOkResponse({
    description: 'ASM dashboard statistics',
    type: AsmDashboardStatsDto,
  })
  async getDashboardStats(@CurrentAuth() auth: AuthContext) {
    return this.asmService.getDashboardStats(auth);
  }
}
