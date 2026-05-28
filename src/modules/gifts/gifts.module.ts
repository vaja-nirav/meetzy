import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GiftsService } from './gifts.service';
import { GiftsController } from './gifts.controller';
import { GiftsGateway } from './gifts.gateway';
import { Gift } from './entities/gift.entity';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Gift]),
    WalletModule,
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET', 'change_me'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [GiftsController],
  providers: [GiftsService, GiftsGateway],
  exports: [GiftsService],
})
export class GiftsModule {}
