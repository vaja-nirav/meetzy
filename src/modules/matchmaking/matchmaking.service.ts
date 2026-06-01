import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const AVAILABLE_KEY  = 'meetzy:available';          // SET  — free users (userId strings)
const CALL_PREFIX    = 'meetzy:call:';               // STRING — pending call data
const ROOM_PREFIX    = 'meetzy:room:';               // HASH  — active room
const USER_ROOM_KEY  = 'meetzy:user:room:';          // STRING — userId → roomId
const CALL_TTL       = 30;                           // seconds — auto-expire unanswered calls
const ROOM_TTL       = 86_400;                       // 24 hours

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ── Available users (free, not in a call) ──────────────────────────────────

  async markAvailable(userId: number): Promise<void> {
    await this.redis.sadd(AVAILABLE_KEY, String(userId));
  }

  async markUnavailable(userId: number): Promise<void> {
    await this.redis.srem(AVAILABLE_KEY, String(userId));
  }

  async isAvailable(userId: number): Promise<boolean> {
    return (await this.redis.sismember(AVAILABLE_KEY, String(userId))) === 1;
  }

  // Pick a random free user that isn't the caller
  async findRandomAvailableUser(excludeUserId: number): Promise<number | null> {
    const members = await this.redis.smembers(AVAILABLE_KEY);
    const candidates = members.filter(id => Number(id) !== excludeUserId);
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return Number(pick);
  }

  // ── Pending calls (ringing state) ──────────────────────────────────────────

  async savePendingCall(callId: string, callerId: number, calleeId: number): Promise<void> {
    await this.redis.setex(
      `${CALL_PREFIX}${callId}`,
      CALL_TTL,
      JSON.stringify({ callerId, calleeId }),
    );
    // Remove callee from available while they're being rung
    await this.markUnavailable(calleeId);
  }

  async getPendingCall(callId: string): Promise<{ callerId: number; calleeId: number } | null> {
    const raw = await this.redis.get(`${CALL_PREFIX}${callId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async deletePendingCall(callId: string): Promise<{ callerId: number; calleeId: number } | null> {
    const call = await this.getPendingCall(callId);
    if (call) await this.redis.del(`${CALL_PREFIX}${callId}`);
    return call;
  }

  // ── Rooms ──────────────────────────────────────────────────────────────────

  async createRoom(userAId: number, userBId: number): Promise<string> {
    const roomId = uuidv4();
    await this.redis.hset(`${ROOM_PREFIX}${roomId}`, {
      userAId: String(userAId),
      userBId: String(userBId),
      createdAt: Date.now(),
    });
    await this.redis.expire(`${ROOM_PREFIX}${roomId}`, ROOM_TTL);
    await this.redis.set(`${USER_ROOM_KEY}${userAId}`, roomId, 'EX', ROOM_TTL);
    await this.redis.set(`${USER_ROOM_KEY}${userBId}`, roomId, 'EX', ROOM_TTL);
    // Both users are now in a room — not available
    await this.markUnavailable(userAId);
    await this.markUnavailable(userBId);
    this.logger.log(`Room ${roomId} created for users ${userAId} ↔ ${userBId}`);
    return roomId;
  }

  async closeRoom(roomId: string): Promise<{ userAId?: number; userBId?: number }> {
    const data = await this.redis.hgetall(`${ROOM_PREFIX}${roomId}`);
    await this.redis.del(`${ROOM_PREFIX}${roomId}`);
    if (data.userAId) await this.redis.del(`${USER_ROOM_KEY}${data.userAId}`);
    if (data.userBId) await this.redis.del(`${USER_ROOM_KEY}${data.userBId}`);
    return {
      userAId: data.userAId ? Number(data.userAId) : undefined,
      userBId: data.userBId ? Number(data.userBId) : undefined,
    };
  }

  async getUserRoom(userId: number): Promise<string | null> {
    return this.redis.get(`${USER_ROOM_KEY}${userId}`);
  }

  async getRoom(roomId: string): Promise<{ userAId: number; userBId: number } | null> {
    const data = await this.redis.hgetall(`${ROOM_PREFIX}${roomId}`);
    if (!data.userAId) return null;
    return { userAId: Number(data.userAId), userBId: Number(data.userBId) };
  }
}
