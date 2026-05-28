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
  @WebSocketServer() server: Server;
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
      await client.join(String(payload.sub));
      this.logger.log(`Call client connected: ${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (!client.data.userId) return;
    this.logger.log(`Call client disconnected: ${client.data.userId}`);
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

    const membersInRoom = (await this.server.in(data.roomId).fetchSockets()).length;
    if (membersInRoom === 2) {
      await this.callService.createCallRecord(room.userAId, room.userBId);
      this.server.to(data.roomId).emit('call:ready', { roomId: data.roomId });
    }
  }

  @SubscribeMessage('call:sdpOffer')
  async handleSdpOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SdpDto,
  ) {
    const { roomId, sdp } = dto;
    client.to(roomId).emit('call:sdpOffer', { from: client.data.userId, sdp });
  }

  @SubscribeMessage('call:sdpAnswer')
  async handleSdpAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SdpDto,
  ) {
    const { roomId, sdp } = dto;
    client.to(roomId).emit('call:sdpAnswer', { from: client.data.userId, sdp });
  }

  @SubscribeMessage('call:iceCandidate')
  async handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: IceCandidateDto,
  ) {
    const { roomId, candidate } = dto;
    client.to(roomId).emit('call:iceCandidate', { from: client.data.userId, candidate });
  }

  @SubscribeMessage('call:end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const { roomId } = data;
    client.to(roomId).emit('call:ended', { by: client.data.userId, roomId });

    try {
      await this.callService.endCall(roomId);
    } catch {
      // room may not have a DB record if call ended before both joined
    }

    await client.leave(roomId);
    await this.matchmakingService.closeRoom(roomId);
  }
}
