import { IsEnum, IsInt, IsNotEmpty, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '../../users/entities/user.entity';

export class SetupProfileDto {
  @ApiProperty({ example: 'Alex', minLength: 2, maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(20)
  displayName: string;

  @ApiProperty({ example: 101, description: 'Country ID from GET /countries' })
  @IsInt()
  @IsPositive()
  countryId: number;

  @ApiProperty({ enum: [Gender.MALE, Gender.FEMALE], description: 'Permanent — cannot be changed later' })
  @IsEnum([Gender.MALE, Gender.FEMALE], { message: 'Gender must be male or female' })
  gender: Gender.MALE | Gender.FEMALE;
}
