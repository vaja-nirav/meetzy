import { Controller, Post, Body, Get, UseGuards, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RefreshTokenDto } from './dto/google-auth.dto';
import { UnifiedLoginDto } from './dto/unified-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('check-account')
  @ApiOperation({ summary: 'Check if an account exists by email or googleId' })
  async checkAccount(
    @Query('email') email?: string,
    @Query('googleId') googleId?: string,
  ) {
    return this.authService.checkAccountStatus(email, googleId);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Unified Login + Profile Setup',
    description:
      'Call 1 (login screen): send token_id only → returns isProfileComplete: false → redirect to profile setup.\n' +
      'Call 2 (setup screen): send token_id + display_name + gender + country_code → returns isProfileComplete: true → redirect to home.\n' +
      'Call 3 (returning user): send token_id only → returns isProfileComplete: true → redirect to home.',
  })
  async login(@Body() dto: UnifiedLoginDto) {
    return this.authService.unifiedLogin(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access + refresh tokens' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Log out user, invalidate access token, set status offline' })
  async logout(
    @CurrentUser() user: User,
    @Req() req: any,
  ) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    await this.authService.logout(token, user.id);
    return { success: true, message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: User) {
    return user;
  }
}
