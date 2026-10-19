// apps/auth-service/src/sms/sms.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';

// Définir le type de réponse de l'API Dream Digital
interface DreamDigitalSmsResponse {
  status: string;                 // 'S' pour succès, 'E' pour erreur
  message_id?: string | number;   // ID du message (nombre dans la vraie réponse)
  remarks?: string;               // ex: "Message Submitted"
  phonenumber?: string;
  description?: string;           // Description de l'erreur (en cas d'échec)
}

@Injectable()
export class SmsService {
  private readonly apiId = 'API42928758643';
  private readonly apiPassword = '@@Accesfina!2026';
  private readonly sender = 'SMS-TEST'; // ✅ identique à l'URL qui fonctionne
  private readonly apiUrl = 'https://papi.dream-digital.info/api/SendSms'; // ✅ URL qui fonctionne

  async sendSms(phoneNumber: string, message: string): Promise<boolean> {
    try {
      // Normaliser le numéro - exactement comme dans l'URL qui fonctionne
      let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

      // S'assurer que le numéro commence par 243
      if (!cleanPhone.startsWith('243')) {
        if (cleanPhone.startsWith('0')) {
          cleanPhone = `243${cleanPhone.substring(1)}`;
        } else {
          cleanPhone = `243${cleanPhone}`;
        }
      }

      // S'assurer que le numéro fait exactement 12 chiffres
      if (cleanPhone.length !== 12) {
        console.error(
          `❌ Numéro invalide: ${cleanPhone} (doit faire 12 chiffres)`,
        );
        return false;
      }

      // Construire l'URL EXACTEMENT comme celle qui fonctionne
      // (encoding vide, sender_id = SMS-TEST, host = papi.dream-digital.info, path = SendSms)
      const url =
        `${this.apiUrl}?api_id=${this.apiId}` +
        `&api_password=${this.apiPassword}` +
        `&sms_type=T` +
        `&encoding=` +
        `&sender_id=${this.sender}` +
        `&phonenumber=${cleanPhone}` +
        `&textmessage=${encodeURIComponent(message)}`;

      console.log(
        '📤 Envoi SMS avec URL:',
        url.replace(this.apiPassword, '***'),
      );

      const response = await axios.get<DreamDigitalSmsResponse>(url, {
        timeout: 30000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      console.log('📥 Réponse API:', response.data);

      if (response.data && response.data.status === 'S') {
        console.log(
          `✅ SMS envoyé avec succès! ID: ${response.data.message_id || 'N/A'}`,
        );
        return true;
      } else {
        console.error('❌ Échec envoi SMS:', response.data);
        return false;
      }
    } catch (error: any) {
      console.error("❌ Erreur lors de l'envoi SMS:", error?.message);
      if (error?.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      }
      return false;
    }
  }

  async sendOtpSms(phoneNumber: string, otpCode: string): Promise<boolean> {
    const message = `Votre code de vérification AccesPay est : ${otpCode}. Valable 10 minutes.`;
    return this.sendSms(phoneNumber, message);
  }

  async sendWelcomeSms(
    phoneNumber: string,
    fullName: string,
    accountNumber: string,
  ): Promise<boolean> {
    const message = `Bienvenue sur AccesPay, ${fullName} ! Votre compte ${accountNumber} a été créé avec succès.`;
    return this.sendSms(phoneNumber, message);
  }
}