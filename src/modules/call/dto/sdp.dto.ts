import { IsNotEmpty, IsString } from 'class-validator';

export class SdpDto {
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsNotEmpty()
  sdp: RTCSessionDescriptionInit;
}
