/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/wallet-service/src/wallet-service.service.ts
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import * as crypto from 'crypto';
import { PrismaService } from './prisma/prisma.service';
import { CreateWalletDto, WalletResponseDto } from './dto/create-wallet.dto';
import * as fs from 'fs';
import {
  CreditWalletDto,
  DebitWalletDto,
  TransferDto,
} from './dto/transaction.dto';
import { SendDto, PayDto } from './dto/wallet-operation.dto';
import { ApiResponse } from './interfaces/api-response.interface';
import { user_status, wallet_currency } from '@prisma/client';
import { SmsService } from 'apps/auth-service/src/sms/sms.service';
import { NotificationHelper } from 'apps/notification-service/src/helpers/NotificationHelper';
import { NotificationType } from 'apps/notification-service/src/type/notification-type';
import { I18nService } from '@app/common';
import { BankService } from './bank/bank.service';
import * as path from 'path';
import * as ejs from 'ejs';
import * as puppeteer from 'puppeteer';
import { notifyTransaction } from './utilils/wallet-notification.util';
import { logFailedLoginAttempt } from 'apps/auth-service/src/utility/helpers/login-attempt.util';

type FormattedTransaction = {
  description: string;
  detail: string;
  reference: string;
  date: string;
  credit: number | null;
  debit: number | null;
  balance: number;
};

@Injectable()
export class WalletServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
    private readonly notificationHelper: NotificationHelper,
    private readonly i18nService: I18nService,
    private readonly bankService: BankService,
  ) { }

  private async logAudit(
    userId: string | null,
    action: string,
    details: any,
    ipAddress: string | null,
  ) {
    try {
      await this.prisma.audit_log.create({
        data: {
          userId,
          action,
          details: details ? JSON.stringify(details) : null,
          ipAddress,
          createdAt: new Date(),
        },
      });
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  }

  // ==================== MÉTHODES DE BASE ====================
  async linkAccount(accountNumber: string, requestId?: string): Promise<any> {
    return this.bankService.linkAccount(accountNumber, requestId);
  }

  async topup(
    accountNumber: string,
    amount: number,
    requestId?: string,
  ): Promise<any> {
    if (!amount || amount <= 0) {
      throw new Error('Invalid topup amount');
    }
    return this.bankService.topup(accountNumber, amount, requestId);
  }

  async cashouts(
    accountNumber: string,
    amount: number,
    requestId?: string,
  ): Promise<any> {
    if (!amount || amount <= 0) {
      throw new Error('Invalid cashout amount');
    }
    return this.bankService.cashout(accountNumber, amount, requestId);
  }

  async createWallet(
    data: CreateWalletDto,
  ): Promise<ApiResponse<WalletResponseDto>> {
    console.log('[WalletService] Creating wallet for user:', data.userId);
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
    });
    if (!user) {
      throw new RpcException({
        status: 'error',
        message: 'User not found',
        statusCode: 404,
      });
    }
    const existing = await this.prisma.wallet.findUnique({
      where: { userId: data.userId },
    });
    if (existing) {
      throw new RpcException({
        status: 'error',
        message: 'Wallet already exists',
        statusCode: 409,
      });
    }
    const currency = (data.currency || 'CDF') as wallet_currency;
    const wallet = await this.prisma.wallet.create({
      data: {
        id: crypto.randomUUID(),
        userId: data.userId,
        currency,
        balance: 0,
        isActive: true,
      },
    });
    return {
      message: 'Wallet created successfully',
      data: this.toResponse(wallet),
    };
  }

  async getWallet(
    userId: string,
  ): Promise<ApiResponse<WalletResponseDto & { phone?: string | null }>> {
    try {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        include: { user: { select: { phone: true } } },
      });
      if (!wallet) {
        const newWallet = await this.prisma.wallet.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            currency: 'CDF',
            balance: 0,
            isActive: true,
          },
          include: { user: { select: { phone: true } } },
        });
        return {
          message: 'Wallet récupéré avec succès',
          data: {
            ...this.toResponse(newWallet),
            phone: newWallet.user?.phone || null,
          },
        };
      }
      return {
        message: 'Wallet récupéré avec succès',
        data: {
          ...this.toResponse(wallet),
          phone: wallet.user?.phone || null,
        },
      };
    } catch (error) {
      if (error.code === 'P2003') {
        throw new RpcException({
          status: 'error',
          message: 'Utilisateur introuvable',
          statusCode: 404,
        });
      }
      throw error;
    }
  }

  async getWalletByPhone(phone: string): Promise<
    ApiResponse<
      Omit<WalletResponseDto, 'balance' | 'currency'> & {
        phone?: string | null;
        full_name?: string | null;
      }
    >
  > {
    try {
      const user = await this.prisma.user.findUnique({
        where: { phone },
        select: { id: true, phone: true },
      });
      if (!user) {
        throw new RpcException({
          status: 'error',
          message: 'Utilisateur introuvable avec ce numéro de téléphone',
          statusCode: 404,
        });
      }
      let wallet = await this.prisma.wallet.findUnique({
        where: { userId: user.id },
        include: { user: { select: { phone: true, full_name: true } } },
      });
      if (!wallet) {
        wallet = await this.prisma.wallet.create({
          data: {
            id: crypto.randomUUID(),
            userId: user.id,
            currency: 'CDF',
            balance: 0,
            isActive: true,
          },
          include: { user: { select: { phone: true, full_name: true } } },
        });
      }
      const { balance, currency, ...walletData } = this.toResponse(wallet);
      return {
        message: 'Wallet récupéré avec succès',
        data: {
          ...walletData,
          phone: wallet.user?.phone || null,
          full_name: wallet.user?.full_name || null,
        },
      };
    } catch (error) {
      if (error.code === 'P2003') {
        throw new RpcException({
          status: 'error',
          message: 'Utilisateur introuvable',
          statusCode: 404,
        });
      }
      throw error;
    }
  }

  async creditWallet(
    data: CreditWalletDto,
  ): Promise<ApiResponse<WalletResponseDto>> {
    console.log('[WalletService] Credit wallet:', data.userId, data.amount);
    if (data.amount <= 0)
      throw new RpcException({
        status: 'error',
        message: 'Amount must be positive',
        statusCode: 400,
      });
    const wallet = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.wallet.findUnique({
          where: { userId: data.userId },
        });
        if (!current)
          throw new RpcException({
            status: 'error',
            message: 'Wallet not found',
            statusCode: 404,
          });
        if (!current.isActive)
          throw new RpcException({
            status: 'error',
            message: 'Wallet is inactive',
            statusCode: 403,
          });
        const updated = await tx.wallet.update({
          where: { userId: data.userId },
          data: { balance: { increment: data.amount }, updatedAt: new Date() },
        });
        await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: data.userId,
            walletId: updated.id,
            amount: data.amount,
            type: 'DEPOSIT',
            status: 'SUCCESS',
            reference: `DEP_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: data.description || 'Credit',
            movement: 'CREDIT',
          },
        });
        return updated;
      },
      { timeout: 60000, maxWait: 60000 },
    );
    return {
      message: 'Wallet credited successfully',
      data: this.toResponse(wallet),
    };
  }

  async debitWallet(
    data: DebitWalletDto,
  ): Promise<ApiResponse<WalletResponseDto>> {
    console.log('[WalletService] Debit wallet:', data.userId, data.amount);
    if (data.amount <= 0)
      throw new RpcException({
        status: 'error',
        message: 'Amount must be positive',
        statusCode: 400,
      });
    const wallet = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.wallet.findUnique({
          where: { userId: data.userId },
        });
        if (!current)
          throw new RpcException({
            status: 'error',
            message: 'Wallet not found',
            statusCode: 404,
          });
        if (!current.isActive)
          throw new RpcException({
            status: 'error',
            message: 'Wallet is inactive',
            statusCode: 403,
          });
        if (current.balance < data.amount)
          throw new RpcException({
            status: 'error',
            message: 'Insufficient balance',
            statusCode: 400,
          });
        const updated = await tx.wallet.update({
          where: { userId: data.userId },
          data: { balance: { decrement: data.amount }, updatedAt: new Date() },
        });
        await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: data.userId,
            walletId: updated.id,
            amount: data.amount,
            type: 'WITHDRAW',
            status: 'SUCCESS',
            reference: `WIT_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: data.description || 'Debit',
            movement: 'DEBIT',
          },
        });
        return updated;
      },
      { timeout: 60000, maxWait: 60000 },
    );
    return {
      message: 'Wallet debited successfully',
      data: this.toResponse(wallet),
    };
  }

  async transfer(
    data: TransferDto,
  ): Promise<ApiResponse<{ from: WalletResponseDto; to: WalletResponseDto }>> {
    console.log(
      '[WalletService] Transfer:',
      data.fromUserId,
      '->',
      data.toUserId,
      data.amount,
    );
    if (data.amount <= 0)
      throw new RpcException({
        status: 'error',
        message: 'Amount must be positive',
        statusCode: 400,
      });
    if (data.fromUserId === data.toUserId)
      throw new RpcException({
        status: 'error',
        message: 'Cannot transfer to yourself',
        statusCode: 400,
      });
    const result = await this.prisma.$transaction(
      async (tx) => {
        const fromWallet = await tx.wallet.findUnique({
          where: { userId: data.fromUserId },
        });
        if (!fromWallet)
          throw new RpcException({
            status: 'error',
            message: 'Sender wallet not found',
            statusCode: 404,
          });
        if (!fromWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: 'Sender wallet is inactive',
            statusCode: 403,
          });
        if (fromWallet.balance < data.amount)
          throw new RpcException({
            status: 'error',
            message: 'Insufficient balance',
            statusCode: 400,
          });
        let toWallet = await tx.wallet.findUnique({
          where: { userId: data.toUserId },
        });
        if (!toWallet) {
          toWallet = await tx.wallet.create({
            data: {
              id: crypto.randomUUID(),
              userId: data.toUserId,
              currency: 'CDF',
              balance: 0,
              isActive: true,
            },
          });
        }
        if (!toWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: 'Recipient wallet is inactive',
            statusCode: 403,
          });
        const updatedFrom = await tx.wallet.update({
          where: { id: fromWallet.id },
          data: { balance: { decrement: data.amount }, updatedAt: new Date() },
        });
        const updatedTo = await tx.wallet.update({
          where: { id: toWallet.id },
          data: { balance: { increment: data.amount }, updatedAt: new Date() },
        });
        await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: data.fromUserId,
            walletId: updatedFrom.id,
            amount: data.amount,
            type: 'TRANSFER',
            status: 'SUCCESS',
            reference: `TRF_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: data.description || `Transfer to ${data.toUserId}`,
            movement: 'DEBIT',
          },
        });
        await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: data.toUserId,
            walletId: updatedTo.id,
            amount: data.amount,
            type: 'TRANSFER',
            status: 'SUCCESS',
            reference: `TRF_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: data.description || `Transfer from ${data.fromUserId}`,
            movement: 'CREDIT',
          },
        });
        return { from: updatedFrom, to: updatedTo };
      },
      { timeout: 60000, maxWait: 60000 },
    );
    return {
      message: 'Transfer completed successfully',
      data: {
        from: this.toResponse(result.from),
        to: this.toResponse(result.to),
      },
    };
  }

  async adminTopUp(
    userId: string,
    amount: number,
    lang: string = 'fr',
    ipAddress?: string,
  ): Promise<ApiResponse<{ wallet: WalletResponseDto; transaction: any }>> {
    console.log('[WalletService] Admin Top-up request:', {
      userId,
      amount,
      lang,
    });
    if (amount <= 0)
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    const result = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
          },
        });
        if (!user)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.user_not_found', lang),
            statusCode: 404,
          });
        if (!user.account_number)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.no_bank_account', lang),
            statusCode: 400,
          });
        const account = await tx.account.findUnique({
          where: { account_number: user.account_number },
        });
        if (!account)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.account_not_found',
              lang,
            ),
            statusCode: 404,
          });
        if (account.balance < amount)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.insufficient_balance',
              lang,
            ),
            statusCode: 400,
          });
        let wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) {
          wallet = await tx.wallet.create({
            data: {
              id: crypto.randomUUID(),
              userId,
              currency: 'CDF',
              balance: 0,
              isActive: true,
            },
          });
        }
        if (!wallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        await tx.account.update({
          where: { id: account.id },
          data: { balance: { decrement: amount } },
        });
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: amount }, updatedAt: new Date() },
        });
        const transaction = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            walletId: wallet.id,
            amount,
            type: 'DEPOSIT',
            status: 'SUCCESS',
            reference: `ADMIN_TOPUP_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: `Alimentation admin depuis le compte ${user.account_number}`,
            movement: 'CREDIT',
          },
        });
        await this.logAudit(
          user.id,
          'adminTopUp',
          transaction,
          ipAddress || null,
        );
        return { wallet: updatedWallet, transaction };
      },
      { timeout: 60000, maxWait: 60000 },
    );
    await this.notificationHelper.notify(
      userId,
      NotificationType.TOP_UP_SUCCESS,
      { amount, currency: result.wallet.currency || 'CDF' },
      'TRANSACTION',
      result.transaction.id,
      lang,
    );
    return {
      message: this.i18nService.translate('wallet.top_up_success', lang),
      data: {
        wallet: this.toResponse(result.wallet),
        transaction: result.transaction,
      },
    };
  }

  async adminCashout(
    userId: string,
    accountNumber: string,
    amount: number,
    lang: string = 'fr',
    ipAddress?: string,
  ): Promise<ApiResponse<{ wallet: WalletResponseDto; transaction: any }>> {
    console.log('[WalletService] Admin Cashout request:', {
      userId,
      accountNumber,
      amount,
      lang,
    });
    if (amount <= 0)
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    const result = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
            role: true,
          },
        });
        if (!user)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.user_not_found', lang),
            statusCode: 404,
          });
        const targetAccount = await tx.account.findUnique({
          where: { account_number: accountNumber },
        });
        if (!targetAccount)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.account_not_found',
              lang,
            ),
            statusCode: 404,
          });
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.wallet_not_found',
              lang,
            ),
            statusCode: 404,
          });
        if (!wallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        if (wallet.balance < amount)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.insufficient_wallet_balance',
              lang,
            ),
            statusCode: 400,
          });
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: amount }, updatedAt: new Date() },
        });
        await tx.account.update({
          where: { id: targetAccount.id },
          data: { balance: { increment: amount } },
        });
        const transaction = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            walletId: wallet.id,
            amount,
            type: 'WITHDRAW',
            status: 'SUCCESS',
            reference: `ADMIN_CASHOUT_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: `Retrait admin vers le compte ${accountNumber}`,
            movement: 'DEBIT',
          },
        });
        if (user.phone) {
          const cleanPhone = user.phone.replace(/[^0-9+]/g, '');
          const smsText = this.i18nService.translate(
            'wallet.cashout_sms',
            lang,
            {
              full_name: user.full_name,
              amount,
              currency: 'CDF',
              accountNumber,
            },
          );
          await this.smsService.sendSms(cleanPhone, smsText);
        }
        await this.logAudit(
          user.id,
          'adminCashout',
          { transaction },
          ipAddress || null,
        );
        return { wallet: updatedWallet, transaction };
      },
      { timeout: 60000, maxWait: 60000 },
    );
    await this.notificationHelper.notify(
      userId,
      NotificationType.CASHOUT_SUCCESS,
      { amount, currency: result.wallet.currency || 'CDF' },
      'TRANSACTION',
      result.transaction.id,
      lang,
    );
    return {
      message: this.i18nService.translate('wallet.cashout_success', lang),
      data: {
        wallet: this.toResponse(result.wallet),
        transaction: result.transaction,
      },
    };
  }

  async adminSend(
    dto: SendDto,
    lang: string = 'fr',
    ipAddress: string,
  ): Promise<
    ApiResponse<{
      fromWallet: WalletResponseDto;
      toWallet: WalletResponseDto;
      transaction: any;
    }>
  > {
    const { fromAccountNumber, toPhone, amount, description } = dto;
    console.log('[WalletService] Admin Send request:', {
      from: fromAccountNumber,
      toPhone,
      amount,
      lang,
    });
    if (amount <= 0)
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    const result = await this.prisma.$transaction(
      async (tx) => {
        const fromUser = await tx.user.findFirst({
          where: { account_number: fromAccountNumber },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
          },
        });
        if (!fromUser)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.sender_not_found',
              lang,
            ),
            statusCode: 404,
          });
        const toUser = await tx.user.findUnique({
          where: { phone: toPhone },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
          },
        });
        if (!toUser)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.receiver_not_found',
              lang,
            ),
            statusCode: 404,
          });
        if (fromUser.id === toUser.id)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.cannot_transfer_self',
              lang,
            ),
            statusCode: 400,
          });
        const fromWallet = await tx.wallet.findUnique({
          where: { userId: fromUser.id },
          include: { user: true },
        });
        if (!fromWallet)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.wallet_not_found',
              lang,
            ),
            statusCode: 404,
          });
        if (!fromWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        if (fromWallet.balance < amount)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.insufficient_wallet_balance',
              lang,
            ),
            statusCode: 400,
          });
        const toWallet = await tx.wallet.upsert({
          where: { userId: toUser.id },
          update: {},
          create: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            currency: 'CDF',
            balance: 0,
            isActive: true,
          },
        });
        if (!toWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        const updatedFrom = await tx.wallet.update({
          where: { id: fromWallet.id },
          data: { balance: { decrement: amount }, updatedAt: new Date() },
        });
        const updatedTo = await tx.wallet.update({
          where: { id: toWallet.id },
          data: { balance: { increment: amount }, updatedAt: new Date() },
        });
        const senderTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: fromUser.id,
            walletId: fromWallet.id,
            amount,
            type: 'TRANSFER',
            status: 'SUCCESS',
            reference: `ADMIN_SEND_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: description || `Transfert admin vers ${toPhone}`,
            movement: 'DEBIT',
          },
        });
        const receiverTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            walletId: toWallet.id,
            amount,
            type: 'DEPOSIT',
            status: 'SUCCESS',
            reference: `ADMIN_RECV_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description:
              description ||
              `Reçu admin de ${fromUser.full_name} - (${fromUser.phone})`,
            movement: 'CREDIT',
          },
        });
        if (fromUser.phone) {
          const cleanPhone = fromUser.phone.replace(/[^0-9+]/g, '');
          const smsText = this.i18nService.translate(
            'wallet.transfer_sender_sms',
            lang,
            {
              full_name: fromUser.full_name,
              amount,
              currency: 'CDF',
              toPhone,
              toName: toUser.full_name,
              balance: updatedFrom.balance,
            },
          );
          await this.smsService.sendSms(cleanPhone, smsText);
        }
        if (toUser.phone) {
          const cleanPhone = toUser.phone.replace(/[^0-9+]/g, '');
          const smsText = this.i18nService.translate(
            'wallet.transfer_receiver_sms',
            lang,
            {
              full_name: toUser.full_name,
              amount,
              currency: 'CDF',
              fromPhone: fromUser.phone,
              fromName: fromUser.full_name,
              balance: updatedTo.balance,
            },
          );
          await this.smsService.sendSms(cleanPhone, smsText);
        }
        await this.logAudit(
          toUser.id,
          'adminTransfer',
          updatedTo,
          ipAddress || null,
        );
        this.notificationHelper.notify(
          fromUser.id,
          NotificationType.TRANSFER_SENT,
          {
            amount,
            toName: toUser.full_name || toUser.phone,
            currency: fromWallet.currency,
          },
          'TRANSACTION',
          senderTx.id,
          lang,
        );
        this.notificationHelper.notify(
          toUser.id,
          NotificationType.TRANSFER_RECEIVED,
          {
            amount,
            fromName: fromUser.full_name || fromUser.account_number,
            currency: toWallet.currency,
          },
          'TRANSACTION',
          receiverTx.id,
          lang,
        );
        return { fromWallet: updatedFrom, toWallet: updatedTo };
      },
      { timeout: 60000, maxWait: 60000 },
    );
    return {
      message: this.i18nService.translate('wallet.transfer_success', lang),
      data: {
        fromWallet: this.toResponse(result.fromWallet),
        toWallet: this.toResponse(result.toWallet),
        transaction: { reference: `ADMIN_SEND_${Date.now()}` },
      },
    };
  }

  async adminPay(
    dto: PayDto,
    lang: string = 'fr',
    ipAddress: string,
  ): Promise<ApiResponse<{ wallet: WalletResponseDto; transaction: any }>> {
    const { fromAccountNumber, toPhone, merchantCode, amount, description } =
      dto;
    console.log('[WalletService] Admin Pay request:', {
      fromAccountNumber,
      toPhone,
      merchantCode,
      amount,
      lang,
    });
    if (amount <= 0)
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    const result = await this.prisma.$transaction(
      async (tx) => {
        const fromUser = await tx.user.findFirst({
          where: { account_number: fromAccountNumber },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
          },
        });
        if (!fromUser)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.sender_not_found',
              lang,
            ),
            statusCode: 404,
          });
        let toUser: {
          id: string;
          full_name: string | null;
          phone: string | null;
          account_number: string | null;
          role: string;
        } | null = null;
        if (toPhone) {
          toUser = await tx.user.findUnique({
            where: { phone: toPhone },
            select: {
              id: true,
              full_name: true,
              phone: true,
              account_number: true,
              role: true,
            },
          });
        } else if (merchantCode) {
          toUser = await tx.user.findFirst({
            where: { merchantCode, role: 'MERCHANT' },
            select: {
              id: true,
              full_name: true,
              phone: true,
              account_number: true,
              role: true,
            },
          });
        } else {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.missing_phone_or_code',
              lang,
            ),
            statusCode: 400,
          });
        }
        if (!toUser)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.receiver_not_found',
              lang,
            ),
            statusCode: 404,
          });
        if (toUser.role !== 'MERCHANT')
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.not_merchant', lang),
            statusCode: 400,
          });
        const userWallet = await tx.wallet.findUnique({
          where: { userId: fromUser.id },
        });
        if (!userWallet)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.wallet_not_found',
              lang,
            ),
            statusCode: 404,
          });
        if (!userWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        if (userWallet.balance < amount)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate(
              'wallet.insufficient_wallet_balance',
              lang,
            ),
            statusCode: 400,
          });
        const merchantWallet = await tx.wallet.upsert({
          where: { userId: toUser.id },
          update: {},
          create: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            currency: 'CDF',
            balance: 0,
            isActive: true,
          },
        });
        if (!merchantWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        const updatedUser = await tx.wallet.update({
          where: { id: userWallet.id },
          data: { balance: { decrement: amount }, updatedAt: new Date() },
        });
        const updatedMerchant = await tx.wallet.update({
          where: { id: merchantWallet.id },
          data: { balance: { increment: amount }, updatedAt: new Date() },
        });
        const payerTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: fromUser.id,
            walletId: userWallet.id,
            amount,
            type: 'PAYMENT',
            status: 'SUCCESS',
            reference: `ADMIN_PAY_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description:
              description ||
              `Paiement admin à ${toUser.full_name} (${toUser.phone})`,
            movement: 'DEBIT',
          },
        });
        const merchantTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            walletId: merchantWallet.id,
            amount,
            type: 'PAYMENT',
            status: 'SUCCESS',
            reference: `ADMIN_PAY_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: description || `Reçu admin de ${fromAccountNumber}`,
            movement: 'CREDIT',
          },
        });
        if (fromUser.phone) {
          const cleanPhone = fromUser.phone.replace(/[^0-9+]/g, '');
          const smsText = this.i18nService.translate(
            'wallet.payment_payer_sms',
            lang,
            {
              full_name: fromUser.full_name,
              amount,
              currency: 'CDF',
              merchantName: toUser.full_name,
              merchantPhone: toUser.phone,
              balance: updatedUser.balance,
            },
          );
          await this.smsService.sendSms(cleanPhone, smsText);
        }
        if (toUser.phone) {
          const cleanPhone = toUser.phone.replace(/[^0-9+]/g, '');
          const smsText = this.i18nService.translate(
            'wallet.payment_merchant_sms',
            lang,
            {
              full_name: toUser.full_name,
              amount,
              currency: 'CDF',
              payerAccount: fromAccountNumber,
              payerName: fromUser.full_name,
              balance: updatedMerchant.balance,
            },
          );
          await this.smsService.sendSms(cleanPhone, smsText);
        }
        await this.logAudit(
          fromUser.id,
          'adminPayment',
          updatedUser,
          ipAddress || null,
        );
        this.notificationHelper.notify(
          fromUser.id,
          NotificationType.PAYMENT_SENT,
          {
            amount,
            merchantName: toUser.full_name || toUser.phone,
            currency: userWallet.currency,
          },
          'TRANSACTION',
          payerTx.id,
          lang,
        );
        this.notificationHelper.notify(
          toUser.id,
          NotificationType.PAYMENT_RECEIVED,
          {
            amount,
            customerName: fromUser.full_name || fromUser.account_number,
            currency: merchantWallet.currency,
          },
          'TRANSACTION',
          merchantTx.id,
          lang,
        );
        return { wallet: updatedUser, transaction: payerTx };
      },
      { timeout: 60000, maxWait: 60000 },
    );
    return {
      message: this.i18nService.translate('wallet.payment_success', lang),
      data: {
        wallet: this.toResponse(result.wallet),
        transaction: result.transaction,
      },
    };
  }

  async listTransactions(
    userId: string,
    page: number = 1,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { userId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        where.createdAt.lte = endOfDay;
      }
    }
    const [transactions, total, creditSum, debitSum] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({
        where: { ...where, movement: 'CREDIT' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...where, movement: 'DEBIT' },
        _sum: { amount: true },
      }),
    ]);
    const totalCredit = creditSum._sum.amount || 0;
    const totalDebit = debitSum._sum.amount || 0;
    const enrichedTransactions = await Promise.all(
      transactions.map(async (tx) => {
        let full_name: string | null = null;
        let phone: string | null = null;
        if (tx.type === 'TRANSFER' && tx.movement === 'DEBIT') {
          const toMatch = tx.description?.match(/\[TO:([^\]]+)\]/);
          const receiverId = toMatch?.[1];
          if (receiverId) {
            const receiver = await this.prisma.user.findUnique({
              where: { id: receiverId },
              select: { full_name: true, phone: true },
            });
            if (receiver) {
              full_name = receiver.full_name;
              phone = receiver.phone;
            }
          }
        } else if (tx.type === 'TRANSFER' && tx.movement === 'CREDIT') {
          const fromMatch = tx.description?.match(/\[FROM:([^\]]+)\]/);
          const senderId = fromMatch?.[1];
          if (senderId) {
            const sender = await this.prisma.user.findUnique({
              where: { id: senderId },
              select: { full_name: true, phone: true },
            });
            if (sender) {
              full_name = sender.full_name;
              phone = sender.phone;
            }
          }
        } else if (tx.type === 'PAYMENT' && tx.movement === 'DEBIT') {
          const merchantMatch = tx.description?.match(
            /Paiement à (.+?) \(([^)]+)\)/,
          );
          if (merchantMatch) {
            full_name = merchantMatch[1];
            phone = merchantMatch[2];
          }
        } else if (tx.type === 'PAYMENT' && tx.movement === 'CREDIT') {
          const customerMatch = tx.description?.match(
            /Reçu de [A-Z0-9]+ \(([^)]+)\)/,
          );
          if (customerMatch) {
            full_name = customerMatch[1];
          }
        }
        const cleanDescription =
          tx.description?.replace(/\[TO:[^\]]+\]|\[FROM:[^\]]+\]/, '').trim() ||
          tx.description;
        const { description, ...rest } = tx;
        return {
          ...rest,
          description: cleanDescription,
          full_name,
          phone,
        };
      }),
    );
    return {
      message: 'Transactions retrieved successfully',
      data: {
        data: enrichedTransactions,
        total,
        page,
        limit,
        analytics: {
          totalCredit,
          totalDebit,
        },
      },
    };
  }

  async listAllTransactions(
    page: number = 1,
    limit: number = 10,
    userId?: string,
    type?: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        where.createdAt.lte = endOfDay;
      }
    }
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { description: { contains: searchTerm } },
        {
          user: {
            OR: [
              { full_name: { contains: searchTerm } },
              { account_number: { contains: searchTerm } },
              { phone: { contains: searchTerm } },
            ],
          },
        },
      ];
    }
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { full_name: true, account_number: true, phone: true },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return {
      message: 'All transactions retrieved successfully',
      data: {
        data: transactions,
        total,
        page,
        limit,
      },
    };
  }

  async listAllTransactionsWithoutPagination(
    userId?: string,
    type?: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
    search?: string,
  ) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        where.createdAt.lte = endOfDay;
      }
    }
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { description: { contains: searchTerm } },
        {
          user: {
            OR: [
              { full_name: { contains: searchTerm } },
              { account_number: { contains: searchTerm } },
              { phone: { contains: searchTerm } },
            ],
          },
        },
      ];
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { full_name: true, account_number: true, phone: true },
        },
      },
    });

    return {
      message: 'All transactions retrieved successfully',
      data: transactions,
      total: transactions.length,
    };
  }

  async listAllTransactionsWithoutPag(
    userId?: string,
    type?: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
    search?: string,
  ) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { description: { contains: searchTerm } },
        {
          user: {
            OR: [
              { full_name: { contains: searchTerm } },
              { account_number: { contains: searchTerm } },
              { phone: { contains: searchTerm } },
            ],
          },
        },
      ];
    }
    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { full_name: true, account_number: true, phone: true },
        },
      },
    });
    const total = transactions.length;
    return {
      message: 'All transactions retrieved successfully',
      data: {
        data: transactions,
        total,
      },
    };
  }

  // ==================== OPÉRATIONS AVANCÉES (avec langue) ====================
  private async shouldSendSms(userId: string): Promise<boolean> {
    const settings = await this.prisma.user_settings.findUnique({
      where: { user_id: userId },
      select: { sms_notifications: true },
    });
    return settings?.sms_notifications ?? true;
  }

  private async shouldSendPush(userId: string): Promise<boolean> {
    const settings = await this.prisma.user_settings.findUnique({
      where: { user_id: userId },
      select: { push_notifications: true },
    });
    return settings?.push_notifications ?? true;
  }

  private async getUserLanguage(userId: string): Promise<string> {
    const settings = await this.prisma.user_settings.findUnique({
      where: { user_id: userId },
      select: { language: true },
    });
    return settings?.language ?? 'fr';
  }

  async topUp(
    userId: string,
    amount: number,
    pin: string,
    lang: string = 'fr',
    ipAddress?: string,
  ): Promise<ApiResponse<{ wallet: WalletResponseDto; transaction: any }>> {
    console.log('[WalletService] Top-up request:', { userId, amount, lang });
    if (amount <= 0)
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    if (!pin || pin.length < 4) {
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.pin_min_length', lang),
        statusCode: 400,
      });
    }
    if (!/^\d+$/.test(pin)) {
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.pin_digits_only', lang),
        statusCode: 400,
      });
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              full_name: true,
              phone: true,
              account_number: true,
              pin: true,
              status: true,
              failed_pin_attempts: true,
            },
          });
          if (!user)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.user_not_found', lang),
              statusCode: 404,
            });

          if (user.status === user_status.BLOCKED) {
            const message = this.i18nService.translate('account_blocked_admin', lang);
            throw new RpcException({
              status: 'error',
              message,
              statusCode: 403,
            });
          }

          const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
          if (user.pin !== hashedPin) {
            const newAttempts = (user.failed_pin_attempts || 0) + 1;
            let newStatus: user_status = user.status;
            let lockedUntil: Date | null = null;
            if (newAttempts >= 5) {
              newStatus = user_status.BLOCKED;
              lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
            }
            await tx.user.update({
              where: { id: userId },
              data: {
                failed_pin_attempts: newAttempts,
                status: newStatus,
              },
            });
            await logFailedLoginAttempt(
              this.prisma,
              user.id,
              user.account_number ?? user.phone ?? user.id,
              ipAddress,
              undefined,
              newAttempts,
              lockedUntil,
            );
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.pin_incorrect', lang),
              statusCode: 401,
            });
          }

          await tx.user.update({
            where: { id: userId },
            data: { failed_pin_attempts: 0 },
          });

          if (!user.account_number)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.no_bank_account', lang),
              statusCode: 400,
            });

          let wallet = await tx.wallet.findUnique({ where: { userId } });
          if (!wallet) {
            wallet = await tx.wallet.create({
              data: {
                id: crypto.randomUUID(),
                userId,
                currency: 'CDF',
                balance: 0,
                isActive: true,
              },
            });
          }
          if (!wallet.isActive)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.wallet_inactive', lang),
              statusCode: 403,
            });

          let bankResponse;
          try {
            bankResponse = await this.bankService.topup(
              user.account_number,
              amount,
              undefined,
              lang,
            );
          } catch (bankError) {
            const failedTransaction = await tx.transaction.create({
              data: {
                id: crypto.randomUUID(),
                userId,
                walletId: wallet.id,
                amount,
                type: 'DEPOSIT',
                status: 'FAILED',
                reference: `TOPUP_FAILED_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
                description: this.i18nService.translate(
                  'wallet.failed_description',
                  lang,
                  {
                    reason: `Alimentation : ${bankResponse?.message || this.i18nService.translate('wallet.bank_api_error', lang)}`,
                  },
                ),
                movement: 'CREDIT',
              },
            });
            await this.logAudit(
              user.id,
              'topUp_failed',
              { transaction: failedTransaction, error: bankError.message },
              ipAddress || null,
            );
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.bank_timeout', lang),
              statusCode: 504,
            });
          }

          if (bankResponse.error || !bankResponse.success) {
            const failedTransaction = await tx.transaction.create({
              data: {
                id: crypto.randomUUID(),
                userId,
                walletId: wallet.id,
                amount,
                type: 'DEPOSIT',
                status: 'FAILED',
                reference: `TOPUP_FAILED_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
                description: this.i18nService.translate(
                  'wallet.failed_description',
                  lang,
                  {
                    reason: `Alimentation : ${bankResponse.message || this.i18nService.translate('wallet.bank_api_error', lang)}`,
                  },
                ),
                movement: 'CREDIT',
              },
            });
            await this.logAudit(
              user.id,
              'topUp_failed',
              { transaction: failedTransaction, error: bankResponse.message },
              ipAddress || null,
            );
            throw new RpcException({
              status: 'error',
              message: bankResponse.message || 'Bank topup failed',
              statusCode: bankResponse.code || 400,
            });
          }

          const updatedWallet = await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: amount }, updatedAt: new Date() },
          });

          let descriptionTemplate = this.i18nService.translate(
            'wallet.transaction_description_deposit',
            lang,
          );
          const description = descriptionTemplate.replace(
            '{accountNumber}',
            user.account_number,
          );

          const transaction = await tx.transaction.create({
            data: {
              id: crypto.randomUUID(),
              userId,
              walletId: wallet.id,
              amount,
              type: 'DEPOSIT',
              status: 'SUCCESS',
              reference: `TOPUP_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
              description,
              movement: 'CREDIT',
            },
          });

          await this.logAudit(user.id, 'topUp', transaction, ipAddress || null);
          return { wallet: updatedWallet, transaction, user };
        },
        { timeout: 120000, maxWait: 120000 },
      );

      // ✅ CORRECTION: Utiliser await pour garantir l'envoi de la notification
      try {
        await notifyTransaction(
          this.smsService,
          this.notificationHelper,
          this.i18nService,
          this.shouldSendSms.bind(this),
          this.shouldSendPush.bind(this),
          this.getUserLanguage.bind(this),
          result.transaction,
          result.user,
          result.wallet,
          'topup',
        );
      } catch (err) {
        console.error('[Notifications] topUp error:', err);
      }

      return {
        message: this.i18nService.translate('wallet.top_up_success', lang),
        data: {
          wallet: this.toResponse(result.wallet),
          transaction: result.transaction,
        },
      };
    } catch (error) {
      if (!(error instanceof RpcException)) {
        throw new RpcException({
          status: 'error',
          message:
            error.message ||
            this.i18nService.translate('wallet.top_up_failed', lang),
          statusCode: 500,
        });
      }
      throw error;
    }
  }

  async cashout(
    userId: string,
    dto: { accountNumber: string; amount: number; pin: string },
    lang: string = 'fr',
    ipAddress?: string,
  ): Promise<ApiResponse<{ wallet: WalletResponseDto; transaction: any }>> {
    const { accountNumber, amount, pin } = dto;
    console.log('[WalletService] Cashout request:', {
      userId,
      accountNumber,
      amount,
      lang,
    });
    if (amount <= 0) {
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              full_name: true,
              phone: true,
              account_number: true,
              pin: true,
              role: true,
              status: true,
              failed_pin_attempts: true,
            },
          });
          if (!user)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.user_not_found', lang),
              statusCode: 404,
            });

          if (user.status === user_status.BLOCKED) {
            const message = this.i18nService.translate('account_blocked_admin', lang);
            throw new RpcException({
              status: 'error',
              message,
              statusCode: 403,
            });
          }

          if (user.role === 'MERCHANT' && user.account_number !== accountNumber) {
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.cashout_merchant_restriction', lang),
              statusCode: 403,
            });
          }

          if (!user.pin)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.no_pin_set', lang),
              statusCode: 400,
            });

          const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
          if (user.pin !== hashedPin) {
            const newAttempts = (user.failed_pin_attempts || 0) + 1;
            let newStatus: user_status = user.status;
            let lockedUntil: Date | null = null;
            if (newAttempts >= 5) {
              newStatus = user_status.BLOCKED;
              lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
            }
            await tx.user.update({
              where: { id: userId },
              data: {
                failed_pin_attempts: newAttempts,
                status: newStatus,
              },
            });
            await logFailedLoginAttempt(
              this.prisma,
              user.id,
              user.account_number ?? user.phone ?? user.id,
              ipAddress,
              undefined,
              newAttempts,
              lockedUntil,
            );
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.pin_incorrect', lang),
              statusCode: 401,
            });
          }

          await tx.user.update({
            where: { id: userId },
            data: { failed_pin_attempts: 0 },
          });

          const wallet = await tx.wallet.findUnique({ where: { userId } });
          if (!wallet)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.wallet_not_found', lang),
              statusCode: 404,
            });
          if (!wallet.isActive)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.wallet_inactive', lang),
              statusCode: 403,
            });
          if (wallet.balance < amount)
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.insufficient_wallet_balance', lang),
              statusCode: 400,
            });

          let bankResponse;
          try {
            bankResponse = await this.bankService.cashout(
              accountNumber,
              amount,
              undefined,
              lang,
            );
          } catch (bankError) {
            const failedTransaction = await tx.transaction.create({
              data: {
                id: crypto.randomUUID(),
                userId,
                walletId: wallet.id,
                amount,
                type: 'WITHDRAW',
                status: 'FAILED',
                reference: `CASHOUT_FAILED_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
                description: this.i18nService.translate(
                  'wallet.failed_description',
                  lang,
                  {
                    reason: `Retrait : ${bankResponse?.message || this.i18nService.translate('wallet.bank_api_error', lang)}`,
                  },
                ),
                movement: 'DEBIT',
              },
            });
            await this.logAudit(
              user.id,
              'cashout_failed',
              { transaction: failedTransaction, error: bankError.message },
              ipAddress || null,
            );
            throw new RpcException({
              status: 'error',
              message: this.i18nService.translate('wallet.bank_timeout', lang),
              statusCode: 504,
            });
          }

          if (bankResponse.error || !bankResponse.success) {
            const failedTransaction = await tx.transaction.create({
              data: {
                id: crypto.randomUUID(),
                userId,
                walletId: wallet.id,
                amount,
                type: 'WITHDRAW',
                status: 'FAILED',
                reference: `CASHOUT_FAILED_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
                description: this.i18nService.translate(
                  'wallet.failed_description',
                  lang,
                  {
                    reason: `Retrait : ${bankResponse.message || this.i18nService.translate('wallet.bank_api_error', lang)}`,
                  },
                ),
                movement: 'DEBIT',
              },
            });
            await this.logAudit(
              user.id,
              'cashout_failed',
              { transaction: failedTransaction, error: bankResponse.message },
              ipAddress || null,
            );
            throw new RpcException({
              status: 'error',
              message: bankResponse.message || 'Bank cashout failed',
              statusCode: bankResponse.code || 400,
            });
          }

          const updatedWallet = await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: amount }, updatedAt: new Date() },
          });

          let descriptionTemplate = this.i18nService.translate(
            'wallet.transaction_description_withdraw',
            lang,
          );
          const description = descriptionTemplate.replace('{accountNumber}', accountNumber);

          const transaction = await tx.transaction.create({
            data: {
              id: crypto.randomUUID(),
              userId,
              walletId: wallet.id,
              amount,
              type: 'WITHDRAW',
              status: 'SUCCESS',
              reference: `CASHOUT_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
              description,
              movement: 'DEBIT',
            },
          });

          await this.logAudit(user.id, 'cashout', { transaction }, ipAddress ?? null);
          return { wallet: updatedWallet, transaction, user };
        },
        { timeout: 120000, maxWait: 120000 },
      );

      // ✅ CORRECTION: Utiliser await pour garantir l'envoi de la notification
      try {
        await notifyTransaction(
          this.smsService,
          this.notificationHelper,
          this.i18nService,
          this.shouldSendSms.bind(this),
          this.shouldSendPush.bind(this),
          this.getUserLanguage.bind(this),
          result.transaction,
          result.user,
          result.wallet,
          'cashout',
        );
      } catch (err) {
        console.error('[Notifications] cashout error:', err);
      }

      return {
        message: this.i18nService.translate('wallet.cashout_success', lang),
        data: {
          wallet: this.toResponse(result.wallet),
          transaction: result.transaction,
        },
      };
    } catch (error) {
      if (!(error instanceof RpcException)) {
        throw new RpcException({
          status: 'error',
          message:
            error.message ||
            this.i18nService.translate('wallet.cashout_failed', lang),
          statusCode: 500,
        });
      }
      throw error;
    }
  }

  async send(
    dto: SendDto,
    lang: string = 'fr',
    ipAddress: string,
  ): Promise<
    ApiResponse<{
      fromWallet: WalletResponseDto;
      toWallet: WalletResponseDto;
      transaction: any;
    }>
  > {
    const { fromAccountNumber, toPhone, amount, pin, description } = dto;
    console.log('[WalletService] Send request:', {
      fromAccountNumber,
      toPhone,
      amount,
      lang,
    });
    if (amount <= 0) {
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const fromUser = await tx.user.findFirst({
          where: { account_number: fromAccountNumber },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
            pin: true,
            status: true,
            failed_pin_attempts: true,
          },
        });
        if (!fromUser)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.sender_not_found', lang),
            statusCode: 404,
          });

        if (fromUser.status === user_status.BLOCKED) {
          const message = this.i18nService.translate('account_blocked_admin', lang);
          throw new RpcException({ status: 'error', message, statusCode: 403 });
        }

        if (!fromUser.pin)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.no_pin_set', lang),
            statusCode: 400,
          });
        const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
        if (fromUser.pin !== hashedPin) {
          const newAttempts = (fromUser.failed_pin_attempts || 0) + 1;
          let newStatus: user_status = fromUser.status;
          let lockedUntil: Date | null = null;
          if (newAttempts >= 5) {
            newStatus = user_status.BLOCKED;
            lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
          }
          await tx.user.update({
            where: { id: fromUser.id },
            data: {
              failed_pin_attempts: newAttempts,
              status: newStatus,
            },
          });
          await logFailedLoginAttempt(
            this.prisma,
            fromUser.id,
            fromUser.account_number ?? fromUser.phone ?? fromUser.id,
            ipAddress,
            undefined,
            newAttempts,
            lockedUntil,
          );
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.pin_incorrect', lang),
            statusCode: 401,
          });
        }

        await tx.user.update({
          where: { id: fromUser.id },
          data: { failed_pin_attempts: 0 },
        });

        const toUser = await tx.user.findUnique({
          where: { phone: toPhone },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
          },
        });
        if (!toUser)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.receiver_not_found', lang),
            statusCode: 404,
          });
        if (fromUser.id === toUser.id || fromUser.phone === toPhone) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.cannot_transfer_self', lang),
            statusCode: 400,
          });
        }
        const fromWallet = await tx.wallet.findUnique({
          where: { userId: fromUser.id },
          include: { user: true },
        });
        if (!fromWallet)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_not_found', lang),
            statusCode: 404,
          });
        if (!fromWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        if (fromWallet.balance < amount)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.insufficient_wallet_balance', lang),
            statusCode: 400,
          });
        const toWallet = await tx.wallet.upsert({
          where: { userId: toUser.id },
          update: {},
          create: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            currency: 'CDF',
            balance: 0,
            isActive: true,
          },
        });
        if (!toWallet.isActive)
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        const updatedFrom = await tx.wallet.update({
          where: { id: fromWallet.id },
          data: { balance: { decrement: amount }, updatedAt: new Date() },
        });
        const updatedTo = await tx.wallet.update({
          where: { id: toWallet.id },
          data: { balance: { increment: amount }, updatedAt: new Date() },
        });

        let senderDescription = description;
        let receiverDescription = description;

        if (!senderDescription) {
          let template = this.i18nService.translate(
            'wallet.transaction_description_transfer_sent',
            lang,
          );
          senderDescription = template
            .replace('{fullName}', toUser.full_name || '')
            .replace('{phone}', toPhone);
        } else {
          const recipientInfo = toUser.full_name
            ? `${toUser.full_name} (${toPhone})`
            : toPhone;
          const toText = this.i18nService.translate('wallet.to', lang);
          senderDescription = `${senderDescription} (${toText}: ${recipientInfo})`;
        }

        if (!receiverDescription) {
          let template2 = this.i18nService.translate(
            'wallet.transaction_description_transfer_received',
            lang,
          );
          receiverDescription = template2
            .replace('{fullName}', fromUser.full_name || '')
            .replace('{phone}', fromUser.phone || '');
        } else {
          const senderInfo = fromUser.full_name
            ? `${fromUser.full_name} (${fromUser.phone})`
            : fromUser.phone || fromUser.account_number;
          const fromText = this.i18nService.translate('wallet.from', lang);
          receiverDescription = `${receiverDescription} (${fromText}: ${senderInfo})`;
        }

        const senderTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: fromUser.id,
            walletId: fromWallet.id,
            amount,
            type: 'TRANSFER',
            status: 'SUCCESS',
            reference: `SEND_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: senderDescription,
            movement: 'DEBIT',
          },
        });
        const receiverTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            walletId: toWallet.id,
            amount,
            type: 'DEPOSIT',
            status: 'SUCCESS',
            reference: `RECV_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: receiverDescription,
            movement: 'CREDIT',
          },
        });
        await this.logAudit(toUser.id, 'transfer', updatedTo, ipAddress || null);
        return {
          fromWallet: updatedFrom,
          toWallet: updatedTo,
          fromUser,
          toUser,
          senderTx,
          receiverTx,
        };
      },
      { timeout: 60000, maxWait: 60000 },
    );

    // ✅ CORRECTION: Utiliser Promise.all avec await pour garantir l'envoi
    // Ne pas utiliser setImmediate qui peut ne pas s'exécuter
    try {
      await Promise.all([
        notifyTransaction(
          this.smsService,
          this.notificationHelper,
          this.i18nService,
          this.shouldSendSms.bind(this),
          this.shouldSendPush.bind(this),
          this.getUserLanguage.bind(this),
          result.senderTx,
          result.fromUser,
          result.fromWallet,
          'send_sent',
          {
            name: result.toUser.full_name ?? undefined,
            phone: result.toUser.phone ?? undefined,
          },
        ),
        notifyTransaction(
          this.smsService,
          this.notificationHelper,
          this.i18nService,
          this.shouldSendSms.bind(this),
          this.shouldSendPush.bind(this),
          this.getUserLanguage.bind(this),
          result.receiverTx,
          result.toUser,
          result.toWallet,
          'send_received',
          {
            name: result.fromUser.full_name ?? undefined,
            phone: result.fromUser.phone ?? undefined,
          },
        ),
      ]);
    } catch (err) {
      console.error('[Notifications] Send notification error:', err);
    }

    return {
      message: this.i18nService.translate('wallet.transfer_success', lang),
      data: {
        fromWallet: this.toResponse(result.fromWallet),
        toWallet: this.toResponse(result.toWallet),
        transaction: { reference: `SEND_${Date.now()}` },
      },
    };
  }

  async pay(
    dto: PayDto,
    lang: string = 'fr',
    ipAddress: string,
  ): Promise<ApiResponse<{ wallet: WalletResponseDto; transaction: any }>> {
    const {
      fromAccountNumber,
      toPhone,
      merchantCode,
      amount,
      pin,
      description,
    } = dto;
    if (amount <= 0) {
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.amount_positive', lang),
        statusCode: 400,
      });
    }
    const result = await this.prisma.$transaction(
      async (tx) => {
        const fromUser = await tx.user.findFirst({
          where: { account_number: fromAccountNumber },
          select: {
            id: true,
            full_name: true,
            phone: true,
            account_number: true,
            pin: true,
            status: true,
            failed_pin_attempts: true,
          },
        });
        if (!fromUser) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.sender_not_found', lang),
            statusCode: 404,
          });
        }

        if (fromUser.status === user_status.BLOCKED) {
          const message = this.i18nService.translate('account_blocked_admin', lang);
          throw new RpcException({ status: 'error', message, statusCode: 403 });
        }

        if (!fromUser.pin) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.no_pin_set', lang),
            statusCode: 400,
          });
        }
        const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
        if (fromUser.pin !== hashedPin) {
          const newAttempts = (fromUser.failed_pin_attempts || 0) + 1;
          let newStatus: user_status = fromUser.status;
          let lockedUntil: Date | null = null;
          if (newAttempts >= 5) {
            newStatus = user_status.BLOCKED;
            lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
          }
          await tx.user.update({
            where: { id: fromUser.id },
            data: {
              failed_pin_attempts: newAttempts,
              status: newStatus,
            },
          });
          await logFailedLoginAttempt(
            this.prisma,
            fromUser.id,
            fromUser.account_number ?? fromUser.phone ?? fromUser.id,
            ipAddress,
            undefined,
            newAttempts,
            lockedUntil,
          );
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.pin_incorrect', lang),
            statusCode: 401,
          });
        }

        await tx.user.update({
          where: { id: fromUser.id },
          data: { failed_pin_attempts: 0 },
        });

        let toUser;
        if (toPhone) {
          toUser = await tx.user.findUnique({
            where: { phone: toPhone },
            select: {
              id: true,
              full_name: true,
              phone: true,
              account_number: true,
              role: true,
            },
          });
        } else if (merchantCode) {
          toUser = await tx.user.findFirst({
            where: { merchantCode },
            select: {
              id: true,
              full_name: true,
              phone: true,
              account_number: true,
              role: true,
            },
          });
        } else {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.missing_phone_or_code', lang),
            statusCode: 400,
          });
        }
        if (!toUser) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.receiver_not_found', lang),
            statusCode: 404,
          });
        }
        if (toUser.role !== 'MERCHANT') {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.not_merchant', lang),
            statusCode: 400,
          });
        }
        if (fromUser.id === toUser.id) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.cannot_transfer_self', lang),
            statusCode: 400,
          });
        }
        const userWallet = await tx.wallet.findUnique({
          where: { userId: fromUser.id },
        });
        if (!userWallet || !userWallet.isActive) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        }
        if (userWallet.balance < amount) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.insufficient_wallet_balance', lang),
            statusCode: 400,
          });
        }
        const merchantWallet = await tx.wallet.upsert({
          where: { userId: toUser.id },
          update: {},
          create: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            currency: 'CDF',
            balance: 0,
            isActive: true,
          },
        });
        if (!merchantWallet.isActive) {
          throw new RpcException({
            status: 'error',
            message: this.i18nService.translate('wallet.wallet_inactive', lang),
            statusCode: 403,
          });
        }
        const updatedUser = await tx.wallet.update({
          where: { id: userWallet.id },
          data: { balance: { decrement: amount }, updatedAt: new Date() },
        });
        const updatedMerchant = await tx.wallet.update({
          where: { id: merchantWallet.id },
          data: { balance: { increment: amount }, updatedAt: new Date() },
        });

        let payerDescription = description;
        let merchantDescription = description;

        if (!payerDescription) {
          let template = this.i18nService.translate(
            'wallet.transaction_description_payment_sent',
            lang,
          );
          payerDescription = template
            .replace('{merchantName}', toUser.full_name || '')
            .replace('{merchantPhone}', toUser.phone || '');
        } else {
          const merchantInfo = toUser.full_name
            ? `${toUser.full_name} (${toUser.phone || merchantCode})`
            : toUser.phone || merchantCode;
          const toText = this.i18nService.translate('wallet.to', lang);
          payerDescription = `${payerDescription} (${toText}: ${merchantInfo})`;
        }

        if (!merchantDescription) {
          let template2 = this.i18nService.translate(
            'wallet.transaction_description_payment_received',
            lang,
          );
          merchantDescription = template2
            .replace('{fullName}', fromUser.full_name || '')
            .replace('{accountNumber}', fromAccountNumber);
        } else {
          const payerInfo = fromUser.full_name
            ? `${fromUser.full_name} (${fromUser.phone || fromAccountNumber})`
            : fromUser.phone || fromAccountNumber;
          const fromText = this.i18nService.translate('wallet.from', lang);
          merchantDescription = `${merchantDescription} (${fromText}: ${payerInfo})`;
        }

        const payerTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: fromUser.id,
            walletId: userWallet.id,
            amount,
            type: 'PAYMENT',
            status: 'SUCCESS',
            reference: `PAY_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: payerDescription,
            movement: 'DEBIT',
          },
        });
        const merchantTx = await tx.transaction.create({
          data: {
            id: crypto.randomUUID(),
            userId: toUser.id,
            walletId: merchantWallet.id,
            amount,
            type: 'PAYMENT',
            status: 'SUCCESS',
            reference: `PAY_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            description: merchantDescription,
            movement: 'CREDIT',
          },
        });
        return {
          fromUser,
          toUser,
          userWallet,
          merchantWallet,
          updatedUser,
          updatedMerchant,
          payerTx,
          merchantTx,
        };
      },
      { timeout: 60000, maxWait: 60000 },
    );
    const {
      fromUser,
      toUser,
      userWallet,
      merchantWallet,
      updatedUser,
      payerTx,
      merchantTx,
    } = result;
    await this.logAudit(fromUser.id, 'payment', updatedUser, ipAddress ?? null);

    // ✅ CORRECTION: Utiliser Promise.all avec await
    try {
      await Promise.all([
        notifyTransaction(
          this.smsService,
          this.notificationHelper,
          this.i18nService,
          this.shouldSendSms.bind(this),
          this.shouldSendPush.bind(this),
          this.getUserLanguage.bind(this),
          payerTx,
          fromUser,
          userWallet,
          'pay_sent',
          {
            name: toUser.full_name ?? undefined,
            phone: toUser.phone ?? undefined,
          },
        ),
        notifyTransaction(
          this.smsService,
          this.notificationHelper,
          this.i18nService,
          this.shouldSendSms.bind(this),
          this.shouldSendPush.bind(this),
          this.getUserLanguage.bind(this),
          merchantTx,
          toUser,
          merchantWallet,
          'pay_received',
          {
            name: fromUser.full_name ?? undefined,
            accountNumber: fromAccountNumber,
          },
        ),
      ]);
    } catch (err) {
      console.error('[Notifications] Pay notification error:', err);
    }

    return {
      message: this.i18nService.translate('wallet.payment_success', lang),
      data: {
        wallet: this.toResponse(updatedUser),
        transaction: payerTx,
      },
    };
  }

  // ==================== ADMIN OPERATIONS (sans PIN) ====================
  async getMerchantByCode(
    merchantCode: string,
  ): Promise<{ message: string; data: any }> {
    console.log('[UserService] getMerchantByCode:', merchantCode);
    const merchant = await this.prisma.user.findFirst({
      where: { merchantCode, role: 'MERCHANT' },
      select: {
        id: true,
        full_name: true,
        phone: true,
        account_number: true,
        branch: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        merchantCode: true,
      },
    });
    if (!merchant) {
      throw new RpcException({
        status: 'error',
        message: 'Commerçant introuvable avec ce code',
        statusCode: 404,
      });
    }
    return {
      message: 'Commerçant récupéré avec succès',
      data: merchant,
    };
  }

  async getTransactionById(transactionId: string): Promise<ApiResponse<any>> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        user: {
          select: {
            id: true,
            full_name: true,
            phone: true,
          },
        },
      },
    });
    if (!transaction) {
      throw new RpcException({
        status: 'error',
        message: 'Transaction non trouvée',
        statusCode: 404,
      });
    }
    return {
      message: 'Transaction récupérée avec succès',
      data: transaction,
    };
  }

  private async logFailedTransaction(
    transactionData: Partial<any>,
    error: Error | any,
    context?: { ip?: string; userAgent?: string; originalTransaction?: any },
  ) {
    try {
      let failureCode = error.code || error.name || 'UNKNOWN_ERROR';
      let canRetry = true;
      const nonRetryableErrors = [
        'INSUFFICIENT_BALANCE',
        'PIN_INCORRECT',
        'ACCOUNT_NOT_FOUND',
        'USER_NOT_FOUND',
      ];
      if (nonRetryableErrors.includes(failureCode)) {
        canRetry = false;
      }
      const failureDetails = {
        message: error.message,
        stack: error.stack,
        context: context,
        timestamp: new Date().toISOString(),
      };
      await this.prisma.failed_transaction_log.create({
        data: {
          id: crypto.randomUUID(),
          transactionId: transactionData.id || `pending_${Date.now()}`,
          userId:
            transactionData.userId || context?.originalTransaction?.userId,
          walletId:
            transactionData.walletId || context?.originalTransaction?.walletId,
          amount: transactionData.amount || 0,
          type: transactionData.type || 'TRANSFER',
          movement: transactionData.movement || 'DEBIT',
          reference: transactionData.reference || `FAILED_${Date.now()}`,
          description: transactionData.description,
          failure_reason: error.message || 'Unknown error occurred',
          failure_code: failureCode,
          failure_details: JSON.stringify(failureDetails),
          ip_address: context?.ip,
          user_agent: context?.userAgent,
          original_created_at:
            context?.originalTransaction?.createdAt || new Date(),
          created_at: new Date(),
          can_retry: canRetry,
          retry_count: 0,
        },
      });
    } catch (logError) {
      console.error(
        '[FailedTransactionLog] Error logging failed transaction:',
        logError,
      );
    }
  }

  async generateStatement(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    lang: string = 'fr',
  ): Promise<{ pdfBase64: string; message: string }> {
    console.log('[WalletService] Generate statement:', {
      userId,
      startDate,
      endDate,
      lang,
    });

    // 1. Récupérer l'utilisateur
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        account_number: true,
      },
    });
    if (!user) {
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.user_not_found', lang),
        statusCode: 404,
      });
    }

    // 2. Construire le filtre de date (optionnel) avec correction pour endDate
    const dateFilter: any = {};
    if (startDate && endDate) {
      dateFilter.gte = startDate;
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter.lte = endOfDay;
    } else if (startDate) {
      dateFilter.gte = startDate;
    } else if (endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter.lte = endOfDay;
    }

    const where: any = { userId };
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }

    // 3. Récupérer les transactions
    const transactionsDb = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    console.log(
      `[WalletService] Found ${transactionsDb.length} transactions for period`,
    );

    // 4. Locale pour les dates
    let localeStr = 'fr-FR';
    if (lang === 'en') localeStr = 'en-US';
    else if (lang === 'sw') localeStr = 'sw-TZ';

    // 5. Formater les dates d'affichage (période)
    let periodStartFormatted: string = '';
    let periodEndFormatted: string = '';
    let hasDateRange = false;

    if (startDate) {
      periodStartFormatted = startDate.toLocaleDateString(localeStr);
      hasDateRange = true;
    } else {
      periodStartFormatted = this.i18nService.translate(
        'statement.all_time_start',
        lang,
      );
    }

    if (endDate) {
      periodEndFormatted = endDate.toLocaleDateString(localeStr);
      hasDateRange = true;
    } else {
      periodEndFormatted = this.i18nService.translate(
        'statement.all_time_end',
        lang,
      );
    }

    const generatedDateFormatted = new Date().toLocaleString(localeStr);

    // 6. Construire les transactions formatées (solde cumulé)
    let balance = 0;
    const formattedTransactions: FormattedTransaction[] = [];

    for (const tx of transactionsDb) {
      if (tx.movement === 'CREDIT') balance += tx.amount;
      else if (tx.movement === 'DEBIT') balance -= tx.amount;

      let description = '';
      switch (tx.type) {
        case 'DEPOSIT':
          description = this.i18nService.translate('transaction.deposit', lang);
          break;
        case 'WITHDRAW':
          description = this.i18nService.translate(
            'transaction.withdraw',
            lang,
          );
          break;
        case 'TRANSFER':
          description = this.i18nService.translate(
            'transaction.transfer',
            lang,
          );
          break;
        case 'PAYMENT':
          description = this.i18nService.translate('transaction.payment', lang);
          break;
        default:
          description = tx.type;
      }

      formattedTransactions.push({
        description,
        detail: tx.description || '',
        reference: tx.reference || tx.id.slice(0, 8),
        date: tx.createdAt.toLocaleDateString(localeStr),
        credit: tx.movement === 'CREDIT' ? tx.amount : null,
        debit: tx.movement === 'DEBIT' ? tx.amount : null,
        balance,
      });
    }

    // 7. Totaux sur la période
    const totalCredits = transactionsDb
      .filter((tx) => tx.movement === 'CREDIT')
      .reduce((sum, tx) => sum + tx.amount, 0);
    const totalDebits = transactionsDb
      .filter((tx) => tx.movement === 'DEBIT')
      .reduce((sum, tx) => sum + tx.amount, 0);

    // 8. Récupérer la devise (mais plus le solde actuel)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const currency = wallet?.currency || 'CDF';

    // 9. Fonction de traduction avec fallback
    const t = (key: string): string => {
      const translated = this.i18nService.translate(key, lang);
      if (translated === key) {
        const fallbacks: Record<string, string> = {
          'statement.title':
            lang === 'fr'
              ? 'RELEVÉ DE COMPTE'
              : lang === 'en'
                ? 'ACCOUNT STATEMENT'
                : 'TAARIFA YA AKAUUNTI',
          'statement.client_info':
            lang === 'fr'
              ? 'INFORMATIONS CLIENT'
              : lang === 'en'
                ? 'CLIENT INFORMATION'
                : 'TAARIFA ZA MTUMIAJI',
          'statement.summary':
            lang === 'fr'
              ? 'RÉCAPITULATIF'
              : lang === 'en'
                ? 'SUMMARY'
                : 'MUHTASARI',
          'statement.details':
            lang === 'fr' ? 'Détails' : lang === 'en' ? 'Details' : 'Maelezo',
          'statement.reference':
            lang === 'fr'
              ? 'Référence'
              : lang === 'en'
                ? 'Reference'
                : 'Kumbukumbu',
          'statement.date':
            lang === 'fr' ? 'Date' : lang === 'en' ? 'Date' : 'Tarehe',
          'statement.credit':
            lang === 'fr'
              ? 'Crédit (Entrée)'
              : lang === 'en'
                ? 'Credit (In)'
                : 'Mkopo (Kuingia)',
          'statement.debit':
            lang === 'fr'
              ? 'Débit (Sortie)'
              : lang === 'en'
                ? 'Debit (Out)'
                : 'Deni (Kutoka)',
          'statement.balance':
            lang === 'fr' ? 'Solde' : lang === 'en' ? 'Balance' : 'Salio',
          'statement.totals':
            lang === 'fr' ? 'TOTAUX' : lang === 'en' ? 'TOTALS' : 'JUMLA',
          'statement.no_transactions':
            lang === 'fr'
              ? 'Aucune transaction sur cette période'
              : lang === 'en'
                ? 'No transactions in this period'
                : 'Hakuna miamala katika kipindi hiki',
          'statement.footer_text':
            lang === 'fr'
              ? 'Ce document est un relevé de compte officiel des transactions AccesPay'
              : lang === 'en'
                ? 'This is an official statement of AccesPay transactions'
                : 'Hii ni taarifa rasmi ya miamala ya AccesPay',
          'statement.generated_on':
            lang === 'fr'
              ? 'Relevé généré le'
              : lang === 'en'
                ? 'Generated on'
                : 'Imetolewa tarehe',
          'statement.full_name':
            lang === 'fr'
              ? 'Nom complet'
              : lang === 'en'
                ? 'Full name'
                : 'Jina kamili',
          'statement.account_number':
            lang === 'fr'
              ? 'N° Compte'
              : lang === 'en'
                ? 'Account number'
                : 'Nambari ya akaunti',
          'statement.phone':
            lang === 'fr' ? 'Téléphone' : lang === 'en' ? 'Phone' : 'Simu',
          'statement.email':
            lang === 'fr' ? 'Email' : lang === 'en' ? 'Email' : 'Barua pepe',
          'statement.address':
            lang === 'fr' ? 'Adresse' : lang === 'en' ? 'Address' : 'Anwani',
          'statement.total_credits':
            lang === 'fr'
              ? 'Total Crédits (Entrées)'
              : lang === 'en'
                ? 'Total Credits (In)'
                : 'Jumla ya Mikopo (Kuingia)',
          'statement.total_debits':
            lang === 'fr'
              ? 'Total Débits (Sorties)'
              : lang === 'en'
                ? 'Total Debits (Out)'
                : 'Jumla ya Madeni (Kutoka)',
          'statement.final_balance':
            lang === 'fr'
              ? 'Solde final'
              : lang === 'en'
                ? 'Final balance'
                : 'Salio la mwisho',
          'statement.all_time_start':
            lang === 'fr' ? 'Début' : lang === 'en' ? 'Beginning' : 'Mwanzo',
          'statement.all_time_end':
            lang === 'fr' ? "Aujourd'hui" : lang === 'en' ? 'Today' : 'Leo',
        };
        return fallbacks[key] || key;
      }
      return translated;
    };

    // 10. Logo en base64
    let logoBase64 = '';
    try {
      const logoPath = path.join(
        process.cwd(),
        'public',
        'uploads',
        'icon.png',
      );
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
      } else {
        console.warn('[WalletService] Logo not found at', logoPath);
      }
    } catch (err) {
      console.error('[WalletService] Error reading logo:', err);
    }

    // 11. Contexte pour le template EJS
    const context = {
      lang,
      logoBase64,
      periodStart: periodStartFormatted,
      periodEnd: periodEndFormatted,
      hasDateRange,
      generatedDate: generatedDateFormatted,
      client: {
        fullName: user.full_name || 'N/A',
        accountNumber: user.account_number || 'N/A',
        phone: user.phone || 'N/A',
        email: user.email || 'N/A',
      },
      currency,
      totals: {
        credits: totalCredits.toFixed(2),
        debits: totalDebits.toFixed(2),
        balance: balance.toFixed(2), // ✅ Correction : solde à la fin de la période
      },
      transactions: formattedTransactions,
      labels: {
        title: t('statement.title'),
        clientInfo: t('statement.client_info'),
        summary: t('statement.summary'),
        details: t('statement.details'),
        reference: t('statement.reference'),
        date: t('statement.date'),
        credit: t('statement.credit'),
        debit: t('statement.debit'),
        balance: t('statement.balance'),
        totals: t('statement.totals'),
        noTransactions: t('statement.no_transactions'),
        footerText: t('statement.footer_text'),
        generatedOn: t('statement.generated_on'),
        fullName: t('statement.full_name'),
        accountNumber: t('statement.account_number'),
        phone: t('statement.phone'),
        email: t('statement.email'),
        address: t('statement.address'),
        totalCredits: t('statement.total_credits'),
        totalDebits: t('statement.total_debits'),
        finalBalance: t('statement.final_balance'),
      },
    };

    // 12. Chemin du template
    let templatePath: string;
    if (process.env.NODE_ENV === 'production') {
      templatePath = path.join(
        __dirname,
        '..',
        'templates',
        'wallet',
        'statement.ejs',
      );
      if (!fs.existsSync(templatePath)) {
        templatePath = path.join(
          process.cwd(),
          'dist',
          'apps',
          'wallet-service',
          'templates',
          'wallet',
          'statement.ejs',
        );
      }
    } else {
      templatePath = path.join(
        process.cwd(),
        'apps',
        'wallet-service',
        'src',
        'templates',
        'wallet',
        'statement.ejs',
      );
    }
    console.log('[WalletService] Template path:', templatePath);
    if (!fs.existsSync(templatePath)) {
      console.error(`[WalletService] Template not found at ${templatePath}`);
      throw new RpcException({
        status: 'error',
        message: 'Template file missing',
        statusCode: 500,
      });
    }

    // 13. Génération du PDF
    try {
      const htmlContent = await ejs.renderFile(templatePath, context, {
        async: true,
      });
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      const pdfUint8Array = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '30px', left: '20px', right: '20px' },
        timeout: 120000,
      });
      await browser.close();

      let pdfBuffer: Buffer;
      if (Buffer.isBuffer(pdfUint8Array)) {
        pdfBuffer = pdfUint8Array;
      } else {
        pdfBuffer = Buffer.from(pdfUint8Array);
      }
      if (pdfBuffer.length === 0) throw new Error('Generated PDF is empty');

      const pdfBase64 = pdfBuffer.toString('base64');
      return {
        pdfBase64,
        message: this.i18nService.translate('wallet.statement_generated', lang),
      };
    } catch (error) {
      console.error('[WalletService] PDF generation error:', error);
      throw new RpcException({
        status: 'error',
        message: this.i18nService.translate('wallet.statement_error', lang),
        statusCode: 500,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async healthCheck() {
    return { status: 'ok', service: 'wallet-service' };
  }

  private toResponse(wallet: any): WalletResponseDto {
    return {
      id: wallet.id,
      userId: wallet.userId,
      balance: wallet.balance,
      currency: wallet.currency,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
