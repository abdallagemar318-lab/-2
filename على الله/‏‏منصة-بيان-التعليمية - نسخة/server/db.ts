import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_INTERFACE_CONFIG,
  PALETTE_PRESETS,
  cloneInterfaceConfig,
} from '../src/shared/interfaceResolver.ts';
import { normalizePhoneNumber } from '../src/shared/otpPolicy.ts';
import { DEFAULT_EXAM_SECURITY_POLICY } from '../src/shared/examSecurity.ts';
import { hashPassword } from './security.ts';

let dbInstance: DatabaseSync | null = null;

export function getUploadsDir(): string {
  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

export function getTempUploadsDir(): string {
  const tmpDir = path.resolve(getUploadsDir(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  return tmpDir;
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  getUploadsDir();
  getTempUploadsDir();

  const dbPath = path.join(dataDir, 'platform.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  initializeSchema(db);
  migrateLegacySchemaAndData(db);
  seedInitialPlatformData(db);

  dbInstance = db;
  return db;
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'student')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      group_id INTEGER REFERENCES student_groups(id) ON DELETE SET NULL,
      account_tier TEXT NOT NULL DEFAULT 'standard' CHECK (account_tier IN ('standard', 'exclusive_reserved')),
      exclusive_isolation INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS interface_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('default', 'group', 'individual', 'exclusive_template')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      draft_json TEXT NOT NULL,
      published_json TEXT,
      published_version_id INTEGER,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interface_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interface_id INTEGER NOT NULL REFERENCES interface_configs(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('default', 'group', 'student')),
      target_id INTEGER,
      priority INTEGER NOT NULL DEFAULT 10,
      is_active INTEGER NOT NULL DEFAULT 1,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interface_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interface_id INTEGER NOT NULL REFERENCES interface_configs(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('draft_save', 'publish', 'rollback')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      instructor_name TEXT NOT NULL,
      cover_image TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      video_url TEXT NOT NULL DEFAULT '',
      content_body TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size_label TEXT NOT NULL,
      description TEXT NOT NULL,
      download_content TEXT NOT NULL,
      file_path TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'text/plain; charset=utf-8',
      original_filename TEXT NOT NULL DEFAULT '',
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      exam_type TEXT NOT NULL CHECK (exam_type IN ('exam', 'assignment')),
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      total_marks INTEGER NOT NULL DEFAULT 20,
      due_date TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      anti_cheat_config_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS exam_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answers_json TEXT NOT NULL,
      score INTEGER NOT NULL,
      total_marks INTEGER NOT NULL,
      submitted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      question_order_json TEXT NOT NULL,
      option_orders_json TEXT NOT NULL,
      saved_answers_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'auto_submitted_violation', 'auto_submitted_timeout')),
      violation_count INTEGER NOT NULL DEFAULT 0,
      integrity_status TEXT NOT NULL DEFAULT 'clean' CHECK (integrity_status IN ('clean', 'warning', 'flagged')),
      score INTEGER,
      total_marks INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      submitted_at TEXT,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS exam_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      violation_type TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      icon_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority_level TEXT NOT NULL CHECK (priority_level IN ('normal', 'important', 'urgent')),
      target_scope TEXT NOT NULL DEFAULT 'all' CHECK (target_scope IN ('all', 'group', 'student')),
      target_id INTEGER,
      published_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS student_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('group', 'student')),
      target_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL CHECK (resource_type IN ('subject', 'lesson', 'document', 'exam', 'tool', 'announcement')),
      resource_id INTEGER NOT NULL,
      is_allowed INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(target_type, target_id, resource_type, resource_id)
    );

    CREATE TABLE IF NOT EXISTS auth_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      whatsapp_2fa_enabled INTEGER NOT NULL DEFAULT 0,
      otp_expiry_seconds INTEGER NOT NULL DEFAULT 300,
      resend_cooldown_seconds INTEGER NOT NULL DEFAULT 60,
      max_otp_attempts INTEGER NOT NULL DEFAULT 5,
      rate_limit_window_seconds INTEGER NOT NULL DEFAULT 900,
      max_login_attempts INTEGER NOT NULL DEFAULT 5,
      lockout_seconds INTEGER NOT NULL DEFAULT 300,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_token_hash TEXT NOT NULL UNIQUE,
      otp_hash TEXT NOT NULL,
      phone TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      expires_at TEXT NOT NULL,
      resend_available_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      ip_address TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider_name TEXT NOT NULL DEFAULT 'meta_cloud_api',
      api_version TEXT NOT NULL DEFAULT 'v21.0',
      template_language TEXT NOT NULL DEFAULT 'ar',
      dry_run_mode INTEGER NOT NULL DEFAULT 1,
      last_health_note TEXT NOT NULL DEFAULT 'معطل افتراضياً - بانتظار بيانات الربط الرسمية في الخادم',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER
    );

    CREATE TABLE IF NOT EXISTS upload_sessions (
      upload_id TEXT PRIMARY KEY,
      admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_type_ar TEXT NOT NULL,
      ext TEXT NOT NULL,
      temp_filename TEXT NOT NULL,
      total_size_bytes INTEGER NOT NULL,
      received_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'completed', 'cancelled')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_target ON interface_assignments(target_type, target_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_permissions_target ON student_permissions(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON security_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_verifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(exam_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_exam_violations_attempt ON exam_violations(attempt_id, created_at DESC);
  `);
}

function migrateLegacySchemaAndData(db: DatabaseSync): void {
  // Ensure new document upload columns exist on pre-existing DBs
  const docCols = db.prepare('PRAGMA table_info(documents)').all() as Array<{ name: string }>;
  const colNames = new Set(docCols.map((c) => c.name));
  if (!colNames.has('file_path')) {
    db.exec("ALTER TABLE documents ADD COLUMN file_path TEXT NOT NULL DEFAULT '';");
  }
  if (!colNames.has('mime_type')) {
    db.exec("ALTER TABLE documents ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/plain; charset=utf-8';");
  }
  if (!colNames.has('original_filename')) {
    db.exec("ALTER TABLE documents ADD COLUMN original_filename TEXT NOT NULL DEFAULT '';");
  }
  if (!colNames.has('file_size_bytes')) {
    db.exec('ALTER TABLE documents ADD COLUMN file_size_bytes INTEGER NOT NULL DEFAULT 0;');
  }

  // Ensure anti_cheat_config_json column exists on pre-existing exams tables
  const examCols = db.prepare('PRAGMA table_info(exams)').all() as Array<{ name: string }>;
  const examColNames = new Set(examCols.map((c) => c.name));
  if (!examColNames.has('anti_cheat_config_json')) {
    db.exec("ALTER TABLE exams ADD COLUMN anti_cheat_config_json TEXT NOT NULL DEFAULT '{}';");
    db.prepare('UPDATE exams SET anti_cheat_config_json = ? WHERE anti_cheat_config_json = ?').run(
      JSON.stringify(DEFAULT_EXAM_SECURITY_POLICY),
      '{}'
    );
  }

  // Migrate legacy multi-subject Turn 1 curriculum (Math/Physics) to single-grade 2nd Bac Arabic
  const legacyMath = db.prepare("SELECT id FROM subjects WHERE code IN ('MATH-301', 'PHYS-204', 'ARAB-105') LIMIT 1").get();
  if (legacyMath) {
    db.exec(`
      DELETE FROM subjects WHERE code IN ('MATH-301', 'PHYS-204', 'ARAB-105');
      DELETE FROM tools WHERE tool_key IN ('scientific_calculator', 'formula_lab', 'academic_glossary');
      DELETE FROM announcements WHERE title IN ('انطلاق الفصل الدراسي وتفعيل الواجهات المخصصة', 'موعد التقييم التشخيصي الأول');
    `);
  }

  // Update legacy group names if present so existing references stay intact
  db.prepare(`
    UPDATE student_groups
    SET name = 'الثانية باكالوريا — الآداب والعلوم الإنسانية',
        description = 'مجموعة طلبة الثانية باكالوريا في شعبة الآداب والعلوم الإنسانية'
    WHERE name = 'مسار العلوم المتقدمة'
  `).run();
  db.prepare(`
    UPDATE student_groups
    SET name = 'الثانية باكالوريا — المسالك العلمية والتقنية',
        description = 'مجموعة طلبة الثانية باكالوريا في المسالك العلمية والفيزيائية وعلوم الحياة والأرض'
    WHERE name = 'مجموعة التأسيس الأكاديمي'
  `).run();
  db.prepare(`
    UPDATE student_groups
    SET name = 'الثانية باكالوريا — المراجعة المكثفة للوطني',
        description = 'مجموعة التحضير المركز لمكونات الامتحان الوطني الموحد في اللغة العربية'
    WHERE name = 'مسار اللغة والبيان'
  `).run();

  // Upgrade legacy seeded default/group interface configs if they still carry Turn 1 Science/Math copy
  const legacySciCfg = db
    .prepare("SELECT id FROM interface_configs WHERE name = 'واجهة مسار العلوم المتقدمة'")
    .get() as { id: number } | undefined;
  if (legacySciCfg) {
    const literaryCfg = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
    literaryCfg.brandTitle = 'منصة بيان · الديوان الأدبي';
    literaryCfg.gradeLabel = 'الثانية باكالوريا · الآداب والعلوم الإنسانية';
    literaryCfg.welcomeHeadline = 'مرحباً بك في رحاب النصوص والشعر والمؤلفات';
    literaryCfg.welcomeSubtitle =
      'واجهة مخصصة لشعبة الآداب والعلوم الإنسانية تركز على التحليل المنهجي للقصائد والمؤلفات النقدية.';
    literaryCfg.typography.headingFont = 'Amiri';
    literaryCfg.typography.fontFamily = 'Noto Naskh Arabic';
    literaryCfg.layout.layoutStyle = 'literary_folio';
    const literaryJson = JSON.stringify(literaryCfg);
    db.prepare(`
      UPDATE interface_configs
      SET name = 'واجهة شعبة الآداب والعلوم الإنسانية', draft_json = ?, published_json = ?
      WHERE id = ?
    `).run(literaryJson, literaryJson, legacySciCfg.id);
  }

  const legacyDefaultCfg = db
    .prepare("SELECT id, draft_json FROM interface_configs WHERE level = 'default' LIMIT 1")
    .get() as { id: number; draft_json: string } | undefined;
  if (legacyDefaultCfg && legacyDefaultCfg.draft_json.includes('الرياضيات')) {
    const defJson = JSON.stringify(cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG));
    db.prepare(`
      UPDATE interface_configs
      SET draft_json = ?, published_json = ?
      WHERE id = ?
    `).run(defJson, defJson, legacyDefaultCfg.id);
  }
}

function seedInitialPlatformData(db: DatabaseSync): void {
  const nowIso = new Date().toISOString();

  // Singleton auth_settings (WhatsApp 2FA disabled by default)
  db.prepare(`
    INSERT OR IGNORE INTO auth_settings (
      id, whatsapp_2fa_enabled, otp_expiry_seconds, resend_cooldown_seconds,
      max_otp_attempts, rate_limit_window_seconds, max_login_attempts, lockout_seconds, updated_at
    ) VALUES (1, 0, 300, 60, 5, 900, 5, 300, ?)
  `).run(nowIso);

  // Singleton whatsapp_settings
  db.prepare(`
    INSERT OR IGNORE INTO whatsapp_settings (
      id, provider_name, api_version, template_language, dry_run_mode, last_health_note, updated_at
    ) VALUES (1, 'meta_cloud_api', 'v21.0', 'ar', 1, 'معطل افتراضياً - بانتظار إعداد بيانات الربط الرسمية', ?)
  `).run(nowIso);

  // Optional env-configured initial Super Admin
  const envAdminPass = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
  const envAdminPhone = normalizePhoneNumber(process.env.ADMIN_INITIAL_PHONE || '0500000000');
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")
    .get();

  if (!existingAdmin && envAdminPass.length >= 6 && envAdminPhone.length >= 8) {
    db.prepare(`
      INSERT INTO users (
        full_name, phone, password_hash, role, status, account_tier, exclusive_isolation, notes, created_at, updated_at
      ) VALUES (?, ?, ?, 'super_admin', 'active', 'standard', 0, 'المشرف العام للمنصة', ?, ?)
    `).run('المشرف العام', envAdminPhone, hashPassword(envAdminPass), nowIso, nowIso);
  }

  // Seed student groups for single grade level (2nd Baccalaureate Arabic)
  const groupCount = (db.prepare('SELECT COUNT(*) AS cnt FROM student_groups').get() as { cnt: number }).cnt;
  let primaryGroupId = 1;
  if (groupCount === 0) {
    const insGroup = db.prepare(
      'INSERT INTO student_groups (name, description, created_at) VALUES (?, ?, ?)'
    );
    const res1 = insGroup.run(
      'الثانية باكالوريا — الآداب والعلوم الإنسانية',
      'مجموعة طلبة الثانية باكالوريا في شعبة الآداب والعلوم الإنسانية',
      nowIso
    );
    primaryGroupId = Number(res1.lastInsertRowid);
    insGroup.run(
      'الثانية باكالوريا — المسالك العلمية والتقنية',
      'مجموعة طلبة الثانية باكالوريا في المسالك العلمية والفيزيائية وعلوم الحياة والأرض',
      nowIso
    );
    insGroup.run(
      'الثانية باكالوريا — المراجعة المكثفة للوطني',
      'مجموعة التحضير المركز لمكونات الامتحان الوطني الموحد في اللغة العربية',
      nowIso
    );
  } else {
    const firstGroup = db.prepare('SELECT id FROM student_groups ORDER BY id ASC LIMIT 1').get() as { id: number };
    primaryGroupId = firstGroup.id;
  }

  // Seed default & group interfaces if empty
  const cfgCount = (db.prepare('SELECT COUNT(*) AS cnt FROM interface_configs').get() as { cnt: number }).cnt;
  if (cfgCount === 0) {
    const defaultCfg = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
    const defaultJson = JSON.stringify(defaultCfg);
    const resDef = db.prepare(`
      INSERT INTO interface_configs (name, level, status, draft_json, published_json, created_at, updated_at)
      VALUES (?, 'default', 'published', ?, ?, ?, ?)
    `).run('الواجهة الافتراضية — الثانية باكالوريا', defaultJson, defaultJson, nowIso, nowIso);
    const defId = Number(resDef.lastInsertRowid);

    const resDefVer = db.prepare(`
      INSERT INTO interface_versions (interface_id, version_number, config_json, change_summary, action_type, created_at)
      VALUES (?, 1, ?, 'الإصدار التأسيسي الافتراضي لمادة اللغة العربية', 'publish', ?)
    `).run(defId, defaultJson, nowIso);

    db.prepare('UPDATE interface_configs SET published_version_id = ? WHERE id = ?').run(
      Number(resDefVer.lastInsertRowid),
      defId
    );
    db.prepare(`
      INSERT INTO interface_assignments (interface_id, target_type, target_id, priority, is_active, assigned_at)
      VALUES (?, 'default', NULL, 10, 1, ?)
    `).run(defId, nowIso);

    // Group template for شعبة الآداب والعلوم الإنسانية
    const adabCfg = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
    adabCfg.brandTitle = 'منصة بيان · الديوان الأدبي';
    adabCfg.gradeLabel = 'الثانية باكالوريا · الآداب والعلوم الإنسانية';
    adabCfg.welcomeHeadline = 'مرحباً بك في رحاب النصوص والشعر والمؤلفات';
    adabCfg.welcomeSubtitle =
      'واجهة أدبية هادئة تبرز دراسة الخطابات الشعرية وتقنيات التحليل النقدي والمؤلفات المقررة.';
    adabCfg.theme = { ...PALETTE_PRESETS[4].theme };
    adabCfg.typography.headingFont = 'Amiri';
    adabCfg.typography.fontFamily = 'Noto Naskh Arabic';
    adabCfg.layout.layoutStyle = 'literary_folio';
    const adabJson = JSON.stringify(adabCfg);

    const resGrp = db.prepare(`
      INSERT INTO interface_configs (name, level, status, draft_json, published_json, created_at, updated_at)
      VALUES (?, 'group', 'published', ?, ?, ?, ?)
    `).run('واجهة شعبة الآداب والعلوم الإنسانية', adabJson, adabJson, nowIso, nowIso);
    const grpId = Number(resGrp.lastInsertRowid);

    const resGrpVer = db.prepare(`
      INSERT INTO interface_versions (interface_id, version_number, config_json, change_summary, action_type, created_at)
      VALUES (?, 1, ?, 'اعتماد واجهة شعبة الآداب الافتراضية', 'publish', ?)
    `).run(grpId, adabJson, nowIso);

    db.prepare('UPDATE interface_configs SET published_version_id = ? WHERE id = ?').run(
      Number(resGrpVer.lastInsertRowid),
      grpId
    );
    db.prepare(`
      INSERT INTO interface_assignments (interface_id, target_type, target_id, priority, is_active, assigned_at)
      VALUES (?, 'group', ?, 20, 1, ?)
    `).run(grpId, primaryGroupId, nowIso);
  }

  // Seed 2nd Baccalaureate Arabic subjects (4 core components of a single grade level)
  const subjectCount = (db.prepare('SELECT COUNT(*) AS cnt FROM subjects').get() as { cnt: number }).cnt;
  if (subjectCount === 0) {
    const insSubject = db.prepare(`
      INSERT INTO subjects (title, code, description, instructor_name, cover_image, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    const sTexts = Number(
      insSubject.run(
        'مكوّن النصوص (الشعر الحديث والنقد)',
        'ARAB-BAC2-TXT',
        'دراسة خطابات إحياء النموذج، وسؤال الذات، وتكسير البنية وتجديد الرؤيا، إضافة إلى المناهج النقدية الحديثة.',
        'أ. خالد الزهراني',
        '/src/assets/images/arabic_calligraphy_banner_1795203627953.jpg',
        1
      ).lastInsertRowid
    );

    const sLang = Number(
      insSubject.run(
        'مكوّن علوم اللغة والبلاغة',
        'ARAB-BAC2-LNG',
        'التوازي، والتكرار، والصورة الشعرية، والانزياح، والاتساق والانسجام، وأساليب الحجاج اللغوي.',
        'د. سلمى العتيبي',
        '/src/assets/images/subject_arabic_literature_1795202146797.jpg',
        2
      ).lastInsertRowid
    );

    const sWriting = Number(
      insSubject.run(
        'مكوّن التعبير والإنشاء والمنهجيات',
        'ARAB-BAC2-WRT',
        'مهارات كتابة موضوع إنشائي متكامل في تحليل نص شعري أو نص نظري أو قولة نقدية وفق سلم التصحيح الوطني.',
        'أ. منى الإدريسي',
        '/src/assets/images/hero_arabic_academy_1795202146488.jpg',
        3
      ).lastInsertRowid
    );

    const sBooks = Number(
      insSubject.run(
        'مكوّن المؤلفات الأدبية المقررة',
        'ARAB-BAC2-BKS',
        'دراسة شاملة لكتاب «ظاهرة الشعر الحديث» لأحمد المعداوي المجاطي، ورواية «اللص والكلاب» لنجيب محفوظ.',
        'أ. طارق السالم',
        '/src/assets/images/arabic_poetry_books_1795203627985.jpg',
        4
      ).lastInsertRowid
    );

    const insLesson = db.prepare(`
      INSERT INTO lessons (subject_id, title, summary, duration_minutes, video_url, content_body, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);

    insLesson.run(
      sTexts,
      'خطاب إحياء النموذج وبعث الشعر العربي القديم',
      'الخصائص الموضوعية والفنية للقصيدة الإحيائية من وحدة الوزن والقافية إلى المعجم التراثي.',
      35,
      'arabic://ihya-alnamoudaj',
      'يمثل خطاب إحياء النموذج العودة إلى عمود الشعر العربي الأصيل في العصرين الجاهلي والعباسي، مع استلهام الأغراض التقليدية كالفخر والمدح والرثاء والحماسة. يعتمد الشاعر الإحيائي على نظام الشطرين المتناظرين، ووحدة الوزن والقافية والروي، والتصريع في مطلع القصيدة، وبلاغة البيان القائم على التشبيه والاستعارة الكلاسيكية.',
      1
    );
    insLesson.run(
      sTexts,
      'تكسير البنية وتجديد الرؤيا في القصيدة المعاصرة',
      'التحول من نظام الشطرين إلى نظام السطر الشعري والتفعيلة، وتوظيف الرمز والأسطورة.',
      40,
      'arabic://taksir-albinya',
      'جاء خطاب تكسير البنية استجابة لتحولات الواقع العربي الحديث، فتخلى عن البيت التقليدي لصالح السطر الشعري المتفاوت الطول القائم على تكرار التفعيلة الواحدة وتنوع القوافي. أما على مستوى الرؤيا فقد انفتح الشاعر على الرمز التاريخي والديني والأسطورة لإنتاج دلالات إيحائية مركبة.',
      2
    );
    insLesson.run(
      sLang,
      'ظاهرتا التوازي والتكرار ووظيفتهما الإيقاعية',
      'تحديد أنواع التوازي التركيبي والدلالي والتكرار الصوتي واللفظي وأثرهما في تماسك النص.',
      30,
      'arabic://tawazi-takrar',
      'يسهم التوازي في خلق إيقاع داخلي منتظم عبر تماثل البنيات النحوية أو الصرفية بين سطرين أو بيتين، وقد يكون توازياً تاماً أو جزئياً، مترادفاً أو متضاداً. أما التكرار فيؤكد البؤرة الدلالية للقصيدة سواء تكرر الحرف أو الكلمة أو اللازمة الشعرية.',
      1
    );
    insLesson.run(
      sLang,
      'الاتساق والانسجام وأساليب الحجاج في النص النظري',
      'تحليل الإحالة والربط بالوصول والتأويل الدلالي وبيان البنية الحجاجية للمقالة النقدية.',
      34,
      'arabic://ittisaq-insijam',
      'يتحقق الاتساق الشكلي في النصوص النظرية بواسطة أدوات الربط النحوية والإحالة القبلية والبعدية والوصل والاستبدال، بينما يقوم الانسجام على الترابط المنطقي للأفكار وتدرج الاستدلال من المقدمات إلى النتائج عبر الاستنباط والاستقراء وتوظيف الأمثلة والشواهد.',
      2
    );
    insLesson.run(
      sWriting,
      'منهجية كتابة إنشاء حول نص شعري (الخطوات الأربع)',
      'صياغة المقدمة المؤطرة، وفهم المضمون، وتفكيك الحقول الدلالية والإيقاع والصورة، ثم التركيب.',
      38,
      'arabic://manhajiyat-shiir',
      'تبدأ كتابة الموضوع الإنشائي بتأطير النص تاريخياً وأدبياً وذكر رواده ثم صياغة إشكالية واضحة وفرضية للقراءة. في العرض نلخص المضامين، ثم نحدد الحقول المعجمية والعلاقة بينها، وندرس الإيقاع الخارجي والداخلي والصور الشعرية والأساليب، لنخلص في التركيب إلى تمحيص الفرضية وإبراز قيمة النص.',
      1
    );
    insLesson.run(
      sWriting,
      'منهجية تحليل النص النظري والقولة النقدية',
      'رصد القضية المركزية، وتفكيك عناصرها، وتحليل طرائق العرض والحجاج والمناقشة الشخصية.',
      36,
      'arabic://manhajiyat-nazari',
      'عند معالجة نص نظري في الامتحان الوطني ينبغي إبراز السياق الثقافي للقضية النقدية وصياغة الفرضية، ثم تلخيص القضية وعرض القضايا الفرعية التي يتناولها الكاتب، وبعدها تفكيك البنية الحجاجية وطرائق التفسير والتعريف والمقارنة، وختاماً صياغة تركيب شامل يجمع بين التلخيص والمناقشة الرصينة.',
      2
    );
    insLesson.run(
      sBooks,
      'القراءة المنهجية لكتاب «ظاهرة الشعر الحديث» للمجاطي',
      'مضامين الفصول الأربعة: التطور التدريجي، تجربة الغربة والضياع، تجربة الحياة والموت، والشكل الجديد.',
      42,
      'arabic://muallaf-shiar',
      'يتتبع أحمد المعداوي المجاطي تحولات الشعر العربي الحديث في أربعة فصول مترابطة: يستعرض في الأول شروط النهضة مع البعث والإحياء ثم الاتجاه الذاتي الرومانسي، ويرصد في الثاني تجربة الغربة والضياع بعد النكبة، ويناقش في الثالث جدلية الحياة والموت والانبعاث الحضاري، ويخصص الرابع لخصائص الشكل الفني الجديد.',
      1
    );
    insLesson.run(
      sBooks,
      'تحليل رواية «اللص والكلاب» لنجيب محفوظ',
      'تتبع المتن الحكائي، والقوى الفاعلة، والزمن والمكان، والأسلوب السردي في مأساة سعيد مهران.',
      40,
      'arabic://muallaf-liss',
      'تدور أحداث الرواية حول شخصية سعيد مهران الذي يخرج من السجن مدفوعاً بالرغبة في الانتقام من عليش ونبوية ورؤوف علوان، غير أن إخفاقاته المتكررة تبرز أزمة المثقف والعدالة في مجتمع مأزوم. يمزج نجيب محفوظ بين السرد الخارجي وتيار الوعي والمونولوج الداخلي لإظهار الصراع النفسي للبطل.',
      2
    );
  }

  const txtRow = db.prepare("SELECT id FROM subjects WHERE code = 'ARAB-BAC2-TXT'").get() as
    | { id: number }
    | undefined;
  const lngRow = db.prepare("SELECT id FROM subjects WHERE code = 'ARAB-BAC2-LNG'").get() as
    | { id: number }
    | undefined;
  const wrtRow = db.prepare("SELECT id FROM subjects WHERE code = 'ARAB-BAC2-WRT'").get() as
    | { id: number }
    | undefined;
  const bksRow = db.prepare("SELECT id FROM subjects WHERE code = 'ARAB-BAC2-BKS'").get() as
    | { id: number }
    | undefined;

  if (txtRow && lngRow && wrtRow && bksRow) {
    const docCount = (db.prepare('SELECT COUNT(*) AS cnt FROM documents').get() as { cnt: number }).cnt;
    if (docCount === 0) {
      const insDoc = db.prepare(`
        INSERT INTO documents (subject_id, title, file_type, file_size_label, description, download_content, file_path, mime_type, original_filename, file_size_bytes, is_active)
        VALUES (?, ?, ?, ?, ?, ?, '', 'text/plain; charset=utf-8', ?, ?, 1)
      `);

      const doc1 =
        'ملخص الخطابات الشعرية الأربعة — الثانية باكالوريا\n====================================================\n1. إحياء النموذج: العودة إلى عمود الشعر، وحدة الوزن والقافية، التصريع، المعجم التراثي.\n2. سؤال الذات: الوجدان، الطبيعة، التأمل الذاتي، التخفف من الصنعة البيانية.\n3. تكسير البنية: السطر الشعري، التفعيلة الواحدة، تنويع القافية والروي، الدفق الشعوري.\n4. تجديد الرؤيا: الرمز والأسطورة، الرؤيا الحضارية، تداخل الأزمنة.\n';
      insDoc.run(
        txtRow.id,
        'ملخص الخطابات الشعرية الأربعة للثانية باكالوريا',
        'ملف نصي منظم (TXT)',
        '14 كيلوبايت',
        'جدول مقارن مبسط بين إحياء النموذج وسؤال الذات وتكسير البنية وتجديد الرؤيا.',
        doc1,
        'khatabat-shiir-bac2.txt',
        Buffer.byteLength(doc1, 'utf8')
      );

      const doc2 =
        'دليل علوم اللغة — التوازي والتكرار والصورة والاتساق\n====================================================\n- التوازي: تماثل تركيبي أو صرفي أو دلالي بين سطرين أو بيتين.\n- التكرار: إعادة صوت أو كلمة أو عبارة لإنتاج إيقاع وتأكيد المعنى.\n- الاتساق: الإحالة (ضمائر، أسماء إشارة، موصول) والربط (عطف، تعليل، استدراك).\n- الانسجام: الترابط الدلالي وبناء التأويل اعتماداً على السياق.\n';
      insDoc.run(
        lngRow.id,
        'بطاقة مراجعة مركزة في علوم اللغة والبلاغة',
        'ملف نصي منظم (TXT)',
        '12 كيلوبايت',
        'قواعد تطبيقية مختصرة مع أمثلة جاهزة لأسئلة الامتحان الوطني في علوم اللغة.',
        doc2,
        'oloum-allougha-bac2.txt',
        Buffer.byteLength(doc2, 'utf8')
      );

      const doc3 =
        'منهجية كتابة الموضوع الإنشائي — الثانية باكالوريا\n====================================================\nأولاً: المقدمة (تأطير أدبي، صاحب النص، الإشكالية، الفرضية).\nثانياً: العرض (الفهم وتكثيف المعاني، الحقول الدلالية، الإيقاع والصورة، التركيب والأساليب).\nثالثاً: الخاتمة (خلاصة تركيبية، تمحيص الفرضية، إبراز قيمة النص ورهانه الجمالي).\n';
      insDoc.run(
        wrtRow.id,
        'الخطاطة المنهجية لتحليل النص الشعري والنص النظري',
        'ملف نصي منظم (TXT)',
        '16 كيلوبايت',
        'نموذج عملي لترتيب الأفكار والروابط التعبيرية في الإنشاء الأدبي.',
        doc3,
        'manhajiyat-incha-bac2.txt',
        Buffer.byteLength(doc3, 'utf8')
      );

      const doc4 =
        'خلاصة مؤلفي ظاهرة الشعر الحديث واللص والكلاب\n====================================================\n- ظاهرة الشعر الحديث (المجاطي): 4 فصول ترصد تطور الشعر العربي الحديث مضموناً وشكلاً.\n- اللص والكلاب (نجيب محفوظ): 18 فصلاً تتمحور حول صراع سعيد مهران مع الخيانة والواقع.\n';
      insDoc.run(
        bksRow.id,
        'بطاقة القوى الفاعلة والفصول في المؤلفات المقررة',
        'ملف نصي منظم (TXT)',
        '18 كيلوبايت',
        'ملخص الفصول والأحداث والقضايا الأساسية في اللص والكلاب وظاهرة الشعر الحديث.',
        doc4,
        'muallafat-bac2.txt',
        Buffer.byteLength(doc4, 'utf8')
      );
    }

    const examCount = (db.prepare('SELECT COUNT(*) AS cnt FROM exams').get() as { cnt: number }).cnt;
    if (examCount === 0) {
      const defaultPolicyJson = JSON.stringify(DEFAULT_EXAM_SECURITY_POLICY);
      const insExam = db.prepare(`
        INSERT INTO exams (subject_id, title, exam_type, duration_minutes, total_marks, due_date, questions_json, anti_cheat_config_json, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, '${defaultPolicyJson.replace(/'/g, "''")}', 1)
      `);

      insExam.run(
        txtRow.id,
        'الفرض التطبيقي الأول: النصوص الشعرية والخطابات',
        'exam',
        25,
        20,
        '2026-12-18',
        JSON.stringify([
          {
            id: 'ar1',
            prompt: 'أي سمة إيقاعية تميز قصيدة تكسير البنية عن قصيدة إحياء النموذج؟',
            options: [
              'اعتماد نظام الشطرين المتناظرين ووحدة الروي',
              'اعتماد السطر الشعري وتكرار التفعيلة وتنوع القوافي',
              'الالتزام بالتصريع في المطلع فقط',
              'استعمال البحور الصافية دون غيرها في الشطرين',
            ],
            correctIndex: 1,
            marks: 5,
          },
          {
            id: 'ar2',
            prompt: 'ما الوظيفة الأساسية للرمز والأسطورة في خطاب تجديد الرؤيا؟',
            options: [
              'تضييق الدلالة في معنى مباشر واحد',
              'إضفاء بعد إيحائي وإنساني يتجاوز المعنى الحرفي',
              'الاستغناء عن الإيقاع الداخلي تماماً',
              'تقرير حقائق علمية مجردة',
            ],
            correctIndex: 1,
            marks: 5,
          },
          {
            id: 'ar3',
            prompt: 'يُعدّ محمود سامي البارودي وأحمد شوقي من أبرز رواد:',
            options: ['سؤال الذات', 'إحياء النموذج', 'تكسير البنية', 'القصة القصيرة'],
            correctIndex: 1,
            marks: 5,
          },
          {
            id: 'ar4',
            prompt: 'من خصائص الاتجاه الوجداني (سؤال الذات) أنه:',
            options: [
              'يتغنى بالأطلال ويحافظ على المعجم البدوي الجاهلي',
              'يجعل الذات الفردية والطبيعة والوجدان محور التجربة',
              'يركز على الرؤيا الجماعية الثورية فقط',
              'يعتمد السرد الروائي الحواري',
            ],
            correctIndex: 1,
            marks: 5,
          },
        ])
      );

      insExam.run(
        lngRow.id,
        'واجب تطبيقي في علوم اللغة: التوازي والاتساق',
        'assignment',
        20,
        15,
        '2026-12-22',
        JSON.stringify([
          {
            id: 'lg1',
            prompt: 'تتحقق الإحالة النصية في فقرة مقالية بواسطة:',
            options: [
              'الضمائر وأسماء الإشارة والأسماء الموصولة',
              'البحر الخليلي والتصريع',
              'الأسطورة والرمز الديني',
              'المونولوج الداخلي',
            ],
            correctIndex: 0,
            marks: 5,
          },
          {
            id: 'lg2',
            prompt: 'عندما تتطابق الجملتان في البنية النحوية والصرفية نفسها يُسمى ذلك:',
            options: ['انزياحاً دلالياً', 'توازياً تركيبياً تاماً', 'استعارة مكنية', 'طباق سلب'],
            correctIndex: 1,
            marks: 5,
          },
          {
            id: 'lg3',
            prompt: 'الفرق الأساسي بين الاتساق والانسجام أن الانسجام يرتبط بـ:',
            options: [
              'التماسك الدلالي وتأويل القارئ للمعنى العام للنص',
              'عدد الأبيات في القصيدة',
              'علامات الترقيم وحدها',
              'حجم الخط المستعمل في الطباعة',
            ],
            correctIndex: 0,
            marks: 5,
          },
        ])
      );

      insExam.run(
        bksRow.id,
        'اختبار تقويمي في المؤلفات الأدبية المقررة',
        'exam',
        20,
        15,
        '2026-12-26',
        JSON.stringify([
          {
            id: 'bk1',
            prompt: 'يرصد الفصل الثاني من كتاب «ظاهرة الشعر الحديث» لأحمد المعداوي المجاطي:',
            options: [
              'التطور التدريجي في الشعر الحديث',
              'تجربة الغربة والضياع',
              'تجربة الحياة والموت',
              'الشكل الفني الجديد للقصيدة',
            ],
            correctIndex: 1,
            marks: 5,
          },
          {
            id: 'bk2',
            prompt: 'تمثل شخصية «الشيخ علي الجنيدي» في رواية اللص والكلاب رمزاً لـ:',
            options: [
              'الانتهازية الإعلامية',
              'الملاذ الروحي والتصوف الساعي للسكينة',
              'المطاردة البوليسية',
              'الخيانة الأسرية',
            ],
            correctIndex: 1,
            marks: 5,
          },
          {
            id: 'bk3',
            prompt: 'الحدث المحوري الذي انطلقت منه أزمة سعيد مهران في بداية الرواية هو:',
            options: [
              'سفره للدراسة خارج البلاد',
              'خروجه من السجن واكتشافه خيانة زوجته وصديقه عليش',
              'عمله في جريدة الزهرة مع رؤوف علوان',
              'نجاحه في الحصول على عمل مستقر',
            ],
            correctIndex: 1,
            marks: 5,
          },
        ])
      );
    }
  }

  const toolCount = (db.prepare('SELECT COUNT(*) AS cnt FROM tools').get() as { cnt: number }).cnt;
  if (toolCount === 0) {
    const insTool = db.prepare(`
      INSERT INTO tools (tool_key, title, description, category, icon_name, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    insTool.run(
      'arabic_prosody_lab',
      'مختبر العروض وتقطيع الأبيات',
      'تقطيع الأبيات الشعرية إلى مقاطع وحروف متحركة وساكنة والتعرف على البحور الأساسية.',
      'العروض والإيقاع',
      'BookOpen'
    );
    insTool.run(
      'arabic_rhetoric_glossary',
      'معجم البلاغة والمصطلحات النقدية',
      'مرجع سريع لأهم مصطلحات النصوص وعلوم اللغة والمؤلفات المقررة في الثانية باكالوريا.',
      'مرجع لغوي ونقدي',
      'BookMarked'
    );
    insTool.run(
      'arabic_essay_planner',
      'منظم كتابة الإنشاء الأدبي',
      'هيكلة المقدمة والعرض والخاتمة وتوليد تصميم متوازن لتحليل نص شعري أو نظري.',
      'التعبير والإنشاء',
      'FileText'
    );
    insTool.run(
      'focus_timer',
      'مؤقت المطالعة والحفظ المركّز',
      'تنظيم جلسات مراجعة النصوص والمؤلفات في فترات تركيز منتظمة.',
      'تنظيم الوقت',
      'Timer'
    );
  }

  const annCount = (db.prepare('SELECT COUNT(*) AS cnt FROM announcements').get() as { cnt: number }).cnt;
  if (annCount === 0) {
    const insAnn = db.prepare(`
      INSERT INTO announcements (title, body, priority_level, target_scope, target_id, published_at, is_active)
      VALUES (?, ?, ?, 'all', NULL, ?, 1)
    `);
    insAnn.run(
      'انطلاق برنامج اللغة العربية — الصف الثاني باكالوريا',
      'تم تنظيم المنصة بالكامل لمتابعة مكونات اللغة العربية الأربعة: النصوص، علوم اللغة، التعبير والإنشاء، والمؤلفات وفق المقرر الوطني.',
      'important',
      nowIso
    );
    insAnn.run(
      'إتاحة ملخصات الخطابات الشعرية والمنهجيات في مكتبة الملفات',
      'يمكنكم تنزيل بطاقات المراجعة والمنهجيات المرفوعة من قسم مكتبة الملفات والاستعداد للفرض التطبيقي الأول.',
      'normal',
      nowIso
    );
  }
}
