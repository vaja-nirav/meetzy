import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

interface QueueEntry {
  userId: number;
  gender: string;
  country: string | null;
  isVip: boolean;
  socketId: string;
  joinedAt: number;
}

const QUEUE_KEY = 'meetzy:matchmaking:queue';
const ROOM_PREFIX = 'meetzy:room:';
const USER_ROOM_PREFIX = 'meetzy:user:room:';
const ROOM_TTL = 86_400; // 24 hours

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async addToQueue(entry: QueueEntry): Promise<void> {
    await this.removeFromQueue(entry.userId);
    const value = JSON.stringify(entry);
    if (entry.isVip) {
      await this.redis.lpush(QUEUE_KEY, value);
    } else {
      await this.redis.rpush(QUEUE_KEY, value);
    }
    await this.redis.expire(QUEUE_KEY, 3600);
    this.logger.debug(`User ${entry.userId} added to queue`);
  }

  async removeFromQueue(userId: number): Promise<void> {
    const all = await this.redis.lrange(QUEUE_KEY, 0, -1);
    for (const item of all) {
      const entry: QueueEntry = JSON.parse(item);
      if (entry.userId === userId) {
        await this.redis.lrem(QUEUE_KEY, 1, item);
        break;
      }
    }
  }

  async findMatch(
    userId: number,
    preferredGender?: string,
    country?: string,
  ): Promise<QueueEntry | null> {
    const all = await this.redis.lrange(QUEUE_KEY, 0, -1);

    for (const item of all) {
      const candidate: QueueEntry = JSON.parse(item);
      if (candidate.userId === userId) continue;
      if (preferredGender && candidate.gender !== preferredGender) continue;
      await this.redis.lrem(QUEUE_KEY, 1, item);
      return candidate;
    }
    return null;
  }

  async createRoom(userAId: number, userBId: number): Promise<string> {
    const roomId = uuidv4();
    const roomKey = `${ROOM_PREFIX}${roomId}`;
    await this.redis.hset(roomKey, {
      userAId: String(userAId),
      userBId: String(userBId),
      createdAt: Date.now(),
    });
    await this.redis.expire(roomKey, ROOM_TTL);
    await this.redis.set(`${USER_ROOM_PREFIX}${userAId}`, roomId, 'EX', ROOM_TTL);
    await this.redis.set(`${USER_ROOM_PREFIX}${userBId}`, roomId, 'EX', ROOM_TTL);
    return roomId;
  }

  async closeRoom(roomId: string): Promise<{ userAId?: number; userBId?: number }> {
    const roomKey = `${ROOM_PREFIX}${roomId}`;
    const data = await this.redis.hgetall(roomKey);
    await this.redis.del(roomKey);
    if (data.userAId) await this.redis.del(`${USER_ROOM_PREFIX}${data.userAId}`);
    if (data.userBId) await this.redis.del(`${USER_ROOM_PREFIX}${data.userBId}`);
    return {
      userAId: data.userAId ? Number(data.userAId) : undefined,
      userBId: data.userBId ? Number(data.userBId) : undefined,
    };
  }

  async getUserRoom(userId: number): Promise<string | null> {
    return this.redis.get(`${USER_ROOM_PREFIX}${userId}`);
  }

  async getRoom(roomId: string): Promise<{ userAId: number; userBId: number } | null> {
    const data = await this.redis.hgetall(`${ROOM_PREFIX}${roomId}`);
    if (!data.userAId) return null;
    return { userAId: Number(data.userAId), userBId: Number(data.userBId) };
  }
}
