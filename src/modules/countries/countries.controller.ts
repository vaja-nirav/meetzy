import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CountriesService } from './countries.service';

@ApiTags('Countries')
@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all countries — sorted A–Z (public, no auth needed)',
    description: `
Returns all 195 countries with id, name, code, dialCode, flag.

**Flutter usage:**
\`\`\`dart
// 1. Fetch once and cache
final countries = await api.get('/countries');

// 2. Show in dropdown
DropdownButton(
  items: countries.map((c) => DropdownMenuItem(
    value: c['id'],
    child: Text('\${c['flag']} \${c['name']}'),
  )).toList(),
)

// 3. On profile setup, send countryId
await api.post('/profile/setup', { countryId: selectedId, ... });
\`\`\`
    `,
  })
  @ApiQuery({ name: 'search', required: false, description: 'Filter by name, code or dial code' })
  findAll(@Query('search') search?: string) {
    if (search?.trim()) {
      return this.countriesService.search(search.trim());
    }
    return this.countriesService.findAll();
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get country by ISO code (e.g. IN, US, GB)' })
  findByCode(@Param('code') code: string) {
    return this.countriesService.findByCode(code);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get country by ID' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.countriesService.findById(id);
  }
}
