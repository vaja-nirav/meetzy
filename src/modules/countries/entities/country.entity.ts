import { Entity, PrimaryGeneratedColumn, Column, OneToMany, AfterLoad } from 'typeorm';

@Entity('countries')
export class Country {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  name!: string;

  @Column({ unique: true, length: 2 })
  code!: string;

  @Column({ length: 10 })
  dialCode!: string;

  // Computed after load — not stored in DB
  flag!: string;

  @AfterLoad()
  computeFlag() {
    this.flag = this.code
      .toUpperCase()
      .replace(/./g, (c) =>
        String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)),
      );
  }

  @OneToMany('User', 'country', { eager: false })
  users: any[];
}
