// apps/wallet-service/src/wallet-service.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { WalletServiceController } from './wallet-service.controller';
import { WalletServiceService } from './wallet-service.service';
import { PrismaModule } from './prisma/prisma.module';
import { SmsService } from 'apps/auth-service/src/sms/sms.service';
import { NotificationHelper } from 'apps/notification-service/src/helpers/NotificationHelper';
import { I18nModule } from '@app/common'; // ou le chemin exact vers I18nModule
import { BankService } from './bank/bank.service';
import { EncryptionService } from './bank/encryption.service';

@Module({
  imports: [
    PrismaModule,
    ClientsModule.register([
      {
        name: 'NOTIFICATION_CLIENT',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
          queue: 'notification_queue',
          queueOptions: { durable: false },
        },
      },
    ]),
    I18nModule, // ← Ajout indispensable pour injecter I18nService
  ],
  controllers: [WalletServiceController],
  providers: [
    WalletServiceService,
    SmsService,
    NotificationHelper,
    BankService,
    EncryptionService,
  ],
  exports: [WalletServiceService, BankService, EncryptionService],
})
export class WalletServiceModule {}
