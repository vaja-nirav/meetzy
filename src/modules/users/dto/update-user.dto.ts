import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Gender } from '../entities/user.entity';

export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  display_name?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Short bio — emoji welcome' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bio?: string;

  @ApiPropertyOptional({ description: 'Profile photo URL (from CDN/Firebase Storage)' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  photo_url?: string;

  @ApiPropertyOptional({ enum: Gender, description: 'Gender (locked once set to male/female)' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: 'Country ID from GET /countries' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  countryId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  country_id?: number;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  countryName?: string;

  @IsOptional()
  @IsString()
  country_name?: string;

  @ApiPropertyOptional({ example: 'IN', description: '2-letter ISO country code' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  country_code?: string;

  @ApiPropertyOptional({ description: 'Photo URL to ADD to the gallery (max 6)' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ type: [String], description: 'List of photo URLs to REPLACE the gallery with (max 6)' })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return value.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return value;
  })
  @IsString({ each: true })
  cover_images?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fcmToken?: string;

  @IsOptional()
  @IsString()
  fcm_token?: string;
}
