import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NotificationType } from '../type/notification-type';
import { lastValueFrom } from 'rxjs';
import { I18nService } from '@app/common';

@Injectable()
export class NotificationHelper {
  constructor(
    @Inject('NOTIFICATION_CLIENT') private notificationClient: ClientProxy,
    private readonly i18nService: I18nService,
  ) {}

  async notify(
    userId: string,
    type: NotificationType,
    data?: any,
    entity?: string,
    entityId?: string,
    lang: string = 'fr',
  ) {
    const { title, body } = this.getTranslatedContent(type, data, lang);
    const pushData: Record<string, string> = {};
    if (entity) pushData.entity = entity;
    if (entityId) pushData.entityId = entityId;

    try {
      await lastValueFrom(
        this.notificationClient.send('send_notification', {
          userId,
          title,
          body,
          type, // le type sera 'transaction', 'transfer' ou 'payment'
          data: pushData,
        }),
      );
    } catch (err) {
      console.error('❌ Notification error:', err);
    }
  }

  private getTranslatedContent(
    type: NotificationType,
    data: any,
    lang: string,
  ) {
    let titleKey: string, bodyKey: string;

    switch (type) {
      // Nouveaux types demandés
      case NotificationType.TRANSACTION:
        // On peut distinguer topup / cashout via data.operationType si besoin
        if (data?.operationType === 'topup') {
          titleKey = 'notifications.top_up_success.title';
          bodyKey = 'notifications.top_up_success.body';
        } else if (data?.operationType === 'cashout') {
          titleKey = 'notifications.cashout_success.title';
          bodyKey = 'notifications.cashout_success.body';
        } else {
          titleKey = 'notifications.transaction.title';
          bodyKey = 'notifications.transaction.body';
        }
        break;

      case NotificationType.TRANSFER:
        // On peut adapter le texte selon le sens (envoyé/reçu) via data.direction
        if (data?.direction === 'sent') {
          titleKey = 'notifications.transfer_sent.title';
          bodyKey = 'notifications.transfer_sent.body';
        } else if (data?.direction === 'received') {
          titleKey = 'notifications.transfer_received.title';
          bodyKey = 'notifications.transfer_received.body';
        } else {
          titleKey = 'notifications.transfer.title';
          bodyKey = 'notifications.transfer.body';
        }
        break;

      case NotificationType.PAYMENT:
        if (data?.direction === 'sent') {
          titleKey = 'notifications.payment_sent.title';
          bodyKey = 'notifications.payment_sent.body';
        } else if (data?.direction === 'received') {
          titleKey = 'notifications.payment_received.title';
          bodyKey = 'notifications.payment_received.body';
        } else {
          titleKey = 'notifications.payment.title';
          bodyKey = 'notifications.payment.body';
        }
        break;

      // Anciens types (pour compatibilité)
      case NotificationType.TOP_UP_SUCCESS:
        titleKey = 'notifications.top_up_success.title';
        bodyKey = 'notifications.top_up_success.body';
        break;
      case NotificationType.CASHOUT_SUCCESS:
        titleKey = 'notifications.cashout_success.title';
        bodyKey = 'notifications.cashout_success.body';
        break;
      case NotificationType.TRANSFER_SENT:
        titleKey = 'notifications.transfer_sent.title';
        bodyKey = 'notifications.transfer_sent.body';
        break;
      case NotificationType.TRANSFER_RECEIVED:
        titleKey = 'notifications.transfer_received.title';
        bodyKey = 'notifications.transfer_received.body';
        break;
      case NotificationType.PAYMENT_SENT:
        titleKey = 'notifications.payment_sent.title';
        bodyKey = 'notifications.payment_sent.body';
        break;
      case NotificationType.PAYMENT_RECEIVED:
        titleKey = 'notifications.payment_received.title';
        bodyKey = 'notifications.payment_received.body';
        break;
      case NotificationType.WALLET_CREDITED:
        titleKey = 'notifications.wallet_credited.title';
        bodyKey = 'notifications.wallet_credited.body';
        break;
      case NotificationType.WALLET_DEBITED:
        titleKey = 'notifications.wallet_debited.title';
        bodyKey = 'notifications.wallet_debited.body';
        break;
      default:
        titleKey = 'notifications.default.title';
        bodyKey = 'notifications.default.body';
    }

    const title = this.i18nService.translate(titleKey, lang);
    const body = this.i18nService.translate(bodyKey, lang, {
      amount: data?.amount,
      currency: data?.currency || 'CDF',
      toName: data?.toName,
      toPhone: data?.toPhone,
      fromName: data?.fromName,
      fromAccount: data?.fromAccount,
      merchantName: data?.merchantName,
      merchantPhone: data?.merchantPhone,
      customerName: data?.customerName,
      customerAccount: data?.customerAccount,
    });
    return { title, body };
  }
}
