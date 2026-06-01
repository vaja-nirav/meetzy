import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UnifiedLoginDto {
  @ApiProperty({ description: 'Google ID token from Google Sign-In SDK' })
  @IsString()
  @IsNotEmpty({ message: 'token_id is required' })
  token_id: string;

  @ApiPropertyOptional({ example: 'John Doe', minLength: 2, maxLength: 30 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  display_name?: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsEnum(['male', 'female', 'other'], { message: 'gender must be male, female or other' })
  gender?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  country_name?: string;

  @ApiPropertyOptional({ example: 'IN', description: '2-letter ISO country code' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country_code?: string;

  @ApiPropertyOptional({ example: 'nirav@gmail.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
