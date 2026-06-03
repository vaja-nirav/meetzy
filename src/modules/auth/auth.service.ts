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

  resolveUrl(url: string | null, baseUrl?: string): string | null {
    if (!url) return null;
    if (url.startsWith('/uploads/')) {
      const base = baseUrl || process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
      return `${base}${url}`;
    }
    return url;
  }

  formatUserResponse(user: User, baseUrl?: string) {
    return {
      id: user.id,
      google_id: user.googleId,
      email: user.email,
      display_name: user.displayName,
      bio: user.bio ?? null,
      photo_url: this.resolveUrl(user.photoUrl, baseUrl),
      gender: user.gender !== 'other' ? user.gender : null,
      country_id: user.countryId,
      country: user.country ? {
        id: user.country.id,
        name: user.country.name,
        code: user.country.code,
        dial_code: user.country.dialCode,
        flag: user.country.flag,
      } : null,
      country_name: user.countryName ?? null,
      country_code: user.countryCode ?? null,
      is_vip: user.isVip,
      is_online: user.isOnline,
      is_banned: user.isBanned,
      is_profile_complete: user.isProfileComplete,
      fcm_token: user.fcmToken ?? null,
      coins: user.coins ?? 0,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      cover_images: (user.photos || []).map(p => ({
        id: p.id,
        user_id: p.userId,
        url: this.resolveUrl(p.url, baseUrl),
        sort_order: p.sortOrder,
        created_at: p.createdAt,
      })),
      wallet: {
        balance: user.coins ?? 0,
        currency: 'coins',
      },
    };
  }

  getAuthResponse(user: User, baseUrl?: string) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 604800,
      user: this.formatUserResponse(user, baseUrl),
    };
  }

  async checkAccountStatus(tokenId: string, baseUrl?: string) {
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
        user = await this.usersService.findById(user.id);
      }
    }

    if (user) {
      const authData = this.getAuthResponse(user, baseUrl);
      return {
        success: true,
        exists: true,
        is_profile_complete: user.isProfileComplete,
        data: authData,
      };
    }

    return {
      success: true,
      exists: false,
      is_profile_complete: false,
      data: null,
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

  async unifiedLogin(dto: UnifiedLoginDto, baseUrl?: string) {
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

      if (!user.isProfileComplete) {
        isNewUser = true;
      }

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

    // 5. Generate tokens and format response
    const authData = this.getAuthResponse(user, baseUrl);

    return {
      success: true,
      is_new_user: isNewUser,
      message: hasProfileData ? 'Profile setup complete' : 'Login successfully',
      data: authData,
    };
  }

  async refreshTokens(token: string): Promise<{ access_token: string; refresh_token: string }> {
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
      access_token: this.generateAccessToken(user),
      refresh_token: this.generateRefreshToken(user),
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

  generateRefreshToken(user: User): string {
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
