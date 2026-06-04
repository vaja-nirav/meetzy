import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const AVAILABLE_KEY  = 'meetzy:available';          // SET  — free users (userId strings)
const GENDER_KEY     = 'meetzy:user:gender';         // HASH  — userId → gender (for filtering)
const ROOM_PREFIX    = 'meetzy:room:';               // HASH  — active room
const USER_ROOM_KEY  = 'meetzy:user:room:';          // STRING — userId → roomId
const ROOM_TTL       = 86_400;                       // 24 hours

// Atomically picks a random member from the set (excluding one id) and removes it.
// Using a Lua script ensures the pick + remove is a single Redis operation with no
// race window — two concurrent callers cannot pick the same user.
const PICK_AND_LOCK_SCRIPT = `
local members = redis.call('SMEMBERS', KEYS[1])
local exclude = ARGV[1]
local seed    = tonumber(ARGV[2])
local candidates = {}
for _, v in ipairs(members) do
  if v ~= exclude then
    table.insert(candidates, v)
  end
end
if #candidates == 0 then
  return nil
end
math.randomseed(seed)
local pick = candidates[math.random(#candidates)]
redis.call('SREM', KEYS[1], pick)
return pick
`;

// Atomically pair a caller with a random available user — caller-removal + callee-pick
// happen in ONE Redis script, so two users pressing "Start" at the same instant can
// never double-book or grab each other. Optionally filters candidates by gender.
//   KEYS[1] = available set, KEYS[2] = gender hash (userId → gender)
//   ARGV[1] = caller id, ARGV[2] = skip id ('' = none), ARGV[3] = random seed,
//   ARGV[4] = gender filter ('all' = any, otherwise 'male'/'female'/'other')
// Returns [present, pickedId]:
//   {0, ''}     caller was already taken by another matcher  → abort
//   {1, ''}     caller is free but nobody (of that gender) is available → caller re-pooled
//   {1, <id>}   matched: caller + picked are both removed atomically
const PICK_PAIR_SCRIPT = `
local caller = ARGV[1]
local skip   = ARGV[2]
local seed   = tonumber(ARGV[3])
local filter = ARGV[4]

local present = redis.call('SREM', KEYS[1], caller)
if present == 0 then
  return {0, ''}
end

local members = redis.call('SMEMBERS', KEYS[1])
local candidates = {}
local skipped = nil
for _, v in ipairs(members) do
  local matches = true
  if filter ~= 'all' and filter ~= '' then
    local g = redis.call('HGET', KEYS[2], v)
    if g ~= filter then matches = false end
  end
  if matches then
    if v == skip then
      skipped = v
    else
      table.insert(candidates, v)
    end
  end
end

if #candidates == 0 then
  if skipped ~= nil then
    redis.call('SREM', KEYS[1], skipped)
    return {1, skipped}
  end
  redis.call('SADD', KEYS[1], caller)
  return {1, ''}
end

math.randomseed(seed)
local pick = candidates[math.random(#candidates)]
redis.call('SREM', KEYS[1], pick)
return {1, pick}
`;

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

  // ── Gender lookup (used to filter matches by gender) ───────────────────────

  async setGender(userId: number, gender?: string): Promise<void> {
    await this.redis.hset(GENDER_KEY, String(userId), gender || 'other');
  }

  async clearGender(userId: number): Promise<void> {
    await this.redis.hdel(GENDER_KEY, String(userId));
  }

  // Atomically picks a random available user (excluding caller) and removes them from
  // the pool in one Redis round-trip — prevents two callers picking the same person.
  async findRandomAvailableUser(excludeUserId: number): Promise<number | null> {
    const result = await this.redis.eval(
      PICK_AND_LOCK_SCRIPT,
      1,
      AVAILABLE_KEY,
      String(excludeUserId),
      String(Math.floor(Math.random() * 1_000_000)),
    ) as string | null;
    if (!result) return null;
    return Number(result);
  }

  /**
   * Atomically pair the caller with a random available user (excluding an optional
   * just-skipped id). One Redis round-trip — no race between concurrent callers.
   *   - status 'matched'  → calleeId is set; caller + callee removed from the pool
   *   - status 'none'     → caller is free but nobody else available (caller re-pooled)
   *   - status 'aborted'  → caller was already grabbed by another matcher this instant
   */
  async pickPair(
    callerId: number,
    filterGender?: string,
    skipId?: number,
  ): Promise<{ status: 'matched' | 'none' | 'aborted'; calleeId?: number }> {
    const filter = filterGender && filterGender !== 'all' ? String(filterGender) : 'all';
    const res = (await this.redis.eval(
      PICK_PAIR_SCRIPT,
      2,
      AVAILABLE_KEY,
      GENDER_KEY,
      String(callerId),
      skipId != null ? String(skipId) : '',
      String(Math.floor(Math.random() * 1_000_000)),
      filter,
    )) as [number | string, string];

    const present = Number(res[0]);
    const pick = res[1];
    if (present === 0) return { status: 'aborted' };
    if (!pick) return { status: 'none' };
    return { status: 'matched', calleeId: Number(pick) };
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
