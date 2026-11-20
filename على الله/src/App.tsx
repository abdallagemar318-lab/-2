/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { LoginView } from './components/LoginView.tsx';
import {
  StudentPortal,
  type StudentWorkspacePayload,
} from './components/StudentPortal.tsx';
import { apiFetch, setAuthToken } from './lib/api.ts';
import type { AuthUserSummary } from './shared/types.ts';

export default function App() {
  const [user, setUser] = useState<AuthUserSummary | null>(null);
  const [studentWorkspace, setStudentWorkspace] =
    useState<StudentWorkspacePayload | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const fetchStudentWorkspace = useCallback(async () => {
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const data = await apiFetch<StudentWorkspacePayload>('/api/student/workspace');
      setStudentWorkspace(data);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'تعذر تحميل المساحة التعليمية.'
      );
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    if (user && user.role === 'student') {
      void fetchStudentWorkspace();
    } else {
      setStudentWorkspace(null);
    }
  }, [user, fetchStudentWorkspace]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local memory session regardless
    }
    setAuthToken(null);
    setUser(null);
    setStudentWorkspace(null);
  }

  if (!user) {
    return <LoginView onAuthenticated={(authUser) => setUser(authUser)} />;
  }

  if (user.role === 'super_admin') {
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  if (loadingWorkspace && !studentWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="text-base font-bold text-slate-900">
            جاري تجهيز واجهتك التعليمية المخصصة...
          </div>
          <div className="text-xs text-slate-500">
            يتم التحقق من صلاحيات الوصول وتطبيق تصميم الحساب
          </div>
        </div>
      </div>
    );
  }

  if (workspaceError || !studentWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-900">تعذر فتح البوابة</h1>
          <p className="text-sm text-red-700">
            {workspaceError || 'حدث خطأ غير متوقع أثناء تحميل المساحة.'}
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => void fetchStudentWorkspace()}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
            >
              إعادة المحاولة
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <StudentPortal
      user={user}
      workspace={studentWorkspace}
      onLogout={handleLogout}
      onRefreshWorkspace={() => void fetchStudentWorkspace()}
    />
  );
}
