import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { dbContextMiddleware } from '../common/tenant/db-context';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule implements NestModule {
  // Middleware de módulo roda depois dos body parsers, então o contexto não se perde no stream da requisição.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(dbContextMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
