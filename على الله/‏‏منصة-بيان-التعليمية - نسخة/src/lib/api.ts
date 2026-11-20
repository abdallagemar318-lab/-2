let memoryAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return memoryAuthToken;
}

export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryAuthToken) {
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const errMsg =
      typeof parsed.error === 'string' && parsed.error.length > 0
        ? parsed.error
        : 'تعذر إتمام العملية المطلوبة. يرجى المحاولة مجدداً.';
    throw new ApiError(errMsg, response.status);
  }

  return parsed as T;
}

export async function downloadProtectedFile(
  path: string,
  filename: string
): Promise<void> {
  const headers = new Headers();
  if (memoryAuthToken) {
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  }

  const response = await fetch(path, { headers });
  if (!response.ok) {
    let errMsg = 'تعذر تنزيل الملف المطلوب.';
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) errMsg = json.error;
    } catch {
      // ignore
    }
    throw new ApiError(errMsg, response.status);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
