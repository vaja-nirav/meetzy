import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PurchasedCoin } from './entities/wallet.entity';
import { UsedCoin } from './entities/transaction.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(PurchasedCoin)
    private readonly purchasedCoinRepository: Repository<PurchasedCoin>,
    @InjectRepository(UsedCoin)
    private readonly usedCoinRepository: Repository<UsedCoin>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  // Maintains compatibility with ProfileService setup
  async getOrCreateWallet(userId: number): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return { userId, balance: user.coins, currency: 'coins' };
  }

  async getBalance(userId: number): Promise<{ balance: number; currency: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return { balance: user.coins, currency: 'coins' };
  }

  // 1. Purchased Coins (Credits coins to the user and logs purchase)
  async credit(userId: number, amount: number, reason: string): Promise<PurchasedCoin> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');

      // Update total coins on the user table
      user.coins = (user.coins || 0) + amount;
      await manager.save(user);

      // Log purchase record
      const purchase = manager.create(PurchasedCoin, {
        userId,
        coins: amount,
        type: reason, // "Google Pay", "Stripe", "In-App Purchase", "Admin Credit" etc.
      });
      return manager.save(purchase);
    });
  }

  // 2. Used Coins (Debits coins from the user and logs reason)
  async debit(userId: number, amount: number, reason: string): Promise<UsedCoin> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');

      if ((user.coins || 0) < amount) {
        throw new BadRequestException('Insufficient coin balance');
      }

      // Update total coins on the user table
      user.coins = user.coins - amount;
      await manager.save(user);

      // Log usage record
      const usage = manager.create(UsedCoin, {
        userId,
        coins: amount,
        type: reason, // e.g. "video_call", "gift_sent:rose", etc.
      });
      return manager.save(usage);
    });
  }

  // Combines purchased and used coins history into a unified transaction log
  async getTransactions(userId: number, limit = 20, offset = 0): Promise<any[]> {
    const purchases = await this.purchasedCoinRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const usages = await this.usedCoinRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    const combined = [
      ...purchases.map(p => ({
        id: p.id,
        type: 'credit',
        amount: p.coins,
        reason: p.type,
        createdAt: p.createdAt,
      })),
      ...usages.map(u => ({
        id: u.id,
        type: 'debit',
        amount: u.coins,
        reason: u.type,
        createdAt: u.createdAt,
      })),
    ];

    // Sort by most recent
    combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return combined.slice(offset, offset + limit);
  }
}
