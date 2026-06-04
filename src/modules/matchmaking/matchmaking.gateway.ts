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
      const userId = Number(payload.sub);
      client.data.userId = userId;
      client.data.isVip  = payload.isVip ?? false;

      // Load the user's gender so matches can be filtered by it.
      const user = await this.usersService.findById(userId);
      client.data.gender = user?.gender ?? 'other';

      await client.join(String(userId));
      await this.usersService.setOnlineStatus(userId, true);
      await this.matchmakingService.setGender(userId, client.data.gender);
      await this.matchmakingService.markAvailable(userId);
      this.logger.log(`Connected & available: ${userId} (${client.data.gender})`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (!client.data.userId) return;
    const userId = client.data.userId as number;

    // Remove from available pool + gender lookup
    await this.matchmakingService.markUnavailable(userId);
    await this.matchmakingService.clearGender(userId);

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
  // payload: { gender?: 'all' | 'female' | 'male' } — the selected filter chip.
  @SubscribeMessage('match:findUser')
  async handleFindUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { gender?: string },
  ) {
    await this.autoConnect(client, { filterGender: data?.gender });
  }

  /**
   * Instantly pair the caller with a random active + free user and connect BOTH —
   * no accept/decline step. Concurrency-safe: the pairing is one atomic Redis
   * script (see MatchmakingService.pickPair), so two users pressing "Start" at the
   * same instant can never double-book or grab each other.
   *
   * @param opts.filterGender  'all' | 'female' | 'male' — only match this gender ('all' = any)
   * @param opts.skipId        user id to avoid re-matching (the partner just swiped away from)
   */
  private async autoConnect(
    client: Socket,
    opts: { filterGender?: string; skipId?: number } = {},
  ): Promise<void> {
    const { filterGender, skipId } = opts;
    const callerId = client.data.userId as number;
    if (!callerId) return;

    // Already in a call? ignore.
    if (await this.matchmakingService.getUserRoom(callerId)) {
      client.emit('match:error', { message: 'You are already in a call' });
      return;
    }

    // Retry only to skip ghost entries (crashed clients still lingering in the pool).
    for (let attempt = 0; attempt < 3; attempt++) {
      const { status, calleeId } = await this.matchmakingService.pickPair(callerId, filterGender, skipId);

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
        room_id: roomId,
        partner_id: calleeId,
        ice_servers: iceServers,
      });
      this.server.to(String(calleeId)).emit('match:matched', {
        room_id: roomId,
        partner_id: callerId,
        ice_servers: iceServers,
      });
      this.logger.log(`Auto-connected ${callerId} ↔ ${calleeId} — room ${roomId}`);
      return;
    }

    // Only ghosts found across all attempts — stay searching.
    client.emit('match:noUsersAvailable', {
      message: 'No users are available right now. Searching…',
    });
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
  // payload: { gender?: 'all' | 'female' | 'male' } — keep the same filter on swipe.
  @SubscribeMessage('match:next')
  async handleNext(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { gender?: string },
  ) {
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
    await this.autoConnect(client, { filterGender: data?.gender, skipId });
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
