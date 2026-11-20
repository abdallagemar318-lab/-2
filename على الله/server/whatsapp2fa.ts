import type { DatabaseSync } from 'node:sqlite';
import type { OtpPolicySettings, WhatsAppIntegrationStatus } from '../src/shared/types.ts';
import { DEFAULT_OTP_POLICY } from '../src/shared/otpPolicy.ts';

export interface WhatsAppSendResult {
  sent: boolean;
  dryRun: boolean;
  providerMessageId: string | null;
  noticeAr: string;
}

export interface WhatsAppCloudProvider {
  readonly providerName: string;
  sendTemplateOtp(params: {
    phoneE164: string;
    otpCode: string;
    templateLanguage: string;
  }): Promise<WhatsAppSendResult>;
}

const REQUIRED_WHATSAPP_ENV_KEYS = [
  'WHATSAPP_CLOUD_API_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_OTP_TEMPLATE_NAME',
] as const;

export function getMissingWhatsAppEnvKeys(): string[] {
  return REQUIRED_WHATSAPP_ENV_KEYS.filter((key) => {
    const val = process.env[key];
    return !val || val.trim().length === 0;
  });
}

export function isWhatsAppCredentialsConfigured(): boolean {
  return getMissingWhatsAppEnvKeys().length === 0;
}

export function getOtpPolicySettings(db: DatabaseSync): OtpPolicySettings {
  const row = db
    .prepare(`
      SELECT
        whatsapp_2fa_enabled,
        otp_expiry_seconds,
        resend_cooldown_seconds,
        max_otp_attempts,
        rate_limit_window_seconds,
        max_login_attempts,
        lockout_seconds
      FROM auth_settings
      WHERE id = 1
    `)
    .get() as
    | {
        whatsapp_2fa_enabled: number;
        otp_expiry_seconds: number;
        resend_cooldown_seconds: number;
        max_otp_attempts: number;
        rate_limit_window_seconds: number;
        max_login_attempts: number;
        lockout_seconds: number;
      }
    | undefined;

  if (!row) {
    return { ...DEFAULT_OTP_POLICY };
  }

  return {
    whatsapp2faEnabled: Boolean(row.whatsapp_2fa_enabled),
    otpExpirySeconds: row.otp_expiry_seconds,
    resendCooldownSeconds: row.resend_cooldown_seconds,
    maxOtpAttempts: row.max_otp_attempts,
    rateLimitWindowSeconds: row.rate_limit_window_seconds,
    maxLoginAttempts: row.max_login_attempts,
    lockoutSeconds: row.lockout_seconds,
  };
}

export function getWhatsAppIntegrationStatus(
  db: DatabaseSync
): WhatsAppIntegrationStatus {
  const policy = getOtpPolicySettings(db);
  const missingEnvKeys = getMissingWhatsAppEnvKeys();
  const configured = missingEnvKeys.length === 0;

  const waRow = db
    .prepare(
      'SELECT provider_name, api_version, template_language, dry_run_mode FROM whatsapp_settings WHERE id = 1'
    )
    .get() as
    | {
        provider_name: string;
        api_version: string;
        template_language: string;
        dry_run_mode: number;
      }
    | undefined;

  const dryRunMode = waRow ? Boolean(waRow.dry_run_mode) : true;
  const effectiveEnabled = policy.whatsapp2faEnabled && configured && !dryRunMode;

  let noticeAr =
    'التحقق الثنائي عبر واتساب معطل افتراضياً. يتم تسجيل الدخول برقم الهاتف وكلمة المرور فقط.';
  if (!configured) {
    noticeAr =
      'تنبيه التهيئة: التحقق عبر واتساب معطل لعدم توفر بيانات اعتماد WhatsApp Business Cloud API في متغيرات البيئة على الخادم.';
  } else if (dryRunMode) {
    noticeAr =
      'بيانات الربط متوفرة، لكن التكامل في وضع الإيقاف/المعاينة الآمنة ولا يتم إرسال رسائل خارجية.';
  } else if (effectiveEnabled) {
    noticeAr = 'التحقق الثنائي عبر WhatsApp Business Cloud API مفعّل ونشط.';
  }

  return {
    enabled: effectiveEnabled,
    configured,
    dryRunMode,
    providerName: waRow?.provider_name || 'meta_cloud_api',
    apiVersion: waRow?.api_version || 'v21.0',
    templateLanguage: waRow?.template_language || 'ar',
    missingEnvKeys,
    noticeAr,
  };
}

/**
 * Modular Official Meta WhatsApp Business Cloud API Provider.
 * Strictly guards against any outbound HTTP requests unless explicitly enabled & configured.
 */
export class MetaWhatsAppCloudProvider implements WhatsAppCloudProvider {
  public readonly providerName = 'meta_cloud_api';
  private readonly apiVersion: string;

  constructor(apiVersion = 'v21.0') {
    this.apiVersion = apiVersion;
  }

  public async sendTemplateOtp(params: {
    phoneE164: string;
    otpCode: string;
    templateLanguage: string;
  }): Promise<WhatsAppSendResult> {
    const token = (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim();
    const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const templateName = (process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();

    if (!token || !phoneNumberId || !templateName) {
      return {
        sent: false,
        dryRun: true,
        providerMessageId: null,
        noticeAr:
          'لم يتم إرسال رسالة واتساب لعدم اكتمال بيانات WhatsApp Business Cloud API على الخادم.',
      };
    }

    const endpoint = `https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(
      phoneNumberId
    )}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.phoneE164,
      type: 'template',
      template: {
        name: templateName,
        language: { code: params.templateLanguage || 'ar' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: params.otpCode }],
          },
        ],
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        sent: false,
        dryRun: false,
        providerMessageId: null,
        noticeAr: `تعذر الإرسال عبر واجهة واتساب الرسمية (رمز الحالة ${response.status}).`,
      };
    }

    const body = (await response.json()) as { messages?: Array<{ id?: string }> };
    return {
      sent: true,
      dryRun: false,
      providerMessageId: body.messages?.[0]?.id ?? null,
      noticeAr: 'تم إرسال رمز التحقق بنجاح عبر WhatsApp Business Cloud API.',
    };
  }
}
