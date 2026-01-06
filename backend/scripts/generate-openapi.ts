import 'reflect-metadata';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

async function generateOpenApi() {
  // Skip ingest services that require external connections during OpenAPI generation
  process.env.SKIP_INGEST_SERVICES = 'true';
  process.env.SHIPSEC_SKIP_MIGRATION_CHECK = 'true';

  const { AppModule } = await import('../src/app.module');

  console.log('Creating Nest app...');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  console.log('Nest app created');

  // Set global prefix to match production
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('ShipSec Studio API')
    .setDescription('ShipSec backend API specification')
    .setVersion('0.1.0')
    .addServer('/api/v1', 'API v1')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  console.log('Document paths keys:', Object.keys(document.paths));
  const cleaned = cleanupOpenApiDoc(document);
  const repoRootSpecPath = join(__dirname, '..', '..', 'openapi.json');
  const payload = JSON.stringify(cleaned, null, 2);

  writeFileSync(repoRootSpecPath, payload);
  await app.close();
}

console.log('Script started');
generateOpenApi().then(() => console.log('Script finished successfully')).catch((error) => {
  console.error('Failed to generate OpenAPI spec', error);
  process.exit(1);
});
