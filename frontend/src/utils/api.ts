export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // use default message
    }
    throw new ApiError(message, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// Retry wrapper for transient network failures (Failed to fetch, timeouts)
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isNetworkError =
        err instanceof TypeError &&
        /failed to fetch|network/i.test(err.message);
      const isLastAttempt = attempt === retries;
      if (!isNetworkError || isLastAttempt) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function apiGet<T>(url: string): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(url);
    return handleResponse<T>(res);
  });
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(res);
  });
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(res);
  });
}

export async function apiDelete(url: string): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(url, { method: "DELETE" });
    await handleResponse<void>(res);
  });
}
