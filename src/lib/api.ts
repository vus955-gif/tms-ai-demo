export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Błąd serwera (${res.status})`);
  return body as T;
}

export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function getJson<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { cache: "no-store" }));
}
