import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LegalEntity } from './legal-entity.entity';

@Injectable()
export class LegalEntitiesService {
  constructor(
    @InjectRepository(LegalEntity)
    private readonly legalEntityRepository: Repository<LegalEntity>,
  ) {}

  findAllActive(): Promise<LegalEntity[]> {
    return this.legalEntityRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  findById(id: number): Promise<LegalEntity | null> {
    return this.legalEntityRepository.findOneBy({ id });
  }

  findByCode(code: string): Promise<LegalEntity | null> {
    return this.legalEntityRepository.findOneBy({ code });
  }
}
