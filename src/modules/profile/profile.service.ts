import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthService } from '../auth/auth.service';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { SetupProfileDto } from './dto/setup-profile.dto';
import { Gender, User } from '../users/entities/user.entity';

@Injectable()
export class ProfileService {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly authService: AuthService,
  ) {}

  async setupProfile(userId: number, dto: SetupProfileDto) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.isProfileComplete) {
      throw new ConflictException('Profile is already set up');
    }

    const updated = await this.usersService.update(userId, {
      displayName: dto.displayName,
      countryId: dto.countryId,
      gender: dto.gender,
    });

    // Mark profile as complete
    await this.usersService.markProfileComplete(userId);

    // Create wallet for the user on first setup
    await this.walletService.getOrCreateWallet(userId);

    return {
      ...updated,
      isProfileComplete: true,
      message: 'Profile setup complete',
    };
  }

  resolveUserUrls(user: User, baseUrl?: string): User {
    if (!baseUrl) return user;
    if (user.photoUrl && user.photoUrl.startsWith('/uploads/')) {
      user.photoUrl = `${baseUrl}${user.photoUrl}`;
    }
    if (user.photos) {
      user.photos = user.photos.map(p => {
        if (p.url && p.url.startsWith('/uploads/')) {
          p.url = `${baseUrl}${p.url}`;
        }
        return p;
      });
    }
    return user;
  }

  async getOwnProfile(userId: number, baseUrl?: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const authData = this.authService.getAuthResponse(user, baseUrl);
    return {
      success: true,
      is_new_user: false,
      message: 'Profile retrieved successfully',
      data: authData,
    };
  }

  async updateProfile(userId: number, dto: UpdateUserDto, baseUrl?: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Gender is permanent once set to male or female
    if (
      dto.gender &&
      user.gender !== Gender.OTHER &&
      dto.gender !== user.gender
    ) {
      throw new BadRequestException('Gender cannot be changed once set');
    }

    const updated = await this.usersService.update(userId, dto);
    const authData = this.authService.getAuthResponse(updated, baseUrl);
    return {
      success: true,
      is_new_user: false,
      message: 'Profile updated successfully',
      data: authData,
    };
  }

  async getPublicProfile(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const { googleId, email, fcmToken, isBanned, ...publicProfile } = user as any;
    return publicProfile;
  }

  async reportUser(reporterId: number, reportedId: number, reason: string) {
    const reported = await this.usersService.findById(reportedId);
    if (!reported) throw new NotFoundException('User not found');
    return { message: 'User reported successfully', reportedId, reason };
  }
}
