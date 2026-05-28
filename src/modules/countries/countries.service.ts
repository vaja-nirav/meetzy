import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Country } from './entities/country.entity';
import { COUNTRY_SEED_DATA } from '../../database/seeders/country.seeder';

@Injectable()
export class CountriesService implements OnModuleInit {
  private readonly logger = new Logger(CountriesService.name);

  constructor(
    @InjectRepository(Country)
    private readonly countryRepository: Repository<Country>,
  ) {}

  async onModuleInit() {
    const count = await this.countryRepository.count();
    if (count === 0) {
      await this.countryRepository.insert(COUNTRY_SEED_DATA);
      this.logger.log(`Seeded ${COUNTRY_SEED_DATA.length} countries`);
    }
  }

  findAll(): Promise<Country[]> {
    return this.countryRepository.find({ order: { name: 'ASC' } });
  }

  search(q: string): Promise<Country[]> {
    return this.countryRepository.find({
      where: [
        { name: Like(`%${q}%`) },
        { code: Like(`%${q.toUpperCase()}%`) },
        { dialCode: Like(`%${q}%`) },
      ],
      order: { name: 'ASC' },
      take: 20,
    });
  }

  async findById(id: number): Promise<Country> {
    const country = await this.countryRepository.findOne({ where: { id } });
    if (!country) throw new NotFoundException(`Country with id ${id} not found`);
    return country;
  }

  async findByCode(code: string): Promise<Country> {
    const country = await this.countryRepository.findOne({
      where: { code: code.toUpperCase() },
    });
    if (!country) throw new NotFoundException(`Country with code ${code} not found`);
    return country;
  }
}
