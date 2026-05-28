import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private admin: any = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn('Firebase credentials missing — push notifications disabled');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.admin = require('firebase-admin');
      if (!this.admin.apps?.length) {
        this.admin.initializeApp({
          credential: this.admin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
        });
      }
      this.logger.log('Firebase Admin initialized');
    } catch {
      this.logger.warn('firebase-admin not installed — run: npm install firebase-admin');
    }
  }

  async sendPushNotification(
    userId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.admin) return;

    const user = await this.usersService.findById(userId);
    if (!user?.fcmToken) return;

    try {
      await this.admin.messaging().send({
        token: user.fcmToken,
        notification: { title, body },
        data: data ?? {},
        android: { priority: 'high' },
        apns: { payload: { aps: { contentAvailable: true, sound: 'default' } } },
      });
    } catch (err) {
      this.logger.error(`Push notification failed for ${userId}: ${err}`);
    }
  }

  async saveFcmToken(userId: number, fcmToken: string): Promise<void> {
    await this.usersService.setFcmToken(userId, fcmToken);
  }
}
