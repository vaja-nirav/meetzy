import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  balance: number;

  @Column({ default: 'coins' })
  currency: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne('User', 'wallet')
  @JoinColumn({ name: 'userId' })
  user: any;

  @OneToMany('Transaction', 'wallet', { cascade: true, eager: false })
  transactions: any[];
}
