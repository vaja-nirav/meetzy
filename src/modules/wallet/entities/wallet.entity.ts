import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('purchased_coins')
export class PurchasedCoin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'int', default: 0 })
  coins!: number;

  @Column({ type: 'varchar' })
  type!: string; // e.g. "Google Pay", "Stripe", "In-App Purchase", etc.

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne('User', 'purchases')
  @JoinColumn({ name: 'user_id' })
  user: any;
}
