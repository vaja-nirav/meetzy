import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CallService } from './call.service';
import { CallGateway } from './call.gateway';
import { CallRoom } from './entities/call-room.entity';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallRoom]),
    MatchmakingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET', 'change_me'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [CallService, CallGateway],
  exports: [CallService],
})
export class CallModule {}
