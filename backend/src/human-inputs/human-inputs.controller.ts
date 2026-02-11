import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { HumanInputsService } from './human-inputs.service';
import {
  ResolveHumanInputDto,
  ListHumanInputsQueryDto,
  HumanInputResponseDto,
  PublicResolveResultDto,
  ResolveByTokenDto,
} from './dto/human-inputs.dto';

@ApiTags('Human Inputs')
@Controller('human-inputs')
export class HumanInputsController {
  constructor(private readonly service: HumanInputsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'List human input requests' })
  @ApiResponse({ status: 200, type: [HumanInputResponseDto] })
  async list(@Query() query: ListHumanInputsQueryDto, @CurrentAuth() auth: AuthContext | null) {
    if (!auth || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.service.list(query, auth.organizationId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Get a human input request details' })
  @ApiResponse({ status: 200, type: HumanInputResponseDto })
  async get(@Param('id') id: string, @CurrentAuth() auth: AuthContext | null) {
    if (!auth || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.service.getById(id, auth.organizationId);
  }

  @Post(':id/resolve')
  @UseGuards(AuthGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Resolve a human input request' })
  @ApiResponse({ status: 200, type: HumanInputResponseDto })
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveHumanInputDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    if (!auth || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.service.resolve(id, dto, auth.organizationId);
  }

  // Public endpoints for resolving via token (no auth guard)
  @Post('resolve/:token')
  @ApiOperation({ summary: 'Resolve input via public token' })
  @ApiResponse({ status: 200, type: PublicResolveResultDto })
  async resolveByToken(@Param('token') token: string, @Body() body: ResolveByTokenDto) {
    return this.service.resolveByToken(token, body.action || 'resolve', body.data);
  }
}
