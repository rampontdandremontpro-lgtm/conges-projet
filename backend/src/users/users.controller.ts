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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from './user.entity';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Body() createUserDto: CreateUserDto,
  ) {
    return this.usersService.create(
      createUserDto,
    );
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
  )
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
  )
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(
      id,
      updateUserDto,
    );
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN)
  disable(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.disable(id);
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN)
  enable(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.enable(id);
  }
}