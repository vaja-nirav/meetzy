import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

class CreditDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty()
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;
}

@ApiTags('Wallet')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get own wallet balance' })
  getBalance(@CurrentUser() user: User) {
    return this.walletService.getBalance(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get own transaction history' })
  getTransactions(
    @CurrentUser() user: User,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.walletService.getTransactions(user.id, +limit, +offset);
  }

  @Post('credit')
  @ApiOperation({ summary: 'Credit coins to a user wallet (admin)' })
  credit(@Body() dto: CreditDto) {
    return this.walletService.credit(Number(dto.userId), dto.amount, dto.reason);
  }
}
