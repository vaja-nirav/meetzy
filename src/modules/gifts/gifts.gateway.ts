import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GiftsService, GIFT_CATALOG } from './gifts.service';

@WebSocketGateway({ namespace: '/gifts', cors: { origin: '*' } })
export class GiftsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(GiftsGateway.name);

  constructor(
    private readonly giftsService: GiftsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('No token');
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET', 'change_me'),
      });
      client.data.userId = Number(payload.sub);
      await client.join(String(payload.sub));
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  @SubscribeMessage('gift:send')
  async handleSendGift(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; receiverId: string; giftType: string },
  ) {
    const senderId = client.data.userId as number;
    if (!senderId) return;

    try {
      const gift = await this.giftsService.sendGift(
        senderId,
        Number(data.receiverId),
        data.roomId,
        data.giftType,
      );
      const giftDef = GIFT_CATALOG.find((g) => g.id === data.giftType);

      this.server.to(String(data.receiverId)).emit('gift:received', {
        gift,
        animation: giftDef?.animation,
        emoji: giftDef?.emoji,
        from: senderId,
      });
      client.emit('gift:sent', { gift });
    } catch (err: any) {
      client.emit('gift:error', { message: err.message });
    }
  }
}
