import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AccountStatus, AccountTier, UserRole } from '../src/shared/types.ts';

export interface AuthenticatedUser {
  id: number;
  fullName: string;
  phone: string;
  role: UserRole;
  status: AccountStatus;
  groupId: number | null;
  accountTier: AccountTier;
  exclusiveIsolation: boolean;
  sessionId: number;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

export function hashPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;
  try {
    const derived = crypto.scryptSync(plainPassword, salt, 64);
    const original = Buffer.from(originalHex, 'hex');
    if (derived.length !== original.length) return false;
    return crypto.timingSafeEqual(derived, original);
  } catch {
    return false;
  }
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateNumericOtp(digits = 6): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits);
  return String(crypto.randomInt(min, max));
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

export function getClientUserAgent(req: Request): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 240) : 'غير معروف';
}

export function logSecurityEvent(
  db: DatabaseSync,
  params: {
    actorUserId?: number | null;
    targetUserId?: number | null;
    eventType: string;
    severity?: 'info' | 'warning' | 'critical';
    ipAddress?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
  }
): void {
  const stmt = db.prepare(`
    INSERT INTO security_audit_logs (
      actor_user_id, target_user_id, event_type, severity, ip_address, user_agent, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    params.actorUserId ?? null,
    params.targetUserId ?? null,
    params.eventType,
    params.severity ?? 'info',
    params.ipAddress ?? '127.0.0.1',
    params.userAgent ?? 'غير معروف',
    JSON.stringify(params.details ?? {}),
    new Date().toISOString()
  );
}

export function checkRateLimitStatus(
  db: DatabaseSync,
  key: string,
  nowMs = Date.now()
): { blocked: boolean; retryAfterSeconds: number } {
  const row = db
    .prepare('SELECT attempts, window_started_at, blocked_until FROM rate_limits WHERE key = ?')
    .get(key) as
    | { attempts: number; window_started_at: number; blocked_until: number | null }
    | undefined;

  if (!row) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  if (row.blocked_until && row.blocked_until > nowMs) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((row.blocked_until - nowMs) / 1000),
    };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

export function recordFailedRateLimitAttempt(
  db: DatabaseSync,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
  lockoutSeconds: number,
  nowMs = Date.now()
): { blocked: boolean; remainingAttempts: number; retryAfterSeconds: number } {
  const existing = db
    .prepare('SELECT attempts, window_started_at, blocked_until FROM rate_limits WHERE key = ?')
    .get(key) as
    | { attempts: number; window_started_at: number; blocked_until: number | null }
    | undefined;

  const windowMs = windowSeconds * 1000;
  let attempts = 1;
  let windowStartedAt = nowMs;
  let blockedUntil: number | null = null;

  if (existing && nowMs - existing.window_started_at <= windowMs) {
    attempts = existing.attempts + 1;
    windowStartedAt = existing.window_started_at;
  }

  if (attempts >= maxAttempts) {
    blockedUntil = nowMs + lockoutSeconds * 1000;
  }

  db.prepare(`
    INSERT INTO rate_limits (key, attempts, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).run(key, attempts, windowStartedAt, blockedUntil);

  return {
    blocked: blockedUntil !== null,
    remainingAttempts: Math.max(0, maxAttempts - attempts),
    retryAfterSeconds: blockedUntil ? lockoutSeconds : 0,
  };
}

export function clearRateLimit(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
}

export function createAuthMiddleware(db: DatabaseSync) {
  return function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'يلزم تسجيل الدخول للوصول إلى هذا المورد.' });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'رمز الجلسة غير صالح.' });
      return;
    }

    const tokenHash = hashToken(token);
    const nowIso = new Date().toISOString();

    const row = db
      .prepare(`
        SELECT
          s.id AS session_id,
          s.expires_at,
          s.revoked_at,
          u.id AS user_id,
          u.full_name,
          u.phone,
          u.role,
          u.status,
          u.group_id,
          u.account_tier,
          u.exclusive_isolation
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
        LIMIT 1
      `)
      .get(tokenHash) as
      | {
          session_id: number;
          expires_at: string;
          revoked_at: string | null;
          user_id: number;
          full_name: string;
          phone: string;
          role: UserRole;
          status: AccountStatus;
          group_id: number | null;
          account_tier: AccountTier;
          exclusive_isolation: number;
        }
      | undefined;

    if (!row) {
      res.status(401).json({ error: 'الجلسة غير موجودة أو انتهت صلاحيتها.' });
      return;
    }

    if (row.revoked_at !== null) {
      res.status(401).json({ error: 'تم إنهاء هذه الجلسة من قبل الإدارة.' });
      return;
    }

    if (row.expires_at <= nowIso) {
      res.status(401).json({ error: 'انتهت مدة الجلسة، يرجى تسجيل الدخول مجدداً.' });
      return;
    }

    if (row.status !== 'active') {
      res.status(403).json({ error: 'تم تعليق هذا الحساب. تواصل مع إدارة المنصة.' });
      return;
    }

    db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(
      nowIso,
      row.session_id
    );

    req.authUser = {
      id: row.user_id,
      fullName: row.full_name,
      phone: row.phone,
      role: row.role,
      status: row.status,
      groupId: row.group_id,
      accountTier: row.account_tier,
      exclusiveIsolation: Boolean(row.exclusive_isolation),
      sessionId: row.session_id,
    };

    next();
  };
}

export function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
    return;
  }
  if (req.authUser.role !== 'super_admin') {
    res.status(403).json({
      error: 'هذا الإجراء متاح للمشرف العام فقط.',
    });
    return;
  }
  next();
}
