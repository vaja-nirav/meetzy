import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('used_coins')
export class UsedCoin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'int', default: 0 })
  coins!: number;

  @Column({ type: 'varchar' })
  type!: string; // e.g. reason to spend that coins

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne('User', 'usedCoins')
  @JoinColumn({ name: 'user_id' })
  user: any;
}
