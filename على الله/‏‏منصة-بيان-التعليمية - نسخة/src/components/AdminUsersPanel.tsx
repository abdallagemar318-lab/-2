import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  KeyRound,
  LayoutTemplate,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { formatAuditEventAr } from '../shared/auditLabels.ts';

interface GroupRecord {
  id: number;
  name: string;
  description: string;
  student_count: number;
}

interface StudentRecord {
  id: number;
  fullName: string;
  phone: string;
  status: 'active' | 'suspended';
  groupId: number | null;
  groupName: string | null;
  accountTier: 'standard' | 'exclusive_reserved';
  exclusiveIsolation: boolean;
  notes: string;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
  effectiveInterface: {
    sourceLevel: string;
    interfaceName: string;
  };
}

interface SessionItem {
  id: number;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface AuditItem {
  id: number;
  event_type: string;
  severity: string;
  ip_address: string;
  created_at: string;
}

interface AdminUsersPanelProps {
  onCustomizeStudentInterface: (studentId: number) => void;
}

export function AdminUsersPanel({
  onCustomizeStudentInterface,
}: AdminUsersPanelProps) {
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Create student form
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newGroupId, setNewGroupId] = useState<string>('');
  const [newNotes, setNewNotes] = useState('');

  // Create group form
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');

  // Edit / Password / Sessions drawers
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editGroupId, setEditGroupId] = useState<string>('');
  const [editNotes, setEditNotes] = useState('');
  const [editExclusiveTier, setEditExclusiveTier] = useState(false);

  const [resetTarget, setResetTarget] = useState<StudentRecord | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  const [sessionsTarget, setSessionsTarget] = useState<StudentRecord | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionItem[]>([]);
  const [loginHistoryList, setLoginHistoryList] = useState<AuditItem[]>([]);

  async function loadData() {
    setLoading(true);
    try {
      const [stuRes, grpRes] = await Promise.all([
        apiFetch<{ students: StudentRecord[] }>('/api/admin/students'),
        apiFetch<{ groups: GroupRecord[] }>('/api/admin/groups'),
      ]);
      setStudents(stuRes.students);
      setGroups(grpRes.groups);
      if (grpRes.groups.length > 0 && !newGroupId) {
        setNewGroupId(String(grpRes.groups[0].id));
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل بيانات الطلاب.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleCreateStudent(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify({
          fullName: newName,
          phone: newPhone,
          password: newPassword,
          groupId: newGroupId ? Number(newGroupId) : null,
          notes: newNotes,
        }),
      });
      setShowCreateModal(false);
      setNewName('');
      setNewPhone('');
      setNewPassword('');
      setNewNotes('');
      setFeedback({ type: 'success', text: 'تم إنشاء حساب الطالب وتعيين بياناته بنجاح.' });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إنشاء حساب الطالب.',
      });
    }
  }

  async function handleCreateGroup(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName, description: groupDesc }),
      });
      setShowGroupModal(false);
      setGroupName('');
      setGroupDesc('');
      setFeedback({ type: 'success', text: 'تمت إضافة المجموعة الدراسية بنجاح.' });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إنشاء المجموعة.',
      });
    }
  }

  async function handleUpdateStudent(e: FormEvent) {
    e.preventDefault();
    if (!editingStudent) return;
    try {
      await apiFetch(`/api/admin/students/${editingStudent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editName,
          phone: editPhone,
          groupId: editGroupId ? Number(editGroupId) : null,
          notes: editNotes,
          accountTier: editExclusiveTier ? 'exclusive_reserved' : 'standard',
          exclusiveIsolation: editExclusiveTier,
        }),
      });
      setEditingStudent(null);
      setFeedback({ type: 'success', text: 'تم تحديث بيانات الطالب بنجاح.' });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث بيانات الطالب.',
      });
    }
  }

  async function handleToggleStatus(student: StudentRecord) {
    const nextStatus = student.status === 'active' ? 'suspended' : 'active';
    try {
      await apiFetch(`/api/admin/students/${student.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedback({
        type: 'success',
        text:
          nextStatus === 'suspended'
            ? `تم تعليق حساب "${student.fullName}" وإنهاء جلساته النشطة.`
            : `تمت إعادة تفعيل حساب "${student.fullName}".`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تغيير حالة الحساب.',
      });
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    try {
      await apiFetch(`/api/admin/students/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({
          newPassword: resetPasswordVal,
          revokeActiveSessions: true,
        }),
      });
      setResetTarget(null);
      setResetPasswordVal('');
      setFeedback({
        type: 'success',
        text: 'تمت إعادة تعيين كلمة المرور وإنهاء الجلسات النشطة للطالب.',
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إعادة تعيين كلمة المرور.',
      });
    }
  }

  async function openSessionsDrawer(student: StudentRecord) {
    setSessionsTarget(student);
    try {
      const res = await apiFetch<{
        sessions: SessionItem[];
        loginHistory: AuditItem[];
      }>(`/api/admin/students/${student.id}/sessions`);
      setSessionsList(res.sessions);
      setLoginHistoryList(res.loginHistory);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل الجلسات.',
      });
    }
  }

  async function handleRevokeSession(sessionId: number) {
    if (!sessionsTarget) return;
    await apiFetch(`/api/admin/sessions/${sessionId}/revoke`, { method: 'POST' });
    await openSessionsDrawer(sessionsTarget);
    await loadData();
  }

  async function handleRevokeAllSessions(studentId: number) {
    await apiFetch(`/api/admin/students/${studentId}/revoke-all-sessions`, {
      method: 'POST',
    });
    if (sessionsTarget) await openSessionsDrawer(sessionsTarget);
    await loadData();
  }

  const filteredStudents = students.filter((s) => {
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    const q = searchQuery.trim();
    const matchesQuery =
      !q || s.fullName.includes(q) || s.phone.includes(q) || (s.groupName || '').includes(q);
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 font-display">
              إدارة حسابات الطلاب والجلسات
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تنشئ الإدارة حسابات الطلاب وتعيّن أرقام الهواتف وكلمات المرور مع تحكم كامل بالجلسات.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGroupModal(true)}
              className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Users className="w-4 h-4" />
              <span>مجموعة جديدة</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>إنشاء حساب طالب</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو رقم الهاتف أو المجموعة..."
              className="w-full pr-9 pl-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'الجميع' },
                { id: 'active', label: 'النشطون' },
                { id: 'suspended', label: 'الموقوفون' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                {tab.label}
              </button>
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
      </div>

      {/* Students Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">جاري تحميل قائمة الطلاب...</div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-600">
              لا توجد حسابات طلاب مطابقة حالياً. أنشئ أول حساب طالب للبدء.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء حساب طالب</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">الطالب</th>
                  <th className="py-3 px-4 font-semibold">رقم الهاتف</th>
                  <th className="py-3 px-4 font-semibold">المجموعة</th>
                  <th className="py-3 px-4 font-semibold">الواجهة المطبقة</th>
                  <th className="py-3 px-4 font-semibold">الجلسات</th>
                  <th className="py-3 px-4 font-semibold">الحالة</th>
                  <th className="py-3 px-4 font-semibold">إجراءات الإدارة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredStudents.map((stu) => (
                  <tr key={stu.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 text-sm">{stu.fullName}</div>
                      {stu.notes && (
                        <div className="text-[11px] text-slate-500">{stu.notes}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-tabular text-slate-700" dir="ltr">
                      {stu.phone}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {stu.groupName || 'بدون مجموعة'}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      <div>{stu.effectiveInterface.interfaceName}</div>
                      <div className="text-[11px] text-slate-500">
                        {stu.effectiveInterface.sourceLevel === 'individual'
                          ? 'تخصيص فردي'
                          : stu.effectiveInterface.sourceLevel === 'group'
                            ? 'واجهة مجموعة'
                            : 'افتراضية'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-tabular">
                      <button
                        type="button"
                        onClick={() => openSessionsDrawer(stu)}
                        className="text-teal-700 hover:underline font-semibold cursor-pointer"
                      >
                        {stu.activeSessions} نشطة
                      </button>
                    </td>
                    <td className="py-3 px-4">
                      {stu.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>نشط</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>موقوف</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onCustomizeStudentInterface(stu.id)}
                          className="px-2.5 py-1.5 bg-teal-50 text-teal-800 hover:bg-teal-100 rounded-md font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <LayoutTemplate className="w-3.5 h-3.5" />
                          <span>الواجهة</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStudent(stu);
                            setEditName(stu.fullName);
                            setEditPhone(stu.phone);
                            setEditGroupId(stu.groupId ? String(stu.groupId) : '');
                            setEditNotes(stu.notes);
                            setEditExclusiveTier(
                              stu.accountTier === 'exclusive_reserved' && stu.exclusiveIsolation
                            );
                          }}
                          className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-md text-slate-700 flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(stu);
                            setResetPasswordVal('');
                          }}
                          className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-md text-slate-700 flex items-center gap-1 cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>كلمة المرور</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(stu)}
                          className={`px-2.5 py-1.5 border rounded-md font-medium cursor-pointer ${
                            stu.status === 'active'
                              ? 'border-red-200 text-red-700 hover:bg-red-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {stu.status === 'active' ? 'تعليق' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Student Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="إنشاء حساب طالب جديد"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-base text-slate-900">إنشاء حساب طالب جديد</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="إغلاق"
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateStudent} className="space-y-3.5">
              <div>
                <label
                  htmlFor="create-stu-name"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  الاسم الكامل للطالب
                </label>
                <input
                  id="create-stu-name"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="مثال: أحمد محمد المنصور"
                />
              </div>
              <div>
                <label
                  htmlFor="create-stu-phone"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  رقم الهاتف المسجل للدخول
                </label>
                <input
                  id="create-stu-phone"
                  type="tel"
                  dir="ltr"
                  required
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-right font-tabular"
                  placeholder="0551234567"
                />
              </div>
              <div>
                <label
                  htmlFor="create-stu-pass"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  كلمة المرور الأولية (٦ أحرف على الأقل)
                </label>
                <input
                  id="create-stu-pass"
                  type="text"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
                  placeholder="أدخل كلمة مرور أولية"
                />
              </div>
              <div>
                <label
                  htmlFor="create-stu-group"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  المجموعة الدراسية
                </label>
                <select
                  id="create-stu-group"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">بدون مجموعة (الواجهة الافتراضية)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="create-stu-notes"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  ملاحظات إدارية (اختياري)
                </label>
                <input
                  id="create-stu-notes"
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  حفظ وإنشاء الحساب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showGroupModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="إنشاء مجموعة دراسية"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-base text-slate-900">إضافة مجموعة دراسية</h3>
              <button
                type="button"
                onClick={() => setShowGroupModal(false)}
                aria-label="إغلاق"
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم المجموعة
                </label>
                <input
                  type="text"
                  required
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الوصف
                </label>
                <input
                  type="text"
                  value={groupDesc}
                  onChange={(e) => setGroupDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إنشاء المجموعة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editingStudent && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="تعديل بيانات الطالب"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-base text-slate-900">
                تعديل بيانات: {editingStudent.fullName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                aria-label="إغلاق"
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateStudent} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الهاتف المسجل
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  required
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-right font-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  المجموعة
                </label>
                <select
                  value={editGroupId}
                  onChange={(e) => setEditGroupId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">بدون مجموعة</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ملاحظات
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <label className="flex items-start gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={editExclusiveTier}
                  onChange={(e) => setEditExclusiveTier(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  عزل مستقل (دعم الحساب الحصري المستقبلي بواجهة وصلاحيات منفصلة عن المجموعات)
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="إعادة تعيين كلمة المرور"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-base text-slate-900">
                تعيين كلمة مرور جديدة
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                aria-label="إغلاق"
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              الطالب: <span className="font-bold text-slate-900">{resetTarget.fullName}</span>
            </p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  كلمة المرور الجديدة
                </label>
                <input
                  type="text"
                  required
                  minLength={6}
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-tabular"
                  placeholder="٦ أحرف على الأقل"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  تحديث كلمة المرور
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sessions & Login History Modal */}
      {sessionsTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="الجلسات وسجل الدخول"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-2xl w-full p-6 space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  الجلسات وسجل الدخول: {sessionsTarget.fullName}
                </h3>
                <p className="text-xs text-slate-500 font-tabular" dir="ltr">
                  {sessionsTarget.phone}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRevokeAllSessions(sessionsTarget.id)}
                  className="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إنهاء جميع الجلسات
                </button>
                <button
                  type="button"
                  onClick={() => setSessionsTarget(null)}
                  aria-label="إغلاق"
                  className="p-1 text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-800">الجلسات المسجلة</h4>
              {sessionsList.length === 0 ? (
                <p className="text-xs text-slate-500">لا توجد جلسات مسجلة لهذا الطالب.</p>
              ) : (
                sessionsList.map((sess) => (
                  <div
                    key={sess.id}
                    className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900 font-tabular">
                        IP: {sess.ip_address}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-md">
                        {sess.user_agent}
                      </div>
                      <div className="text-[11px] text-slate-400 tabular-nums">
                        بدأت: {new Date(sess.created_at).toLocaleString('ar-SA')}
                      </div>
                    </div>
                    {sess.revoked_at ? (
                      <span className="text-slate-400 font-medium">منتهية / ملغاة</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(sess.id)}
                        className="px-2.5 py-1 border border-red-200 text-red-700 hover:bg-red-50 rounded text-xs font-semibold cursor-pointer"
                      >
                        إلغاء الجلسة
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-200">
              <h4 className="text-xs font-bold text-slate-800">سجل أحداث الدخول والأمان</h4>
              <div className="space-y-1.5">
                {loginHistoryList.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                  >
                    <span className="font-medium text-slate-800">
                      {formatAuditEventAr(ev.event_type)}
                    </span>
                    <span className="text-slate-500 font-tabular">
                      {ev.ip_address} · {new Date(ev.created_at).toLocaleString('ar-SA')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
