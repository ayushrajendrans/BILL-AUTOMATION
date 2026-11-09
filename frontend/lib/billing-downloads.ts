const archiveCache = "billing-archives-v1"
const retention = 24 * 60 * 60 * 1000

export function archivePath(id: string) {
  return `/api/jobs/${id}/download`
}

async function openCache() {
  try {
    return await window.caches.open(archiveCache)
  } catch {
    return null
  }
}

export async function pruneSavedArchives() {
  const cache = await openCache()
  if (!cache) return
  const cutoff = Date.now() - retention
  await Promise.all((await cache.keys()).map(async request => {
    const saved = await cache.match(request)
    if (Number(saved?.headers.get("X-Billing-Saved-At")) < cutoff) await cache.delete(request)
  }))
}

export async function loadArchive(id: string, signal: AbortSignal): Promise<Blob | null> {
  const path = archivePath(id)
  const cache = await openCache()
  const cached = await cache?.match(path).catch(() => undefined)
  if (cached && Date.now() - Number(cached.headers.get("X-Billing-Saved-At")) < retention) {
    return cached.blob()
  }

  const response = await fetch(path, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    cache: "no-store",
  })
  if (response.status === 404) return null
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/zip")) {
    throw new Error("Could not retrieve this ZIP.")
  }
  const blob = await response.blob()
  await cache?.put(path, new Response(blob, {
    headers: { "Content-Type": "application/zip", "X-Billing-Saved-At": String(Date.now()) },
  })).catch(() => undefined)
  return blob
}
