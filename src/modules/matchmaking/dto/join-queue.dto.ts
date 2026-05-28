import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Gender } from '../../users/entities/user.entity';

export class JoinQueueDto {
  @IsOptional()
  @IsEnum(Gender)
  preferredGender?: Gender;

  @IsOptional()
  @IsString()
  country?: string;
}
