import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { SetupProfileDto } from './dto/setup-profile.dto';
import { User } from '../users/entities/user.entity';

class ReportUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;
}

@ApiTags('Profile')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('setup')
  @ApiOperation({
    summary: 'Complete profile setup after first login',
    description: 'Call this when new user clicks "Get Started". Gender is permanent and cannot be changed later.',
  })
  setupProfile(@CurrentUser() user: User, @Body() dto: SetupProfileDto) {
    return this.profileService.setupProfile(user.id, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get own full profile with wallet balance' })
  getMe(@CurrentUser() user: User) {
    return this.profileService.getOwnProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile (gender cannot be changed once set)' })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return this.profileService.updateProfile(user.id, dto);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get public profile of any user' })
  getPublicProfile(@Param('userId') userId: string) {
    return this.profileService.getPublicProfile(Number(userId));
  }

  @Post('report/:userId')
  @ApiOperation({ summary: 'Report a user' })
  reportUser(
    @CurrentUser() user: User,
    @Param('userId') reportedId: string,
    @Body() dto: ReportUserDto,
  ) {
    return this.profileService.reportUser(user.id, Number(reportedId), dto.reason);
  }
}
