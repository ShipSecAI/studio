import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { Response } from 'express';

import type { TestingWebhookRecord } from './testing-webhook.service';
import { TestingWebhookService } from './testing-webhook.service';

@Controller('testing/webhooks')
export class TestingWebhookController {
  constructor(
    @Inject(TestingWebhookService)
    private readonly service: TestingWebhookService,
  ) {}

  @Post()
  async acceptWebhook(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[]>,
    @Req() request: Request,
    @Query('status') statusParam: string | undefined,
    @Query('delayMs') delayParam: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ id: string; receivedAt: string }> {
    const id = randomUUID();
    const receivedAt = new Date().toISOString();

    const normalizedHeaders = Object.entries(headers).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        acc[key] = Array.isArray(value) ? value.join(', ') : value;
        return acc;
      },
      {},
    );

    const normalizedQuery = Object.entries(request.query).reduce<
      Record<string, string | string[]>
    >((acc, [key, raw]) => {
      if (Array.isArray(raw)) {
        acc[key] = raw.map((item) =>
          typeof item === 'string' ? item : JSON.stringify(item),
        );
        return acc;
      }
      if (typeof raw === 'string') {
        acc[key] = raw;
        return acc;
      }
      if (raw === undefined || raw === null) {
        acc[key] = '';
        return acc;
      }
      acc[key] = JSON.stringify(raw);
      return acc;
    }, {});

    const record: TestingWebhookRecord = {
      id,
      method: request.method,
      path: request.path,
      query: normalizedQuery,
      headers: normalizedHeaders,
      body,
      receivedAt,
    };

    this.service.record(record);

    const status = (() => {
      const parsed = Number.parseInt(statusParam ?? '', 10);
      if (Number.isNaN(parsed) || parsed < 100 || parsed > 599) {
        return 201;
      }
      return parsed;
    })();

    const delayMs = (() => {
      const parsed = Number.parseInt(delayParam ?? '', 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return 0;
      }
      return Math.min(parsed, 60_000);
    })();

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    response.status(status);

    return { id, receivedAt };
  }

  @Get()
  listRecords(): TestingWebhookRecord[] {
    return this.service.list();
  }

  @Get('latest')
  latestRecord(): TestingWebhookRecord {
    const latest = this.service.latest();
    if (!latest) {
      throw new NotFoundException('No webhook calls recorded yet');
    }
    return latest;
  }

  @Get(':id')
  getRecord(@Param('id') id: string): TestingWebhookRecord {
    const record = this.service.list().find((item) => item.id === id);
    if (!record) {
      throw new NotFoundException(`Webhook call ${id} not found`);
    }
    return record;
  }

  @Delete()
  clearRecords(): { cleared: number } {
    const count = this.service.list().length;
    this.service.clear();
    return { cleared: count };
  }
}
