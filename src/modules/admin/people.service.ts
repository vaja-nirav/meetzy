import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, Like } from 'typeorm';
import {
  PeopleProfile,
  ProfileStatus,
  ProfileFeed,
} from './entities/people-profile.entity';
import { Country } from '../countries/entities/country.entity';

const MAX_COVER_IMAGES = 6;

/**
 * CRUD for admin-managed "People" profiles + a public feed for the app.
 * Responses are flat snake_case under a { success, data } envelope.
 */
@Injectable()
export class PeopleService {
  private readonly baseUrl: string;

  constructor(
    @InjectRepository(PeopleProfile) private readonly repo: Repository<PeopleProfile>,
    @InjectRepository(Country) private readonly countries: Repository<Country>,
    private readonly configService: ConfigService,
  ) {
    const port = this.configService.get<string>('PORT') || '3001';
    this.baseUrl = `http://localhost:${port}`;
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private img(url: string): string {
    if (!url) return url;
    return url.startsWith('/uploads/') ? `${this.baseUrl}${url}` : url;
  }

  private isValidImage(value: string): boolean {
    if (typeof value !== 'string' || !value.trim()) return false;
    if (value.startsWith('data:image/')) return true;
    if (value.startsWith('/uploads/')) return true;
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private toBool(value: any, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return !(s === 'false' || s === '0' || s === 'no');
  }

  // Accept arrays, JSON-string arrays, or comma-separated strings (form-urlencoded).
  private parseArray(value: any): string[] {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return [];
      if (s.startsWith('[')) {
        try {
          const a = JSON.parse(s);
          return Array.isArray(a) ? a.map((v) => String(v).trim()).filter(Boolean) : [];
        } catch {
          /* fall through */
        }
      }
      return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return [];
  }

  private assertStatus(value: any): ProfileStatus {
    if (!Object.values(ProfileStatus).includes(value)) {
      throw new BadRequestException('Invalid status value');
    }
    return value;
  }

  private assertFeed(value: any): ProfileFeed {
    if (!Object.values(ProfileFeed).includes(value)) {
      throw new BadRequestException('Invalid feed value (use "popular" or "new")');
    }
    return value;
  }

  private validateCovers(images: string[]): void {
    if (images.length > MAX_COVER_IMAGES) {
      throw new BadRequestException(`Maximum ${MAX_COVER_IMAGES} cover images allowed`);
    }
    for (const url of images) {
      if (!this.isValidImage(url)) {
        throw new BadRequestException('Invalid cover image URL');
      }
    }
  }

  private async loadCountry(countryId: number): Promise<Country> {
    const country = await this.countries.findOne({ where: { id: countryId } });
    if (!country) throw new BadRequestException('Invalid country');
    return country;
  }

  // Field readers that accept both snake_case and camelCase keys.
  private pick(data: any, snake: string, camel: string) {
    return data?.[snake] !== undefined ? data[snake] : data?.[camel];
  }

  // Full admin response shape (snake_case + nested country).
  private toResponse(e: PeopleProfile) {
    return {
      id: e.id,
      user_name: e.userName,
      age: e.age,
      blue_tick: e.blueTick,
      country: e.country
        ? { id: e.country.id, name: e.country.name, code: e.country.code, flag: e.country.flag }
        : null,
      about_me: e.aboutMe,
      languages: e.languages || [],
      cover_images: (e.coverImages || []).map((u) => this.img(u)),
      status: e.status,
      feed: e.feed,
      order: e.order,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    };
  }

  // Public (app) shape — no status / timestamps leaked.
  // `is_new` flags profiles added in the last 7 days (for the "NEW" badge on cards).
  private toPublic(e: PeopleProfile) {
    const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const isNew = e.createdAt ? Date.now() - new Date(e.createdAt).getTime() < NEW_WINDOW_MS : false;
    return {
      id: e.id,
      user_name: e.userName,
      age: e.age,
      blue_tick: e.blueTick,
      country: e.country
        ? { id: e.country.id, name: e.country.name, code: e.country.code, flag: e.country.flag }
        : null,
      about_me: e.aboutMe,
      languages: e.languages || [],
      cover_images: (e.coverImages || []).map((u) => this.img(u)),
      feed: e.feed,
      is_new: isNew,
      order: e.order,
    };
  }

  private async findFull(id: number): Promise<PeopleProfile | null> {
    return this.repo.findOne({ where: { id } }); // country is eager-loaded
  }

  // ── GET /admin/people ─────────────────────────────────────────────────────
  async getAll(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));

    const where: any = {};
    const status = query?.status;
    if (status && status !== 'all') where.status = this.assertStatus(status);
    const countryId = query?.country_id ?? query?.countryId;
    if (countryId) where.countryId = Number(countryId);
    const feed = query?.feed;
    if (feed && feed !== 'all') where.feed = this.assertFeed(feed);
    if (query?.search) where.userName = Like(`%${query.search}%`);

    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { order: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const [statTotal, active, inactive, blueTick, popular, newCount] = await Promise.all([
      this.repo.count(),
      this.repo.count({ where: { status: ProfileStatus.ACTIVE } }),
      this.repo.count({ where: { status: ProfileStatus.INACTIVE } }),
      this.repo.count({ where: { blueTick: true } }),
      this.repo.count({ where: { feed: ProfileFeed.POPULAR } }),
      this.repo.count({ where: { feed: ProfileFeed.NEW } }),
    ]);

    return {
      success: true,
      data: rows.map((e) => this.toResponse(e)),
      stats: { total: statTotal, active, inactive, blue_tick: blueTick, popular, new: newCount },
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 0,
      },
    };
  }

  // ── POST /admin/people ────────────────────────────────────────────────────
  async create(data: any) {
    const userName = this.pick(data, 'user_name', 'userName');
    const age = Number(this.pick(data, 'age', 'age'));
    const countryId = Number(this.pick(data, 'country_id', 'countryId'));
    const aboutMe = this.pick(data, 'about_me', 'aboutMe') ?? null;
    const blueTick = this.toBool(this.pick(data, 'blue_tick', 'blueTick'), false);
    const languages = this.parseArray(this.pick(data, 'languages', 'languages'));
    const coverImages = this.parseArray(this.pick(data, 'cover_images', 'coverImages'));
    const statusRaw = this.pick(data, 'status', 'status');
    const status = statusRaw ? this.assertStatus(statusRaw) : ProfileStatus.ACTIVE;
    const feedRaw = this.pick(data, 'feed', 'feed');
    const feed = feedRaw ? this.assertFeed(feedRaw) : ProfileFeed.POPULAR;
    const orderRaw = this.pick(data, 'order', 'order');

    if (!userName || !String(userName).trim()) {
      throw new BadRequestException('user_name is required');
    }
    if (!Number.isFinite(age) || age < 18 || age > 99) {
      throw new BadRequestException('age must be a number between 18 and 99');
    }
    if (!Number.isFinite(countryId)) {
      throw new BadRequestException('country_id is required');
    }
    await this.loadCountry(countryId);
    this.validateCovers(coverImages);

    const entry = this.repo.create({
      userName: String(userName).trim(),
      age,
      countryId,
      aboutMe,
      blueTick,
      languages,
      coverImages,
      status,
      feed,
      order: Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : 0,
    });
    const saved = await this.repo.save(entry);
    const full = await this.findFull(saved.id);

    return {
      success: true,
      message: 'Profile created successfully',
      data: this.toResponse(full!),
    };
  }

  // ── PATCH /admin/people/:id ───────────────────────────────────────────────
  async update(id: string, data: any) {
    const entry = await this.repo.findOne({ where: { id: Number(id) } });
    if (!entry) throw new NotFoundException('Profile not found');

    const userName = this.pick(data, 'user_name', 'userName');
    if (userName !== undefined) {
      if (!String(userName).trim()) throw new BadRequestException('user_name cannot be empty');
      entry.userName = String(userName).trim();
    }

    const ageRaw = this.pick(data, 'age', 'age');
    if (ageRaw !== undefined) {
      const age = Number(ageRaw);
      if (!Number.isFinite(age) || age < 18 || age > 99) {
        throw new BadRequestException('age must be a number between 18 and 99');
      }
      entry.age = age;
    }

    const countryId = this.pick(data, 'country_id', 'countryId');
    if (countryId !== undefined) {
      const cid = Number(countryId);
      if (!Number.isFinite(cid)) throw new BadRequestException('Invalid country_id');
      await this.loadCountry(cid);
      entry.countryId = cid;
    }

    const aboutMe = this.pick(data, 'about_me', 'aboutMe');
    if (aboutMe !== undefined) entry.aboutMe = aboutMe;

    const blueTick = this.pick(data, 'blue_tick', 'blueTick');
    if (blueTick !== undefined) entry.blueTick = this.toBool(blueTick, entry.blueTick);

    const languages = this.pick(data, 'languages', 'languages');
    if (languages !== undefined) entry.languages = this.parseArray(languages);

    const coverImages = this.pick(data, 'cover_images', 'coverImages');
    if (coverImages !== undefined) {
      const imgs = this.parseArray(coverImages);
      this.validateCovers(imgs);
      entry.coverImages = imgs;
    }

    const status = this.pick(data, 'status', 'status');
    if (status !== undefined) entry.status = this.assertStatus(status);

    const feed = this.pick(data, 'feed', 'feed');
    if (feed !== undefined) entry.feed = this.assertFeed(feed);

    const order = this.pick(data, 'order', 'order');
    if (order !== undefined && Number.isFinite(Number(order))) entry.order = Number(order);

    await this.repo.save(entry);
    const full = await this.findFull(entry.id);

    return {
      success: true,
      message: 'Profile updated successfully',
      data: this.toResponse(full!),
    };
  }

  // ── DELETE /admin/people/:id ──────────────────────────────────────────────
  async delete(id: string) {
    const entry = await this.repo.findOne({ where: { id: Number(id) } });
    if (!entry) throw new NotFoundException('Profile not found');
    await this.repo.remove(entry);
    return { success: true, message: 'Profile deleted successfully' };
  }

  // ── PATCH /admin/people/:id/status ────────────────────────────────────────
  async updateStatus(id: string, status: string) {
    const value = this.assertStatus(status);
    const entry = await this.repo.findOne({ where: { id: Number(id) } });
    if (!entry) throw new NotFoundException('Profile not found');
    entry.status = value;
    await this.repo.save(entry);
    return {
      success: true,
      message: `Status updated to ${value}`,
      data: { id: entry.id, status: entry.status },
    };
  }

  // ── GET /app/people (public, app's People page) ───────────────────────────
  async getActiveForApp(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query?.limit) || 20));

    // Tab filter for the People page — filters by the admin-chosen `feed`:
    //   ?tab=popular → only profiles marked "popular"
    //   ?tab=new     → only profiles marked "new"
    //   (no tab)     → all active profiles
    const where: any = { status: ProfileStatus.ACTIVE };
    let tab: string | null = null;
    if (query?.tab === 'popular' || query?.tab === 'new') {
      tab = query.tab;
      where.feed = tab;
    }

    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { order: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      success: true,
      tab,
      data: rows.map((e) => this.toPublic(e)),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 0,
      },
    };
  }
}
