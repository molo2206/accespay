// dto/register-user.dto.ts
import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumberString,
  Length,
} from 'class-validator';

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  account_number: string;

  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsNumberString()
  @Length(6, 6)
  otpCode?: string;

  @IsOptional()
  @IsString()
  @Length(6, 100)
  password?: string;

  // Champs supplémentaires de HEAD
  @IsOptional()
  fcmToken?: string;

  @IsOptional()
  platform?: string;

  @IsOptional()
  deviceInfo?: string;

  @IsOptional()
  merchantCode?: string;

  @IsOptional()
  email?: string;

  @IsOptional()
  lang?: string;
}