import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MosaicService } from './mosaic.service';
import { PeopleService } from './people.service';
import { AdminGuard } from './guards/admin.guard';
import { AppController } from '../app/app.controller';
import { User } from '../users/entities/user.entity';
import { CallRoom } from '../call/entities/call-room.entity';
import { PurchasedCoin } from '../wallet/entities/wallet.entity';
import { UsedCoin } from '../wallet/entities/transaction.entity';
import { Country } from '../countries/entities/country.entity';
import { LoginMosaic } from './entities/login-mosaic.entity';
import { PeopleProfile } from './entities/people-profile.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, CallRoom, PurchasedCoin, UsedCoin, Country, LoginMosaic, PeopleProfile]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('ADMIN_JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  // AppController hosts the public /app/* routes (no AdminGuard).
  controllers: [AdminController, AppController],
  providers: [AdminService, MosaicService, PeopleService, AdminGuard],
  exports: [MosaicService, PeopleService],
})
export class AdminModule {}
