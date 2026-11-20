import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  MessageSquareCode,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { OtpPolicySettings, WhatsAppIntegrationStatus } from '../shared/types.ts';

interface EnvReadinessItem {
  key: string;
  labelAr: string;
  configured: boolean;
}

interface SecurityAuditRow {
  id: number;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  ip_address: string;
  user_agent: string;
  details_json: string;
  created_at: string;
  actor_name: string | null;
  target_name: string | null;
}

const EVENT_LABELS_AR: Record<string, string> = {
  admin_bootstrapped: 'تهيئة حساب المشرف العام لأول مرة',
  login_success: 'تسجيل دخول ناجح',
  login_failed: 'محاولة دخول فاشلة',
  login_blocked_suspended: 'حظر دخول لحساب موقوف',
  logout: 'تسجيل خروج',
  student_created: 'إنشاء حساب طالب جديد',
  student_updated: 'تحديث بيانات طالب',
  student_password_reset: 'إعادة تعيين كلمة مرور طالب',
  session_revoked: 'إنهاء جلسة نشطة',
  all_sessions_revoked: 'إنهاء جميع الجلسات النشطة للطالب',
  interface_created: 'إنشاء واجهة مخصصة جديدة',
  interface_draft_saved: 'حفظ مسودة واجهة',
  interface_published: 'نشر واعتماد واجهة',
  interface_rollback: 'استعادة إصدار سابق للواجهة',
  interface_override_removed: 'إلغاء تخصيص واجهة',
  permission_updated: 'تعديل صلاحية وصول لمحتوى',
  permission_override_cleared: 'استعادة صلاحية موروثة',
  security_settings_updated: 'تحديث سياسات الأمان وواتساب',
  otp_challenge_created: 'توليد تحدي رمز تحقق OTP',
  otp_verified_login: 'تسجيل دخول بعد التحقق من الرمز',
  otp_verification_failed: 'إدخال رمز تحقق غير صحيح',
  otp_resent: 'إعادة إرسال رمز التحقق',
  exam_submitted: 'تسليم إجابات اختبار',
};

export function AdminSecurityWhatsAppPanel() {
  const [policy, setPolicy] = useState<OtpPolicySettings | null>(null);
  const [waStatus, setWaStatus] = useState<WhatsAppIntegrationStatus | null>(null);
  const [envReadiness, setEnvReadiness] = useState<EnvReadinessItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecurityAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await apiFetch<{
        policy: OtpPolicySettings;
        whatsappStatus: WhatsAppIntegrationStatus;
        envReadiness: EnvReadinessItem[];
        auditLogs: SecurityAuditRow[];
      }>('/api/admin/security/settings');
      setPolicy(res.policy);
      setWaStatus(res.whatsappStatus);
      setEnvReadiness(res.envReadiness);
      setAuditLogs(res.auditLogs);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل إعدادات الأمان.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function handleSavePolicy(e: FormEvent) {
    e.preventDefault();
    if (!policy) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        policy: OtpPolicySettings;
        whatsappStatus: WhatsAppIntegrationStatus;
      }>('/api/admin/security/settings', {
        method: 'PUT',
        body: JSON.stringify(policy),
      });
      setPolicy(res.policy);
      setWaStatus(res.whatsappStatus);
      setFeedback({ type: 'success', text: 'تم حفظ سياسات الأمان وإعدادات التحقق بنجاح.' });
      await loadSettings();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث الإعدادات.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !policy || !waStatus) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        جاري تحميل وحدة الأمان والتكامل...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Future WhatsApp 2FA Status Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-teal-800 text-xs font-semibold">
              <MessageSquareCode className="w-4 h-4" />
              <span>وحدة التحقق الثنائي المستقبلية (WhatsApp Business Cloud API)</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 font-display">
              إعدادات المصادقة الثنائية عبر واتساب الرسمي
            </h2>
            <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
              تعتمد المنصة البنية الرسمية لواجهة WhatsApp Business Cloud API فقط دون أي
              مكتبات غير رسمية، وتبقى الخدمة معطلة افتراضياً حتى يتم توفير بيانات الربط في
              متغيرات البيئة وتفعيلها يدوياً من قبل المشرف العام.
            </p>
          </div>
          <div className="shrink-0">
            {waStatus.enabled ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                <ShieldCheck className="w-4 h-4" />
                <span>مفعّل ونشط</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Lock className="w-4 h-4 text-amber-600" />
                <span>معطل افتراضياً</span>
              </span>
            )}
          </div>
        </div>

        {/* Arabic Configuration Notice */}
        <div
          role="note"
          className={`p-4 rounded-lg border flex items-start gap-3 text-xs leading-relaxed ${
            waStatus.configured
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold mb-1">حالة التهيئة الحالية:</div>
            <p>{waStatus.noticeAr}</p>
          </div>
        </div>

        {/* Server Env Variables Readiness (no secrets exposed) */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-800">
            جاهزية متغيرات البيئة على الخادم (تُدار عبر إعدادات الخادم فقط)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {envReadiness.map((item) => (
              <div
                key={item.key}
                className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-800">{item.labelAr}</div>
                  <div className="font-tabular text-[11px] text-slate-500 mt-0.5" dir="ltr">
                    {item.key}
                  </div>
                </div>
                <span
                  className={`font-bold shrink-0 ${
                    item.configured ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {item.configured ? 'مهيأ' : 'غير مهيأ'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {feedback && (
          <div
            role="status"
            className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Security & OTP Policy Controls */}
        <form onSubmit={handleSavePolicy} className="space-y-4 pt-3 border-t border-slate-200">
          <div className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 bg-slate-50">
            <div>
              <div className="text-xs font-bold text-slate-900">
                تفعيل التحقق الثنائي للطلاب عند تسجيل الدخول
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {waStatus.configured
                  ? 'بيانات الربط جاهزة، يمكنك التفعيل أو الإيقاف في أي وقت.'
                  : 'يتطلب التفعيل إضافة بيانات WhatsApp Business Cloud API في متغيرات البيئة أولاً.'}
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold">
              <input
                type="checkbox"
                checked={policy.whatsapp2faEnabled}
                onChange={(e) =>
                  setPolicy((prev) =>
                    prev ? { ...prev, whatsapp2faEnabled: e.target.checked } : prev
                  )
                }
              />
              <span>{policy.whatsapp2faEnabled ? 'مفعّل' : 'معطل'}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                مدة صلاحية رمز التحقق (بالثواني)
              </label>
              <input
                type="number"
                min={60}
                max={1800}
                value={policy.otpExpirySeconds}
                onChange={(e) =>
                  setPolicy((prev) =>
                    prev ? { ...prev, otpExpirySeconds: Number(e.target.value) } : prev
                  )
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                فترة الانتظار لإعادة الإرسال (بالثواني)
              </label>
              <input
                type="number"
                min={30}
                max={300}
                value={policy.resendCooldownSeconds}
                onChange={(e) =>
                  setPolicy((prev) =>
                    prev ? { ...prev, resendCooldownSeconds: Number(e.target.value) } : prev
                  )
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                الحد الأقصى لمحاولات إدخال الرمز
              </label>
              <input
                type="number"
                min={3}
                max={10}
                value={policy.maxOtpAttempts}
                onChange={(e) =>
                  setPolicy((prev) =>
                    prev ? { ...prev, maxOtpAttempts: Number(e.target.value) } : prev
                  )
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                الحد الأقصى لمحاولات الدخول الفاشلة
              </label>
              <input
                type="number"
                min={3}
                max={15}
                value={policy.maxLoginAttempts}
                onChange={(e) =>
                  setPolicy((prev) =>
                    prev ? { ...prev, maxLoginAttempts: Number(e.target.value) } : prev
                  )
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                مدة الحظر المؤقت بعد المحاولات الفاشلة (ثانية)
              </label>
              <input
                type="number"
                min={60}
                max={3600}
                value={policy.lockoutSeconds}
                onChange={(e) =>
                  setPolicy((prev) =>
                    prev ? { ...prev, lockoutSeconds: Number(e.target.value) } : prev
                  )
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ سياسات الأمان'}
            </button>
          </div>
        </form>
      </div>

      {/* Security Audit Logs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900">سجل المراجعة الأمنية والعمليات</h3>
          <span className="text-xs text-slate-500 tabular-nums">
            آخر {auditLogs.length} حدث
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-4 font-semibold">الحدث</th>
                <th className="py-2.5 px-4 font-semibold">المنفذ</th>
                <th className="py-2.5 px-4 font-semibold">الحساب المستهدف</th>
                <th className="py-2.5 px-4 font-semibold">عنوان IP</th>
                <th className="py-2.5 px-4 font-semibold">التاريخ والوقت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-medium text-slate-900 flex items-center gap-1.5">
                    {log.severity === 'critical' ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    ) : log.severity === 'warning' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                    )}
                    <span>{EVENT_LABELS_AR[log.event_type] || log.event_type}</span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">{log.actor_name || 'النظام'}</td>
                  <td className="py-2.5 px-4 text-slate-700">{log.target_name || '—'}</td>
                  <td className="py-2.5 px-4 font-tabular text-slate-600" dir="ltr">
                    {log.ip_address}
                  </td>
                  <td className="py-2.5 px-4 font-tabular text-slate-500">
                    {new Date(log.created_at).toLocaleString('ar-SA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
