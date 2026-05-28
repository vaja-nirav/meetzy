import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
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
      this.logger.log(`Chat client connected: ${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (client.data.userId) {
      this.logger.log(`Chat client disconnected: ${client.data.userId}`);
    }
  }

  @SubscribeMessage('chat:sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SendMessageDto,
  ) {
    const senderId = client.data.userId as number;
    if (!senderId) return;

    const message = await this.chatService.saveMessage({
      senderId,
      receiverId: Number(dto.receiverId),
      roomId: dto.roomId,
      content: dto.content,
      messageType: dto.messageType,
    });

    this.server.to(String(dto.receiverId)).emit('chat:message', message);
    client.emit('chat:delivered', { messageId: message.id, createdAt: message.createdAt });
  }

  @SubscribeMessage('chat:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; receiverId: string },
  ) {
    const senderId = client.data.userId as number;
    if (!senderId) return;
    this.server.to(String(data.receiverId)).emit('chat:typing', { from: senderId, roomId: data.roomId });
  }

  @SubscribeMessage('chat:seen')
  async handleSeen(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; senderId: string },
  ) {
    await this.chatService.markAsRead(data.messageId);
    this.server.to(String(data.senderId)).emit('chat:seen', { messageId: data.messageId });
  }
}
