import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.service';
import { validateEnv } from './env';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
