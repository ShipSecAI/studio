import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { McpGatewayService } from '../mcp-gateway.service';
import { ToolRegistryService } from '../tool-registry.service';
import { NotFoundException } from '@nestjs/common';

describe('McpGatewayService Unit Tests', () => {
    let service: McpGatewayService;
    let toolRegistry: ToolRegistryService;
    let temporalService: any;
    let workflowRunRepository: any;
    let traceRepository: any;
    let mcpServersRepository: any;

    beforeEach(() => {
        toolRegistry = {
            getServerTools: jest.fn(),
            getToolsForRun: jest.fn().mockResolvedValue([]),
            getRunTools: jest.fn(),
            getToolCredentials: jest.fn(),
        } as any;
        temporalService = {} as any;
        workflowRunRepository = {
            findByRunId: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
        } as any;
        traceRepository = {
            createEvent: jest.fn(),
        } as any;
        mcpServersRepository = {
            findOne: jest.fn(),
        } as any;

        service = new McpGatewayService(
            toolRegistry,
            temporalService,
            workflowRunRepository,
            traceRepository,
            mcpServersRepository
        );
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getServerForRun', () => {
        it('returns a proxy server with correct tool naming', async () => {
            (toolRegistry.getToolsForRun as any).mockResolvedValue([
                {
                    nodeId: 'aws-node',
                    toolName: 'AWS',
                    type: 'mcp-server',
                    endpoint: 'http://localhost:8080',
                    status: 'ready',
                },
            ]);

            (toolRegistry.getServerTools as any).mockResolvedValue([
                { name: 'list_buckets', description: 'S3 list', inputSchema: { type: 'object' } },
            ]);

            const server = await service.getServerForRun('run-1', 'org-1', undefined, ['aws-node']);

            expect(server).toBeDefined();
            expect(toolRegistry.getToolsForRun).toHaveBeenCalledWith('run-1', ['aws-node']);
            expect(toolRegistry.getServerTools).toHaveBeenCalledWith('run-1', 'aws-node');
        });

        it('filters tools by allowedNodeIds (hierarchical)', async () => {
            (toolRegistry.getToolsForRun as any).mockResolvedValue([
                { nodeId: 'parent/child1', toolName: 'Child 1', type: 'mcp-server', endpoint: 'http://c1', status: 'ready' },
                { nodeId: 'parent/child2', toolName: 'Child 2', type: 'mcp-server', endpoint: 'http://c2', status: 'ready' },
            ]);

            (toolRegistry.getServerTools as any).mockResolvedValue([
                { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
            ]);

            const server = await service.getServerForRun('run-1', 'org-1', undefined, ['parent']);
            expect(server).toBeDefined();
            expect(toolRegistry.getToolsForRun).toHaveBeenCalledWith('run-1', ['parent']);
        });

        it('throws NotFoundException if run not found', async () => {
            (workflowRunRepository.findByRunId as any).mockResolvedValue(null);

            await expect(service.getServerForRun('non-existent', 'org-1')).rejects.toThrow(NotFoundException);
        });
    });
});
