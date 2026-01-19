import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { WebhooksService } from './webhooks.service';
import { Public } from '../auth/public.decorator';

@ApiTags('webhooks')
@Controller('webhooks/inbound')
export class InboundWebhookController {
  private readonly logger = new Logger(InboundWebhookController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post(':path')
  @ApiOperation({
    summary: 'Receive inbound webhook',
    description:
      'Public endpoint for receiving webhook deliveries. No authentication required - security relies on the unguessable webhook path.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'delivered' },
        runId: { type: 'string', example: 'shipsec-run-123' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Webhook not found or inactive' })
  @ApiResponse({ status: 400, description: 'Invalid payload or parsing failed' })
  async receive(
    @Param('path') path: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    // Normalize headers (handle arrays)
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        normalizedHeaders[key] = value[0] ?? '';
      } else if (value !== undefined) {
        normalizedHeaders[key] = value;
      }
    }

    // Validate body is an object
    if (typeof body !== 'object' || body === null) {
      this.logger.warn(`Invalid webhook body type for path ${path}: ${typeof body}`);
      throw new BadRequestException('Webhook body must be a JSON object');
    }

    try {
      const result = await this.webhooksService.receiveWebhook(path, {
        body,
        headers: normalizedHeaders,
      });
      return result;
    } catch (error) {
      // Always return 200 to prevent retries, but log error
      this.logger.error(`Webhook processing failed for path ${path}: ${error}`);
      throw error;
    }
  }
}
