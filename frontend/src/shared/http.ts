/** JSON request helper shared by every tool's API client. GET when there is no body, POST otherwise. */
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') detail = data.detail
      else if (Array.isArray(data.detail))
        detail = data.detail.map((d: { loc: unknown[]; msg: string }) => `${d.loc.slice(1).join('.')}: ${d.msg}`).join('; ')
    } catch {
      /* keep the status text */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}
