import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { CommonModule } from './common/common.module';
import { AUTH_THROTTLE } from './common/decorators';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { AppConfig } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { HealthController } from './modules/health/health.controller';
import { MetaController } from './modules/meta/meta.controller';
import { MailModule } from './modules/mail/mail.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BillingModule } from './modules/billing/billing.module';
import { PlatformModule } from './modules/platform/platform.module';
import { FinancialAccountsModule } from './modules/accounts/accounts.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ObligationsModule } from './modules/obligations/obligations.module';
import { PayablesModule } from './modules/payables/payables.module';
import { ReceivablesModule } from './modules/receivables/receivables.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { MileageModule } from './modules/mileage/mileage.module';
import { FleetCostsModule } from './modules/fleet-costs/fleet-costs.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ClosingsModule } from './modules/closings/closings.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { SupportAccessModule } from './modules/support-access/support-access.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Toda linha registrada durante a requisição leva o requestId (o mesmo do header x-request-id e das respostas de erro).
          customProps: (req) => ({ requestId: req.id }),
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.token', '*.refreshToken'],
            censor: '[redacted]',
          },
          // Sondas de saúde e scrape de métricas são frequentes: não poluem o log de acesso.
          autoLogging: { ignore: (req) => /^\/api\/v1\/(health(\/(live|ready))?|metrics)(\?|$)/.test(req.url ?? '') },
          transport: config.get('NODE_ENV') === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.get('RATE_LIMIT_DEFAULT') },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.get('RATE_LIMIT_AUTH'),
            // Só vale nas rotas marcadas com @AuthRateLimit().
            skipIf: (context) => !Reflect.getMetadata(AUTH_THROTTLE, context.getHandler()),
          },
        ],
      }),
    }),
    PrismaModule,
    CommonModule,
    AuditModule,
    MailModule,
    AuthModule,
    SubscriptionsModule,
    BillingModule,
    PlatformModule,
    CompaniesModule,
    MembershipsModule,
    // Fase 2 — Financeiro MVP
    TransactionsModule,
    CategoriesModule,
    FinancialAccountsModule,
    SettlementsModule,
    ObligationsModule,
    VehiclesModule,
    FleetModule,
    MileageModule,
    FleetCostsModule,
    ReportsModule,
    ClosingsModule,
    ContractsModule,
    PayablesModule,
    ReceivablesModule,
    AttachmentsModule,
    DashboardModule,
    // Fase 6 — produção
    MetricsModule,
    SupportAccessModule,
    PrivacyModule,
  ],
  controllers: [HealthController, MetaController],
  providers: [
    // Ordem importa: limite → autenticação → tenant → permissões.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
