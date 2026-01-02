import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuthGuard } from '../auth/auth.guard';
import { WebhooksService } from './webhooks.service';
import {
  CreateWebhookRequestDto,
  UpdateWebhookRequestDto,
  TestWebhookScriptRequestDto,
  TestWebhookScriptResponseDto,
  WebhookConfigurationResponseDto,
  WebhookDeliveryResponseDto,
  RegeneratePathResponseDto,
  GetWebhookUrlResponseDto,
} from './dto/webhook.dto';

@ApiTags('webhooks')
@Controller('webhooks/configurations')
@UseGuards(AuthGuard)
export class WebhooksAdminController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List all webhook configurations' })
  @ApiOkResponse({ type: [WebhookConfigurationResponseDto] })
  async list(@CurrentAuth() auth: AuthContext) {
    return this.webhooksService.list(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a webhook configuration by ID' })
  @ApiOkResponse({ type: WebhookConfigurationResponseDto })
  async get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooksService.get(auth, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new webhook configuration' })
  @ApiOkResponse({ type: WebhookConfigurationResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateWebhookRequestDto.schema)) dto: CreateWebhookRequestDto,
  ) {
    return this.webhooksService.create(auth, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a webhook configuration' })
  @ApiOkResponse({ type: WebhookConfigurationResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWebhookRequestDto.schema)) dto: UpdateWebhookRequestDto,
  ) {
    return this.webhooksService.update(auth, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook configuration' })
  async delete(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    await this.webhooksService.delete(auth, id);
    return { success: true };
  }

  @Post(':id/regenerate-path')
  @ApiOperation({ summary: 'Regenerate webhook path (creates new URL)' })
  @ApiOkResponse({ type: RegeneratePathResponseDto })
  async regeneratePath(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooksService.regeneratePath(auth, id);
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'Get the webhook URL for a configuration' })
  @ApiOkResponse({ type: GetWebhookUrlResponseDto })
  async getUrl(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooksService.getUrl(auth, id);
  }

  @Post('test-script')
  @ApiOperation({ summary: 'Test a parsing script with sample data' })
  @ApiOkResponse({ type: TestWebhookScriptResponseDto })
  async testScript(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(TestWebhookScriptRequestDto.schema)) dto: TestWebhookScriptRequestDto,
  ) {
    return this.webhooksService.testParsingScript(auth, dto);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List delivery history for a webhook' })
  @ApiOkResponse({ type: [WebhookDeliveryResponseDto] })
  async listDeliveries(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.webhooksService.listDeliveries(auth, id);
  }

  @Get(':id/deliveries/:deliveryId')
  @ApiOperation({ summary: 'Get details of a specific delivery' })
  @ApiOkResponse({ type: WebhookDeliveryResponseDto })
  async getDelivery(@CurrentAuth() auth: AuthContext, @Param('deliveryId') deliveryId: string) {
    return this.webhooksService.getDelivery(auth, deliveryId);
  }
}
