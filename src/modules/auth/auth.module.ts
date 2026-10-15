import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256', issuer: 'rotagest', audience: 'rotagest-web' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'rotagest', audience: 'rotagest-web' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService],
  exports: [AuthService, PasswordService, SessionService],
})
export class AuthModule {}
