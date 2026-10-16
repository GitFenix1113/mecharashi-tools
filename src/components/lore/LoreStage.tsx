import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { StageArt } from './loreStageArt'
import type { LoreSubject } from './loreSubject'

/**
 * 故事館的舞台（PLAN-042-D B-1／C-3／C-4／F-4）：固定在視窗裡的立繪層，正文卷宗從另一側蓋上來。
 * 取代 042-A／042-C 的 LoreArt 立繪柱。
 *
 * 本元件只管「畫什麼」；**什麼時候動**由 PilotLorePage 掛在 `.lore-page` 上的狀態 class 決定
 * （開場顯影、換人退場／進場、閱讀模式），CSS 在 index.css 的 PLAN-042-D 區塊。
 *
 * ── 換外觀（同一位機師、art.key 變了）──────────────────────────────────────
 * 舊的那套留在原位淡出、新的那套由上往下「穿上」（`is-dressing`），約 1 秒後只留新的。
 * 每套立繪的幾何吃**自己的** `data-variant`，不吃 `.lore-page` 的：換外觀常會換構圖（全身 → 場景插畫），
 * 若舊的那套也跟著頁面的變體重算位置，它會在淡出前先跳一下。
 * 換人（subject.id 變了）不疊層，直接換——那是頁面層的退場／進場過場在處理。
 *
 * 狀態用「render 期間依 prop 調整」（React 官方模式，站上先例：FallbackImage／舊 LoreArt），
 * 不用 effect 歸零：effect 會讓上一套多活一幀。
 *
 * 機甲（PLAN-042-B 決策 B-5）：`subject.stamp`（型號）有值時蓋**型號鋼印**、不畫英文簽名——
 * 每台都有型號（90／93），英文名不是每台都有。機師沒有 stamp，畫面與泛化前一字不差。
 */
export interface LoreStageProps {
  /** 這位／這台（PLAN-042-B C-1）。`subject.nameEn` 是立繪旁的毛筆草書（PLAN-042-E），空＝不渲染草書層 */
  subject: LoreSubject
  /** null＝這位任何立繪都沒有 */
  art: StageArt | null
  /** 外觀列＋全身立繪鈕（由頁面組好傳進來，放在舞台外側） */
  tools?: ReactNode
}

interface Layer {
  art: StageArt
  subjectId: string
  leaving: boolean
  dressing: boolean
}

/** 換裝動畫的總長（index.css 的 lore-dress-in 170ms 延遲＋820ms） */
const DRESS_MS = 1000

export default function LoreStage({ subject, art, tools }: LoreStageProps) {
  const [layers, setLayers] = useState<Layer[]>(() => (art ? [{ art, subjectId: subject.id, leaving: false, dressing: false }] : []))
  const top = layers[layers.length - 1]
  if (art && (!top || top.art.key !== art.key)) {
    const sameSubject = top?.subjectId === subject.id
    setLayers(sameSubject
      ? [...layers.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true, dressing: false })), { art, subjectId: subject.id, leaving: false, dressing: true }]
      : [{ art, subjectId: subject.id, leaving: false, dressing: false }])
  } else if (!art && layers.length) {
    setLayers([])
  }

  // 換裝收尾：拿掉淡出完的舊層、新層卸下 is-dressing（遮罩終態本來就是全不透明，卸下不會閃）
  const busy = layers.some((l) => l.leaving || l.dressing)
  useEffect(() => {
    if (!busy) return
    const t = window.setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving).map((l) => ({ ...l, dressing: false }))), DRESS_MS)
    return () => clearTimeout(t)
  }, [busy, layers])

  const serial = subject.serial
  const nameEn = subject.nameEn?.trim()
  // 簽名字級依名字長度縮：長名（Yevgeny Ivanovic Goman）照官網做法縮小。給無單位數字（px 基準），CSS 再依舞台高度等比縮
  const sigSize = nameEn ? Math.round(Math.min(150, Math.max(70, 1400 / Math.max(6, nameEn.length)))) : 0

  return (
    <div className="lore-stage">
      {serial && <div className="lore-stage__serial" aria-hidden="true">{serial}</div>}

      <div className="lore-portrait">
        <div className="lore-portrait__inner">
          {layers.map((l) => (
            <div
              key={l.art.key}
              className={`lore-figure${l.leaving ? ' is-leaving' : ''}${l.dressing ? ' is-dressing' : ''}`}
              data-variant={l.art.variant}
            >
              {l.art.lineArt && (
                <img
                  className={`lore-figure__sketch${l.art.filtered ? ' is-filtered' : ''}`}
                  src={l.art.line}
                  alt=""
                  aria-hidden="true"
                  decoding="async"
                />
              )}
              <img className="lore-figure__color" src={l.art.color} alt={subject.name} decoding="async" />
              {l.art.nameLayer && (
                <img className="lore-figure__name" src={l.art.nameLayer} alt="" aria-hidden="true" decoding="async" />
              )}
            </div>
          ))}
          {!art && (
            // 未建檔不留白（專案慣例）：不是把她藏起來
            <div className="lore-figure" data-variant="wide" style={{ display: 'grid', placeItems: 'center', width: '40vw', fontSize: '0.7rem', color: 'var(--lore-ink-3)' }}>
              立繪未建檔
            </div>
          )}
          {/* 英文簽名疊在人物**前面**（官網的圖層順序；放後面會被立繪整條擋住）。配色與起筆位置見 index.css 的 .lore-sig */}
          {nameEn && !subject.stamp && (
            <div className="lore-sig" aria-hidden="true" style={{ '--sig': sigSize } as React.CSSProperties}>
              {nameEn}
            </div>
          )}
        </div>
      </div>

      {/* 直書姓名（官網 8 位的預設立繪改用官方名字層，CSS 依 .lore-page 的變體藏起來） */}
      <div className="lore-vname" aria-hidden="true">
        <span className="lore-vname__mark" />
        <span className="lore-vname__rule" />
        <span className="lore-vname__main">{subject.name}</span>
        {subject.fullName && <span className="lore-vname__sub">{subject.fullName}</span>}
      </div>

      {subject.stamp && (
        // 型號鋼印：站在直書名旁、不跟立繪一起視差（它是檔案上的戳記，不是畫面裡的東西）
        <div className="lore-stamp" aria-hidden="true">
          <span className="lore-stamp__box">{subject.stamp}</span>
          {(subject.makerName || nameEn) && (
            <span className="lore-stamp__sub">{subject.makerName && <b>{subject.makerName}</b>}{nameEn}</span>
          )}
        </div>
      )}

      <div className="lore-filetag" aria-hidden="true">
        <span>{subject.fileLabel} · NO.{serial || '—'}</span>
        {subject.debutVersion && <span>DEBUT · v{subject.debutVersion}</span>}
      </div>

      {tools && <div className="lore-stage-tools">{tools}</div>}
    </div>
  )
}
