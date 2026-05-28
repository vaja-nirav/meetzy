import { ConfigService } from '@nestjs/config';

import { RedisModuleOptions } from '@nestjs-modules/ioredis';

export const getRedisConfig = (configService: ConfigService): RedisModuleOptions => ({
  type: 'single',
  options: {
    host: configService.get<string>('REDIS_HOST', 'localhost'),
    port: configService.get<number>('REDIS_PORT', 6379),
  },
});
