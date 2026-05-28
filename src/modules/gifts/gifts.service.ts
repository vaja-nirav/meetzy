import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gift } from './entities/gift.entity';
import { WalletService } from '../wallet/wallet.service';

export const GIFT_CATALOG = [
  { id: 'rose', name: 'Rose', coinsValue: 10, animation: 'rose_shower', emoji: '🌹' },
  { id: 'heart', name: 'Heart', coinsValue: 20, animation: 'heart_burst', emoji: '❤️' },
  { id: 'diamond', name: 'Diamond', coinsValue: 100, animation: 'diamond_sparkle', emoji: '💎' },
  { id: 'crown', name: 'Crown', coinsValue: 200, animation: 'crown_float', emoji: '👑' },
  { id: 'car', name: 'Sports Car', coinsValue: 500, animation: 'car_drive', emoji: '🏎️' },
  { id: 'rocket', name: 'Rocket', coinsValue: 1000, animation: 'rocket_launch', emoji: '🚀' },
];

@Injectable()
export class GiftsService {
  constructor(
    @InjectRepository(Gift)
    private readonly giftRepository: Repository<Gift>,
    private readonly walletService: WalletService,
  ) {}

  getCatalog() {
    return GIFT_CATALOG;
  }

  async sendGift(
    senderId: number,
    receiverId: number,
    roomId: string,
    giftType: string,
  ): Promise<Gift> {
    const giftDef = GIFT_CATALOG.find((g) => g.id === giftType);
    if (!giftDef) throw new BadRequestException('Invalid gift type');

    await this.walletService.debit(senderId, giftDef.coinsValue, `gift_sent:${giftType}`);
    await this.walletService.credit(receiverId, giftDef.coinsValue, `gift_received:${giftType}`);

    const gift = this.giftRepository.create({
      senderId,
      receiverId,
      roomId,
      giftType,
      coinsValue: giftDef.coinsValue,
    });
    return this.giftRepository.save(gift);
  }

  async getHistory(userId: number, limit = 20, offset = 0): Promise<Gift[]> {
    return this.giftRepository
      .createQueryBuilder('gift')
      .where('gift.senderId = :userId OR gift.receiverId = :userId', { userId })
      .orderBy('gift.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
  }
}
