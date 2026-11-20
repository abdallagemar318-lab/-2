import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  BookOpen,
  CheckCircle2,
  FileText,
  FolderUp,
  Plus,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../lib/api.ts';
import {
  UPLOAD_ACCEPT_ATTR,
  UPLOAD_CHUNK_BYTES,
  formatArabicFileSize,
  validateUploadMetadata,
} from '../shared/uploadPolicy.ts';

interface SubjectRecord {
  id: number;
  title: string;
  code: string;
}

interface DocumentRecord {
  id: number;
  subject_id: number;
  title: string;
  file_type: string;
  file_size_label: string;
  description: string;
  original_filename: string;
  has_uploaded_file: number;
}

interface LessonRecord {
  id: number;
  subject_id: number;
  title: string;
  summary: string;
  duration_minutes: number;
}

interface UploadProgressState {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
}

export function AdminContentUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const activeUploadIdRef = useRef<string | null>(null);

  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Simplified Chunked File Upload State (up to 100 GB)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [docSubjectId, setDocSubjectId] = useState<number>(0);
  const [docTitle, setDocTitle] = useState('');
  const [docDescription, setDocDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Quick Add Lesson State
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [lessonSubjectId, setLessonSubjectId] = useState<number>(0);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonSummary, setLessonSummary] = useState('');
  const [lessonDuration, setLessonDuration] = useState(30);
  const [lessonBody, setLessonBody] = useState('');
  const [savingLesson, setSavingLesson] = useState(false);

  async function loadContent() {
    setLoading(true);
    try {
      const res = await apiFetch<{
        subjects: SubjectRecord[];
        documents: DocumentRecord[];
        lessons: LessonRecord[];
      }>('/api/admin/content');
      setSubjects(res.subjects);
      setDocuments(res.documents);
      setLessons(res.lessons);
      if (res.subjects.length > 0) {
        setDocSubjectId((prev) => prev || res.subjects[0].id);
        setLessonSubjectId((prev) => prev || res.subjects[0].id);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل محتوى اللغة العربية.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContent();
  }, []);

  function applySelectedFile(file: File | undefined | null) {
    if (!file || uploading) return;
    const validation = validateUploadMetadata({
      fileName: file.name,
      totalSizeBytes: file.size,
    });
    if (!validation.valid) {
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setFeedback({
        type: 'error',
        text: validation.errorAr || 'نوع أو حجم الملف غير مدعوم.',
      });
      return;
    }

    setSelectedFile(file);
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
    setDocTitle((prev) => prev.trim() || nameWithoutExt || file.name);
    setFeedback(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    applySelectedFile(file);
  }

  async function handleCancelUpload() {
    uploadAbortRef.current?.abort();
    const uploadId = activeUploadIdRef.current;
    activeUploadIdRef.current = null;
    if (uploadId) {
      try {
        await apiFetch(`/api/admin/content/documents/upload/${uploadId}`, {
          method: 'DELETE',
        });
      } catch {
        // ignore cleanup failure
      }
    }
    setUploading(false);
    setUploadProgress(null);
    setFeedback({ type: 'error', text: 'تم إلغاء عملية رفع الملف.' });
  }

  async function handleUploadFile(e: FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setFeedback({ type: 'error', text: 'يرجى اختيار ملف أو سحبه إلى منطقة الرفع أولاً.' });
      return;
    }
    if (!docSubjectId) {
      setFeedback({ type: 'error', text: 'يرجى اختيار مكوّن اللغة العربية المناسب.' });
      return;
    }

    const validation = validateUploadMetadata({
      fileName: selectedFile.name,
      totalSizeBytes: selectedFile.size,
    });
    if (!validation.valid) {
      setFeedback({
        type: 'error',
        text: validation.errorAr || 'تعذر التحقق من صلاحية الملف.',
      });
      return;
    }

    const abortController = new AbortController();
    uploadAbortRef.current = abortController;
    activeUploadIdRef.current = null;

    setUploading(true);
    setUploadProgress({ uploadedBytes: 0, totalBytes: selectedFile.size, percent: 0 });
    setFeedback(null);

    try {
      const initRes = await apiFetch<{
        uploadId: string;
        chunkSizeBytes?: number;
      }>('/api/admin/content/documents/upload/init', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: docSubjectId,
          title: docTitle.trim() || selectedFile.name,
          description: docDescription.trim(),
          fileName: selectedFile.name,
          mimeType: selectedFile.type || 'application/octet-stream',
          totalSizeBytes: selectedFile.size,
        }),
        signal: abortController.signal,
      });

      const uploadId = initRes.uploadId;
      activeUploadIdRef.current = uploadId;
      const chunkSize = initRes.chunkSizeBytes || UPLOAD_CHUNK_BYTES;
      const token = getAuthToken();

      let offset = 0;
      while (offset < selectedFile.size) {
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const nextEnd = Math.min(offset + chunkSize, selectedFile.size);
        const chunkBlob = selectedFile.slice(offset, nextEnd);

        const chunkHeaders = new Headers({
          'Content-Type': 'application/octet-stream',
          'x-chunk-offset': String(offset),
        });
        if (token) {
          chunkHeaders.set('Authorization', `Bearer ${token}`);
        }

        const chunkResp = await fetch(`/api/admin/content/documents/upload/${uploadId}/chunk`, {
          method: 'PUT',
          headers: chunkHeaders,
          body: chunkBlob,
          signal: abortController.signal,
        });

        if (!chunkResp.ok) {
          let errMsg = 'تعذر رفع جزء من الملف.';
          try {
            const parsed = (await chunkResp.json()) as { error?: string };
            if (parsed.error) errMsg = parsed.error;
          } catch {
            // ignore
          }
          throw new Error(errMsg);
        }

        offset = nextEnd;
        const percent = Math.min(100, Math.round((offset / selectedFile.size) * 100));
        setUploadProgress({
          uploadedBytes: offset,
          totalBytes: selectedFile.size,
          percent,
        });
      }

      await apiFetch(`/api/admin/content/documents/upload/${uploadId}/complete`, {
        method: 'POST',
        signal: abortController.signal,
      });

      activeUploadIdRef.current = null;
      setSelectedFile(null);
      setDocTitle('');
      setDocDescription('');
      setUploadProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setFeedback({
        type: 'success',
        text: 'تم رفع الملف وإضافته فوراً إلى مكتبة طلبة الثانية باكالوريا.',
      });
      await loadContent();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const orphanUploadId = activeUploadIdRef.current;
      activeUploadIdRef.current = null;
      if (orphanUploadId) {
        try {
          await apiFetch(`/api/admin/content/documents/upload/${orphanUploadId}`, {
            method: 'DELETE',
          });
        } catch {
          // ignore
        }
      }
      setUploadProgress(null);
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر رفع الملف.',
      });
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
    }
  }

  async function handleDeleteDocument(doc: DocumentRecord) {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/content/documents/${doc.id}`, {
        method: 'DELETE',
      });
      setFeedback({
        type: 'success',
        text: `تم حذف الملف "${doc.title}" من المكتبة بنجاح.`,
      });
      await loadContent();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف الملف.',
      });
    }
  }

  async function handleCreateLesson(e: FormEvent) {
    e.preventDefault();
    setSavingLesson(true);
    setFeedback(null);
    try {
      await apiFetch('/api/admin/content/lessons', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: lessonSubjectId,
          title: lessonTitle,
          summary: lessonSummary,
          durationMinutes: lessonDuration,
          contentBody: lessonBody,
        }),
      });
      setLessonTitle('');
      setLessonSummary('');
      setLessonBody('');
      setShowLessonForm(false);
      setFeedback({
        type: 'success',
        text: 'تمت إضافة الدرس العربي الجديد بنجاح.',
      });
      await loadContent();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة الدرس.',
      });
    } finally {
      setSavingLesson(false);
    }
  }

  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display">
            رفع الملفات وإدارة محتوى اللغة العربية (الثانية باكالوريا)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            اسحب أي ملف تعليمي (PDF، Word، عروض، فيديو، صوت، أو أرشيف) وأفلته لرفعه مباشرة حتى ١٠٠ جيجابايت.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowLessonForm((prev) => !prev)}
          className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{showLessonForm ? 'إخفاء نموذج الدرس' : 'إضافة درس جديد'}</span>
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Quick Lesson Creator (Collapsible) */}
      {showLessonForm && (
        <form
          onSubmit={handleCreateLesson}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <BookOpen className="w-4 h-4 text-teal-700" />
            <h3 className="font-bold text-sm text-slate-900">
              إضافة درس جديد لمقرر اللغة العربية
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                المكوّن العربي
              </label>
              <select
                value={lessonSubjectId}
                onChange={(e) => setLessonSubjectId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                عنوان الدرس
              </label>
              <input
                type="text"
                required
                value={lessonTitle}
                onChange={(e) => setLessonTitle(e.target.value)}
                placeholder="مثال: الانزياح الدلالي في القصيدة المعاصرة"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                المدة التقريبية (بالدقائق)
              </label>
              <input
                type="number"
                min={5}
                max={180}
                value={lessonDuration}
                onChange={(e) => setLessonDuration(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-tabular"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ملخص قصير
            </label>
            <input
              type="text"
              value={lessonSummary}
              onChange={(e) => setLessonSummary(e.target.value)}
              placeholder="وصف موجز لمحاور الدرس..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              محتوى الشرح الكامل للطلاب
            </label>
            <textarea
              rows={4}
              required
              minLength={10}
              value={lessonBody}
              onChange={(e) => setLessonBody(e.target.value)}
              placeholder="اكتب نص الشرح أو الأمثلة الشعرية والمنهجية..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm leading-relaxed"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingLesson}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
            >
              {savingLesson ? 'جاري الحفظ...' : 'حفظ وإتاحة الدرس'}
            </button>
          </div>
        </form>
      )}

      {/* Two-Column Simplified Upload & Library */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Instant Drag & Drop File Upload */}
        <form
          onSubmit={handleUploadFile}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <FolderUp className="w-4 h-4 text-teal-700" />
            <h3 className="font-bold text-sm text-slate-900">رفع ملف جديد بخطوة واحدة</h3>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => {
              if (!uploading) fileInputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
              uploading
                ? 'border-slate-200 bg-slate-100 cursor-not-allowed opacity-80'
                : isDragging
                  ? 'border-teal-600 bg-teal-50/70 cursor-pointer'
                  : selectedFile
                    ? 'border-emerald-400 bg-emerald-50/40 cursor-pointer'
                    : 'border-slate-300 hover:border-teal-600 bg-slate-50 cursor-pointer'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT_ATTR}
              disabled={uploading}
              onChange={(e) => applySelectedFile(e.target.files?.[0])}
              className="hidden"
              aria-label="اختيار ملف للرفع"
            />
            <UploadCloud
              className={`w-9 h-9 mx-auto mb-2 ${
                selectedFile ? 'text-emerald-600' : 'text-teal-700'
              }`}
            />
            {selectedFile ? (
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900 truncate">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-emerald-700 font-medium font-tabular">
                  جاهز للرفع · {formatArabicFileSize(selectedFile.size)}
                </p>
                {!uploading && (
                  <p className="text-[11px] text-slate-500">
                    انقر لاختيار ملف بديل
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800">
                  اسحب الملف وأفلته هنا، أو انقر للاختيار
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  يدعم PDF و Word و PowerPoint و ZIP وفيديوهات الشرح والملفات الصوتية والصور حتى ١٠٠ جيجابايت
                </p>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="upload-doc-subject"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              المكوّن العربي (الثانية باكالوريا)
            </label>
            <select
              id="upload-doc-subject"
              value={docSubjectId}
              onChange={(e) => setDocSubjectId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
            >
              {subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="upload-doc-title"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              عنوان الملف الظاهر للطالب (يُملأ تلقائياً)
            </label>
            <input
              id="upload-doc-title"
              type="text"
              required
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="سيُملأ تلقائياً فور اختيار الملف..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="upload-doc-desc"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              ملاحظة مختصرة (اختياري)
            </label>
            <input
              id="upload-doc-desc"
              type="text"
              value={docDescription}
              onChange={(e) => setDocDescription(e.target.value)}
              placeholder="مثال: ملخص شامل جاهز للمراجعة قبل الفرض"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>

          {uploading && uploadProgress && (
            <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-teal-900">
                <span>جاري رفع الأجزاء بشكل متدفق...</span>
                <span className="font-tabular">{uploadProgress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-teal-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-700 transition-all duration-150"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-teal-800 font-tabular">
                <span>
                  {formatArabicFileSize(uploadProgress.uploadedBytes)} من{' '}
                  {formatArabicFileSize(uploadProgress.totalBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCancelUpload()}
                  className="inline-flex items-center gap-1 text-red-700 hover:underline font-semibold cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>إلغاء الرفع</span>
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>
              {uploading
                ? `جاري الرفع (${uploadProgress?.percent ?? 0}%)...`
                : 'رفع وحفظ الملف الآن'}
            </span>
          </button>
        </form>

        {/* Right: Documents Library & Quick Overview */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal-700" />
                <h3 className="font-bold text-sm text-slate-900">
                  الملفات المرفوعة والمتاحة ({documents.length})
                </h3>
              </div>
              <span className="text-[11px] text-slate-500">
                تظهر تلقائياً في مكتبة الطلاب المصرح لهم
              </span>
            </div>

            {loading ? (
              <p className="text-xs text-slate-500 py-6 text-center">جاري التحميل...</p>
            ) : documents.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                لا توجد ملفات بعد. ارفع أول ملف من النموذج المجاور.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 rounded-lg border border-slate-200 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {doc.title}
                      </div>
                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                        <span>{subjectById.get(doc.subject_id)?.title || 'اللغة العربية'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{doc.file_type}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-tabular">{doc.file_size_label}</span>
                      </div>
                      {doc.description && (
                        <p className="text-[11px] text-slate-600 truncate">{doc.description}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(doc)}
                      aria-label={`حذف ملف ${doc.title}`}
                      className="p-2 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg text-xs shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <h3 className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-2">
              الدروس المسجلة في الثانية باكالوريا ({lessons.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pt-1">
              {lessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                >
                  <div className="font-bold text-slate-900 truncate">{lesson.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {subjectById.get(lesson.subject_id)?.title} · {lesson.duration_minutes} د
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
