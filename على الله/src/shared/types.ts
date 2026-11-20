export type UserRole = 'super_admin' | 'student';
export type AccountStatus = 'active' | 'suspended';
export type AccountTier = 'standard' | 'exclusive_reserved';
export type InterfaceLevel = 'default' | 'group' | 'individual' | 'exclusive_template';

export type SectionType =
  | 'hero_banner'
  | 'progress_overview'
  | 'subjects_grid'
  | 'lessons_list'
  | 'documents_library'
  | 'exams_assignments'
  | 'special_tools'
  | 'announcements_feed'
  | 'study_schedule';

export type ArabicFontFamily =
  | 'IBM Plex Sans Arabic'
  | 'Cairo'
  | 'Tajawal'
  | 'Almarai'
  | 'Amiri'
  | 'Noto Naskh Arabic'
  | 'Readex Pro';

export type BackgroundPattern =
  | 'solid'
  | 'warm_paper'
  | 'arabesque_subtle'
  | 'calligraphy_lines'
  | 'night_slate';

export type LayoutStyle = 'minimal_clean' | 'literary_folio' | 'modern_cards';
export type HeroAlignment = 'split' | 'centered' | 'minimal';
export type CardStyle = 'bordered' | 'soft_surface' | 'elevated';
export type ButtonStyle = 'filled' | 'outline';

export interface InterfaceTheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  isDark: boolean;
}

export interface InterfaceTypography {
  fontFamily: ArabicFontFamily;
  headingFont: ArabicFontFamily;
  scale: 'compact' | 'standard' | 'comfortable';
}

export interface InterfaceLayout {
  borderRadius: 'sharp' | 'balanced' | 'soft';
  density: 'compact' | 'standard' | 'spacious';
  backgroundPattern: BackgroundPattern;
  iconStyle: 'classic' | 'academic' | 'minimal';
  layoutStyle: LayoutStyle;
  heroAlignment: HeroAlignment;
  cardStyle: CardStyle;
  buttonStyle: ButtonStyle;
}

export interface NavMenuItem {
  id: string;
  label: string;
  targetSection: SectionType;
  iconName: string;
  visible: boolean;
  order: number;
}

export interface InterfaceSection {
  id: string;
  type: SectionType;
  title: string;
  subtitle: string;
  iconName: string;
  visible: boolean;
  order: number;
  columns: 1 | 2 | 3;
}

export interface InterfaceConfig {
  brandTitle: string;
  gradeLabel: string;
  welcomeHeadline: string;
  welcomeSubtitle: string;
  heroImageUrl: string;
  showHeroImage: boolean;
  showArabicQuote: boolean;
  arabicQuoteText: string;
  arabicQuoteAuthor: string;
  theme: InterfaceTheme;
  typography: InterfaceTypography;
  layout: InterfaceLayout;
  navigation: NavMenuItem[];
  sections: InterfaceSection[];
}

export interface InterfaceAssignmentRecord {
  id: number;
  interfaceId: number;
  interfaceName: string;
  level: InterfaceLevel;
  targetType: 'default' | 'group' | 'student';
  targetId: number | null;
  priority: number;
  isActive: boolean;
  config: InterfaceConfig;
}

export interface InterfaceResolutionResult {
  sourceLevel: InterfaceLevel;
  interfaceId: number;
  interfaceName: string;
  priorityApplied: number;
  exclusiveIsolated: boolean;
  config: InterfaceConfig;
}

export type ResourceType =
  | 'subject'
  | 'lesson'
  | 'document'
  | 'exam'
  | 'tool'
  | 'announcement';

export interface PermissionRule {
  targetType: 'group' | 'student';
  targetId: number;
  resourceType: ResourceType;
  resourceId: number;
  isAllowed: boolean;
}

export interface StudentAccessContext {
  studentId: number;
  groupId: number | null;
  accountTier: AccountTier;
  exclusiveIsolation: boolean;
}

export interface AuthUserSummary {
  id: number;
  fullName: string;
  phone: string;
  role: UserRole;
  status: AccountStatus;
  groupId: number | null;
  groupName: string | null;
  accountTier: AccountTier;
  exclusiveIsolation: boolean;
  lastLoginAt: string | null;
}

export interface OtpPolicySettings {
  whatsapp2faEnabled: boolean;
  otpExpirySeconds: number;
  resendCooldownSeconds: number;
  maxOtpAttempts: number;
  rateLimitWindowSeconds: number;
  maxLoginAttempts: number;
  lockoutSeconds: number;
}

export interface WhatsAppIntegrationStatus {
  enabled: boolean;
  configured: boolean;
  dryRunMode: boolean;
  providerName: string;
  apiVersion: string;
  templateLanguage: string;
  missingEnvKeys: string[];
  noticeAr: string;
}

export interface ExamQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  marks: number;
}
