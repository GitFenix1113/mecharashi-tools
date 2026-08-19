/**
 * 版本備註（PatchVersion.notes）的正規化。
 *
 * 歷史上 notes 是單一字串，多條備註靠換行硬塞在同一格；改成多條之後仍要讀得懂舊資料，
 * 所以讀取端一律經過這裡：字串按換行拆條、陣列去掉空白項，兩種型態都攤平成 string[]。
 */
export function normalizeNotes(notes?: string | string[]): string[] {
  if (!notes) return []
  const list = Array.isArray(notes) ? notes : notes.split(/\r?\n/)
  return list.map(n => n.trim()).filter(Boolean)
}
