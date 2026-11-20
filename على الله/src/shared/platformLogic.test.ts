import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTERFACE_CONFIG,
  INTERFACE_TEMPLATES,
  addSectionToConfig,
  cloneInterfaceConfig,
  normalizeInterfaceConfig,
  reorderOrderedItems,
  resolveStudentInterface,
} from './interfaceResolver';
import {
  canAccessResource,
  evaluateOtpChallengeState,
  evaluateOtpResendCooldown,
  isValidPhoneNumber,
  maskPhoneNumber,
  normalizePhoneNumber,
} from './otpPolicy';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  formatArabicFileSize,
  validateUploadMetadata,
} from './uploadPolicy';
import {
  DEFAULT_EXAM_SECURITY_POLICY,
  buildStudentExamVariant,
  evaluateViolationTransition,
  scoreAttemptAnswers,
  type CanonicalExamQuestion,
} from './examSecurity';
import type { InterfaceAssignmentRecord, PermissionRule } from './types';

function makeAssignment(
  overrides: Partial<InterfaceAssignmentRecord>
): InterfaceAssignmentRecord {
  const cfg = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  return {
    id: 1,
    interfaceId: 100,
    interfaceName: 'واجهة افتراضية',
    level: 'default',
    targetType: 'default',
    targetId: null,
    priority: 10,
    isActive: true,
    config: cfg,
    ...overrides,
  };
}

test('Interface priority strictly enforces Individual > Group > Default', () => {
  const defaultConfig = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  defaultConfig.brandTitle = 'الواجهة الافتراضية';

  const groupConfig = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  groupConfig.brandTitle = 'واجهة المجموعة العلمية';

  const individualConfig = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  individualConfig.brandTitle = 'واجهة الطالب المخصصة';

  const assignments: InterfaceAssignmentRecord[] = [
    makeAssignment({
      id: 1,
      interfaceId: 1,
      interfaceName: 'الافتراضية',
      level: 'default',
      targetType: 'default',
      priority: 10,
      config: defaultConfig,
    }),
    makeAssignment({
      id: 2,
      interfaceId: 2,
      interfaceName: 'المجموعة',
      level: 'group',
      targetType: 'group',
      targetId: 5,
      priority: 20,
      config: groupConfig,
    }),
    makeAssignment({
      id: 3,
      interfaceId: 3,
      interfaceName: 'الفردية',
      level: 'individual',
      targetType: 'student',
      targetId: 42,
      priority: 30,
      config: individualConfig,
    }),
  ];

  // Student 42 has individual override -> gets Individual
  const resIndividual = resolveStudentInterface({
    studentId: 42,
    groupId: 5,
    assignments,
  });
  assert.equal(resIndividual.sourceLevel, 'individual');
  assert.equal(resIndividual.config.brandTitle, 'واجهة الطالب المخصصة');

  // Student 99 in group 5 without individual override -> gets Group
  const resGroup = resolveStudentInterface({
    studentId: 99,
    groupId: 5,
    assignments,
  });
  assert.equal(resGroup.sourceLevel, 'group');
  assert.equal(resGroup.config.brandTitle, 'واجهة المجموعة العلمية');

  // Student 77 in group 8 without group/individual override -> gets Default
  const resDefault = resolveStudentInterface({
    studentId: 77,
    groupId: 8,
    assignments,
  });
  assert.equal(resDefault.sourceLevel, 'default');
  assert.equal(resDefault.config.brandTitle, 'الواجهة الافتراضية');
});

test('Future exclusive account isolation skips group interface and supports independent template', () => {
  const groupConfig = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  groupConfig.brandTitle = 'واجهة المجموعة';

  const exclusiveConfig = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  exclusiveConfig.brandTitle = 'الواجهة المستقلة الحصرية';

  const assignments: InterfaceAssignmentRecord[] = [
    makeAssignment({
      id: 1,
      interfaceId: 1,
      level: 'default',
      targetType: 'default',
      priority: 10,
    }),
    makeAssignment({
      id: 2,
      interfaceId: 2,
      level: 'group',
      targetType: 'group',
      targetId: 5,
      priority: 20,
      config: groupConfig,
    }),
    makeAssignment({
      id: 3,
      interfaceId: 9,
      level: 'exclusive_template',
      targetType: 'student',
      targetId: 777,
      priority: 40,
      config: exclusiveConfig,
    }),
  ];

  const resolved = resolveStudentInterface({
    studentId: 777,
    groupId: 5,
    accountTier: 'exclusive_reserved',
    exclusiveIsolation: true,
    assignments,
  });

  assert.equal(resolved.sourceLevel, 'exclusive_template');
  assert.equal(resolved.exclusiveIsolated, true);
  assert.equal(resolved.config.brandTitle, 'الواجهة المستقلة الحصرية');
});

test('Section reordering and adding sections maintains contiguous order', () => {
  const cfg = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  const reordered = reorderOrderedItems(cfg.sections, 0, 2);
  assert.equal(reordered[2].id, cfg.sections[0].id);
  reordered.forEach((sec, idx) => {
    assert.equal(sec.order, idx + 1);
  });

  const withExtra = addSectionToConfig(cfg, 'study_schedule');
  assert.equal(withExtra.sections.length, cfg.sections.length + 1);
  assert.equal(
    withExtra.sections[withExtra.sections.length - 1].type,
    'study_schedule'
  );
});

test('Phone normalization handles Arabic numerals and validation', () => {
  assert.equal(normalizePhoneNumber('٠٥٥ ١٢٣-٤٥٦٧'), '0551234567');
  assert.equal(isValidPhoneNumber('٠٥٥١٢٣٤٥٦٧'), true);
  assert.equal(isValidPhoneNumber('123'), false);
  assert.equal(maskPhoneNumber('0551234567'), '05*****567');
});

test('OTP security policy enforces single-use, expiration, max attempts, and resend cooldown', () => {
  const now = 1_000_000;
  assert.equal(
    evaluateOtpChallengeState(
      {
        expiresAtMs: now + 60_000,
        resendAvailableAtMs: now,
        consumedAtMs: null,
        attempts: 0,
        maxAttempts: 5,
      },
      now
    ).allowed,
    true
  );

  assert.equal(
    evaluateOtpChallengeState(
      {
        expiresAtMs: now + 60_000,
        resendAvailableAtMs: now,
        consumedAtMs: now - 1000,
        attempts: 1,
        maxAttempts: 5,
      },
      now
    ).reasonCode,
    'ALREADY_CONSUMED'
  );

  assert.equal(
    evaluateOtpChallengeState(
      {
        expiresAtMs: now - 1,
        resendAvailableAtMs: now,
        consumedAtMs: null,
        attempts: 1,
        maxAttempts: 5,
      },
      now
    ).reasonCode,
    'EXPIRED'
  );

  assert.equal(
    evaluateOtpChallengeState(
      {
        expiresAtMs: now + 60_000,
        resendAvailableAtMs: now,
        consumedAtMs: null,
        attempts: 5,
        maxAttempts: 5,
      },
      now
    ).reasonCode,
    'MAX_ATTEMPTS_EXCEEDED'
  );

  const cooldownBlocked = evaluateOtpResendCooldown(now + 45_000, now);
  assert.equal(cooldownBlocked.allowed, false);
  assert.equal(cooldownBlocked.waitSeconds, 45);
});

test('Backend permission evaluation enforces Student > Group > Default and isolates exclusive accounts', () => {
  const rules: PermissionRule[] = [
    {
      targetType: 'group',
      targetId: 3,
      resourceType: 'exam',
      resourceId: 10,
      isAllowed: false,
    },
    {
      targetType: 'student',
      targetId: 12,
      resourceType: 'exam',
      resourceId: 10,
      isAllowed: true,
    },
  ];

  // Student 12 has explicit override allowing exam 10 despite group deny
  const allowOverride = canAccessResource({
    context: {
      studentId: 12,
      groupId: 3,
      accountTier: 'standard',
      exclusiveIsolation: false,
    },
    resourceType: 'exam',
    resourceId: 10,
    rules,
  });
  assert.equal(allowOverride.allowed, true);
  assert.equal(allowOverride.source, 'student_rule');

  // Student 15 in group 3 inherits deny
  const groupDeny = canAccessResource({
    context: {
      studentId: 15,
      groupId: 3,
      accountTier: 'standard',
      exclusiveIsolation: false,
    },
    resourceType: 'exam',
    resourceId: 10,
    rules,
  });
  assert.equal(groupDeny.allowed, false);
  assert.equal(groupDeny.source, 'group_rule');

  // Future isolated exclusive student denied by default unless explicitly granted
  const exclusiveDenied = canAccessResource({
    context: {
      studentId: 888,
      groupId: 3,
      accountTier: 'exclusive_reserved',
      exclusiveIsolation: true,
    },
    resourceType: 'subject',
    resourceId: 1,
    rules,
  });
  assert.equal(exclusiveDenied.allowed, false);
  assert.equal(exclusiveDenied.source, 'exclusive_deny');
});

test('Interface normalization stays backward-compatible and templates apply Arabic styles', () => {
  const partialLegacy = normalizeInterfaceConfig({
    brandTitle: 'منصة مخصصة',
    layout: {
      borderRadius: 'soft',
      density: 'spacious',
      backgroundPattern: 'warm_paper',
      iconStyle: 'classic',
    } as typeof DEFAULT_INTERFACE_CONFIG.layout,
  });

  assert.equal(partialLegacy.brandTitle, 'منصة مخصصة');
  assert.equal(partialLegacy.gradeLabel, 'الصف الثاني باكالوريا');
  assert.equal(partialLegacy.layout.layoutStyle, 'literary_folio');
  assert.equal(partialLegacy.layout.heroAlignment, 'split');

  const simpleTemplate = INTERFACE_TEMPLATES.find((t) => t.id === 'simple_calm');
  assert.ok(simpleTemplate);
  const applied = simpleTemplate.apply(partialLegacy);
  assert.equal(applied.showHeroImage, false);
  assert.equal(applied.layout.layoutStyle, 'minimal_clean');
  assert.equal(applied.layout.heroAlignment, 'minimal');

  const diwanTemplate = INTERFACE_TEMPLATES.find((t) => t.id === 'literary_diwan');
  assert.ok(diwanTemplate);
  const diwanApplied = diwanTemplate.apply(partialLegacy);
  assert.equal(diwanApplied.typography.headingFont, 'Amiri');
  assert.equal(diwanApplied.typography.fontFamily, 'Noto Naskh Arabic');
  assert.equal(diwanApplied.showArabicQuote, true);
});

test('Upload policy allows up to 100 GB educational files, enforces extension allowlist, and formats Arabic sizes', () => {
  const hundredGb = 100 * 1024 * 1024 * 1024;
  assert.equal(MAX_UPLOAD_BYTES, hundredGb);
  assert.equal(UPLOAD_CHUNK_BYTES, 4 * 1024 * 1024);

  const validVideo = validateUploadMetadata({
    fileName: 'درس_تكسير_البنية.mp4',
    totalSizeBytes: hundredGb,
  });
  assert.equal(validVideo.valid, true);
  assert.equal(validVideo.ext, '.mp4');

  const validArchive = validateUploadMetadata({
    fileName: 'ملخصات_البكالوريا.zip',
    totalSizeBytes: 5 * 1024 * 1024 * 1024,
  });
  assert.equal(validArchive.valid, true);

  const overLimit = validateUploadMetadata({
    fileName: 'ملف_ضخم.mp4',
    totalSizeBytes: hundredGb + 1,
  });
  assert.equal(overLimit.valid, false);
  assert.ok(overLimit.errorAr?.includes('١٠٠ جيجابايت'));

  const disallowedExt = validateUploadMetadata({
    fileName: 'script.exe',
    totalSizeBytes: 1024,
  });
  assert.equal(disallowedExt.valid, false);

  assert.equal(formatArabicFileSize(5 * 1024), '5 كيلوبايت');
  assert.equal(formatArabicFileSize(12 * 1024 * 1024), '12.0 ميجابايت');
  assert.equal(formatArabicFileSize(hundredGb), '100.0 جيجابايت');
});

test('Anti-cheat exam variant shuffles per student and grades shuffled answers accurately', () => {
  const questions: CanonicalExamQuestion[] = [
    {
      id: 'q1',
      prompt: 'سؤال ١',
      options: ['خ١', 'خ٢_صحيح', 'خ٣', 'خ٤'],
      correctIndex: 1,
      marks: 5,
    },
    {
      id: 'q2',
      prompt: 'سؤال ٢',
      options: ['أ_صحيح', 'ب', 'ج', 'د'],
      correctIndex: 0,
      marks: 10,
    },
    {
      id: 'q3',
      prompt: 'سؤال ٣',
      options: ['١', '٢', '٣_صحيح', '٤'],
      correctIndex: 2,
      marks: 5,
    },
  ];

  const variantA = buildStudentExamVariant({
    examId: 10,
    studentId: 101,
    attemptNumber: 1,
    questions,
    policy: DEFAULT_EXAM_SECURITY_POLICY,
  });

  const variantB = buildStudentExamVariant({
    examId: 10,
    studentId: 202,
    attemptNumber: 1,
    questions,
    policy: DEFAULT_EXAM_SECURITY_POLICY,
  });

  // Ensure both variants preserve all questions and deterministic per-student permutation differs
  assert.equal(variantA.presentedQuestions.length, 3);
  assert.equal(variantB.presentedQuestions.length, 3);
  const sameAllOrders =
    JSON.stringify(variantA.questionOrder) === JSON.stringify(variantB.questionOrder) &&
    JSON.stringify(variantA.optionOrders) === JSON.stringify(variantB.optionOrders);
  assert.equal(sameAllOrders, false);

  // Pick the exact displayed indices corresponding to each canonical correctIndex in variantA
  const displayedAnswers: Record<string, number> = {};
  for (const canonicalQ of questions) {
    const displayedIdx = variantA.optionOrders[canonicalQ.id].indexOf(canonicalQ.correctIndex);
    assert.ok(displayedIdx >= 0);
    displayedAnswers[canonicalQ.id] = displayedIdx;
  }

  const graded = scoreAttemptAnswers({
    questions,
    optionOrders: variantA.optionOrders,
    displayedAnswers,
  });
  assert.equal(graded.score, 20);
  assert.equal(graded.totalMarks, 20);
  assert.equal(graded.correctCount, 3);
});

test('Anti-cheat violation transition flags and auto-submits at configured threshold', () => {
  const policy = {
    ...DEFAULT_EXAM_SECURITY_POLICY,
    maxViolations: 3,
    autoSubmitOnViolation: true,
  };

  const first = evaluateViolationTransition({ currentViolations: 0, policy });
  assert.equal(first.nextViolations, 1);
  assert.equal(first.integrityStatus, 'warning');
  assert.equal(first.shouldAutoSubmit, false);

  const third = evaluateViolationTransition({ currentViolations: 2, policy });
  assert.equal(third.nextViolations, 3);
  assert.equal(third.integrityStatus, 'flagged');
  assert.equal(third.shouldAutoSubmit, true);
});
