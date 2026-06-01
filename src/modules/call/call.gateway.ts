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
import { CallService } from './call.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { SdpDto } from './dto/sdp.dto';
import { IceCandidateDto } from './dto/ice-candidate.dto';

@WebSocketGateway({ namespace: '/call', cors: { origin: '*' } })
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(CallGateway.name);

  constructor(
    private readonly callService: CallService,
    private readonly matchmakingService: MatchmakingService,
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
      // Join personal room so we can send targeted events
      await client.join(String(payload.sub));
      this.logger.log(`Call client connected: ${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  // FIX: Full cleanup when user closes app during a call
  async handleDisconnect(client: Socket) {
    if (!client.data.userId) return;
    const userId = client.data.userId as number;
    this.logger.log(`Call client disconnected: ${userId}`);

    const roomId = await this.matchmakingService.getUserRoom(userId);
    if (roomId) {
      const room = await this.matchmakingService.getRoom(roomId);
      if (room) {
        const otherId = room.userAId === userId ? room.userBId : room.userAId;
        // Notify partner — they should navigate to home screen
        this.server.to(String(otherId)).emit('call:ended', {
          by: userId,
          roomId,
          reason: 'partner_disconnected',
        });
      }
      // Save call duration
      try {
        await this.callService.endCall(roomId);
      } catch {
        // No DB record if both users left before call:ready was emitted
      }
      await this.matchmakingService.closeRoom(roomId);
    }
  }

  @SubscribeMessage('call:join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = client.data.userId as number;
    const room = await this.matchmakingService.getRoom(data.roomId);
    if (!room) return client.emit('call:error', { message: 'Room not found' });
    if (room.userAId !== userId && room.userBId !== userId) {
      return client.emit('call:error', { message: 'Not a member of this room' });
    }

    await client.join(data.roomId);

    const sockets = await this.server.in(data.roomId).fetchSockets();
    if (sockets.length === 2) {
      // Create DB record using Redis roomId as PK
      await this.callService.createCallRecord(data.roomId, room.userAId, room.userBId);


      // FIX: Tell each user their role — only userA creates the SDP offer
      // userB waits for the offer
      this.server.to(String(room.userAId)).emit('call:ready', {
        roomId: data.roomId,
        isInitiator: true,
      });
      this.server.to(String(room.userBId)).emit('call:ready', {
        roomId: data.roomId,
        isInitiator: false,
      });
    }
  }

  // FIX PRIORITY 2: SDP offer relay
  @SubscribeMessage('call:sdpOffer')
  handleSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SdpDto,
  ) {
    const { roomId, sdp } = dto;
    // Relay only to the other user — client.to() excludes the sender
    client.to(roomId).emit('call:sdpOffer', { from: client.data.userId, sdp });
  }

  // FIX PRIORITY 2: SDP answer relay
  @SubscribeMessage('call:sdpAnswer')
  handleSdpAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SdpDto,
  ) {
    const { roomId, sdp } = dto;
    client.to(roomId).emit('call:sdpAnswer', { from: client.data.userId, sdp });
  }

  // FIX PRIORITY 3: ICE candidate relay
  @SubscribeMessage('call:iceCandidate')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: IceCandidateDto,
  ) {
    const { roomId, candidate } = dto;
    client.to(roomId).emit('call:iceCandidate', { from: client.data.userId, candidate });
  }

  // FIX PRIORITY 5: Cut call — BOTH users go to home screen
  @SubscribeMessage('call:end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data;
    const userId = client.data.userId as number;

    // Notify the OTHER user — they navigate to home screen
    client.to(roomId).emit('call:ended', {
      by: userId,
      roomId,
      reason: 'ended_by_user',
    });

    // Save call duration to MySQL
    try {
      await this.callService.endCall(roomId);
    } catch {
      // No DB record if call ended before call:ready
    }

    await client.leave(roomId);
    await this.matchmakingService.closeRoom(roomId);

    // Confirm to the user who ended — they also navigate to home screen
    client.emit('call:ended', { by: userId, roomId, reason: 'ended_by_user' });
  }

  // FIX PRIORITY 4: Swipe right-to-left — swiping user rejoins queue, skipped user goes home
  @SubscribeMessage('call:skip')
  async handleSkip(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data;
    const userId = client.data.userId as number;

    // Notify skipped user — they go to HOME SCREEN (not back to queue)
    client.to(roomId).emit('call:skipped', {
      by: userId,
      roomId,
      message: 'Your partner skipped to the next user',
    });

    // Save partial call record
    try {
      await this.callService.endCall(roomId);
    } catch {}

    await client.leave(roomId);
    await this.matchmakingService.closeRoom(roomId);

    // Swiping user: confirm skip (Flutter will emit match:next on /matchmaking)
    client.emit('call:skipConfirmed', { roomId });
  }
}
