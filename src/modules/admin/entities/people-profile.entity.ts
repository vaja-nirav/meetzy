import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum ProfileStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * Admin-managed fake display profiles shown on the app's "People / Popular" page.
 * Not real users. Admin controls visibility via `status`.
 * Column names are snake_case (via SnakeNamingStrategy): user_name, blue_tick, etc.
 */
@Entity('people_profiles')
export class PeopleProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  userName: string;

  @Column({ type: 'int' })
  age: number;

  @Column({ default: false })
  blueTick: boolean;

  @Column({ type: 'int', nullable: true })
  countryId: number | null;

  @ManyToOne('Country', { nullable: true, eager: true })
  @JoinColumn({ name: 'country_id' })
  country: any;

  @Column({ type: 'text', nullable: true })
  aboutMe: string | null;

  // string[] stored as JSON, e.g. ["Hindi","English"]
  @Column({ type: 'json', nullable: true })
  languages: string[] | null;

  // up to 6 image URLs / data URLs (first = main cover), stored as JSON
  @Column({ type: 'json', nullable: true })
  coverImages: string[] | null;

  @Column({ type: 'enum', enum: ProfileStatus, default: ProfileStatus.ACTIVE })
  status: ProfileStatus;

  @Column({ type: 'int', default: 0 })
  order: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
