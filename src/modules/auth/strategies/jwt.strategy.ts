import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'change_me'),
      passReqToCallback: true,
    });
  }

  async validate(
    req: any,
    payload: { sub: any; email: string; displayName: string },
  ) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const isBlacklisted = await this.redis.get(`meetzy:blacklist:token:${token}`);
      if (isBlacklisted) {
        throw new UnauthorizedException('Session expired or logged out');
      }
    }

    const user = await this.usersService.findById(Number(payload.sub));
    if (!user || user.isBanned) {
      throw new UnauthorizedException('User not found or banned');
    }
    return user;
  }
}
