import type {
  AccountTier,
  InterfaceAssignmentRecord,
  InterfaceConfig,
  InterfaceResolutionResult,
  InterfaceSection,
  NavMenuItem,
  SectionType,
} from './types';

export const DEFAULT_HERO_IMAGE =
  '/src/assets/images/arabic_calligraphy_banner_1795203627953.jpg';

export const ARABIC_COVER_IMAGES = [
  {
    url: '/src/assets/images/arabic_calligraphy_banner_1795203627953.jpg',
    label: 'مكتب الخط العربي والمخطوطات',
  },
  {
    url: '/src/assets/images/arabic_poetry_books_1795203627985.jpg',
    label: 'دواوين الشعر العربي والأدب',
  },
  {
    url: '/src/assets/images/subject_arabic_literature_1795202146797.jpg',
    label: 'قلم القصب والمحبرة التراثية',
  },
  {
    url: '/src/assets/images/hero_arabic_academy_1795202146488.jpg',
    label: 'قاعة المطالعة والعمارة العربية',
  },
];

export const CURATED_ARABIC_QUOTES = [
  {
    text: 'أنا البحرُ في أحشائِهِ الدُّرُّ كامنٌ ** فهل ساءَلوا الغوّاصَ عن صَدَفاتِي',
    author: 'حافظ إبراهيم',
  },
  {
    text: 'وما نيلُ المطالبِ بالتمنّي ** ولكن تُؤخذُ الدنيا غِلابا',
    author: 'أحمد شوقي',
  },
  {
    text: 'على قَدْرِ أهلِ العزمِ تأتي العزائمُ ** وتأتي على قَدْرِ الكرامِ المكارمُ',
    author: 'أبو الطيب المتنبي',
  },
  {
    text: 'إنَّ الَّذي ملأَ اللُّغاتِ محاسناً ** جَعَلَ الجمالَ وسِرَّهُ في الضّادِ',
    author: 'أحمد شوقي',
  },
];

export interface PalettePreset {
  id: string;
  nameAr: string;
  descriptionAr: string;
  theme: InterfaceConfig['theme'];
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'andalusian_ink',
    nameAr: 'حبر الورق الأندلسي',
    descriptionAr: 'دفء المخطوطات الكلاسيكية مع حبر العنبر',
    theme: {
      primaryColor: '#9A3412',
      secondaryColor: '#0F766E',
      backgroundColor: '#FAF7F2',
      surfaceColor: '#FFFFFF',
      textColor: '#1C1917',
      mutedTextColor: '#57534E',
      borderColor: '#E7E0D6',
      isDark: false,
    },
  },
  {
    id: 'eloquence_emerald',
    nameAr: 'زمرد البلاغة',
    descriptionAr: 'خلفية ناصعة الوضوح مع لمسات زمردية هادئة',
    theme: {
      primaryColor: '#0F766E',
      secondaryColor: '#1D4ED8',
      backgroundColor: '#F8FAFC',
      surfaceColor: '#FFFFFF',
      textColor: '#0F172A',
      mutedTextColor: '#475569',
      borderColor: '#E2E8F0',
      isDark: false,
    },
  },
  {
    id: 'qayrawan_azure',
    nameAr: 'لازورد القيروان',
    descriptionAr: 'أزرق سماوي هادئ يعين على القراءة الطويلة',
    theme: {
      primaryColor: '#1E40AF',
      secondaryColor: '#0D9488',
      backgroundColor: '#F3F6FB',
      surfaceColor: '#FFFFFF',
      textColor: '#0F172A',
      mutedTextColor: '#475569',
      borderColor: '#D6E0F0',
      isDark: false,
    },
  },
  {
    id: 'mutanabbi_night',
    nameAr: 'أمسية المتنبي (ليلي)',
    descriptionAr: 'مظهر ليلي عميق مريح للعين للمطالعة المسائية',
    theme: {
      primaryColor: '#D97706',
      secondaryColor: '#2DD4BF',
      backgroundColor: '#0F172A',
      surfaceColor: '#1E293B',
      textColor: '#F8FAFC',
      mutedTextColor: '#CBD5E1',
      borderColor: '#334155',
      isDark: true,
    },
  },
  {
    id: 'diwan_crimson',
    nameAr: 'عقيق الديوان',
    descriptionAr: 'لمسة أدبية عنابية جادة لتحليل النصوص والمؤلفات',
    theme: {
      primaryColor: '#881337',
      secondaryColor: '#B45309',
      backgroundColor: '#FDFBF9',
      surfaceColor: '#FFFFFF',
      textColor: '#18181B',
      mutedTextColor: '#52525B',
      borderColor: '#E4E4E7',
      isDark: false,
    },
  },
  {
    id: 'classical_charcoal',
    nameAr: 'مداد الخط الكلاسيكي',
    descriptionAr: 'تباين بسيط ومباشر بأسلوب الصفحات الأدبية النظيفة',
    theme: {
      primaryColor: '#18181B',
      secondaryColor: '#0F766E',
      backgroundColor: '#F4F4F5',
      surfaceColor: '#FFFFFF',
      textColor: '#09090B',
      mutedTextColor: '#52525B',
      borderColor: '#D4D4D8',
      isDark: false,
    },
  },
];

export interface InterfaceTemplatePreset {
  id: string;
  nameAr: string;
  descriptionAr: string;
  apply: (current: InterfaceConfig) => InterfaceConfig;
}

export const INTERFACE_TEMPLATES: InterfaceTemplatePreset[] = [
  {
    id: 'simple_calm',
    nameAr: 'واجهة بسيطة مركزة',
    descriptionAr: 'تصميم خفيف بلا تشتيت يبرز الدروس والملفات فقط',
    apply: (current) => ({
      ...cloneInterfaceConfig(current),
      showHeroImage: false,
      showArabicQuote: true,
      theme: { ...PALETTE_PRESETS[1].theme },
      typography: {
        fontFamily: 'IBM Plex Sans Arabic',
        headingFont: 'Cairo',
        scale: 'comfortable',
      },
      layout: {
        ...current.layout,
        layoutStyle: 'minimal_clean',
        heroAlignment: 'minimal',
        cardStyle: 'bordered',
        buttonStyle: 'filled',
        backgroundPattern: 'solid',
        density: 'spacious',
      },
    }),
  },
  {
    id: 'literary_diwan',
    nameAr: 'الديوان الأدبي الإبداعي',
    descriptionAr: 'خط أميري وتصميم أندلسي مع بيت شعري معبر عن العربية',
    apply: (current) => ({
      ...cloneInterfaceConfig(current),
      showHeroImage: true,
      showArabicQuote: true,
      heroImageUrl: '/src/assets/images/arabic_calligraphy_banner_1795203627953.jpg',
      theme: { ...PALETTE_PRESETS[0].theme },
      typography: {
        fontFamily: 'Noto Naskh Arabic',
        headingFont: 'Amiri',
        scale: 'comfortable',
      },
      layout: {
        ...current.layout,
        layoutStyle: 'literary_folio',
        heroAlignment: 'split',
        cardStyle: 'soft_surface',
        buttonStyle: 'filled',
        backgroundPattern: 'warm_paper',
        density: 'standard',
      },
    }),
  },
  {
    id: 'exam_sprint',
    nameAr: 'مسار الامتحان الوطني',
    descriptionAr: 'تنظيم مكثف يقدّم الاختبارات والملفات والمنهجيات في الأعلى',
    apply: (current) => ({
      ...cloneInterfaceConfig(current),
      showHeroImage: true,
      showArabicQuote: false,
      heroImageUrl: '/src/assets/images/arabic_poetry_books_1795203627985.jpg',
      theme: { ...PALETTE_PRESETS[2].theme },
      typography: {
        fontFamily: 'Readex Pro',
        headingFont: 'Cairo',
        scale: 'standard',
      },
      layout: {
        ...current.layout,
        layoutStyle: 'modern_cards',
        heroAlignment: 'centered',
        cardStyle: 'elevated',
        buttonStyle: 'filled',
        backgroundPattern: 'arabesque_subtle',
        density: 'compact',
      },
    }),
  },
];

export interface SectionCatalogEntry {
  type: SectionType;
  defaultTitle: string;
  defaultSubtitle: string;
  defaultIcon: string;
  defaultColumns: 1 | 2 | 3;
}

export const SECTION_CATALOG: SectionCatalogEntry[] = [
  {
    type: 'hero_banner',
    defaultTitle: 'لوحة الترحيب والإشراقة اللغوية',
    defaultSubtitle: 'ترحيب مخصص وبيت شعري معبر عن اللغة العربية',
    defaultIcon: 'Compass',
    defaultColumns: 1,
  },
  {
    type: 'progress_overview',
    defaultTitle: 'ملخص التحصيل في العربية',
    defaultSubtitle: 'متابعة المجزوءات والدروس والملفات والاختبارات',
    defaultIcon: 'BarChart3',
    defaultColumns: 3,
  },
  {
    type: 'subjects_grid',
    defaultTitle: 'مكونات مادة اللغة العربية',
    defaultSubtitle: 'النصوص، علوم اللغة، التعبير والإنشاء، والمؤلفات',
    defaultIcon: 'BookOpen',
    defaultColumns: 2,
  },
  {
    type: 'lessons_list',
    defaultTitle: 'الدروس والشروحات المقررة',
    defaultSubtitle: 'تحليل القصائد والنصوص النظرية وقضايا الشعر الحديث',
    defaultIcon: 'PlayCircle',
    defaultColumns: 2,
  },
  {
    type: 'documents_library',
    defaultTitle: 'مكتبة الملفات والملخصات',
    defaultSubtitle: 'الملفات والنماذج المرفوعة من الأستاذ للتنزيل والمراجعة',
    defaultIcon: 'FileText',
    defaultColumns: 2,
  },
  {
    type: 'exams_assignments',
    defaultTitle: 'الاختبارات والفروض التطبيقية',
    defaultSubtitle: 'نماذج تفاعلية تحاكي الامتحان الوطني للثانية بكالوريا',
    defaultIcon: 'ClipboardCheck',
    defaultColumns: 2,
  },
  {
    type: 'special_tools',
    defaultTitle: 'مختبر اللغة العربية والأدوات',
    defaultSubtitle: 'تقطيع العروض، معجم البلاغة، ومنظم كتابة الإنشاء',
    defaultIcon: 'Wrench',
    defaultColumns: 2,
  },
  {
    type: 'announcements_feed',
    defaultTitle: 'توجيهات وإعلانات الأستاذ',
    defaultSubtitle: 'تنبيهات الحصص والمراجعات الدورية',
    defaultIcon: 'Bell',
    defaultColumns: 1,
  },
  {
    type: 'study_schedule',
    defaultTitle: 'خطة المراجعة الأسبوعية',
    defaultSubtitle: 'توزيع مكونات اللغة العربية على أيام الأسبوع',
    defaultIcon: 'Calendar',
    defaultColumns: 2,
  },
];

export const DEFAULT_INTERFACE_CONFIG: InterfaceConfig = {
  brandTitle: 'منصة بيان للغة العربية',
  gradeLabel: 'الصف الثاني باكالوريا',
  welcomeHeadline: 'مرحباً بك في رحاب اللغة العربية',
  welcomeSubtitle:
    'مساحة مخصصة لطلبة الثانية باكالوريا تضم النصوص وعلوم اللغة والإنشاء والمؤلفات في تصميم هادئ وبسيط.',
  heroImageUrl: DEFAULT_HERO_IMAGE,
  showHeroImage: true,
  showArabicQuote: true,
  arabicQuoteText: CURATED_ARABIC_QUOTES[0].text,
  arabicQuoteAuthor: CURATED_ARABIC_QUOTES[0].author,
  theme: { ...PALETTE_PRESETS[0].theme },
  typography: {
    fontFamily: 'IBM Plex Sans Arabic',
    headingFont: 'Cairo',
    scale: 'standard',
  },
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
  navigation: [
    {
      id: 'nav_subjects',
      label: 'المكونات',
      targetSection: 'subjects_grid',
      iconName: 'BookOpen',
      visible: true,
      order: 1,
    },
    {
      id: 'nav_lessons',
      label: 'الدروس',
      targetSection: 'lessons_list',
      iconName: 'PlayCircle',
      visible: true,
      order: 2,
    },
    {
      id: 'nav_documents',
      label: 'الملفات',
      targetSection: 'documents_library',
      iconName: 'FileText',
      visible: true,
      order: 3,
    },
    {
      id: 'nav_exams',
      label: 'الاختبارات',
      targetSection: 'exams_assignments',
      iconName: 'ClipboardCheck',
      visible: true,
      order: 4,
    },
    {
      id: 'nav_tools',
      label: 'الأدوات',
      targetSection: 'special_tools',
      iconName: 'Wrench',
      visible: true,
      order: 5,
    },
  ],
  sections: [
    {
      id: 'sec_hero',
      type: 'hero_banner',
      title: 'لوحة الترحيب والإشراقة اللغوية',
      subtitle: 'بوابة الثانية باكالوريا في مادة اللغة العربية',
      iconName: 'Compass',
      visible: true,
      order: 1,
      columns: 1,
    },
    {
      id: 'sec_progress',
      type: 'progress_overview',
      title: 'ملخص التحصيل في العربية',
      subtitle: 'نظرة سريعة على المكونات والدروس والملفات المتاحة',
      iconName: 'BarChart3',
      visible: true,
      order: 2,
      columns: 3,
    },
    {
      id: 'sec_announcements',
      type: 'announcements_feed',
      title: 'توجيهات وإعلانات الأستاذ',
      subtitle: 'أهم الملاحظات والتنبيهات الخاصة بالثانية باكالوريا',
      iconName: 'Bell',
      visible: true,
      order: 3,
      columns: 1,
    },
    {
      id: 'sec_subjects',
      type: 'subjects_grid',
      title: 'مكونات مادة اللغة العربية',
      subtitle: 'اختر مكوناً لتصفية دروسه وملفاته بسهولة',
      iconName: 'BookOpen',
      visible: true,
      order: 4,
      columns: 2,
    },
    {
      id: 'sec_lessons',
      type: 'lessons_list',
      title: 'الدروس والشروحات المقررة',
      subtitle: 'اقرأ الشرح المفصل والمنهجية المعتمدة لكل محور',
      iconName: 'PlayCircle',
      visible: true,
      order: 5,
      columns: 2,
    },
    {
      id: 'sec_documents',
      type: 'documents_library',
      title: 'مكتبة الملفات والملخصات',
      subtitle: 'ملفات ومطبوعات اللغة العربية الجاهزة للتنزيل',
      iconName: 'FileText',
      visible: true,
      order: 6,
      columns: 2,
    },
    {
      id: 'sec_exams',
      type: 'exams_assignments',
      title: 'الاختبارات والفروض التطبيقية',
      subtitle: 'تدرب على أسئلة الفهم وعلوم اللغة والمؤلفات',
      iconName: 'ClipboardCheck',
      visible: true,
      order: 7,
      columns: 2,
    },
    {
      id: 'sec_tools',
      type: 'special_tools',
      title: 'مختبر اللغة العربية والأدوات',
      subtitle: 'تقطيع العروض، معجم البلاغة، ومنظم كتابة الإنشاء',
      iconName: 'Wrench',
      visible: true,
      order: 8,
      columns: 2,
    },
  ],
};

export function cloneInterfaceConfig(config: InterfaceConfig): InterfaceConfig {
  return JSON.parse(JSON.stringify(config)) as InterfaceConfig;
}

/**
 * Resolves the effective interface configuration for a student according to priority:
 * Exclusive Isolated Override (future) > Individual Interface > Group Interface > Default Interface.
 */
export function resolveStudentInterface(params: {
  studentId: number;
  groupId: number | null;
  accountTier?: AccountTier;
  exclusiveIsolation?: boolean;
  assignments: InterfaceAssignmentRecord[];
}): InterfaceResolutionResult {
  const activeAssignments = params.assignments.filter((a) => a.isActive);

  if (
    params.accountTier === 'exclusive_reserved' &&
    params.exclusiveIsolation
  ) {
    const exclusiveMatch = activeAssignments.find(
      (a) =>
        a.targetType === 'student' &&
        a.targetId === params.studentId &&
        a.level === 'exclusive_template'
    );
    if (exclusiveMatch) {
      return {
        sourceLevel: 'exclusive_template',
        interfaceId: exclusiveMatch.interfaceId,
        interfaceName: exclusiveMatch.interfaceName,
        priorityApplied: 40,
        exclusiveIsolated: true,
        config: normalizeInterfaceConfig(exclusiveMatch.config),
      };
    }
  }

  const individualMatch = activeAssignments
    .filter((a) => a.targetType === 'student' && a.targetId === params.studentId)
    .sort((a, b) => b.priority - a.priority)[0];

  if (individualMatch) {
    return {
      sourceLevel: individualMatch.level,
      interfaceId: individualMatch.interfaceId,
      interfaceName: individualMatch.interfaceName,
      priorityApplied: 30,
      exclusiveIsolated: Boolean(params.exclusiveIsolation),
      config: normalizeInterfaceConfig(individualMatch.config),
    };
  }

  if (params.groupId !== null && !params.exclusiveIsolation) {
    const groupMatch = activeAssignments
      .filter((a) => a.targetType === 'group' && a.targetId === params.groupId)
      .sort((a, b) => b.priority - a.priority)[0];

    if (groupMatch) {
      return {
        sourceLevel: 'group',
        interfaceId: groupMatch.interfaceId,
        interfaceName: groupMatch.interfaceName,
        priorityApplied: 20,
        exclusiveIsolated: false,
        config: normalizeInterfaceConfig(groupMatch.config),
      };
    }
  }

  const defaultMatch = activeAssignments
    .filter((a) => a.targetType === 'default')
    .sort((a, b) => b.priority - a.priority)[0];

  if (defaultMatch) {
    return {
      sourceLevel: 'default',
      interfaceId: defaultMatch.interfaceId,
      interfaceName: defaultMatch.interfaceName,
      priorityApplied: 10,
      exclusiveIsolated: Boolean(params.exclusiveIsolation),
      config: normalizeInterfaceConfig(defaultMatch.config),
    };
  }

  return {
    sourceLevel: 'default',
    interfaceId: 0,
    interfaceName: 'الواجهة الافتراضية الأساسية',
    priorityApplied: 10,
    exclusiveIsolated: Boolean(params.exclusiveIsolation),
    config: cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG),
  };
}

export function normalizeInterfaceConfig(
  partial: Partial<InterfaceConfig> | null | undefined
): InterfaceConfig {
  const base = cloneInterfaceConfig(DEFAULT_INTERFACE_CONFIG);
  if (!partial || typeof partial !== 'object') {
    return base;
  }

  const sections =
    Array.isArray(partial.sections) && partial.sections.length > 0
      ? [...partial.sections]
          .sort((a, b) => a.order - b.order)
          .map((s, idx) => ({ ...s, order: idx + 1 }))
      : base.sections;

  const navigation =
    Array.isArray(partial.navigation) && partial.navigation.length > 0
      ? [...partial.navigation]
          .sort((a, b) => a.order - b.order)
          .map((n, idx) => ({ ...n, order: idx + 1 }))
      : base.navigation;

  return {
    brandTitle: partial.brandTitle || base.brandTitle,
    gradeLabel: partial.gradeLabel || base.gradeLabel,
    welcomeHeadline: partial.welcomeHeadline || base.welcomeHeadline,
    welcomeSubtitle: partial.welcomeSubtitle || base.welcomeSubtitle,
    heroImageUrl: partial.heroImageUrl || base.heroImageUrl,
    showHeroImage:
      typeof partial.showHeroImage === 'boolean'
        ? partial.showHeroImage
        : base.showHeroImage,
    showArabicQuote:
      typeof partial.showArabicQuote === 'boolean'
        ? partial.showArabicQuote
        : base.showArabicQuote,
    arabicQuoteText: partial.arabicQuoteText ?? base.arabicQuoteText,
    arabicQuoteAuthor: partial.arabicQuoteAuthor ?? base.arabicQuoteAuthor,
    theme: {
      ...base.theme,
      ...(partial.theme || {}),
    },
    typography: {
      ...base.typography,
      ...(partial.typography || {}),
    },
    layout: {
      ...base.layout,
      ...(partial.layout || {}),
    },
    navigation,
    sections,
  };
}

export function reorderOrderedItems<T extends { id: string; order: number }>(
  items: T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items;
  }
  const copy = [...items];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy.map((item, idx) => ({ ...item, order: idx + 1 }));
}

export function addSectionToConfig(
  config: InterfaceConfig,
  sectionType: SectionType
): InterfaceConfig {
  const catalogItem = SECTION_CATALOG.find((c) => c.type === sectionType);
  if (!catalogItem) return config;

  const nextSection: InterfaceSection = {
    id: `sec_${sectionType}_${Date.now()}`,
    type: sectionType,
    title: catalogItem.defaultTitle,
    subtitle: catalogItem.defaultSubtitle,
    iconName: catalogItem.defaultIcon,
    visible: true,
    order: config.sections.length + 1,
    columns: catalogItem.defaultColumns,
  };

  return {
    ...config,
    sections: [...config.sections, nextSection],
  };
}

export function addNavItemToConfig(
  config: InterfaceConfig,
  item: Omit<NavMenuItem, 'id' | 'order'>
): InterfaceConfig {
  const nextNav: NavMenuItem = {
    ...item,
    id: `nav_${Date.now()}`,
    order: config.navigation.length + 1,
  };
  return {
    ...config,
    navigation: [...config.navigation, nextNav],
  };
}
