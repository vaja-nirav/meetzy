import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { User } from '../users/entities/user.entity';

// Helper to save uploaded file and return its relative path
function saveUploadedFile(file: Express.Multer.File): string {
  const uploadDir = join(process.cwd(), 'public', 'uploads');
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  const fileExt = extname(file.originalname) || '.png';
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;
  const filePath = join(uploadDir, fileName);

  writeFileSync(filePath, file.buffer);

  return `/uploads/${fileName}`;
}

class ReportUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

@ApiTags('Profile')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('profile')
@UseInterceptors(AnyFilesInterceptor())
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own full profile with wallet balance' })
  getMe(@CurrentUser() user: User, @Req() req: any) {
    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;
    return this.profileService.getOwnProfile(user.id, baseUrl);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile (gender cannot be changed once set)' })
  async updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
  ) {
    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;

    if (files && files.length > 0) {
      const urlsFiles = files.filter(f => f.fieldname === 'urls');
      const photoUrlFile = files.find(f => f.fieldname === 'photoUrl');

      if (photoUrlFile) {
        dto.photoUrl = saveUploadedFile(photoUrlFile);
      }

      if (urlsFiles.length > 0) {
        const uploadedUrls = urlsFiles.map(f => saveUploadedFile(f));
        dto.urls = uploadedUrls;
      }
    }

    return this.profileService.updateProfile(user.id, dto, baseUrl);
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
