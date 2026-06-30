/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/wallet-service/src/wallet-service.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import { WalletServiceService } from './wallet-service.service';
import { PayDto, SendDto } from './dto/wallet-operation.dto';

@Controller()
export class WalletServiceController {
  constructor(private readonly walletService: WalletServiceService) {}

  // ==================== MÉTHODES DE BASE ====================

  @MessagePattern('create_wallet')
  async createWallet(@Payload() data: { userId: string; currency?: string }) {
    console.log('[WalletService] create_wallet received:', data);
    try {
      return await this.walletService.createWallet(data);
    } catch (error) {
      console.error('[WalletService] create_wallet error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('get_wallet')
  async getWallet(@Payload() data: { userId: string }) {
    console.log('[WalletService] get_wallet received:', data.userId);
    try {
      return await this.walletService.getWallet(data.userId);
    } catch (error) {
      console.error('[WalletService] get_wallet error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 404,
      });
    }
  }

  @MessagePattern('get_wallet_by_user')
  async getWalletByUser(@Payload() data: { userId: string }) {
    console.log('[WalletService] get_wallet received:', data.userId);
    try {
      return await this.walletService.getWallet(data.userId);
    } catch (error) {
      console.error('[WalletService] get_wallet error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 404,
      });
    }
  }

  @MessagePattern('get_wallet_by_phone')
  async getWalletByPhone(@Payload() data: { phone: string }) {
    console.log('[WalletService] get_wallet_by_phone received:', data.phone);
    try {
      return await this.walletService.getWalletByPhone(data.phone);
    } catch (error) {
      console.error('[WalletService] get_wallet_by_phone error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 404,
      });
    }
  }

  @MessagePattern('get_merchant_by_code')
  async getMerchantByCode(@Payload() data: { merchantCode: string }) {
    console.log(
      '[UserService] get_merchant_by_code received:',
      data.merchantCode,
    );
    try {
      return await this.walletService.getMerchantByCode(data.merchantCode);
    } catch (error) {
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 404,
      });
    }
  }

  @MessagePattern('get_transaction_by_id')
  async getTransactionById(@Payload() data: { transactionId: string }) {
    console.log(
      '[WalletService] get_transaction_by_id received:',
      data.transactionId,
    );
    try {
      return await this.walletService.getTransactionById(data.transactionId);
    } catch (error) {
      console.error('[WalletService] get_transaction_by_id error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 404,
      });
    }
  }

  @MessagePattern('credit_wallet')
  async creditWallet(
    @Payload() data: { userId: string; amount: number; description?: string },
  ) {
    console.log('[WalletService] credit_wallet received:', data);
    try {
      return await this.walletService.creditWallet(data);
    } catch (error) {
      console.error('[WalletService] credit_wallet error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('debit_wallet')
  async debitWallet(
    @Payload() data: { userId: string; amount: number; description?: string },
  ) {
    console.log('[WalletService] debit_wallet received:', data);
    try {
      return await this.walletService.debitWallet(data);
    } catch (error) {
      console.error('[WalletService] debit_wallet error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('transfer')
  async transfer(
    @Payload()
    data: {
      fromUserId: string;
      toUserId: string;
      amount: number;
      description?: string;
    },
  ) {
    console.log('[WalletService] transfer received:', data);
    try {
      return await this.walletService.transfer(data);
    } catch (error) {
      console.error('[WalletService] transfer error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('list_transactions')
  async listTransactions(
    @Payload()
    data: {
      userId: string;
      page?: number;
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    console.log('[WalletService] list_transactions received:', data);
    try {
      return await this.walletService.listTransactions(
        data.userId,
        data.page,
        data.limit,
        data.startDate,
        data.endDate,
      );
    } catch (error) {
      console.error('[WalletService] list_transactions error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('list_all_transactions')
  async listAllTransactions(
    @Payload()
    data: {
      page?: number;
      limit?: number;
      userId?: string;
      type?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    },
  ) {
    console.log('[WalletService] list_all_transactions received:', data);
    try {
      const startDate = data.startDate ? new Date(data.startDate) : undefined;
      const endDate = data.endDate ? new Date(data.endDate) : undefined;
      return await this.walletService.listAllTransactions(
        data.page,
        data.limit,
        data.userId,
        data.type,
        data.status,
        startDate,
        endDate,
        data.search,
      );
    } catch (error) {
      console.error('[WalletService] list_all_transactions error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('list_all_transactions_unpaginated')
  async listAllTransactionsUnpaginated(
    @Payload()
    data: {
      userId?: string;
      type?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
    },
  ) {
    try {
      return await this.walletService.listAllTransactionsWithoutPagination(
        data.userId,
        data.type,
        data.status,
        data.startDate,
        data.endDate,
        data.search,
      );
    } catch (error) {
      throw new RpcException({
        status: 'error',
        message: error.message || 'Failed to list transactions',
        statusCode: 500,
      });
    }
  }

  @MessagePattern('list_all_trans')
  async listAllTransactionsWithoutPag(
    @Payload()
    data: {
      userId?: string;
      type?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    },
  ) {
    console.log('[WalletService] list_all_trans received:', data);
    try {
      const startDate = data.startDate ? new Date(data.startDate) : undefined;
      const endDate = data.endDate ? new Date(data.endDate) : undefined;
      return await this.walletService.listAllTransactionsWithoutPag(
        data.userId,
        data.type,
        data.status,
        startDate,
        endDate,
        data.search,
      );
    } catch (error) {
      console.error('[WalletService] list_all_trans error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  // ==================== OPÉRATIONS AVANCÉES (avec langue) ====================

  @MessagePattern('top_up')
  async topUp(
    @Payload()
    data: {
      userId: string;
      amount: number;
      pin: string;
      lang?: string;
      ipAddress?: string;
    },
  ) {
    console.log('[WalletService] top_up received:', data);
    try {
      return await this.walletService.topUp(
        data.userId,
        data.amount,
        data.pin,
        data.lang || 'fr',
        data.ipAddress,
      );
    } catch (error) {
      console.error('[WalletService] top_up error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('cashout')
  async cashout(
    @Payload()
    data: {
      userId: string;
      accountNumber: string;
      amount: number;
      pin: string;
      lang?: string;
      ipAddress?: string;
    },
  ) {
    console.log('[WalletService] cashout received:', {
      userId: data.userId,
      accountNumber: data.accountNumber,
      amount: data.amount,
      lang: data.lang,
    });
    try {
      return await this.walletService.cashout(
        data.userId,
        {
          accountNumber: data.accountNumber,
          amount: data.amount,
          pin: data.pin,
        },
        data.lang || 'fr',
        data.ipAddress,
      );
    } catch (error) {
      console.error('[WalletService] cashout error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('send')
  async send(@Payload() data: SendDto & { lang?: string }, ipAddress: string) {
    console.log('[WalletService] send received:', {
      from: data.fromAccountNumber,
      to: data.toPhone,
      amount: data.amount,
      lang: data.lang,
    });
    try {
      return await this.walletService.send(data, data.lang || 'fr', ipAddress);
    } catch (error) {
      console.error('[WalletService] send error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('pay')
  async pay(@Payload() data: PayDto & { lang?: string }, ipAddress: string) {
    console.log('[WalletService] pay received:', { ...data, lang: data.lang });
    try {
      return await this.walletService.pay(data, data.lang || 'fr', ipAddress);
    } catch (error) {
      console.error('[WalletService] pay error:', error);
      throw new RpcException({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 400,
      });
    }
  }

  @MessagePattern('link_account')
  async linkAccount(
    @Payload() data: { accountNumber: string; requestId?: string },
  ) {
    return this.walletService.linkAccount(data.accountNumber, data.requestId);
  }

  @MessagePattern('topup')
  async topup(
    @Payload()
    data: {
      accountNumber: string;
      amount: number;
      requestId?: string;
    },
  ) {
    return this.walletService.topup(
      data.accountNumber,
      data.amount,
      data.requestId,
    );
  }

  @MessagePattern('cashouts')
  async cashouts(
    @Payload()
    data: {
      accountNumber: string;
      amount: number;
      pin: string;
      requestId?: string;
    },
  ) {
    return this.walletService.cashouts(
      data.accountNumber,
      data.amount,
      data.requestId,
    );
  }

  // ==================== ADMIN OPERATIONS (sans PIN) ====================

  @MessagePattern('admin_top_up')
  async adminTopUp(
    @Payload()
    data: {
      userId: string;
      amount: number;
      lang?: string;
      ipAddress?: string;
    },
  ) {
    return this.walletService.adminTopUp(
      data.userId,
      data.amount,
      data.lang || 'fr',
      data.ipAddress,
    );
  }

  @MessagePattern('admin_cashout')
  async adminCashout(
    @Payload()
    data: {
      userId: string;
      accountNumber: string;
      amount: number;
      lang?: string;
      ipAddress?: string;
    },
  ) {
    return this.walletService.adminCashout(
      data.userId,
      data.accountNumber,
      data.amount,
      data.lang || 'fr',
      data.ipAddress,
    );
  }

  @MessagePattern('admin_send')
  async adminSend(
    @Payload() data: SendDto & { lang?: string; ipAddress?: string },
  ) {
    return this.walletService.adminSend(
      data,
      data.lang || 'fr',
      data.ipAddress || '',
    );
  }

  @MessagePattern('admin_pay')
  async adminPay(
    @Payload() data: PayDto & { lang?: string; ipAddress?: string },
  ) {
    return this.walletService.adminPay(
      data,
      data.lang || 'fr',
      data.ipAddress || '',
    );
  }

  // ==================== DOWNLOAD STATEMENT ====================

  @MessagePattern('generate_statement_pdf')
  async generateStatementPdf(
    @Payload()
    data: {
      userId: string;
      startDate?: string;
      endDate?: string;
      lang?: string;
    },
  ) {
    let startDate: Date | undefined = undefined;
    let endDate: Date | undefined = undefined;
    if (data.startDate && data.startDate.trim() !== '') {
      startDate = new Date(data.startDate);
      if (isNaN(startDate.getTime())) startDate = undefined;
    }
    if (data.endDate && data.endDate.trim() !== '') {
      endDate = new Date(data.endDate);
      if (isNaN(endDate.getTime())) endDate = undefined;
    }
    return this.walletService.generateStatement(
      data.userId,
      startDate,
      endDate,
      data.lang || 'fr',
    );
  }

  // ==================== HEALTH CHECK ====================

  @MessagePattern('health_check')
  async healthCheck() {
    return this.walletService.healthCheck();
  }
}
