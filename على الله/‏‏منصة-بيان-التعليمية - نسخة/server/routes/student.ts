import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getUploadsDir } from '../db.ts';
import {
  DEFAULT_INTERFACE_CONFIG,
  normalizeInterfaceConfig,
  resolveStudentInterface,
} from '../../src/shared/interfaceResolver.ts';
import { canAccessResource } from '../../src/shared/otpPolicy.ts';
import {
  DEFAULT_EXAM_SECURITY_POLICY,
  buildStudentExamVariant,
  evaluateViolationTransition,
  normalizeExamSecurityPolicy,
  presentStoredExamVariant,
  scoreAttemptAnswers,
  type CanonicalExamQuestion,
  type ExamViolationType,
} from '../../src/shared/examSecurity.ts';
import type {
  ExamQuestion,
  InterfaceAssignmentRecord,
  InterfaceConfig,
  InterfaceLevel,
  PermissionRule,
  ResourceType,
  StudentAccessContext,
} from '../../src/shared/types.ts';
import {
  createAuthMiddleware,
  getClientIp,
  getClientUserAgent,
  logSecurityEvent,
  type AuthenticatedRequest,
} from '../security.ts';

function loadStudentContextAndRules(
  db: DatabaseSync,
  user: NonNullable<AuthenticatedRequest['authUser']>
): { context: StudentAccessContext; rules: PermissionRule[] } {
  const context: StudentAccessContext = {
    studentId: user.id,
    groupId: user.groupId,
    accountTier: user.accountTier,
    exclusiveIsolation: user.exclusiveIsolation,
  };

  const rows = db
    .prepare(`
      SELECT target_type, target_id, resource_type, resource_id, is_allowed
      FROM student_permissions
      WHERE (target_type = 'student' AND target_id = ?)
         OR (target_type = 'group' AND target_id = ?)
    `)
    .all(user.id, user.groupId ?? -1) as Array<{
    target_type: 'group' | 'student';
    target_id: number;
    resource_type: ResourceType;
    resource_id: number;
    is_allowed: number;
  }>;

  const rules: PermissionRule[] = rows.map((r) => ({
    targetType: r.target_type,
    targetId: r.target_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    isAllowed: Boolean(r.is_allowed),
  }));

  return { context, rules };
}

function loadPublishedAssignments(db: DatabaseSync): InterfaceAssignmentRecord[] {
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
        c.published_json,
        c.draft_json
      FROM interface_assignments a
      JOIN interface_configs c ON c.id = a.interface_id
      WHERE a.is_active = 1 AND c.published_json IS NOT NULL
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
    published_json: string;
    draft_json: string;
  }>;

  return rows.map((row) => {
    let parsed: Partial<InterfaceConfig> = {};
    try {
      parsed = JSON.parse(row.published_json) as Partial<InterfaceConfig>;
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

export function createStudentRouter(db: DatabaseSync): express.Router {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(db);

  router.use(requireAuth);

  router.get('/workspace', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const assignments = loadPublishedAssignments(db);
    const resolvedInterface = resolveStudentInterface({
      studentId: authUser.id,
      groupId: authUser.groupId,
      accountTier: authUser.accountTier,
      exclusiveIsolation: authUser.exclusiveIsolation,
      assignments,
    });

    const { context, rules } = loadStudentContextAndRules(db, authUser);

    const allSubjects = db
      .prepare('SELECT * FROM subjects WHERE is_active = 1 ORDER BY sort_order ASC')
      .all() as Array<{
      id: number;
      title: string;
      code: string;
      description: string;
      instructor_name: string;
      cover_image: string;
      sort_order: number;
    }>;

    const allowedSubjects = allSubjects.filter(
      (s) =>
        canAccessResource({
          context,
          resourceType: 'subject',
          resourceId: s.id,
          rules,
        }).allowed
    );
    const allowedSubjectIds = new Set(allowedSubjects.map((s) => s.id));

    const allLessons = db
      .prepare('SELECT * FROM lessons WHERE is_active = 1 ORDER BY subject_id ASC, sort_order ASC')
      .all() as Array<{
      id: number;
      subject_id: number;
      title: string;
      summary: string;
      duration_minutes: number;
      video_url: string;
      content_body: string;
      sort_order: number;
    }>;

    const allowedLessons = allLessons.filter(
      (l) =>
        allowedSubjectIds.has(l.subject_id) &&
        canAccessResource({
          context,
          resourceType: 'lesson',
          resourceId: l.id,
          rules,
        }).allowed
    );

    const allDocuments = db
      .prepare(
        'SELECT id, subject_id, title, file_type, file_size_label, description, original_filename, mime_type FROM documents WHERE is_active = 1 ORDER BY id DESC'
      )
      .all() as Array<{
      id: number;
      subject_id: number;
      title: string;
      file_type: string;
      file_size_label: string;
      description: string;
      original_filename: string;
      mime_type: string;
    }>;

    const allowedDocuments = allDocuments.filter(
      (d) =>
        allowedSubjectIds.has(d.subject_id) &&
        canAccessResource({
          context,
          resourceType: 'document',
          resourceId: d.id,
          rules,
        }).allowed
    );

    const allExams = db
      .prepare('SELECT * FROM exams WHERE is_active = 1 ORDER BY id ASC')
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
    }>;

    const submissions = db
      .prepare('SELECT exam_id, score, total_marks, submitted_at FROM exam_submissions WHERE student_id = ? ORDER BY id ASC')
      .all(authUser.id) as Array<{
      exam_id: number;
      score: number;
      total_marks: number;
      submitted_at: string;
    }>;
    const submissionMap = new Map(submissions.map((sub) => [sub.exam_id, sub]));

    const studentAttempts = db
      .prepare(`
        SELECT id, exam_id, status, violation_count, integrity_status, expires_at
        FROM exam_attempts
        WHERE student_id = ?
        ORDER BY id DESC
      `)
      .all(authUser.id) as Array<{
      id: number;
      exam_id: number;
      status: string;
      violation_count: number;
      integrity_status: string;
      expires_at: string;
    }>;

    const attemptsByExam = new Map<number, typeof studentAttempts>();
    for (const att of studentAttempts) {
      const list = attemptsByExam.get(att.exam_id) || [];
      list.push(att);
      attemptsByExam.set(att.exam_id, list);
    }

    const allowedExams = allExams
      .filter(
        (e) =>
          allowedSubjectIds.has(e.subject_id) &&
          canAccessResource({
            context,
            resourceType: 'exam',
            resourceId: e.id,
            rules,
          }).allowed
      )
      .map((e) => {
        const questions = JSON.parse(e.questions_json) as ExamQuestion[];
        let antiCheatPolicy = DEFAULT_EXAM_SECURITY_POLICY;
        try {
          antiCheatPolicy = normalizeExamSecurityPolicy(JSON.parse(e.anti_cheat_config_json || '{}'));
        } catch {
          antiCheatPolicy = DEFAULT_EXAM_SECURITY_POLICY;
        }
        const sub = submissionMap.get(e.id) || null;
        const examAttemptsList = attemptsByExam.get(e.id) || [];
        const activeAttempt = examAttemptsList.find(
          (a) => a.status === 'in_progress' && Date.parse(a.expires_at) > Date.now()
        );
        const latestFinished = examAttemptsList.find((a) => a.status !== 'in_progress') || null;
        const finishedCount = examAttemptsList.filter((a) => a.status !== 'in_progress').length;

        return {
          id: e.id,
          subject_id: e.subject_id,
          title: e.title,
          exam_type: e.exam_type,
          duration_minutes: e.duration_minutes,
          total_marks: e.total_marks,
          due_date: e.due_date,
          questionCount: questions.length,
          antiCheatPolicy,
          attemptsUsed: finishedCount,
          hasActiveAttempt: Boolean(activeAttempt),
          latestIntegrityStatus: latestFinished?.integrity_status || null,
          latestViolationCount: latestFinished?.violation_count || 0,
          latestAttemptStatus: latestFinished?.status || null,
          // Keep sanitized preview questions (no correctIndex!) for Visual Editor preview mode
          questions: questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            options: q.options,
            marks: q.marks,
          })),
          submission: sub,
        };
      });

    const allTools = db
      .prepare('SELECT * FROM tools WHERE is_active = 1 ORDER BY id ASC')
      .all() as Array<{
      id: number;
      tool_key: string;
      title: string;
      description: string;
      category: string;
      icon_name: string;
    }>;

    const allowedTools = allTools.filter(
      (t) =>
        canAccessResource({
          context,
          resourceType: 'tool',
          resourceId: t.id,
          rules,
        }).allowed
    );

    const allAnnouncements = db
      .prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY id DESC')
      .all() as Array<{
      id: number;
      title: string;
      body: string;
      priority_level: 'normal' | 'important' | 'urgent';
      target_scope: 'all' | 'group' | 'student';
      target_id: number | null;
      published_at: string;
    }>;

    const allowedAnnouncements = allAnnouncements.filter((a) => {
      if (a.target_scope === 'group' && a.target_id !== authUser.groupId) {
        return false;
      }
      if (a.target_scope === 'student' && a.target_id !== authUser.id) {
        return false;
      }
      return canAccessResource({
        context,
        resourceType: 'announcement',
        resourceId: a.id,
        rules,
      }).allowed;
    });

    res.json({
      resolvedInterface,
      content: {
        subjects: allowedSubjects,
        lessons: allowedLessons,
        documents: allowedDocuments,
        exams: allowedExams,
        tools: allowedTools,
        announcements: allowedAnnouncements,
      },
    });
  });

  router.get('/lessons/:id', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const lessonId = Number(req.params.id);
    const lesson = db
      .prepare('SELECT * FROM lessons WHERE id = ? AND is_active = 1')
      .get(lessonId) as
      | {
          id: number;
          subject_id: number;
          title: string;
          summary: string;
          duration_minutes: number;
          video_url: string;
          content_body: string;
        }
      | undefined;

    if (!lesson) {
      res.status(404).json({ error: 'الدرس غير موجود.' });
      return;
    }

    const { context, rules } = loadStudentContextAndRules(db, authUser);
    const subjectAllowed = canAccessResource({
      context,
      resourceType: 'subject',
      resourceId: lesson.subject_id,
      rules,
    }).allowed;
    const lessonAllowed = canAccessResource({
      context,
      resourceType: 'lesson',
      resourceId: lesson.id,
      rules,
    }).allowed;

    if (!subjectAllowed || !lessonAllowed) {
      res.status(403).json({ error: 'عذراً، لا تملك صلاحية الوصول إلى هذا الدرس.' });
      return;
    }

    res.json({ lesson });
  });

  router.get('/documents/:id/download', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const docId = Number(req.params.id);
    const doc = db
      .prepare('SELECT * FROM documents WHERE id = ? AND is_active = 1')
      .get(docId) as
      | {
          id: number;
          subject_id: number;
          title: string;
          download_content: string;
          file_path: string;
          mime_type: string;
          original_filename: string;
        }
      | undefined;

    if (!doc) {
      res.status(404).json({ error: 'الملف غير موجود.' });
      return;
    }

    const { context, rules } = loadStudentContextAndRules(db, authUser);
    const subjectAllowed = canAccessResource({
      context,
      resourceType: 'subject',
      resourceId: doc.subject_id,
      rules,
    }).allowed;
    const docAllowed = canAccessResource({
      context,
      resourceType: 'document',
      resourceId: doc.id,
      rules,
    }).allowed;

    if (!subjectAllowed || !docAllowed) {
      res.status(403).json({ error: 'عذراً، لا تملك صلاحية تنزيل هذا الملف.' });
      return;
    }

    if (doc.file_path) {
      const uploadsDir = getUploadsDir();
      const resolvedPath = path.resolve(uploadsDir, path.basename(doc.file_path));
      if (!resolvedPath.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolvedPath)) {
        res.status(404).json({ error: 'ملف المرفق غير متوفر على الخادم.' });
        return;
      }
      const downloadName = doc.original_filename || `bayan-document-${doc.id}`;
      const encodedName = encodeURIComponent(downloadName);
      res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="bayan-${doc.id}${path.extname(downloadName)}"; filename*=UTF-8''${encodedName}`
      );
      res.sendFile(resolvedPath);
      return;
    }

    const fallbackName = doc.original_filename || `bayan-document-${doc.id}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bayan-document-${doc.id}.txt"; filename*=UTF-8''${encodeURIComponent(fallbackName)}`
    );
    res.send(doc.download_content);
  });

  function finalizeExpiredAttempt(
    attempt: {
      id: number;
      exam_id: number;
      student_id: number;
      option_orders_json: string;
      saved_answers_json: string;
      total_marks: number;
    },
    questions: CanonicalExamQuestion[]
  ) {
    const optionOrders = JSON.parse(attempt.option_orders_json) as Record<string, number[]>;
    const savedAnswers = JSON.parse(attempt.saved_answers_json || '{}') as Record<string, number>;
    const graded = scoreAttemptAnswers({
      questions,
      optionOrders,
      displayedAnswers: savedAnswers,
    });
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE exam_attempts
      SET status = 'auto_submitted_timeout', score = ?, submitted_at = ?
      WHERE id = ? AND status = 'in_progress'
    `).run(graded.score, nowIso, attempt.id);

    db.prepare(`
      INSERT INTO exam_submissions (exam_id, student_id, answers_json, score, total_marks, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(attempt.exam_id, attempt.student_id, JSON.stringify(graded.canonicalAnswers), graded.score, attempt.total_marks, nowIso);

    return { score: graded.score, total_marks: attempt.total_marks, submitted_at: nowIso };
  }

  router.post('/exams/:id/start', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const examId = Number(req.params.id);

    const exam = db
      .prepare('SELECT * FROM exams WHERE id = ? AND is_active = 1')
      .get(examId) as
      | {
          id: number;
          subject_id: number;
          title: string;
          duration_minutes: number;
          total_marks: number;
          questions_json: string;
          anti_cheat_config_json: string;
        }
      | undefined;

    if (!exam) {
      res.status(404).json({ error: 'الاختبار غير موجود أو غير متاح حالياً.' });
      return;
    }

    const { context, rules } = loadStudentContextAndRules(db, authUser);
    const subjectAllowed = canAccessResource({
      context,
      resourceType: 'subject',
      resourceId: exam.subject_id,
      rules,
    }).allowed;
    const examAllowed = canAccessResource({
      context,
      resourceType: 'exam',
      resourceId: exam.id,
      rules,
    }).allowed;

    if (!subjectAllowed || !examAllowed) {
      res.status(403).json({ error: 'عذراً، لا تملك صلاحية دخول هذا الاختبار.' });
      return;
    }

    const questions = JSON.parse(exam.questions_json) as CanonicalExamQuestion[];
    let policy = DEFAULT_EXAM_SECURITY_POLICY;
    try {
      policy = normalizeExamSecurityPolicy(JSON.parse(exam.anti_cheat_config_json || '{}'));
    } catch {
      policy = DEFAULT_EXAM_SECURITY_POLICY;
    }

    const existingAttempts = db
      .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ? ORDER BY id DESC')
      .all(examId, authUser.id) as Array<{
      id: number;
      exam_id: number;
      student_id: number;
      attempt_number: number;
      question_order_json: string;
      option_orders_json: string;
      saved_answers_json: string;
      status: string;
      violation_count: number;
      integrity_status: string;
      total_marks: number;
      started_at: string;
      expires_at: string;
    }>;

    // Check for active in-progress attempt
    const inProgress = existingAttempts.find((a) => a.status === 'in_progress');
    if (inProgress) {
      const expiresMs = Date.parse(inProgress.expires_at);
      if (Date.now() <= expiresMs) {
        const questionOrder = JSON.parse(inProgress.question_order_json) as string[];
        const optionOrders = JSON.parse(inProgress.option_orders_json) as Record<string, number[]>;
        const savedAnswers = JSON.parse(inProgress.saved_answers_json || '{}') as Record<string, number>;
        const presentedQuestions = presentStoredExamVariant({
          questions,
          questionOrder,
          optionOrders,
        });
        res.json({
          attemptId: inProgress.id,
          attemptNumber: inProgress.attempt_number,
          remainingSeconds: Math.max(1, Math.floor((expiresMs - Date.now()) / 1000)),
          serverExpiresAt: inProgress.expires_at,
          questions: presentedQuestions,
          savedAnswers,
          violationCount: inProgress.violation_count,
          integrityStatus: inProgress.integrity_status,
          policy,
          resumed: true,
        });
        return;
      }
      // Finalize expired attempt before checking quota
      finalizeExpiredAttempt(inProgress, questions);
    }

    const refreshedCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM exam_attempts WHERE exam_id = ? AND student_id = ? AND status != 'in_progress'")
        .get(examId, authUser.id) as { cnt: number }
    ).cnt;

    if (refreshedCount >= policy.maxAttempts) {
      res.status(403).json({
        error: `استنفدت الحد الأقصى لعدد المحاولات المسموح به لهذا الاختبار (${policy.maxAttempts}). تواصل مع المشرف العام إذا كنت بحاجة لإعادة محاولة.`,
      });
      return;
    }

    const nextAttemptNumber = existingAttempts.length + 1;
    const variant = buildStudentExamVariant({
      examId: exam.id,
      studentId: authUser.id,
      attemptNumber: nextAttemptNumber,
      questions,
      policy,
    });

    const nowMs = Date.now();
    const startedAtIso = new Date(nowMs).toISOString();
    const expiresAtIso = new Date(nowMs + exam.duration_minutes * 60 * 1000).toISOString();

    const ins = db
      .prepare(`
        INSERT INTO exam_attempts (
          exam_id, student_id, attempt_number, question_order_json, option_orders_json,
          saved_answers_json, status, violation_count, integrity_status, total_marks,
          started_at, expires_at, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, '{}', 'in_progress', 0, 'clean', ?, ?, ?, ?, ?)
      `)
      .run(
        exam.id,
        authUser.id,
        nextAttemptNumber,
        JSON.stringify(variant.questionOrder),
        JSON.stringify(variant.optionOrders),
        exam.total_marks,
        startedAtIso,
        expiresAtIso,
        getClientIp(req),
        getClientUserAgent(req)
      );

    const attemptId = Number(ins.lastInsertRowid);

    logSecurityEvent(db, {
      actorUserId: authUser.id,
      targetUserId: authUser.id,
      eventType: 'exam_started',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { examId: exam.id, attemptId, attemptNumber: nextAttemptNumber },
    });

    res.status(201).json({
      attemptId,
      attemptNumber: nextAttemptNumber,
      remainingSeconds: exam.duration_minutes * 60,
      serverExpiresAt: expiresAtIso,
      questions: variant.presentedQuestions,
      savedAnswers: {},
      violationCount: 0,
      integrityStatus: 'clean',
      policy,
      resumed: false,
    });
  });

  router.post('/exams/attempts/:attemptId/autosave', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const attemptId = Number(req.params.attemptId);
    const { answers } = req.body as { answers?: Record<string, number> };

    const attempt = db
      .prepare('SELECT id, student_id, exam_id, status, expires_at FROM exam_attempts WHERE id = ?')
      .get(attemptId) as
      | { id: number; student_id: number; exam_id: number; status: string; expires_at: string }
      | undefined;

    if (!attempt || attempt.student_id !== authUser.id) {
      res.status(404).json({ error: 'محاولة الاختبار غير موجودة.' });
      return;
    }

    if (attempt.status !== 'in_progress') {
      res.status(409).json({ error: 'تم إغلاق هذا الاختبار مسبقاً.', closed: true });
      return;
    }

    if (Date.now() > Date.parse(attempt.expires_at) + 5000) {
      res.status(409).json({ error: 'انتهى الوقت الرسمي للاختبار.', expired: true });
      return;
    }

    const sanitized: Record<string, number> = {};
    if (answers && typeof answers === 'object') {
      for (const [key, val] of Object.entries(answers)) {
        const n = Number(val);
        if (Number.isInteger(n) && n >= 0 && n < 20) {
          sanitized[String(key).slice(0, 40)] = n;
        }
      }
    }

    db.prepare('UPDATE exam_attempts SET saved_answers_json = ? WHERE id = ?').run(
      JSON.stringify(sanitized),
      attempt.id
    );

    res.json({ ok: true, savedAt: new Date().toISOString() });
  });

  router.post('/exams/attempts/:attemptId/violation', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const attemptId = Number(req.params.attemptId);
    const { violationType, details, currentAnswers } = req.body as {
      violationType?: ExamViolationType;
      details?: string;
      currentAnswers?: Record<string, number>;
    };

    const allowedViolationTypes: ExamViolationType[] = [
      'tab_switch',
      'window_blur',
      'copy_attempt',
      'paste_attempt',
      'context_menu',
      'fullscreen_exit',
      'devtools_shortcut',
      'time_expired',
    ];

    if (!violationType || !allowedViolationTypes.includes(violationType)) {
      res.status(400).json({ error: 'نوع المخالفة غير معروف.' });
      return;
    }

    const attempt = db
      .prepare('SELECT * FROM exam_attempts WHERE id = ?')
      .get(attemptId) as
      | {
          id: number;
          exam_id: number;
          student_id: number;
          option_orders_json: string;
          saved_answers_json: string;
          status: string;
          violation_count: number;
          total_marks: number;
        }
      | undefined;

    if (!attempt || attempt.student_id !== authUser.id) {
      res.status(404).json({ error: 'محاولة الاختبار غير موجودة.' });
      return;
    }

    if (attempt.status !== 'in_progress') {
      res.json({
        recorded: false,
        autoSubmitted: true,
        violationCount: attempt.violation_count,
      });
      return;
    }

    const exam = db
      .prepare('SELECT questions_json, anti_cheat_config_json FROM exams WHERE id = ?')
      .get(attempt.exam_id) as
      | { questions_json: string; anti_cheat_config_json: string }
      | undefined;

    if (!exam) {
      res.status(404).json({ error: 'الاختبار غير موجود.' });
      return;
    }

    const policy = normalizeExamSecurityPolicy(JSON.parse(exam.anti_cheat_config_json || '{}'));
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO exam_violations (attempt_id, exam_id, student_id, violation_type, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      attempt.id,
      attempt.exam_id,
      authUser.id,
      violationType,
      typeof details === 'string' ? details.slice(0, 200) : '',
      nowIso
    );

    const transition = evaluateViolationTransition({
      currentViolations: attempt.violation_count,
      policy,
    });

    // Merge latest answers if provided
    let savedAnswers = JSON.parse(attempt.saved_answers_json || '{}') as Record<string, number>;
    if (currentAnswers && typeof currentAnswers === 'object') {
      const merged = { ...savedAnswers };
      for (const [k, v] of Object.entries(currentAnswers)) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) merged[k] = n;
      }
      savedAnswers = merged;
    }

    if (transition.shouldAutoSubmit) {
      const questions = JSON.parse(exam.questions_json) as CanonicalExamQuestion[];
      const optionOrders = JSON.parse(attempt.option_orders_json) as Record<string, number[]>;
      const graded = scoreAttemptAnswers({
        questions,
        optionOrders,
        displayedAnswers: savedAnswers,
      });

      db.prepare(`
        UPDATE exam_attempts
        SET violation_count = ?, integrity_status = 'flagged', status = 'auto_submitted_violation',
            saved_answers_json = ?, score = ?, submitted_at = ?
        WHERE id = ?
      `).run(
        transition.nextViolations,
        JSON.stringify(savedAnswers),
        graded.score,
        nowIso,
        attempt.id
      );

      db.prepare(`
        INSERT INTO exam_submissions (exam_id, student_id, answers_json, score, total_marks, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        attempt.exam_id,
        authUser.id,
        JSON.stringify(graded.canonicalAnswers),
        graded.score,
        attempt.total_marks,
        nowIso
      );

      logSecurityEvent(db, {
        actorUserId: authUser.id,
        targetUserId: authUser.id,
        eventType: 'exam_auto_submitted_violation',
        severity: 'critical',
        ipAddress: getClientIp(req),
        userAgent: getClientUserAgent(req),
        details: {
          examId: attempt.exam_id,
          attemptId: attempt.id,
          violationType,
          violationCount: transition.nextViolations,
          score: graded.score,
        },
      });

      res.json({
        recorded: true,
        violationCount: transition.nextViolations,
        maxViolations: policy.maxViolations,
        integrityStatus: transition.integrityStatus,
        autoSubmitted: true,
        submission: {
          exam_id: attempt.exam_id,
          score: graded.score,
          total_marks: attempt.total_marks,
          submitted_at: nowIso,
        },
      });
      return;
    }

    db.prepare(`
      UPDATE exam_attempts
      SET violation_count = ?, integrity_status = ?, saved_answers_json = ?
      WHERE id = ?
    `).run(
      transition.nextViolations,
      transition.integrityStatus,
      JSON.stringify(savedAnswers),
      attempt.id
    );

    logSecurityEvent(db, {
      actorUserId: authUser.id,
      targetUserId: authUser.id,
      eventType: 'exam_violation_recorded',
      severity: 'warning',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: {
        examId: attempt.exam_id,
        attemptId: attempt.id,
        violationType,
        violationCount: transition.nextViolations,
      },
    });

    res.json({
      recorded: true,
      violationCount: transition.nextViolations,
      maxViolations: policy.maxViolations,
      integrityStatus: transition.integrityStatus,
      autoSubmitted: false,
    });
  });

  router.post('/exams/attempts/:attemptId/submit', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const attemptId = Number(req.params.attemptId);
    const { answers } = req.body as { answers?: Record<string, number> };

    const attempt = db
      .prepare('SELECT * FROM exam_attempts WHERE id = ?')
      .get(attemptId) as
      | {
          id: number;
          exam_id: number;
          student_id: number;
          option_orders_json: string;
          saved_answers_json: string;
          status: string;
          violation_count: number;
          integrity_status: string;
          total_marks: number;
          expires_at: string;
        }
      | undefined;

    if (!attempt || attempt.student_id !== authUser.id) {
      res.status(404).json({ error: 'محاولة الاختبار غير موجودة.' });
      return;
    }

    if (attempt.status !== 'in_progress') {
      res.status(409).json({ error: 'تم تسليم هذه المحاولة مسبقاً.' });
      return;
    }

    const exam = db
      .prepare('SELECT * FROM exams WHERE id = ? AND is_active = 1')
      .get(attempt.exam_id) as
      | {
          id: number;
          subject_id: number;
          total_marks: number;
          questions_json: string;
          anti_cheat_config_json: string;
        }
      | undefined;

    if (!exam) {
      res.status(404).json({ error: 'الاختبار غير موجود.' });
      return;
    }

    const questions = JSON.parse(exam.questions_json) as CanonicalExamQuestion[];
    const optionOrders = JSON.parse(attempt.option_orders_json) as Record<string, number[]>;
    const savedAnswers = JSON.parse(attempt.saved_answers_json || '{}') as Record<string, number>;
    const mergedAnswers = { ...savedAnswers };
    if (answers && typeof answers === 'object') {
      for (const [k, v] of Object.entries(answers)) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) mergedAnswers[k] = n;
      }
    }

    const isExpired = Date.now() > Date.parse(attempt.expires_at) + 10_000;
    const finalStatus = isExpired ? 'auto_submitted_timeout' : 'submitted';

    const graded = scoreAttemptAnswers({
      questions,
      optionOrders,
      displayedAnswers: mergedAnswers,
    });
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE exam_attempts
      SET status = ?, saved_answers_json = ?, score = ?, submitted_at = ?
      WHERE id = ?
    `).run(finalStatus, JSON.stringify(mergedAnswers), graded.score, nowIso, attempt.id);

    db.prepare(`
      INSERT INTO exam_submissions (exam_id, student_id, answers_json, score, total_marks, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      exam.id,
      authUser.id,
      JSON.stringify(graded.canonicalAnswers),
      graded.score,
      exam.total_marks,
      nowIso
    );

    logSecurityEvent(db, {
      actorUserId: authUser.id,
      targetUserId: authUser.id,
      eventType: isExpired ? 'exam_auto_submitted_timeout' : 'exam_submitted',
      severity: isExpired ? 'warning' : 'info',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: {
        examId: exam.id,
        attemptId: attempt.id,
        score: graded.score,
        totalMarks: exam.total_marks,
        violations: attempt.violation_count,
      },
    });

    res.json({
      submission: {
        exam_id: exam.id,
        score: graded.score,
        total_marks: exam.total_marks,
        submitted_at: nowIso,
      },
      status: finalStatus,
      violationCount: attempt.violation_count,
      integrityStatus: attempt.integrity_status,
    });
  });

  // Legacy direct submit endpoint (kept for compatibility if invoked outside attempt flow)
  router.post('/exams/:id/submit', (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const examId = Number(req.params.id);
    const { answers } = req.body as { answers?: Record<string, number> };

    const exam = db
      .prepare('SELECT * FROM exams WHERE id = ? AND is_active = 1')
      .get(examId) as
      | {
          id: number;
          subject_id: number;
          total_marks: number;
          questions_json: string;
        }
      | undefined;

    if (!exam) {
      res.status(404).json({ error: 'الاختبار غير موجود.' });
      return;
    }

    const { context, rules } = loadStudentContextAndRules(db, authUser);
    const subjectAllowed = canAccessResource({
      context,
      resourceType: 'subject',
      resourceId: exam.subject_id,
      rules,
    }).allowed;
    const examAllowed = canAccessResource({
      context,
      resourceType: 'exam',
      resourceId: exam.id,
      rules,
    }).allowed;

    if (!subjectAllowed || !examAllowed) {
      res.status(403).json({ error: 'عذراً، لا تملك صلاحية تقديم هذا الاختبار.' });
      return;
    }

    const questions = JSON.parse(exam.questions_json) as ExamQuestion[];
    let score = 0;
    const safeAnswers = answers && typeof answers === 'object' ? answers : {};
    for (const q of questions) {
      if (Number(safeAnswers[q.id]) === q.correctIndex) {
        score += q.marks;
      }
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO exam_submissions (exam_id, student_id, answers_json, score, total_marks, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(exam.id, authUser.id, JSON.stringify(safeAnswers), score, exam.total_marks, nowIso);

    logSecurityEvent(db, {
      actorUserId: authUser.id,
      targetUserId: authUser.id,
      eventType: 'exam_submitted',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
      details: { examId: exam.id, score, totalMarks: exam.total_marks },
    });

    res.json({
      submission: {
        exam_id: exam.id,
        score,
        total_marks: exam.total_marks,
        submitted_at: nowIso,
      },
    });
  });

  return router;
}
