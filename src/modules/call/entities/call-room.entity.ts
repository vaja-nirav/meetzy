import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('call_rooms')
export class CallRoom {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string; // Redis roomId — ensures endCall(roomId) always finds the record

  @Column({ type: 'int' })
  userAId!: number;

  @Column({ type: 'int' })
  userBId!: number;

  @CreateDateColumn()
  startedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  duration!: number | null;
}
