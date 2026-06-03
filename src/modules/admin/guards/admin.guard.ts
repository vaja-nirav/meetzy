import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const auth: string | undefined = request.headers.authorization;

    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    const token = auth.slice('Bearer '.length).trim();

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('ADMIN_JWT_SECRET'),
      });

      if (payload.role !== 'admin') {
        throw new UnauthorizedException('Access denied');
      }

      request.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
