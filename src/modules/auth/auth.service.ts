import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
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
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      googlePayload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!googlePayload) throw new UnauthorizedException('Empty token payload');

    let user = await this.usersService.findByGoogleId(googlePayload.sub);
    const isNewUser = !user;

    if (!user) {
      user = await this.usersService.create({
        googleId: googlePayload.sub,
        email: googlePayload.email ?? '',
        displayName: googlePayload.name ?? 'User',
        photoUrl: googlePayload.picture,
      });
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
}
