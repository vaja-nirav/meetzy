import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Repository, EntityManager } from 'typeorm';
import { User } from './entities/user.entity';
import { UserPhoto } from './entities/user-photo.entity';
import { Country } from '../countries/entities/country.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserPhoto)
    private readonly photoRepository: Repository<UserPhoto>,
    private readonly entityManager: EntityManager,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: { photos: true, country: true },
      order: {
        photos: {
          sortOrder: 'ASC',
          createdAt: 'ASC',
        },
      },
    });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { googleId },
      relations: { photos: true, country: true },
      order: {
        photos: {
          sortOrder: 'ASC',
          createdAt: 'ASC',
        },
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: { photos: true, country: true },
      order: {
        photos: {
          sortOrder: 'ASC',
          createdAt: 'ASC',
        },
      },
    });
  }

  async create(data: CreateUserDto): Promise<User> {
    const countryId = (data as any).countryId;
    const countryCode = (data as any).countryCode;
    const countryName = (data as any).countryName;

    if (countryId) {
      const country = await this.entityManager.findOne(Country, {
        where: { id: countryId },
      });
      if (country) {
        (data as any).countryName = country.name;
        (data as any).countryCode = country.code;
      }
    } else if (countryCode) {
      const country = await this.entityManager.findOne(Country, {
        where: { code: countryCode.toUpperCase() },
      });
      if (country) {
        (data as any).countryId = country.id;
        (data as any).countryName = country.name;
        (data as any).countryCode = country.code;
      }
    } else if (countryName) {
      const country = await this.entityManager.findOne(Country, {
        where: { name: countryName },
      });
      if (country) {
        (data as any).countryId = country.id;
        (data as any).countryName = country.name;
        (data as any).countryCode = country.code;
      }
    }

    const user = this.userRepository.create(data as any);
    const saved = await this.userRepository.save(user as any) as any;
    const loaded = await this.findById(saved.id);
    if (!loaded) throw new NotFoundException('User not found after creation');
    return loaded;
  }

  async update(id: number, data: UpdateUserDto): Promise<User> {
    const { url, cover_images, ...dbData } = data;

    if (Object.keys(dbData).length > 0) {
      const countryId = (dbData as any).countryId;
      const countryCode = (dbData as any).countryCode;
      const countryName = (dbData as any).countryName;

      if (countryId) {
        const country = await this.entityManager.findOne(Country, {
          where: { id: countryId },
        });
        if (country) {
          (dbData as any).countryName = country.name;
          (dbData as any).countryCode = country.code;
        }
      } else if (countryCode) {
        const country = await this.entityManager.findOne(Country, {
          where: { code: countryCode.toUpperCase() },
        });
        if (country) {
          (dbData as any).countryId = country.id;
          (dbData as any).countryName = country.name;
          (dbData as any).countryCode = country.code;
        }
      } else if (countryName) {
        const country = await this.entityManager.findOne(Country, {
          where: { name: countryName },
        });
        if (country) {
          (dbData as any).countryId = country.id;
          (dbData as any).countryName = country.name;
          (dbData as any).countryCode = country.code;
        }
      }

      await this.userRepository.update(id, dbData as any);
    }

    if (url) {
      await this.addPhoto(id, url);
    }

    if (cover_images) {
      await this.updatePhotos(id, cover_images);
    }

    const updated = await this.userRepository.findOne({
      where: { id },
      relations: { photos: true, country: true },
    });
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

  async findActiveUsers(
    currentUserId: number,
    gender: string = 'all',
    limit: number = 20,
  ): Promise<User[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const baseQuery = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.photos', 'photos')
      .where('user.isOnline = :isOnline', { isOnline: true })
      .andWhere('user.isBanned = :isBanned', { isBanned: false })
      .andWhere('user.isProfileComplete = :isProfileComplete', { isProfileComplete: true })
      .andWhere('user.id != :currentUserId', { currentUserId });

    if (gender === 'female') {
      return baseQuery
        .andWhere('user.gender = :gender', { gender: 'female' })
        .orderBy('RAND()')
        .take(safeLimit)
        .getMany();
    }

    if (gender === 'male') {
      return baseQuery
        .andWhere('user.gender = :gender', { gender: 'male' })
        .orderBy('RAND()')
        .take(safeLimit)
        .getMany();
    }

    // Default 'all': 80% Female / 20% Male target ratio
    const femaleTarget = Math.round(safeLimit * 0.8);
    const maleTarget = safeLimit - femaleTarget;

    // Fetch females
    const females = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.photos', 'photos')
      .where('user.isOnline = :isOnline', { isOnline: true })
      .andWhere('user.isBanned = :isBanned', { isBanned: false })
      .andWhere('user.isProfileComplete = :isProfileComplete', { isProfileComplete: true })
      .andWhere('user.id != :currentUserId', { currentUserId })
      .andWhere('user.gender = :gender', { gender: 'female' })
      .orderBy('RAND()')
      .take(femaleTarget)
      .getMany();

    // Fetch males
    const males = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.photos', 'photos')
      .where('user.isOnline = :isOnline', { isOnline: true })
      .andWhere('user.isBanned = :isBanned', { isBanned: false })
      .andWhere('user.isProfileComplete = :isProfileComplete', { isProfileComplete: true })
      .andWhere('user.id != :currentUserId', { currentUserId })
      .andWhere('user.gender = :gender', { gender: 'male' })
      .orderBy('RAND()')
      .take(maleTarget)
      .getMany();

    const combined = [...females, ...males];

    // Fallback: If not enough females, fill remaining slots with males
    if (females.length < femaleTarget && combined.length < safeLimit) {
      const needed = safeLimit - combined.length;
      const excludeIds = combined.map((u) => u.id);
      
      const extraMalesQuery = this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.photos', 'photos')
        .where('user.isOnline = :isOnline', { isOnline: true })
        .andWhere('user.isBanned = :isBanned', { isBanned: false })
        .andWhere('user.isProfileComplete = :isProfileComplete', { isProfileComplete: true })
        .andWhere('user.id != :currentUserId', { currentUserId })
        .andWhere('user.gender = :gender', { gender: 'male' });

      if (excludeIds.length > 0) {
        extraMalesQuery.andWhere('user.id NOT IN (:...excludeIds)', { excludeIds });
      }

      const extraMales = await extraMalesQuery
        .orderBy('RAND()')
        .take(needed)
        .getMany();

      combined.push(...extraMales);
    }

    // Fallback: If not enough males, fill remaining slots with females
    if (males.length < maleTarget && combined.length < safeLimit) {
      const needed = safeLimit - combined.length;
      const excludeIds = combined.map((u) => u.id);

      const extraFemalesQuery = this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.photos', 'photos')
        .where('user.isOnline = :isOnline', { isOnline: true })
        .andWhere('user.isBanned = :isBanned', { isBanned: false })
        .andWhere('user.isProfileComplete = :isProfileComplete', { isProfileComplete: true })
        .andWhere('user.id != :currentUserId', { currentUserId })
        .andWhere('user.gender = :gender', { gender: 'female' });

      if (excludeIds.length > 0) {
        extraFemalesQuery.andWhere('user.id NOT IN (:...excludeIds)', { excludeIds });
      }

      const extraFemales = await extraFemalesQuery
        .orderBy('RAND()')
        .take(needed)
        .getMany();

      combined.push(...extraFemales);
    }

    // Shuffle combined list in-memory
    return combined.sort(() => Math.random() - 0.5);
  }

  async deleteUser(userId: number): Promise<void> {
    // 1. Clean up Redis state
    await this.redis.srem('meetzy:available', String(userId));
    await this.redis.del(`meetzy:user:room:${userId}`);

    // 2. Perform database deletes in a transaction
    await this.entityManager.transaction(async (manager) => {
      // Delete purchased & used coins
      await manager.delete('purchased_coins', { userId });
      await manager.delete('used_coins', { userId });

      // Delete gifts (where user is sender or receiver)
      await manager.delete('gifts', { senderId: userId });
      await manager.delete('gifts', { receiverId: userId });

      // Delete call rooms (where user is participant A or B)
      await manager.delete('call_rooms', { userAId: userId });
      await manager.delete('call_rooms', { userBId: userId });

      // Delete messages (where user is sender or receiver)
      await manager.delete('messages', { senderId: userId });
      await manager.delete('messages', { receiverId: userId });

      // Delete photos
      await manager.delete('user_photos', { userId });

      // Delete user profile
      await manager.delete('users', { id: userId });
    });
  }
}
