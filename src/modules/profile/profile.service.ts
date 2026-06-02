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
import { Gender } from '../users/entities/user.entity';

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

  async getOwnProfile(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const authData = this.authService.getAuthResponse(user);
    return {
      success: true,
      data: authData,
    };
  }

  async updateProfile(userId: number, dto: UpdateUserDto) {
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

    return this.usersService.update(userId, dto);
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
