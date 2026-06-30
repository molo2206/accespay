<<<<<<< HEAD
export class TopUpDto {
  accountNumber: string;
  amount: number;
  lang?: string;
=======
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class TopUpDto {
  accountNumber: string;
  amount: number;
>>>>>>> 3fa25a6e03a0de933ee3a212c12b62454679cdd7
}

export class CashoutDto {
  accountNumber: string;
  amount: number;
<<<<<<< HEAD
  lang?: string;
}

export class SendDto {
  fromAccountNumber: string;
  toPhone: string;
  amount: number;
  pin: string;
  description?: string;
  lang?: string;
}

export class PayDto {
  fromAccountNumber: string;
  toPhone?: string;
  amount: number;
  pin: string;
  description?: string;
  merchantCode?: string;
  lang?: string;
=======
}

export class SendDto {
  @IsNotEmpty()
  @IsString()
  fromAccountNumber: string; // numéro de compte de l’expéditeur

  @IsNotEmpty()
  @IsString()
  toAccountNumber: string; // numéro de compte du destinataire

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
}

// apps/wallet-service/src/dto/wallet-operation.dto.ts
export class PayDto {
  @IsNotEmpty()
  @IsString()
  fromAccountNumber: string; // numéro de compte du payeur

  @IsNotEmpty()
  @IsString()
  merchantAccountNumber: string; // numéro de compte du commerçant

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
>>>>>>> 3fa25a6e03a0de933ee3a212c12b62454679cdd7
}
