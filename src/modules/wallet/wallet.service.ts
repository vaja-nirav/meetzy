import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
  ) {}

  async getOrCreateWallet(userId: number): Promise<Wallet> {
    let wallet = await this.walletRepository.findOne({ where: { userId } });
    if (!wallet) {
      wallet = this.walletRepository.create({ userId, balance: 0 });
      wallet = await this.walletRepository.save(wallet);
    }
    return wallet;
  }

  async getBalance(userId: number): Promise<{ balance: number; currency: string }> {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: Number(wallet.balance), currency: wallet.currency };
  }

  async credit(userId: number, amount: number, reason: string): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const wallet = await manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      wallet.balance = Number(wallet.balance) + amount;
      await manager.save(wallet);

      const tx = manager.create(Transaction, {
        walletId: wallet.id,
        type: TransactionType.CREDIT,
        amount,
        reason,
        balanceAfter: wallet.balance,
      });
      return manager.save(tx);
    });
  }

  async debit(userId: number, amount: number, reason: string): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const wallet = await manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');
      if (Number(wallet.balance) < amount) {
        throw new BadRequestException('Insufficient coin balance');
      }

      wallet.balance = Number(wallet.balance) - amount;
      await manager.save(wallet);

      const tx = manager.create(Transaction, {
        walletId: wallet.id,
        type: TransactionType.DEBIT,
        amount,
        reason,
        balanceAfter: wallet.balance,
      });
      return manager.save(tx);
    });
  }

  async getTransactions(userId: number, limit = 20, offset = 0): Promise<Transaction[]> {
    const wallet = await this.walletRepository.findOne({ where: { userId } });
    if (!wallet) return [];
    return this.transactionRepository.find({
      where: { walletId: wallet.id },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
