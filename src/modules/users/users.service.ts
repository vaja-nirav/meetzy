import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserPhoto } from './entities/user-photo.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserPhoto)
    private readonly photoRepository: Repository<UserPhoto>,
  ) {}

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { googleId } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async create(data: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  async update(id: number, data: UpdateUserDto): Promise<User> {
    await this.userRepository.update(id, data as any);
    const updated = await this.findById(id);
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async setOnlineStatus(id: number, isOnline: boolean): Promise<void> {
    await this.userRepository.update(id, { isOnline });
  }

  async banUser(id: number): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.userRepository.update(id, { isBanned: true, isOnline: false });
  }

  async countOnline(): Promise<number> {
    return this.userRepository.count({ where: { isOnline: true, isBanned: false } });
  }

  async markProfileComplete(id: number): Promise<void> {
    await this.userRepository.update(id, { isProfileComplete: true });
  }

  async setFcmToken(id: number, fcmToken: string): Promise<void> {
    await this.userRepository.update(id, { fcmToken });
  }

  // ─── Photos ───────────────────────────────────────────────────────

  async getPhotos(userId: number): Promise<UserPhoto[]> {
    return this.photoRepository.find({
      where: { userId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async addPhoto(userId: number, url: string): Promise<UserPhoto> {
    const count = await this.photoRepository.count({ where: { userId } });
    if (count >= 6) {
      throw new BadRequestException('Maximum 6 photos allowed');
    }
    const photo = this.photoRepository.create({ userId, url, sortOrder: count });
    return this.photoRepository.save(photo);
  }

  async addPhotosBulk(userId: number, urls: string[]): Promise<UserPhoto[]> {
    const count = await this.photoRepository.count({ where: { userId } });
    if (count + urls.length > 6) {
      throw new BadRequestException(
        `Maximum 6 photos allowed. You currently have ${count} and tried to add ${urls.length}.`,
      );
    }
    const newPhotos = urls.map((url, index) => {
      return this.photoRepository.create({
        userId,
        url,
        sortOrder: count + index,
      });
    });
    await this.photoRepository.save(newPhotos);
    return this.getPhotos(userId);
  }

  async updatePhotos(userId: number, urls: string[]): Promise<UserPhoto[]> {
    if (urls.length > 6) {
      throw new BadRequestException('Maximum 6 photos allowed');
    }
    // Delete all existing photos for this user
    await this.photoRepository.delete({ userId });

    // Save the new list of photos
    const newPhotos = urls.map((url, index) => {
      return this.photoRepository.create({
        userId,
        url,
        sortOrder: index,
      });
    });
    await this.photoRepository.save(newPhotos);
    return this.getPhotos(userId);
  }

  async deletePhoto(userId: number, photoId: number): Promise<void> {
    const photo = await this.photoRepository.findOne({
      where: { id: photoId, userId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.photoRepository.remove(photo);
    // Re-index sort orders after deletion
    const remaining = await this.photoRepository.find({
      where: { userId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    for (let i = 0; i < remaining.length; i++) {
      await this.photoRepository.update(remaining[i].id, { sortOrder: i });
    }
  }

  async reorderPhotos(userId: number, orderedIds: number[]): Promise<UserPhoto[]> {
    const photos = await this.photoRepository.find({ where: { userId } });
    const userPhotoIds = photos.map((p) => p.id);
    const valid = orderedIds.every((id) => userPhotoIds.includes(id));
    if (!valid) throw new BadRequestException('Invalid photo IDs');

    for (let i = 0; i < orderedIds.length; i++) {
      await this.photoRepository.update(orderedIds[i], { sortOrder: i });
    }
    return this.getPhotos(userId);
  }
}
