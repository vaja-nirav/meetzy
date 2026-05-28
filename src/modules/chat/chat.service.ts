import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageType } from './entities/message.entity';

interface SaveMessageInput {
  senderId: number;
  receiverId: number;
  roomId: string;
  content: string;
  messageType?: MessageType;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async saveMessage(input: SaveMessageInput): Promise<Message> {
    const msg = this.messageRepository.create({
      senderId: input.senderId,
      receiverId: input.receiverId,
      roomId: input.roomId,
      content: input.content,
      messageType: input.messageType ?? MessageType.TEXT,
    });
    return this.messageRepository.save(msg);
  }

  async getHistory(
    userAId: number,
    userBId: number,
    limit = 20,
    offset = 0,
  ): Promise<Message[]> {
    return this.messageRepository
      .createQueryBuilder('msg')
      .where(
        '(msg.senderId = :userAId AND msg.receiverId = :userBId) OR (msg.senderId = :userBId AND msg.receiverId = :userAId)',
        { userAId, userBId },
      )
      .orderBy('msg.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.messageRepository.update(messageId, { isRead: true });
  }

  async getConversations(userId: number): Promise<any[]> {
    return this.messageRepository
      .createQueryBuilder('msg')
      .select([
        'CASE WHEN msg.senderId = :userId THEN msg.receiverId ELSE msg.senderId END AS partnerId',
        'MAX(msg.createdAt) AS lastMessageAt',
        'COUNT(CASE WHEN msg.isRead = 0 AND msg.receiverId = :userId THEN 1 END) AS unreadCount',
      ])
      .where('msg.senderId = :userId OR msg.receiverId = :userId', { userId })
      .groupBy(
        'CASE WHEN msg.senderId = :userId THEN msg.receiverId ELSE msg.senderId END',
      )
      .orderBy('lastMessageAt', 'DESC')
      .setParameter('userId', userId)
      .getRawMany();
  }
}
