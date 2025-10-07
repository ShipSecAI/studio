import { beforeEach, describe, expect, it } from 'bun:test';
import { Test } from '@nestjs/testing';

import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { WorkflowRepository } from '../repository/workflow.repository';
import { WorkflowsService } from '../workflows.service';

const sampleGraph = WorkflowGraphSchema.parse({
  name: 'Sample workflow',
  nodes: [
    {
      id: 'trigger',
      type: 'core.trigger.manual',
      label: 'Trigger',
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let createCalls = 0;
  const now = new Date().toISOString();

  const repositoryMock = {
    async create() {
      createCalls += 1;
      return {
        id: 'workflow-id',
        createdAt: now,
        updatedAt: now,
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
      };
    },
    async update() {
      return {
        id: 'workflow-id',
        createdAt: now,
        updatedAt: now,
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
      };
    },
    async findById() {
      return {
        id: 'workflow-id',
        createdAt: now,
        updatedAt: now,
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
      };
    },
    async delete() {
      return;
    },
    async list() {
      return [];
    },
  } as unknown as WorkflowRepository;

  beforeEach(async () => {
    createCalls = 0;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        {
          provide: WorkflowRepository,
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = moduleRef.get(WorkflowsService);
  });

  it('creates a workflow using the repository', async () => {
    const created = await service.create(sampleGraph);
    expect(created.id).toBe('workflow-id');
    expect(createCalls).toBe(1);
  });
});
