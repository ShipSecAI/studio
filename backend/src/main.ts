import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  // Set global prefix for all routes
  app.setGlobalPrefix('api/v1');

  const httpAdapter = app.getHttpAdapter().getInstance();
  if (httpAdapter?.set) {
    httpAdapter.set('etag', false);
  }

  // Enable CORS for frontend
  app.enableCors({
    origin: [
      'http://localhost',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3211',
      'http://localhost:8090',
      'https://studio.shipsec.ai',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'x-organization-id'],
  });
  const port = Number(process.env.PORT ?? 3211);
  const host = process.env.HOST ?? '0.0.0.0';

  const config = new DocumentBuilder()
    .setTitle('ShipSec Studio API')
    .setDescription('ShipSec backend API')
    .setVersion('0.1.0')
    .addServer('/api/v1', 'API v1')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const cleaned = cleanupOpenApiDoc(document);
  SwaggerModule.setup('api/v1/docs', app, cleaned);

  await app.listen(port, host);
  console.log(`🚀 ShipSec backend listening on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap ShipSec backend', error);
  process.exit(1);
});
