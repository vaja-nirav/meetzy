import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum TransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  walletId: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: number;

  @Column({ type: 'varchar' })
  reason: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  balanceAfter: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne('Wallet', 'transactions')
  @JoinColumn({ name: 'walletId' })
  wallet: any;
}
