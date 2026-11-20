import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  GripVertical,
  History,
  Monitor,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  Layers,
  Menu,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import {
  ARABIC_COVER_IMAGES,
  CURATED_ARABIC_QUOTES,
  INTERFACE_TEMPLATES,
  PALETTE_PRESETS,
  SECTION_CATALOG,
  addNavItemToConfig,
  addSectionToConfig,
  cloneInterfaceConfig,
  reorderOrderedItems,
} from '../shared/interfaceResolver.ts';
import type {
  ArabicFontFamily,
  AuthUserSummary,
  BackgroundPattern,
  ButtonStyle,
  CardStyle,
  HeroAlignment,
  InterfaceConfig,
  LayoutStyle,
  SectionType,
} from '../shared/types.ts';
import { StudentPortal, type StudentWorkspacePayload } from './StudentPortal.tsx';

interface AdminStudentLite {
  id: number;
  fullName: string;
  phone: string;
  groupId: number | null;
  groupName: string | null;
  accountTier: 'standard' | 'exclusive_reserved';
  exclusiveIsolation: boolean;
  effectiveInterface: {
    sourceLevel: string;
    interfaceId: number;
    interfaceName: string;
  };
}

interface AdminGroupLite {
  id: number;
  name: string;
}

interface VersionRecord {
  id: number;
  version_number: number;
  change_summary: string;
  action_type: 'draft_save' | 'publish' | 'rollback';
  author_name: string | null;
  created_at: string;
}

interface VisualInterfaceEditorProps {
  adminUser: AuthUserSummary;
  initialStudentId?: number | null;
}

type EditorTab = 'theme' | 'typography' | 'sections' | 'navigation' | 'versions';

export function VisualInterfaceEditor({
  adminUser,
  initialStudentId = null,
}: VisualInterfaceEditorProps) {
  const [targetType, setTargetType] = useState<'default' | 'group' | 'student'>(
    initialStudentId ? 'student' : 'default'
  );
  const [selectedGroupId, setSelectedGroupId] = useState<number>(1);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(
    initialStudentId
  );

  const [students, setStudents] = useState<AdminStudentLite[]>([]);
  const [groups, setGroups] = useState<AdminGroupLite[]>([]);
  const [contentPreview, setContentPreview] = useState<
    StudentWorkspacePayload['content'] | null
  >(null);

  const [interfaceId, setInterfaceId] = useState<number | null>(null);
  const [interfaceName, setInterfaceName] = useState('');
  const [interfaceStatus, setInterfaceStatus] = useState<'draft' | 'published'>('published');
  const [draftConfig, setDraftConfig] = useState<InterfaceConfig>(
    cloneInterfaceConfig(INTERFACE_TEMPLATES[1].apply(INTERFACE_TEMPLATES[0].apply({
      brandTitle: 'منصة بيان للغة العربية',
      gradeLabel: 'الصف الثاني باكالوريا',
      welcomeHeadline: 'مرحباً بك في رحاب اللغة العربية',
      welcomeSubtitle: 'مساحة مخصصة لطلبة الثانية باكالوريا.',
      heroImageUrl: ARABIC_COVER_IMAGES[0].url,
      showHeroImage: true,
      showArabicQuote: true,
      arabicQuoteText: CURATED_ARABIC_QUOTES[0].text,
      arabicQuoteAuthor: CURATED_ARABIC_QUOTES[0].author,
      theme: { ...PALETTE_PRESETS[0].theme },
      typography: { fontFamily: 'IBM Plex Sans Arabic', headingFont: 'Cairo', scale: 'standard' },
      layout: {
        borderRadius: 'balanced',
        density: 'standard',
        backgroundPattern: 'warm_paper',
        iconStyle: 'academic',
        layoutStyle: 'literary_folio',
        heroAlignment: 'split',
        cardStyle: 'bordered',
        buttonStyle: 'filled',
      },
      navigation: [],
      sections: [],
    })))
  );
  const [versions, setVersions] = useState<VersionRecord[]>([]);

  const [activeTab, setActiveTab] = useState<EditorTab>('theme');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [dragSectionIndex, setDragSectionIndex] = useState<number | null>(null);
  const [dragNavIndex, setDragNavIndex] = useState<number | null>(null);
  const [newSectionType, setNewSectionType] = useState<SectionType>('study_schedule');
  const [changeSummary, setChangeSummary] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{ students: AdminStudentLite[] }>('/api/admin/students'),
      apiFetch<{ groups: AdminGroupLite[] }>('/api/admin/groups'),
      apiFetch<{
        subjects: StudentWorkspacePayload['content']['subjects'];
        lessons: StudentWorkspacePayload['content']['lessons'];
        documents: StudentWorkspacePayload['content']['documents'];
        exams: Array<{
          id: number;
          subject_id: number;
          title: string;
          exam_type: 'exam' | 'assignment';
          duration_minutes: number;
          total_marks: number;
          due_date: string;
        }>;
        tools: StudentWorkspacePayload['content']['tools'];
        announcements: StudentWorkspacePayload['content']['announcements'];
      }>('/api/admin/content'),
    ])
      .then(([stuRes, grpRes, cntRes]) => {
        if (!active) return;
        setStudents(stuRes.students);
        setGroups(grpRes.groups);
        if (grpRes.groups.length > 0) {
          setSelectedGroupId((prev) =>
            grpRes.groups.some((g) => g.id === prev) ? prev : grpRes.groups[0].id
          );
        }
        if (!selectedStudentId && stuRes.students.length > 0) {
          setSelectedStudentId(stuRes.students[0].id);
        }
        setContentPreview({
          subjects: cntRes.subjects,
          lessons: cntRes.lessons,
          documents: cntRes.documents,
          exams: cntRes.exams.map((e) => ({
            ...e,
            questions: [],
            submission: null,
          })),
          tools: cntRes.tools,
          announcements: cntRes.announcements,
        });
      })
      .catch((err: Error) => {
        if (active) {
          setStatusBanner({ type: 'error', text: err.message });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialStudentId) {
      setTargetType('student');
      setSelectedStudentId(initialStudentId);
    }
  }, [initialStudentId]);

  useEffect(() => {
    const targetId =
      targetType === 'default'
        ? null
        : targetType === 'group'
          ? selectedGroupId
          : selectedStudentId;

    if (targetType !== 'default' && !targetId) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setStatusBanner(null);

    apiFetch<{
      interfaceRecord: {
        id: number;
        name: string;
        status: 'draft' | 'published';
        draftConfig: InterfaceConfig;
      };
    }>('/api/admin/interfaces/target', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId }),
    })
      .then(async (res) => {
        if (!active) return;
        setInterfaceId(res.interfaceRecord.id);
        setInterfaceName(res.interfaceRecord.name);
        setInterfaceStatus(res.interfaceRecord.status);
        setDraftConfig(res.interfaceRecord.draftConfig);

        const verRes = await apiFetch<{ versions: VersionRecord[] }>(
          `/api/admin/interfaces/${res.interfaceRecord.id}/versions`
        );
        if (active) {
          setVersions(verRes.versions);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setStatusBanner({ type: 'error', text: err.message });
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [targetType, selectedGroupId, selectedStudentId]);

  async function reloadVersions(id: number) {
    const verRes = await apiFetch<{ versions: VersionRecord[] }>(
      `/api/admin/interfaces/${id}/versions`
    );
    setVersions(verRes.versions);
  }

  async function handleSaveDraft() {
    if (!interfaceId) return;
    setSaving(true);
    setStatusBanner(null);
    try {
      await apiFetch(`/api/admin/interfaces/${interfaceId}/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          name: interfaceName,
          config: draftConfig,
          changeSummary: changeSummary || 'حفظ مسودة تعديلات مرئية',
        }),
      });
      setInterfaceStatus('draft');
      setChangeSummary('');
      await reloadVersions(interfaceId);
      setStatusBanner({ type: 'success', text: 'تم حفظ المسودة في سجل الإصدارات بنجاح.' });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ المسودة.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!interfaceId) return;
    setSaving(true);
    setStatusBanner(null);
    try {
      await apiFetch(`/api/admin/interfaces/${interfaceId}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          name: interfaceName,
          config: draftConfig,
          changeSummary: changeSummary || 'نشر واعتماد الواجهة للطلاب المستهدفين',
        }),
      });
      setInterfaceStatus('published');
      setChangeSummary('');
      await reloadVersions(interfaceId);
      setStatusBanner({
        type: 'success',
        text: 'تم نشر الواجهة واعتمادها بنجاح. ستظهر فوراً للحسابات المستهدفة.',
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر نشر الواجهة.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRollback(versionId: number) {
    if (!interfaceId) return;
    setSaving(true);
    setStatusBanner(null);
    try {
      const res = await apiFetch<{ config: InterfaceConfig }>(
        `/api/admin/interfaces/${interfaceId}/rollback`,
        {
          method: 'POST',
          body: JSON.stringify({ versionId }),
        }
      );
      setDraftConfig(res.config);
      setInterfaceStatus('published');
      await reloadVersions(interfaceId);
      setStatusBanner({
        type: 'success',
        text: 'تمت استعادة الإصدار السابق ونشره بنجاح.',
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر استعادة الإصدار.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveOverride() {
    const targetId =
      targetType === 'group' ? selectedGroupId : selectedStudentId;
    if (targetType === 'default' || !targetId) return;
    setSaving(true);
    try {
      await apiFetch(
        `/api/admin/interfaces/assignment/${targetType}/${targetId}`,
        { method: 'DELETE' }
      );
      setStatusBanner({
        type: 'success',
        text: 'تم إلغاء التخصيص المباشر؛ سيرث الحساب الآن الواجهة الأعلى في الأولوية تلقائياً.',
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إلغاء التخصيص.',
      });
    } finally {
      setSaving(false);
    }
  }

  const previewUser: AuthUserSummary =
    targetType === 'student' && selectedStudentId
      ? (() => {
          const s = students.find((st) => st.id === selectedStudentId);
          return s
            ? {
                id: s.id,
                fullName: s.fullName,
                phone: s.phone,
                role: 'student',
                status: 'active',
                groupId: s.groupId,
                groupName: s.groupName,
                accountTier: s.accountTier,
                exclusiveIsolation: s.exclusiveIsolation,
                lastLoginAt: null,
              }
            : adminUser;
        })()
      : {
          ...adminUser,
          fullName:
            targetType === 'group'
              ? `طالب في ${groups.find((g) => g.id === selectedGroupId)?.name || 'المجموعة'}`
              : 'نموذج طالب افتراضي',
          groupName:
            targetType === 'group'
              ? groups.find((g) => g.id === selectedGroupId)?.name || null
              : null,
        };

  const previewWorkspace: StudentWorkspacePayload = {
    resolvedInterface: {
      sourceLevel:
        targetType === 'default'
          ? 'default'
          : targetType === 'group'
            ? 'group'
            : 'individual',
      interfaceId: interfaceId || 0,
      interfaceName: interfaceName || 'معاينة',
      priorityApplied: targetType === 'student' ? 30 : targetType === 'group' ? 20 : 10,
      exclusiveIsolated: false,
      config: draftConfig,
    },
    content: contentPreview || {
      subjects: [],
      lessons: [],
      documents: [],
      exams: [],
      tools: [],
      announcements: [],
    },
  };

  return (
    <div className="space-y-5">
      {/* Target Scope & Priority Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 font-display">
              محرر الواجهات المرئي المخصص
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              أولوية التطبيق المعتمدة: واجهة فردية &gt; واجهة المجموعة &gt; الواجهة الافتراضية
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving || !interfaceId}
              onClick={handleSaveDraft}
              className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span>حفظ مسودة</span>
            </button>
            <button
              type="button"
              disabled={saving || !interfaceId}
              onClick={handlePublish}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>نشر واعتماد</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-3 border-t border-slate-200">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              مستوى التخصيص المستهدف
            </label>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'default', label: 'الافتراضية' },
                  { id: 'group', label: 'مجموعة' },
                  { id: 'student', label: 'طالب محدد' },
                ] as const
              ).map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => setTargetType(lvl.id)}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    targetType === lvl.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>

          {targetType === 'group' && (
            <div className="md:col-span-4">
              <label
                htmlFor="editor-group-select"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                اختر المجموعة الدراسية
              </label>
              <select
                id="editor-group-select"
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetType === 'student' && (
            <div className="md:col-span-4">
              <label
                htmlFor="editor-student-select"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                اختر حساب الطالب
              </label>
              {students.length === 0 ? (
                <div className="text-xs text-amber-700 py-2">
                  لا يوجد طلاب مسجلون بعد. أنشئ طالباً من تبويب إدارة الطلاب أولاً.
                </div>
              ) : (
                <select
                  id="editor-student-select"
                  value={selectedStudentId ?? ''}
                  onChange={(e) => setSelectedStudentId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.phone})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="md:col-span-4 flex items-center justify-between gap-3">
            <div className="flex-1">
              <label
                htmlFor="editor-change-summary"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                ملاحظة الإصدار (اختياري)
              </label>
              <input
                id="editor-change-summary"
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="مثال: تعديل الألوان وترتيب الدروس"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            {targetType !== 'default' && (
              <button
                type="button"
                onClick={handleRemoveOverride}
                className="mt-5 px-3 py-2 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap"
              >
                إلغاء التخصيص
              </button>
            )}
          </div>
        </div>

        {statusBanner && (
          <div
            role="status"
            className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusBanner.text}</span>
          </div>
        )}
      </div>

      {/* Editor Two-Zone Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Studio Controls */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="border-b border-slate-200 p-2 flex flex-wrap gap-1 bg-slate-50">
            {(
              [
                { id: 'theme', label: 'الألوان والهوية', icon: Palette },
                { id: 'typography', label: 'الخطوط والخلفية', icon: Type },
                { id: 'sections', label: 'الأقسام والترتيب', icon: Layers },
                { id: 'navigation', label: 'القوائم', icon: Menu },
                { id: 'versions', label: 'الإصدارات', icon: History },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white text-teal-800 border border-slate-200 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-5 max-h-[680px] overflow-y-auto space-y-5">
            {loading ? (
              <div className="py-12 text-center text-sm text-slate-500">
                جاري تحميل إعدادات الواجهة...
              </div>
            ) : activeTab === 'theme' ? (
              <div className="space-y-5">
                {/* One-click Creative Interface Templates */}
                <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <Sparkles className="w-4 h-4 text-amber-700" />
                    <span>قوالب إبداعية جاهزة للغة العربية (نقرة واحدة)</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {INTERFACE_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setDraftConfig((prev) => tpl.apply(prev))}
                        className="p-2.5 bg-white border border-amber-200 hover:border-teal-600 rounded-lg text-right cursor-pointer transition-colors"
                      >
                        <div className="text-xs font-bold text-slate-900">{tpl.nameAr}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{tpl.descriptionAr}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      عنوان المنصة في الواجهة
                    </label>
                    <input
                      type="text"
                      value={draftConfig.brandTitle}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          brandTitle: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      الوسم الدراسي الموحّد
                    </label>
                    <input
                      type="text"
                      value={draftConfig.gradeLabel}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          gradeLabel: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    عنوان الترحيب الرئيسي
                  </label>
                  <input
                    type="text"
                    value={draftConfig.welcomeHeadline}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        welcomeHeadline: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    الوصف الترحيبي للطالب
                  </label>
                  <textarea
                    rows={2}
                    value={draftConfig.welcomeSubtitle}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        welcomeSubtitle: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>

                {/* Arabic Literary Verse / Quote Banner */}
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      بيت شعري أو حكمة عربية معبرة
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          showArabicQuote: !prev.showArabicQuote,
                        }))
                      }
                      className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        draftConfig.showArabicQuote
                          ? 'bg-teal-700 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {draftConfig.showArabicQuote ? 'مفعل' : 'مخفي'}
                    </button>
                  </div>
                  {draftConfig.showArabicQuote && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {CURATED_ARABIC_QUOTES.map((q, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                arabicQuoteText: q.text,
                                arabicQuoteAuthor: q.author,
                              }))
                            }
                            className="px-2 py-1 bg-white border border-slate-300 hover:border-teal-600 rounded text-[11px] font-medium text-slate-700 cursor-pointer"
                          >
                            {q.author}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={draftConfig.arabicQuoteText}
                        onChange={(e) =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            arabicQuoteText: e.target.value,
                          }))
                        }
                        placeholder="نص البيت الشعري (استخدم ** للفصل بين الشطرين)"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                      />
                      <input
                        type="text"
                        value={draftConfig.arabicQuoteAuthor}
                        onChange={(e) =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            arabicQuoteAuthor: e.target.value,
                          }))
                        }
                        placeholder="القائل أو الشاعر"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-xs font-semibold text-slate-700">
                    عرض صورة الغلاف العربية في قسم الترحيب
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        showHeroImage: !prev.showHeroImage,
                      }))
                    }
                    className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                      draftConfig.showHeroImage
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {draftConfig.showHeroImage ? 'مفعل' : 'مخفي'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    صورة الغلاف الأدبية
                  </label>
                  <select
                    value={draftConfig.heroImageUrl}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        heroImageUrl: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    {ARABIC_COVER_IMAGES.map((img) => (
                      <option key={img.url} value={img.url}>
                        {img.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-slate-700">
                    ألواح الألوان العربية المستوحاة من التراث والبيان
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PALETTE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            theme: { ...preset.theme },
                          }))
                        }
                        className="p-2.5 border border-slate-200 hover:border-teal-600 rounded-lg text-right flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            {preset.nameAr}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {preset.descriptionAr}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-slate-300"
                            style={{ backgroundColor: preset.theme.backgroundColor }}
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-full"
                            style={{ backgroundColor: preset.theme.primaryColor }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                  {(
                    [
                      { key: 'primaryColor', label: 'اللون الرئيسي' },
                      { key: 'secondaryColor', label: 'اللون الثانوي' },
                      { key: 'backgroundColor', label: 'خلفية الصفحة' },
                      { key: 'surfaceColor', label: 'لون البطاقات' },
                      { key: 'textColor', label: 'لون النص الأساسي' },
                      { key: 'borderColor', label: 'لون الحدود' },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-2 p-2 border border-slate-200 rounded-lg text-xs"
                    >
                      <span className="text-slate-700 font-medium">{item.label}</span>
                      <input
                        type="color"
                        value={draftConfig.theme[item.key]}
                        onChange={(e) =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            theme: { ...prev.theme, [item.key]: e.target.value },
                          }))
                        }
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : activeTab === 'typography' ? (
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    خط النصوص العربية الأساسي
                  </label>
                  <select
                    value={draftConfig.typography.fontFamily}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        typography: {
                          ...prev.typography,
                          fontFamily: e.target.value as ArabicFontFamily,
                        },
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="IBM Plex Sans Arabic">IBM Plex Sans Arabic (واضح وأكاديمي)</option>
                    <option value="Noto Naskh Arabic">Noto Naskh Arabic (نسخ عربي كلاسيكي للقراءة)</option>
                    <option value="Amiri">Amiri (خط أميري أدبي تراثي)</option>
                    <option value="Readex Pro">Readex Pro (عصري مرن)</option>
                    <option value="Cairo">Cairo (عصري واضح)</option>
                    <option value="Tajawal">Tajawal (خفيف ومرتب)</option>
                    <option value="Almarai">Almarai (مكثف للقراءة)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    خط العناوين والشعر العربي
                  </label>
                  <select
                    value={draftConfig.typography.headingFont}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        typography: {
                          ...prev.typography,
                          headingFont: e.target.value as ArabicFontFamily,
                        },
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="Amiri">Amiri (خط أميري شعري مهيب)</option>
                    <option value="Noto Naskh Arabic">Noto Naskh Arabic (خط النسخ العربي)</option>
                    <option value="Cairo">Cairo (حديث واضح)</option>
                    <option value="Readex Pro">Readex Pro (هندسي متوازن)</option>
                    <option value="IBM Plex Sans Arabic">IBM Plex Sans Arabic</option>
                    <option value="Tajawal">Tajawal</option>
                    <option value="Almarai">Almarai</option>
                  </select>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    أسلوب التخطيط العام للواجهة
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'minimal_clean', label: 'بسيط وهادئ' },
                        { id: 'literary_folio', label: 'ديوان أدبي' },
                        { id: 'modern_cards', label: 'بطاقات حديثة' },
                      ] as const
                    ).map((ls) => (
                      <button
                        key={ls.id}
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            layout: {
                              ...prev.layout,
                              layoutStyle: ls.id as LayoutStyle,
                            },
                          }))
                        }
                        className={`py-2 px-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                          draftConfig.layout.layoutStyle === ls.id
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {ls.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    محاذاة لوحة الترحيب
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'split', label: 'مقسم مع صورة' },
                        { id: 'centered', label: 'مركزي متماثل' },
                        { id: 'minimal', label: 'شريط مبسط' },
                      ] as const
                    ).map((ha) => (
                      <button
                        key={ha.id}
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            layout: {
                              ...prev.layout,
                              heroAlignment: ha.id as HeroAlignment,
                            },
                          }))
                        }
                        className={`py-2 px-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                          draftConfig.layout.heroAlignment === ha.id
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {ha.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      نمط البطاقات
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: 'bordered', label: 'محددة' },
                          { id: 'soft_surface', label: 'ناعمة' },
                          { id: 'elevated', label: 'بارزة' },
                        ] as const
                      ).map((cs) => (
                        <button
                          key={cs.id}
                          type="button"
                          onClick={() =>
                            setDraftConfig((prev) => ({
                              ...prev,
                              layout: { ...prev.layout, cardStyle: cs.id as CardStyle },
                            }))
                          }
                          className={`py-1.5 rounded text-[11px] font-semibold border cursor-pointer ${
                            draftConfig.layout.cardStyle === cs.id
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {cs.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      شكل الأزرار
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          { id: 'filled', label: 'ممتلئ' },
                          { id: 'outline', label: 'مفرغ بإطار' },
                        ] as const
                      ).map((bs) => (
                        <button
                          key={bs.id}
                          type="button"
                          onClick={() =>
                            setDraftConfig((prev) => ({
                              ...prev,
                              layout: { ...prev.layout, buttonStyle: bs.id as ButtonStyle },
                            }))
                          }
                          className={`py-1.5 rounded text-[11px] font-semibold border cursor-pointer ${
                            draftConfig.layout.buttonStyle === bs.id
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {bs.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    حجم النصوص والتباعد
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'compact', label: 'مضغوط' },
                        { id: 'standard', label: 'قياسي' },
                        { id: 'comfortable', label: 'مريح' },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            typography: { ...prev.typography, scale: s.id },
                          }))
                        }
                        className={`py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                          draftConfig.typography.scale === s.id
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    زخرفة ونمط خلفية المنصة
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'solid', label: 'خلفية صافية بسيطة' },
                        { id: 'warm_paper', label: 'ورق مخطوطات دافئ' },
                        { id: 'arabesque_subtle', label: 'نقش هندسي عربي هادئ' },
                        { id: 'calligraphy_lines', label: 'سطور دفتر الخط العربي' },
                        { id: 'night_slate', label: 'توهج أمسيات هادئ' },
                      ] as const
                    ).map((bg) => (
                      <button
                        key={bg.id}
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            layout: {
                              ...prev.layout,
                              backgroundPattern: bg.id as BackgroundPattern,
                            },
                          }))
                        }
                        className={`py-2 px-3 rounded-lg text-xs font-semibold border cursor-pointer ${
                          draftConfig.layout.backgroundPattern === bg.id
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {bg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    استدارة البطاقات والعناصر
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'sharp', label: 'حادة' },
                        { id: 'balanced', label: 'متوازنة' },
                        { id: 'soft', label: 'ناعمة' },
                      ] as const
                    ).map((rad) => (
                      <button
                        key={rad.id}
                        type="button"
                        onClick={() =>
                          setDraftConfig((prev) => ({
                            ...prev,
                            layout: { ...prev.layout, borderRadius: rad.id },
                          }))
                        }
                        className={`py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                          draftConfig.layout.borderRadius === rad.id
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {rad.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTab === 'sections' ? (
              <div className="space-y-4">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <span className="block text-xs font-semibold text-slate-700">
                    إضافة قسم جديد من مكتبة المكونات
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={newSectionType}
                      onChange={(e) => setNewSectionType(e.target.value as SectionType)}
                      className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      {SECTION_CATALOG.map((item) => (
                        <option key={item.type} value={item.type}>
                          {item.defaultTitle}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftConfig((prev) => addSectionToConfig(prev, newSectionType))
                      }
                      className="px-3 py-1.5 bg-teal-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة</span>
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  اسحب الأقسام لإعادة ترتيبها أو استخدم أزرار التحريك، ويمكنك إخفاء أو تعديل عنوان أي قسم.
                </p>

                <div className="space-y-2.5">
                  {draftConfig.sections.map((sec, idx) => (
                    <div
                      key={sec.id}
                      draggable
                      onDragStart={() => setDragSectionIndex(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragSectionIndex !== null) {
                          setDraftConfig((prev) => ({
                            ...prev,
                            sections: reorderOrderedItems(
                              prev.sections,
                              dragSectionIndex,
                              idx
                            ),
                          }));
                          setDragSectionIndex(null);
                        }
                      }}
                      className={`p-3 rounded-lg border space-y-2.5 transition-colors ${
                        sec.visible
                          ? 'bg-white border-slate-200'
                          : 'bg-slate-50 border-slate-200 opacity-70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-slate-400 cursor-grab shrink-0" />
                          <span className="text-xs font-bold text-slate-900">
                            {idx + 1}. {sec.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`تحريك قسم ${sec.title} للأعلى`}
                            disabled={idx === 0}
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                sections: reorderOrderedItems(prev.sections, idx, idx - 1),
                              }))
                            }
                            className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`تحريك قسم ${sec.title} للأسفل`}
                            disabled={idx === draftConfig.sections.length - 1}
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                sections: reorderOrderedItems(prev.sections, idx, idx + 1),
                              }))
                            }
                            className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={
                              sec.visible ? `إخفاء قسم ${sec.title}` : `إظهار قسم ${sec.title}`
                            }
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                sections: prev.sections.map((s) =>
                                  s.id === sec.id ? { ...s, visible: !s.visible } : s
                                ),
                              }))
                            }
                            className="p-1 text-slate-600 hover:text-teal-700 cursor-pointer"
                          >
                            {sec.visible ? (
                              <Eye className="w-4 h-4" />
                            ) : (
                              <EyeOff className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`حذف قسم ${sec.title}`}
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                sections: prev.sections
                                  .filter((s) => s.id !== sec.id)
                                  .map((s, i) => ({ ...s, order: i + 1 })),
                              }))
                            }
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={sec.title}
                          aria-label={`عنوان قسم ${sec.title}`}
                          onChange={(e) =>
                            setDraftConfig((prev) => ({
                              ...prev,
                              sections: prev.sections.map((s) =>
                                s.id === sec.id ? { ...s, title: e.target.value } : s
                              ),
                            }))
                          }
                          className="sm:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                        />
                        <select
                          value={sec.columns}
                          aria-label={`أعمدة قسم ${sec.title}`}
                          onChange={(e) =>
                            setDraftConfig((prev) => ({
                              ...prev,
                              sections: prev.sections.map((s) =>
                                s.id === sec.id
                                  ? { ...s, columns: Number(e.target.value) as 1 | 2 | 3 }
                                  : s
                              ),
                            }))
                          }
                          className="px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"
                        >
                          <option value={1}>عمود واحد</option>
                          <option value={2}>عمودان</option>
                          <option value={3}>٣ أعمدة</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeTab === 'navigation' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    عناصر القائمة العلوية للطالب
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftConfig((prev) =>
                        addNavItemToConfig(prev, {
                          label: 'الإعلانات',
                          targetSection: 'announcements_feed',
                          iconName: 'Bell',
                          visible: true,
                        })
                      )
                    }
                    className="px-2.5 py-1.5 bg-teal-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة رابط</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {draftConfig.navigation.map((nav, idx) => (
                    <div
                      key={nav.id}
                      draggable
                      onDragStart={() => setDragNavIndex(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragNavIndex !== null) {
                          setDraftConfig((prev) => ({
                            ...prev,
                            navigation: reorderOrderedItems(
                              prev.navigation,
                              dragNavIndex,
                              idx
                            ),
                          }));
                          setDragNavIndex(null);
                        }
                      }}
                      className="p-3 rounded-lg border border-slate-200 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-slate-400 cursor-grab" />
                          <span className="text-xs font-bold text-slate-800">
                            {nav.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                navigation: prev.navigation.map((n) =>
                                  n.id === nav.id ? { ...n, visible: !n.visible } : n
                                ),
                              }))
                            }
                            aria-label={nav.visible ? 'إخفاء الرابط' : 'إظهار الرابط'}
                            className="p-1 text-slate-600 cursor-pointer"
                          >
                            {nav.visible ? (
                              <Eye className="w-4 h-4" />
                            ) : (
                              <EyeOff className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`حذف رابط ${nav.label}`}
                            onClick={() =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                navigation: prev.navigation
                                  .filter((n) => n.id !== nav.id)
                                  .map((n, i) => ({ ...n, order: i + 1 })),
                              }))
                            }
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={nav.label}
                          onChange={(e) =>
                            setDraftConfig((prev) => ({
                              ...prev,
                              navigation: prev.navigation.map((n) =>
                                n.id === nav.id ? { ...n, label: e.target.value } : n
                              ),
                            }))
                          }
                          className="px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                        />
                        <select
                          value={nav.targetSection}
                          onChange={(e) =>
                            setDraftConfig((prev) => ({
                              ...prev,
                              navigation: prev.navigation.map((n) =>
                                n.id === nav.id
                                  ? { ...n, targetSection: e.target.value as SectionType }
                                  : n
                              ),
                            }))
                          }
                          className="px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"
                        >
                          {SECTION_CATALOG.map((cat) => (
                            <option key={cat.type} value={cat.type}>
                              {cat.defaultTitle}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  سجل جميع المسودات والإصدارات المنشورة لهذه الواجهة مع إمكانية الاستعادة الفورية:
                </p>
                {versions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    لا توجد نسخ مسجلة بعد.
                  </p>
                ) : (
                  versions.map((ver) => (
                    <div
                      key={ver.id}
                      className="p-3 rounded-lg border border-slate-200 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-bold text-slate-900 tabular-nums">
                            الإصدار {ver.version_number}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-teal-700 font-medium">
                            {ver.action_type === 'publish'
                              ? 'نشر معتمد'
                              : ver.action_type === 'rollback'
                                ? 'استعادة نسخة'
                                : 'حفظ مسودة'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700">{ver.change_summary}</p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          {new Date(ver.created_at).toLocaleString('ar-SA')}
                          {ver.author_name ? ` · ${ver.author_name}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleRollback(ver.id)}
                        className="px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>استعادة</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Live Preview Frame */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-900">معاينة حية قبل النشر</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-slate-600">
                {interfaceStatus === 'published' ? 'الحالة: منشورة' : 'الحالة: مسودة غير منشورة'}
              </span>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => setPreviewViewport('desktop')}
                className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                  previewViewport === 'desktop'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>سطح المكتب</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewViewport('mobile')}
                className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                  previewViewport === 'mobile'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>الجوال</span>
              </button>
            </div>
          </div>

          <div className="p-4 bg-slate-100 flex justify-center overflow-x-auto">
            <div
              className={`border border-slate-300 rounded-xl overflow-hidden shadow-sm transition-all duration-200 bg-white ${
                previewViewport === 'mobile'
                  ? 'w-[390px] max-h-[680px] overflow-y-auto'
                  : 'w-full max-h-[680px] overflow-y-auto'
              }`}
            >
              <StudentPortal
                user={previewUser}
                workspace={previewWorkspace}
                isPreviewMode={true}
                previewViewport={previewViewport}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
