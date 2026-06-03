import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MosaicGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum MosaicStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('login_mosaic')
export class LoginMosaic {
  @PrimaryGeneratedColumn()
  id: number;

  // `text` (not varchar(500)) so the "Upload file" flow can store a base64
  // data URL, which easily exceeds 500 chars. Plain https URLs fit fine too.
  @Column({ name: 'photo_url', type: 'text' })
  photoUrl: string;

  @Column({
    type: 'enum',
    enum: MosaicGender,
    default: MosaicGender.FEMALE,
  })
  gender: MosaicGender;

  @Column({
    type: 'enum',
    enum: MosaicStatus,
    default: MosaicStatus.ACTIVE,
  })
  status: MosaicStatus;

  @Column({
    name: 'show_online_dot',
    default: true,
  })
  showOnlineDot: boolean;

  @Column({
    type: 'int',
    default: 0,
  })
  order: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
