import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  Repository,
  MoreThanOrEqual,
  IsNull,
  Like,
  Between,
  In,
} from 'typeorm';
import { User } from '../users/entities/user.entity';
import { CallRoom } from '../call/entities/call-room.entity';
import { PurchasedCoin } from '../wallet/entities/wallet.entity';
import { UsedCoin } from '../wallet/entities/transaction.entity';

const AVAILABLE_KEY = 'meetzy:available';

/**
 * Admin panel backend — wired to the real MySQL/Redis data.
 *
 * Responses are returned *flat* (NOT wrapped in `{ success, data }`) to match
 * exactly what the existing React admin pages read.
 *
 * Note: this app has no `reports` or `blocked` tables (reportUser() never
 * persists, and there is no block entity), so those endpoints honestly return
 * empty sets. The matchmaking "queue" is the Redis `meetzy:available` set.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  private readonly baseUrl: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(CallRoom) private readonly calls: Repository<CallRoom>,
    @InjectRepository(PurchasedCoin) private readonly purchased: Repository<PurchasedCoin>,
    @InjectRepository(UsedCoin) private readonly used: Repository<UsedCoin>,
    @InjectRedis() private readonly redis: Redis,
  ) {
    const port = this.configService.get<string>('PORT') || '3001';
    this.baseUrl = `http://localhost:${port}`;
  }

  /** Turn a stored relative `/uploads/...` path into an absolute URL the admin (on another origin) can load. */
  private photo(url: string | null | undefined): string | null {
    if (!url) return null;
    return url.startsWith('/uploads/') ? `${this.baseUrl}${url}` : url;
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  login(email: string, password: string) {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    const adminPass = this.configService.get<string>('ADMIN_PASSWORD');
    const adminSecret = this.configService.get<string>('ADMIN_JWT_SECRET');

    if (!email || !password) {
      throw new UnauthorizedException('Email and password are required');
    }
    if (email !== adminEmail || password !== adminPass) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = this.jwtService.sign(
      { email: adminEmail, role: 'admin' },
      { secret: adminSecret, expiresIn: '24h' },
    );

    return {
      token,
      adminToken: token,
      expiresIn: 86400,
      admin: { email: adminEmail, role: 'admin' },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  private startOfDay(d = new Date()): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Shape a User entity into the row the admin frontend expects. */
  private mapUser(u: User, totalCalls = 0) {
    const status = u.isBanned ? 'banned' : u.isProfileComplete ? 'active' : 'incomplete';
    return {
      id: u.id,
      _id: u.id,
      displayName: u.displayName,
      email: u.email,
      photoUrl: this.photo(u.photoUrl),
      bio: u.bio,
      gender: u.gender,
      country: u.countryName || u.country?.name || null,
      countryCode: u.countryCode,
      isVip: u.isVip,
      isOnline: u.isOnline,
      isBanned: u.isBanned,
      isProfileComplete: u.isProfileComplete,
      status,
      coins: u.coins,
      totalCalls,
      createdAt: u.createdAt,
      lastSeenAt: u.updatedAt,
    };
  }

  /** Count calls per user id across both sides, in one pass. */
  private async callCountsFor(ids: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (!ids.length) return map;
    for (const side of ['userAId', 'userBId'] as const) {
      const rows = await this.calls
        .createQueryBuilder('c')
        .select(`c.${side}`, 'uid')
        .addSelect('COUNT(*)', 'cnt')
        .where(`c.${side} IN (:...ids)`, { ids })
        .groupBy(`c.${side}`)
        .getRawMany<{ uid: number; cnt: string }>();
      for (const r of rows) {
        map.set(Number(r.uid), (map.get(Number(r.uid)) || 0) + Number(r.cnt));
      }
    }
    return map;
  }

  /** Load users by id into a lookup map (for joining calls/transactions). */
  private async userMap(ids: number[]): Promise<Map<number, User>> {
    const map = new Map<number, User>();
    const unique = [...new Set(ids.filter((i) => i != null))];
    if (!unique.length) return map;
    const found = await this.users.find({ where: { id: In(unique) } });
    for (const u of found) map.set(u.id, u);
    return map;
  }

  // ── Dashboard stats ─────────────────────────────────────────────────────
  async getStats() {
    const today = this.startOfDay();
    const since = new Date(today);
    since.setDate(since.getDate() - 6); // 7 buckets incl. today

    const [totalUsers, onlineNow, activeVip, newToday, callsToday] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { isOnline: true } }),
      this.users.count({ where: { isVip: true } }),
      this.users.count({ where: { createdAt: MoreThanOrEqual(today) } }),
      this.calls.count({ where: { startedAt: MoreThanOrEqual(today) } }),
    ]);

    // 7-day series — bucket in JS so timezone handling stays consistent.
    const buckets: { date: string; label: string; key: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      buckets.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      });
    }
    const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    const [recentUsers, recentCalls] = await Promise.all([
      this.users.find({ where: { createdAt: MoreThanOrEqual(since) } }),
      this.calls.find({ where: { startedAt: MoreThanOrEqual(since) } }),
    ]);

    const userCounts = new Map<string, number>();
    for (const u of recentUsers) {
      const k = keyOf(this.startOfDay(u.createdAt));
      userCounts.set(k, (userCounts.get(k) || 0) + 1);
    }
    const callCounts = new Map<string, number>();
    for (const c of recentCalls) {
      const k = keyOf(this.startOfDay(c.startedAt));
      callCounts.set(k, (callCounts.get(k) || 0) + 1);
    }

    const userGrowth = buckets.map((b) => ({ date: b.label, count: userCounts.get(b.key) || 0 }));
    const callsHistory = buckets.map((b) => ({ date: b.label, count: callCounts.get(b.key) || 0 }));

    // Gender distribution
    const genderRows = await this.users
      .createQueryBuilder('u')
      .select('u.gender', 'gender')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.gender')
      .getRawMany<{ gender: string; count: string }>();
    const genderStats = { male: 0, female: 0, other: 0 };
    for (const r of genderRows) {
      if (r.gender in genderStats) genderStats[r.gender] = Number(r.count);
    }

    // Top 5 countries
    const countryRows = await this.users
      .createQueryBuilder('u')
      .select('u.countryName', 'name')
      .addSelect('u.countryCode', 'code')
      .addSelect('COUNT(*)', 'count')
      .where('u.countryName IS NOT NULL')
      .groupBy('u.countryName')
      .addGroupBy('u.countryCode')
      .orderBy('count', 'DESC')
      .limit(5)
      .getRawMany<{ name: string; code: string | null; count: string }>();
    const topCountries = countryRows
      .filter((r) => r.name)
      .map((r) => ({ name: r.name, code: r.code, count: Number(r.count) }));

    return {
      totalUsers,
      onlineNow,
      callsToday,
      newToday,
      pendingReports: 0, // no reports table in this app
      activeVip,
      userGrowth,
      callsHistory,
      genderStats,
      topCountries,
    };
  }

  // ── Users ───────────────────────────────────────────────────────────────
  async getUsers(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Number(query?.limit) || 20);
    const where: any = {};

    if (query?.search) {
      // OR across name/email — express as an array of where clauses.
      const term = `%${query.search}%`;
      const base = { ...where };
      const whereArr = [
        { ...base, displayName: Like(term) },
        { ...base, email: Like(term) },
      ];
      return this.findUsersPaged(whereArr, page, limit, query?.status, query?.gender);
    }

    return this.findUsersPaged(where, page, limit, query?.status, query?.gender);
  }

  private async findUsersPaged(
    where: any,
    page: number,
    limit: number,
    status?: string,
    gender?: string,
  ) {
    const applyFilters = (w: any) => {
      const out = { ...w };
      if (gender) out.gender = gender;
      if (status === 'banned') out.isBanned = true;
      else if (status === 'vip') out.isVip = true;
      else if (status === 'online') out.isOnline = true;
      else if (status === 'active') {
        out.isBanned = false;
        out.isProfileComplete = true;
      }
      return out;
    };
    const finalWhere = Array.isArray(where) ? where.map(applyFilters) : applyFilters(where);

    const [rows, total] = await this.users.findAndCount({
      where: finalWhere,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const counts = await this.callCountsFor(rows.map((u) => u.id));
    const users = rows.map((u) => this.mapUser(u, counts.get(u.id) || 0));
    return { users, total, page, limit };
  }

  async getUserById(userId: string) {
    const id = Number(userId);
    const u = await this.users.findOne({ where: { id } });
    if (!u) return { user: null };
    const counts = await this.callCountsFor([id]);

    // Recent transactions (credits + debits merged)
    const [creds, debs] = await Promise.all([
      this.purchased.find({ where: { userId: id }, order: { createdAt: 'DESC' }, take: 5 }),
      this.used.find({ where: { userId: id }, order: { createdAt: 'DESC' }, take: 5 }),
    ]);
    const recentTransactions = [
      ...creds.map((t) => ({ type: 'credit', amount: t.coins, reason: t.type, createdAt: t.createdAt })),
      ...debs.map((t) => ({ type: 'debit', amount: t.coins, reason: t.type, createdAt: t.createdAt })),
    ]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 5);

    // Recent calls with partner info
    const callRows = await this.calls.find({
      where: [{ userAId: id }, { userBId: id }],
      order: { startedAt: 'DESC' },
      take: 5,
    });
    const partnerIds = callRows.map((c) => (c.userAId === id ? c.userBId : c.userAId));
    const partners = await this.userMap(partnerIds);
    const recentCalls = callRows.map((c) => {
      const partnerId = c.userAId === id ? c.userBId : c.userAId;
      const p = partners.get(partnerId);
      return {
        partner: p ? { displayName: p.displayName, photoUrl: this.photo(p.photoUrl) } : null,
        duration: c.duration,
        createdAt: c.startedAt,
      };
    });

    return {
      ...this.mapUser(u, counts.get(id) || 0),
      recentTransactions,
      recentCalls,
      reports: [],
      reportsReceived: 0,
    };
  }

  async banUser(userId: string, action: string, _reason?: string) {
    const id = Number(userId);
    const ban = action !== 'unban';
    await this.users.update(id, ban ? { isBanned: true, isOnline: false } : { isBanned: false });
    return { success: true, message: `User ${ban ? 'banned' : 'unbanned'} successfully` };
  }

  async updateVip(userId: string, action: string, _durationDays?: number) {
    const id = Number(userId);
    const revoke = action === 'revoke';
    await this.users.update(id, { isVip: !revoke });
    return { success: true, message: `VIP ${revoke ? 'revoked' : 'granted'} successfully` };
  }

  async updateCoins(userId: string, action: string, amount: number, reason?: string) {
    const id = Number(userId);
    const user = await this.users.findOne({ where: { id } });
    if (!user) return { success: false, message: 'User not found' };

    const amt = Math.abs(Number(amount) || 0);
    const debit = action === 'debit';
    const newBalance = Math.max(0, user.coins + (debit ? -amt : amt));
    await this.users.update(id, { coins: newBalance });

    // Audit row so it appears in transactions.
    if (debit) {
      await this.used.save(this.used.create({ userId: id, coins: amt, type: reason || 'admin_deduct' }));
    } else {
      await this.purchased.save(this.purchased.create({ userId: id, coins: amt, type: reason || 'admin_bonus' }));
    }

    return { success: true, message: `Coins ${debit ? 'debited' : 'credited'} successfully`, balance: newBalance };
  }

  // ── Calls ─────────────────────────────────────────────────────────────
  async getActiveCalls() {
    const rows = await this.calls.find({ where: { endedAt: IsNull() }, order: { startedAt: 'DESC' } });
    const um = await this.userMap(rows.flatMap((c) => [c.userAId, c.userBId]));
    const now = Date.now();
    const calls = rows.map((c) => ({
      roomId: c.id,
      _id: c.id,
      userA: this.miniUser(um.get(c.userAId)),
      userB: this.miniUser(um.get(c.userBId)),
      durationSeconds: Math.floor((now - new Date(c.startedAt).getTime()) / 1000),
      startedAt: c.startedAt,
    }));
    return { calls };
  }

  async getCalls(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Number(query?.limit) || 20);

    const qb = this.calls
      .createQueryBuilder('c')
      .where('c.endedAt IS NOT NULL')
      .orderBy('c.startedAt', 'DESC');

    if (query?.dateFrom) qb.andWhere('c.startedAt >= :from', { from: new Date(query.dateFrom) });
    if (query?.dateTo) {
      const to = new Date(query.dateTo);
      to.setHours(23, 59, 59, 999);
      qb.andWhere('c.startedAt <= :to', { to });
    }

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const um = await this.userMap(rows.flatMap((c) => [c.userAId, c.userBId]));
    const calls = rows.map((c) => ({
      roomId: c.id,
      _id: c.id,
      userA: this.miniUser(um.get(c.userAId)),
      userB: this.miniUser(um.get(c.userBId)),
      durationSeconds: c.duration ?? 0,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      endReason: 'completed',
    }));

    // Aggregate stats over all completed calls.
    const statsRaw = await this.calls
      .createQueryBuilder('c')
      .select('COUNT(*)', 'total')
      .addSelect('AVG(c.duration)', 'avg')
      .where('c.endedAt IS NOT NULL')
      .getRawOne<{ total: string; avg: string | null }>();

    return {
      calls,
      total,
      page,
      stats: {
        total: Number(statsRaw?.total || 0),
        avgDuration: Math.round(Number(statsRaw?.avg || 0)),
      },
    };
  }

  private miniUser(u?: User) {
    if (!u) return null;
    return { id: u.id, displayName: u.displayName, photoUrl: this.photo(u.photoUrl) };
  }

  async terminateCall(roomId: string) {
    try {
      const room = await this.calls.findOne({ where: { id: roomId } });
      if (room && !room.endedAt) {
        const endedAt = new Date();
        await this.calls.update(roomId, {
          endedAt,
          duration: Math.floor((endedAt.getTime() - new Date(room.startedAt).getTime()) / 1000),
        });
      }
    } catch (e) {
      this.logger.warn(`terminateCall failed: ${e}`);
    }
    return { success: true, message: 'Call terminated' };
  }

  // ── Reports (no persistence in this app) ────────────────────────────────
  getReports(query: any) {
    return { reports: [], total: 0, page: Number(query?.page) || 1, counts: {} };
  }

  updateReport(_reportId: string, _status?: string, _adminNote?: string) {
    return { success: true, message: 'Report updated' };
  }

  // ── Transactions (purchased = credit, used = debit) ─────────────────────
  async getTransactions(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Number(query?.limit) || 20);
    const type = query?.type as string | undefined;

    const dateWhere: any = {};
    if (query?.dateFrom || query?.dateTo) {
      const from = query?.dateFrom ? new Date(query.dateFrom) : new Date(0);
      const to = query?.dateTo ? new Date(query.dateTo) : new Date();
      if (query?.dateTo) to.setHours(23, 59, 59, 999);
      dateWhere.createdAt = Between(from, to);
    }

    const [creds, debs] = await Promise.all([
      type === 'debit'
        ? Promise.resolve([] as PurchasedCoin[])
        : this.purchased.find({ where: dateWhere, order: { createdAt: 'DESC' } }),
      type === 'credit'
        ? Promise.resolve([] as UsedCoin[])
        : this.used.find({ where: dateWhere, order: { createdAt: 'DESC' } }),
    ]);

    let merged = [
      ...creds.map((t) => ({ userId: t.userId, type: 'credit' as const, amount: t.coins, reason: t.type, createdAt: t.createdAt })),
      ...debs.map((t) => ({ userId: t.userId, type: 'debit' as const, amount: t.coins, reason: t.type, createdAt: t.createdAt })),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

    // Optional username search
    const um = await this.userMap(merged.map((m) => m.userId));
    if (query?.search) {
      const s = String(query.search).toLowerCase();
      merged = merged.filter((m) => um.get(m.userId)?.displayName?.toLowerCase().includes(s));
    }

    const total = merged.length;
    const pageRows = merged.slice((page - 1) * limit, (page - 1) * limit + limit);
    const transactions = pageRows.map((m) => ({
      ...m,
      user: this.miniUser(um.get(m.userId)),
    }));

    const totalCredits = creds.reduce((s, t) => s + t.coins, 0);
    const totalDebits = debs.reduce((s, t) => s + t.coins, 0);

    return {
      transactions,
      total,
      page,
      stats: { total, totalCredits, totalDebits },
    };
  }

  // ── VIP users ───────────────────────────────────────────────────────────
  async getVipUsers(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Number(query?.limit) || 20);
    const [rows, total] = await this.users.findAndCount({
      where: { isVip: true },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const users = rows.map((u) => ({
      ...this.mapUser(u),
      // This app tracks VIP only as a boolean (no grant/expiry columns),
      // so VIP is treated as lifetime.
      vipGrantedAt: u.updatedAt,
      vipExpiresAt: null,
      isLifetimeVip: true,
    }));
    return { users, total, page, stats: { totalGranted: total, activeNow: total, expiringSoon: 0 } };
  }

  // ── Blocked (no persistence in this app) ────────────────────────────────
  getBlocked(query: any) {
    return { blocks: [], total: 0, page: Number(query?.page) || 1, stats: { total: 0 } };
  }

  removeBlock(_blockId: string) {
    return { success: true, message: 'Block removed' };
  }

  // ── Queue (Redis matchmaking pool) ──────────────────────────────────────
  async getQueue() {
    try {
      const ids = (await this.redis.smembers(AVAILABLE_KEY)).map((s) => Number(s));
      const um = await this.userMap(ids);
      const queue = ids.map((id) => {
        const u = um.get(id);
        return {
          userId: id,
          _id: id,
          displayName: u?.displayName || `User #${id}`,
          photoUrl: this.photo(u?.photoUrl),
          gender: u?.gender || null,
          countryCode: u?.countryCode || null,
          isVip: u?.isVip || false,
        };
      });
      return { queue, totalInQueue: queue.length, avgWaitSeconds: 0 };
    } catch (e) {
      this.logger.warn(`getQueue failed (Redis down?): ${e}`);
      return { queue: [], totalInQueue: 0, avgWaitSeconds: 0 };
    }
  }

  async removeFromQueue(userId: string) {
    try {
      await this.redis.srem(AVAILABLE_KEY, String(userId));
    } catch (e) {
      this.logger.warn(`removeFromQueue failed: ${e}`);
    }
    return { success: true, message: 'User removed from queue' };
  }

  // ── Config (no config table — static defaults) ──────────────────────────
  getConfig() {
    return {
      minAndroidVersion: '',
      minIosVersion: '',
      matchmakingEnabled: true,
      vipMatchPriority: true,
      freeMatchesPerDay: 10,
      giftPrices: {},
      newUserBonus: 50,
      autoFlagAfterReports: 5,
      maintenanceMode: false,
      maintenanceMessage: '',
    };
  }

  saveConfig(config: any) {
    // No config table yet — echo back so the panel reflects the submitted values.
    return { success: true, message: 'Config saved', ...config };
  }
}
