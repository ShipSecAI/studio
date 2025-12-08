import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Client as MinioClient } from 'minio';
import { randomUUID } from 'node:crypto';
import { 
  WorkflowGraphDto, 
  WorkflowGraphSchema,
  WorkflowResponseDto,
  WorkflowNodeDto
} from '../workflows/dto/workflow-graph.dto';
import { WorkflowDefinition } from '../dsl/types';
import { UploadedFile } from '../storage/storage.service';

const runIntegration = process.env.RUN_BACKEND_INTEGRATION === 'true';

const baseUrl =
  process.env.BACKEND_BASE_URL ??
  `http://localhost:${process.env.BACKEND_PORT ?? process.env.PORT ?? '3211'}`;

const api = (path: string) => `${baseUrl}${path}`;

const normalizeNode = (override: Partial<WorkflowNodeDto> = {}): WorkflowNodeDto => ({
  id: override.id ?? 'node-1',
  type: override.type ?? 'core.workflow.entrypoint',
  position: override.position ?? { x: 0, y: 0 },
  data: {
    label: override.data?.label ?? 'Entry Point',
    config: override.data?.config ?? {},
  },
});

type WorkflowGraphOverrides = Partial<Omit<WorkflowGraphDto, 'nodes'>> & {
  nodes?: Array<Partial<WorkflowNodeDto>>;
};

const buildWorkflowGraph = (overrides: WorkflowGraphOverrides = {}): WorkflowGraphDto => {
  const baseGraph: WorkflowGraphDto = {
    name: overrides.name ?? `Test Workflow ${randomUUID().slice(0, 8)}`,
    description: overrides.description ?? 'Integration test workflow',
    nodes: (overrides.nodes ?? [normalizeNode()]).map((node) => normalizeNode(node)),
    edges: overrides.edges ?? [],
    viewport: overrides.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
  
  // Validate with Zod schema to ensure correct structure
  return WorkflowGraphSchema.parse(baseGraph);
};

const readJson = async <T>(response: Response): Promise<T> =>
  (await response.json()) as T;

interface Component {
  id: string;
  slug: string;
  name: string;
  version: string;
  type: string;
  category: string;
  description: string;
  documentation: string;
  documentationUrl: string | null;
  icon: string | null;
  logo: string | null;
  author: {
    name: string;
    type: 'shipsecai' | 'community';
    url: string | null;
  } | null;
  isLatest: boolean;
  deprecated: boolean;
  example: string | null;
  runner: {
    kind: 'inline' | 'docker' | 'remote';
    image: string | null;
    command: string[] | null;
  };
  inputs: Array<{
    id: string;
    label: string;
    dataType: Record<string, unknown>;
    required: boolean;
    description: string | null;
    valuePriority?: 'manual-first' | 'connection-first';
  }>;
  outputs: Array<{
    id: string;
    label: string;
    dataType: Record<string, unknown>;
    description: string | null;
  }>;
  parameters: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multi-select' | 'json' | 'secret';
    required: boolean;
    default: any;
    placeholder: string | null;
    description: string | null;
    helpText: string | null;
    options: Array<{
      label: string;
      value: any;
    }> | null;
    min: number | null;
    max: number | null;
    rows: number | null;
  }>;
  examples: string[];
}

(runIntegration ? describe : describe.skip)('Backend Integration Tests', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let minioClient: MinioClient;
  const testBucket = process.env.MINIO_BUCKET_NAME || 'shipsec-files';

  beforeAll(async () => {
    console.log('🚀 Starting backend integration test setup...');

    // Create NestJS test application
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Initialize database connection for cleanup
    const connectionString =
      process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';
    pool = new Pool({ connectionString });
    db = drizzle(pool);

    // Initialize MinIO client
    minioClient = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    // Ensure test bucket exists
    const bucketExists = await minioClient.bucketExists(testBucket);
    if (!bucketExists) {
      await minioClient.makeBucket(testBucket, 'us-east-1');
    }

    console.log('✅ Backend integration test setup complete\n');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    console.log('✅ Backend integration test teardown complete');
  });

  beforeEach(async () => {
    // Clean up database tables before each test
    await db.execute(sql`DELETE FROM files`);
    await db.execute(sql`DELETE FROM workflows`);
  });

  describe('Health Check', () => {
    it('should list workflows (basic connectivity test)', async () => {
      const response = await fetch(api('/workflows'));
      expect(response.ok).toBe(true);
      const data = await readJson<WorkflowGraphDto[]>(response);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Workflow CRUD API', () => {
    it('should create a new workflow', async () => {
      const workflowData = buildWorkflowGraph({ name: 'Test Workflow' });

      const response = await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowData),
      });

      expect(response.ok).toBe(true);
      const workflow: WorkflowResponseDto = await readJson(response);
      expect(workflow).toHaveProperty('id');
      expect(workflow.name).toBe(workflowData.name);
      expect(workflow.description).toBe(workflowData.description);
      expect(workflow.graph.nodes[0].data).toEqual(workflowData.nodes[0].data);
    });

    it('should list all workflows', async () => {
      // Create test workflows
      await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWorkflowGraph({ name: 'Workflow 1' })),
      });
      await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWorkflowGraph({ name: 'Workflow 2' })),
      });

      const response = await fetch(api('/workflows'));
      expect(response.ok).toBe(true);
      const workflows: WorkflowResponseDto[] = await readJson(response);
      expect(Array.isArray(workflows)).toBe(true);
      expect(workflows.length).toBeGreaterThanOrEqual(2);
      workflows.forEach((w) => {
        expect(Array.isArray(w.graph.nodes)).toBe(true);
        expect(w.graph.nodes[0]).toHaveProperty('data');
      });
    });

    it('should get a workflow by id', async () => {
      // Create a workflow first
      const createResponse = await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWorkflowGraph({ name: 'Test Workflow' })),
      });
      const created: WorkflowResponseDto = await readJson(createResponse);

      // Get the workflow
      const response = await fetch(api(`/workflows/${created.id}`));
      expect(response.ok).toBe(true);
      const workflow: WorkflowResponseDto = await readJson(response);
      expect(workflow.id).toBe(created.id);
      expect(workflow.name).toBe('Test Workflow');
      expect(workflow.graph.nodes[0].data.label).toBe('Entry Point');
    });

    it('should update a workflow', async () => {
      // Create a workflow first
      const originalGraph = buildWorkflowGraph({
        name: 'Original Title',
        nodes: [{ id: 'node-update' }],
      });
      const createResponse = await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(originalGraph),
      });
      const created: WorkflowResponseDto = await readJson(createResponse);

      // Verify the workflow was created
      expect(created).toHaveProperty('id');
      expect(created.name).toBe('Original Title');

      const updatePayload = buildWorkflowGraph({
        name: 'Updated Title',
        description: 'Updated description',
        nodes: [
          {
            id: originalGraph.nodes[0].id,
            data: { label: 'Updated Trigger', config: { message: 'hello' } },
            position: { x: 42, y: 24 },
            type: originalGraph.nodes[0].type,
          },
        ],
      });

      const updateResponse = await fetch(api(`/workflows/${created.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      expect(updateResponse.ok).toBe(true);
      const updated: WorkflowResponseDto = await readJson(updateResponse);
      expect(updated.name).toBe('Updated Title');
      expect(updated.description).toBe('Updated description');
      expect(updated.graph.nodes[0].data.label).toBe('Updated Trigger');
      expect(updated.graph.nodes[0].data.config).toEqual({ message: 'hello' });
    });
  });

  describe('Workflow Commit API', () => {
    it('should commit a workflow definition', async () => {
      // Create a workflow first
      const createResponse = await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWorkflowGraph({ name: 'Commit Workflow' })),
      });
      const workflow: WorkflowResponseDto = await readJson(createResponse);

      const response = await fetch(api(`/workflows/${workflow.id}/commit`), {
        method: 'POST',
      });

      expect(response.ok).toBe(true);
      const compiled: WorkflowDefinition = await readJson(response);
      expect(compiled.title).toBe('Commit Workflow');
      expect(compiled.entrypoint.ref).toBe(workflow.graph.nodes[0].id);
      expect(Array.isArray(compiled.actions)).toBe(true);
      expect(compiled.actions[0].componentId).toBe(workflow.graph.nodes[0].type);
    });

    it('should fail to commit when workflow contains unknown components', async () => {
      const invalidGraph = buildWorkflowGraph({
        name: 'Invalid Component Workflow',
        nodes: [{ id: 'bad-node', type: 'non.existent.component' }],
      });

      const createResponse = await fetch(api('/workflows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidGraph),
      });
      const workflow: WorkflowResponseDto = await readJson(createResponse);

      const response = await fetch(api(`/workflows/${workflow.id}/commit`), {
        method: 'POST',
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('File Storage API', () => {
    it('should upload a file', async () => {
      const fileName = 'test-file.txt';
      const content = 'Test file content for integration test';
      const blob = new Blob([content], { type: 'text/plain' });

      const formData = new FormData();
      formData.append('file', blob, fileName);

      const response = await fetch(api('/files/upload'), {
        method: 'POST',
        body: formData,
      });

      expect(response.ok).toBe(true);
      const file: UploadedFile = await readJson(response);
      expect(file).toHaveProperty('id');
      expect(file.fileName).toBe(fileName);
      expect(file.mimeType).toBe('text/plain');
      expect(file.size).toBe(content.length);

      // Cleanup
      await minioClient.removeObject(testBucket, file.id);
    });

    it('should list uploaded files', async () => {
      // Upload a test file
      const blob = new Blob(['test content'], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', blob, 'test.txt');

      const uploadResponse = await fetch(api('/files/upload'), {
        method: 'POST',
        body: formData,
      });
      const uploadedFile: UploadedFile = await readJson(uploadResponse);

      // List files
      const response = await fetch(api('/files'));
      expect(response.ok).toBe(true);
      const files: UploadedFile[] = await readJson(response);
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => f.id === uploadedFile.id)).toBe(true);

      // Cleanup
      await minioClient.removeObject(testBucket, uploadedFile.id);
    });

    it('should download a file', async () => {
      // Upload a test file first
      const content = 'Test download content';
      const blob = new Blob([content], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', blob, 'download-test.txt');

      const uploadResponse = await fetch(api('/files/upload'), {
        method: 'POST',
        body: formData,
      });
      const uploadedFile: UploadedFile = await readJson(uploadResponse);

      // Download the file
      const response = await fetch(api(`/files/${uploadedFile.id}/download`));
      expect(response.ok).toBe(true);
      const downloadedContent = await response.text();
      expect(downloadedContent).toBe(content);

      // Cleanup
      await minioClient.removeObject(testBucket, uploadedFile.id);
    });

    it('should delete a file', async () => {
      // Upload a test file first
      const blob = new Blob(['test content'], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', blob, 'delete-test.txt');

      const uploadResponse = await fetch(api('/files/upload'), {
        method: 'POST',
        body: formData,
      });
      const uploadedFile: UploadedFile = await readJson(uploadResponse);

      // Delete the file
      const response = await fetch(api(`/files/${uploadedFile.id}`), {
        method: 'DELETE',
      });
      expect(response.ok).toBe(true);

      // Verify it's deleted
      const listResponse = await fetch(api('/files'));
      const files: UploadedFile[] = await readJson(listResponse);
      expect(files.some((f) => f.id === uploadedFile.id)).toBe(false);
    });
  });

  describe('Component Registry API', () => {
    it('should list all components', async () => {
      const response = await fetch(api('/components'));
      expect(response.ok).toBe(true);
      const components: Component[] = await readJson(response);
      expect(Array.isArray(components)).toBe(true);
      expect(components.length).toBeGreaterThanOrEqual(4); // We have at least 4 components registered
      
      // Check component structure
      const component = components[0];
      expect(component).toHaveProperty('id');
      expect(component).toHaveProperty('name');
      expect(component).toHaveProperty('description');
      expect(component).toHaveProperty('category');
    });

    it('should get a specific component by id', async () => {
      const response = await fetch(api('/components/core.workflow.entrypoint'));
      expect(response.ok).toBe(true);
      const component: Component = await readJson(response);
      expect(component.id).toBe('core.workflow.entrypoint');
      expect(component).toHaveProperty('name');
      expect(Array.isArray(component.inputs)).toBe(true);
      expect(Array.isArray(component.outputs)).toBe(true);
      expect(Array.isArray(component.parameters)).toBe(true);
    });

    it('should return 404 for non-existent component', async () => {
      const response = await fetch(api('/components/non.existent.component'));
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });
});
