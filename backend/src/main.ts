import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { isVersionCheckDisabled, performVersionCheck } from './version-check';

import { AppModule } from './app.module';

async function bootstrap() {
  await enforceVersionCheck();
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  // Set global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'x-organization-id',
    ],
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

async function enforceVersionCheck() {
  if (isVersionCheckDisabled(process.env)) {
    console.warn('[version-check] Skipping version validation (disabled via env).');
    return;
  }

  try {
    const result = await performVersionCheck();
    const currentVersion =
      process.env.SHIPSEC_VERSION_CHECK_VERSION ?? result.response.min_supported_version;
    const latest = result.response.latest_version;

    if (result.outcome === 'unsupported') {
      console.error(
        `[version-check] Version ${currentVersion} is no longer supported. Latest available: ${latest}.`,
      );
      if (result.response.upgrade_url) {
        console.error(`[version-check] Upgrade URL: ${result.response.upgrade_url}`);
      }
      process.exit(1);
    }

    if (result.outcome === 'upgrade') {
      console.warn(
        `[version-check] Version ${latest} is available. You are running ${currentVersion}.`,
      );
      if (result.response.upgrade_url) {
        console.warn(`[version-check] Upgrade URL: ${result.response.upgrade_url}`);
      }
    } else if (result.outcome === 'ok') {
      console.log(`[version-check] Version ${currentVersion} is supported.`);
    }
  } catch (error) {
    console.warn(
      '[version-check] Failed to contact version service. Continuing without enforcement.',
      error,
    );
  }
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap ShipSec backend', error);
  process.exit(1);
});
