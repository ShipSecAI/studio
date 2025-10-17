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

  const config = new DocumentBuilder()
    .setTitle('ShipSec Studio API')
    .setDescription('ShipSec backend API specification')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const cleaned = cleanupOpenApiDoc(document);
  const outputPath = join(__dirname, '..', 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(cleaned, null, 2));
  await app.close();
}

generateOpenApi().catch((error) => {
  console.error('Failed to generate OpenAPI spec', error);
  process.exit(1);
});
