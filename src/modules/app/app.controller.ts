import { Controller, Get } from '@nestjs/common';
import { MosaicService } from '../admin/mosaic.service';

/**
 * Public, unauthenticated routes consumed by the Flutter mobile app.
 * No AdminGuard here on purpose.
 */
@Controller('app')
export class AppController {
  constructor(private readonly mosaicService: MosaicService) {}

  @Get('login-mosaic')
  getLoginMosaic() {
    return this.mosaicService.getActiveForApp();
  }
}
