import { Global, Module } from '@nestjs/common';
import { TenantResolver } from './tenant/tenant-resolver.service';

@Global()
@Module({ providers: [TenantResolver], exports: [TenantResolver] })
export class CommonModule {}
