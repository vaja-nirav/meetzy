import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '../entities/user.entity';

export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Short bio — emoji welcome' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bio?: string;

  @ApiPropertyOptional({ description: 'Profile photo URL (from CDN/Firebase Storage)' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ enum: Gender, description: 'Gender (locked once set to male/female)' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: 'Country ID from GET /countries' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  countryId?: number;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  countryName?: string;

  @ApiPropertyOptional({ example: 'IN', description: '2-letter ISO country code' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Photo URL to ADD to the gallery (max 6)' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ type: [String], description: 'List of photo URLs to REPLACE the gallery with (max 6)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  urls?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fcmToken?: string;
}
