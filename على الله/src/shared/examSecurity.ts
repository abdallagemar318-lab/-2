export type ExamViolationType =
  | 'tab_switch'
  | 'window_blur'
  | 'copy_attempt'
  | 'paste_attempt'
  | 'context_menu'
  | 'fullscreen_exit'
  | 'devtools_shortcut'
  | 'time_expired';

export type ExamAttemptStatus =
  | 'in_progress'
  | 'submitted'
  | 'auto_submitted_violation'
  | 'auto_submitted_timeout';

export type ExamIntegrityStatus = 'clean' | 'warning' | 'flagged';

export interface ExamSecurityPolicy {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  requireFullscreen: boolean;
  blockCopyPaste: boolean;
  detectTabSwitch: boolean;
  focusSingleQuestion: boolean;
  showWatermark: boolean;
  maxViolations: number;
  autoSubmitOnViolation: boolean;
  maxAttempts: number;
  showResultImmediately: boolean;
}

export const DEFAULT_EXAM_SECURITY_POLICY: ExamSecurityPolicy = {
  shuffleQuestions: true,
  shuffleOptions: true,
  requireFullscreen: true,
  blockCopyPaste: true,
  detectTabSwitch: true,
  focusSingleQuestion: true,
  showWatermark: true,
  maxViolations: 3,
  autoSubmitOnViolation: true,
  maxAttempts: 2,
  showResultImmediately: true,
};

export interface CanonicalExamQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  marks: number;
}

export interface SanitizedExamQuestion {
  id: string;
  prompt: string;
  options: string[];
  marks: number;
}

export const VIOLATION_LABELS_AR: Record<ExamViolationType, string> = {
  tab_switch: 'تبديل علامة التبويب أو إخفاء الصفحة',
  window_blur: 'الخروج من تركيز نافذة الاختبار',
  copy_attempt: 'محاولة نسخ نص السؤال',
  paste_attempt: 'محاولة لصق محتوى خارجي',
  context_menu: 'محاولة فتح القائمة المختصرة (الزر الأيمن)',
  fullscreen_exit: 'الخروج من وضع ملء الشاشة المحمي',
  devtools_shortcut: 'استخدام اختصار محظور أو أدوات المطور',
  time_expired: 'انتهاء الوقت الرسمي المحدد للاختبار',
};

export const ATTEMPT_STATUS_LABELS_AR: Record<ExamAttemptStatus, string> = {
  in_progress: 'قيد الإنجاز',
  submitted: 'مكتمل ومسلّم',
  auto_submitted_violation: 'تسليم تلقائي لتجاوز المخالفات',
  auto_submitted_timeout: 'تسليم تلقائي لانتهاء الوقت',
};

export const INTEGRITY_STATUS_LABELS_AR: Record<ExamIntegrityStatus, string> = {
  clean: 'سليم (نزاهة كاملة)',
  warning: 'تنبيهات محدودة',
  flagged: 'مشتبه به / مرصود',
};

export const ANTI_CHEAT_STRATEGIES_GUIDE = [
  {
    id: 'server_clock',
    title: 'توقيت خادم موحّد غير قابل للتلاعب',
    badge: 'حماية زمنية',
    summary:
      'يُحسب وقت البدء والانتهاء على الخادم مباشرة (`expires_at`)، ولا يُعتد بأي إجابات تُرسل بعد انتهاء المدة مهما عدّل الطالب ساعة جهازه.',
  },
  {
    id: 'dynamic_shuffle',
    title: 'خلط الأسئلة وترتيب الخيارات لكل طالب',
    badge: 'توزيع فردي',
    summary:
      'يتم توليد نسخة بترتيب أسئلة وخيارات مختلفة لكل طالب ومحاولة عبر بذرة عشوائية مرتبطة بحسابه، بحيث لا يتطابق «أ، ب، ج، د» بين طالبين.',
  },
  {
    id: 'single_focus',
    title: 'نمط السؤال الفردي مع الحفظ التلقائي',
    badge: 'منع التسريب',
    summary:
      'عرض سؤال واحد في كل شاشة مع حفظ تلقائي فوري في الخادم، مما يمنع التقاط الاختبار كاملاً في لقطة شاشة واحدة ويحمي مجهود الطالب.',
  },
  {
    id: 'focus_fullscreen',
    title: 'إلزام ملء الشاشة ومراقبة تبديل التبويبات',
    badge: 'مراقبة النشاط',
    summary:
      'رصد مغادرة النافذة أو تبديل علامة التبويب أو الخروج من وضع ملء الشاشة فوراً وتسجيلها في سجل المخالفات مع تسليم تلقائي عند تجاوز الحد.',
  },
  {
    id: 'input_lock',
    title: 'تعطيل النسخ واللصق والزر الأيمن واختصارات المطور',
    badge: 'تأمين المتصفح',
    summary:
      'منع تحديد النصوص أو نسخها (`Ctrl+C`) أو فتح قائمة السياق أو أدوات الفحص (`F12`) أثناء الاختبار للحد من البحث السريع عن الإجابات.',
  },
  {
    id: 'watermark',
    title: 'علامة مائية ديناميكية ببيانات الطالب',
    badge: 'تتبع التسريب',
    summary:
      'إظهار طبقة شفافة مائلة تحمل اسم الطالب ورقم هاتفه ومعرّف المحاولة فوق الأسئلة لردع تصوير الشاشة بالهاتف أو مشاركة الأسئلة.',
  },
];

export function normalizeExamSecurityPolicy(raw: unknown): ExamSecurityPolicy {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<ExamSecurityPolicy>;
  const clampInt = (val: unknown, fallback: number, min: number, max: number) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  return {
    shuffleQuestions:
      typeof input.shuffleQuestions === 'boolean'
        ? input.shuffleQuestions
        : DEFAULT_EXAM_SECURITY_POLICY.shuffleQuestions,
    shuffleOptions:
      typeof input.shuffleOptions === 'boolean'
        ? input.shuffleOptions
        : DEFAULT_EXAM_SECURITY_POLICY.shuffleOptions,
    requireFullscreen:
      typeof input.requireFullscreen === 'boolean'
        ? input.requireFullscreen
        : DEFAULT_EXAM_SECURITY_POLICY.requireFullscreen,
    blockCopyPaste:
      typeof input.blockCopyPaste === 'boolean'
        ? input.blockCopyPaste
        : DEFAULT_EXAM_SECURITY_POLICY.blockCopyPaste,
    detectTabSwitch:
      typeof input.detectTabSwitch === 'boolean'
        ? input.detectTabSwitch
        : DEFAULT_EXAM_SECURITY_POLICY.detectTabSwitch,
    focusSingleQuestion:
      typeof input.focusSingleQuestion === 'boolean'
        ? input.focusSingleQuestion
        : DEFAULT_EXAM_SECURITY_POLICY.focusSingleQuestion,
    showWatermark:
      typeof input.showWatermark === 'boolean'
        ? input.showWatermark
        : DEFAULT_EXAM_SECURITY_POLICY.showWatermark,
    maxViolations: clampInt(input.maxViolations, DEFAULT_EXAM_SECURITY_POLICY.maxViolations, 1, 10),
    autoSubmitOnViolation:
      typeof input.autoSubmitOnViolation === 'boolean'
        ? input.autoSubmitOnViolation
        : DEFAULT_EXAM_SECURITY_POLICY.autoSubmitOnViolation,
    maxAttempts: clampInt(input.maxAttempts, DEFAULT_EXAM_SECURITY_POLICY.maxAttempts, 1, 10),
    showResultImmediately:
      typeof input.showResultImmediately === 'boolean'
        ? input.showResultImmediately
        : DEFAULT_EXAM_SECURITY_POLICY.showResultImmediately,
  };
}

export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeAttemptSeed(params: {
  examId: number;
  studentId: number;
  attemptNumber: number;
}): number {
  return (
    Math.imul(params.examId + 17, 2654435761) ^
    Math.imul(params.studentId + 31, 2246822519) ^
    Math.imul(params.attemptNumber + 7, 3266489917)
  ) >>> 0;
}

export function shuffleIndices(length: number, rng: () => number): number[] {
  const arr = Array.from({ length }, (_, idx) => idx);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function buildStudentExamVariant(params: {
  examId: number;
  studentId: number;
  attemptNumber: number;
  questions: CanonicalExamQuestion[];
  policy: ExamSecurityPolicy;
}): {
  questionOrder: string[];
  optionOrders: Record<string, number[]>;
  presentedQuestions: SanitizedExamQuestion[];
} {
  const rng = createSeededRng(
    computeAttemptSeed({
      examId: params.examId,
      studentId: params.studentId,
      attemptNumber: params.attemptNumber,
    })
  );

  const qIndices = params.policy.shuffleQuestions
    ? shuffleIndices(params.questions.length, rng)
    : Array.from({ length: params.questions.length }, (_, idx) => idx);

  const questionOrder: string[] = [];
  const optionOrders: Record<string, number[]> = {};
  const presentedQuestions: SanitizedExamQuestion[] = [];

  for (const qIdx of qIndices) {
    const q = params.questions[qIdx];
    questionOrder.push(q.id);

    const optOrder = params.policy.shuffleOptions
      ? shuffleIndices(q.options.length, rng)
      : Array.from({ length: q.options.length }, (_, idx) => idx);
    optionOrders[q.id] = optOrder;

    presentedQuestions.push({
      id: q.id,
      prompt: q.prompt,
      options: optOrder.map((origIdx) => q.options[origIdx]),
      marks: q.marks,
    });
  }

  return { questionOrder, optionOrders, presentedQuestions };
}

export function presentStoredExamVariant(params: {
  questions: CanonicalExamQuestion[];
  questionOrder: string[];
  optionOrders: Record<string, number[]>;
}): SanitizedExamQuestion[] {
  const byId = new Map(params.questions.map((q) => [q.id, q]));
  const result: SanitizedExamQuestion[] = [];

  for (const qId of params.questionOrder) {
    const q = byId.get(qId);
    if (!q) continue;
    const order =
      Array.isArray(params.optionOrders[q.id]) &&
      params.optionOrders[q.id].length === q.options.length
        ? params.optionOrders[q.id]
        : Array.from({ length: q.options.length }, (_, i) => i);

    result.push({
      id: q.id,
      prompt: q.prompt,
      options: order.map((origIdx) => q.options[origIdx]),
      marks: q.marks,
    });
  }

  return result;
}

export function scoreAttemptAnswers(params: {
  questions: CanonicalExamQuestion[];
  optionOrders: Record<string, number[]>;
  displayedAnswers: Record<string, number>;
}): {
  score: number;
  totalMarks: number;
  correctCount: number;
  canonicalAnswers: Record<string, number>;
} {
  let score = 0;
  let totalMarks = 0;
  let correctCount = 0;
  const canonicalAnswers: Record<string, number> = {};

  for (const q of params.questions) {
    totalMarks += q.marks;
    const rawChoice = params.displayedAnswers[q.id];
    if (rawChoice === undefined || rawChoice === null) {
      continue;
    }
    const displayedIdx = Number(rawChoice);
    if (!Number.isInteger(displayedIdx) || displayedIdx < 0) {
      continue;
    }

    const order = params.optionOrders[q.id];
    const canonicalIdx =
      Array.isArray(order) && displayedIdx < order.length ? order[displayedIdx] : displayedIdx;
    canonicalAnswers[q.id] = canonicalIdx;

    if (canonicalIdx === q.correctIndex) {
      score += q.marks;
      correctCount += 1;
    }
  }

  return { score, totalMarks, correctCount, canonicalAnswers };
}

export function evaluateViolationTransition(params: {
  currentViolations: number;
  policy: ExamSecurityPolicy;
}): {
  nextViolations: number;
  integrityStatus: ExamIntegrityStatus;
  shouldAutoSubmit: boolean;
} {
  const nextViolations = params.currentViolations + 1;
  const reachedLimit = nextViolations >= params.policy.maxViolations;
  const integrityStatus: ExamIntegrityStatus = reachedLimit ? 'flagged' : 'warning';
  const shouldAutoSubmit = params.policy.autoSubmitOnViolation && reachedLimit;
  return {
    nextViolations,
    integrityStatus,
    shouldAutoSubmit,
  };
}
