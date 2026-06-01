import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum MessageType {
  TEXT = 'text',
  GIFT = 'gift',
  SYSTEM = 'system',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  senderId!: number;

  @Column({ type: 'int' })
  receiverId!: number;

  @Column({ type: 'varchar' })
  roomId!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
  messageType!: MessageType;

  @Column({ default: false })
  isRead!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne('User', 'sentMessages', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: any;

  @ManyToOne('User', 'receivedMessages', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receiver_id' })
  receiver: any;
}
