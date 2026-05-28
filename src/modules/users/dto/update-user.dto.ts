import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fcmToken?: string;
}
