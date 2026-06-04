import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Patch,
  Delete,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { AdminService } from './admin.service';
import { MosaicService } from './mosaic.service';
import { AdminGuard } from './guards/admin.guard';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly mosaicService: MosaicService,
  ) {}

  // PUBLIC — no guard on login
  @Post('login')
  @UseInterceptors(AnyFilesInterceptor())
  login(@Body() body: any) {
    return this.adminService.login(body?.email, body?.password);
  }

  // PROTECTED — everything below requires a valid admin token
  @UseGuards(AdminGuard)
  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @UseGuards(AdminGuard)
  @Get('users')
  getUsers(@Query() query: any) {
    return this.adminService.getUsers(query);
  }

  @UseGuards(AdminGuard)
  @Get('users/:userId')
  getUserById(@Param('userId') userId: string) {
    return this.adminService.getUserById(userId);
  }

  @UseGuards(AdminGuard)
  @Patch('users/:userId/ban')
  banUser(@Param('userId') userId: string, @Body() body: any) {
    return this.adminService.banUser(userId, body?.action, body?.reason);
  }

  @UseGuards(AdminGuard)
  @Patch('users/:userId/vip')
  updateVip(@Param('userId') userId: string, @Body() body: any) {
    return this.adminService.updateVip(userId, body?.action, body?.durationDays);
  }

  @UseGuards(AdminGuard)
  @Post('users/:userId/coins')
  updateCoins(@Param('userId') userId: string, @Body() body: any) {
    return this.adminService.updateCoins(userId, body?.action, body?.amount, body?.reason);
  }

  @UseGuards(AdminGuard)
  @Get('calls')
  getCalls(@Query() query: any) {
    return this.adminService.getCalls(query);
  }

  @UseGuards(AdminGuard)
  @Get('calls/active')
  getActiveCalls() {
    return this.adminService.getActiveCalls();
  }

  @UseGuards(AdminGuard)
  @Delete('calls/:roomId/terminate')
  terminateCall(@Param('roomId') roomId: string) {
    return this.adminService.terminateCall(roomId);
  }

  @UseGuards(AdminGuard)
  @Get('reports')
  getReports(@Query() query: any) {
    return this.adminService.getReports(query);
  }

  @UseGuards(AdminGuard)
  @Patch('reports/:reportId')
  updateReport(@Param('reportId') reportId: string, @Body() body: any) {
    return this.adminService.updateReport(reportId, body?.status, body?.adminNote);
  }

  @UseGuards(AdminGuard)
  @Get('transactions')
  getTransactions(@Query() query: any) {
    return this.adminService.getTransactions(query);
  }

  @UseGuards(AdminGuard)
  @Get('vip/users')
  getVipUsers(@Query() query: any) {
    return this.adminService.getVipUsers(query);
  }

  @UseGuards(AdminGuard)
  @Get('blocked')
  getBlocked(@Query() query: any) {
    return this.adminService.getBlocked(query);
  }

  @UseGuards(AdminGuard)
  @Delete('blocked/:blockId')
  removeBlock(@Param('blockId') blockId: string) {
    return this.adminService.removeBlock(blockId);
  }

  @UseGuards(AdminGuard)
  @Get('queue')
  getQueue() {
    return this.adminService.getQueue();
  }

  @UseGuards(AdminGuard)
  @Delete('queue/:userId')
  removeFromQueue(@Param('userId') userId: string) {
    return this.adminService.removeFromQueue(userId);
  }

  @UseGuards(AdminGuard)
  @Get('config')
  getConfig() {
    return this.adminService.getConfig();
  }

  @UseGuards(AdminGuard)
  @Post('config')
  saveConfig(@Body() body: any) {
    return this.adminService.saveConfig(body);
  }

  // ── LOGIN MOSAIC CRUD ─────────────────────────────────────────────────────
  // PUBLIC — any user (e.g. the Flutter app) can read mosaic entries without a token
  @Get('mosaic')
  getMosaic(@Query() query: any) {
    return this.mosaicService.getAll(query);
  }

  @UseGuards(AdminGuard)
  @Post('mosaic')
  createMosaic(@Body() body: any) {
    return this.mosaicService.create(body);
  }

  @UseGuards(AdminGuard)
  @Patch('mosaic/:id')
  updateMosaic(@Param('id') id: string, @Body() body: any) {
    return this.mosaicService.update(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('mosaic/:id')
  deleteMosaic(@Param('id') id: string) {
    return this.mosaicService.delete(id);
  }

  @UseGuards(AdminGuard)
  @Patch('mosaic/:id/status')
  updateMosaicStatus(@Param('id') id: string, @Body() body: any) {
    return this.mosaicService.updateStatus(id, body?.status);
  }
}
