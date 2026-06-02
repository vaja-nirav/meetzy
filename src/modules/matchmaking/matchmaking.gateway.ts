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
import { v4 as uuidv4 } from 'uuid';
import { MatchmakingService } from './matchmaking.service';
import { UsersService } from '../users/users.service';

@WebSocketGateway({ namespace: '/matchmaking', cors: { origin: '*' } })
export class MatchmakingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(MatchmakingGateway.name);

  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ── Connection ─────────────────────────────────────────────────────────────

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
      client.data.isVip  = payload.isVip ?? false;

      await client.join(String(payload.sub));
      await this.usersService.setOnlineStatus(Number(payload.sub), true);
      await this.matchmakingService.markAvailable(Number(payload.sub));
      this.logger.log(`Connected & available: ${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (!client.data.userId) return;
    const userId = client.data.userId as number;

    // Remove from available pool
    await this.matchmakingService.markUnavailable(userId);

    // If they were in a call, close the room and notify partner
    const roomId = await this.matchmakingService.getUserRoom(userId);
    if (roomId) {
      const room = await this.matchmakingService.getRoom(roomId);
      if (room) {
        const otherId = room.userAId === userId ? room.userBId : room.userAId;
        this.server.to(String(otherId)).emit('match:partnerLeft', { roomId });
        // Partner is still connected — re-mark them available server-side
        await this.matchmakingService.markAvailable(otherId);
      }
      await this.matchmakingService.closeRoom(roomId);
    }

    await this.usersService.setOnlineStatus(userId, false);
    this.logger.log(`Disconnected: ${userId}`);
  }

  // ── STEP 1: Caller clicks "Find Match" ─────────────────────────────────────
  @SubscribeMessage('match:findUser')
  async handleFindUser(@ConnectedSocket() client: Socket) {
    const callerId = client.data.userId as number;
    if (!callerId) return;

    // Make sure caller themselves is not already in a call
    const existingRoom = await this.matchmakingService.getUserRoom(callerId);
    if (existingRoom) {
      client.emit('match:error', { message: 'You are already in a call' });
      return;
    }

    // Pick a random available user
    const calleeId = await this.matchmakingService.findRandomAvailableUser(callerId);
    if (!calleeId) {
      client.emit('match:noUsersAvailable', {
        message: 'No users are available right now. Try again in a moment.',
      });
      return;
    }

    // Load caller profile to show in the popup
    const caller = await this.usersService.findById(callerId);
    if (!caller) return;

    // Create pending call record (30s TTL) + lock callee as unavailable
    const callId = uuidv4();
    await this.matchmakingService.savePendingCall(callId, callerId, calleeId);

    // Tell callee: show incoming call popup
    this.server.to(String(calleeId)).emit('match:incomingCall', {
      callId,
      caller: {
        id:          caller.id,
        displayName: caller.displayName,
        photoUrl:    caller.photoUrl,
        bio:         caller.bio,
        gender:      caller.gender,
        country:     caller.country,
      },
    });

    // Tell caller: it's ringing
    client.emit('match:calling', { callId, calleeId });
    this.logger.log(`User ${callerId} is calling ${calleeId} — callId: ${callId}`);
  }

  // ── STEP 2a: Callee clicks "Connect" ───────────────────────────────────────
  @SubscribeMessage('match:acceptCall')
  async handleAcceptCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: string },
  ) {
    const calleeId = client.data.userId as number;
    const call = await this.matchmakingService.deletePendingCall(data.callId);

    if (!call) {
      client.emit('match:callExpired', { message: 'Call request expired or cancelled' });
      return;
    }

    const { callerId } = call;
    const roomId      = await this.matchmakingService.createRoom(callerId, calleeId);
    const iceServers  = this.getIceServers();

    // Notify both — they navigate to the call page
    this.server.to(String(callerId)).emit('match:callAccepted', {
      roomId,
      partnerId: calleeId,
      iceServers,
    });
    this.server.to(String(calleeId)).emit('match:callAccepted', {
      roomId,
      partnerId: callerId,
      iceServers,
    });
    this.logger.log(`Call accepted — room ${roomId}`);
  }

  // ── STEP 2b: Callee clicks "Decline" ───────────────────────────────────────
  @SubscribeMessage('match:declineCall')
  async handleDeclineCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: string },
  ) {
    const calleeId = client.data.userId as number;
    const call     = await this.matchmakingService.deletePendingCall(data.callId);
    if (!call) return;

    // Both parties are free again — caller was locked during the ringing window
    await this.matchmakingService.markAvailable(calleeId);
    await this.matchmakingService.markAvailable(call.callerId);

    // Tell caller they were declined
    this.server.to(String(call.callerId)).emit('match:callDeclined', {
      message: 'User declined your call',
    });
    this.logger.log(`Call ${data.callId} declined by ${calleeId}`);
  }

  // ── Caller cancels before callee responds ─────────────────────────────────
  @SubscribeMessage('match:cancelCall')
  async handleCancelCall(
    @MessageBody() data: { callId: string },
  ) {
    const call = await this.matchmakingService.deletePendingCall(data.callId);
    if (!call) return;

    // Both parties are free again — caller was locked during the ringing window
    await this.matchmakingService.markAvailable(call.calleeId);
    await this.matchmakingService.markAvailable(call.callerId);

    // Dismiss the incoming popup on callee side
    this.server.to(String(call.calleeId)).emit('match:callCancelled', { callId: data.callId });
    this.logger.log(`Call ${data.callId} cancelled by caller`);
  }

  // ── After a call ends — both users go back to available ───────────────────
  @SubscribeMessage('match:backToAvailable')
  async handleBackToAvailable(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as number;
    if (!userId) return;
    const inRoom = await this.matchmakingService.getUserRoom(userId);
    if (!inRoom) {
      await this.matchmakingService.markAvailable(userId);
    }
  }

  // ── Swipe: end current call and immediately find next user ─────────────────
  @SubscribeMessage('match:next')
  async handleNext(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as number;
    if (!userId) return;

    const roomId = await this.matchmakingService.getUserRoom(userId);
    if (roomId) {
      const room = await this.matchmakingService.getRoom(roomId);
      if (room) {
        const otherId = room.userAId === userId ? room.userBId : room.userAId;
        // Skipped user goes back to available
        this.server.to(String(otherId)).emit('match:partnerLeft', { roomId });
        await this.matchmakingService.markAvailable(otherId);
      }
      await this.matchmakingService.closeRoom(roomId);
    }

    // Swiping user is now free — find next immediately
    await this.matchmakingService.markAvailable(userId);
    await this.handleFindUser(client);
  }

  private getIceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls:       this.configService.get<string>('COTURN_URL', 'turn:localhost:3478'),
        username:   this.configService.get<string>('COTURN_USERNAME', 'meetzy'),
        credential: this.configService.get<string>('COTURN_PASSWORD', 'meetzy_turn_password'),
      },
    ];
  }
}
