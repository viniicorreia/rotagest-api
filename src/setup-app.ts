import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { AppConfig } from './config/app-config.service';

/** Configuração HTTP compartilhada entre main.ts e os testes e2e. */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfig);
  const express = app.getHttpAdapter().getInstance() as Express;
  if (config.get('TRUST_PROXY')) express.set('trust proxy', 1);
  express.disable('x-powered-by');

  // Todas as rotas ficam em /api/v1/... (versionamento por URI).
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  if (!config.isProduction || config.get('SWAGGER_ENABLED')) {
    // UI em /api/docs e contrato JSON em /api/docs-json (usado pelo rotagest-web para gerar tipos).
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
  }
}

export function buildOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('RotaGest API')
      .setDescription(
        'API REST da plataforma RotaGest. Rotas privadas exigem Bearer token; a empresa ativa vem do token e é validada no servidor. ' +
          'O refresh token trafega apenas no cookie HttpOnly rg_refresh (Path=/api/v1/auth).',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
    { operationIdFactory: (controllerKey, methodKey) => `${controllerKey.replace(/Controller$/, '')}_${methodKey}` },
  );
}
