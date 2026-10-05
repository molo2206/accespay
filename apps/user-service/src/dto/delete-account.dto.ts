import { IsString, MinLength, IsOptional } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  userId: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  lang?: string;
}