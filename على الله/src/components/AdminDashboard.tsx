import { useEffect, useState, type FormEvent } from 'react';
import {
  BellPlus,
  ClipboardCheck,
  LayoutDashboard,
  LayoutTemplate,
  Lock,
  LogOut,
  Menu,
  ShieldCheck,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { formatAuditEventAr } from '../shared/auditLabels.ts';
import type { AuthUserSummary, WhatsAppIntegrationStatus } from '../shared/types.ts';
import { AdminContentUploadPanel } from './AdminContentUploadPanel.tsx';
import { AdminExamsPanel } from './AdminExamsPanel.tsx';
import { AdminPermissionsPanel } from './AdminPermissionsPanel.tsx';
import { AdminSecurityWhatsAppPanel } from './AdminSecurityWhatsAppPanel.tsx';
import { AdminUsersPanel } from './AdminUsersPanel.tsx';
import { VisualInterfaceEditor } from './VisualInterfaceEditor.tsx';

type AdminSection = 'overview' | 'editor' | 'content' | 'exams' | 'users' | 'permissions' | 'security';

interface OverviewPayload {
  stats: {
    totalStudents: number;
    activeStudents: number;
    suspendedStudents: number;
    totalGroups: number;
    activeSessions: number;
    individualInterfaces: number;
    groupInterfaces: number;
    subjectsCount: number;
  };
  whatsappStatus: WhatsAppIntegrationStatus;
  recentLogs: Array<{
    id: number;
    event_type: string;
    severity: string;
    ip_address: string;
    created_at: string;
    actor_name: string | null;
    target_name: string | null;
  }>;
}

interface AdminDashboardProps {
  user: AuthUserSummary;
  onLogout: () => void;
}

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [editorTargetStudentId, setEditorTargetStudentId] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPriority, setAnnPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [annStatus, setAnnStatus] = useState<string | null>(null);

  async function loadOverview() {
    try {
      const res = await apiFetch<OverviewPayload>('/api/admin/overview');
      setOverview(res);
    } catch {
      // handled cleanly by empty state
    }
  }

  useEffect(() => {
    if (activeSection === 'overview') {
      void loadOverview();
    }
  }, [activeSection]);

  async function handlePublishAnnouncement(e: FormEvent) {
    e.preventDefault();
    setAnnStatus(null);
    try {
      await apiFetch('/api/admin/content/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: annTitle,
          body: annBody,
          priorityLevel: annPriority,
        }),
      });
      setAnnTitle('');
      setAnnBody('');
      setAnnStatus('تم نشر الإعلان للطلاب بنجاح.');
      await loadOverview();
    } catch (err) {
      setAnnStatus(err instanceof Error ? err.message : 'تعذر نشر الإعلان.');
    }
  }

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: typeof LayoutDashboard;
  }> = [
    { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
    { id: 'editor', label: 'محرر الواجهات المرئي', icon: LayoutTemplate },
    { id: 'content', label: 'المحتوى ورفع الملفات', icon: UploadCloud },
    { id: 'exams', label: 'الاختبارات ومكافحة الغش', icon: ClipboardCheck },
    { id: 'users', label: 'الطلاب والجلسات', icon: Users },
    { id: 'permissions', label: 'صلاحيات المحتوى', icon: Lock },
    { id: 'security', label: 'الأمان وواتساب 2FA', icon: ShieldCheck },
  ];

  const activeTitle = navItems.find((n) => n.id === activeSection)?.label || 'لوحة التحكم';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-[260px] lg:flex-col lg:shrink-0 bg-white border-l border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-lg font-bold text-slate-900 font-display">
            منصة بيان للغة العربية
          </div>
          <div className="text-xs text-teal-700 font-medium mt-0.5">
            الثانية باكالوريا · المشرف العام
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="قائمة الإدارة">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id !== 'editor') setEditorTargetStudentId(null);
                  setActiveSection(item.id);
                }}
                className={`w-full px-3.5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <div className="font-bold text-slate-900">{user.fullName}</div>
            <div className="text-slate-500 font-tabular mt-0.5" dir="ltr">
              {user.phone}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full py-2 px-3 border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden flex">
          <div className="w-72 bg-white h-full p-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-base text-slate-900 font-display">
                  إدارة المشرف العام
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="إغلاق القائمة"
                  className="p-1 text-slate-500 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveSection(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full px-3.5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2.5 cursor-pointer ${
                        activeSection === item.id
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="w-full py-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 cursor-pointer"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح قائمة التنقل"
              className="lg:hidden p-2 border border-slate-200 rounded-lg text-slate-700 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 hidden sm:inline">لوحة التحكم</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-bold text-slate-900 font-display">{activeTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveSection('content')}
              className="px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              رفع ملف دراسي
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('editor')}
              className="px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              تخصيص الواجهات
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeSection === 'overview' && (
            <div className="space-y-6">
              {overview && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs text-slate-500 font-medium">حسابات الطلاب</div>
                    <div className="text-2xl font-bold text-slate-900 font-tabular mt-1">
                      {overview.stats.totalStudents}
                    </div>
                    <div className="text-xs text-slate-600 mt-1 tabular-nums">
                      {overview.stats.activeStudents} نشط · {overview.stats.suspendedStudents} موقوف
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs text-slate-500 font-medium">الواجهات المخصصة</div>
                    <div className="text-2xl font-bold text-teal-700 font-tabular mt-1">
                      {overview.stats.individualInterfaces + overview.stats.groupInterfaces}
                    </div>
                    <div className="text-xs text-slate-600 mt-1 tabular-nums">
                      {overview.stats.individualInterfaces} فردية · {overview.stats.groupInterfaces} مجموعات
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs text-slate-500 font-medium">الجلسات النشطة الآن</div>
                    <div className="text-2xl font-bold text-slate-900 font-tabular mt-1">
                      {overview.stats.activeSessions}
                    </div>
                    <div className="text-xs text-slate-600 mt-1 tabular-nums">
                      ضمن {overview.stats.totalGroups} مجموعات دراسية
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs text-slate-500 font-medium">التحقق عبر واتساب</div>
                    <div className="text-lg font-bold text-slate-900 mt-1">
                      {overview.whatsappStatus.enabled ? 'مفعّل' : 'معطل افتراضياً'}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      {overview.whatsappStatus.configured
                        ? 'بيانات الربط متوفرة'
                        : 'بانتظار بيانات الخادم'}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                    <BellPlus className="w-4 h-4 text-teal-700" />
                    <h2 className="font-bold text-sm text-slate-900">
                      نشر إعلان تعليمي جديد للطلاب
                    </h2>
                  </div>
                  <form onSubmit={handlePublishAnnouncement} className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        عنوان الإعلان
                      </label>
                      <input
                        type="text"
                        required
                        value={annTitle}
                        onChange={(e) => setAnnTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        placeholder="مثال: تحديث جدول المراجعة المباشرة"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        مستوى الأهمية
                      </label>
                      <select
                        value={annPriority}
                        onChange={(e) =>
                          setAnnPriority(e.target.value as 'normal' | 'important' | 'urgent')
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                      >
                        <option value="normal">إعلان عادي</option>
                        <option value="important">توجيه مهم</option>
                        <option value="urgent">تنبيه عاجل</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        نص الإعلان
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={annBody}
                        onChange={(e) => setAnnBody(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        placeholder="اكتب تفاصيل التوجيه أو الموعد..."
                      />
                    </div>
                    {annStatus && (
                      <p className="text-xs font-semibold text-teal-700">{annStatus}</p>
                    )}
                    <button
                      type="submit"
                      className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      نشر الإعلان
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <h2 className="font-bold text-sm text-slate-900">أحدث الأنشطة الإدارية</h2>
                    <button
                      type="button"
                      onClick={() => setActiveSection('security')}
                      className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                    >
                      عرض السجل الكامل
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(overview?.recentLogs || []).slice(0, 6).map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">
                            {formatAuditEventAr(log.event_type)}
                          </span>
                          {log.target_name && (
                            <span className="text-slate-500"> · {log.target_name}</span>
                          )}
                        </div>
                        <span className="font-tabular text-slate-500">
                          {new Date(log.created_at).toLocaleTimeString('ar-SA')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'editor' && (
            <VisualInterfaceEditor
              adminUser={user}
              initialStudentId={editorTargetStudentId}
            />
          )}

          {activeSection === 'content' && <AdminContentUploadPanel />}

          {activeSection === 'exams' && <AdminExamsPanel />}

          {activeSection === 'users' && (
            <AdminUsersPanel
              onCustomizeStudentInterface={(stuId) => {
                setEditorTargetStudentId(stuId);
                setActiveSection('editor');
              }}
            />
          )}

          {activeSection === 'permissions' && <AdminPermissionsPanel />}

          {activeSection === 'security' && <AdminSecurityWhatsAppPanel />}
        </main>
      </div>
    </div>
  );
}
