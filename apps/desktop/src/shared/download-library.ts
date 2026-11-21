export interface DownloadLibraryEntry {
  id: string
  title: string
  sourceUrl: string
  kind: 'video' | 'image' | 'audio'
  status: string
  progress: number
  createdAt: number
  filePath?: string
  thumbnail?: string
  error?: string
}
export interface DownloadLibrarySnapshot {
  items: DownloadLibraryEntry[]
  total: number
  page: number
  pages: number
  counts: Record<'all' | 'video' | 'image' | 'audio', number>
}
export function filterDownloadLibrary(
  rows: DownloadLibraryEntry[],
  kind = 'all',
  query = '',
  page = 0
): DownloadLibrarySnapshot {
  const counts = { all: rows.length, video: 0, image: 0, audio: 0 }
  for (const row of rows) {
    counts[row.kind]++
  }
  const needle = query.toLocaleLowerCase()
  const filtered = rows
    .filter(
      (row) =>
        (kind === 'all' || row.kind === kind) &&
        `${row.title} ${row.sourceUrl} ${row.filePath || ''}`.toLocaleLowerCase().includes(needle)
    )
    .sort((a, b) => b.createdAt - a.createdAt)
  const pages = Math.max(1, Math.ceil(filtered.length / 30))
  const current = Math.max(0, Math.min(Number.isFinite(page) ? Math.floor(page) : 0, pages - 1))
  return {
    items: filtered.slice(current * 30, current * 30 + 30),
    total: filtered.length,
    page: current,
    pages,
    counts
  }
}
