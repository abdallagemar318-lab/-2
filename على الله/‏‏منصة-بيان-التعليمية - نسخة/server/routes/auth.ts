import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  evaluateOtpChallengeState,
  evaluateOtpResendCooldown,
  isValidPhoneNumber,
  maskPhoneNumber,
  normalizePhoneNumber,
} from '../../src/shared/otpPolicy.ts';
import type { AccountStatus, AccountTier, UserRole } from '../../src/shared/types.ts';
import {
  checkRateLimitStatus,
  clearRateLimit,
  createAuthMiddleware,
  generateNumericOtp,
  generateOpaqueToken,
  getClientIp,
  getClientUserAgent,
  hashPassword,
  hashToken,
  logSecurityEvent,
  recordFailedRateLimitAttempt,
  verifyPassword,
  type AuthenticatedRequest,
} from '../security.ts';
import {
  MetaWhatsAppCloudProvider,
  getOtpPolicySettings,
  getWhatsAppIntegrationStatus,
} from '../whatsapp2fa.ts';

interface DbUserRow {
  id: number;
  full_name: string;
  phone: string;
  password_hash: string;
  role: UserRole;
  status: AccountStatus;
  group_id: number | null;
  group_name: string | null;
  account_tier: AccountTier;
  exclusive_isolation: number;
  last_login_at: string | null;
}

export function createAuthRouter(db: DatabaseSync): express.Router {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(db);
  const waProvider = new MetaWhatsAppCloudProvider();

  router.get('/status', (_req, res) => {
    const adminRow = db
      .prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")
      .get();
    const waStatus = getWhatsAppIntegrationStatus(db);

    res.json({
      hasSuperAdmin: Boolean(adminRow),
      publicRegistrationAllowed: false,
      whatsapp2fa: {
        enabled: waStatus.enabled,
        configured: waStatus.configured,
        noticeAr: waStatus.noticeAr,
      },
    });
  });

  router.post('/bootstrap-admin', (req, res) => {
    const ip = getClientIp(req);
    const ua = getClientUserAgent(req);
    const { fullName, phone, password } = req.body as {
      fullName?: string;
      phone?: string;
      password?: string;
    };

    if (!fullName || fullName.trim().length < 3) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل للمشرف (٣ أحرف على الأقل).' });
      return;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف صحيح.' });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'كلمة مرور المشرف يجب أن تكون ٨ أحرف على الأقل.' });
      return;
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const nowIso = new Date().toISOString();

    try {
      db.exec('BEGIN IMMEDIATE;');
      const existingAdmin = db
        .prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")
        .get();
      if (existingAdmin) {
        db.exec('ROLLBACK;');
        res.status(403).json({ error: 'تم إعداد حساب المشرف العام مسبقاً.' });
        return;
      }

      const phoneConflict = db
        .prepare('SELECT id FROM users WHERE phone = ?')
        .get(normalizedPhone);
      if (phoneConflict) {
        db.exec('ROLLBACK;');
        res.status(409).json({ error: 'رقم الهاتف مسجل بالفعل لحساب آخر.' });
        return;
      }

      const insRes = db
        .prepare(`
          INSERT INTO users (
            full_name, phone, password_hash, role, status, account_tier, exclusive_isolation, notes, created_at, updated_at, last_login_at
          ) VALUES (?, ?, ?, 'super_admin', 'active', 'standard', 0, 'المشرف العام للمنصة', ?, ?, ?)
        `)
        .run(
          fullName.trim(),
          normalizedPhone,
          hashPassword(password),
          nowIso,
          nowIso,
          nowIso
        );

      const userId = Number(insRes.lastInsertRowid);
      const token = generateOpaqueToken(32);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, created_at, last_active_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, hashToken(token), ip, ua, nowIso, nowIso, expiresAt);

      logSecurityEvent(db, {
        actorUserId: userId,
        targetUserId: userId,
        eventType: 'admin_bootstrapped',
        severity: 'info',
        ipAddress: ip,
        userAgent: ua,
        details: { phone: maskPhoneNumber(normalizedPhone) },
      });

      db.exec('COMMIT;');

      res.status(201).json({
        token,
        user: {
          id: userId,
          fullName: fullName.trim(),
          phone: normalizedPhone,
          role: 'super_admin',
          status: 'active',
          groupId: null,
          groupName: null,
          accountTier: 'standard',
          exclusiveIsolation: false,
          lastLoginAt: nowIso,
        },
      });
    } catch {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback error if not in transaction
      }
      res.status(500).json({ error: 'حدث خطأ أثناء تهيئة حساب المشرف العام.' });
    }
  });

  router.post('/login', async (req, res) => {
    const ip = getClientIp(req);
    const ua = getClientUserAgent(req);
    const { phone, password } = req.body as { phone?: string; password?: string };

    if (!phone || !password) {
      res.status(400).json({ error: 'يرجى إدخال رقم الهاتف وكلمة المرور.' });
      return;
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!isValidPhoneNumber(normalizedPhone)) {
      res.status(400).json({ error: 'صيغة رقم الهاتف غير صحيحة.' });
      return;
    }

    const policy = getOtpPolicySettings(db);
    const rateKeyIp = `login:ip:${ip}`;
    const rateKeyPhone = `login:phone:${normalizedPhone}`;

    const ipStatus = checkRateLimitStatus(db, rateKeyIp);
    const phoneStatus = checkRateLimitStatus(db, rateKeyPhone);
    if (ipStatus.blocked || phoneStatus.blocked) {
      const wait = Math.max(ipStatus.retryAfterSeconds, phoneStatus.retryAfterSeconds);
      res.status(429).json({
        error: `تم تقييد محاولات الدخول مؤقتاً للحماية. يرجى المحاولة بعد ${wait} ثانية.`,
      });
      return;
    }

    const userRow = db
      .prepare(`
        SELECT u.*, g.name AS group_name
        FROM users u
        LEFT JOIN student_groups g ON g.id = u.group_id
        WHERE u.phone = ?
        LIMIT 1
      `)
      .get(normalizedPhone) as DbUserRow | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      const failIp = recordFailedRateLimitAttempt(
        db,
        rateKeyIp,
        policy.maxLoginAttempts,
        policy.rateLimitWindowSeconds,
        policy.lockoutSeconds
      );
      const failPhone = recordFailedRateLimitAttempt(
        db,
        rateKeyPhone,
        policy.maxLoginAttempts,
        policy.rateLimitWindowSeconds,
        policy.lockoutSeconds
      );

      logSecurityEvent(db, {
        targetUserId: userRow?.id ?? null,
        eventType: 'login_failed',
        severity: failIp.blocked || failPhone.blocked ? 'critical' : 'warning',
        ipAddress: ip,
        userAgent: ua,
        details: { maskedPhone: maskPhoneNumber(normalizedPhone) },
      });

      res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة.' });
      return;
    }

    if (userRow.status !== 'active') {
      logSecurityEvent(db, {
        targetUserId: userRow.id,
        eventType: 'login_blocked_suspended',
        severity: 'warning',
        ipAddress: ip,
        userAgent: ua,
      });
      res.status(403).json({
        error: 'هذا الحساب موقوف مؤقتاً من قبل الإدارة. يرجى مراجعة المشرف العام.',
      });
      return;
    }

    clearRateLimit(db, rateKeyIp);
    clearRateLimit(db, rateKeyPhone);

    const waStatus = getWhatsAppIntegrationStatus(db);
    // WhatsApp 2FA stays DISABLED by default unless explicitly enabled AND configured on server
    if (userRow.role === 'student' && waStatus.enabled && waStatus.configured) {
      const otpCode = generateNumericOtp(6);
      const challengeToken = generateOpaqueToken(24);
      const nowMs = Date.now();
      const expiresAtIso = new Date(nowMs + policy.otpExpirySeconds * 1000).toISOString();
      const resendAvailableIso = new Date(
        nowMs + policy.resendCooldownSeconds * 1000
      ).toISOString();

      db.prepare(`
        INSERT INTO otp_verifications (
          user_id, challenge_token_hash, otp_hash, phone, attempts, max_attempts,
          expires_at, resend_available_at, created_at, ip_address
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(
        userRow.id,
        hashToken(challengeToken),
        hashPassword(otpCode),
        userRow.phone,
        policy.maxOtpAttempts,
        expiresAtIso,
        resendAvailableIso,
        new Date(nowMs).toISOString(),
        ip
      );

      const sendResult = await waProvider.sendTemplateOtp({
        phoneE164: userRow.phone,
        otpCode,
        templateLanguage: waStatus.templateLanguage,
      });

      logSecurityEvent(db, {
        actorUserId: userRow.id,
        targetUserId: userRow.id,
        eventType: 'otp_challenge_created',
        severity: 'info',
        ipAddress: ip,
        userAgent: ua,
        details: { sent: sendResult.sent, dryRun: sendResult.dryRun },
      });

      if (!sendResult.sent) {
        res.status(503).json({
          error: 'تعذر إرسال رمز التحقق عبر واتساب حالياً. يرجى إبلاغ المشرف العام.',
        });
        return;
      }

      res.json({
        requiresTwoFactor: true,
        challengeToken,
        maskedPhone: maskPhoneNumber(userRow.phone),
        expiresInSeconds: policy.otpExpirySeconds,
        resendCooldownSeconds: policy.resendCooldownSeconds,
      });
      return;
    }

    // Standard direct session grant (when WhatsApp 2FA is disabled)
    const nowIso = new Date().toISOString();
    const token = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, created_at, last_active_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userRow.id, hashToken(token), ip, ua, nowIso, nowIso, expiresAt);

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso, userRow.id);

    logSecurityEvent(db, {
      actorUserId: userRow.id,
      targetUserId: userRow.id,
      eventType: 'login_success',
      severity: 'info',
      ipAddress: ip,
      userAgent: ua,
      details: { role: userRow.role },
    });

    res.json({
      requiresTwoFactor: false,
      token,
      user: {
        id: userRow.id,
        fullName: userRow.full_name,
        phone: userRow.phone,
        role: userRow.role,
        status: userRow.status,
        groupId: userRow.group_id,
        groupName: userRow.group_name,
        accountTier: userRow.account_tier,
        exclusiveIsolation: Boolean(userRow.exclusive_isolation),
        lastLoginAt: nowIso,
      },
    });
  });

  router.post('/verify-otp', (req, res) => {
    const ip = getClientIp(req);
    const ua = getClientUserAgent(req);
    const { challengeToken, otpCode } = req.body as {
      challengeToken?: string;
      otpCode?: string;
    };

    if (!challengeToken || !otpCode || !/^\d{6}$/.test(otpCode.trim())) {
      res.status(400).json({ error: 'يرجى إدخال رمز التحقق المكون من ٦ أرقام.' });
      return;
    }

    const challengeHash = hashToken(challengeToken.trim());
    const otpRow = db
      .prepare(`
        SELECT o.*, u.full_name, u.role, u.status, u.group_id, u.account_tier, u.exclusive_isolation, g.name AS group_name
        FROM otp_verifications o
        JOIN users u ON u.id = o.user_id
        LEFT JOIN student_groups g ON g.id = u.group_id
        WHERE o.challenge_token_hash = ?
        LIMIT 1
      `)
      .get(challengeHash) as
      | {
          id: number;
          user_id: number;
          otp_hash: string;
          phone: string;
          attempts: number;
          max_attempts: number;
          expires_at: string;
          resend_available_at: string;
          consumed_at: string | null;
          full_name: string;
          role: UserRole;
          status: AccountStatus;
          group_id: number | null;
          group_name: string | null;
          account_tier: AccountTier;
          exclusive_isolation: number;
        }
      | undefined;

    if (!otpRow) {
      res.status(401).json({ error: 'جلسة التحقق غير صالحة أو منتهية.' });
      return;
    }

    const nowMs = Date.now();
    const stateCheck = evaluateOtpChallengeState(
      {
        expiresAtMs: Date.parse(otpRow.expires_at),
        resendAvailableAtMs: Date.parse(otpRow.resend_available_at),
        consumedAtMs: otpRow.consumed_at ? Date.parse(otpRow.consumed_at) : null,
        attempts: otpRow.attempts,
        maxAttempts: otpRow.max_attempts,
      },
      nowMs
    );

    if (!stateCheck.allowed) {
      res.status(401).json({ error: stateCheck.messageAr });
      return;
    }

    if (!verifyPassword(otpCode.trim(), otpRow.otp_hash)) {
      db.prepare('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?').run(
        otpRow.id
      );
      logSecurityEvent(db, {
        actorUserId: otpRow.user_id,
        targetUserId: otpRow.user_id,
        eventType: 'otp_verification_failed',
        severity: 'warning',
        ipAddress: ip,
        userAgent: ua,
        details: { attemptNumber: otpRow.attempts + 1 },
      });
      res.status(401).json({ error: 'رمز التحقق غير صحيح.' });
      return;
    }

    if (otpRow.status !== 'active') {
      res.status(403).json({ error: 'هذا الحساب موقوف حالياً.' });
      return;
    }

    const nowIso = new Date(nowMs).toISOString();
    const sessionToken = generateOpaqueToken(32);
    const expiresAt = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.exec('BEGIN IMMEDIATE;');
    const updateConsumed = db
      .prepare('UPDATE otp_verifications SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(nowIso, otpRow.id);

    if (updateConsumed.changes === 0) {
      db.exec('ROLLBACK;');
      res.status(401).json({ error: 'تم استخدام هذا الرمز مسبقاً.' });
      return;
    }

    db.prepare(`
      INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, created_at, last_active_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(otpRow.user_id, hashToken(sessionToken), ip, ua, nowIso, nowIso, expiresAt);

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso, otpRow.user_id);

    logSecurityEvent(db, {
      actorUserId: otpRow.user_id,
      targetUserId: otpRow.user_id,
      eventType: 'otp_verified_login',
      severity: 'info',
      ipAddress: ip,
      userAgent: ua,
    });
    db.exec('COMMIT;');

    res.json({
      token: sessionToken,
      user: {
        id: otpRow.user_id,
        fullName: otpRow.full_name,
        phone: otpRow.phone,
        role: otpRow.role,
        status: otpRow.status,
        groupId: otpRow.group_id,
        groupName: otpRow.group_name,
        accountTier: otpRow.account_tier,
        exclusiveIsolation: Boolean(otpRow.exclusive_isolation),
        lastLoginAt: nowIso,
      },
    });
  });

  router.post('/resend-otp', async (req, res) => {
    const ip = getClientIp(req);
    const ua = getClientUserAgent(req);
    const { challengeToken } = req.body as { challengeToken?: string };

    if (!challengeToken) {
      res.status(400).json({ error: 'معرف جلسة التحقق مفقود.' });
      return;
    }

    const waStatus = getWhatsAppIntegrationStatus(db);
    if (!waStatus.enabled || !waStatus.configured) {
      res.status(400).json({ error: 'التحقق عبر واتساب غير مفعل حالياً.' });
      return;
    }

    const challengeHash = hashToken(challengeToken.trim());
    const otpRow = db
      .prepare('SELECT * FROM otp_verifications WHERE challenge_token_hash = ? LIMIT 1')
      .get(challengeHash) as
      | {
          id: number;
          user_id: number;
          phone: string;
          resend_available_at: string;
          consumed_at: string | null;
        }
      | undefined;

    if (!otpRow || otpRow.consumed_at !== null) {
      res.status(404).json({ error: 'طلب التحقق غير موجود أو تم إنهاؤه.' });
      return;
    }

    const nowMs = Date.now();
    const cooldown = evaluateOtpResendCooldown(
      Date.parse(otpRow.resend_available_at),
      nowMs
    );
    if (!cooldown.allowed) {
      res.status(429).json({ error: cooldown.messageAr });
      return;
    }

    const policy = getOtpPolicySettings(db);
    const newOtp = generateNumericOtp(6);
    const newExpires = new Date(nowMs + policy.otpExpirySeconds * 1000).toISOString();
    const newCooldown = new Date(nowMs + policy.resendCooldownSeconds * 1000).toISOString();

    db.prepare(`
      UPDATE otp_verifications
      SET otp_hash = ?, attempts = 0, expires_at = ?, resend_available_at = ?
      WHERE id = ?
    `).run(hashPassword(newOtp), newExpires, newCooldown, otpRow.id);

    const sendResult = await waProvider.sendTemplateOtp({
      phoneE164: otpRow.phone,
      otpCode: newOtp,
      templateLanguage: waStatus.templateLanguage,
    });

    logSecurityEvent(db, {
      actorUserId: otpRow.user_id,
      targetUserId: otpRow.user_id,
      eventType: 'otp_resent',
      severity: 'info',
      ipAddress: ip,
      userAgent: ua,
      details: { sent: sendResult.sent },
    });

    res.json({
      resendCooldownSeconds: policy.resendCooldownSeconds,
      messageAr: sendResult.noticeAr,
    });
  });

  router.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const nowIso = new Date().toISOString();

    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
      nowIso,
      authUser.sessionId
    );

    logSecurityEvent(db, {
      actorUserId: authUser.id,
      targetUserId: authUser.id,
      eventType: 'logout',
      severity: 'info',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const row = db
      .prepare(`
        SELECT u.id, u.full_name, u.phone, u.role, u.status, u.group_id, u.account_tier, u.exclusive_isolation, u.last_login_at, g.name AS group_name
        FROM users u
        LEFT JOIN student_groups g ON g.id = u.group_id
        WHERE u.id = ?
      `)
      .get(authUser.id) as
      | {
          id: number;
          full_name: string;
          phone: string;
          role: UserRole;
          status: AccountStatus;
          group_id: number | null;
          account_tier: AccountTier;
          exclusive_isolation: number;
          last_login_at: string | null;
          group_name: string | null;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'الحساب غير موجود.' });
      return;
    }

    res.json({
      user: {
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        status: row.status,
        groupId: row.group_id,
        groupName: row.group_name,
        accountTier: row.account_tier,
        exclusiveIsolation: Boolean(row.exclusive_isolation),
        lastLoginAt: row.last_login_at,
      },
    });
  });

  return router;
}
