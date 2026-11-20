export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024; // 100 GiB
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MiB per binary chunk

export interface AllowedUploadExtension {
  typeAr: string;
  defaultMime: string;
}

export const ALLOWED_UPLOAD_EXTENSIONS: Record<string, AllowedUploadExtension> = {
  '.pdf': { typeAr: 'ملف PDF', defaultMime: 'application/pdf' },
  '.txt': { typeAr: 'ملف نصي (TXT)', defaultMime: 'text/plain; charset=utf-8' },
  '.md': { typeAr: 'ملف توثيق (MD)', defaultMime: 'text/markdown; charset=utf-8' },
  '.doc': { typeAr: 'مستند Word (DOC)', defaultMime: 'application/msword' },
  '.docx': {
    typeAr: 'مستند Word (DOCX)',
    defaultMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.ppt': { typeAr: 'عرض تقديمي (PPT)', defaultMime: 'application/vnd.ms-powerpoint' },
  '.pptx': {
    typeAr: 'عرض تقديمي (PPTX)',
    defaultMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.xls': { typeAr: 'جدول بيانات (XLS)', defaultMime: 'application/vnd.ms-excel' },
  '.xlsx': {
    typeAr: 'جدول بيانات (XLSX)',
    defaultMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  '.zip': { typeAr: 'ملف مضغوط (ZIP)', defaultMime: 'application/zip' },
  '.rar': { typeAr: 'ملف مضغوط (RAR)', defaultMime: 'application/vnd.rar' },
  '.mp4': { typeAr: 'فيديو شرح (MP4)', defaultMime: 'video/mp4' },
  '.mov': { typeAr: 'فيديو شرح (MOV)', defaultMime: 'video/quicktime' },
  '.webm': { typeAr: 'فيديو شرح (WEBM)', defaultMime: 'video/webm' },
  '.mkv': { typeAr: 'فيديو شرح (MKV)', defaultMime: 'video/x-matroska' },
  '.mp3': { typeAr: 'ملف صوتي (MP3)', defaultMime: 'audio/mpeg' },
  '.wav': { typeAr: 'ملف صوتي (WAV)', defaultMime: 'audio/wav' },
  '.png': { typeAr: 'صورة تعليمية (PNG)', defaultMime: 'image/png' },
  '.jpg': { typeAr: 'صورة تعليمية (JPG)', defaultMime: 'image/jpeg' },
  '.jpeg': { typeAr: 'صورة تعليمية (JPEG)', defaultMime: 'image/jpeg' },
};

export const UPLOAD_ACCEPT_ATTR = Object.keys(ALLOWED_UPLOAD_EXTENSIONS).join(',');

export function sanitizeUploadFilename(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() || 'document';
  const cleaned = base.replace(/[^\w.\-\u0600-\u06FF\s]/g, '_').trim();
  return cleaned || 'document';
}

export function extractFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0) return '';
  return fileName.slice(idx).toLowerCase();
}

export function formatArabicFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 بايت';
  }
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;

  if (bytes >= gb) {
    return `${(bytes / gb).toFixed(bytes >= 10 * gb ? 1 : 2)} جيجابايت`;
  }
  if (bytes >= mb) {
    return `${(bytes / mb).toFixed(1)} ميجابايت`;
  }
  if (bytes >= kb) {
    return `${Math.max(1, Math.round(bytes / kb))} كيلوبايت`;
  }
  return `${Math.round(bytes)} بايت`;
}

export function validateUploadMetadata(params: {
  fileName: string;
  totalSizeBytes: number;
}): {
  valid: boolean;
  safeName: string;
  ext: string;
  meta?: AllowedUploadExtension;
  errorAr?: string;
} {
  const safeName = sanitizeUploadFilename(params.fileName);
  const ext = extractFileExtension(safeName);
  const meta = ALLOWED_UPLOAD_EXTENSIONS[ext];

  if (!meta) {
    return {
      valid: false,
      safeName,
      ext,
      errorAr:
        'نوع الملف غير مدعوم. الأنواع المسموحة: PDF, Word, PowerPoint, Excel, ZIP/RAR, فيديو, صوت, وصور.',
    };
  }

  if (
    !Number.isFinite(params.totalSizeBytes) ||
    params.totalSizeBytes <= 0 ||
    params.totalSizeBytes > MAX_UPLOAD_BYTES
  ) {
    return {
      valid: false,
      safeName,
      ext,
      meta,
      errorAr: 'حجم الملف غير صالح أو يتجاوز الحد الأقصى المسموح (١٠٠ جيجابايت).',
    };
  }

  return {
    valid: true,
    safeName,
    ext,
    meta,
  };
}
