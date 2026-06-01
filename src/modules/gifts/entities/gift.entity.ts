import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('gifts')
export class Gift {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  senderId!: number;

  @Column({ type: 'int' })
  receiverId!: number;

  @Column({ type: 'varchar' })
  roomId!: string;

  @Column({ type: 'varchar' })
  giftType!: string;

  @Column({ type: 'int' })
  coinsValue!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
