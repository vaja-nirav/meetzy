import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { User } from '../users/entities/user.entity';
import { CallRoom } from '../call/entities/call-room.entity';
import { PurchasedCoin } from '../wallet/entities/wallet.entity';
import { UsedCoin } from '../wallet/entities/transaction.entity';
import { Country } from '../countries/entities/country.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, CallRoom, PurchasedCoin, UsedCoin, Country]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('ADMIN_JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
