import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Lightbulb,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import {
  ANTI_CHEAT_STRATEGIES_GUIDE,
  ATTEMPT_STATUS_LABELS_AR,
  DEFAULT_EXAM_SECURITY_POLICY,
  INTEGRITY_STATUS_LABELS_AR,
  VIOLATION_LABELS_AR,
  type ExamSecurityPolicy,
} from '../shared/examSecurity.ts';

interface SubjectItem {
  id: number;
  title: string;
  code: string;
}

interface AdminExamRecord {
  id: number;
  subject_id: number;
  title: string;
  exam_type: 'exam' | 'assignment';
  duration_minutes: number;
  total_marks: number;
  due_date: string;
  questionCount: number;
  is_active: boolean;
  antiCheatPolicy: ExamSecurityPolicy;
  stats: {
    totalAttempts: number;
    flaggedAttempts: number;
    avgScore: number | null;
  };
}

interface AdminAttemptRecord {
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
  submitted_at: string | null;
  student_name: string;
  student_phone: string;
  group_name: string | null;
  exam_title: string;
  violations: Array<{
    id: number;
    violationType: string;
    details: string;
    createdAt: string;
  }>;
}

interface DraftQuestion {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: number;
  marks: number;
}

type ExamsSubTab = 'bank' | 'monitor' | 'ideas';

function makeEmptyQuestion(): DraftQuestion {
  return {
    prompt: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    marks: 5,
  };
}

export function AdminExamsPanel() {
  const [subTab, setSubTab] = useState<ExamsSubTab>('bank');
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [exams, setExams] = useState<AdminExamRecord[]>([]);
  const [attempts, setAttempts] = useState<AdminAttemptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Create New Exam Modal / Inline Builder State
  const [showBuilder, setShowBuilder] = useState(false);
  const [subjectId, setSubjectId] = useState(0);
  const [title, setTitle] = useState('');
  const [examType, setExamType] = useState<'exam' | 'assignment'>('exam');
  const [durationMinutes, setDurationMinutes] = useState(25);
  const [dueDate, setDueDate] = useState('2026-12-30');
  const [questions, setQuestions] = useState<DraftQuestion[]>([makeEmptyQuestion()]);
  const [newPolicy, setNewPolicy] = useState<ExamSecurityPolicy>({
    ...DEFAULT_EXAM_SECURITY_POLICY,
  });
  const [savingExam, setSavingExam] = useState(false);

  // Edit Existing Exam Policy State
  const [editingExam, setEditingExam] = useState<AdminExamRecord | null>(null);
  const [editPolicy, setEditPolicy] = useState<ExamSecurityPolicy>({
    ...DEFAULT_EXAM_SECURITY_POLICY,
  });

  // Expanded Violations Row
  const [expandedAttemptId, setExpandedAttemptId] = useState<number | null>(null);

  async function loadExamsData() {
    setLoading(true);
    try {
      const res = await apiFetch<{
        subjects: SubjectItem[];
        exams: AdminExamRecord[];
        attempts: AdminAttemptRecord[];
      }>('/api/admin/exams');
      setSubjects(res.subjects);
      setExams(res.exams);
      setAttempts(res.attempts);
      if (res.subjects.length > 0) {
        setSubjectId((prev) => prev || res.subjects[0].id);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل بيانات الاختبارات.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExamsData();
  }, []);

  async function handleCreateExam(e: FormEvent) {
    e.preventDefault();
    setSavingExam(true);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/exams', {
        method: 'POST',
        body: JSON.stringify({
          subjectId,
          title,
          examType,
          durationMinutes,
          dueDate,
          questions,
          antiCheatPolicy: newPolicy,
        }),
      });
      setTitle('');
      setQuestions([makeEmptyQuestion()]);
      setShowBuilder(false);
      setFeedback({
        type: 'success',
        text: 'تم إنشاء الاختبار المحمي وتفعيل قواعد مكافحة الغش بنجاح.',
      });
      await loadExamsData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إنشاء الاختبار.',
      });
    } finally {
      setSavingExam(false);
    }
  }

  async function handleSaveEditedPolicy() {
    if (!editingExam) return;
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/exams/${editingExam.id}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({ antiCheatPolicy: editPolicy }),
      });
      setEditingExam(null);
      setFeedback({
        type: 'success',
        text: `تم تحديث سياسات الحماية ومكافحة الغش للاختبار "${editingExam.title}".`,
      });
      await loadExamsData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث سياسة الحماية.',
      });
    }
  }

  async function handleDeleteExam(exam: AdminExamRecord) {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/exams/${exam.id}`, { method: 'DELETE' });
      setFeedback({ type: 'success', text: `تم حذف الاختبار "${exam.title}".` });
      await loadExamsData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف الاختبار.',
      });
    }
  }

  async function handleGrantRetake(attempt: AdminAttemptRecord) {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/exams/attempts/${attempt.id}/allow-retake`, {
        method: 'POST',
      });
      setFeedback({
        type: 'success',
        text: `تم منح الطالب "${attempt.student_name}" فرصة إعادة المحاولة وتوثيق ذلك في السجل.`,
      });
      await loadExamsData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر منح إعادة المحاولة.',
      });
    }
  }

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const flaggedCount = attempts.filter(
    (a) => a.integrity_status === 'flagged' || a.status === 'auto_submitted_violation'
  ).length;
  const cleanCount = attempts.filter((a) => a.integrity_status === 'clean').length;

  function renderPolicyToggles(
    policy: ExamSecurityPolicy,
    onChange: (next: ExamSecurityPolicy) => void
  ) {
    const boolControls: Array<{ key: keyof ExamSecurityPolicy; label: string }> = [
      { key: 'shuffleQuestions', label: 'خلط ترتيب الأسئلة عشوائياً لكل طالب' },
      { key: 'shuffleOptions', label: 'خلط ترتيب الخيارات (أ، ب، ج، د) لكل سؤال' },
      { key: 'detectTabSwitch', label: 'رصد تبديل التبويبات ومغادرة النافذة' },
      { key: 'blockCopyPaste', label: 'تعطيل النسخ واللصق والزر الأيمن و F12' },
      { key: 'requireFullscreen', label: 'إلزام وضع ملء الشاشة المحمي' },
      { key: 'focusSingleQuestion', label: 'عرض سؤال واحد في كل شاشة (منع تصوير الورقة)' },
      { key: 'showWatermark', label: 'علامة مائية شفافة باسم وهاتف الطالب' },
      { key: 'autoSubmitOnViolation', label: 'تسليم تلقائي فوري عند بلوغ حد المخالفات' },
      { key: 'showResultImmediately', label: 'عرض الدرجة للطالب فور التسليم' },
    ];

    return (
      <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {boolControls.map((ctrl) => (
            <label
              key={ctrl.key}
              className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(policy[ctrl.key])}
                onChange={(e) => onChange({ ...policy, [ctrl.key]: e.target.checked })}
              />
              <span>{ctrl.label}</span>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              الحد الأقصى للمخالفات قبل التسليم التلقائي
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={policy.maxViolations}
              onChange={(e) =>
                onChange({
                  ...policy,
                  maxViolations: Math.min(10, Math.max(1, Number(e.target.value) || 3)),
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-tabular"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              الحد الأقصى لعدد المحاولات لكل طالب
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={policy.maxAttempts}
              onChange={(e) =>
                onChange({
                  ...policy,
                  maxAttempts: Math.min(10, Math.max(1, Number(e.target.value) || 2)),
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-tabular"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Sub-tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-700" />
            <span>نظام الاختبارات ومراقبة النزاهة ومكافحة الغش</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إعداد اختبارات اللغة العربية للثانية باكالوريا مع التوزيع العشوائي، تتبع تبديل التبويبات،
            منع النسخ، والعلامة المائية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('bank')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'bank'
                ? 'bg-teal-700 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>الاختبارات والحماية ({exams.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('monitor')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'monitor'
                ? 'bg-teal-700 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>غرفة المراقبة والمخالفات ({attempts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ideas')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'ideas'
                ? 'bg-teal-700 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Lightbulb className="w-4 h-4" />
            <span>أفكار مقاومة الغش</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Tab 1: Exams Bank & Builder */}
      {subTab === 'bank' && (
        <div className="space-y-5">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowBuilder((prev) => !prev)}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{showBuilder ? 'إغلاق نموذج الإنشاء' : 'إنشاء اختبار محمي جديد'}</span>
            </button>
          </div>

          {showBuilder && (
            <form
              onSubmit={handleCreateExam}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-5"
            >
              <h3 className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-3">
                إنشاء اختبار أو فرض جديد مع ضوابط مكافحة الغش
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label
                    htmlFor="new-exam-title"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    عنوان الاختبار
                  </label>
                  <input
                    id="new-exam-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="مثال: فرض محروس في تكسير البنية وتجديد الرؤيا"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-exam-subject"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    المكوّن العربي
                  </label>
                  <select
                    id="new-exam-subject"
                    value={subjectId}
                    onChange={(e) => setSubjectId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-exam-type"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    التصنيف
                  </label>
                  <select
                    id="new-exam-type"
                    value={examType}
                    onChange={(e) => setExamType(e.target.value as 'exam' | 'assignment')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="exam">فرض تقييمي مراقب</option>
                    <option value="assignment">واجب منزلي تطبيقي</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="new-exam-duration"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    المدة الرسمية (بالدقائق)
                  </label>
                  <input
                    id="new-exam-duration"
                    type="number"
                    min={5}
                    max={240}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-tabular"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-exam-due"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    آخر موعد للتقديم
                  </label>
                  <input
                    id="new-exam-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-tabular"
                  />
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-900 mb-2">
                  إعدادات الحماية ومكافحة الغش لهذا الاختبار:
                </h4>
                {renderPolicyToggles(newPolicy, setNewPolicy)}
              </div>

              {/* Questions Builder */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900">
                    أسئلة الاختبار ({questions.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => setQuestions((prev) => [...prev, makeEmptyQuestion()])}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    + إضافة سؤال
                  </button>
                </div>

                {questions.map((q, qIdx) => (
                  <div
                    key={qIdx}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-teal-800">
                        السؤال رقم {qIdx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-slate-600">النقطة:</label>
                        <input
                          type="number"
                          min={1}
                          max={40}
                          value={q.marks}
                          onChange={(e) => {
                            const next = [...questions];
                            next[qIdx] = { ...next[qIdx], marks: Number(e.target.value) || 5 };
                            setQuestions(next);
                          }}
                          className="w-16 px-2 py-1 border border-slate-300 rounded-md text-xs bg-white font-tabular"
                        />
                        {questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setQuestions((prev) => prev.filter((_, idx) => idx !== qIdx))
                            }
                            aria-label={`حذف السؤال ${qIdx + 1}`}
                            className="p-1 text-red-700 hover:bg-red-50 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <input
                      type="text"
                      required
                      value={q.prompt}
                      onChange={(e) => {
                        const next = [...questions];
                        next[qIdx] = { ...next[qIdx], prompt: e.target.value };
                        setQuestions(next);
                      }}
                      placeholder={`اكتب نص السؤال رقم ${qIdx + 1}...`}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.options.map((opt, optIdx) => (
                        <div
                          key={optIdx}
                          className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200"
                        >
                          <input
                            type="radio"
                            name={`correct_${qIdx}`}
                            checked={q.correctIndex === optIdx}
                            onChange={() => {
                              const next = [...questions];
                              next[qIdx] = { ...next[qIdx], correctIndex: optIdx };
                              setQuestions(next);
                            }}
                            aria-label={`تحديد الخيار ${optIdx + 1} كإجابة صحيحة للسؤال ${qIdx + 1}`}
                          />
                          <input
                            type="text"
                            required={optIdx < 2}
                            value={opt}
                            onChange={(e) => {
                              const next = [...questions];
                              const optsCopy = [...next[qIdx].options] as [
                                string,
                                string,
                                string,
                                string,
                              ];
                              optsCopy[optIdx] = e.target.value;
                              next[qIdx] = { ...next[qIdx], options: optsCopy };
                              setQuestions(next);
                            }}
                            placeholder={`الخيار ${optIdx + 1}${optIdx >= 2 ? ' (اختياري)' : ''}`}
                            className="w-full text-xs focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingExam}
                  className="px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  {savingExam ? 'جاري النشر...' : 'اعتماد ونشر الاختبار المحمي'}
                </button>
              </div>
            </form>
          )}

          {/* Edit Policy Modal / Inline Drawer */}
          {editingExam && (
            <div className="bg-white border-2 border-teal-600 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 className="font-bold text-sm text-slate-900">
                  تعديل ضوابط مكافحة الغش: {editingExam.title}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingExam(null)}
                  className="text-xs text-slate-500 hover:underline cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
              {renderPolicyToggles(editPolicy, setEditPolicy)}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingExam(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEditedPolicy()}
                  className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  حفظ سياسة الحماية
                </button>
              </div>
            </div>
          )}

          {/* Exams List */}
          {loading ? (
            <p className="text-xs text-slate-500 py-8 text-center">جاري تحميل الاختبارات...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {exams.map((exam) => {
                const sub = subjectById.get(exam.subject_id);
                const p = exam.antiCheatPolicy;
                return (
                  <div
                    key={exam.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>
                          {exam.exam_type === 'exam' ? 'فرض تقييمي' : 'واجب منزلي'} ·{' '}
                          {sub?.title || 'اللغة العربية'}
                        </span>
                        <span className="font-tabular">
                          {exam.duration_minutes} د · {exam.total_marks} درجة
                        </span>
                      </div>
                      <h3 className="font-bold text-base text-slate-900">{exam.title}</h3>
                      <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                        {p.shuffleQuestions && (
                          <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                            خلط الأسئلة
                          </span>
                        )}
                        {p.shuffleOptions && (
                          <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                            خلط الخيارات
                          </span>
                        )}
                        {p.detectTabSwitch && (
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            رصد التبويبات ({p.maxViolations} حد أقصى)
                          </span>
                        )}
                        {p.blockCopyPaste && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            منع النسخ
                          </span>
                        )}
                        {p.showWatermark && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            علامة مائية
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-600 tabular-nums">
                        المحاولات: <strong>{exam.stats.totalAttempts}</strong> · مرصودة:{' '}
                        <strong
                          className={
                            exam.stats.flaggedAttempts > 0 ? 'text-red-700' : 'text-emerald-700'
                          }
                        >
                          {exam.stats.flaggedAttempts}
                        </strong>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingExam(exam);
                            setEditPolicy({ ...exam.antiCheatPolicy });
                          }}
                          className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>ضبط الحماية</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteExam(exam)}
                          aria-label={`حذف اختبار ${exam.title}`}
                          className="p-1.5 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Live Proctoring & Violations Monitor */}
      {subTab === 'monitor' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">إجمالي المحاولات المسجلة</div>
              <div className="text-2xl font-bold text-slate-900 font-tabular mt-1">
                {attempts.length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">محاولات سليمة (نزاهة ١٠٠٪)</div>
              <div className="text-2xl font-bold text-emerald-700 font-tabular mt-1">
                {cleanCount}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">محاولات مرصودة بمخالفات</div>
              <div className="text-2xl font-bold text-red-700 font-tabular mt-1">
                {flaggedCount}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {attempts.length === 0 ? (
              <p className="text-xs text-slate-500 py-10 text-center">
                لم يبدأ الطلاب أي محاولات اختبار بعد. ستظهر تقارير النزاهة والمخالفات هنا فور بدء
                أي طالب.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {attempts.map((att) => {
                  const isExpanded = expandedAttemptId === att.id;
                  return (
                    <div key={att.id} className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">
                              {att.student_name}
                            </span>
                            <span className="text-xs text-slate-500 font-tabular" dir="ltr">
                              {att.student_phone}
                            </span>
                            {att.group_name && (
                              <span className="text-[11px] text-slate-500">· {att.group_name}</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600">
                            {att.exam_title} (المحاولة #{att.attempt_number})
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
                              att.integrity_status === 'flagged'
                                ? 'bg-red-50 text-red-800 border border-red-200'
                                : att.integrity_status === 'warning'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {INTEGRITY_STATUS_LABELS_AR[
                              att.integrity_status as keyof typeof INTEGRITY_STATUS_LABELS_AR
                            ] || att.integrity_status}
                          </span>
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 text-[11px] font-semibold tabular-nums">
                            المخالفات: {att.violation_count}
                          </span>
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 text-[11px] font-semibold tabular-nums">
                            {att.score !== null ? `${att.score} / ${att.total_marks}` : 'قيد الحل'}
                          </span>
                          <span className="text-[11px] text-slate-600">
                            {ATTEMPT_STATUS_LABELS_AR[
                              att.status as keyof typeof ATTEMPT_STATUS_LABELS_AR
                            ] || att.status}
                          </span>

                          {att.violations.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedAttemptId(isExpanded ? null : att.id)
                              }
                              className="px-2.5 py-1 border border-slate-300 rounded-lg text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              {isExpanded ? 'إخفاء التفاصيل' : 'عرض سجل المخالفات'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleGrantRetake(att)}
                            className="px-2.5 py-1 border border-teal-300 text-teal-800 hover:bg-teal-50 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>منح إعادة محاولة</span>
                          </button>
                        </div>
                      </div>

                      {isExpanded && att.violations.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                          <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-red-700" />
                            <span>التسلسل الزمني للمخالفات المرصودة:</span>
                          </div>
                          {att.violations.map((v) => (
                            <div
                              key={v.id}
                              className="text-[11px] text-slate-700 flex items-center justify-between gap-2 bg-white px-3 py-1.5 rounded border border-slate-200"
                            >
                              <span>
                                {VIOLATION_LABELS_AR[
                                  v.violationType as keyof typeof VIOLATION_LABELS_AR
                                ] || v.violationType}
                                {v.details ? ` — ${v.details}` : ''}
                              </span>
                              <span className="font-tabular text-slate-500">
                                {new Date(v.createdAt).toLocaleTimeString('ar-SA')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Anti-Cheating Strategies & Best Practices Showcase */}
      {subTab === 'ideas' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ANTI_CHEAT_STRATEGIES_GUIDE.map((item) => (
              <div
                key={item.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                    {item.badge}
                  </span>
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                </div>
                <h3 className="font-bold text-sm text-slate-900">{item.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{item.summary}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <h3 className="font-bold text-sm text-slate-900">
              أفكار تربوية إضافية خاصة بامتحان اللغة العربية (الثانية باكالوريا):
            </h3>
            <ul className="text-xs text-slate-700 space-y-1.5 leading-relaxed">
              <li>
                • <strong>تنويع الشواهد الشعرية</strong>: اعتمد أكثر من نموذج اختباري لنفس المجزوءة
                (مثلاً قصيدة للشابي وأخرى لجبران في سؤال الذات) وخصّصها عبر تبويب الصلاحيات.
              </li>
              <li>
                • <strong>تضييق زمن الأسئلة الموضوعية السريعة</strong>: اجعل مدة الاختبار القصير
                متناسبة مع عدد الأسئلة بحيث لا يجد الطالب فائضاً زمنياً للبحث في مصادر خارجية.
              </li>
              <li>
                • <strong>المراجعة الشفوية الانتقائية</strong>: عند ظهور حالة «مشتبه به» في غرفة
                المراقبة، اطلب من الطالب مناقشة تبريره المنهجي لنفس السؤال شفوياً قبل اعتماد النقطة.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
