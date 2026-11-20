import { useEffect, useState } from 'react';
import { CheckCircle2, Lock, RotateCcw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { ResourceType } from '../shared/types.ts';

interface PermissionItem {
  targetType: 'group' | 'student';
  targetId: number;
  resourceType: ResourceType;
  resourceId: number;
  isAllowed: boolean;
}

interface ContentCatalog {
  subjects: Array<{ id: number; title: string; code: string }>;
  lessons: Array<{ id: number; subject_id: number; title: string }>;
  documents: Array<{ id: number; subject_id: number; title: string }>;
  exams: Array<{ id: number; subject_id: number; title: string }>;
  tools: Array<{ id: number; title: string; category: string }>;
  announcements: Array<{ id: number; title: string; priority_level: string }>;
}

export function AdminPermissionsPanel() {
  const [targetType, setTargetType] = useState<'student' | 'group'>('student');
  const [students, setStudents] = useState<Array<{ id: number; fullName: string; phone: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<number>(0);

  const [catalog, setCatalog] = useState<ContentCatalog | null>(null);
  const [directRules, setDirectRules] = useState<PermissionItem[]>([]);
  const [groupRules, setGroupRules] = useState<PermissionItem[]>([]);
  const [exclusiveIsolation, setExclusiveIsolation] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ students: Array<{ id: number; fullName: string; phone: string }> }>(
        '/api/admin/students'
      ),
      apiFetch<{ groups: Array<{ id: number; name: string }> }>('/api/admin/groups'),
      apiFetch<ContentCatalog>('/api/admin/content'),
    ]).then(([stuRes, grpRes, cntRes]) => {
      setStudents(stuRes.students);
      setGroups(grpRes.groups);
      setCatalog(cntRes);
      if (stuRes.students.length > 0) {
        setSelectedId(stuRes.students[0].id);
      } else if (grpRes.groups.length > 0) {
        setTargetType('group');
        setSelectedId(grpRes.groups[0].id);
      }
    });
  }, []);

  async function loadPermissions(type: 'student' | 'group', id: number) {
    if (!id) return;
    const res = await apiFetch<{
      directRules: PermissionItem[];
      groupRules: PermissionItem[];
      exclusiveIsolation: boolean;
    }>(`/api/admin/permissions?targetType=${type}&targetId=${id}`);
    setDirectRules(res.directRules);
    setGroupRules(res.groupRules);
    setExclusiveIsolation(res.exclusiveIsolation);
  }

  useEffect(() => {
    if (selectedId > 0) {
      void loadPermissions(targetType, selectedId);
    }
  }, [targetType, selectedId]);

  async function setRule(resourceType: ResourceType, resourceId: number, isAllowed: boolean) {
    if (!selectedId) return;
    await apiFetch('/api/admin/permissions', {
      method: 'PUT',
      body: JSON.stringify({
        targetType,
        targetId: selectedId,
        resourceType,
        resourceId,
        isAllowed,
      }),
    });
    setFeedback('تم تحديث صلاحية الوصول وحفظها في الخادم.');
    await loadPermissions(targetType, selectedId);
  }

  async function clearRule(resourceType: ResourceType, resourceId: number) {
    if (!selectedId) return;
    await apiFetch('/api/admin/permissions', {
      method: 'DELETE',
      body: JSON.stringify({
        targetType,
        targetId: selectedId,
        resourceType,
        resourceId,
      }),
    });
    setFeedback('تمت استعادة التوريث الافتراضي لهذا العنصر.');
    await loadPermissions(targetType, selectedId);
  }

  function resolveState(resourceType: ResourceType, resourceId: number): {
    allowed: boolean;
    source: 'direct' | 'group' | 'default' | 'exclusive_deny';
  } {
    const direct = directRules.find(
      (r) => r.resourceType === resourceType && r.resourceId === resourceId
    );
    if (direct) {
      return { allowed: direct.isAllowed, source: 'direct' };
    }
    if (exclusiveIsolation) {
      return { allowed: false, source: 'exclusive_deny' };
    }
    const grp = groupRules.find(
      (r) => r.resourceType === resourceType && r.resourceId === resourceId
    );
    if (grp) {
      return { allowed: grp.isAllowed, source: 'group' };
    }
    return { allowed: true, source: 'default' };
  }

  const sections: Array<{
    type: ResourceType;
    title: string;
    items: Array<{ id: number; label: string; sub: string }>;
  }> = catalog
    ? [
        {
          type: 'subject',
          title: 'المواد الدراسية',
          items: catalog.subjects.map((s) => ({
            id: s.id,
            label: s.title,
            sub: s.code,
          })),
        },
        {
          type: 'lesson',
          title: 'الدروس والمرئيات',
          items: catalog.lessons.map((l) => ({
            id: l.id,
            label: l.title,
            sub: `مادة #${l.subject_id}`,
          })),
        },
        {
          type: 'document',
          title: 'الملفات والمستندات القابلة للتنزيل',
          items: catalog.documents.map((d) => ({
            id: d.id,
            label: d.title,
            sub: `مادة #${d.subject_id}`,
          })),
        },
        {
          type: 'exam',
          title: 'الاختبارات والواجبات',
          items: catalog.exams.map((e) => ({
            id: e.id,
            label: e.title,
            sub: `مادة #${e.subject_id}`,
          })),
        },
        {
          type: 'tool',
          title: 'الأدوات التعليمية الخاصة',
          items: catalog.tools.map((t) => ({
            id: t.id,
            label: t.title,
            sub: t.category,
          })),
        },
        {
          type: 'announcement',
          title: 'الإعلانات والتنبيهات',
          items: catalog.announcements.map((a) => ({
            id: a.id,
            label: a.title,
            sub: a.priority_level,
          })),
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display">
            مصفوفة التحكم بالمحتوى والصلاحيات
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            يتم فرض جميع صلاحيات الوصول على مستوى الخادم وقاعدة البيانات، ويُرفض أي طلب غير مصرح به تلقائياً.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-3 border-t border-slate-200">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              نطاق الصلاحية
            </label>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setTargetType('student');
                  setSelectedId(students[0]?.id || 0);
                }}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                  targetType === 'student' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                طالب محدد
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetType('group');
                  setSelectedId(groups[0]?.id || 0);
                }}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                  targetType === 'group' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                مجموعة طلاب
              </button>
            </div>
          </div>

          <div className="md:col-span-8">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              {targetType === 'student' ? 'اختر الطالب' : 'اختر المجموعة'}
            </label>
            {targetType === 'student' ? (
              students.length === 0 ? (
                <div className="text-xs text-amber-700 py-2">
                  لا يوجد طلاب مسجلون حالياً. يمكنك ضبط صلاحيات المجموعات أو إنشاء حساب طالب أولاً.
                </div>
              ) : (
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.phone})
                    </option>
                  ))}
                </select>
              )
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {feedback && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}
      </div>

      {selectedId > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sections.map((sec) => (
            <div
              key={sec.type}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
            >
              <h3 className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-2">
                {sec.title}
              </h3>
              <div className="space-y-2">
                {sec.items.map((item) => {
                  const state = resolveState(sec.type, item.id);
                  return (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900">{item.label}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.sub} ·{' '}
                          {state.source === 'direct'
                            ? 'تخصيص مباشر'
                            : state.source === 'group'
                              ? 'موروث من المجموعة'
                              : state.source === 'exclusive_deny'
                                ? 'معزول (محظور افتراضياً)'
                                : 'متاح افتراضياً'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setRule(sec.type, item.id, !state.allowed)}
                          className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                            state.allowed
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-red-50 text-red-800 border border-red-200'
                          }`}
                        >
                          {state.allowed ? (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>مصرح به</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              <span>محظور</span>
                            </>
                          )}
                        </button>
                        {state.source === 'direct' && (
                          <button
                            type="button"
                            title="استعادة التوريث الافتراضي"
                            aria-label={`استعادة التوريث الافتراضي لعنصر ${item.label}`}
                            onClick={() => clearRule(sec.type, item.id)}
                            className="p-1.5 border border-slate-200 text-slate-500 hover:text-slate-900 rounded-md cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
