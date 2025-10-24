import { describe, expect, it } from 'bun:test';

import '@shipsec/worker/components';

import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { compileWorkflowGraph } from '../../dsl/compiler';
import type { WorkflowDefinition } from '../../dsl/types';
import { WorkflowsService } from '../workflows.service';
import type { WorkflowRepository } from '../repository/workflow.repository';

const workflowId = 'd177b3c0-644e-40f0-8aa2-7b4f2c13a3af';
const now = new Date();

const workflowGraph = WorkflowGraphSchema.parse({
  id: workflowId,
  name: 'AI Agent with Gemini routing',
  description: 'Manual prompt to Gemini, forward to LangGraph-style agent, log response.',
  nodes: [
    {
      id: 'manual-trigger',
      type: 'core.trigger.manual',
      position: { x: 0, y: 0 },
      data: {
        label: 'Manual Trigger',
        config: {
          runtimeInputs: [
            { id: 'userPrompt', label: 'User Prompt', type: 'text', required: true },
          ],
        },
      },
    },
    {
      id: 'gemini-chat',
      type: 'core.gemini.chat',
      position: { x: 320, y: 0 },
      data: {
        label: 'Gemini Chat',
        config: {
          systemPrompt: 'Translate the request into a Gemini answer.',
          userPrompt: '{{inputs.userPrompt}}',
          model: 'gemini-2.5-flash',
          temperature: 0.7,
          maxTokens: 1024,
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
        },
      },
    },
  ],
  edges: [
    {
      id: 'manual-to-gemini',
      source: 'manual-trigger',
      target: 'gemini-chat',
      sourceHandle: 'userPrompt',
      targetHandle: 'userPrompt',
    },
    {
      id: 'gemini-to-agent-input',
      source: 'gemini-chat',
      target: 'agent-node',
      sourceHandle: 'responseText',
      targetHandle: 'userInput',
    },
    {
      id: 'gemini-to-agent-model',
      source: 'gemini-chat',
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

    expect(definition.entrypoint.ref).toBe('manual-trigger');
    expect(definition.actions.map((action) => action.ref)).toEqual([
      'manual-trigger',
      'gemini-chat',
      'agent-node',
      'console-log',
    ]);

    const geminiAction = definition.actions.find((action) => action.ref === 'gemini-chat');
    expect(geminiAction?.dependsOn).toEqual(['manual-trigger']);
    expect(geminiAction?.inputMappings?.userPrompt).toEqual({
      sourceRef: 'manual-trigger',
      sourceHandle: 'userPrompt',
    });

    const agentAction = definition.actions.find((action) => action.componentId === 'core.ai.agent');
    expect(agentAction?.dependsOn).toEqual(['gemini-chat']);
    expect(agentAction?.inputMappings?.userInput).toEqual({
      sourceRef: 'gemini-chat',
      sourceHandle: 'responseText',
    });
    expect(agentAction?.inputMappings?.chatModel).toEqual({
      sourceRef: 'gemini-chat',
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

    const service = new WorkflowsService(
      repositoryMock as WorkflowRepository,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      {} as any,
    );

    const definition = await service.commit(workflowId);

    expect(savedDefinition).not.toBeNull();
    expect(savedDefinition!.actions.length).toBe(4);
    expect(definition.actions.find((action) => action.componentId === 'core.ai.agent')).toBeDefined();
  });
});
