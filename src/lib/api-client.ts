/**
 * Thin shared API client for the dashboard frontend.
 *
 * Centralizes fetch -> JSON parsing and error normalization so components
 * surface consistent recoverable error messages instead of assuming JSON.
 */
export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (response.ok) {
    const text = await response.text();
    return (text ? (JSON.parse(text) as T) : ({} as T));
  }

  let message = `Request failed (${response.status}).`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // Non-JSON error body — keep the generic message.
  }
  throw new ApiClientError(message, response.status);
}
