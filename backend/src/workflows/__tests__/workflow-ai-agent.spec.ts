import { describe, expect, it, vi } from 'bun:test';

import '@shipsec/studio-worker/components';

import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { compileWorkflowGraph } from '../../dsl/compiler';
import type { WorkflowDefinition } from '../../dsl/types';
import { WorkflowsService } from '../workflows.service';
import type { WorkflowRepository } from '../repository/workflow.repository';
import type { AuthContext } from '../../auth/types';

const workflowId = 'd177b3c0-644e-40f0-8aa2-7b4f2c13a3af';
const now = new Date();

const authContext: AuthContext = {
  userId: 'agent-user',
  organizationId: 'agent-org',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const workflowGraph = WorkflowGraphSchema.parse({
  id: workflowId,
  name: 'AI Agent with Gemini routing',
  description: 'Manual prompt to Gemini, forward to LangGraph-style agent, log response.',
  nodes: [
    {
      id: 'entry-point',
      type: 'core.workflow.entrypoint',
      position: { x: 0, y: 0 },
      data: {
        label: 'Entry Point',
        config: {
          runtimeInputs: [
            { id: 'userPrompt', label: 'User Prompt', type: 'text', required: true },
          ],
        },
      },
    },
    {
      id: 'gemini-provider',
      type: 'core.provider.gemini',
      position: { x: 320, y: 0 },
      data: {
        label: 'Gemini Provider',
        config: {
          model: 'gemini-2.5-flash',
          apiKey: 'secret:gemini-demo',
        },
      },
    },
    {
      id: 'agent-node',
      type: 'core.ai.agent',
      position: { x: 640, y: 160 },
      data: {
        label: 'AI Agent',
        config: {
          systemPrompt: 'Combine Gemini output with MCP knowledge.',
          temperature: 0.5,
          maxTokens: 1024,
          memorySize: 8,
          stepLimit: 4,
          userInput: '{{entry-point.userPrompt}}',
          chatModel: {
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            apiKeySecretId: 'secret:gemini-demo',
          },
        },
      },
    },
    {
      id: 'console-log',
      type: 'core.console.log',
      position: { x: 960, y: 160 },
      data: {
        label: 'Console Log',
        config: {
          label: 'Agent Output',
          data: '{{agent-node.responseText}}',
        },
      },
    },
  ],
  edges: [
    {
      id: 'manual-to-agent',
      source: 'entry-point',
      target: 'agent-node',
      sourceHandle: 'userPrompt',
      targetHandle: 'userInput',
    },
    {
      id: 'gemini-to-agent-model',
      source: 'gemini-provider',
      target: 'agent-node',
      sourceHandle: 'chatModel',
      targetHandle: 'chatModel',
    },
    {
      id: 'agent-to-console',
      source: 'agent-node',
      target: 'console-log',
      sourceHandle: 'responseText',
      targetHandle: 'data',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('Workflow d177b3c0-644e-40f0-8aa2-7b4f2c13a3af', () => {
  it('compiles the workflow graph into ordered actions', () => {
    const definition = compileWorkflowGraph(workflowGraph);

    expect(definition.entrypoint.ref).toBe('entry-point');
    expect(definition.actions.map((action) => action.ref)).toEqual([
      'entry-point',
      'gemini-provider',
      'agent-node',
      'console-log',
    ]);

    const geminiAction = definition.actions.find((action) => action.ref === 'gemini-provider');
    expect(geminiAction?.dependsOn).toEqual([]);

    const agentAction = definition.actions.find((action) => action.componentId === 'core.ai.agent');
    expect(agentAction?.dependsOn).toEqual(['entry-point', 'gemini-provider']);
    expect(agentAction?.inputMappings?.userInput).toEqual({
      sourceRef: 'entry-point',
      sourceHandle: 'userPrompt',
    });
    expect(agentAction?.inputMappings?.chatModel).toEqual({
      sourceRef: 'gemini-provider',
      sourceHandle: 'chatModel',
    });

    const consoleAction = definition.actions.find((action) => action.ref === 'console-log');
    expect(consoleAction?.dependsOn).toEqual(['agent-node']);
    expect(consoleAction?.inputMappings?.data).toEqual({
      sourceRef: 'agent-node',
      sourceHandle: 'responseText',
    });
  });

  it('commits the workflow via service and persists compiled definition', async () => {
    let savedDefinition: WorkflowDefinition | null = null;

    const repositoryMock: Partial<WorkflowRepository> = {
      async findById(id: string) {
        if (id !== workflowId) {
          return undefined;
        }
        return {
          id: workflowId,
          name: workflowGraph.name,
          description: workflowGraph.description ?? null,
          graph: workflowGraph,
          compiledDefinition: null,
          lastRun: null,
          runCount: 0,
          createdAt: now,
          updatedAt: now,
        } as any;
      },
      async saveCompiledDefinition(id: string, definition: WorkflowDefinition) {
        savedDefinition = definition;
        return {
          id,
          name: workflowGraph.name,
          description: workflowGraph.description ?? null,
          graph: workflowGraph,
          compiledDefinition: definition,
          lastRun: null,
          runCount: 0,
          createdAt: now,
          updatedAt: now,
        } as any;
      },
      async create() {
        throw new Error('Not implemented in test');
      },
      async update() {
        throw new Error('Not implemented in test');
      },
      async delete() {
        return;
      },
      async list() {
        return [];
      },
      async incrementRunCount() {
        return {
          id: workflowId,
          name: workflowGraph.name,
          description: workflowGraph.description ?? null,
          graph: workflowGraph,
          compiledDefinition: savedDefinition,
          lastRun: now,
          runCount: 1,
          createdAt: now,
          updatedAt: now,
        } as any;
      },
    };

    const runRepositoryMock = {
      async upsert() {
        return;
      },
      async findByRunId() {
        return undefined;
      },
    };

    const traceRepositoryMock = {
      async countByType() {
        return 0;
      },
    };

    const versionRecord = {
      id: 'version-1',
      workflowId,
      version: 1,
      graph: workflowGraph,
      compiledDefinition: null as WorkflowDefinition | null,
      createdAt: now,
    };

    const versionRepositoryMock = {
      async create() {
        return versionRecord;
      },
      async findLatestByWorkflowId(id: string) {
        return id === workflowId ? versionRecord : undefined;
      },
      async findById(id: string) {
        return id === versionRecord.id ? versionRecord : undefined;
      },
      async findByWorkflowAndVersion(input: { workflowId: string; version: number }) {
        return input.workflowId === workflowId && input.version === versionRecord.version
          ? versionRecord
          : undefined;
      },
      async setCompiledDefinition(id: string, definition: WorkflowDefinition) {
        if (id === versionRecord.id) {
          versionRecord.compiledDefinition = definition;
          return versionRecord;
        }
        return undefined;
      },
    };

    const workflowRoleRepositoryMock = {
      async upsert() {
        return;
      },
      async hasRole() {
        return false;
      },
    };

    const analyticsServiceMock = {
      trackWorkflowStarted: vi.fn(),
      trackWorkflowCompleted: vi.fn(),
      trackComponentExecuted: vi.fn(),
      trackApiCall: vi.fn(),
      track: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
    };

    const service = new WorkflowsService(
      repositoryMock as WorkflowRepository,
      workflowRoleRepositoryMock as any,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      {} as any,
      analyticsServiceMock as any,
    );

    const definition = await service.commit(workflowId, authContext);

    expect(savedDefinition).not.toBeNull();
    expect(savedDefinition!.actions.length).toBe(4);
    expect(definition.actions.find((action) => action.componentId === 'core.ai.agent')).toBeDefined();
  });
});
