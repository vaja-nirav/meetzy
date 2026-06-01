import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ThrottlerModule } from '@nestjs/throttler';
import appConfig from './config/app.config';
import { SnakeNamingStrategy } from './config/snake-naming.strategy';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { CallModule } from './modules/call/call.module';
import { ChatModule } from './modules/chat/chat.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { ProfileModule } from './modules/profile/profile.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CountriesModule } from './modules/countries/countries.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig], envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cs: ConfigService) => ({
        type: 'mysql',
        host: cs.get<string>('DB_HOST', 'localhost'),
        port: cs.get<number>('DB_PORT', 3306),
        username: cs.get<string>('DB_USERNAME', 'root'),
        password: cs.get<string>('DB_PASSWORD', ''),
        database: cs.get<string>('DB_NAME', 'meetzy_db'),
        autoLoadEntities: true,
        synchronize: cs.get<string>('NODE_ENV') !== 'production',
        namingStrategy: new SnakeNamingStrategy(),
        charset: 'utf8mb4',
        timezone: '+00:00',
      }),
      inject: [ConfigService],
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cs: ConfigService) => ({
        type: 'single' as const,
        options: {
          host: cs.get<string>('REDIS_HOST', 'localhost'),
          port: cs.get<number>('REDIS_PORT', 6379),
          // Stop retrying after 3 attempts and silence the unhandled-error spam
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => (times > 5 ? null : Math.min(times * 500, 3000)),
          reconnectOnError: () => false,
        },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CountriesModule,
    AuthModule,
    UsersModule,
    MatchmakingModule,
    CallModule,
    ChatModule,
    WalletModule,
    GiftsModule,
    ProfileModule,
    NotificationsModule,
  ],
})
export class AppModule {}
