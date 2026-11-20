import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  EyeOff,
  Maximize2,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import {
  ATTEMPT_STATUS_LABELS_AR,
  DEFAULT_EXAM_SECURITY_POLICY,
  VIOLATION_LABELS_AR,
  type ExamSecurityPolicy,
  type ExamViolationType,
  type SanitizedExamQuestion,
} from '../shared/examSecurity.ts';
import type { AuthUserSummary } from '../shared/types.ts';

export interface ProtectedExamCardItem {
  id: number;
  subject_id: number;
  title: string;
  exam_type: 'exam' | 'assignment';
  duration_minutes: number;
  total_marks: number;
  due_date: string;
  questionCount?: number;
  antiCheatPolicy?: ExamSecurityPolicy;
  attemptsUsed?: number;
  hasActiveAttempt?: boolean;
  latestIntegrityStatus?: string | null;
  latestViolationCount?: number;
  latestAttemptStatus?: string | null;
  questions: SanitizedExamQuestion[];
  submission: {
    exam_id: number;
    score: number;
    total_marks: number;
    submitted_at: string;
  } | null;
}

interface StudentExamModalProps {
  exam: ProtectedExamCardItem;
  user: AuthUserSummary;
  isPreviewMode?: boolean;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}

type ModalStage = 'pledge' | 'running' | 'completed';

export function StudentExamModal({
  exam,
  user,
  isPreviewMode = false,
  onClose,
  onSubmitted,
}: StudentExamModalProps) {
  const policy: ExamSecurityPolicy = exam.antiCheatPolicy || DEFAULT_EXAM_SECURITY_POLICY;

  const [stage, setStage] = useState<ModalStage>('pledge');
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [attemptNumber, setAttemptNumber] = useState<number>(1);
  const [questions, setQuestions] = useState<SanitizedExamQuestion[]>(exam.questions || []);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(exam.duration_minutes * 60);
  const [violationCount, setViolationCount] = useState(0);
  const [violationBanner, setViolationBanner] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [completionInfo, setCompletionInfo] = useState<{
    score: number;
    totalMarks: number;
    status: string;
    violations: number;
  } | null>(null);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  const stageRef = useRef(stage);
  stageRef.current = stage;

  const attemptIdRef = useRef(attemptId);
  attemptIdRef.current = attemptId;

  const lastViolationTsRef = useRef<number>(0);
  const hadFullscreenRef = useRef<boolean>(false);
  const timeoutSubmittedRef = useRef<boolean>(false);

  const reportViolation = useCallback(
    async (type: ExamViolationType, details = '') => {
      if (isPreviewMode || stageRef.current !== 'running' || !attemptIdRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastViolationTsRef.current < 900) {
        return;
      }
      lastViolationTsRef.current = now;

      try {
        const res = await apiFetch<{
          recorded: boolean;
          violationCount: number;
          maxViolations: number;
          autoSubmitted: boolean;
          submission?: { score: number; total_marks: number };
        }>(`/api/student/exams/attempts/${attemptIdRef.current}/violation`, {
          method: 'POST',
          body: JSON.stringify({
            violationType: type,
            details,
            currentAnswers: answersRef.current,
          }),
        });

        setViolationCount(res.violationCount);
        const label = VIOLATION_LABELS_AR[type] || 'نشاط غير مسموح';
        setViolationBanner(
          `تنبيه نزاهة (${res.violationCount} / ${res.maxViolations}): ${label}`
        );

        if (res.autoSubmitted && res.submission) {
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
          }
          setCompletionInfo({
            score: res.submission.score,
            totalMarks: res.submission.total_marks,
            status: 'auto_submitted_violation',
            violations: res.violationCount,
          });
          setStage('completed');
          onSubmitted(
            `تم إنهاء الاختبار تلقائياً لتجاوز الحد المسموح من المخالفات (${res.violationCount}/${res.maxViolations}).`
          );
        }
      } catch {
        // Silent failure if network hiccup
      }
    },
    [isPreviewMode, onSubmitted]
  );

  const handleSubmitAttempt = useCallback(
    async (isTimeout = false) => {
      if (isPreviewMode) {
        setCompletionInfo({
          score: exam.total_marks,
          totalMarks: exam.total_marks,
          status: 'submitted',
          violations: 0,
        });
        setStage('completed');
        onSubmitted('وضع المعاينة: يتم احتساب الدرجات وحفظها في حساب الطالب الفعلي.');
        return;
      }

      if (!attemptIdRef.current || submitting) return;
      setSubmitting(true);
      setErrorMsg(null);
      try {
        const res = await apiFetch<{
          submission: { score: number; total_marks: number };
          status: string;
          violationCount: number;
        }>(`/api/student/exams/attempts/${attemptIdRef.current}/submit`, {
          method: 'POST',
          body: JSON.stringify({ answers: answersRef.current }),
        });

        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        }

        setCompletionInfo({
          score: res.submission.score,
          totalMarks: res.submission.total_marks,
          status: isTimeout ? 'auto_submitted_timeout' : res.status,
          violations: res.violationCount,
        });
        setStage('completed');
        onSubmitted(
          `تم تسليم الاختبار بنجاح. الدرجة: ${res.submission.score} من ${res.submission.total_marks}`
        );
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'تعذر تسليم الإجابات.');
      } finally {
        setSubmitting(false);
      }
    },
    [exam.total_marks, isPreviewMode, onSubmitted, submitting]
  );

  // Server-synchronized countdown timer while running
  useEffect(() => {
    if (stage !== 'running') return;
    const id = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (!timeoutSubmittedRef.current) {
            timeoutSubmittedRef.current = true;
            void handleSubmitAttempt(true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [stage, handleSubmitAttempt]);

  // Anti-cheat listeners (tab switch, blur, copy/paste/contextmenu, devtools shortcuts, fullscreen)
  useEffect(() => {
    if (stage !== 'running' || isPreviewMode) return;

    const handleVisibilityChange = () => {
      if (policy.detectTabSwitch && document.hidden) {
        void reportViolation('tab_switch', 'أخفى الطالب تبويب الاختبار');
      }
    };

    const handleWindowBlur = () => {
      if (policy.detectTabSwitch) {
        void reportViolation('window_blur', 'غادر الطالب تركيز نافذة الاختبار');
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      if (policy.blockCopyPaste) {
        e.preventDefault();
        void reportViolation('copy_attempt', 'محاولة نسخ نص');
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (policy.blockCopyPaste) {
        e.preventDefault();
        void reportViolation('paste_attempt', 'محاولة لصق نص');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (policy.blockCopyPaste) {
        e.preventDefault();
        void reportViolation('context_menu', 'محاولة فتح قائمة السياق');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if (
        e.key === 'F12' ||
        e.key === 'PrintScreen' ||
        (isCtrlOrMeta && e.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (isCtrlOrMeta && ['u', 's', 'p'].includes(key))
      ) {
        e.preventDefault();
        void reportViolation('devtools_shortcut', `مفتاح محظور: ${e.key}`);
        return;
      }

      if (policy.blockCopyPaste && isCtrlOrMeta && ['c', 'x', 'v', 'a'].includes(key)) {
        e.preventDefault();
        void reportViolation(key === 'v' ? 'paste_attempt' : 'copy_attempt', `اختصار ${e.key}`);
      }
    };

    const handleFullscreenChange = () => {
      const activeFs = Boolean(document.fullscreenElement);
      setIsFullscreen(activeFs);
      if (activeFs) {
        hadFullscreenRef.current = true;
      } else if (policy.requireFullscreen && hadFullscreenRef.current) {
        void reportViolation('fullscreen_exit', 'خروج من وضع ملء الشاشة');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [stage, isPreviewMode, policy, reportViolation]);

  async function handleStartExam() {
    setErrorMsg(null);
    if (isPreviewMode) {
      setQuestions(exam.questions);
      setRemainingSeconds(exam.duration_minutes * 60);
      setStage('running');
      return;
    }

    setStarting(true);
    try {
      if (policy.requireFullscreen && document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen();
          hadFullscreenRef.current = true;
          setIsFullscreen(true);
        } catch {
          // Browsers may deny programmatic fullscreen in some iframe contexts; continue protected
        }
      }

      const res = await apiFetch<{
        attemptId: number;
        attemptNumber: number;
        remainingSeconds: number;
        questions: SanitizedExamQuestion[];
        savedAnswers: Record<string, number>;
        violationCount: number;
      }>(`/api/student/exams/${exam.id}/start`, {
        method: 'POST',
      });

      setAttemptId(res.attemptId);
      setAttemptNumber(res.attemptNumber);
      setQuestions(res.questions);
      setAnswers(res.savedAnswers || {});
      setRemainingSeconds(res.remainingSeconds);
      setViolationCount(res.violationCount || 0);
      setCurrentIdx(0);
      timeoutSubmittedRef.current = false;
      setStage('running');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر بدء الاختبار.');
    } finally {
      setStarting(false);
    }
  }

  async function handleSelectOption(questionId: string, optionIdx: number) {
    const updated = { ...answers, [questionId]: optionIdx };
    setAnswers(updated);

    if (isPreviewMode || !attemptId) return;
    setSavingDraft(true);
    try {
      await apiFetch(`/api/student/exams/attempts/${attemptId}/autosave`, {
        method: 'POST',
        body: JSON.stringify({ answers: updated }),
      });
      setLastSavedLabel('تم الحفظ التلقائي');
    } catch {
      // keep local state even if autosave fails
    } finally {
      setSavingDraft(false);
    }
  }

  function formatTimer(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const displayedQuestions =
    policy.focusSingleQuestion && questions.length > 0
      ? [questions[Math.min(currentIdx, questions.length - 1)]]
      : questions;

  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;
  const watermarkText = `${user.fullName} · ${user.phone} · محاولة #${attemptNumber}`;

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-3 sm:p-5 ${
        stage === 'running' && policy.blockCopyPaste ? 'select-none' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={exam.title}
    >
      <div className="relative bg-white text-slate-900 rounded-2xl border border-slate-200 max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Anti-Screenshot Dynamic Watermark */}
        {stage === 'running' && policy.showWatermark && (
          <div
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-0 overflow-hidden z-10 opacity-[0.06]"
          >
            <div className="grid grid-cols-2 gap-12 -rotate-12 py-10 px-6">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="text-xs font-bold text-slate-900 whitespace-nowrap">
                  {watermarkText}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative z-20 p-5 sm:p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  اختبار محمي بنظام النزاهة
                </span>
                {stage === 'running' && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold tabular-nums ${
                      remainingSeconds <= 120
                        ? 'bg-red-100 text-red-800 border border-red-300'
                        : 'bg-slate-100 text-slate-800 border border-slate-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {formatTimer(remainingSeconds)}
                  </span>
                )}
                {stage === 'running' && policy.detectTabSwitch && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums ${
                      violationCount > 0
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    المخالفات: {violationCount} / {policy.maxViolations}
                  </span>
                )}
              </div>
              <h3 className="text-xl font-bold font-display text-slate-900">{exam.title}</h3>
              <p className="text-xs text-slate-500 tabular-nums">
                الدرجة الكلية: {exam.total_marks} · المدة: {exam.duration_minutes} دقيقة ·{' '}
                {questions.length} أسئلة
              </p>
            </div>

            {stage !== 'running' && (
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق الاختبار"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Stage 1: Pledge & Rules */}
          {stage === 'pledge' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                  ضوابط النزاهة ومكافحة الغش المفعّلة في هذا الاختبار:
                </h4>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
                  {policy.shuffleQuestions && (
                    <li className="p-2.5 rounded-lg bg-white border border-slate-200">
                      • ترتيب الأسئلة والخيارات مخصص عشوائياً لحسابك.
                    </li>
                  )}
                  {policy.detectTabSwitch && (
                    <li className="p-2.5 rounded-lg bg-white border border-slate-200">
                      • يُرصد تبديل علامات التبويب أو مغادرة نافذة الاختبار تلقائياً.
                    </li>
                  )}
                  {policy.blockCopyPaste && (
                    <li className="p-2.5 rounded-lg bg-white border border-slate-200">
                      • النسخ واللصق والزر الأيمن واختصارات الفحص معطّلة.
                    </li>
                  )}
                  {policy.requireFullscreen && (
                    <li className="p-2.5 rounded-lg bg-white border border-slate-200">
                      • يعمل الاختبار في وضع ملء الشاشة المحمي.
                    </li>
                  )}
                  {policy.focusSingleQuestion && (
                    <li className="p-2.5 rounded-lg bg-white border border-slate-200">
                      • يظهر سؤال واحد في كل شاشة مع حفظ تلقائي فوري لإجاباتك.
                    </li>
                  )}
                  {policy.autoSubmitOnViolation && (
                    <li className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
                      • عند بلوغ {policy.maxViolations} مخالفات يتم تسليم الاختبار تلقائياً للخادم.
                    </li>
                  )}
                </ul>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 bg-white p-3.5 rounded-xl border border-slate-200">
                <span>
                  المحاولات المستخدمة:{' '}
                  <strong className="font-tabular text-slate-900">
                    {exam.attemptsUsed ?? 0} / {policy.maxAttempts}
                  </strong>
                </span>
                {exam.submission && (
                  <span className="text-emerald-700 font-semibold tabular-nums">
                    آخر نتيجة مسجلة: {exam.submission.score} / {exam.submission.total_marks}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  تراجع
                </button>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void handleStartExam()}
                  className="px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {starting
                      ? 'جاري تهيئة النسخة المحمية...'
                      : exam.hasActiveAttempt
                        ? 'متابعة المحاولة المفتوحة'
                        : 'أتعهد بالنزاهة — بدء الاختبار الآن'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Stage 2: Protected Active Exam */}
          {stage === 'running' && (
            <div className="space-y-4">
              {violationBanner && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    {violationBanner}
                  </span>
                  <button
                    type="button"
                    onClick={() => setViolationBanner(null)}
                    className="text-[11px] underline cursor-pointer"
                  >
                    إخفاء
                  </button>
                </div>
              )}

              {/* Question Navigator Bar & Fullscreen Prompt */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  {questions.map((q, idx) => {
                    const isAnswered = answers[q.id] !== undefined;
                    const isCurrent = policy.focusSingleQuestion && idx === currentIdx;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => {
                          if (policy.focusSingleQuestion) setCurrentIdx(idx);
                        }}
                        aria-label={`السؤال ${idx + 1}`}
                        className={`w-8 h-8 rounded-lg text-xs font-bold tabular-nums transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-teal-700 text-white'
                            : isAnswered
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-white text-slate-700 border border-slate-300'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-600">
                  {savingDraft ? (
                    <span>جاري الحفظ التلقائي...</span>
                  ) : lastSavedLabel ? (
                    <span className="text-emerald-700 font-semibold">{lastSavedLabel}</span>
                  ) : (
                    <span className="tabular-nums">
                      تمت الإجابة: {answeredCount} / {questions.length}
                    </span>
                  )}
                  {policy.requireFullscreen && !isFullscreen && !isPreviewMode && (
                    <button
                      type="button"
                      onClick={() => {
                        void document.documentElement.requestFullscreen?.().catch(() => {});
                      }}
                      className="px-2.5 py-1 border border-slate-300 bg-white rounded-md font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Maximize2 className="w-3 h-3" />
                      <span>ملء الشاشة</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Questions List (Single focus or full) */}
              <div className="space-y-4">
                {displayedQuestions.map((q) => {
                  const displayNumber = questions.findIndex((item) => item.id === q.id) + 1;
                  return (
                    <div
                      key={q.id}
                      className="p-4 rounded-xl border border-slate-200 bg-white space-y-3"
                    >
                      <p className="font-bold text-sm sm:text-base text-slate-900 leading-relaxed">
                        {displayNumber}. {q.prompt}{' '}
                        <span className="text-xs font-semibold text-slate-500 tabular-nums">
                          ({q.marks} درجات)
                        </span>
                      </p>
                      <div className="space-y-2">
                        {q.options.map((opt, optIdx) => {
                          const selected = answers[q.id] === optIdx;
                          return (
                            <label
                              key={optIdx}
                              className={`flex items-center gap-3 text-sm p-3 rounded-lg border transition-colors cursor-pointer ${
                                selected
                                  ? 'border-teal-600 bg-teal-50/70 text-teal-950 font-semibold'
                                  : 'border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`exam_q_${q.id}`}
                                checked={selected}
                                onChange={() => void handleSelectOption(q.id, optIdx)}
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Navigation & Submit Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  {policy.focusSingleQuestion && questions.length > 1 && (
                    <>
                      <button
                        type="button"
                        disabled={currentIdx === 0}
                        onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                        className="px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                      >
                        السؤال السابق
                      </button>
                      <button
                        type="button"
                        disabled={currentIdx >= questions.length - 1}
                        onClick={() =>
                          setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))
                        }
                        className="px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                      >
                        السؤال التالي
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                    <EyeOff className="w-3.5 h-3.5" />
                    مراقبة النزاهة نشطة
                  </span>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleSubmitAttempt(false)}
                    className="px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    {submitting ? 'جاري التسليم...' : 'اعتماد وتسليم الإجابات'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stage 3: Completed / Auto-Submitted Result */}
          {stage === 'completed' && completionInfo && (
            <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-4">
              {completionInfo.status === 'auto_submitted_violation' ? (
                <ShieldAlert className="w-12 h-12 mx-auto text-red-600" />
              ) : (
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
              )}

              <div className="space-y-1">
                <h4 className="text-lg font-bold text-slate-900">
                  {ATTEMPT_STATUS_LABELS_AR[
                    completionInfo.status as keyof typeof ATTEMPT_STATUS_LABELS_AR
                  ] || 'تم إغلاق الاختبار'}
                </h4>
                {policy.showResultImmediately ? (
                  <p className="text-2xl font-bold text-teal-800 font-tabular pt-1">
                    الدرجة المحققة: {completionInfo.score} / {completionInfo.totalMarks}
                  </p>
                ) : (
                  <p className="text-xs text-slate-600">
                    تم حفظ إجاباتك وستُعلن النتيجة بعد مراجعة المشرف العام.
                  </p>
                )}
                <p className="text-xs text-slate-500 tabular-nums">
                  إجمالي المخالفات المرصودة خلال المحاولة: {completionInfo.violations}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                العودة إلى بوابة الطالب
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
