import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  googleId: string;

  @Column({ unique: true })
  email: string;

  @Column()
  displayName: string;

  @Column({ nullable: true, type: 'varchar', length: 120 })
  bio!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  photoUrl: string | null;

  @Column({ type: 'enum', enum: Gender, default: Gender.OTHER })
  gender: Gender;

  @Column({ nullable: true, type: 'int' })
  countryId: number | null;

  @ManyToOne('Country', 'users', { nullable: true, eager: true })
  @JoinColumn({ name: 'countryId' })
  country: any;

  @Column({ default: false })
  isVip: boolean;

  @Column({ default: false })
  isOnline: boolean;

  @Column({ default: false })
  isBanned: boolean;

  @Column({ default: false })
  isProfileComplete: boolean;

  @Column({ nullable: true, type: 'varchar' })
  fcmToken: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne('Wallet', 'user', { cascade: true, eager: false })
  wallet: any;

  @OneToMany('UserPhoto', 'user', { eager: false, cascade: true })
  photos!: any[];

  @OneToMany('Message', 'sender', { eager: false })
  sentMessages: any[];

  @OneToMany('Message', 'receiver', { eager: false })
  receivedMessages: any[];
}
