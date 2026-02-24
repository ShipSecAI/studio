import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerScheduleTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  if (!deps.schedulesService) return;

  const { schedulesService } = deps;

  server.registerTool(
    'list_schedules',
    {
      description:
        'List all workflow schedules in the organization. Optionally filter by workflow ID.',
      inputSchema: {
        workflowId: z
          .string()
          .uuid()
          .optional()
          .describe('Optional workflow ID to filter schedules by'),
      },
    },
    async (args: { workflowId?: string }) => {
      const gate = checkPermission(auth, 'schedules.list');
      if (!gate.allowed) return gate.error;
      try {
        const filters = args.workflowId ? { workflowId: args.workflowId } : undefined;
        const schedules = await schedulesService.list(auth, filters);
        return jsonResult(schedules);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_schedule',
    {
      description: 'Get detailed information about a specific schedule.',
      inputSchema: {
        scheduleId: z.string().describe('ID of the schedule to retrieve'),
      },
    },
    async (args: { scheduleId: string }) => {
      const gate = checkPermission(auth, 'schedules.read');
      if (!gate.allowed) return gate.error;
      try {
        const schedule = await schedulesService.get(auth, args.scheduleId);
        return jsonResult(schedule);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_schedule',
    {
      description:
        'Create a cron schedule that automatically triggers a workflow on a recurring basis.',
      inputSchema: {
        workflowId: z.string().uuid().describe('ID of the workflow to schedule'),
        name: z.string().describe('Display name for the schedule'),
        cronExpression: z
          .string()
          .describe(
            'Cron expression defining the schedule (e.g. "0 9 * * 1" for every Monday at 9am)',
          ),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional workflow input values to pass on each triggered run'),
        timezone: z
          .string()
          .optional()
          .describe(
            'IANA timezone for interpreting the cron expression (e.g. "America/New_York"). Defaults to UTC.',
          ),
        description: z.string().optional().describe('Optional description of the schedule'),
      },
    },
    async (args: {
      workflowId: string;
      name: string;
      cronExpression: string;
      inputs?: Record<string, unknown>;
      timezone?: string;
      description?: string;
    }) => {
      const gate = checkPermission(auth, 'schedules.create');
      if (!gate.allowed) return gate.error;
      try {
        const dto = {
          workflowId: args.workflowId,
          name: args.name,
          cronExpression: args.cronExpression,
          timezone: args.timezone ?? 'UTC',
          description: args.description,
          inputPayload: {
            runtimeInputs: args.inputs ?? {},
            nodeOverrides: {},
          },
        };
        const schedule = await schedulesService.create(auth, dto);
        return jsonResult(schedule);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_schedule',
    {
      description: 'Update an existing schedule. Only provided fields are changed.',
      inputSchema: {
        scheduleId: z.string().describe('ID of the schedule to update'),
        name: z.string().optional().describe('New display name'),
        cronExpression: z.string().optional().describe('New cron expression'),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('New workflow input values to pass on each triggered run'),
        timezone: z.string().optional().describe('New IANA timezone'),
        description: z.string().optional().describe('New description'),
      },
    },
    async (args: {
      scheduleId: string;
      name?: string;
      cronExpression?: string;
      inputs?: Record<string, unknown>;
      timezone?: string;
      description?: string;
    }) => {
      const gate = checkPermission(auth, 'schedules.update');
      if (!gate.allowed) return gate.error;
      try {
        const dto: Record<string, unknown> = {};
        if (args.name !== undefined) dto.name = args.name;
        if (args.cronExpression !== undefined) dto.cronExpression = args.cronExpression;
        if (args.inputs !== undefined) {
          dto.inputPayload = { runtimeInputs: args.inputs, nodeOverrides: {} };
        }
        if (args.timezone !== undefined) dto.timezone = args.timezone;
        if (args.description !== undefined) dto.description = args.description;
        const schedule = await schedulesService.update(auth, args.scheduleId, dto);
        return jsonResult(schedule);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_schedule',
    {
      description: 'Permanently delete a schedule. The associated workflow is not affected.',
      inputSchema: {
        scheduleId: z.string().describe('ID of the schedule to delete'),
      },
    },
    async (args: { scheduleId: string }) => {
      const gate = checkPermission(auth, 'schedules.delete');
      if (!gate.allowed) return gate.error;
      try {
        await schedulesService.delete(auth, args.scheduleId);
        return jsonResult({ deleted: true, scheduleId: args.scheduleId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'pause_schedule',
    {
      description:
        'Pause a schedule so it stops triggering runs. Use resume_schedule to re-enable it.',
      inputSchema: {
        scheduleId: z.string().describe('ID of the schedule to pause'),
      },
    },
    async (args: { scheduleId: string }) => {
      const gate = checkPermission(auth, 'schedules.update');
      if (!gate.allowed) return gate.error;
      try {
        const schedule = await schedulesService.pause(auth, args.scheduleId);
        return jsonResult(schedule);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'resume_schedule',
    {
      description: 'Resume a paused schedule so it resumes triggering runs on its cron cadence.',
      inputSchema: {
        scheduleId: z.string().describe('ID of the schedule to resume'),
      },
    },
    async (args: { scheduleId: string }) => {
      const gate = checkPermission(auth, 'schedules.update');
      if (!gate.allowed) return gate.error;
      try {
        const schedule = await schedulesService.resume(auth, args.scheduleId);
        return jsonResult(schedule);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'trigger_schedule',
    {
      description: 'Immediately trigger a scheduled workflow run outside its normal cron cadence.',
      inputSchema: {
        scheduleId: z.string().describe('ID of the schedule to trigger immediately'),
      },
    },
    async (args: { scheduleId: string }) => {
      const gate = checkPermission(auth, 'schedules.update');
      if (!gate.allowed) return gate.error;
      try {
        await schedulesService.trigger(auth, args.scheduleId);
        return jsonResult({ triggered: true, scheduleId: args.scheduleId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
