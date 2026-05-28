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
import { MatchmakingService } from './matchmaking.service';
import { UsersService } from '../users/users.service';
import { JoinQueueDto } from './dto/join-queue.dto';

@WebSocketGateway({ namespace: '/matchmaking', cors: { origin: '*' } })
export class MatchmakingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(MatchmakingGateway.name);

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly usersService: UsersService,
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
      client.data.isVip = payload.isVip ?? false;

      await client.join(String(payload.sub));
      await this.usersService.setOnlineStatus(Number(payload.sub), true);
      this.logger.log(`Client connected: ${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (!client.data.userId) return;
    const userId = client.data.userId as number;

    await this.matchmakingService.removeFromQueue(userId);

    const roomId = await this.matchmakingService.getUserRoom(userId);
    if (roomId) {
      const room = await this.matchmakingService.getRoom(roomId);
      if (room) {
        const otherId = room.userAId === userId ? room.userBId : room.userAId;
        this.server.to(String(otherId)).emit('match:partnerLeft', { roomId });
      }
      await this.matchmakingService.closeRoom(roomId);
    }

    await this.usersService.setOnlineStatus(userId, false);
    this.logger.log(`Client disconnected: ${userId}`);
  }

  @SubscribeMessage('match:joinQueue')
  async handleJoinQueue(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: JoinQueueDto,
  ) {
    const userId = client.data.userId as number;
    if (!userId) return;

    const user = await this.usersService.findById(userId);
    if (!user) return;

    await this.matchmakingService.addToQueue({
      userId,
      gender: user.gender,
      country: user.country,
      isVip: user.isVip,
      socketId: client.id,
      joinedAt: Date.now(),
    });

    const match = await this.matchmakingService.findMatch(
      userId,
      dto.preferredGender,
      dto.country,
    );

    if (match) {
      const roomId = await this.matchmakingService.createRoom(userId, match.userId);

      this.server.to(String(userId)).emit('match:found', {
        roomId,
        partnerId: match.userId,
        iceServers: this.getIceServers(),
      });
      this.server.to(String(match.userId)).emit('match:found', {
        roomId,
        partnerId: userId,
        iceServers: this.getIceServers(),
      });
    } else {
      client.emit('match:waiting', { message: 'Looking for a match...' });
    }
  }

  @SubscribeMessage('match:leaveQueue')
  async handleLeaveQueue(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as number;
    if (!userId) return;
    await this.matchmakingService.removeFromQueue(userId);
    client.emit('match:left', { message: 'Left the queue' });
  }

  @SubscribeMessage('match:next')
  async handleNext(@ConnectedSocket() client: Socket, @MessageBody() dto: JoinQueueDto) {
    const userId = client.data.userId as number;
    if (!userId) return;

    const roomId = await this.matchmakingService.getUserRoom(userId);
    if (roomId) {
      const room = await this.matchmakingService.getRoom(roomId);
      if (room) {
        const otherId = room.userAId === userId ? room.userBId : room.userAId;
        this.server.to(String(otherId)).emit('match:partnerLeft', { roomId });
      }
      await this.matchmakingService.closeRoom(roomId);
    }

    await this.handleJoinQueue(client, dto);
  }

  private getIceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: this.configService.get<string>('COTURN_URL', 'turn:localhost:3478'),
        username: this.configService.get<string>('COTURN_USERNAME', 'meetzy'),
        credential: this.configService.get<string>('COTURN_PASSWORD', 'meetzy_turn_password'),
      },
    ];
  }
}
