// apps/api-gateway/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiGatewayController } from './api-gateway.controller';
import { PrismaService } from 'apps/user-service/src/prisma/prisma.service';
import { I18nModule } from '@app/common'; // ← import manquant
import { JwtAuthGuard } from 'apps/auth-service/src/utility/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    I18nModule, // ← indispensable pour que JwtAuthGuard puisse injecter I18nService
  ],
  controllers: [ApiGatewayController],
  providers: [
    PrismaService,
    ConfigService,
    JwtAuthGuard, // ← ajoutez JwtAuthGuard dans les providers pour qu'il soit instancié avec ses dépendances
  ],
  exports: [PrismaService],
})
export class AppModule {}
