const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function throwApiErrorFromResponse(response: Response): Promise<never> {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    if (body.error) message = body.error;
  } catch {
    // use default message
  }
  throw new ApiError(message, response.status);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include', // send HttpOnly auth cookies on every request
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Netzwerkfehler';
    throw new ApiError(`Netzwerkfehler: ${msg}`, 0);
  }

  if (!response.ok) {
    await throwApiErrorFromResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// Reads a newline-delimited JSON stream, invoking `onProgress` for each
// `{type:'progress', ...}` line, resolving on `{type:'result', data}`, and rejecting
// on `{type:'error', status, message}` — used for long-running uploads (receipt OCR)
// where the server reports retry/fallback progress while the request is in flight.
export async function postFileStream<TProgress, TResult>(
  path: string,
  formData: FormData,
  onProgress: (progress: TProgress) => void,
): Promise<TResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Netzwerkfehler';
    throw new ApiError(`Netzwerkfehler: ${msg}`, 0);
  }

  if (!response.ok) {
    await throwApiErrorFromResponse(response);
  }
  if (!response.body) {
    throw new ApiError('Netzwerkfehler', 0);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      const event = JSON.parse(line) as
        | { type: 'progress'; [key: string]: unknown }
        | { type: 'result'; data: TResult }
        | { type: 'error'; status: number; message: string };

      if (event.type === 'progress') {
        onProgress(event as unknown as TProgress);
      } else if (event.type === 'result') {
        return event.data;
      } else {
        throw new ApiError(event.message, event.status);
      }
    }
  }

  throw new ApiError('Netzwerkfehler', 0);
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
