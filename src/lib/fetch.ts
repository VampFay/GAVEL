/**
 * Fetch wrapper with:
 *   - AbortController (cancels in-flight requests when the component unmounts)
 *   - JSON parsing with type narrowing
 *   - Standardized error envelope ({ ok: false, error: string })
 *
 * Usage:
 *   const { data, error } = await apiGet<{ findings: Finding[] }>('/api/findings')
 *   if (error) toast.error('Failed to load', { description: error.message })
 */

export interface ApiError {
  status: number
  message: string
  code?: string
}

export interface ApiResult<T> {
  data: T | null
  error: ApiError | null
}

/**
 * GET with AbortController. Pass the controller's signal so the caller
 * can cancel on unmount:
 *
 *   const ctrl = new AbortController()
 *   const { data, error } = await apiGet('/api/foo', ctrl.signal)
 *   // later, on unmount:
 *   ctrl.abort()
 */
export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }))
      return { data: null, error: { status: res.status, message: body.error ?? 'request failed' } }
    }
    const body = (await res.json()) as T & { ok?: boolean }
    return { data: body, error: null }
  } catch (err: unknown) {
    // AbortError is fine — caller unmounted; not an error worth surfacing.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { data: null, error: null }
    }
    return {
      data: null,
      error: {
        status: 0,
        message: err instanceof Error ? err.message : 'network error',
      },
    }
  }
}

/**
 * POST/PATCH/DELETE helper for mutations. Does NOT use an AbortSignal —
 * we generally want mutations to complete even if the user navigates away.
 */
export async function apiMutation<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = { error: 'invalid response' }
    }
    if (!res.ok) {
      const errMsg =
        parsed !== null && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : 'request failed'
      return { data: null, error: { status: res.status, message: errMsg } }
    }
    return { data: parsed as T, error: null }
  } catch (err: unknown) {
    return {
      data: null,
      error: {
        status: 0,
        message: err instanceof Error ? err.message : 'network error',
      },
    }
  }
}

export const apiPost = <T>(url: string, body?: unknown) => apiMutation<T>(url, 'POST', body)
export const apiPatch = <T>(url: string, body?: unknown) => apiMutation<T>(url, 'PATCH', body)
export const apiPut = <T>(url: string, body?: unknown) => apiMutation<T>(url, 'PUT', body)
export const apiDelete = <T>(url: string) => apiMutation<T>(url, 'DELETE')
