import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallRoom } from './entities/call-room.entity';

@Injectable()
export class CallService {
  constructor(
    @InjectRepository(CallRoom)
    private readonly callRoomRepository: Repository<CallRoom>,
  ) {}

  // roomId must be the Redis roomId so endCall() can find it later
  async createCallRecord(roomId: string, userAId: number, userBId: number): Promise<CallRoom> {
    const room = this.callRoomRepository.create({ id: roomId, userAId, userBId });
    return this.callRoomRepository.save(room);
  }

  async endCall(roomId: string): Promise<CallRoom> {
    const room = await this.callRoomRepository.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Call room not found');

    const endedAt = new Date();
    const duration = Math.floor(
      (endedAt.getTime() - room.startedAt.getTime()) / 1000,
    );
    room.endedAt = endedAt;
    room.duration = duration;
    return this.callRoomRepository.save(room);
  }

  async getCallHistory(userId: number, limit = 20, offset = 0): Promise<CallRoom[]> {
    return this.callRoomRepository
      .createQueryBuilder('room')
      .where('room.userAId = :userId OR room.userBId = :userId', { userId })
      .orderBy('room.startedAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
  }
}
