import 'reflect-metadata';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from '../src/app.module';

async function generateOpenApi() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  // Set global prefix to match production
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('ShipSec Studio API')
    .setDescription('ShipSec backend API specification')
    .setVersion('0.1.0')
    .addServer('/api/v1', 'API v1')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const cleaned = cleanupOpenApiDoc(document);
  const backendSpecPath = join(__dirname, '..', 'openapi.json');
  const repoRootSpecPath = join(__dirname, '..', '..', 'openapi.json');
  const payload = JSON.stringify(cleaned, null, 2);

  writeFileSync(backendSpecPath, payload);
  writeFileSync(repoRootSpecPath, payload);
  await app.close();
}

generateOpenApi().catch((error) => {
  console.error('Failed to generate OpenAPI spec', error);
  process.exit(1);
});
