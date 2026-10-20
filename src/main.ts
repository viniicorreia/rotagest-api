import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  setupApp(app);
  const port = app.get(AppConfig).get('PORT');
  await app.listen(port);
  app.get(Logger).log(`RotaGest API ouvindo na porta ${port}`);
}

void bootstrap();
