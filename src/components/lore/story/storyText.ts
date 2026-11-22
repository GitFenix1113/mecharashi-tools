// 對白文字的標記解析。匯入腳本（scripts/import-story.mjs 的 cleanText）已把遊戲的富文字收斂成兩種：
//   <y>…</y>          遊戲裡的黃字強調（<yellow>／<huntyellow>）
//   <c=#rrggbb>…</c>  遊戲裡的指定色
// 這裡把它切成純文字片段，由 React 逐段渲染——**不走 innerHTML**，對白裡就算混進 < > 也只會是字。
//
// 兩種都畫成同一種強調色：遊戲的色是配深色對話框挑的（#FFCC99 淺杏、黃字），放到紙色館內幾乎看不見。

export interface StoryTextSegment {
  text: string
  /** 遊戲裡有上色／強調的字 */
  em?: true
}

const TAG = /<y>([\s\S]*?)<\/y>|<c=#[0-9a-f]{6}>([\s\S]*?)<\/c>/gi

export function parseStoryText(raw: string): StoryTextSegment[] {
  const out: StoryTextSegment[] = []
  let last = 0
  for (const m of raw.matchAll(TAG)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: raw.slice(last, at) })
    const inner = m[1] ?? m[2] ?? ''
    if (inner) out.push({ text: inner, em: true })
    last = at + m[0].length
  }
  if (last < raw.length) out.push({ text: raw.slice(last) })
  return out
}

/** 純文字（搜尋、計數、頁名用）：標記拿掉、只留字 */
export const storyPlainText = (raw: string): string => parseStoryText(raw).map((s) => s.text).join('')
