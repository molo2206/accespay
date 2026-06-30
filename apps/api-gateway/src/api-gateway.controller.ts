/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api-gateway/src/api-gateway.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Delete,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
  Headers,
  Logger,
  Query,
  BadRequestException,
  UseInterceptors,
  Request,
  Res,
} from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { firstValueFrom, catchError, timeout } from 'rxjs';
import { LoginRequestDto, RegisterRequestDto } from './dto/api-getway.dto';
import { AuthResponseDto } from 'apps/auth-service/src/dto/auth-response.dto';
import { AuthentificationGuard } from 'apps/auth-service/src/utility/guards/authentification.guard';
import { CurrentUser } from 'apps/auth-service/src/utility/decorators/current-user-decorator';
import { JwtAuthGuard } from 'apps/auth-service/src/utility/guards/jwt-auth.guard';
import {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
} from '../../user-service/src/dto/create-user.dto';
import { Ip } from './decorators/ip.decorator';
import { IpInterceptor } from './inrceptor/ip.interceptor';
import { UpdateUserSettingsDto } from 'apps/user-service/src/dto/user-settings.dto';
import type { Response } from 'express';
import {
  AssignMultipleResourcesDto,
  AssignResourceDto,
} from 'apps/user-service/src/dto/assign-resource.dto';
import { UpdateResourceDto } from 'apps/user-service/src/resources/dto/update-resource.dto';
import { CreateResourceDto } from 'apps/user-service/src/resources/dto/create-resource.dto';
import { UpsertAppSettingsDto } from 'apps/user-service/src/dto/app-settings.dto';
import { Permissions } from 'apps/auth-service/src/utility/guards/permissions.guard';

const gatewayLoginLocks = new Map<string, boolean>();

interface RpcError {
  status?: string;
  message?: string;
  statusCode?: number;
}

interface AccountData {
  id: string;
  full_name: string;
  account_number: string;
  phone: string;
  branch: string | null;
  email: string | null;
  status: string;
  kyc_status: string;
  balance: number;
  currency: string;
  address: string | null;
  city: string | null;
  country: string | null;
  account_type: string;
  account_tier: string;
  opening_date: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface AccountResponse {
  success: boolean;
  data: AccountData;
}

@Controller()
@UseInterceptors(IpInterceptor)
export class ApiGatewayController {
  private readonly logger = new Logger(ApiGatewayController.name);
  private authClient: ClientProxy;
  private userClient: ClientProxy;
  private walletClient: ClientProxy;
  private auditClient: ClientProxy;
  private notificationClient: ClientProxy;
  private settingsClient: ClientProxy;

  constructor() {
    const rmqUrl =
      process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    const authQueue = process.env.AUTH_QUEUE || 'auth_queue';
    const userQueue = process.env.USER_QUEUE || 'user_queue';
    const walletQueue = process.env.WALLET_QUEUE || 'wallet_queue';
    const auditQueue = process.env.AUDIT_QUEUE || 'audit_queue';
    const notificationQueue =
      process.env.NOTIFICATION_QUEUE || 'notification_queue';

    this.logger.log(`Connecting to RabbitMQ at ${rmqUrl}`);
    this.logger.log(
      `Auth queue: ${authQueue}, User queue: ${userQueue}, Wallet queue: ${walletQueue}, Audit queue: ${auditQueue}, Notification queue: ${notificationQueue}`,
    );

    this.authClient = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: authQueue,
        queueOptions: { durable: false },
        persistent: true,
        noAck: true,
      },
    });

    this.userClient = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: userQueue,
        queueOptions: { durable: false },
        persistent: true,
        noAck: true,
      },
    });

    this.walletClient = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: walletQueue,
        queueOptions: { durable: false },
        persistent: true,
        noAck: true,
      },
    });

    this.auditClient = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: auditQueue,
        queueOptions: { durable: false },
        persistent: true,
        noAck: true,
      },
    });

    this.notificationClient = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: notificationQueue,
        queueOptions: { durable: false },
        persistent: true,
        noAck: true,
      },
    });

    this.settingsClient = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
        queue: 'settings_queue',
        queueOptions: { durable: false },
        persistent: true,
        noAck: true,
      },
    });
  }
  //=====================SETTINGS=============================
  private async sendSettingsMessage<T>(
    pattern: string,
    data: any,
    defaultMessage: string,
    defaultStatus: number,
    timeoutMs: number = 120000,
  ): Promise<T> {
    this.logger.debug(`Settings RPC → ${pattern}`, data);

    try {
      const result = await firstValueFrom(
        this.settingsClient.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((error) => {
            this.handleRpcError(error, defaultMessage, defaultStatus);
          }),
        ),
      );

      return result as T;
    } catch (error) {
      this.logger.error(`Settings error ${pattern}`, error);
      throw error;
    }
  }
  // ==================== MÉTHODES D'ENVOI ====================
  // apps/api-gateway/src/api-gateway.controller.ts

  private async sendAuthMessage<T>(
    pattern: string,
    data: any,
    defaultMessage: string,
    defaultStatus: number,
    timeoutMs: number = 120000,
  ): Promise<T> {
    this.logger.debug(`Sending auth message to ${pattern}:`, data);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await firstValueFrom(
        this.authClient.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((error: any) => {
            this.logger.error(`Error in ${pattern}:`, error);

            // ✅ Extraire correctement le message d'erreur du microservice
            let errorMessage = defaultMessage;
            let errorStatus = defaultStatus;

            // Vérifier si l'erreur contient la réponse du microservice
            if (error && error.response) {
              // Si error.response est un objet avec message et status
              if (typeof error.response === 'object') {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                errorMessage =
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  error.response.message ||
                  error.response.error ||
                  defaultMessage;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                errorStatus =
                  error.response.statusCode ||
                  error.response.status ||
                  defaultStatus;
              }
              // Si error.response est une string (comme 'Nenosiri si sahihi')
              else if (typeof error.response === 'string') {
                errorMessage = error.response;
                errorStatus = error.status || defaultStatus;
              }
            }
            // Si l'erreur a directement les propriétés
            else if (error.message) {
              errorMessage = error.message;
              errorStatus = error.statusCode || error.status || defaultStatus;
            }

            this.logger.error(
              `Transformed error: ${errorMessage} (${errorStatus})`,
            );

            throw new HttpException(
              {
                status: 'error',
                message: errorMessage,
                statusCode: errorStatus,
              },
              errorStatus,
            );
          }),
        ),
      );
      this.logger.debug(`Auth message ${pattern} processed successfully`);
      return result as T;
    } catch (error) {
      this.logger.error(`Failed to send auth message ${pattern}:`, error);
      throw error;
    }
  }

  private async sendUserMessage<T>(
    pattern: string,
    data: any,
    defaultMessage: string,
    defaultStatus: number,
    timeoutMs: number = 120000,
  ): Promise<T> {
    // Recréer le client si nécessaire
    if (!this.userClient) {
      this.logger.warn('User client not initialized, creating new client...');
      this.userClient = ClientProxyFactory.create({
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
          ],
          queue: process.env.USER_QUEUE || 'user_queue',
          queueOptions: { durable: false },
          persistent: true,
          noAck: true,
        },
      });
    }

    // Tenter de se connecter avec timeout (Promise.race)
    try {
      await Promise.race([
        this.userClient.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 5000),
        ),
      ]);
    } catch (err) {
      this.logger.error('Failed to connect to RabbitMQ for user client', err);
      throw new HttpException(
        'Microservice connection error',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.logger.debug(`Sending user message to ${pattern}:`, data);
    const result = await firstValueFrom(
      this.userClient.send(pattern, data).pipe(
        timeout(timeoutMs),
        catchError((error) => {
          this.handleRpcError(error, defaultMessage, defaultStatus);
        }),
      ),
    );
    return result as T;
  }

  private async sendWalletMessage<T>(
    pattern: string,
    data: any,
    defaultMessage: string,
    defaultStatus: number,
    timeoutMs: number = 120000,
  ): Promise<T> {
    this.logger.debug(`Wallet RPC → ${pattern}`, data);

    try {
      const result = await firstValueFrom(
        this.walletClient.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((error) => {
            this.handleRpcError(error, defaultMessage, defaultStatus);
          }),
        ),
      );

      return result as T;
    } catch (error) {
      this.logger.error(`Wallet error ${pattern}`, error);
      throw error;
    }
  }

  private async sendAuditMessage<T>(
    pattern: string,
    data: any,
    defaultMessage: string,
    defaultStatus: number,
    timeoutMs: number = 120000,
  ): Promise<T> {
    this.logger.debug(`Audit RPC → ${pattern}`, data);

    try {
      const result = await firstValueFrom(
        this.auditClient.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((error) => {
            this.handleRpcError(error, defaultMessage, defaultStatus);
          }),
        ),
      );

      return result as T;
    } catch (error) {
      this.logger.error(`Audit error ${pattern}`, error);
      throw error;
    }
  }

  private async sendNotificationMessage<T>(
    pattern: string,
    data: any,
    defaultMessage: string,
    defaultStatus: number,
    timeoutMs: number = 120000,
  ): Promise<T> {
    this.logger.debug(`Notification RPC → ${pattern}`, data);

    try {
      const result = await firstValueFrom(
        this.notificationClient.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((error) => {
            this.handleRpcError(error, defaultMessage, defaultStatus);
          }),
        ),
      );

      return result as T;
    } catch (error) {
      this.logger.error(`Notification error ${pattern}`, error);
      throw error;
    }
  }

  // ==================== AUTH ENDPOINTS ====================

  @Post('auth/register')
  async register(
    @Body() body: RegisterRequestDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('lang') langHeader?: string,
  ) {
    const deviceInfo = body.deviceInfo || userAgent || 'Appareil inconnu';
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    this.logger.log(`📝 Register request for ${body.phone} (lang: ${lang})`);
    return this.sendAuthMessage<AuthResponseDto>(
      'register_user',
      {
        account_number: body.account_number,
        full_name: body.full_name,
        phone: body.phone,
        branch: body.branch,
        fcmToken: body.fcmToken,
        platform: body.platform,
        deviceInfo,
        ipAddress,
        otpCode: body.otpCode,
        email: body.email,
        lang,
      },
      'Registration failed',
      HttpStatus.BAD_REQUEST,
      120000,
    );
  }

  @Post('admin/users/from-account')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async createUserFromAccount(
    @CurrentUser() currentUser: any,
    @Body()
    body: {
      account_number: string;
      full_name: string;
      phone: string;
      branch?: string;
      email?: string;
      role?: 'USER' | 'MERCHANT';
    },
    @Headers('lang') langHeader?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const { account_number, full_name, phone, branch, email, role } = body;
    if (!account_number || !full_name || !phone) {
      throw new HttpException(
        'account_number, full_name et phone sont requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    this.logger.log(
      `👤 Admin ${currentUser.id} creating user from account ${account_number} (lang: ${lang})`,
    );
    return this.sendUserMessage(
      'create_user_from_account',
      {
        account_number,
        full_name,
        phone,
        branch,
        email,
        role,
        lang,
      },
      'Échec de la création de l’utilisateur',
      HttpStatus.BAD_REQUEST,
      120000,
    );
  }

  @Post('auth/login')
  async login(
    @Body() body: LoginRequestDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('lang') langHeader?: string,
  ) {
    const identifier = body.identifier || body.email || body.phone;
    if (!identifier) {
      throw new HttpException('Identifiant requis', HttpStatus.BAD_REQUEST);
    }

    try {
      const deviceInfo = body.deviceInfo || userAgent || 'Appareil inconnu';
      const lang = langHeader || 'fr';

      // ✅ Appel direct sans passer par sendAuthMessage pour mieux contrôler l'erreur
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await firstValueFrom(
        this.authClient
          .send('login_user', {
            identifier,
            password: body.password,
            ipAddress,
            fcmToken: body.fcmToken,
            platform: body.platform,
            deviceInfo,
            lang,
          })
          .pipe(
            timeout(120000),
            catchError((error: any) => {
              this.logger.error(`Login error for ${identifier}:`, error);

              // Extraire le message d'erreur original
              let errorMessage = 'Login failed';
              let errorStatus = HttpStatus.UNAUTHORIZED;

              if (error && error.response) {
                if (typeof error.response === 'string') {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  errorMessage = error.response;
                  errorStatus = error.status || 401;
                } else if (error.response.message) {
                  errorMessage = error.response.message;
                  errorStatus =
                    error.response.statusCode || error.response.status || 401;
                }
              } else if (error.message) {
                errorMessage = error.message;
                errorStatus = error.statusCode || error.status || 401;
              }

              throw new HttpException(
                {
                  status: 'error',
                  message: errorMessage,
                  statusCode: errorStatus,
                },
                errorStatus,
              );
            }),
          ),
      );

      return result;
    } finally {
      // setTimeout(() => gatewayLoginLocks.delete(lockKey), 120000);
    }
  }

  @Post('auth/verify-otp')
  async verifyOtp(
    @Body() body: { identifier: string; code: string },
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string }> {
    this.logger.log('Verify OTP request:', body.identifier);
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    return this.sendAuthMessage<{ message: string }>(
      'verify_otp',
      { identifier: body.identifier, code: body.code, lang },
      'Vérification OTP échouée',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Post('auth/send-reset-otp')
  async sendResetOtp(
    @Body() body: { identifier: string },
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string }> {
    if (!body?.identifier) {
      throw new BadRequestException('Identifier requis');
    }
    const lang = langHeader || 'fr';
    return this.sendAuthMessage<{ message: string }>(
      'send_reset_otp',
      { identifier: body.identifier, lang },
      'Échec envoi OTP',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Post('auth/reset-password')
  async resetPassword(
    @Body()
    body: {
      identifier: string;
      code: string;
      password?: string;
      newPassword?: string;
    },
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string }> {
    const password = body.password || body.newPassword;
    if (!password) {
      throw new HttpException(
        'Le nouveau mot de passe est requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const lang = langHeader || 'fr';
    return this.sendAuthMessage<{ message: string }>(
      'reset_password',
      {
        identifier: body.identifier,
        code: body.code,
        password,
        lang,
      },
      'Échec réinitialisation mot de passe',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Post('auth/change-password')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async changePassword(
    @CurrentUser() currentUser: any,
    @Body() body: any,
    @Headers('authorization') authHeader: string,
    @Request() req: any,
    @Headers('lang') langHeader?: string,
  ) {
    this.logger.log('=== API GATEWAY - CHANGE PASSWORD ===');
    const currentPassword = body.currentPswd || body.currentPassword;
    const newPassword = body.newPswd || body.newPassword;
    if (!currentUser?.id) {
      throw new HttpException(
        'Utilisateur non authentifié',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!currentPassword || currentPassword.trim() === '') {
      throw new HttpException(
        'Le mot de passe actuel est requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!newPassword || newPassword.trim() === '') {
      throw new HttpException(
        'Le nouveau mot de passe est requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (currentPassword === newPassword) {
      throw new HttpException(
        "Le nouveau mot de passe doit être différent de l'ancien",
        HttpStatus.BAD_REQUEST,
      );
    }
    const token = authHeader?.split(' ')[1];
    if (!token) {
      throw new HttpException('Token manquant', HttpStatus.UNAUTHORIZED);
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const messageData = {
      userId: currentUser.id,
      currentPassword,
      newPassword,
      token,
      lang,
    };
    const result = await this.sendAuthMessage<{ message: string; data: any }>(
      'change_password',
      messageData,
      'Échec mise à jour mot de passe',
      HttpStatus.BAD_REQUEST,
    );
    return {
      data: result.data,
      message: result.message,
    };
  }

  // apps/api-gateway/src/api-gateway.controller.ts

  @Get('auth/account/:accountNumber')
  async getAccount(
    @Param('accountNumber') accountNumber: string,
    @Headers('lang') langHeader?: string,
  ): Promise<AccountResponse> {
    this.logger.log(`📞 Get account request: ${accountNumber}`);
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    try {
      const account = await firstValueFrom<AccountData>(
        this.authClient
          .send('get_account_by_number', { accountNumber, lang })
          .pipe(
            timeout(120000),
            catchError((error: RpcError) => {
              this.logger.error('Get account error caught:', error);
              throw new HttpException(
                error.message || 'Failed to get account',
                error.statusCode || HttpStatus.NOT_FOUND,
              );
            }),
          ),
      );
      return { success: true, data: account };
    } catch (error) {
      this.logger.error('Get account error:', error);
      throw error;
    }
  }

  // ==================== USER ENDPOINTS ====================
  @Post('users')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async createUser(
    @CurrentUser() currentUser: any,
    @Body() createUserDto: CreateUserDto,
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log('📝 Create user request:', createUserDto.email);
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException(
        'Seul un administrateur peut créer des utilisateurs',
        HttpStatus.FORBIDDEN,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const payload = { ...createUserDto, lang };
    return this.sendUserMessage<{ message: string; data: UserResponseDto }>(
      'create_user',
      payload,
      'Failed to create user',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('users/:id')
  async getUser(
    @Param('id') id: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`👤 Get user request: ${id}`);
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>('get_user', { id }, 'User not found', HttpStatus.NOT_FOUND);
    return response;
  }

  @Get('admin/users/links')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async listUsersLinks(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const response = await this.sendUserMessage<{
      users: UserResponseDto[];
      total: number;
      page: number;
      limit: number;
    }>(
      'list_users_links',
      { page: pageNum, limit: limitNum, role, status },
      'Échec de la récupération des utilisateurs',
      HttpStatus.BAD_REQUEST,
    );
    return {
      message: 'Utilisateurs avec compte bancaire récupérés avec succès',
      data: {
        data: response.users,
        total: response.total,
        page: response.page,
        limit: response.limit,
      },
    };
  }

  @Get('users/email/:email')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getUserByEmail(
    @CurrentUser() currentUser: any,
    @Param('email') email: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`👤 Get user by email: ${email}`);
    if (
      currentUser?.role !== 'ADMIN' &&
      currentUser?.role !== 'SUPER_ADMIN' &&
      currentUser?.email !== email
    ) {
      throw new HttpException(
        'Accès non autorisé à cet utilisateur',
        HttpStatus.FORBIDDEN,
      );
    }
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>('get_user_by_email', { email }, 'User not found', HttpStatus.NOT_FOUND);
    return response;
  }

  @Get('users/phone/:phone')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getUserByPhone(
    @CurrentUser() currentUser: any,
    @Param('phone') phone: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`👤 Get user by phone: ${phone}`);
    if (
      currentUser?.role !== 'ADMIN' &&
      currentUser?.role !== 'SUPER_ADMIN' &&
      currentUser?.phone !== phone
    ) {
      throw new HttpException(
        'Accès non autorisé à cet utilisateur',
        HttpStatus.FORBIDDEN,
      );
    }
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>('get_user_by_phone', { phone }, 'User not found', HttpStatus.NOT_FOUND);
    return response;
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateUser(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`✏️ Update user request: ${id}`);
    if (
      currentUser?.role !== 'ADMIN' &&
      currentUser?.role !== 'SUPER_ADMIN' &&
      currentUser?.id !== id
    ) {
      throw new HttpException(
        'Accès non autorisé à modifier cet utilisateur',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      updateUserDto.role &&
      currentUser?.role !== 'ADMIN' &&
      currentUser?.role !== 'SUPER_ADMIN'
    ) {
      delete updateUserDto.role;
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>(
      'update_user',
      { id, ...updateUserDto, lang },
      'Failed to update user',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Patch('users/:id/status')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateUserStatus(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
    @Body() body: { status: string },
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`🔄 Update user status: ${id} -> ${body.status}`);
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException(
        'Seul un administrateur peut modifier le statut',
        HttpStatus.FORBIDDEN,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>(
      'update_user_status',
      { id, status: body.status, requesterId: currentUser?.id, lang },
      'Failed to update user status',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Delete('users/:id')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async deleteUser(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
    @Headers('lang') langHeader?: string,
  ): Promise<{ message: string }> {
    this.logger.log(`🗑️ Delete user request: ${id}`);
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException(
        'Seul un administrateur peut supprimer des utilisateurs',
        HttpStatus.FORBIDDEN,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendUserMessage<any>(
      'delete_user',
      { id, lang },
      'Failed to delete user',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Get('users/me/profile')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getMyProfile(
    @CurrentUser() currentUser: any,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`👤 Get my profile: ${currentUser?.id}`);
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>(
      'get_user',
      { id: currentUser.id },
      'User not found',
      HttpStatus.NOT_FOUND,
    );
    return response;
  }

  @Patch('users/me/profile')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateMyProfile(
    @CurrentUser() currentUser: any,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    this.logger.log(`✏️ Update my profile: ${currentUser?.id}`);
    delete updateUserDto.role;
    delete updateUserDto.status;
    delete updateUserDto.account_number;
    const response = await this.sendUserMessage<{
      message: string;
      data: UserResponseDto;
    }>(
      'update_user',
      { id: currentUser.id, ...updateUserDto },
      'Failed to update profile',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async listUsers(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
  ): Promise<{
    message: string;
    data: {
      data: UserResponseDto[];
      total: number;
      page: number;
      limit: number;
    };
  }> {
    this.logger.log('📋 List users request');
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException(
        'Accès non autorisé. Seul un administrateur peut lister les utilisateurs.',
        HttpStatus.FORBIDDEN,
      );
    }
    const params = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
      role,
      status,
    };
    const response = await this.sendUserMessage<{
      users: UserResponseDto[];
      total: number;
      page: number;
      limit: number;
    }>('list_users', params, 'Failed to list users', HttpStatus.BAD_REQUEST);
    return {
      message: 'Users retrieved successfully',
      data: {
        data: response.users,
        total: response.total,
        page: response.page,
        limit: response.limit,
      },
    };
  }

  // ==================== WALLET ENDPOINTS ====================

  @Post('wallet')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async createWallet(
    @CurrentUser() currentUser: any,
    @Body() body: { currency?: string },
  ) {
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'create_wallet',
      { userId: currentUser.id, currency: body.currency || 'CDF' },
      'Failed to create wallet',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Get('wallet/me')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getMyWallet(@CurrentUser() currentUser: any) {
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'get_wallet',
      { userId: currentUser.id },
      'Failed to get wallet',
      HttpStatus.NOT_FOUND,
    );
    return response;
  }

  @Get('wallet/by/userid')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getWalletByUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'get_wallet_by_user',
      { userId },
      'Failed to get wallet',
      HttpStatus.NOT_FOUND,
    );
    return response;
  }

  @Post('wallet/credit')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async creditWallet(
    @CurrentUser() currentUser: any,
    @Body() body: { amount: number; description?: string },
  ) {
    if (!body.amount || body.amount <= 0) {
      throw new HttpException('Montant invalide', HttpStatus.BAD_REQUEST);
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'credit_wallet',
      {
        userId: currentUser.id,
        amount: body.amount,
        description: body.description,
      },
      'Failed to credit wallet',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('wallet/debit')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async debitWallet(
    @CurrentUser() currentUser: any,
    @Body() body: { amount: number; description?: string },
  ) {
    if (!body.amount || body.amount <= 0) {
      throw new HttpException('Montant invalide', HttpStatus.BAD_REQUEST);
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'debit_wallet',
      {
        userId: currentUser.id,
        amount: body.amount,
        description: body.description,
      },
      'Failed to debit wallet',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('wallet/transfer')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async transfer(
    @CurrentUser() currentUser: any,
    @Body() body: { toUserId: string; amount: number; description?: string },
  ) {
    if (!body.toUserId || !body.amount || body.amount <= 0) {
      throw new HttpException(
        'Destinataire ou montant invalide',
        HttpStatus.BAD_REQUEST,
      );
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'transfer',
      {
        fromUserId: currentUser.id,
        toUserId: body.toUserId,
        amount: body.amount,
        description: body.description,
      },
      'Failed to transfer',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }
  @Get('wallet/transactions')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getTransactions(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string, // nouveau
    @Query('endDate') endDate?: string, // nouveau
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    // Conversion optionnelle des chaînes en objets Date (ou conserver en string)
    let start: Date | undefined;
    let end: Date | undefined;
    if (startDate) start = new Date(startDate);
    if (endDate) end = new Date(endDate);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const response = await this.sendWalletMessage<any>(
      'list_transactions',
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        userId: currentUser.id,
        page: pageNum,
        limit: limitNum,
        startDate: start, // ajout
        endDate: end, // ajout
      },
      'Failed to get transactions',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Get('wallet/transactions/by')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getTransactionsByUser(
    @Query('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    let start: Date | undefined;
    let end: Date | undefined;
    if (startDate) start = new Date(startDate);
    if (endDate) end = new Date(endDate);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const response = await this.sendWalletMessage<any>(
      'list_transactions',
      {
        userId,
        page: pageNum,
        limit: limitNum,
        startDate: start,
        endDate: end,
      },
      'Failed to get transactions',
      HttpStatus.BAD_REQUEST,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return response;
  }

  @Get('admin/transactions')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAllTransactions(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const response = await this.sendWalletMessage<any>(
      'list_all_transactions',
      {
        page: pageNum,
        limit: limitNum,
        userId,
        type,
        status,
        startDate,
        endDate,
        search,
      },
      'Échec de la récupération des transactions',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Get('admin/transactions/all')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAllTransactionsUnpaginated(
    @CurrentUser() currentUser: any,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    let start: Date | undefined;
    let end: Date | undefined;
    if (startDate) start = new Date(startDate);
    if (endDate) end = new Date(endDate);
    return this.sendWalletMessage(
      'list_all_transactions_unpaginated',
      { userId, type, status, startDate: start, endDate: end, search },
      'Failed to retrieve transactions',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('admin/all_transactions')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAllTrans(
    @CurrentUser() currentUser: any,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const response = await this.sendWalletMessage<any>(
      'list_all_trans',
      { userId, type, status, startDate, endDate, search },
      'Échec de la récupération des transactions',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('wallet/topup')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async topUp(
    @CurrentUser() currentUser: any,
    @Body() body: { amount: number; pin: string },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (!body.amount || body.amount <= 0) {
      throw new HttpException('Montant valide requis', HttpStatus.BAD_REQUEST);
    }
    if (!body.pin || body.pin.length < 4) {
      throw new HttpException(
        'PIN requis (4 chiffres minimum)',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'top_up',
      {
        userId: currentUser.id,
        amount: body.amount,
        pin: body.pin,
        lang,
        ipAddress,
      },
      "Échec de l'alimentation",
      HttpStatus.BAD_REQUEST,
      120000,
    );
    return response;
  }

  @Post('wallet/cashout')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async cashout(
    @CurrentUser() currentUser: any,
    @Body() body: { accountNumber: string; amount: number; pin: string },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (!body.accountNumber) {
      throw new HttpException(
        'Le numéro de compte cible est requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.amount || body.amount <= 0) {
      throw new HttpException('Montant valide requis', HttpStatus.BAD_REQUEST);
    }
    if (!body.pin || body.pin.length < 4) {
      throw new HttpException(
        'Le PIN doit comporter au moins 4 chiffres',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^\d+$/.test(body.pin)) {
      throw new HttpException(
        'Le PIN doit contenir uniquement des chiffres',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'cashout',
      {
        userId: currentUser.id,
        accountNumber: body.accountNumber,
        amount: body.amount,
        pin: body.pin,
        lang,
        ipAddress,
      },
      'Échec du retrait',
      HttpStatus.BAD_REQUEST,
      120000,
    );
    return response;
  }

  @Post('wallet/send')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async send(
    @CurrentUser() currentUser: any,
    @Body()
    body: {
      toPhone: string;
      amount: number;
      pin: string;
      description?: string;
    },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (
      !currentUser?.account_number ||
      !body.toPhone ||
      !body.amount ||
      body.amount <= 0
    ) {
      throw new HttpException('Données invalides', HttpStatus.BAD_REQUEST);
    }
    if (!body.pin || body.pin.length < 4 || !/^\d+$/.test(body.pin)) {
      throw new HttpException(
        'PIN invalide (4 chiffres minimum)',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'send',
      {
        fromAccountNumber: currentUser.account_number,
        toPhone: body.toPhone,
        amount: body.amount,
        pin: body.pin,
        description: body.description,
        lang,
        ipAddress,
      },
      'Échec du transfert',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('wallet/pay')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async pay(
    @CurrentUser() currentUser: any,
    @Body()
    body: {
      toPhone?: string;
      merchantCode?: string;
      amount: number;
      pin: string;
      description?: string;
    },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    console.log('=== pay endpoint ===');
    console.log('currentUser:', JSON.stringify(currentUser, null, 2));
    console.log('body:', JSON.stringify(body, null, 2));
    if (!body.toPhone && !body.merchantCode) {
      throw new HttpException(
        'Veuillez fournir un numéro de téléphone ou un code marchand',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.amount || body.amount <= 0) {
      throw new HttpException('Montant invalide', HttpStatus.BAD_REQUEST);
    }
    if (!body.pin || body.pin.length < 4 || !/^\d+$/.test(body.pin)) {
      throw new HttpException(
        'PIN invalide (4 chiffres minimum)',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'pay',
      {
        fromAccountNumber: currentUser.account_number,
        toPhone: body.toPhone,
        merchantCode: body.merchantCode,
        amount: body.amount,
        pin: body.pin,
        description: body.description,
        lang,
        ipAddress,
      },
      'Échec du paiement',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  // ==================== PIN ENDPOINTS ====================

  @Post('users/me/pin')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async changeMyPin(
    @CurrentUser() currentUser: any,
    @Body() body: { pin: string },
    @Request() req: any,
    @Headers('lang') langHeader?: string,
  ) {
    this.logger.log(`🔐 Change PIN for user: ${currentUser?.id}`);
    const { pin } = body;
    if (!pin) {
      throw new HttpException(
        'Le PIN est requis dans le corps de la requête',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (pin.length < 4) {
      throw new HttpException(
        'Le PIN doit comporter au moins 4 caractères',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^\d+$/.test(pin)) {
      throw new HttpException(
        'Le PIN doit contenir uniquement des chiffres',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const result = await this.sendUserMessage<{ message: string; data: any }>(
      'change_pin',
      { id: currentUser.id, pin, lang },
      'Failed to change PIN',
      HttpStatus.BAD_REQUEST,
    );
    return {
      data: result.data,
      message: result.message,
    };
  }

  @Post('users/update/pin')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updatePin(
    @CurrentUser() currentUser: any,
    @Body() body: { oldPin: string; newPin: string },
    @Request() req: any,
    @Headers('lang') langHeader?: string,
  ) {
    this.logger.log(`🔐 Update PIN for user: ${currentUser?.id}`);
    const { oldPin, newPin } = body;
    if (!oldPin || oldPin.length < 4) {
      throw new HttpException(
        "L'ancien PIN doit comporter au moins 4 caractères",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^\d+$/.test(oldPin)) {
      throw new HttpException(
        "L'ancien PIN doit contenir uniquement des chiffres",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!newPin || newPin.length < 4) {
      throw new HttpException(
        'Le nouveau PIN doit comporter au moins 4 caractères',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^\d+$/.test(newPin)) {
      throw new HttpException(
        'Le nouveau PIN doit contenir uniquement des chiffres',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const result = await this.sendUserMessage<{ message: string; data: any }>(
      'update_pin',
      { id: currentUser.id, oldPin, newPin, lang },
      'Failed to update PIN',
      HttpStatus.BAD_REQUEST,
    );
    return {
      data: result.data,
      message: result.message,
    };
  }

  // ==================== AUDIT ENDPOINTS ====================

  @Get('admin/audit-logs')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAuditLogs(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const currentPage = page ? parseInt(page, 10) : 1;
    const currentLimit = limit ? parseInt(limit, 10) : 10;
    const payload: any = { page: currentPage, limit: currentLimit };
    if (userId) payload.userId = userId;
    if (action) payload.action = action;
    if (startDate) payload.startDate = new Date(startDate);
    if (endDate) payload.endDate = new Date(endDate);
    const auditResponse = await this.sendAuditMessage<{
      message: string;
      data: {
        data: any[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
      };
    }>(
      'get_audit_logs',
      payload,
      'Failed to retrieve audit logs',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return {
      message: auditResponse.message,
      data: {
        data: auditResponse.data.data,
        total: auditResponse.data.total,
        page: auditResponse.data.page,
        limit: auditResponse.data.limit,
        totalPages: auditResponse.data.totalPages,
        hasNextPage: auditResponse.data.hasNextPage,
        hasPrevPage: auditResponse.data.hasPrevPage,
      },
    };
  }

  @Get('admin/audit-logs/:id')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAuditLogById(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!id) {
      throw new HttpException('ID du log requis', HttpStatus.BAD_REQUEST);
    }
    const result = await this.sendAuditMessage<any>(
      'get_audit_log_by_id',
      { id },
      'Failed to retrieve audit log',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    // result est le log retourné par le microservice
    return {
      message: 'Audit log retrieved successfully',
      data: result,
    };
  }

  @Patch('admin/audit-logs/:id')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async deleteAuditLogById(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!id) {
      throw new HttpException('ID du log requis', HttpStatus.BAD_REQUEST);
    }
    const result = await this.sendAuditMessage<{ message: string }>(
      'delete_audit_log_by_id',
      { id },
      'Failed to delete audit log',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return result; // déjà { message: '...' }
  }
  //=======================================================
  //Sesssion
  @Get('admin/sessions')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async listAllSessions(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const result = await this.sendAuthMessage<{
      message: string;
      data: any[];
      total: number;
      page: number;
      limit: number;
    }>(
      'list_all_sessions',
      { page: pageNum, limit: limitNum },
      'Échec récupération sessions',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return {
      message: result.message,
      data: {
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    };
  }

  @Get('users/me/sessions')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getMySessions(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const result = await this.sendAuthMessage<{
      message: string;
      data: any[];
      total: number;
      page: number;
      limit: number;
    }>(
      'list_user_sessions',
      { userId: currentUser.id, page: pageNum, limit: limitNum },
      'Échec de récupération des sessions',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return {
      message: result.message,
      data: {
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    };
  }
  @Get('bank/link/:accountNumber')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async linkBankAccount(
    @CurrentUser() currentUser: any,
    @Param('accountNumber') accountNumber: string,
  ) {
    this.logger.log(
      `🔗 Link bank account: ${accountNumber} for user ${currentUser.id}`,
    );

    const response = await this.sendWalletMessage<any>(
      'link_account',
      { accountNumber },
      'Échec du lien bancaire',
      HttpStatus.BAD_REQUEST,
      12000,
    );

    return response; // retourne la réponse brute (déjà sous la forme { accountNumber, balance, phone, ... })
  }

  @Post('topup/brute')
  // eslint-disable-next-line @typescript-eslint/require-await
  async topups(
    @Body() data: { accountNumber: string; amount: number; requestId?: string },
  ) {
    return this.walletClient.send('topup', data);
  }

  @Post('cashout/brute')
  // eslint-disable-next-line @typescript-eslint/require-await
  async cashouts(
    @Body() data: { accountNumber: string; amount: number; pin: string },
  ) {
    return this.walletClient.send('cashouts', data);
  }

  @Get('admin/sessions/:sessionId')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getSessionById(
    @CurrentUser() currentUser: any,
    @Param('sessionId') sessionId: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!sessionId) {
      throw new HttpException('ID de session requis', HttpStatus.BAD_REQUEST);
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendAuthMessage<{ message: string; data: any }>(
      'get_session_by_id',
      { sessionId, lang },
      'Échec de récupération de la session',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return response;
  }
  //===============================================================
  @Post('users/me/verify-pin')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async verifyMyPin(
    @CurrentUser() currentUser: any,
    @Body() body: { pin: string },
    @Headers('lang') langHeader?: string,
  ) {
    const { pin } = body;
    if (!pin) {
      throw new HttpException('Le PIN est requis', HttpStatus.BAD_REQUEST);
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';

    // Désormais, si le PIN est incorrect, sendUserMessage lèvera une HttpException
    // (401, 400 ou 404) et le bloc suivant ne sera atteint qu'en cas de succès.
    const response = await this.sendUserMessage<{
      valid: boolean;
      message: string;
    }>(
      'verify_pin',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      { userId: currentUser.id, pin, lang },
      'Erreur de vérification du PIN',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    // Succès : response.valid est true, on retourne le message
    return { message: response.message };
  }

  @Post('users/me/device-token')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async registerDeviceToken(
    @CurrentUser() currentUser: any,
    @Body() body: { fcmToken: string },
  ) {
    const { fcmToken } = body;
    if (!fcmToken) {
      throw new HttpException(
        'Le token FCM est requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.sendAuthMessage<{ message: string }>(
      'register_device_token',
      { userId: currentUser.id, fcmToken },
      'Échec de l’enregistrement du token',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Post('auth/logout')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async logout(
    @CurrentUser() currentUser: any,
    @Body() body: { sessionId: string },
    @Headers('lang') langHeader?: string,
  ) {
    const { sessionId } = body;
    if (!sessionId) {
      throw new HttpException('sessionId requis', HttpStatus.BAD_REQUEST);
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    return this.sendAuthMessage<{ message: string }>(
      'revoke_session_by_id',
      { userId: currentUser.id, sessionId, lang }, // ← lang inclus
      'Échec de la déconnexion',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  //============================User_settingd==================================
  @Get('users/me/settings')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getMySettings(@CurrentUser() currentUser: any) {
    return this.sendUserMessage(
      'get_user_settings',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      { userId: currentUser.id },
      'Failed to retrieve settings',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Patch('users/me/settings')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateMySettings(
    @CurrentUser() currentUser: any,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return this.sendUserMessage(
      'update_user_settings',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      { userId: currentUser.id, settings: dto },
      'Failed to update settings',
      HttpStatus.BAD_REQUEST,
    );
  }
  // ==================== NOTIFICATIONS ENDPOINTS ====================

  @Get('users/me/notifications')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getMyNotifications(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const result = await this.sendNotificationMessage<{
      message: string;
      data: any[];
      total: number;
      page: number;
      limit: number;
    }>(
      'list_user_notifications',
      { userId: currentUser.id, page: pageNum, limit: limitNum },
      'Échec de récupération des notifications',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return {
      message: result.message,
      data: {
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    };
  }

  @Get('wallet/phone/:phone')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getWalletByPhone(
    @CurrentUser() currentUser: any,
    @Param('phone') phone: string,
  ) {
    if (!phone) {
      throw new HttpException(
        'Le numéro de téléphone est requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'get_wallet_by_phone',
      { phone },
      'Échec de la récupération du wallet',
      HttpStatus.NOT_FOUND,
    );
    return response;
  }

  @Get('merchant/:merchantCode')
  async getMerchantByCode(@Param('merchantCode') merchantCode: string) {
    if (!merchantCode) {
      throw new HttpException('Code marchand requis', HttpStatus.BAD_REQUEST);
    }
    return this.sendWalletMessage(
      'get_merchant_by_code',
      { merchantCode },
      'Échec de récupération du commerçant',
      HttpStatus.NOT_FOUND,
    );
  }

  @Get('wallet/transactions/:transactionId')
  async getTransactionById(@Param('transactionId') transactionId: string) {
    if (!transactionId) {
      throw new HttpException(
        'ID de transaction requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.sendWalletMessage(
      'get_transaction_by_id',
      { transactionId },
      'Échec de récupération de la transaction',
      HttpStatus.NOT_FOUND,
    );
  }

  @Post('admin/wallet/topup')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async adminTopUp(
    @CurrentUser() currentUser: any,
    @Body() body: { userId: string; amount: number },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!body.userId || !body.amount || body.amount <= 0) {
      throw new HttpException(
        'userId et montant valide requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'admin_top_up',
      { userId: body.userId, amount: body.amount, lang, ipAddress },
      "Échec de l'alimentation",
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('admin/wallet/cashout')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async adminCashout(
    @CurrentUser() currentUser: any,
    @Body() body: { userId: string; accountNumber: string; amount: number },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (
      !body.userId ||
      !body.accountNumber ||
      !body.amount ||
      body.amount <= 0
    ) {
      throw new HttpException(
        'userId, accountNumber et montant valide requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'admin_cashout',
      {
        userId: body.userId,
        accountNumber: body.accountNumber,
        amount: body.amount,
        lang,
        ipAddress,
      },
      'Échec du retrait',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('admin/wallet/send')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async adminSend(
    @CurrentUser() currentUser: any,
    @Body()
    body: {
      fromUserId: string;
      toPhone: string;
      amount: number;
      description?: string;
    },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!body.fromUserId || !body.toPhone || !body.amount || body.amount <= 0) {
      throw new HttpException(
        'fromUserId, toPhone et montant valide requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    // Récupérer l'account_number de l'utilisateur source
    const fromUser = await this.sendUserMessage<{
      data: { account_number: string };
    }>(
      'get_user',
      { id: body.fromUserId },
      'Utilisateur source introuvable',
      HttpStatus.NOT_FOUND,
    );
    if (!fromUser?.data?.account_number) {
      throw new HttpException(
        "L'utilisateur source n'a pas de numéro de compte",
        HttpStatus.BAD_REQUEST,
      );
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'admin_send',
      {
        fromAccountNumber: fromUser.data.account_number,
        toPhone: body.toPhone,
        amount: body.amount,
        description: body.description,
        lang,
        ipAddress,
      },
      'Échec du transfert',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }

  @Post('admin/wallet/pay')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async adminPay(
    @CurrentUser() currentUser: any,
    @Body()
    body: {
      fromUserId: string;
      toPhone?: string;
      merchantCode?: string;
      amount: number;
      description?: string;
    },
    @Ip() ipAddress: string,
    @Headers('lang') langHeader?: string,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!body.fromUserId || !body.amount || body.amount <= 0) {
      throw new HttpException(
        'fromUserId et montant valide requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.toPhone && !body.merchantCode) {
      throw new HttpException(
        'Veuillez fournir un numéro de téléphone ou un code marchand',
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';
    const fromUser = await this.sendUserMessage<{
      data: { account_number: string };
    }>(
      'get_user',
      { id: body.fromUserId },
      'Utilisateur source introuvable',
      HttpStatus.NOT_FOUND,
    );
    if (!fromUser?.data?.account_number) {
      throw new HttpException(
        "L'utilisateur source n'a pas de numéro de compte",
        HttpStatus.BAD_REQUEST,
      );
    }
    const response = await this.sendWalletMessage<{
      message: string;
      data: any;
    }>(
      'admin_pay',
      {
        fromAccountNumber: fromUser.data.account_number,
        toPhone: body.toPhone,
        merchantCode: body.merchantCode,
        amount: body.amount,
        description: body.description,
        lang,
        ipAddress,
      },
      'Échec du paiement',
      HttpStatus.BAD_REQUEST,
    );
    return response;
  }
  // ==================== SETTINGS ENDPOINTS ====================

  @Get('admin/settings/general')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getGeneralSettings(@CurrentUser() currentUser: any) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendSettingsMessage(
      'get_general_settings',
      {},
      'Failed to get settings',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('ping-settings')
  async pingSettings() {
    return this.sendSettingsMessage('ping', {}, 'ping failed', 5000);
  }

  @Patch('admin/settings/general')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateGeneralSettings(
    @Body() dto: any,
    @CurrentUser() currentUser: any,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendSettingsMessage(
      'update_general_settings',
      dto,
      'Failed to update settings',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('admin/settings/security')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getSecurityPolicies(@CurrentUser() currentUser: any) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendSettingsMessage(
      'get_security_policies',
      {},
      'Failed to get policies',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Patch('admin/settings/security')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateSecurityPolicies(
    @Body() dto: any,
    @CurrentUser() currentUser: any,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendSettingsMessage(
      'update_security_policies',
      dto,
      'Failed to update policies',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('admin/settings/limits/:userId')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getUserTransactionLimit(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: any,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendSettingsMessage(
      'get_user_transaction_limit',
      { userId },
      'Failed to get limits',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Patch('admin/settings/limits/:userId')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateUserTransactionLimit(
    @Param('userId') userId: string,
    @Body() dto: any,
    @CurrentUser() currentUser: any,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendSettingsMessage(
      'update_user_transaction_limit',
      { userId, dto },
      'Failed to update limits',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  // ==================== NOTIFICATIONS ENDPOINTS (suite) ====================

  @Patch('users/me/notifications/:id/read')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async markNotificationAsRead(
    @CurrentUser() currentUser: any,
    @Param('id') notificationId: string,
  ) {
    if (!notificationId) {
      throw new HttpException(
        'ID de notification requis',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.sendNotificationMessage<{
      message: string;
      data: any;
    }>(
      'mark_notification_seen',
      { notificationId, userId: currentUser.id },
      'Échec du marquage de la notification',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return result;
  }

  @Patch('users/me/notifications/read-all')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async markAllNotificationsAsRead(@CurrentUser() currentUser: any) {
    const result = await this.sendNotificationMessage<{
      message: string;
      count: number;
    }>(
      'mark_all_notifications_seen',
      { userId: currentUser.id },
      'Échec du marquage de toutes les notifications',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    return result;
  }
  // ==================== HEALTH ====================

  @Get('health')
  async healthCheck() {
    // Vérification basique sans RabbitMQ
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'API Gateway is running',
      services: {
        auth: true,
        user: true,
        wallet: true,
        audit: true,
        notification: true
      }
    };
  }

  //=====================================DASHBOARD===========================
  @Get('admin/dashboard')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAdminDashboard(
    @CurrentUser() currentUser: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'get_admin_dashboard',
      { startDate, endDate },
      'Failed to get dashboard',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private async checkServiceHealth(queue: string): Promise<boolean> {
    try {
      let client: ClientProxy;
      if (queue === 'auth_queue') client = this.authClient;
      else if (queue === 'user_queue') client = this.userClient;
      else if (queue === 'wallet_queue') client = this.walletClient;
      else if (queue === 'audit_queue') client = this.auditClient;
      else if (queue === 'notification_queue') client = this.notificationClient;
      else return false;
      await firstValueFrom(client.send('health_check', {}).pipe(timeout(5000)));
      return true;
    } catch (error) {
      return false;
    }
  }

  @Get('wallet/statement/download')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async downloadStatement(
    @CurrentUser() currentUser: any,
    @Res() res: Response, // ⬅️ déplacé ici (obligatoire)
    @Query('startDate') startDateStr?: string, // optionnel
    @Query('endDate') endDateStr?: string, // optionnel
    @Headers('lang') langHeader?: string, //
  ) {
    // Validation des dates si elles sont fournies
    let startDate: Date | undefined = undefined;
    let endDate: Date | undefined = undefined;

    if (startDateStr && startDateStr.trim() !== '') {
      startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        throw new HttpException('startDate invalide', HttpStatus.BAD_REQUEST);
      }
    }

    if (endDateStr && endDateStr.trim() !== '') {
      endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        throw new HttpException('endDate invalide', HttpStatus.BAD_REQUEST);
      }
    }

    // Gestion de la langue
    const allowedLangs = ['fr', 'en', 'sw'];
    const lang = allowedLangs.includes(langHeader || '') ? langHeader : 'fr';

    // Appel au microservice avec dates optionnelles
    const result = await this.sendWalletMessage<{
      pdfBase64: string;
      message: string;
    }>(
      'generate_statement_pdf',
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        userId: currentUser.id,
        startDate: startDateStr, // peut être undefined
        endDate: endDateStr, // peut être undefined
        lang,
      },
      'Erreur génération relevé',
      HttpStatus.INTERNAL_SERVER_ERROR,
      300000, // Timeout 5 minutes
    );

    const pdfBuffer = Buffer.from(result.pdfBase64, 'base64');

    // Construction du nom de fichier
    let filename = 'releve_compte.pdf';
    if (startDateStr && endDateStr) {
      filename = `releve_${startDateStr}_${endDateStr}.pdf`;
    } else if (startDateStr) {
      filename = `releve_depuis_${startDateStr}.pdf`;
    } else if (endDateStr) {
      filename = `releve_jusqu_au_${endDateStr}.pdf`;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }

  // ==================== RESOURCES MANAGEMENT ====================

  @Post('admin/resources')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async createResource(
    @CurrentUser() currentUser: any,
    @Body() dto: CreateResourceDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'create_resource',
      dto,
      'Échec de la création de la ressource',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Patch('admin/resources/:id')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async updateResource(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
    @Body() dto: UpdateResourceDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'update_resource',
      { id, ...dto },
      'Échec de la mise à jour de la ressource',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('admin/resources')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getAllResources(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.sendUserMessage(
      'get_all_resources',
      { page: pageNum, limit: limitNum },
      'Échec de la récupération des ressources',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('admin/resources/:id')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getOneResource(
    @CurrentUser() currentUser: any,
    @Param('id') id: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'get_one_resource',
      { id },
      'Ressource non trouvée',
      HttpStatus.NOT_FOUND,
    );
  }

  @Post('admin/users/assign-resource')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async assignMultipleResourcesToUser(
    @CurrentUser() currentUser: any,
    @Body() dto: AssignMultipleResourcesDto,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    if (!dto.grantedBy) dto.grantedBy = currentUser.id;
    return this.sendUserMessage(
      'assign_resource_to_user',
      dto,
      'Échec de l’attribution multiple',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('admin/users/:userId/resources')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getUserResources(
    @CurrentUser() currentUser: any,
    @Param('userId') userId: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'get_user_resources',
      { userId },
      'Échec de la récupération des ressources utilisateur',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Delete('admin/users/:userId/resources/:resourceId')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  @Permissions({ resource: 'resources', action: 'canDelete' })
  async revokeResource(
    @CurrentUser() currentUser: any,
    @Param('userId') userId: string,
    @Param('resourceId') resourceId: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'revoke_resource',
      { userId, resourceId },
      'Échec de la révocation de la ressource',
      HttpStatus.BAD_REQUEST,
    );
  }
  //========================SETTINGS==============================================
  @Post('admin/settings/app')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  @Permissions({ resource: 'settings', action: 'canCreate' })
  async upsertAppSettings(
    @CurrentUser() currentUser: any,
    @Body() dto: UpsertAppSettingsDto,
  ) {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Accès interdit', HttpStatus.FORBIDDEN);
    }
    return this.sendUserMessage(
      'upsert_app_settings',
      dto,
      'Échec de mise à jour',
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('admin/settings/app')
  async getAppSettings() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await firstValueFrom(
        this.userClient.send('get_app_settings', {}).pipe(timeout(10000)),
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return result;
    } catch (err) {
      this.logger.error(`RPC error: ${err.message}`);
      throw new HttpException(
        'Service error: ' + err.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('auth/login-attempts')
  @UseGuards(JwtAuthGuard, AuthentificationGuard)
  async getMyLoginAttempts(
    @CurrentUser() currentUser: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.sendAuthMessage(
      'get_login_attempts',
      { userId: currentUser.id, page: pageNum, limit: limitNum },
      'Failed to get login attempts',
      HttpStatus.BAD_REQUEST,
    );
  }

  private handleRpcError(
    error: any,
    defaultMessage: string,
    defaultStatus: number,
  ): never {
    this.logger.error('Raw RPC Error:', error);

    // 🔴 Timeout RxJS
    if (error?.name === 'TimeoutError') {
      throw new HttpException(
        {
          status: 'error',
          message: 'Le service est trop lent (timeout)',
          statusCode: HttpStatus.GATEWAY_TIMEOUT,
        },
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }

    let message = defaultMessage;
    let status = defaultStatus;

    // 🔥 CAS 1: RpcException bien formatée
    if (error?.response) {
      if (typeof error.response === 'object') {
        message =
          error.response.message || error.response.error || defaultMessage;

        status =
          error.response.statusCode || error.response.status || defaultStatus;
      } else if (typeof error.response === 'string') {
        message = error.response;
      }
    }

    // 🔥 CAS 2: erreur simple
    else if (error?.message) {
      message = error.message;
      status = error.statusCode || error.status || defaultStatus;
    }

    throw new HttpException(
      {
        status: 'error',
        message,
        statusCode: status,
      },
      status,
    );
  }
}
