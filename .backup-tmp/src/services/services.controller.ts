import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

@Controller('services')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Body() createServiceDto: CreateServiceDto,
  ) {
    return this.servicesService.create(
      createServiceDto,
    );
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  findAll() {
    return this.servicesService.findAll();
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.servicesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.servicesService.update(
      id,
      updateServiceDto,
    );
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN)
  disable(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.servicesService.disable(id);
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN)
  enable(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.servicesService.enable(id);
  }
}