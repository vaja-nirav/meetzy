import { Controller, Get, Query } from '@nestjs/common';
import { MosaicService } from '../admin/mosaic.service';
import { PeopleService } from '../admin/people.service';

/**
 * Public, unauthenticated routes consumed by the Flutter mobile app.
 * No AdminGuard here on purpose.
 */
@Controller('app')
export class AppController {
  constructor(
    private readonly mosaicService: MosaicService,
    private readonly peopleService: PeopleService,
  ) {}

  @Get('login-mosaic')
  getLoginMosaic() {
    return this.mosaicService.getActiveForApp();
  }

  // People page (Popular tab) — only active profiles
  @Get('people')
  getPeople(@Query() query: any) {
    return this.peopleService.getActiveForApp(query);
  }
}
