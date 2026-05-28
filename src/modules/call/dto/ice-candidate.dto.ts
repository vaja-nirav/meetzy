import { IsNotEmpty, IsString } from 'class-validator';

export class IceCandidateDto {
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsNotEmpty()
  candidate: RTCIceCandidateInit;
}
