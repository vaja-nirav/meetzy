import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';

export const getJwtConfig = (configService: ConfigService): JwtModuleOptions => ({
  secret: configService.get<string>('JWT_SECRET', 'change_me'),
  signOptions: {
    expiresIn: configService.get('JWT_EXPIRES_IN', '7d') as any,
  },
});
