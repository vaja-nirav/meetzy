import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LoginMosaic,
  MosaicGender,
  MosaicStatus,
} from './entities/login-mosaic.entity';

@Injectable()
export class MosaicService {
  constructor(
    @InjectRepository(LoginMosaic)
    private readonly mosaicRepository: Repository<LoginMosaic>,
  ) {}

  // ── helpers ─────────────────────────────────────────────────────────────
  private isValidUrl(value: string): boolean {
    if (typeof value !== 'string' || !value.trim()) return false;
    // Accept http(s) URLs and base64 data URLs (from the Upload tab).
    if (value.startsWith('data:image/')) return true;
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private assertGender(value: any): MosaicGender {
    if (!Object.values(MosaicGender).includes(value)) {
      throw new BadRequestException('Invalid gender value');
    }
    return value;
  }

  private assertStatus(value: any): MosaicStatus {
    if (!Object.values(MosaicStatus).includes(value)) {
      throw new BadRequestException('Invalid status value');
    }
    return value;
  }

  // Coerce booleans that may arrive as strings ("false"/"0") from form-urlencoded bodies.
  private toBool(value: any, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return !(s === 'false' || s === '0' || s === 'no');
  }

  // Map a LoginMosaic entity (camelCase props) to the snake_case API shape.
  private toResponse(e: LoginMosaic) {
    return {
      id: e.id,
      photo_url: e.photoUrl,
      gender: e.gender,
      status: e.status,
      show_online_dot: e.showOnlineDot,
      order: e.order,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    };
  }

  // ── GET /admin/mosaic ───────────────────────────────────────────────────
  async getAll(query: any) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));

    const where: any = {};
    if (query?.status && query.status !== 'all') {
      where.status = this.assertStatus(query.status);
    }
    if (query?.gender && query.gender !== 'all') {
      where.gender = this.assertGender(query.gender);
    }

    const [entries, total] = await this.mosaicRepository.findAndCount({
      where,
      order: { order: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Global stats (always the whole table, regardless of filters).
    const [statTotal, active, inactive, male, female] = await Promise.all([
      this.mosaicRepository.count(),
      this.mosaicRepository.count({ where: { status: MosaicStatus.ACTIVE } }),
      this.mosaicRepository.count({ where: { status: MosaicStatus.INACTIVE } }),
      this.mosaicRepository.count({ where: { gender: MosaicGender.MALE } }),
      this.mosaicRepository.count({ where: { gender: MosaicGender.FEMALE } }),
    ]);

    return {
      success: true,
      data: entries.map((e) => this.toResponse(e)),
      stats: { total: statTotal, active, inactive, male, female },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  // ── POST /admin/mosaic ────────────────────────────────────────────────────
  async create(data: any) {
    const photoUrl = data?.photoUrl || data?.photo_url;
    const showOnlineDot = data?.showOnlineDot !== undefined ? data.showOnlineDot : data?.show_online_dot;

    if (!photoUrl) {
      throw new BadRequestException('photoUrl is required');
    }
    if (!this.isValidUrl(photoUrl)) {
      throw new BadRequestException('Invalid URL format');
    }
    const gender = this.assertGender(data.gender);
    const status = data.status ? this.assertStatus(data.status) : MosaicStatus.ACTIVE;

    const entry = this.mosaicRepository.create({
      photoUrl: photoUrl,
      gender,
      status,
      showOnlineDot: this.toBool(showOnlineDot, true),
      order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0,
    });
    const saved = await this.mosaicRepository.save(entry);

    return {
      success: true,
      message: 'Mosaic entry created successfully',
      data: this.toResponse(saved),
    };
  }

  // ── PATCH /admin/mosaic/:id ───────────────────────────────────────────────
  async update(id: string, data: any) {
    const entry = await this.mosaicRepository.findOne({ where: { id: Number(id) } });
    if (!entry) throw new NotFoundException('Entry not found');

    const photoUrl = data?.photoUrl !== undefined ? data.photoUrl : data?.photo_url;
    const showOnlineDot = data?.showOnlineDot !== undefined ? data.showOnlineDot : data?.show_online_dot;

    if (photoUrl !== undefined) {
      if (!this.isValidUrl(photoUrl)) {
        throw new BadRequestException('Invalid URL format');
      }
      entry.photoUrl = photoUrl;
    }
    if (data?.gender !== undefined) entry.gender = this.assertGender(data.gender);
    if (data?.status !== undefined) entry.status = this.assertStatus(data.status);
    if (showOnlineDot !== undefined) entry.showOnlineDot = this.toBool(showOnlineDot, entry.showOnlineDot);
    if (data?.order !== undefined && Number.isFinite(Number(data.order))) {
      entry.order = Number(data.order);
    }

    const saved = await this.mosaicRepository.save(entry);
    return {
      success: true,
      message: 'Mosaic entry updated successfully',
      data: this.toResponse(saved),
    };
  }

  // ── DELETE /admin/mosaic/:id ──────────────────────────────────────────────
  async delete(id: string) {
    const entry = await this.mosaicRepository.findOne({ where: { id: Number(id) } });
    if (!entry) throw new NotFoundException('Entry not found');
    await this.mosaicRepository.remove(entry);
    return { success: true, message: 'Mosaic entry deleted successfully' };
  }

  // ── PATCH /admin/mosaic/:id/status ────────────────────────────────────────
  async updateStatus(id: string, status: string) {
    const value = this.assertStatus(status);
    const entry = await this.mosaicRepository.findOne({ where: { id: Number(id) } });
    if (!entry) throw new NotFoundException('Entry not found');
    entry.status = value;
    await this.mosaicRepository.save(entry);
    return {
      success: true,
      message: `Status updated to ${value}`,
      data: { id: entry.id, status: entry.status },
    };
  }

  // ── GET /app/login-mosaic (public, Flutter) ───────────────────────────────
  async getActiveForApp() {
    const entries = await this.mosaicRepository.find({
      where: { status: MosaicStatus.ACTIVE },
      order: { order: 'ASC', createdAt: 'DESC' },
      take: 20,
    });

    return {
      success: true,
      data: {
        entries: entries.map((e) => ({
          id: e.id,
          photo_url: e.photoUrl,
          gender: e.gender,
          show_online_dot: e.showOnlineDot,
          order: e.order,
        })),
        total: entries.length,
      },
    };
  }
}
