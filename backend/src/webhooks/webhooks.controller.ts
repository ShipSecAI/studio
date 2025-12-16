import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkflowsService } from '../workflows/workflows.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { WebhookRunWorkflowDto, WebhookRunWorkflowSchema } from './dto/webhook.dto';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(AuthGuard)
export class WebhooksController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  @Get('workflows')
  async listWorkflows(@CurrentAuth() auth: AuthContext) {
    await this.checkPermission(auth, 'workflows', 'list');
    
    // List workflows using existing service but filter/map as needed
    // Assuming list returns standard internal format
    return this.workflowsService.list(auth);
  }

  @Get('workflows/:id')
  async getWorkflow(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    await this.checkPermission(auth, 'workflows', 'read');
    return this.workflowsService.findById(id, auth);
  }

  @Post('workflows/:id/run')
  async runWorkflow(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WebhookRunWorkflowSchema)) body: WebhookRunWorkflowDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    await this.checkPermission(auth, 'workflows', 'run');

    // Idempotency key extraction
    const idempotencyKey = 
      (headers['x-idempotency-key'] as string) || 
      (headers['idempotency-key'] as string);

    // Prepare run payload
    const prepared = await this.workflowsService.prepareRunPayload(
      id,
      {
        inputs: body.inputs ?? {},
        versionId: body.versionId,
        version: body.version,
      },
      auth,
      { 
        idempotencyKey,
        trigger: {
          type: 'api',
          sourceId: 'webhook', // or api key ID if we had it easily available
          label: 'Webhook Invocation',
        }
      },
    );

    return this.workflowsService.startPreparedRun(prepared);
  }

  @Get('runs/:runId/status')
  async getRunStatus(@CurrentAuth() auth: AuthContext, @Param('runId') runId: string) {
    await this.checkPermission(auth, 'runs', 'read');
    // Using simple getRunStatus which delegates to Temporal
    return this.workflowsService.getRunStatus(runId, undefined, auth);
  }

  @Get('runs/:runId/result')
  async getRunResult(@CurrentAuth() auth: AuthContext, @Param('runId') runId: string) {
    await this.checkPermission(auth, 'runs', 'read');
    const result = await this.workflowsService.getRunResult(runId, undefined, auth);
    return { runId, result };
  }

  @Post('runs/:runId/cancel')
  async cancelRun(@CurrentAuth() auth: AuthContext, @Param('runId') runId: string) {
    await this.checkPermission(auth, 'runs', 'cancel');
    await this.workflowsService.cancelRun(runId, undefined, auth);
    return { status: 'cancelled', runId };
  }

  async checkPermission(auth: AuthContext, resource: keyof import('../database/schema/api-keys').ApiKeyPermissions, action: string) {
    if (auth.provider !== 'api-key') {
      return;
    }

    if (!auth.userId) {
       throw new ForbiddenException('Invalid API key context');
    }

    try {
      const apiKey = await this.apiKeysService.get(auth, auth.userId);
      // Force type casting to access dynamic property safely
      const permissions = apiKey.permissions as unknown as Record<string, Record<string, boolean>>;
      
      const resourcePerms = permissions[String(resource)];
      if (!resourcePerms || !resourcePerms[action]) {
        throw new ForbiddenException(`API key missing permission: ${String(resource)}.${action}`);
      }
    } catch (error) {
       if (error instanceof ForbiddenException) throw error;
       throw new ForbiddenException('Failed to validate API key permissions');
    }
  }
}
