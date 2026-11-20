import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getTempUploadsDir, getUploadsDir } from '../db.ts';
import {
  DEFAULT_INTERFACE_CONFIG,
  cloneInterfaceConfig,
  normalizeInterfaceConfig,
  resolveStudentInterface,
} from '../../src/shared/interfaceResolver.ts';
import {
  isValidPhoneNumber,
  normalizePhoneNumber,
} from '../../src/shared/otpPolicy.ts';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  formatArabicFileSize,
  validateUploadMetadata,
} from '../../src/shared/uploadPolicy.ts';
import {
  DEFAULT_EXAM_SECURITY_POLICY,
  normalizeExamSecurityPolicy,
  type CanonicalExamQuestion,
} from '../../src/shared/examSecurity.ts';
import type {
  AccountStatus,
  AccountTier,
  InterfaceAssignmentRecord,
  InterfaceConfig,
  InterfaceLevel,
  ResourceType,
} from '../../src/shared/types.ts';
import {
  createAuthMiddleware,
  getClientIp,
  getClientUserAgent,
  hashPassword,
  logSecurityEvent,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from '../security.ts';
import {
  getOtpPolicySettings,
  getWhatsAppIntegrationStatus,
  isWhatsAppCredentialsConfigured,
} from '../whatsapp2fa.ts';

function loadAllAssignments(db: DatabaseSync, useDraft = false): InterfaceAssignmentRecord[] {
  const rows = db
    .prepare(`
      SELECT
        a.id,
        a.interface_id,
        a.target_type,
        a.target_id,
        a.priority,
        a.is_active,
        c.name AS interface_name,
        c.level,
        c.draft_json,
        c.published_json
      FROM interface_assignments a
      JOIN interface_configs c ON c.id = a.interface_id
      WHERE a.is_active = 1
    `)
    .all() as Array<{
    id: number;
    interface_id: number;
    target_type: 'default' | 'group' | 'student';
    target_id: number | null;
    priority: number;
    is_active: number;
    interface_name: string;
    level: InterfaceLevel;
    draft_json: string;
    published_json: string | null;
  }>;

  return rows.map((row) => {
    const raw = useDraft ? row.draft_json : row.published_json || row.draft_json;
    let parsed: Partial<InterfaceConfig> = {};
    try {
      parsed = JSON.parse(raw) as Partial<InterfaceConfig>;
    } catch {
      parsed = DEFAULT_INTERFACE_CONFIG;
    }
    return {
      id: row.id,
      interfaceId: row.interface_id,
      interfaceName: row.interface_name,
      level: row.level,
      targetType: row.target_type,
      targetId: row.target_id,
      priority: row.priority,
      isActive: Boolean(row.is_active),
      config: normalizeInterfaceConfig(parsed),
    };
  });
}

export function createAdminRouter(db: DatabaseSync): express.Router {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(db);

  router.use(requireAuth, requireSuperAdmin);

  router.get('/overview', (_req, res) => {
    const totalStudents = (
      db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'student'").get() as { cnt: number }
    ).cnt;
    const activeStudents = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'student' AND status = 'active'")
        .get() as { cnt: number }
    ).cnt;
    const totalGroups = (
      db.prepare('SELECT COUNT(*) AS cnt FROM student_groups').get() as { cnt: number }
    ).cnt;
    const activeSessions = (
      db
        .prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL AND expires_at > ?')
        .get(new Date().toISOString()) as { cnt: number }
    ).cnt;
    const individualInterfaces = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM interface_configs WHERE level = 'individual'")
        .get() as { cnt: number }
    ).cnt;
    const groupInterfaces = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM interface_configs WHERE level = 'group'")
        .get() as { cnt: number }
    ).cnt;
    const subjectsCount = (
      db.prepare('SELECT COUNT(*) AS cnt FROM subjects WHERE is_active = 1').get() as { cnt: number }
    ).cnt;

    const recentLogs = db
      .prepare(`
        SELECT l.id, l.event_type, l.severity, l.ip_address, l.details_json, l.created_at,
               actor.full_name AS actor_name, target.full_name AS target_name
        FROM security_audit_logs l
        LEFT JOIN users actor ON actor.id = l.actor_user_id
        LEFT JOIN users target ON target.id = l.target_user_id
        ORDER BY l.id DESC
        LIMIT 12
      `)
      .all();

    res.json({
      stats: {
        totalStudents,
        activeStudents,
        suspendedStudents: totalStudents - activeStudents,
        totalGroups,
        activeSessions,
        individualInterfaces,
        groupInterfaces,
        subjectsCount,
      },
      whatsappStatus: getWhatsAppIntegrationStatus(db),
      recentLogs,
    });
  });

  // -------- Groups & Students --------

  router.get('/groups', (_req, res) => {
    const groups = db
      .prepare(`
        SELECT g.id, g.name, g.description, g.created_at,
               (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.role = 'student') AS student_count,
               (SELECT COUNT(*) FROM interface_assignments a WHERE a.target_type = 'group' AND a.target_id = g.id AND a.is_active = 1) AS has_custom_interface
        FROM student_groups g
        ORDER BY g.id ASC
      `)
      .all();
    res.json({ groups });
  });

  router.post('/groups', (req: AuthenticatedRequest, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال اسم المجموعة الدراسية.' });
      return;
    }

    const nowIso = new Date().toISOString();
    try {
      const ins = db
        .prepare('INSERT INTO student_groups (name, description, created_at) VALUES (?, ?, ?)')
        .run(name.trim(), (description || '').trim(), nowIso);

      logSecurityEvent(db, {
        actorUserId: req.authUser!.id,
        eventType: 'group_created',
        ipAddress: getClientIp(req),
        userAgent: getClientUserAgent(req),
        details: { name: name.trim() },
      });

      res.status(201).json({
        group: {
          id: Number(ins.lastInsertRowid),
          name: name.trim(),
          description: (description || '').trim(),
          created_at: nowIso,
        },
      });
    } catch {
      res.status(409).json({ error: 'يوجد مجموعة بنفس الاسم بالفعل.' });
    }
  });

  router.get('/students', (_req, res) => {
    const assignments = loadAllAssignments(db, false);
    const nowIso = new Date().toISOString();

    const rows = db
      .prepare(`
        SELECT u.id, u.full_name, u.phone, u.status, u.group_id, u.account_tier, u.exclusive_isolation,
               u.notes, u.created_at, u.updated_at, u.last_login_at,
               g.name AS group_name,
               (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions
        FROM users u
        LEFT JOIN student_groups g ON g.id = u.group_id
        WHERE u.role = 'student'
        ORDER BY u.id DESC
      `)
      .all(nowIso) as Array<{
      id: number;
      full_name: string;
      phone: string;
      status: AccountStatus;
      group_id: number | null;
      account_tier: AccountTier;
      exclusive_isolation: number;
      notes: string;
      created_at: string;
      updated_at: string;
      last_login_at: string | null;
      group_name: string | null;
      active_sessions: number;
    }>;

    const students = rows.map((row) => {
      const resolved = resolveStudentInterface({
        studentId: row.id,
        groupId: row.group_id,
        accountTier: row.account_tier,
        exclusiveIsolation: Boolean(row.exclusive_isolation),
        assignments,
      });
      return {
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        status: row.status,
        groupId: row.group_id,
        groupName: row.group_name,
        accountTier: row.account_tier,
        exclusiveIsolation: Boolean(row.exclusive_isolation),
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLoginAt: row.last_login_at,
        activeSessions: row.active_sessions,
        effectiveInterface: {
          sourceLevel: resolved.sourceLevel,
          interfaceId: resolved.interfaceId,
          interfaceName: resolved.interfaceName,
        },
      };
    });

    res.json({ students });
  });

  router.post('/students', (req: AuthenticatedRequest, res) => {
    const { fullName, phone, password, groupId, notes } = req.body as {
      fullName?: string;
      phone?: string;
      password?: string;
      groupId?: number | null;
      notes?: string;
    };

    if (!fullName || fullName.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل للطالب.' });
      return;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف صحيح.' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'كلمة المرور الأولية يجب أن تكون ٦ أحرف على الأقل.' });
      return;
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone);
    if (existing) {
      res.status(409).json({ error: 'رقم الهاتف مسجل لحساب آخر بالفعل.' });
      return;
    }

    if (groupId !== null && groupId !== undefined) {
      const grp = db.prepare('SELECT id FROM student_groups WHERE id = ?').get(groupId);
      if (!grp) {
        res.status(400).json({ error: 'المجموعة المختارة غير موجودة.' });
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const ins = db
      .prepare(`
        INSERT INTO users (
          full_name, phone, password_hash, role, status, group_id, account_tier, exclusive_isolation, notes, created_at, updated_at
        ) VALUES (?, ?, ?, 'student', 'active', ?, 'standard', 0, ?, ?, ?)
      `)
      .run(
        fullName.trim(),
        normalizedPhone,
        hashPassword(password),
        groupId ?? null,
        (notes || '').trim(),
        nowIso,
        nowIso
      );

    const newId = Number(ins.lastInsertRowid);
    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: newId,
      eventType: 'student_created',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { fullName: fullName.trim(), groupId: groupId ?? null },
    });

    res.status(201).json({ id: newId });
  });

  router.patch('/students/:id', (req: AuthenticatedRequest, res) => {
    const studentId = Number(req.params.id);
    const student = db
      .prepare("SELECT * FROM users WHERE id = ? AND role = 'student'")
      .get(studentId) as { id: number; phone: string } | undefined;

    if (!student) {
      res.status(404).json({ error: 'حساب الطالب غير موجود.' });
      return;
    }

    const { fullName, phone, groupId, status, notes, accountTier, exclusiveIsolation } =
      req.body as {
        fullName?: string;
        phone?: string;
        groupId?: number | null;
        status?: AccountStatus;
        notes?: string;
        accountTier?: AccountTier;
        exclusiveIsolation?: boolean;
      };

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (typeof fullName === 'string' && fullName.trim().length >= 2) {
      updates.push('full_name = ?');
      values.push(fullName.trim());
    }
    if (typeof phone === 'string') {
      if (!isValidPhoneNumber(phone)) {
        res.status(400).json({ error: 'صيغة رقم الهاتف غير صحيحة.' });
        return;
      }
      const norm = normalizePhoneNumber(phone);
      const conflict = db
        .prepare('SELECT id FROM users WHERE phone = ? AND id != ?')
        .get(norm, studentId);
      if (conflict) {
        res.status(409).json({ error: 'رقم الهاتف مستخدم في حساب آخر.' });
        return;
      }
      updates.push('phone = ?');
      values.push(norm);
    }
    if (groupId !== undefined) {
      if (groupId !== null) {
        const grp = db.prepare('SELECT id FROM student_groups WHERE id = ?').get(groupId);
        if (!grp) {
          res.status(400).json({ error: 'المجموعة غير موجودة.' });
          return;
        }
      }
      updates.push('group_id = ?');
      values.push(groupId);
    }
    if (status === 'active' || status === 'suspended') {
      updates.push('status = ?');
      values.push(status);
      if (status === 'suspended') {
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
          new Date().toISOString(),
          studentId
        );
      }
    }
    if (typeof notes === 'string') {
      updates.push('notes = ?');
      values.push(notes.trim());
    }
    if (accountTier === 'standard' || accountTier === 'exclusive_reserved') {
      updates.push('account_tier = ?');
      values.push(accountTier);
    }
    if (typeof exclusiveIsolation === 'boolean') {
      updates.push('exclusive_isolation = ?');
      values.push(exclusiveIsolation ? 1 : 0);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'لا توجد بيانات صالحة للتحديث.' });
      return;
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(studentId);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: studentId,
      eventType: 'student_updated',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { updatedFields: updates.length - 1, status },
    });

    res.json({ ok: true });
  });

  router.post('/students/:id/reset-password', (req: AuthenticatedRequest, res) => {
    const studentId = Number(req.params.id);
    const { newPassword, revokeActiveSessions } = req.body as {
      newPassword?: string;
      revokeActiveSessions?: boolean;
    };

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون ٦ أحرف على الأقل.' });
      return;
    }

    const student = db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'student'")
      .get(studentId);
    if (!student) {
      res.status(404).json({ error: 'حساب الطالب غير موجود.' });
      return;
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(newPassword),
      nowIso,
      studentId
    );

    if (revokeActiveSessions !== false) {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
        nowIso,
        studentId
      );
    }

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: studentId,
      eventType: 'student_password_reset',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.json({ ok: true });
  });

  router.get('/students/:id/sessions', (req, res) => {
    const studentId = Number(req.params.id);
    const sessions = db
      .prepare(`
        SELECT id, ip_address, user_agent, created_at, last_active_at, expires_at, revoked_at
        FROM sessions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 25
      `)
      .all(studentId);

    const loginHistory = db
      .prepare(`
        SELECT id, event_type, severity, ip_address, user_agent, details_json, created_at
        FROM security_audit_logs
        WHERE target_user_id = ?
        ORDER BY id DESC
        LIMIT 30
      `)
      .all(studentId);

    res.json({ sessions, loginHistory });
  });

  router.post('/sessions/:sessionId/revoke', (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db
      .prepare('SELECT id, user_id FROM sessions WHERE id = ?')
      .get(sessionId) as { id: number; user_id: number } | undefined;
    if (!session) {
      res.status(404).json({ error: 'الجلسة غير موجودة.' });
      return;
    }

    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      sessionId
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: session.user_id,
      eventType: 'session_revoked',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { sessionId },
    });

    res.json({ ok: true });
  });

  router.post('/students/:id/revoke-all-sessions', (req: AuthenticatedRequest, res) => {
    const studentId = Number(req.params.id);
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      new Date().toISOString(),
      studentId
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: studentId,
      eventType: 'all_sessions_revoked',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.json({ ok: true });
  });

  // -------- Interface Customization & Versioning --------

  router.get('/interfaces', (_req, res) => {
    const list = db
      .prepare(`
        SELECT c.id, c.name, c.level, c.status, c.updated_at,
               a.target_type, a.target_id, a.priority, a.is_active,
               (SELECT COUNT(*) FROM interface_versions v WHERE v.interface_id = c.id) AS version_count
        FROM interface_configs c
        LEFT JOIN interface_assignments a ON a.interface_id = c.id AND a.is_active = 1
        ORDER BY a.priority DESC, c.id ASC
      `)
      .all();
    res.json({ interfaces: list });
  });

  router.post('/interfaces/target', (req: AuthenticatedRequest, res) => {
    const { targetType, targetId, level } = req.body as {
      targetType?: 'default' | 'group' | 'student';
      targetId?: number | null;
      level?: InterfaceLevel;
    };

    if (!targetType || !['default', 'group', 'student'].includes(targetType)) {
      res.status(400).json({ error: 'نوع الهدف غير صالح.' });
      return;
    }

    const effectiveTargetId = targetType === 'default' ? null : Number(targetId);

    const existing = db
      .prepare(`
        SELECT c.*
        FROM interface_assignments a
        JOIN interface_configs c ON c.id = a.interface_id
        WHERE a.target_type = ?
          AND ((? IS NULL AND a.target_id IS NULL) OR a.target_id = ?)
          AND a.is_active = 1
        ORDER BY a.priority DESC
        LIMIT 1
      `)
      .get(targetType, effectiveTargetId, effectiveTargetId) as
      | {
          id: number;
          name: string;
          level: InterfaceLevel;
          status: 'draft' | 'published';
          draft_json: string;
          published_json: string | null;
          published_version_id: number | null;
          updated_at: string;
        }
      | undefined;

    if (existing) {
      res.json({
        interfaceRecord: {
          id: existing.id,
          name: existing.name,
          level: existing.level,
          status: existing.status,
          draftConfig: normalizeInterfaceConfig(JSON.parse(existing.draft_json)),
          publishedConfig: existing.published_json
            ? normalizeInterfaceConfig(JSON.parse(existing.published_json))
            : null,
          publishedVersionId: existing.published_version_id,
          updatedAt: existing.updated_at,
        },
      });
      return;
    }

    // Clone base config from current effective config for this student/group or default
    const allAssignments = loadAllAssignments(db, false);
    let baseConfig = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
    let interfaceName = 'واجهة مخصصة';
    let resolvedLevel: InterfaceLevel = level || (targetType === 'group' ? 'group' : 'individual');
    let priority = targetType === 'group' ? 20 : 30;

    if (targetType === 'student' && effectiveTargetId) {
      const stu = db
        .prepare('SELECT id, full_name, group_id, account_tier, exclusive_isolation FROM users WHERE id = ?')
        .get(effectiveTargetId) as
        | {
            id: number;
            full_name: string;
            group_id: number | null;
            account_tier: AccountTier;
            exclusive_isolation: number;
          }
        | undefined;
      if (!stu) {
        res.status(404).json({ error: 'الطالب غير موجود.' });
        return;
      }
      baseConfig = resolveStudentInterface({
        studentId: stu.id,
        groupId: stu.group_id,
        accountTier: stu.account_tier,
        exclusiveIsolation: Boolean(stu.exclusive_isolation),
        assignments: allAssignments,
      }).config;
      interfaceName = `واجهة الطالب: ${stu.full_name}`;
      if (stu.account_tier === 'exclusive_reserved' && stu.exclusive_isolation) {
        resolvedLevel = 'exclusive_template';
        priority = 40;
      }
    } else if (targetType === 'group' && effectiveTargetId) {
      const grp = db
        .prepare('SELECT id, name FROM student_groups WHERE id = ?')
        .get(effectiveTargetId) as { id: number; name: string } | undefined;
      if (!grp) {
        res.status(404).json({ error: 'المجموعة غير موجودة.' });
        return;
      }
      interfaceName = `واجهة مجموعة: ${grp.name}`;
    }

    const nowIso = new Date().toISOString();
    const cfgJson = JSON.stringify(baseConfig);

    const insCfg = db
      .prepare(`
        INSERT INTO interface_configs (name, level, status, draft_json, published_json, created_by, created_at, updated_at)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
      `)
      .run(
        interfaceName,
        resolvedLevel,
        cfgJson,
        cfgJson,
        req.authUser!.id,
        nowIso,
        nowIso
      );
    const newInterfaceId = Number(insCfg.lastInsertRowid);

    const insVer = db
      .prepare(`
        INSERT INTO interface_versions (interface_id, version_number, config_json, change_summary, action_type, created_by, created_at)
        VALUES (?, 1, ?, 'إنشاء نسخة مبدئية مخصصة', 'draft_save', ?, ?)
      `)
      .run(newInterfaceId, cfgJson, req.authUser!.id, nowIso);

    db.prepare(`
      INSERT INTO interface_assignments (interface_id, target_type, target_id, priority, is_active, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(newInterfaceId, targetType, effectiveTargetId, priority, req.authUser!.id, nowIso);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: targetType === 'student' ? effectiveTargetId : null,
      eventType: 'interface_created',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { interfaceId: newInterfaceId, targetType, targetId: effectiveTargetId },
    });

    res.status(201).json({
      interfaceRecord: {
        id: newInterfaceId,
        name: interfaceName,
        level: resolvedLevel,
        status: 'draft',
        draftConfig: baseConfig,
        publishedConfig: baseConfig,
        publishedVersionId: Number(insVer.lastInsertRowid),
        updatedAt: nowIso,
      },
    });
  });

  router.put('/interfaces/:id/draft', (req: AuthenticatedRequest, res) => {
    const interfaceId = Number(req.params.id);
    const { config, name, changeSummary } = req.body as {
      config?: InterfaceConfig;
      name?: string;
      changeSummary?: string;
    };

    const existing = db
      .prepare('SELECT id, name FROM interface_configs WHERE id = ?')
      .get(interfaceId) as { id: number; name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الواجهة غير موجودة.' });
      return;
    }

    const normalized = normalizeInterfaceConfig(config);
    const jsonStr = JSON.stringify(normalized);
    const nowIso = new Date().toISOString();

    const maxVer = db
      .prepare('SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM interface_versions WHERE interface_id = ?')
      .get(interfaceId) as { max_ver: number };
    const nextVer = maxVer.max_ver + 1;

    db.prepare(`
      UPDATE interface_configs
      SET name = ?, draft_json = ?, status = 'draft', updated_at = ?
      WHERE id = ?
    `).run(name?.trim() || existing.name, jsonStr, nowIso, interfaceId);

    db.prepare(`
      INSERT INTO interface_versions (interface_id, version_number, config_json, change_summary, action_type, created_by, created_at)
      VALUES (?, ?, ?, ?, 'draft_save', ?, ?)
    `).run(
      interfaceId,
      nextVer,
      jsonStr,
      changeSummary?.trim() || 'حفظ مسودة تعديلات الواجهة',
      req.authUser!.id,
      nowIso
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'interface_draft_saved',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { interfaceId, versionNumber: nextVer },
    });

    res.json({ ok: true, draftConfig: normalized, versionNumber: nextVer, updatedAt: nowIso });
  });

  router.post('/interfaces/:id/publish', (req: AuthenticatedRequest, res) => {
    const interfaceId = Number(req.params.id);
    const { config, name, changeSummary } = req.body as {
      config?: InterfaceConfig;
      name?: string;
      changeSummary?: string;
    };

    const existing = db
      .prepare('SELECT id, name, draft_json FROM interface_configs WHERE id = ?')
      .get(interfaceId) as { id: number; name: string; draft_json: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الواجهة غير موجودة.' });
      return;
    }

    const normalized = config
      ? normalizeInterfaceConfig(config)
      : normalizeInterfaceConfig(JSON.parse(existing.draft_json));
    const jsonStr = JSON.stringify(normalized);
    const nowIso = new Date().toISOString();

    const maxVer = db
      .prepare('SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM interface_versions WHERE interface_id = ?')
      .get(interfaceId) as { max_ver: number };
    const nextVer = maxVer.max_ver + 1;

    const verIns = db
      .prepare(`
        INSERT INTO interface_versions (interface_id, version_number, config_json, change_summary, action_type, created_by, created_at)
        VALUES (?, ?, ?, ?, 'publish', ?, ?)
      `)
      .run(
        interfaceId,
        nextVer,
        jsonStr,
        changeSummary?.trim() || 'نشر وتعميم الواجهة المعتمدة',
        req.authUser!.id,
        nowIso
      );

    const newVerId = Number(verIns.lastInsertRowid);
    db.prepare(`
      UPDATE interface_configs
      SET name = ?, draft_json = ?, published_json = ?, status = 'published', published_version_id = ?, updated_at = ?
      WHERE id = ?
    `).run(name?.trim() || existing.name, jsonStr, jsonStr, newVerId, nowIso, interfaceId);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'interface_published',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { interfaceId, versionNumber: nextVer },
    });

    res.json({
      ok: true,
      publishedConfig: normalized,
      publishedVersionId: newVerId,
      versionNumber: nextVer,
      updatedAt: nowIso,
    });
  });

  router.get('/interfaces/:id/versions', (req, res) => {
    const interfaceId = Number(req.params.id);
    const versions = db
      .prepare(`
        SELECT v.id, v.version_number, v.change_summary, v.action_type, v.created_at,
               u.full_name AS author_name
        FROM interface_versions v
        LEFT JOIN users u ON u.id = v.created_by
        WHERE v.interface_id = ?
        ORDER BY v.version_number DESC
      `)
      .all(interfaceId);
    res.json({ versions });
  });

  router.post('/interfaces/:id/rollback', (req: AuthenticatedRequest, res) => {
    const interfaceId = Number(req.params.id);
    const { versionId } = req.body as { versionId?: number };

    const ver = db
      .prepare('SELECT id, version_number, config_json FROM interface_versions WHERE id = ? AND interface_id = ?')
      .get(Number(versionId), interfaceId) as
      | { id: number; version_number: number; config_json: string }
      | undefined;

    if (!ver) {
      res.status(404).json({ error: 'الإصدار المطلوب استعادته غير موجود.' });
      return;
    }

    const normalized = normalizeInterfaceConfig(JSON.parse(ver.config_json));
    const jsonStr = JSON.stringify(normalized);
    const nowIso = new Date().toISOString();

    const maxVer = db
      .prepare('SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM interface_versions WHERE interface_id = ?')
      .get(interfaceId) as { max_ver: number };
    const nextVer = maxVer.max_ver + 1;

    const verIns = db
      .prepare(`
        INSERT INTO interface_versions (interface_id, version_number, config_json, change_summary, action_type, created_by, created_at)
        VALUES (?, ?, ?, ?, 'rollback', ?, ?)
      `)
      .run(
        interfaceId,
        nextVer,
        jsonStr,
        `استعادة الإصدار رقم ${ver.version_number}`,
        req.authUser!.id,
        nowIso
      );

    db.prepare(`
      UPDATE interface_configs
      SET draft_json = ?, published_json = ?, status = 'published', published_version_id = ?, updated_at = ?
      WHERE id = ?
    `).run(jsonStr, jsonStr, Number(verIns.lastInsertRowid), nowIso, interfaceId);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'interface_rollback',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { interfaceId, restoredFromVersion: ver.version_number, newVersion: nextVer },
    });

    res.json({ ok: true, config: normalized, versionNumber: nextVer, updatedAt: nowIso });
  });

  router.delete('/interfaces/assignment/:targetType/:targetId', (req: AuthenticatedRequest, res) => {
    const targetType = req.params.targetType;
    const targetId = Number(req.params.targetId);

    if (targetType === 'default') {
      res.status(400).json({ error: 'لا يمكن إلغاء ربط الواجهة الافتراضية العامة.' });
      return;
    }

    db.prepare('UPDATE interface_assignments SET is_active = 0 WHERE target_type = ? AND target_id = ?').run(
      targetType,
      targetId
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: targetType === 'student' ? targetId : null,
      eventType: 'interface_override_removed',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { targetType, targetId },
    });

    res.json({ ok: true });
  });

  // -------- Content & Permissions --------

  router.get('/content', (_req, res) => {
    const subjects = db.prepare('SELECT * FROM subjects ORDER BY sort_order ASC, id ASC').all();
    const lessons = db.prepare('SELECT * FROM lessons ORDER BY subject_id ASC, sort_order ASC, id ASC').all();
    const documents = db
      .prepare(`
        SELECT id, subject_id, title, file_type, file_size_label, description,
               original_filename, mime_type, file_size_bytes,
               CASE WHEN file_path != '' THEN 1 ELSE 0 END AS has_uploaded_file,
               is_active
        FROM documents
        ORDER BY id DESC
      `)
      .all();
    const exams = db.prepare('SELECT id, subject_id, title, exam_type, duration_minutes, total_marks, due_date, is_active FROM exams ORDER BY id ASC').all();
    const tools = db.prepare('SELECT * FROM tools ORDER BY id ASC').all();
    const announcements = db.prepare('SELECT * FROM announcements ORDER BY id DESC').all();

    res.json({ subjects, lessons, documents, exams, tools, announcements });
  });

  // Chunked Binary Streaming Upload (supports up to 100 GB without buffering in RAM)
  router.post('/content/documents/upload/init', (req: AuthenticatedRequest, res) => {
    const { subjectId, title, description, fileName, mimeType, totalSizeBytes } = req.body as {
      subjectId?: number;
      title?: string;
      description?: string;
      fileName?: string;
      mimeType?: string;
      totalSizeBytes?: number;
    };

    const numericSubjectId = Number(subjectId);
    const subject = db
      .prepare('SELECT id, title FROM subjects WHERE id = ? AND is_active = 1')
      .get(numericSubjectId) as { id: number; title: string } | undefined;

    if (!subject) {
      res.status(400).json({ error: 'يرجى اختيار مكوّن عربي صحيح للملف.' });
      return;
    }

    if (!title || title.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال عنوان واضح للملف.' });
      return;
    }

    const numericTotalBytes = Number(totalSizeBytes);
    const validation = validateUploadMetadata({
      fileName: fileName || '',
      totalSizeBytes: numericTotalBytes,
    });

    if (!validation.valid || !validation.meta) {
      res.status(400).json({ error: validation.errorAr || 'بيانات الملف غير صالحة.' });
      return;
    }

    const uploadsDir = getUploadsDir();
    const tmpDir = getTempUploadsDir();

    // Prevent container disk exhaustion (ENOSPC) before accepting multi-GB uploads
    try {
      if (typeof fs.statfsSync === 'function') {
        const fsStats = fs.statfsSync(uploadsDir);
        const availableBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
        if (Number.isFinite(availableBytes) && availableBytes > 0 && numericTotalBytes > availableBytes) {
          res.status(400).json({
            error: `المساحة الحرة المتوفرة على الخادم حالياً (${formatArabicFileSize(availableBytes)}) لا تكفي لحفظ هذا الملف (${formatArabicFileSize(numericTotalBytes)}).`,
          });
          return;
        }
      }
    } catch {
      // Ignore statfs unavailability on restricted virtual filesystems
    }

    const uploadId = crypto.randomUUID();
    const tempFilename = `${uploadId}.part`;
    const tempPath = path.resolve(tmpDir, tempFilename);
    if (!tempPath.startsWith(tmpDir + path.sep)) {
      res.status(400).json({ error: 'مسار التخزين المؤقت غير آمن.' });
      return;
    }

    fs.writeFileSync(tempPath, Buffer.alloc(0));

    const resolvedMime =
      typeof mimeType === 'string' && mimeType.trim().length > 0 && mimeType.length < 160
        ? mimeType.trim()
        : validation.meta.defaultMime;

    const cleanDescription = (description || `ملف مرفق ضمن ${subject.title}`).trim();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO upload_sessions (
        upload_id, admin_user_id, subject_id, title, description,
        original_filename, mime_type, file_type_ar, ext, temp_filename,
        total_size_bytes, received_bytes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'uploading', ?)
    `).run(
      uploadId,
      req.authUser!.id,
      numericSubjectId,
      title.trim(),
      cleanDescription,
      validation.safeName,
      resolvedMime,
      validation.meta.typeAr,
      validation.ext,
      tempFilename,
      numericTotalBytes,
      nowIso
    );

    res.status(201).json({
      uploadId,
      chunkSizeBytes: UPLOAD_CHUNK_BYTES,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  });

  router.put(
    '/content/documents/upload/:uploadId/chunk',
    express.raw({ type: 'application/octet-stream', limit: '8mb' }),
    (req: AuthenticatedRequest, res) => {
      const uploadId = String(req.params.uploadId || '').trim();
      const session = db
        .prepare('SELECT * FROM upload_sessions WHERE upload_id = ?')
        .get(uploadId) as
        | {
            upload_id: string;
            admin_user_id: number;
            temp_filename: string;
            total_size_bytes: number;
            received_bytes: number;
            status: string;
          }
        | undefined;

      if (!session || session.admin_user_id !== req.authUser!.id) {
        res.status(404).json({ error: 'جلسة الرفع غير موجودة أو انتهت صلاحيتها.' });
        return;
      }

      if (session.status !== 'uploading') {
        res.status(400).json({ error: 'تم إغلاق جلسة الرفع مسبقاً.' });
        return;
      }

      const chunkOffset = Number(req.headers['x-chunk-offset']);
      if (!Number.isFinite(chunkOffset) || chunkOffset !== session.received_bytes) {
        res.status(409).json({
          error: 'ترتيب أجزاء الملف غير متطابق. يرجى إعادة محاولة الرفع.',
          expectedOffset: session.received_bytes,
        });
        return;
      }

      const chunkBuffer = req.body;
      if (!Buffer.isBuffer(chunkBuffer) || chunkBuffer.length === 0) {
        res.status(400).json({ error: 'بيانات الجزء المرفوع فارغة أو غير صالحة.' });
        return;
      }

      const nextReceived = session.received_bytes + chunkBuffer.length;
      if (nextReceived > session.total_size_bytes || nextReceived > MAX_UPLOAD_BYTES) {
        res.status(400).json({ error: 'حجم الأجزاء المستلمة يتجاوز الحجم الكلي المصرّح به للملف.' });
        return;
      }

      const tmpDir = getTempUploadsDir();
      const tempPath = path.resolve(tmpDir, path.basename(session.temp_filename));
      if (!tempPath.startsWith(tmpDir + path.sep)) {
        res.status(400).json({ error: 'مسار التخزين المؤقت غير آمن.' });
        return;
      }

      try {
        fs.appendFileSync(tempPath, chunkBuffer);
      } catch {
        res.status(500).json({ error: 'تعذر كتابة جزء الملف على القرص. تحقق من المساحة المتاحة.' });
        return;
      }

      db.prepare('UPDATE upload_sessions SET received_bytes = ? WHERE upload_id = ?').run(
        nextReceived,
        uploadId
      );

      res.json({
        receivedBytes: nextReceived,
        totalSizeBytes: session.total_size_bytes,
      });
    }
  );

  router.post('/content/documents/upload/:uploadId/complete', (req: AuthenticatedRequest, res) => {
    const uploadId = String(req.params.uploadId || '').trim();
    const session = db
      .prepare('SELECT * FROM upload_sessions WHERE upload_id = ?')
      .get(uploadId) as
      | {
          upload_id: string;
          admin_user_id: number;
          subject_id: number;
          title: string;
          description: string;
          original_filename: string;
          mime_type: string;
          file_type_ar: string;
          ext: string;
          temp_filename: string;
          total_size_bytes: number;
          received_bytes: number;
          status: string;
        }
      | undefined;

    if (!session || session.admin_user_id !== req.authUser!.id) {
      res.status(404).json({ error: 'جلسة الرفع غير موجودة.' });
      return;
    }

    if (session.status !== 'uploading') {
      res.status(400).json({ error: 'جلسة الرفع ليست نشطة.' });
      return;
    }

    if (session.received_bytes !== session.total_size_bytes) {
      res.status(400).json({ error: 'لم تكتمل جميع أجزاء الملف بعد.' });
      return;
    }

    const tmpDir = getTempUploadsDir();
    const uploadsDir = getUploadsDir();
    const tempPath = path.resolve(tmpDir, path.basename(session.temp_filename));
    const storedName = `${crypto.randomUUID()}${session.ext}`;
    const finalPath = path.resolve(uploadsDir, storedName);

    if (!tempPath.startsWith(tmpDir + path.sep) || !finalPath.startsWith(uploadsDir + path.sep)) {
      res.status(400).json({ error: 'مسار التخزين غير آمن.' });
      return;
    }

    if (!fs.existsSync(tempPath)) {
      res.status(404).json({ error: 'الملف المؤقت مفقود. يرجى إعادة الرفع.' });
      return;
    }

    try {
      fs.renameSync(tempPath, finalPath);
    } catch {
      fs.copyFileSync(tempPath, finalPath);
      fs.unlinkSync(tempPath);
    }

    const sizeLabel = formatArabicFileSize(session.total_size_bytes);

    db.prepare("UPDATE upload_sessions SET status = 'completed' WHERE upload_id = ?").run(uploadId);

    const ins = db
      .prepare(`
        INSERT INTO documents (
          subject_id, title, file_type, file_size_label, description, download_content,
          file_path, mime_type, original_filename, file_size_bytes, is_active
        ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 1)
      `)
      .run(
        session.subject_id,
        session.title,
        session.file_type_ar,
        sizeLabel,
        session.description,
        storedName,
        session.mime_type,
        session.original_filename,
        session.total_size_bytes
      );

    const newDocId = Number(ins.lastInsertRowid);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'document_uploaded',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: {
        documentId: newDocId,
        fileName: session.original_filename,
        bytes: session.total_size_bytes,
        chunked: true,
      },
    });

    res.status(201).json({
      document: {
        id: newDocId,
        subject_id: session.subject_id,
        title: session.title,
        file_type: session.file_type_ar,
        file_size_label: sizeLabel,
        description: session.description,
        original_filename: session.original_filename,
        mime_type: session.mime_type,
        file_size_bytes: session.total_size_bytes,
        has_uploaded_file: 1,
        is_active: 1,
      },
    });
  });

  router.delete('/content/documents/upload/:uploadId', (req: AuthenticatedRequest, res) => {
    const uploadId = String(req.params.uploadId || '').trim();
    const session = db
      .prepare('SELECT upload_id, admin_user_id, temp_filename, status FROM upload_sessions WHERE upload_id = ?')
      .get(uploadId) as
      | {
          upload_id: string;
          admin_user_id: number;
          temp_filename: string;
          status: string;
        }
      | undefined;

    if (!session || session.admin_user_id !== req.authUser!.id) {
      res.status(404).json({ error: 'جلسة الرفع غير موجودة.' });
      return;
    }

    if (session.status === 'uploading') {
      const tmpDir = getTempUploadsDir();
      const tempPath = path.resolve(tmpDir, path.basename(session.temp_filename));
      if (tempPath.startsWith(tmpDir + path.sep) && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      db.prepare("UPDATE upload_sessions SET status = 'cancelled' WHERE upload_id = ?").run(uploadId);
    }

    res.json({ ok: true });
  });

  router.post('/content/documents/upload', (req: AuthenticatedRequest, res) => {
    const { subjectId, title, description, fileName, mimeType, base64Data } = req.body as {
      subjectId?: number;
      title?: string;
      description?: string;
      fileName?: string;
      mimeType?: string;
      base64Data?: string;
    };

    const numericSubjectId = Number(subjectId);
    const subject = db
      .prepare('SELECT id, title FROM subjects WHERE id = ? AND is_active = 1')
      .get(numericSubjectId) as { id: number; title: string } | undefined;

    if (!subject) {
      res.status(400).json({ error: 'يرجى اختيار مكوّن عربي صحيح للملف.' });
      return;
    }

    if (!title || title.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال عنوان واضح للملف.' });
      return;
    }

    if (!fileName || !base64Data) {
      res.status(400).json({ error: 'يرجى اختيار ملف لرفعه.' });
      return;
    }

    const cleanedBase64 = base64Data.includes(',') ? base64Data.split(',')[1] || '' : base64Data;
    const buffer = Buffer.from(cleanedBase64, 'base64');
    const validation = validateUploadMetadata({ fileName, totalSizeBytes: buffer.length });
    if (!validation.valid || !validation.meta) {
      res.status(400).json({
        error: validation.errorAr || 'بيانات الملف غير صالحة.',
      });
      return;
    }

    const uploadsDir = getUploadsDir();
    const storedName = `${crypto.randomUUID()}${validation.ext}`;
    const targetPath = path.resolve(uploadsDir, storedName);
    if (!targetPath.startsWith(uploadsDir + path.sep)) {
      res.status(400).json({ error: 'مسار التخزين غير آمن.' });
      return;
    }

    fs.writeFileSync(targetPath, buffer);

    const sizeLabel = formatArabicFileSize(buffer.length);

    const resolvedMime =
      typeof mimeType === 'string' && mimeType.trim().length > 0 && mimeType.length < 160
        ? mimeType.trim()
        : validation.meta.defaultMime;

    const ins = db
      .prepare(`
        INSERT INTO documents (
          subject_id, title, file_type, file_size_label, description, download_content,
          file_path, mime_type, original_filename, file_size_bytes, is_active
        ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 1)
      `)
      .run(
        numericSubjectId,
        title.trim(),
        validation.meta.typeAr,
        sizeLabel,
        (description || `ملف مرفق ضمن ${subject.title}`).trim(),
        storedName,
        resolvedMime,
        validation.safeName,
        buffer.length
      );

    const newDocId = Number(ins.lastInsertRowid);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'document_uploaded',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { documentId: newDocId, fileName: validation.safeName, bytes: buffer.length },
    });

    res.status(201).json({
      document: {
        id: newDocId,
        subject_id: numericSubjectId,
        title: title.trim(),
        file_type: validation.meta.typeAr,
        file_size_label: sizeLabel,
        description: (description || `ملف مرفق ضمن ${subject.title}`).trim(),
        original_filename: validation.safeName,
        mime_type: resolvedMime,
        file_size_bytes: buffer.length,
        has_uploaded_file: 1,
        is_active: 1,
      },
    });
  });

  router.delete('/content/documents/:id', (req: AuthenticatedRequest, res) => {
    const docId = Number(req.params.id);
    const doc = db
      .prepare('SELECT id, title, file_path FROM documents WHERE id = ?')
      .get(docId) as { id: number; title: string; file_path: string } | undefined;

    if (!doc) {
      res.status(404).json({ error: 'الملف غير موجود.' });
      return;
    }

    if (doc.file_path) {
      const uploadsDir = getUploadsDir();
      const targetPath = path.resolve(uploadsDir, path.basename(doc.file_path));
      if (targetPath.startsWith(uploadsDir + path.sep) && fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    }

    db.prepare("DELETE FROM student_permissions WHERE resource_type = 'document' AND resource_id = ?").run(
      docId
    );
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'document_deleted',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { documentId: docId, title: doc.title },
    });

    res.json({ ok: true });
  });

  router.post('/content/lessons', (req: AuthenticatedRequest, res) => {
    const { subjectId, title, summary, durationMinutes, contentBody } = req.body as {
      subjectId?: number;
      title?: string;
      summary?: string;
      durationMinutes?: number;
      contentBody?: string;
    };

    const numericSubjectId = Number(subjectId);
    const subject = db
      .prepare('SELECT id FROM subjects WHERE id = ? AND is_active = 1')
      .get(numericSubjectId);
    if (!subject) {
      res.status(400).json({ error: 'يرجى اختيار مكوّن عربي صحيح للدرس.' });
      return;
    }
    if (!title || title.trim().length < 2 || !contentBody || contentBody.trim().length < 10) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الدرس ونص الشرح.' });
      return;
    }

    const maxSort = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS mx FROM lessons WHERE subject_id = ?')
      .get(numericSubjectId) as { mx: number };

    const ins = db
      .prepare(`
        INSERT INTO lessons (subject_id, title, summary, duration_minutes, video_url, content_body, sort_order, is_active)
        VALUES (?, ?, ?, ?, '', ?, ?, 1)
      `)
      .run(
        numericSubjectId,
        title.trim(),
        (summary || title).trim(),
        Math.min(180, Math.max(5, Number(durationMinutes) || 30)),
        contentBody.trim(),
        maxSort.mx + 1
      );

    const newLessonId = Number(ins.lastInsertRowid);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'lesson_created',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { lessonId: newLessonId, subjectId: numericSubjectId },
    });

    res.status(201).json({ id: newLessonId });
  });

  router.post('/content/announcements', (req: AuthenticatedRequest, res) => {
    const { title, body, priorityLevel } = req.body as {
      title?: string;
      body?: string;
      priorityLevel?: 'normal' | 'important' | 'urgent';
    };
    if (!title || !body) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الإعلان ونصه.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const ins = db
      .prepare(`
        INSERT INTO announcements (title, body, priority_level, target_scope, target_id, published_at, is_active)
        VALUES (?, ?, ?, 'all', NULL, ?, 1)
      `)
      .run(title.trim(), body.trim(), priorityLevel || 'normal', nowIso);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'announcement_published',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { announcementId: Number(ins.lastInsertRowid) },
    });

    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  router.get('/permissions', (req, res) => {
    const targetType = req.query.targetType === 'group' ? 'group' : 'student';
    const targetId = Number(req.query.targetId || 0);
    if (!targetId) {
      res.status(400).json({ error: 'معرف الهدف مطلوب.' });
      return;
    }

    const directRules = db
      .prepare(`
        SELECT target_type, target_id, resource_type, resource_id, is_allowed, updated_at
        FROM student_permissions
        WHERE target_type = ? AND target_id = ?
      `)
      .all(targetType, targetId) as Array<{
      target_type: 'group' | 'student';
      target_id: number;
      resource_type: ResourceType;
      resource_id: number;
      is_allowed: number;
      updated_at: string;
    }>;

    let groupRules: typeof directRules = [];
    let accountTier: AccountTier = 'standard';
    let exclusiveIsolation = false;

    if (targetType === 'student') {
      const stu = db
        .prepare('SELECT group_id, account_tier, exclusive_isolation FROM users WHERE id = ?')
        .get(targetId) as
        | { group_id: number | null; account_tier: AccountTier; exclusive_isolation: number }
        | undefined;
      if (stu) {
        accountTier = stu.account_tier;
        exclusiveIsolation = Boolean(stu.exclusive_isolation);
        if (stu.group_id && !exclusiveIsolation) {
          groupRules = db
            .prepare(`
              SELECT target_type, target_id, resource_type, resource_id, is_allowed, updated_at
              FROM student_permissions
              WHERE target_type = 'group' AND target_id = ?
            `)
            .all(stu.group_id) as typeof directRules;
        }
      }
    }

    res.json({
      directRules: directRules.map((r) => ({
        targetType: r.target_type,
        targetId: r.target_id,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        isAllowed: Boolean(r.is_allowed),
        updatedAt: r.updated_at,
      })),
      groupRules: groupRules.map((r) => ({
        targetType: r.target_type,
        targetId: r.target_id,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        isAllowed: Boolean(r.is_allowed),
        updatedAt: r.updated_at,
      })),
      accountTier,
      exclusiveIsolation,
    });
  });

  router.put('/permissions', (req: AuthenticatedRequest, res) => {
    const { targetType, targetId, resourceType, resourceId, isAllowed } = req.body as {
      targetType?: 'group' | 'student';
      targetId?: number;
      resourceType?: ResourceType;
      resourceId?: number;
      isAllowed?: boolean;
    };

    const validTypes: ResourceType[] = [
      'subject',
      'lesson',
      'document',
      'exam',
      'tool',
      'announcement',
    ];
    if (
      !targetType ||
      !['group', 'student'].includes(targetType) ||
      !targetId ||
      !resourceType ||
      !validTypes.includes(resourceType) ||
      !resourceId ||
      typeof isAllowed !== 'boolean'
    ) {
      res.status(400).json({ error: 'بيانات الصلاحية غير مكتملة.' });
      return;
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO student_permissions (
        target_type, target_id, resource_type, resource_id, is_allowed, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_id, resource_type, resource_id) DO UPDATE SET
        is_allowed = excluded.is_allowed,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      targetType,
      targetId,
      resourceType,
      resourceId,
      isAllowed ? 1 : 0,
      req.authUser!.id,
      nowIso
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: targetType === 'student' ? targetId : null,
      eventType: 'permission_updated',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { targetType, targetId, resourceType, resourceId, isAllowed },
    });

    res.json({ ok: true });
  });

  router.delete('/permissions', (req: AuthenticatedRequest, res) => {
    const { targetType, targetId, resourceType, resourceId } = req.body as {
      targetType?: 'group' | 'student';
      targetId?: number;
      resourceType?: ResourceType;
      resourceId?: number;
    };

    if (!targetType || !targetId || !resourceType || !resourceId) {
      res.status(400).json({ error: 'بيانات حذف الصلاحية غير مكتملة.' });
      return;
    }

    db.prepare(`
      DELETE FROM student_permissions
      WHERE target_type = ? AND target_id = ? AND resource_type = ? AND resource_id = ?
    `).run(targetType, targetId, resourceType, resourceId);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: targetType === 'student' ? targetId : null,
      eventType: 'permission_override_cleared',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { targetType, targetId, resourceType, resourceId },
    });

    res.json({ ok: true });
  });

  // -------- Security & Future WhatsApp 2FA Settings --------

  router.get('/security/settings', (_req, res) => {
    const policy = getOtpPolicySettings(db);
    const whatsappStatus = getWhatsAppIntegrationStatus(db);
    const auditLogs = db
      .prepare(`
        SELECT l.id, l.event_type, l.severity, l.ip_address, l.user_agent, l.details_json, l.created_at,
               actor.full_name AS actor_name, target.full_name AS target_name
        FROM security_audit_logs l
        LEFT JOIN users actor ON actor.id = l.actor_user_id
        LEFT JOIN users target ON target.id = l.target_user_id
        ORDER BY l.id DESC
        LIMIT 50
      `)
      .all();

    const envReadiness = [
      {
        key: 'WHATSAPP_CLOUD_API_TOKEN',
        labelAr: 'رمز وصول WhatsApp Cloud API',
        configured: Boolean((process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim()),
      },
      {
        key: 'WHATSAPP_PHONE_NUMBER_ID',
        labelAr: 'معرف رقم الهاتف التجاري (Phone Number ID)',
        configured: Boolean((process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()),
      },
      {
        key: 'WHATSAPP_OTP_TEMPLATE_NAME',
        labelAr: 'اسم قالب رسالة التحقق المعتمد',
        configured: Boolean((process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim()),
      },
    ];

    res.json({ policy, whatsappStatus, envReadiness, auditLogs });
  });

  router.put('/security/settings', (req: AuthenticatedRequest, res) => {
    const {
      whatsapp2faEnabled,
      otpExpirySeconds,
      resendCooldownSeconds,
      maxOtpAttempts,
      maxLoginAttempts,
      lockoutSeconds,
    } = req.body as {
      whatsapp2faEnabled?: boolean;
      otpExpirySeconds?: number;
      resendCooldownSeconds?: number;
      maxOtpAttempts?: number;
      maxLoginAttempts?: number;
      lockoutSeconds?: number;
    };

    if (whatsapp2faEnabled === true && !isWhatsAppCredentialsConfigured()) {
      res.status(400).json({
        error:
          'لا يمكن تفعيل التحقق عبر واتساب قبل توفير بيانات WhatsApp Business Cloud API في متغيرات البيئة على الخادم.',
      });
      return;
    }

    const current = getOtpPolicySettings(db);
    const nextEnabled =
      typeof whatsapp2faEnabled === 'boolean'
        ? whatsapp2faEnabled && isWhatsAppCredentialsConfigured()
        : current.whatsapp2faEnabled;

    const nextOtpExpiry = Math.min(1800, Math.max(60, Number(otpExpirySeconds || current.otpExpirySeconds)));
    const nextResendCooldown = Math.min(300, Math.max(30, Number(resendCooldownSeconds || current.resendCooldownSeconds)));
    const nextMaxOtp = Math.min(10, Math.max(3, Number(maxOtpAttempts || current.maxOtpAttempts)));
    const nextMaxLogin = Math.min(15, Math.max(3, Number(maxLoginAttempts || current.maxLoginAttempts)));
    const nextLockout = Math.min(3600, Math.max(60, Number(lockoutSeconds || current.lockoutSeconds)));
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE auth_settings
      SET whatsapp_2fa_enabled = ?,
          otp_expiry_seconds = ?,
          resend_cooldown_seconds = ?,
          max_otp_attempts = ?,
          max_login_attempts = ?,
          lockout_seconds = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = 1
    `).run(
      nextEnabled ? 1 : 0,
      nextOtpExpiry,
      nextResendCooldown,
      nextMaxOtp,
      nextMaxLogin,
      nextLockout,
      req.authUser!.id,
      nowIso
    );

    db.prepare('UPDATE whatsapp_settings SET dry_run_mode = ?, updated_at = ? WHERE id = 1').run(
      nextEnabled ? 0 : 1,
      nowIso
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'security_settings_updated',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: {
        whatsapp2faEnabled: nextEnabled,
        otpExpirySeconds: nextOtpExpiry,
        maxLoginAttempts: nextMaxLogin,
      },
    });

    res.json({
      ok: true,
      policy: getOtpPolicySettings(db),
      whatsappStatus: getWhatsAppIntegrationStatus(db),
    });
  });

  // -------- Exams & Anti-Cheating Proctoring Management --------

  router.get('/exams', (_req, res) => {
    const subjects = db
      .prepare('SELECT id, title, code FROM subjects WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
      .all() as Array<{ id: number; title: string; code: string }>;

    const rawExams = db
      .prepare('SELECT * FROM exams ORDER BY id DESC')
      .all() as Array<{
      id: number;
      subject_id: number;
      title: string;
      exam_type: 'exam' | 'assignment';
      duration_minutes: number;
      total_marks: number;
      due_date: string;
      questions_json: string;
      anti_cheat_config_json: string;
      is_active: number;
    }>;

    const attemptStats = db
      .prepare(`
        SELECT exam_id,
               COUNT(*) AS total_attempts,
               SUM(CASE WHEN integrity_status = 'flagged' OR status = 'auto_submitted_violation' THEN 1 ELSE 0 END) AS flagged_attempts,
               AVG(CASE WHEN score IS NOT NULL THEN score END) AS avg_score
        FROM exam_attempts
        GROUP BY exam_id
      `)
      .all() as Array<{
      exam_id: number;
      total_attempts: number;
      flagged_attempts: number;
      avg_score: number | null;
    }>;
    const statsMap = new Map(attemptStats.map((s) => [s.exam_id, s]));

    const exams = rawExams.map((e) => {
      let parsedQuestions: CanonicalExamQuestion[] = [];
      let parsedPolicy = DEFAULT_EXAM_SECURITY_POLICY;
      try {
        parsedQuestions = JSON.parse(e.questions_json) as CanonicalExamQuestion[];
      } catch {
        parsedQuestions = [];
      }
      try {
        parsedPolicy = normalizeExamSecurityPolicy(JSON.parse(e.anti_cheat_config_json || '{}'));
      } catch {
        parsedPolicy = DEFAULT_EXAM_SECURITY_POLICY;
      }
      const stat = statsMap.get(e.id);
      return {
        id: e.id,
        subject_id: e.subject_id,
        title: e.title,
        exam_type: e.exam_type,
        duration_minutes: e.duration_minutes,
        total_marks: e.total_marks,
        due_date: e.due_date,
        questionCount: parsedQuestions.length,
        is_active: Boolean(e.is_active),
        antiCheatPolicy: parsedPolicy,
        stats: {
          totalAttempts: stat?.total_attempts || 0,
          flaggedAttempts: stat?.flagged_attempts || 0,
          avgScore: stat?.avg_score !== null && stat?.avg_score !== undefined ? Number(stat.avg_score.toFixed(1)) : null,
        },
      };
    });

    const attempts = db
      .prepare(`
        SELECT a.id, a.exam_id, a.student_id, a.attempt_number, a.status, a.violation_count,
               a.integrity_status, a.score, a.total_marks, a.started_at, a.expires_at, a.submitted_at,
               u.full_name AS student_name, u.phone AS student_phone,
               g.name AS group_name,
               ex.title AS exam_title
        FROM exam_attempts a
        JOIN users u ON u.id = a.student_id
        LEFT JOIN student_groups g ON g.id = u.group_id
        JOIN exams ex ON ex.id = a.exam_id
        ORDER BY a.id DESC
        LIMIT 80
      `)
      .all() as Array<{
      id: number;
      exam_id: number;
      student_id: number;
      attempt_number: number;
      status: string;
      violation_count: number;
      integrity_status: string;
      score: number | null;
      total_marks: number;
      started_at: string;
      expires_at: string;
      submitted_at: string | null;
      student_name: string;
      student_phone: string;
      group_name: string | null;
      exam_title: string;
    }>;

    const violationRows = db
      .prepare(`
        SELECT id, attempt_id, violation_type, details, created_at
        FROM exam_violations
        ORDER BY id DESC
        LIMIT 300
      `)
      .all() as Array<{
      id: number;
      attempt_id: number;
      violation_type: string;
      details: string;
      created_at: string;
    }>;

    const violationsByAttempt = new Map<
      number,
      Array<{ id: number; violationType: string; details: string; createdAt: string }>
    >();
    for (const v of violationRows) {
      const list = violationsByAttempt.get(v.attempt_id) || [];
      list.push({
        id: v.id,
        violationType: v.violation_type,
        details: v.details,
        createdAt: v.created_at,
      });
      violationsByAttempt.set(v.attempt_id, list);
    }

    res.json({
      subjects,
      exams,
      attempts: attempts.map((a) => ({
        ...a,
        violations: violationsByAttempt.get(a.id) || [],
      })),
    });
  });

  router.post('/exams', (req: AuthenticatedRequest, res) => {
    const {
      subjectId,
      title,
      examType,
      durationMinutes,
      dueDate,
      questions,
      antiCheatPolicy,
    } = req.body as {
      subjectId?: number;
      title?: string;
      examType?: 'exam' | 'assignment';
      durationMinutes?: number;
      dueDate?: string;
      questions?: Array<{
        prompt?: string;
        options?: string[];
        correctIndex?: number;
        marks?: number;
      }>;
      antiCheatPolicy?: unknown;
    };

    const numericSubjectId = Number(subjectId);
    const subject = db
      .prepare('SELECT id FROM subjects WHERE id = ? AND is_active = 1')
      .get(numericSubjectId);
    if (!subject) {
      res.status(400).json({ error: 'يرجى اختيار مكوّن عربي صحيح للاختبار.' });
      return;
    }

    if (!title || title.trim().length < 3) {
      res.status(400).json({ error: 'يرجى إدخال عنوان واضح للاختبار (٣ أحرف على الأقل).' });
      return;
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: 'يرجى إضافة سؤال واحد على الأقل للاختبار.' });
      return;
    }

    const cleanQuestions: CanonicalExamQuestion[] = [];
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
      const opts = Array.isArray(q.options)
        ? q.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean)
        : [];
      const correctIdx = Number(q.correctIndex);
      const marks = Math.min(40, Math.max(1, Math.round(Number(q.marks) || 5)));

      if (prompt.length < 3 || opts.length < 2 || !Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= opts.length) {
        res.status(400).json({
          error: `بيانات السؤال رقم ${i + 1} غير مكتملة. تأكد من كتابة نص السؤال وخيارين على الأقل وتحديد الإجابة الصحيحة.`,
        });
        return;
      }

      cleanQuestions.push({
        id: `q_${crypto.randomUUID().slice(0, 8)}`,
        prompt,
        options: opts,
        correctIndex: correctIdx,
        marks,
      });
    }

    const totalMarks = cleanQuestions.reduce((acc, q) => acc + q.marks, 0);
    const cleanDuration = Math.min(240, Math.max(5, Math.round(Number(durationMinutes) || 25)));
    const cleanType = examType === 'assignment' ? 'assignment' : 'exam';
    const cleanDueDate =
      typeof dueDate === 'string' && dueDate.trim().length >= 8
        ? dueDate.trim()
        : new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    const normalizedPolicy = normalizeExamSecurityPolicy(antiCheatPolicy);

    const ins = db
      .prepare(`
        INSERT INTO exams (
          subject_id, title, exam_type, duration_minutes, total_marks,
          due_date, questions_json, anti_cheat_config_json, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .run(
        numericSubjectId,
        title.trim(),
        cleanType,
        cleanDuration,
        totalMarks,
        cleanDueDate,
        JSON.stringify(cleanQuestions),
        JSON.stringify(normalizedPolicy)
      );

    const examId = Number(ins.lastInsertRowid);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'exam_created',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: {
        examId,
        title: title.trim(),
        questionCount: cleanQuestions.length,
        antiCheatPolicy: normalizedPolicy,
      },
    });

    res.status(201).json({ id: examId });
  });

  router.patch('/exams/:id/policy', (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, title, anti_cheat_config_json, is_active FROM exams WHERE id = ?')
      .get(examId) as
      | { id: number; title: string; anti_cheat_config_json: string; is_active: number }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'الاختبار غير موجود.' });
      return;
    }

    const { antiCheatPolicy, isActive } = req.body as {
      antiCheatPolicy?: unknown;
      isActive?: boolean;
    };

    const nextPolicy = normalizeExamSecurityPolicy(
      antiCheatPolicy ?? JSON.parse(existing.anti_cheat_config_json || '{}')
    );
    const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active;

    db.prepare('UPDATE exams SET anti_cheat_config_json = ?, is_active = ? WHERE id = ?').run(
      JSON.stringify(nextPolicy),
      nextActive,
      examId
    );

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'exam_policy_updated',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { examId, title: existing.title, nextPolicy, isActive: Boolean(nextActive) },
    });

    res.json({ ok: true, antiCheatPolicy: nextPolicy, isActive: Boolean(nextActive) });
  });

  router.delete('/exams/:id', (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, title FROM exams WHERE id = ?')
      .get(examId) as { id: number; title: string } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'الاختبار غير موجود.' });
      return;
    }

    db.prepare("DELETE FROM student_permissions WHERE resource_type = 'exam' AND resource_id = ?").run(
      examId
    );
    db.prepare('DELETE FROM exams WHERE id = ?').run(examId);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      eventType: 'exam_deleted',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { examId, title: existing.title },
    });

    res.json({ ok: true });
  });

  router.post('/exams/attempts/:attemptId/allow-retake', (req: AuthenticatedRequest, res) => {
    const attemptId = Number(req.params.attemptId);
    const attempt = db
      .prepare('SELECT id, exam_id, student_id, status, violation_count FROM exam_attempts WHERE id = ?')
      .get(attemptId) as
      | { id: number; exam_id: number; student_id: number; status: string; violation_count: number }
      | undefined;

    if (!attempt) {
      res.status(404).json({ error: 'سجل المحاولة غير موجود.' });
      return;
    }

    db.prepare('DELETE FROM exam_attempts WHERE id = ?').run(attemptId);

    logSecurityEvent(db, {
      actorUserId: req.authUser!.id,
      targetUserId: attempt.student_id,
      eventType: 'exam_retake_granted',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: {
        attemptId,
        examId: attempt.exam_id,
        previousStatus: attempt.status,
        previousViolations: attempt.violation_count,
      },
    });

    res.json({ ok: true });
  });

  return router;
}
