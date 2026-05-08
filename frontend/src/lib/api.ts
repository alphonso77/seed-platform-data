export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const body = await res.json();

  if (!res.ok) {
    throw new ApiError(body.error || 'Request failed', res.status, body.code);
  }

  return body.data as T;
}

// Multipart variant — do NOT set Content-Type so the browser inserts the
// multipart boundary. Body should be a FormData instance.
export async function apiFetchMultipart<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: formData });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(body.error || 'Request failed', res.status, body.code);
  }
  return body.data as T;
}
