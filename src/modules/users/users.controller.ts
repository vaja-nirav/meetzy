import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { IsArray, IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

class AddPhotoDto {
  @ApiProperty({ description: 'Photo URL from Firebase Storage / Cloudinary / S3' })
  @IsString()
  @IsNotEmpty()
  url: string;
}

class AddPhotosBulkDto {
  @ApiProperty({ type: [String], description: 'List of photo URLs (max 6)' })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  urls: string[];
}

class ReorderPhotosDto {
  @ApiProperty({ type: [Number], description: 'Photo IDs in desired order (first = cover)' })
  @IsArray()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  orderedIds: number[];
}

@ApiTags('Users')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('active')
  @ApiOperation({
    summary: 'Get active/online users for radar',
    description: 'Returns online users with a target ratio of 80% Female / 20% Male, randomly rotated on each request.',
  })
  async getActiveUsers(
    @CurrentUser() user: User,
    @Query('gender') gender?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.usersService.findActiveUsers(
      user.id,
      gender || 'all',
      isNaN(parsedLimit) ? 20 : parsedLimit,
    );
  }

  @Get('online')
  @ApiOperation({ summary: 'Get count of online users' })
  async getOnlineCount() {
    const count = await this.usersService.countOnline();
    return { count };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: User) {
    return user;
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update own profile',
    description: 'Update displayName, bio, photoUrl, countryId. Gender is locked once set.',
  })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.id, dto);
  }

  // ─── Photos ────────────────────────────────────────────────────────

  @Get('me/photos')
  @ApiOperation({ summary: 'Get own photos (sorted, first = cover)' })
  getMyPhotos(@CurrentUser() user: User) {
    return this.usersService.getPhotos(user.id);
  }

  @Post('me/photos')
  @ApiOperation({ summary: 'Add a photo (max 6). Upload to CDN first, then send URL.' })
  addPhoto(@CurrentUser() user: User, @Body() dto: AddPhotoDto) {
    return this.usersService.addPhoto(user.id, dto.url);
  }

  @Post('me/photos/bulk')
  @ApiOperation({ summary: 'Add multiple photos at once (max 6 total)' })
  addPhotosBulk(@CurrentUser() user: User, @Body() dto: AddPhotosBulkDto) {
    return this.usersService.addPhotosBulk(user.id, dto.urls);
  }

  @Patch('me/photos')
  @ApiOperation({ summary: 'Update own photos grid (replace all existing with new list)' })
  updatePhotos(@CurrentUser() user: User, @Body() dto: AddPhotosBulkDto) {
    return this.usersService.updatePhotos(user.id, dto.urls);
  }

  @Delete('me/photos/:id')
  @ApiOperation({ summary: 'Delete a photo by ID' })
  deletePhoto(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) photoId: number,
  ) {
    return this.usersService.deletePhoto(user.id, photoId);
  }

  @Patch('me/photos/reorder')
  @ApiOperation({
    summary: 'Reorder photos — send array of photo IDs in desired order',
    description: 'First ID = cover photo shown on profile card',
  })
  reorderPhotos(@CurrentUser() user: User, @Body() dto: ReorderPhotosDto) {
    return this.usersService.reorderPhotos(user.id, dto.orderedIds);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  async getUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findById(id);
  }
}
