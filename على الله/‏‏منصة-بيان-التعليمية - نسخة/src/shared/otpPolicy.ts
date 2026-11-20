import type {
  OtpPolicySettings,
  PermissionRule,
  ResourceType,
  StudentAccessContext,
} from './types';

export const DEFAULT_OTP_POLICY: OtpPolicySettings = {
  whatsapp2faEnabled: false,
  otpExpirySeconds: 300,
  resendCooldownSeconds: 60,
  maxOtpAttempts: 5,
  rateLimitWindowSeconds: 900,
  maxLoginAttempts: 5,
  lockoutSeconds: 300,
};

/**
 * Normalizes phone numbers by stripping whitespace/dashes and converting Arabic-Indic digits.
 */
export function normalizePhoneNumber(raw: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const easternDigits = '۰۱۲۳۴۵۶۷۸۹';
  let normalized = '';
  for (const ch of raw.trim()) {
    const arIdx = arabicDigits.indexOf(ch);
    const eaIdx = easternDigits.indexOf(ch);
    if (arIdx !== -1) {
      normalized += String(arIdx);
    } else if (eaIdx !== -1) {
      normalized += String(eaIdx);
    } else if (/[\d+]/.test(ch)) {
      normalized += ch;
    }
  }
  return normalized;
}

export function isValidPhoneNumber(raw: string): boolean {
  const normalized = normalizePhoneNumber(raw);
  const digitsOnly = normalized.replace(/^\+/, '');
  return digitsOnly.length >= 8 && digitsOnly.length <= 15;
}

export function maskPhoneNumber(raw: string): string {
  const normalized = normalizePhoneNumber(raw);
  if (normalized.length <= 4) return '****';
  const visibleEnd = normalized.slice(-3);
  const visibleStart = normalized.slice(0, 2);
  return `${visibleStart}${'*'.repeat(Math.max(3, normalized.length - 5))}${visibleEnd}`;
}

export interface OtpChallengeState {
  expiresAtMs: number;
  resendAvailableAtMs: number;
  consumedAtMs: number | null;
  attempts: number;
  maxAttempts: number;
}

export interface OtpValidationDecision {
  allowed: boolean;
  reasonCode:
    | 'OK'
    | 'ALREADY_CONSUMED'
    | 'EXPIRED'
    | 'MAX_ATTEMPTS_EXCEEDED'
    | 'COOLDOWN_ACTIVE';
  messageAr: string;
}

export function evaluateOtpChallengeState(
  challenge: OtpChallengeState,
  nowMs: number
): OtpValidationDecision {
  if (challenge.consumedAtMs !== null) {
    return {
      allowed: false,
      reasonCode: 'ALREADY_CONSUMED',
      messageAr: 'تم استخدام رمز التحقق مسبقاً ولا يمكن إعادة استخدامه.',
    };
  }
  if (nowMs > challenge.expiresAtMs) {
    return {
      allowed: false,
      reasonCode: 'EXPIRED',
      messageAr: 'انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.',
    };
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return {
      allowed: false,
      reasonCode: 'MAX_ATTEMPTS_EXCEEDED',
      messageAr: 'تم تجاوز الحد الأقصى لمحاولات إدخال رمز التحقق.',
    };
  }
  return {
    allowed: true,
    reasonCode: 'OK',
    messageAr: 'الرمز قابل للتحقق.',
  };
}

export function evaluateOtpResendCooldown(
  resendAvailableAtMs: number,
  nowMs: number
): { allowed: boolean; waitSeconds: number; messageAr: string } {
  if (nowMs < resendAvailableAtMs) {
    const waitSeconds = Math.ceil((resendAvailableAtMs - nowMs) / 1000);
    return {
      allowed: false,
      waitSeconds,
      messageAr: `يرجى الانتظار ${waitSeconds} ثانية قبل إعادة إرسال الرمز.`,
    };
  }
  return {
    allowed: true,
    waitSeconds: 0,
    messageAr: 'يمكن إعادة إرسال الرمز الآن.',
  };
}

/**
 * Evaluates backend content access permission using priority:
 * Student Explicit Rule > Group Rule (unless exclusiveIsolation is active) > Default Allow (for standard content) / Deny (for exclusive isolated accounts without explicit grant).
 */
export function canAccessResource(params: {
  context: StudentAccessContext;
  resourceType: ResourceType;
  resourceId: number;
  rules: PermissionRule[];
}): { allowed: boolean; source: 'student_rule' | 'group_rule' | 'exclusive_deny' | 'default_allow' } {
  const { context, resourceType, resourceId, rules } = params;

  const studentRule = rules.find(
    (r) =>
      r.targetType === 'student' &&
      r.targetId === context.studentId &&
      r.resourceType === resourceType &&
      r.resourceId === resourceId
  );

  if (studentRule) {
    return {
      allowed: studentRule.isAllowed,
      source: 'student_rule',
    };
  }

  // Future exclusive accounts with isolation do not inherit group rules or global defaults
  if (context.accountTier === 'exclusive_reserved' && context.exclusiveIsolation) {
    return {
      allowed: false,
      source: 'exclusive_deny',
    };
  }

  if (context.groupId !== null) {
    const groupRule = rules.find(
      (r) =>
        r.targetType === 'group' &&
        r.targetId === context.groupId &&
        r.resourceType === resourceType &&
        r.resourceId === resourceId
    );
    if (groupRule) {
      return {
        allowed: groupRule.isAllowed,
        source: 'group_rule',
      };
    }
  }

  return {
    allowed: true,
    source: 'default_allow',
  };
}
