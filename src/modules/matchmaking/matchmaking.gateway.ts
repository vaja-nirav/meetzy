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
        // Also notify on /call so Flutter closes the call screen regardless of which
        // socket disconnected first (phone crash / internet drop race condition fix)
        (this.server as any).server.of('/call').to(String(otherId)).emit('call:ended', {
          by: userId,
          roomId,
          reason: 'partner_disconnected',
        });
        // Partner is still connected — re-mark them available server-side
        await this.matchmakingService.markAvailable(otherId);
      }
      await this.matchmakingService.closeRoom(roomId);
    }

    await this.usersService.setOnlineStatus(userId, false);
    this.logger.log(`Disconnected: ${userId}`);
  }

  // ── Caller clicks "Start" → instantly connect to a random active+free user ──
  @SubscribeMessage('match:findUser')
  async handleFindUser(@ConnectedSocket() client: Socket) {
    await this.autoConnect(client);
  }

  /**
   * Instantly pair the caller with a random active + free user and connect BOTH —
   * no accept/decline step. Concurrency-safe: the pairing is one atomic Redis
   * script (see MatchmakingService.pickPair), so two users pressing "Start" at the
   * same instant can never double-book or grab each other.
   *
   * @param skipId  user id to avoid re-matching (the partner just swiped away from)
   */
  private async autoConnect(client: Socket, skipId?: number): Promise<void> {
    const callerId = client.data.userId as number;
    if (!callerId) return;

    // Already in a call? ignore.
    if (await this.matchmakingService.getUserRoom(callerId)) {
      client.emit('match:error', { message: 'You are already in a call' });
      return;
    }

    // Retry only to skip ghost entries (crashed clients still lingering in the pool).
    for (let attempt = 0; attempt < 3; attempt++) {
      const { status, calleeId } = await this.matchmakingService.pickPair(callerId, skipId);

      // Someone grabbed this caller at the same instant — they'll receive match:matched.
      if (status === 'aborted') return;

      // Nobody free right now — caller stays in the pool ("searching") and auto-connects later.
      if (status === 'none' || !calleeId) {
        client.emit('match:noUsersAvailable', {
          message: 'No users are available right now. Searching…',
        });
        return;
      }

      // Confirm the picked user is actually still connected (not a stale pool entry).
      const calleeSockets = await this.server.in(String(calleeId)).fetchSockets();
      if (calleeSockets.length === 0) {
        await this.matchmakingService.markUnavailable(calleeId); // drop the ghost
        await this.matchmakingService.markAvailable(callerId);   // re-pool caller, try again
        continue;
      }

      // Final guard: neither side should already be in a room.
      const [callerRoom, calleeRoom] = await Promise.all([
        this.matchmakingService.getUserRoom(callerId),
        this.matchmakingService.getUserRoom(calleeId),
      ]);
      if (callerRoom || calleeRoom) {
        if (!callerRoom) await this.matchmakingService.markAvailable(callerId);
        if (!calleeRoom) await this.matchmakingService.markAvailable(calleeId);
        return;
      }

      // Create the room and connect BOTH immediately — no acceptance required.
      const roomId = await this.matchmakingService.createRoom(callerId, calleeId);
      const iceServers = this.getIceServers();

      this.server.to(String(callerId)).emit('match:matched', {
        roomId,
        partnerId: calleeId,
        iceServers,
      });
      this.server.to(String(calleeId)).emit('match:matched', {
        roomId,
        partnerId: callerId,
        iceServers,
      });
      this.logger.log(`Auto-connected ${callerId} ↔ ${calleeId} — room ${roomId}`);
      return;
    }

    // Only ghosts found across all attempts — stay searching.
    client.emit('match:noUsersAvailable', {
      message: 'No users are available right now. Searching…',
    });
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

  // ── Swipe: end current call and instantly auto-connect to the next user ─────
  @SubscribeMessage('match:next')
  async handleNext(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as number;
    if (!userId) return;

    let skipId: number | undefined;
    const roomId = await this.matchmakingService.getUserRoom(userId);
    if (roomId) {
      const room = await this.matchmakingService.getRoom(roomId);
      if (room) {
        const otherId = room.userAId === userId ? room.userBId : room.userAId;
        skipId = otherId; // avoid bouncing straight back to the partner just left
        // Skipped user goes back to available
        this.server.to(String(otherId)).emit('match:partnerLeft', { roomId });
        await this.matchmakingService.markAvailable(otherId);
      }
      await this.matchmakingService.closeRoom(roomId);
    }

    // Swiping user is now free — auto-connect to a new random partner immediately
    await this.matchmakingService.markAvailable(userId);
    await this.autoConnect(client, skipId);
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
