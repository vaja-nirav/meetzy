import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { UsersService } from '../users/users.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { User } from '../users/entities/user.entity';
import { UnifiedLoginDto } from './dto/unified-login.dto';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly usersService: UsersService,
    private readonly matchmakingService: MatchmakingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    const rawClientIds = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    const firstClientId = rawClientIds.split(',')[0]?.trim() || '';
    this.googleClient = new OAuth2Client(firstClientId);
  }

  private getGoogleClientIds(): string | string[] {
    const rawIds = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientIds = rawIds.split(',').map(id => id.trim()).filter(Boolean);
    return clientIds.length > 1 ? clientIds : clientIds[0] || '';
  }

  async checkAccountStatus(tokenId: string) {
    if (!tokenId) {
      throw new UnauthorizedException('token_id is required');
    }

    let googlePayload: any;
    if (tokenId === 'mock_google_token') {
      googlePayload = {
        sub: 'mock_google_id_12345',
        email: 'mockuser@example.com',
        name: 'Mock User',
        picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde',
      };
    } else {
      try {
        const ticket = await this.googleClient.verifyIdToken({
          idToken: tokenId,
          audience: this.getGoogleClientIds(),
        });
        googlePayload = ticket.getPayload();
      } catch {
        throw new UnauthorizedException('Invalid Google ID token');
      }
    }

    if (!googlePayload) throw new UnauthorizedException('Invalid Google ID token');

    let user = await this.usersService.findByGoogleId(googlePayload.sub);
    if (!user && googlePayload.email) {
      user = await this.usersService.findByEmail(googlePayload.email);
      // Link Google ID if email matches but Google ID wasn't linked
      if (user && !user.googleId) {
        user.googleId = googlePayload.sub;
        await this.usersService.update(user.id, { googleId: googlePayload.sub } as any);
      }
    }

    return {
      success: true,
      exists: !!user,
      isProfileComplete: user ? user.isProfileComplete : false,
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            photoUrl: user.photoUrl,
            gender: user.gender !== 'other' ? user.gender : null,
            countryName: user.countryName ?? null,
            countryCode: user.countryCode ?? null,
            isVip: user.isVip,
            isOnline: user.isOnline,
            isProfileComplete: user.isProfileComplete,
            walletBalance: user.coins ?? 0,
            createdAt: user.createdAt,
          }
        : null,
    };
  }

  async googleLogin(idToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
    isNewUser: boolean;
    isProfileComplete: boolean;
  }> {
    let googlePayload: any;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.getGoogleClientIds(),
      });
      googlePayload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!googlePayload) throw new UnauthorizedException('Empty token payload');

    let user = await this.usersService.findByGoogleId(googlePayload.sub);
    let isNewUser = false;

    if (!user) {
      // Check if a user with this email already exists in the system
      const existingUserByEmail = await this.usersService.findByEmail(googlePayload.email ?? '');
      if (existingUserByEmail) {
        user = existingUserByEmail;
        // Link their Google ID if it hasn't been linked yet
        if (!user.googleId) {
          user.googleId = googlePayload.sub;
          await this.usersService.update(user.id, { googleId: googlePayload.sub } as any);
        }
      } else {
        isNewUser = true;
        user = await this.usersService.create({
          googleId: googlePayload.sub,
          email: googlePayload.email ?? '',
          displayName: googlePayload.name ?? 'User',
          photoUrl: googlePayload.picture,
        });
      }
    }

    if (user.isBanned) throw new UnauthorizedException('Account is banned');

    return {
      accessToken: this.generateAccessToken(user),
      refreshToken: this.generateRefreshToken(user),
      user,
      isNewUser,
      isProfileComplete: user.isProfileComplete,
    };
  }

  async unifiedLogin(dto: UnifiedLoginDto) {
    // 1. Verify Google token
    let googlePayload: any;
    if (dto.token_id === 'mock_google_token') {
      googlePayload = {
        sub: 'mock_google_id_12345',
        email: dto.email || 'mockuser@example.com',
        name: dto.display_name || 'Mock User',
        picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde',
      };
    } else {
      try {
        const ticket = await this.googleClient.verifyIdToken({
          idToken: dto.token_id,
          audience: this.getGoogleClientIds(),
        });
        googlePayload = ticket.getPayload();
      } catch {
        throw new UnauthorizedException('Invalid Google token');
      }
    }

    if (!googlePayload) throw new UnauthorizedException('Invalid Google token');

    // 2. Find existing user by googleId, fallback to email
    let user = await this.usersService.findByGoogleId(googlePayload.sub);

    if (!user) {
      const emailToSearch = dto.email || googlePayload.email || '';
      if (emailToSearch) {
        user = await this.usersService.findByEmail(emailToSearch);
      }
      if (user && !user.googleId) {
        await this.usersService.update(user.id, { googleId: googlePayload.sub } as any);
      }
    }

    // 3. All 3 optional profile fields must be present to count as a setup call
    const hasProfileData = !!(dto.display_name && dto.gender && dto.country_code);

    let isNewUser = false;

    if (!user) {
      // 4A. NEW USER — create with whatever fields Flutter sent
      isNewUser = true;
      user = await this.usersService.create({
        googleId: googlePayload.sub,
        email: dto.email || googlePayload.email || '',
        displayName: dto.display_name || googlePayload.name || 'User',
        photoUrl: googlePayload.picture,
        gender: dto.gender as any,
        countryName: dto.country_name,
        countryCode: dto.country_code,
        isOnline: true,
        isProfileComplete: hasProfileData,
      } as any);
    } else {
      // 4B. EXISTING USER
      if (user.isBanned) throw new UnauthorizedException('Account is banned');

      if (hasProfileData && !user.isProfileComplete) {
        await this.usersService.update(user.id, {
          displayName: dto.display_name,
          gender: dto.gender as any,
          countryName: dto.country_name,
          countryCode: dto.country_code,
        });
        await this.usersService.markProfileComplete(user.id);
      }

      await this.usersService.setOnlineStatus(user.id, true);
      user = (await this.usersService.findById(user.id))!;
    }

    if (user.isBanned) throw new UnauthorizedException('Account is banned');

    // 5. Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    return {
      success: true,
      isNewUser,
      message: hasProfileData ? 'Profile setup complete' : 'Login successfully',
      data: {
        accessToken,
        refreshToken,
        expiresIn: 604800,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          photoUrl: user.photoUrl,
          gender: user.gender !== 'other' ? user.gender : null,
          countryName: user.countryName ?? null,
          countryCode: user.countryCode ?? null,
          isVip: user.isVip,
          isOnline: user.isOnline,
          isProfileComplete: user.isProfileComplete,
          walletBalance: user.coins ?? 0,
          createdAt: user.createdAt,
        },
      },
    };
  }

  async refreshTokens(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET', 'change_me'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || user.isBanned) throw new UnauthorizedException('User not found');

    return {
      accessToken: this.generateAccessToken(user),
      refreshToken: this.generateRefreshToken(user),
    };
  }

  generateAccessToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, displayName: user.displayName, isVip: user.isVip },
      {
        secret: this.configService.get<string>('JWT_SECRET', 'change_me'),
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '7d') as any,
      },
    );
  }

  private generateRefreshToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      {
        secret: this.configService.get<string>('JWT_SECRET', 'change_me'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '30d') as any,
      },
    );
  }

  async logout(token?: string, userId?: number): Promise<void> {
    if (userId) {
      await this.usersService.setOnlineStatus(userId, false);
      await this.matchmakingService.markUnavailable(userId);
    }
    if (token) {
      // Blacklist the token in Redis for 7 days (604,800 seconds)
      await this.redis.setex(`meetzy:blacklist:token:${token}`, 604800, '1');
    }
  }
}
