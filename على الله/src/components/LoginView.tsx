import { useEffect, useState, type FormEvent } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  MessageSquareCode,
  Phone,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api.ts';
import type { AuthUserSummary } from '../shared/types.ts';
import { SafeImage } from './SafeImage.tsx';

interface AuthStatusResponse {
  hasSuperAdmin: boolean;
  publicRegistrationAllowed: boolean;
  whatsapp2fa: {
    enabled: boolean;
    configured: boolean;
    noticeAr: string;
  };
}

interface LoginViewProps {
  onAuthenticated: (user: AuthUserSummary) => void;
}

export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // First-run admin setup fields
  const [adminName, setAdminName] = useState('المشرف العام');
  const [adminPhone, setAdminPhone] = useState('0500000000');
  const [adminPassword, setAdminPassword] = useState('');

  // Standard login fields
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Future WhatsApp 2FA challenge state
  const [otpChallenge, setOtpChallenge] = useState<{
    challengeToken: string;
    maskedPhone: string;
    resendCooldownSeconds: number;
  } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch<AuthStatusResponse>('/api/auth/status')
      .then((res) => {
        if (active) {
          setAuthStatus(res);
          setStatusLoading(false);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setErrorMsg(err.message);
          setStatusLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const id = window.setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownRemaining]);

  async function handleBootstrapAdmin(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUserSummary }>(
        '/api/auth/bootstrap-admin',
        {
          method: 'POST',
          body: JSON.stringify({
            fullName: adminName,
            phone: adminPhone,
            password: adminPassword,
          }),
        }
      );
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إعداد الحساب.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        requiresTwoFactor: boolean;
        token?: string;
        user?: AuthUserSummary;
        challengeToken?: string;
        maskedPhone?: string;
        resendCooldownSeconds?: number;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });

      if (res.requiresTwoFactor && res.challengeToken) {
        setOtpChallenge({
          challengeToken: res.challengeToken,
          maskedPhone: res.maskedPhone || '****',
          resendCooldownSeconds: res.resendCooldownSeconds || 60,
        });
        setCooldownRemaining(res.resendCooldownSeconds || 60);
      } else if (res.token && res.user) {
        setAuthToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل الدخول.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!otpChallenge) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUserSummary }>(
        '/api/auth/verify-otp',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeToken: otpChallenge.challengeToken,
            otpCode,
          }),
        }
      );
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر التحقق من الرمز.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendOtp() {
    if (!otpChallenge || cooldownRemaining > 0) return;
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ resendCooldownSeconds: number }>(
        '/api/auth/resend-otp',
        {
          method: 'POST',
          body: JSON.stringify({ challengeToken: otpChallenge.challengeToken }),
        }
      );
      setCooldownRemaining(res.resendCooldownSeconds || 60);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إعادة إرسال الرمز.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="text-xl font-bold text-slate-900 font-display whitespace-nowrap shrink-0">
            منصة بيان للغة العربية
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <span className="whitespace-nowrap shrink-0">الصف الثاني باكالوريا</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="whitespace-nowrap shrink-0">النصوص وعلوم اللغة والإنشاء والمؤلفات</span>
          </nav>
          <span className="text-xs font-medium text-teal-700 whitespace-nowrap shrink-0">
            دخول مصرح به فقط
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-center">
          {statusLoading ? (
            <div className="space-y-4 animate-pulse" aria-busy="true">
              <div className="h-7 w-48 bg-slate-200 rounded" />
              <div className="h-4 w-72 bg-slate-100 rounded" />
              <div className="h-11 w-full bg-slate-100 rounded-lg" />
              <div className="h-11 w-full bg-slate-100 rounded-lg" />
              <div className="h-11 w-full bg-slate-200 rounded-lg" />
            </div>
          ) : authStatus && !authStatus.hasSuperAdmin ? (
            <div>
              <div className="flex items-center gap-2 text-teal-700 text-xs font-semibold mb-2">
                <UserCheck className="w-4 h-4" />
                <span>التهيئة الأولية للنظام</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 font-display mb-2">
                إعداد حساب المشرف العام
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed mb-6">
                لا يوجد حساب مشرف عام مسجل حتى الآن. قم بتعيين بيانات المشرف العام
                لإدارة حسابات الطلاب، وتخصيص الواجهات المرئية، وضبط الصلاحيات.
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleBootstrapAdmin} className="space-y-4">
                <div>
                  <label
                    htmlFor="admin-name"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    الاسم الكامل للمشرف العام
                  </label>
                  <input
                    id="admin-name"
                    type="text"
                    required
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    placeholder="أدخل الاسم الكامل"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-phone"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    رقم الهاتف المعتمد للدخول
                  </label>
                  <input
                    id="admin-phone"
                    type="tel"
                    dir="ltr"
                    required
                    value={adminPhone}
                    onChange={(e) => setAdminPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-slate-900 text-right font-tabular focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    placeholder="0500000000"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-password"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    كلمة المرور (٨ أحرف على الأقل)
                  </label>
                  <input
                    id="admin-password"
                    type="password"
                    required
                    minLength={8}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    placeholder="اختر كلمة مرور قوية"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {submitting ? 'جاري التهيئة...' : 'اعتماد حساب المشرف العام والدخول'}
                </button>
              </form>
            </div>
          ) : otpChallenge ? (
            <div>
              <div className="flex items-center gap-2 text-teal-700 text-xs font-semibold mb-2">
                <MessageSquareCode className="w-4 h-4" />
                <span>التحقق الثنائي عبر واتساب</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 font-display mb-2">
                أدخل رمز التحقق المرسل
              </h1>
              <p className="text-sm text-slate-600 mb-6">
                تم إرسال رمز تحقق مكون من ٦ أرقام إلى رقم الواتساب المسجل{' '}
                <span className="font-tabular font-semibold text-slate-800" dir="ltr">
                  {otpChallenge.maskedPhone}
                </span>
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label
                    htmlFor="otp-code"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    رمز التحقق (٦ أرقام)
                  </label>
                  <input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    dir="ltr"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-center text-lg tracking-widest font-tabular text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="000000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {submitting ? 'جاري التحقق...' : 'تأكيد الرمز والدخول'}
                </button>

                <div className="flex items-center justify-between pt-2 text-sm">
                  <button
                    type="button"
                    disabled={cooldownRemaining > 0}
                    onClick={handleResendOtp}
                    className="text-teal-700 hover:text-teal-800 disabled:text-slate-400 font-medium cursor-pointer"
                  >
                    {cooldownRemaining > 0
                      ? `إعادة الإرسال بعد ${cooldownRemaining} ث`
                      : 'إعادة إرسال الرمز'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpChallenge(null);
                      setOtpCode('');
                      setErrorMsg(null);
                    }}
                    className="text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    العودة لتسجيل الدخول
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-teal-700 text-xs font-semibold mb-2">
                <ShieldCheck className="w-4 h-4" />
                <span>بوابة الدخول الموحدة</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 font-display mb-2">
                تسجيل الدخول إلى المنصة
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed mb-6">
                أدخل رقم الهاتف المسجل وكلمة المرور للوصول إلى مساحتك التعليمية
                المخصصة أو لوحة التحكم الإدارية.
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-phone"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    رقم الهاتف المسجل
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="login-phone"
                      type="tel"
                      dir="ltr"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full pr-10 pl-3.5 py-2.5 border border-slate-300 rounded-lg text-slate-900 text-right font-tabular focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                      placeholder="05XXXXXXXX"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pr-10 pl-10 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                      placeholder="أدخل كلمة المرور"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute left-3 top-2.5 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {submitting ? 'جاري التحقق من البيانات...' : 'تسجيل الدخول'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-200 space-y-2 text-xs text-slate-500">
                <p>
                  يتم إنشاء حسابات الطلاب وتعيين أرقام الهواتف وكلمات المرور
                  الأولية حصرياً عن طريق المشرف العام. لا تتوفر خدمة تسجيل عام
                  ذاتي.
                </p>
                {authStatus && (
                  <p className="text-slate-600">
                    حالة التحقق عبر واتساب:{' '}
                    <span className="font-semibold text-slate-800">
                      {authStatus.whatsapp2fa.enabled ? 'مفعل' : 'معطل افتراضياً'}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-6 relative rounded-xl overflow-hidden border border-slate-200 min-h-[340px] lg:min-h-full">
          <SafeImage
            src="/src/assets/images/arabic_calligraphy_banner_1795203627953.jpg"
            alt="رحاب اللغة العربية في منصة بيان للثانية باكالوريا"
            className="w-full h-full object-cover"
            fallbackTitle="منصة بيان للغة العربية"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/50 to-transparent flex flex-col justify-end p-6 sm:p-8 text-white">
            <p className="text-xs font-medium text-amber-300 mb-2">
              اللغة العربية · الصف الثاني باكالوريا
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold font-display leading-snug mb-3">
              بوابة أدبية مخصصة وبسيطة لكل طالب بإشراف إداري كامل
            </h2>
            <p className="text-sm text-slate-200 leading-relaxed max-w-lg">
              مساحة متخصصة في النصوص الشعرية والنقدية وعلوم اللغة والإنشاء والمؤلفات،
              بواجهات مصممة خصيصاً بجماليات العربية وخطوطها التراثية والحديثة.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
