import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GiftsService } from './gifts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Gifts')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get('list')
  @ApiOperation({ summary: 'List all available gift types with coin values' })
  getCatalog() {
    return this.giftsService.getCatalog();
  }

  @Get('history/:userId')
  @ApiOperation({ summary: 'Get gift history for a user' })
  getHistory(
    @Param('userId') userId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.giftsService.getHistory(Number(userId), +limit, +offset);
  }
}
