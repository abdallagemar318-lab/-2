import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BookOpenCheck,
  CheckCircle2,
  Download,
  Info,
  Lock,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { apiFetch, downloadProtectedFile } from '../lib/api.ts';
import type {
  AuthUserSummary,
  InterfaceConfig,
  InterfaceResolutionResult,
} from '../shared/types.ts';
import { IconGlyph } from './IconGlyph.tsx';
import { SafeImage } from './SafeImage.tsx';
import { StudentExamModal, type ProtectedExamCardItem } from './StudentExamModal.tsx';

export interface StudentSubjectItem {
  id: number;
  title: string;
  code: string;
  description: string;
  instructor_name: string;
  cover_image: string;
}

export interface StudentLessonItem {
  id: number;
  subject_id: number;
  title: string;
  summary: string;
  duration_minutes: number;
  video_url: string;
  content_body: string;
}

export interface StudentDocumentItem {
  id: number;
  subject_id: number;
  title: string;
  file_type: string;
  file_size_label: string;
  description: string;
  original_filename?: string;
  mime_type?: string;
}

export type StudentExamItem = ProtectedExamCardItem;

export interface StudentToolItem {
  id: number;
  tool_key: string;
  title: string;
  description: string;
  category: string;
  icon_name: string;
}

export interface StudentAnnouncementItem {
  id: number;
  title: string;
  body: string;
  priority_level: 'normal' | 'important' | 'urgent';
  published_at: string;
}

export interface StudentWorkspacePayload {
  resolvedInterface: InterfaceResolutionResult;
  content: {
    subjects: StudentSubjectItem[];
    lessons: StudentLessonItem[];
    documents: StudentDocumentItem[];
    exams: StudentExamItem[];
    tools: StudentToolItem[];
    announcements: StudentAnnouncementItem[];
  };
}

interface StudentPortalProps {
  user: AuthUserSummary;
  workspace: StudentWorkspacePayload;
  isPreviewMode?: boolean;
  previewViewport?: 'desktop' | 'mobile';
  onLogout?: () => void;
  onRefreshWorkspace?: () => void;
}

const SAMPLE_VERSES = [
  {
    poet: 'أحمد شوقي (إحياء النموذج)',
    meter: 'بحر البسيط (مستفعلن فاعلن مستفعلن فعلن)',
    text: 'ريمٌ على القاعِ بين البانِ والعلمِ ** أحلَّ سفكَ دمي في الأشهرِ الحُرُمِ',
  },
  {
    poet: 'بدر شاكر السياب (تكسير البنية)',
    meter: 'بحر الرجز (مستفعلن - شعر التفعيلة)',
    text: 'عيناكِ غابتا نخيلٍ ساعةَ السحَرْ ** أو شرفتانِ راحَ ينأى عنهما القمرْ',
  },
  {
    poet: 'محمود سامي البارودي (إحياء النموذج)',
    meter: 'بحر الطويل (فعولن مفاعيلن)',
    text: 'أبى الدهرُ إلا أن يسودَ وضيعُهُ ** ويملكَ أعناقَ المطالبِ وغدُهُ',
  },
];

const RHETORIC_GLOSSARY = [
  {
    term: 'خطاب إحياء النموذج',
    def: 'حركة شعرية نهضوية استلهمت عمود الشعر العربي القديم في الوزن والقافية والمعجم التراثي (البارودي، شوقي).',
  },
  {
    term: 'خطاب سؤال الذات',
    def: 'اتجاه رومانسي جعل الذات الفردية والوجدان والطبيعة مركز التجربة الشعرية مع تبسيط اللغة (الشابي، جبران).',
  },
  {
    term: 'تكسير البنية وتجديد الرؤيا',
    def: 'ثورة شعرية استبدلت الشطرين بنظام السطر الشعري والتفعيلة، ووظفت الرمز والأسطورة لاستشراف المستقبل (السياب، أدونيس).',
  },
  {
    term: 'التوازي',
    def: 'تماثل البنيات التركيبية أو الصرفية أو الدلالية بين بيتين أو سطرين لإغناء الإيقاع الداخلي للقصيدة.',
  },
  {
    term: 'الاتساق والانسجام',
    def: 'الاتساق هو الترابط الشكلي عبر الإحالة والربط؛ والانسجام هو التماسك الدلالي العميق الذي يدركه القارئ.',
  },
  {
    term: 'الانزياح الشعري',
    def: 'خرق المألوف في التركيب أو الدلالة لإنتاج صورة شعرية إيحائية تتجاوز المعنى المعجمي المباشر.',
  },
  {
    term: 'المنهج الاجتماعي والبنيوي',
    def: 'مناهج نقدية حديثة: الأول يربط النص بظروفه التاريخية والاجتماعية، والثاني يدرسه كبنية لغوية مغلقة.',
  },
  {
    term: 'ظاهرة الشعر الحديث (المجاطي)',
    def: 'مؤلف نقدي من ٤ فصول يتبع تطور الشعر العربي نحو الذات والغربة والحياة والموت والشكل الفني الجديد.',
  },
  {
    term: 'اللص والكلاب (نجيب محفوظ)',
    def: 'رواية رمزية اجتماعية تتبع مأساة سعيد مهران بعد خروجه من السجن ومحاولته الانتقام في واقع متأزم.',
  },
];

function analyzeArabicVerseProsody(rawVerse: string) {
  const cleaned = rawVerse.trim();
  if (!cleaned) {
    return { hemistichs: [] as string[], wordCount: 0, letterCount: 0, diacriticCount: 0 };
  }
  const hemistichs = cleaned.split('**').map((h) => h.trim()).filter(Boolean);
  const words = cleaned.replace(/\*\*/g, ' ').trim().split(/\s+/).filter(Boolean);
  const arabicLetters = cleaned.match(/[\u0621-\u064A]/g) || [];
  const diacritics = cleaned.match(/[\u064B-\u0652]/g) || [];
  return {
    hemistichs,
    wordCount: words.length,
    letterCount: arabicLetters.length,
    diacriticCount: diacritics.length,
  };
}

export function StudentPortal({
  user,
  workspace,
  isPreviewMode = false,
  previewViewport = 'desktop',
  onLogout,
  onRefreshWorkspace,
}: StudentPortalProps) {
  const { resolvedInterface, content } = workspace;
  const config: InterfaceConfig = resolvedInterface.config;

  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<number | null>(null);
  const [activeLesson, setActiveLesson] = useState<StudentLessonItem | null>(null);
  const [activeExam, setActiveExam] = useState<StudentExamItem | null>(null);
  const [activeTool, setActiveTool] = useState<StudentToolItem | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Arabic Prosody Lab state
  const [verseInput, setVerseInput] = useState(SAMPLE_VERSES[0].text);

  // Arabic Rhetoric Glossary state
  const [glossaryQuery, setGlossaryQuery] = useState('');

  // Arabic Essay Planner state
  const [essayType, setEssayType] = useState<'poetic' | 'theoretical' | 'book'>('poetic');
  const [essayAuthor, setEssayAuthor] = useState('أحمد شوقي / إحياء النموذج');
  const [essayTheme, setEssayTheme] = useState('الحنين والتمسك بالتراث الشعري');

  // Focus Timer state
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  const radiusClass =
    config.layout.borderRadius === 'sharp'
      ? 'rounded-sm'
      : config.layout.borderRadius === 'soft'
        ? 'rounded-2xl'
        : 'rounded-xl';

  const densityPadClass =
    config.layout.density === 'compact'
      ? 'p-4'
      : config.layout.density === 'spacious'
        ? 'p-7'
        : 'p-5';

  const cardSurfaceClass =
    config.layout.cardStyle === 'elevated'
      ? 'border shadow-sm'
      : config.layout.cardStyle === 'soft_surface'
        ? 'border border-transparent shadow-xs'
        : 'border';

  const isMinimalLayout = config.layout.layoutStyle === 'minimal_clean';
  const isLiteraryLayout = config.layout.layoutStyle === 'literary_folio';

  const scaleMultiplier =
    config.typography.scale === 'compact'
      ? 0.94
      : config.typography.scale === 'comfortable'
        ? 1.08
        : 1;

  const isMobilePreview = isPreviewMode && previewViewport === 'mobile';

  const visibleNav = [...config.navigation]
    .filter((n) => n.visible)
    .sort((a, b) => a.order - b.order);

  const visibleSections = [...config.sections]
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order);

  const filteredLessons = selectedSubjectFilter
    ? content.lessons.filter((l) => l.subject_id === selectedSubjectFilter)
    : content.lessons;

  const filteredDocuments = selectedSubjectFilter
    ? content.documents.filter((d) => d.subject_id === selectedSubjectFilter)
    : content.documents;

  const filteredExams = selectedSubjectFilter
    ? content.exams.filter((e) => e.subject_id === selectedSubjectFilter)
    : content.exams;

  const subjectById = new Map(content.subjects.map((s) => [s.id, s]));

  function showNotice(msg: string) {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 3500);
  }

  function scrollToSection(sectionType: string) {
    const el = document.getElementById(`portal-sec-${sectionType}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function getPrimaryButtonStyle(): Record<string, string> {
    if (config.layout.buttonStyle === 'outline') {
      return {
        borderColor: config.theme.primaryColor,
        color: config.theme.primaryColor,
        backgroundColor: 'transparent',
        borderWidth: '1px',
        borderStyle: 'solid',
      };
    }
    return {
      backgroundColor: config.theme.primaryColor,
      color: '#FFFFFF',
    };
  }

  async function handleDownloadDocument(doc: StudentDocumentItem) {
    if (isPreviewMode) {
      showNotice(`معاينة: تنزيل ملف "${doc.title}"`);
      return;
    }
    try {
      await downloadProtectedFile(
        `/api/student/documents/${doc.id}/download`,
        doc.original_filename || `${doc.title}.txt`
      );
      showNotice(`تم تنزيل الملف: ${doc.title}`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'تعذر تنزيل الملف.');
    }
  }

  const backgroundStyle: Record<string, string> = {
    backgroundColor: config.theme.backgroundColor,
    color: config.theme.textColor,
    fontFamily: `"${config.typography.fontFamily}", "IBM Plex Sans Arabic", sans-serif`,
    fontSize: `${15 * scaleMultiplier}px`,
  };

  if (config.layout.backgroundPattern === 'arabesque_subtle') {
    backgroundStyle.backgroundImage = `repeating-linear-gradient(45deg, ${config.theme.borderColor}33 0, ${config.theme.borderColor}33 1px, transparent 1px, transparent 22px), repeating-linear-gradient(-45deg, ${config.theme.borderColor}33 0, ${config.theme.borderColor}33 1px, transparent 1px, transparent 22px)`;
  } else if (config.layout.backgroundPattern === 'calligraphy_lines') {
    backgroundStyle.backgroundImage = `linear-gradient(to bottom, ${config.theme.borderColor}55 1px, transparent 1px)`;
    backgroundStyle.backgroundSize = '100% 34px';
  } else if (config.layout.backgroundPattern === 'warm_paper') {
    backgroundStyle.backgroundImage = `radial-gradient(${config.theme.borderColor}66 1px, transparent 1px)`;
    backgroundStyle.backgroundSize = '18px 18px';
  } else if (config.layout.backgroundPattern === 'night_slate') {
    backgroundStyle.backgroundImage = `radial-gradient(circle at top right, ${config.theme.primaryColor}22, transparent 55%)`;
  }

  const prosodyStats = analyzeArabicVerseProsody(verseInput);

  const filteredGlossary = RHETORIC_GLOSSARY.filter(
    (g) =>
      !glossaryQuery.trim() ||
      g.term.includes(glossaryQuery.trim()) ||
      g.def.includes(glossaryQuery.trim())
  );

  const quoteParts = (config.arabicQuoteText || '')
    .split('**')
    .map((p) => p.trim())
    .filter(Boolean);

  const levelLabelAr =
    resolvedInterface.sourceLevel === 'individual'
      ? 'واجهة فردية مخصصة'
      : resolvedInterface.sourceLevel === 'group'
        ? 'واجهة المجموعة الدراسية'
        : resolvedInterface.sourceLevel === 'exclusive_template'
          ? 'واجهة الحساب الحصري المستقل'
          : 'الواجهة الافتراضية';

  return (
    <div style={backgroundStyle} className="min-h-full transition-colors duration-200">
      {/* Top 3-Zone Navigation Bar */}
      <header
        style={{
          backgroundColor: config.theme.surfaceColor,
          borderColor: config.theme.borderColor,
        }}
        className="border-b sticky top-0 z-20"
      >
        <div
          className={`max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between ${
            isPreviewMode ? 'gap-3' : 'gap-6'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <span
              style={{
                fontFamily: `"${config.typography.headingFont}", "Cairo", sans-serif`,
                color: config.theme.textColor,
              }}
              className={`${
                isPreviewMode ? 'text-sm' : 'text-lg'
              } font-bold whitespace-nowrap`}
            >
              {config.brandTitle}
            </span>
            {!isPreviewMode && config.gradeLabel && (
              <span
                style={{ color: config.theme.primaryColor }}
                className="hidden lg:inline text-xs font-semibold whitespace-nowrap"
              >
                · {config.gradeLabel}
              </span>
            )}
          </div>

          {!isMobilePreview && (
            <nav
              className={`hidden md:flex items-center ${
                isPreviewMode ? 'gap-3' : 'gap-5'
              } overflow-x-auto`}
            >
              {visibleNav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.targetSection)}
                  style={{ color: config.theme.mutedTextColor }}
                  className={`${
                    isPreviewMode ? 'text-xs' : 'text-sm'
                  } font-medium hover:opacity-80 whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer transition-opacity`}
                >
                  <IconGlyph name={item.iconName} className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-3 shrink-0">
            <span
              style={{ color: config.theme.mutedTextColor }}
              className="hidden sm:inline text-xs whitespace-nowrap"
            >
              {user.fullName}
            </span>
            {!isPreviewMode && onLogout && (
              <button
                type="button"
                onClick={onLogout}
                style={{
                  backgroundColor: config.theme.primaryColor,
                  color: '#FFFFFF',
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            )}
          </div>
        </div>

        {(isMobilePreview || visibleNav.length > 0) && (
          <nav
            aria-label="التنقل السريع للأقسام"
            style={{ borderColor: config.theme.borderColor }}
            className={`${
              isMobilePreview ? 'flex' : 'flex md:hidden'
            } items-center gap-3 px-4 py-2 border-t overflow-x-auto`}
          >
            {visibleNav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.targetSection)}
                style={{ color: config.theme.mutedTextColor }}
                className="text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
              >
                <IconGlyph name={item.iconName} className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        )}
      </header>

      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-5 left-5 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Main Content Container */}
      <main
        className={`max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 ${
          isMinimalLayout ? 'space-y-6' : 'space-y-8'
        } ${isMobilePreview ? 'max-w-[390px]' : ''}`}
      >
        {selectedSubjectFilter !== null && (
          <div
            style={{
              backgroundColor: config.theme.surfaceColor,
              borderColor: config.theme.borderColor,
            }}
            className={`${cardSurfaceClass} ${radiusClass} px-4 py-3 flex items-center justify-between gap-4`}
          >
            <div className="text-sm">
              <span style={{ color: config.theme.mutedTextColor }}>تصفية حسب المكوّن: </span>
              <span className="font-semibold">
                {subjectById.get(selectedSubjectFilter)?.title || 'مكوّن محدد'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSubjectFilter(null)}
              style={{ color: config.theme.primaryColor }}
              className="text-xs font-semibold hover:underline cursor-pointer whitespace-nowrap"
            >
              عرض جميع المكونات
            </button>
          </div>
        )}

        {visibleSections.map((section) => {
          const gridColsClass = isMobilePreview
            ? 'grid-cols-1'
            : section.columns === 3
              ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              : section.columns === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1';

          if (section.type === 'hero_banner') {
            const isSplitHero =
              config.layout.heroAlignment === 'split' &&
              config.showHeroImage &&
              !isMobilePreview;
            const isCenteredHero = config.layout.heroAlignment === 'centered';

            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                style={{
                  backgroundColor: config.theme.surfaceColor,
                  borderColor: config.theme.borderColor,
                }}
                className={`${cardSurfaceClass} ${radiusClass} overflow-hidden`}
              >
                <div
                  className={`grid ${
                    isSplitHero ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'
                  } items-stretch`}
                >
                  <div
                    className={`${isSplitHero ? 'lg:col-span-7' : ''} ${
                      isCenteredHero ? 'text-center items-center' : ''
                    } p-6 sm:p-8 flex flex-col justify-center`}
                  >
                    <div
                      style={{ color: config.theme.primaryColor }}
                      className={`flex flex-wrap items-center gap-2 text-xs font-semibold mb-2 ${
                        isCenteredHero ? 'justify-center' : ''
                      }`}
                    >
                      <IconGlyph name={section.iconName} className="w-4 h-4" />
                      <span>{config.gradeLabel || 'الصف الثاني باكالوريا'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{levelLabelAr}</span>
                      {user.groupName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{user.groupName}</span>
                        </>
                      )}
                    </div>
                    <h1
                      style={{
                        fontFamily: `"${config.typography.headingFont}", "Amiri", "Cairo", sans-serif`,
                      }}
                      className={`${
                        isLiteraryLayout
                          ? 'text-2xl sm:text-4xl'
                          : 'text-2xl sm:text-3xl'
                      } font-bold leading-snug mb-3`}
                    >
                      {config.welcomeHeadline}
                    </h1>
                    <p
                      style={{ color: config.theme.mutedTextColor }}
                      className={`text-sm sm:text-base leading-relaxed max-w-2xl mb-5 ${
                        isCenteredHero ? 'mx-auto' : ''
                      }`}
                    >
                      {config.welcomeSubtitle}
                    </p>

                    {config.showArabicQuote && quoteParts.length > 0 && (
                      <blockquote
                        style={{
                          backgroundColor: config.theme.backgroundColor,
                          borderColor: config.theme.borderColor,
                        }}
                        className={`border ${radiusClass} p-4 mb-5 w-full ${
                          isCenteredHero ? 'max-w-2xl mx-auto' : ''
                        }`}
                      >
                        <div
                          style={{
                            fontFamily: '"Amiri", "Noto Naskh Arabic", serif',
                            color: config.theme.textColor,
                          }}
                          className="text-base sm:text-lg font-bold leading-loose text-center"
                        >
                          {quoteParts.length >= 2 ? (
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6">
                              <span>{quoteParts[0]}</span>
                              <span
                                style={{ color: config.theme.primaryColor }}
                                aria-hidden="true"
                                className="hidden sm:inline"
                              >
                                ۞
                              </span>
                              <span>{quoteParts[1]}</span>
                            </div>
                          ) : (
                            <span>{config.arabicQuoteText}</span>
                          )}
                        </div>
                        {config.arabicQuoteAuthor && (
                          <footer
                            style={{ color: config.theme.mutedTextColor }}
                            className="text-xs text-center mt-1.5"
                          >
                            — {config.arabicQuoteAuthor}
                          </footer>
                        )}
                      </blockquote>
                    )}

                    <div
                      style={{ color: config.theme.mutedTextColor }}
                      className={`flex flex-wrap items-center gap-3 text-xs font-medium ${
                        isCenteredHero ? 'justify-center' : ''
                      }`}
                    >
                      <span>الطالب: {user.fullName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {content.subjects.length} مكونات في العربية
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {content.lessons.length} دروس · {content.documents.length} ملفات
                      </span>
                    </div>
                  </div>
                  {config.showHeroImage && config.layout.heroAlignment !== 'minimal' && (
                    <div
                      className={`${
                        isSplitHero
                          ? 'lg:col-span-5 min-h-[220px]'
                          : isMobilePreview
                            ? 'h-40'
                            : 'h-56'
                      }`}
                    >
                      <SafeImage
                        src={config.heroImageUrl}
                        alt={config.welcomeHeadline}
                        className="w-full h-full object-cover"
                        fallbackTitle={config.brandTitle}
                      />
                    </div>
                  )}
                </div>
              </section>
            );
          }

          if (section.type === 'progress_overview') {
            const completedCount = content.exams.filter((e) => e.submission).length;
            const metrics = [
              {
                label: 'مكونات اللغة العربية',
                value: content.subjects.length,
                detail: 'نصوص، علوم لغة، إنشاء، ومؤلفات',
              },
              {
                label: 'الدروس والملفات المرفوعة',
                value: content.lessons.length + content.documents.length,
                detail: `${content.lessons.length} درس · ${content.documents.length} ملف`,
              },
              {
                label: 'الفروض والاختبارات المنجزة',
                value: `${completedCount}/${content.exams.length}`,
                detail: 'تقييمات مسجلة بالنظام',
              },
            ];

            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                <div className={`grid ${gridColsClass} gap-4`}>
                  {metrics.map((m) => (
                    <div
                      key={m.label}
                      style={{
                        backgroundColor: config.theme.surfaceColor,
                        borderColor: config.theme.borderColor,
                      }}
                      className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass}`}
                    >
                      <div
                        style={{ color: config.theme.mutedTextColor }}
                        className="text-xs font-medium mb-1.5"
                      >
                        {m.label}
                      </div>
                      <div
                        style={{
                          color: config.theme.primaryColor,
                          fontFamily: `"${config.typography.headingFont}", "Cairo", sans-serif`,
                        }}
                        className="text-2xl font-bold tabular-nums mb-1"
                      >
                        {m.value}
                      </div>
                      <div
                        style={{ color: config.theme.mutedTextColor }}
                        className="text-xs"
                      >
                        {m.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          if (section.type === 'announcements_feed') {
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                {content.announcements.length === 0 ? (
                  <EmptySectionCard
                    message="لا توجد إعلانات أو توجيهات مخصصة لحسابك حالياً."
                    config={config}
                    radiusClass={radiusClass}
                  />
                ) : (
                  <div className={`grid ${gridColsClass} gap-4`}>
                    {content.announcements.map((ann) => (
                      <article
                        key={ann.id}
                        style={{
                          backgroundColor: config.theme.surfaceColor,
                          borderColor: config.theme.borderColor,
                        }}
                        className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass} flex items-start gap-3`}
                      >
                        <div
                          style={{ color: config.theme.primaryColor }}
                          className="mt-0.5 shrink-0"
                        >
                          {ann.priority_level === 'urgent' ? (
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                          ) : ann.priority_level === 'important' ? (
                            <Bell className="w-5 h-5" />
                          ) : (
                            <Info className="w-5 h-5" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              style={{ color: config.theme.mutedTextColor }}
                              className="font-medium"
                            >
                              {ann.priority_level === 'urgent'
                                ? 'تنبيه عاجل'
                                : ann.priority_level === 'important'
                                  ? 'توجيه مهم'
                                  : 'إعلان دراسي'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              style={{ color: config.theme.mutedTextColor }}
                              className="tabular-nums"
                            >
                              {new Date(ann.published_at).toLocaleDateString('ar-SA')}
                            </span>
                          </div>
                          <h3 className="font-bold text-base">{ann.title}</h3>
                          <p
                            style={{ color: config.theme.mutedTextColor }}
                            className="text-sm leading-relaxed"
                          >
                            {ann.body}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          }

          if (section.type === 'subjects_grid') {
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                {content.subjects.length === 0 ? (
                  <EmptySectionCard
                    message="لم يتم إتاحة مكونات دراسية لهذا الحساب حتى الآن من قبل الإدارة."
                    config={config}
                    radiusClass={radiusClass}
                  />
                ) : (
                  <div className={`grid ${gridColsClass} gap-5`}>
                    {content.subjects.map((sub) => {
                      const subLessonsCount = content.lessons.filter(
                        (l) => l.subject_id === sub.id
                      ).length;
                      return (
                        <article
                          key={sub.id}
                          style={{
                            backgroundColor: config.theme.surfaceColor,
                            borderColor: config.theme.borderColor,
                          }}
                          className={`${cardSurfaceClass} ${radiusClass} overflow-hidden flex flex-col`}
                        >
                          {!isMinimalLayout && (
                            <div className="h-36 w-full overflow-hidden">
                              <SafeImage
                                src={sub.cover_image}
                                alt={sub.title}
                                fallbackTitle={sub.title}
                              />
                            </div>
                          )}
                          <div className={`${densityPadClass} flex-1 flex flex-col justify-between gap-4`}>
                            <div>
                              <div
                                style={{ color: config.theme.mutedTextColor }}
                                className="flex items-center gap-2 text-xs mb-1.5"
                              >
                                <span className="font-tabular">{sub.code}</span>
                                <span aria-hidden="true">·</span>
                                <span>{sub.instructor_name}</span>
                              </div>
                              <h3
                                style={{
                                  fontFamily: `"${config.typography.headingFont}", "Cairo", sans-serif`,
                                }}
                                className="text-lg font-bold mb-2"
                              >
                                {sub.title}
                              </h3>
                              <p
                                style={{ color: config.theme.mutedTextColor }}
                                className="text-sm leading-relaxed"
                              >
                                {sub.description}
                              </p>
                            </div>
                            <div
                              style={{ borderColor: config.theme.borderColor }}
                              className="flex items-center justify-between pt-3 border-t"
                            >
                              <span
                                style={{ color: config.theme.mutedTextColor }}
                                className="text-xs tabular-nums"
                              >
                                {subLessonsCount} دروس متاحة
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSubjectFilter(
                                    selectedSubjectFilter === sub.id ? null : sub.id
                                  );
                                  scrollToSection('lessons_list');
                                }}
                                style={{ color: config.theme.primaryColor }}
                                className="text-xs font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                              >
                                <span>
                                  {selectedSubjectFilter === sub.id
                                    ? 'إلغاء التصفية'
                                    : 'استعراض الدروس'}
                                </span>
                                <ArrowLeft className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          }

          if (section.type === 'lessons_list') {
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                {filteredLessons.length === 0 ? (
                  <EmptySectionCard
                    message="لا توجد دروس متاحة حالياً ضمن الصلاحيات الممنوحة."
                    config={config}
                    radiusClass={radiusClass}
                  />
                ) : (
                  <div className={`grid ${gridColsClass} gap-4`}>
                    {filteredLessons.map((lesson) => {
                      const sub = subjectById.get(lesson.subject_id);
                      return (
                        <article
                          key={lesson.id}
                          style={{
                            backgroundColor: config.theme.surfaceColor,
                            borderColor: config.theme.borderColor,
                          }}
                          className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass} flex flex-col justify-between gap-3`}
                        >
                          <div>
                            <div
                              style={{ color: config.theme.mutedTextColor }}
                              className="flex items-center gap-2 text-xs mb-1.5"
                            >
                              <span>{sub?.title || 'اللغة العربية'}</span>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {lesson.duration_minutes} دقيقة
                              </span>
                            </div>
                            <h3
                              style={{
                                fontFamily: `"${config.typography.headingFont}", "Cairo", sans-serif`,
                              }}
                              className="font-bold text-base mb-1.5"
                            >
                              {lesson.title}
                            </h3>
                            <p
                              style={{ color: config.theme.mutedTextColor }}
                              className="text-sm leading-relaxed"
                            >
                              {lesson.summary}
                            </p>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => setActiveLesson(lesson)}
                              style={getPrimaryButtonStyle()}
                              className="px-4 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                            >
                              قراءة الشرح والمنهجية
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          }

          if (section.type === 'documents_library') {
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                {filteredDocuments.length === 0 ? (
                  <EmptySectionCard
                    message="لا توجد ملفات أو مذكرات مصرح بتنزيلها حالياً."
                    config={config}
                    radiusClass={radiusClass}
                  />
                ) : (
                  <div className={`grid ${gridColsClass} gap-4`}>
                    {filteredDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          backgroundColor: config.theme.surfaceColor,
                          borderColor: config.theme.borderColor,
                        }}
                        className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass} flex items-center justify-between gap-4`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div
                            style={{ color: config.theme.mutedTextColor }}
                            className="text-xs flex flex-wrap items-center gap-2"
                          >
                            <span>{doc.file_type}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{doc.file_size_label}</span>
                          </div>
                          <h3 className="font-bold text-sm sm:text-base truncate">{doc.title}</h3>
                          <p
                            style={{ color: config.theme.mutedTextColor }}
                            className="text-xs sm:text-sm"
                          >
                            {doc.description}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownloadDocument(doc)}
                          style={{
                            borderColor: config.theme.primaryColor,
                            color: config.theme.primaryColor,
                          }}
                          className="px-3.5 py-2 border rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 hover:opacity-80 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>تنزيل</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          }

          if (section.type === 'exams_assignments') {
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                {filteredExams.length === 0 ? (
                  <EmptySectionCard
                    message="لا توجد اختبارات أو فروض مفتوحة لحسابك حالياً."
                    config={config}
                    radiusClass={radiusClass}
                  />
                ) : (
                  <div className={`grid ${gridColsClass} gap-4`}>
                    {filteredExams.map((exam) => {
                      const sub = subjectById.get(exam.subject_id);
                      return (
                        <div
                          key={exam.id}
                          style={{
                            backgroundColor: config.theme.surfaceColor,
                            borderColor: config.theme.borderColor,
                          }}
                          className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass} flex flex-col justify-between gap-3`}
                        >
                          <div>
                            <div
                              style={{ color: config.theme.mutedTextColor }}
                              className="text-xs flex flex-wrap items-center gap-2 mb-1.5"
                            >
                              <span>
                                {exam.exam_type === 'exam' ? 'فرض تقييمي' : 'واجب منزلي'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{sub?.title || 'اللغة العربية'}</span>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{exam.duration_minutes} دقيقة</span>
                            </div>
                            <h3 className="font-bold text-base mb-1">{exam.title}</h3>
                            <p
                              style={{ color: config.theme.mutedTextColor }}
                              className="text-xs tabular-nums"
                            >
                              الدرجة الكلية: {exam.total_marks} · آخر موعد: {exam.due_date}
                            </p>
                            {exam.antiCheatPolicy && (
                              <div className="flex flex-wrap gap-1.5 mt-2 text-[10px] font-semibold">
                                <span
                                  style={{
                                    borderColor: config.theme.borderColor,
                                    color: config.theme.primaryColor,
                                  }}
                                  className="px-2 py-0.5 rounded border bg-slate-500/5"
                                >
                                  اختبار محمي ومراقب
                                </span>
                                {exam.antiCheatPolicy.shuffleQuestions && (
                                  <span
                                    style={{
                                      borderColor: config.theme.borderColor,
                                      color: config.theme.mutedTextColor,
                                    }}
                                    className="px-2 py-0.5 rounded border"
                                  >
                                    ترتيب عشوائي
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-2">
                            {exam.submission ? (
                              <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1 tabular-nums">
                                <CheckCircle2 className="w-4 h-4" />
                                تم التسليم ({exam.submission.score} / {exam.submission.total_marks})
                              </span>
                            ) : (
                              <span
                                style={{ color: config.theme.mutedTextColor }}
                                className="text-xs"
                              >
                                {exam.questionCount ?? exam.questions.length} أسئلة موضوعية
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setActiveExam(exam)}
                              style={getPrimaryButtonStyle()}
                              className="px-4 py-2 rounded-lg text-xs font-semibold hover:opacity-90 cursor-pointer"
                            >
                              {exam.hasActiveAttempt
                                ? 'متابعة الاختبار'
                                : exam.submission
                                  ? 'إعادة المحاولة'
                                  : 'بدء التقييم المحمي'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          }

          if (section.type === 'special_tools') {
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                {content.tools.length === 0 ? (
                  <EmptySectionCard
                    message="لم يتم تفعيل أدوات لغوية إضافية لهذا الحساب."
                    config={config}
                    radiusClass={radiusClass}
                  />
                ) : (
                  <div className={`grid ${gridColsClass} gap-4`}>
                    {content.tools.map((tool) => (
                      <div
                        key={tool.id}
                        style={{
                          backgroundColor: config.theme.surfaceColor,
                          borderColor: config.theme.borderColor,
                        }}
                        className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass} flex items-center justify-between gap-4`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            style={{ color: config.theme.primaryColor }}
                            className="p-2.5 rounded-lg bg-slate-500/10 shrink-0"
                          >
                            <IconGlyph name={tool.icon_name} className="w-5 h-5" />
                          </div>
                          <div>
                            <span
                              style={{ color: config.theme.mutedTextColor }}
                              className="text-xs"
                            >
                              {tool.category}
                            </span>
                            <h3 className="font-bold text-sm sm:text-base">{tool.title}</h3>
                            <p
                              style={{ color: config.theme.mutedTextColor }}
                              className="text-xs sm:text-sm mt-0.5"
                            >
                              {tool.description}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTool(tool)}
                          style={{
                            backgroundColor: config.theme.secondaryColor,
                            color: '#FFFFFF',
                          }}
                          className="px-3.5 py-2 rounded-lg text-xs font-semibold shrink-0 hover:opacity-90 cursor-pointer"
                        >
                          تشغيل
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          }

          if (section.type === 'study_schedule') {
            const scheduleDays = [
              { day: 'الإثنين', focus: 'درس النصوص: تحليل قصيدة أو نص نظري' },
              { day: 'الأربعاء', focus: 'علوم اللغة والتعبير والإنشاء المنهجي' },
              { day: 'الجمعة', focus: 'قراءة وتلخيص المؤلفات: ظاهرة الشعر الحديث واللص والكلاب' },
            ];
            return (
              <section
                key={section.id}
                id={`portal-sec-${section.type}`}
                className="space-y-3"
              >
                <SectionHeading section={section} config={config} />
                <div className={`grid ${gridColsClass} gap-4`}>
                  {scheduleDays.map((slot) => (
                    <div
                      key={slot.day}
                      style={{
                        backgroundColor: config.theme.surfaceColor,
                        borderColor: config.theme.borderColor,
                      }}
                      className={`${cardSurfaceClass} ${radiusClass} ${densityPadClass}`}
                    >
                      <div
                        style={{ color: config.theme.primaryColor }}
                        className="text-xs font-bold mb-1"
                      >
                        {slot.day}
                      </div>
                      <div className="font-semibold text-sm">{slot.focus}</div>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          return null;
        })}
      </main>

      {/* Footer note */}
      <footer
        style={{ borderColor: config.theme.borderColor, color: config.theme.mutedTextColor }}
        className="border-t mt-12 py-5 px-6 text-center text-xs"
      >
        <span>
          {config.brandTitle} · {config.gradeLabel || 'الصف الثاني باكالوريا'}
        </span>
        {!isPreviewMode && (
          <>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <Lock className="w-3 h-3" />
              التعديل مقصور على الإدارة
            </span>
          </>
        )}
      </footer>

      {/* Lesson Reader Modal */}
      {activeLesson && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={activeLesson.title}
        >
          <div className="bg-white text-slate-900 rounded-xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-teal-700 font-semibold mb-1">
                  {subjectById.get(activeLesson.subject_id)?.title} ·{' '}
                  {activeLesson.duration_minutes} دقيقة
                </p>
                <h3 className="text-xl font-bold font-display">{activeLesson.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveLesson(null)}
                aria-label="إغلاق نافذة الدرس"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-loose">
              {activeLesson.content_body}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveLesson(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Protected Anti-Cheat Exam Runner Modal */}
      {activeExam && (
        <StudentExamModal
          exam={activeExam}
          user={user}
          isPreviewMode={isPreviewMode}
          onClose={() => {
            setActiveExam(null);
            if (!isPreviewMode) {
              onRefreshWorkspace?.();
            }
          }}
          onSubmitted={(msg) => {
            showNotice(msg);
            if (!isPreviewMode) {
              onRefreshWorkspace?.();
            }
          }}
        />
      )}

      {/* Interactive Arabic Special Tool Modal */}
      {activeTool && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={activeTool.title}
        >
          <div className="bg-white text-slate-900 rounded-xl border border-slate-200 max-w-xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
              <div>
                <p className="text-xs text-teal-700 font-semibold">{activeTool.category}</p>
                <h3 className="text-lg font-bold font-display">{activeTool.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTool(null)}
                aria-label="إغلاق الأداة"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {activeTool.tool_key === 'arabic_prosody_lab' && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {SAMPLE_VERSES.map((sv, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setVerseInput(sv.text)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium text-slate-800 cursor-pointer"
                    >
                      {sv.poet}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    أدخل البيت الشعري (افصل بين الشطرين بـ **)
                  </label>
                  <textarea
                    rows={2}
                    value={verseInput}
                    onChange={(e) => setVerseInput(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-literary"
                  />
                </div>
                <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2">
                  <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-amber-950">
                    <span className="tabular-nums">عدد الكلمات: {prosodyStats.wordCount}</span>
                    <span className="tabular-nums">عدد الحروف العربية: {prosodyStats.letterCount}</span>
                    <span className="tabular-nums">الشكل والحركات: {prosodyStats.diacriticCount}</span>
                  </div>
                  {prosodyStats.hemistichs.length > 0 && (
                    <div className="pt-2 border-t border-amber-200/70 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm font-literary">
                      <div className="p-2 bg-white rounded border border-amber-100">
                        <span className="text-[11px] font-sans text-slate-500 block">الصدر:</span>
                        {prosodyStats.hemistichs[0]}
                      </div>
                      {prosodyStats.hemistichs[1] && (
                        <div className="p-2 bg-white rounded border border-amber-100">
                          <span className="text-[11px] font-sans text-slate-500 block">العجز:</span>
                          {prosodyStats.hemistichs[1]}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <div className="font-bold text-slate-800">أهم البحور المقررة في الثانية باكالوريا:</div>
                  <p>· الطويل: فعولن مفاعيلن فعولن مفاعيلن</p>
                  <p>· البسيط: مستفعلن فاعلن مستفعلن فعلن</p>
                  <p>· الكامل: متفاعلن متفاعلن متفاعلن</p>
                  <p>· شعر التفعيلة: تكرار مستفعلن أو فاعلاتن أو فعولن حسب الدفق الشعوري</p>
                </div>
              </div>
            )}

            {activeTool.tool_key === 'arabic_rhetoric_glossary' && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={glossaryQuery}
                  onChange={(e) => setGlossaryQuery(e.target.value)}
                  placeholder="ابحث عن مصطلح أدبي أو بلاغي أو نقدي..."
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {filteredGlossary.map((item) => (
                    <div
                      key={item.term}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50"
                    >
                      <div className="font-bold text-sm text-slate-900">{item.term}</div>
                      <div className="text-xs text-slate-600 mt-1 leading-relaxed">{item.def}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTool.tool_key === 'arabic_essay_planner' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'poetic', label: 'نص شعري' },
                      { id: 'theoretical', label: 'نص نظري' },
                      { id: 'book', label: 'قولة مؤلفات' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setEssayType(t.id)}
                      className={`py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                        essayType === t.id
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      المؤلف / الشاعر والخطاب
                    </label>
                    <input
                      type="text"
                      value={essayAuthor}
                      onChange={(e) => setEssayAuthor(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      المحور أو القضية الرئيسية
                    </label>
                    <input
                      type="text"
                      value={essayTheme}
                      onChange={(e) => setEssayTheme(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs leading-relaxed text-slate-800">
                  <div className="flex items-center gap-1.5 font-bold text-teal-800 text-sm">
                    <BookOpenCheck className="w-4 h-4" />
                    <span>الخطاطة المنهجية المقترحة:</span>
                  </div>
                  <p>
                    <strong>١. المقدمة:</strong> تأطير {essayAuthor} ضمن سياقه الأدبي وتحديد محور ({essayTheme})، ثم طرح الإشكالية وصياغة الفرضية.
                  </p>
                  <p>
                    <strong>٢. العرض (الفهم والتحليل):</strong>{' '}
                    {essayType === 'poetic'
                      ? 'تكثيف المعاني، تفكيك الحقول الدلالية والعلاقة بينها، دراسة الإيقاع الخارجي والداخلي والصور الشعرية والأساليب.'
                      : essayType === 'theoretical'
                        ? 'تحديد القضية المركزية وعناصرها، رصد طرائق العرض (استنباط/استقراء) والأساليب التفسيرية والحجاجية والاتساق.'
                        : 'وضع القولة في سياقها داخل المؤلف، تحليل الفصول أو القوى الفاعلة المرتبطة بها، وبيان البعد الدلالي والفني.'}
                  </p>
                  <p>
                    <strong>٣. الخاتمة:</strong> خلاصة تركيبية لما توصل إليه التحليل، تمحيص صحة الفرضية، ومناقشة قيمة النص ورهانه النقدي.
                  </p>
                </div>
              </div>
            )}

            {activeTool.tool_key === 'focus_timer' && (
              <div className="space-y-4 text-center">
                <div className="text-4xl font-bold font-tabular text-slate-900 py-4 bg-slate-50 rounded-lg border border-slate-200">
                  {String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:
                  {String(timerSeconds % 60).padStart(2, '0')}
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTimerRunning((prev) => !prev)}
                    className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    {timerRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    <span>{timerRunning ? 'إيقاف مؤقت' : 'بدء الجلسة'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTimerRunning(false);
                      setTimerSeconds(25 * 60);
                    }}
                    className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>إعادة ضبط (٢٥ د)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  section,
  config,
}: {
  section: InterfaceConfig['sections'][number];
  config: InterfaceConfig;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div
          style={{ color: config.theme.primaryColor }}
          className="flex items-center gap-2 mb-1"
        >
          <IconGlyph name={section.iconName} className="w-4 h-4" />
          <h2
            style={{
              color: config.theme.textColor,
              fontFamily: `"${config.typography.headingFont}", "Cairo", sans-serif`,
            }}
            className="text-lg sm:text-xl font-bold"
          >
            {section.title}
          </h2>
        </div>
        <p style={{ color: config.theme.mutedTextColor }} className="text-xs sm:text-sm">
          {section.subtitle}
        </p>
      </div>
    </div>
  );
}

function EmptySectionCard({
  message,
  config,
  radiusClass,
}: {
  message: string;
  config: InterfaceConfig;
  radiusClass: string;
}) {
  return (
    <div
      style={{
        backgroundColor: config.theme.surfaceColor,
        borderColor: config.theme.borderColor,
        color: config.theme.mutedTextColor,
      }}
      className={`border ${radiusClass} p-6 text-center text-sm`}
    >
      {message}
    </div>
  );
}
