import { useEffect, useMemo, useRef } from 'react'
import { toPng } from 'html-to-image'
import type { NeuralDrive, NeuralDriveAbility } from '../../types'
import { imageCandidates, pilotFullArtPath } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import { loadoutSheetRows, type SheetRow } from '../../utils/loadoutRows'
import { ND_RULES, isGammaZone, zonePower } from '../../utils/ndOverrides'
import { resolveNeuralDriveLevel } from '../../utils/neuralDriveAbilities'
import type { LoadoutBudget, LoadoutContext } from '../../utils/loadoutRules'
import { SEG_LABEL, type SegKey } from './loadoutTheme'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import { SITE_DOMAIN, SITE_NAME, SITE_TITLE } from '../../lib/siteMeta'
import { nextFrames } from '../../utils/nextFrames'

// ─── 匯出配裝長圖（PLAN-052-I E-2）──────────────────────────────────────────
//
// **不共用螢幕版面，這是刻意的**（計畫書 E-2 逐字）。螢幕版面的每一個決定都建立在
// 「可以捲、可以點、可以 hover」之上；印刷品一個都沒有。共用的結果會是兩邊互相拖累：
// 螢幕版要為了截圖犧牲互動，截圖要為了螢幕版留下點不動的按鈕。
//
// ⚠ **固定 1000px 寬、高度隨內容**。寬度固定是因為 toPng 的產出尺寸就是這個元素的尺寸，
//   而分享出去的圖需要一個可預期的寬度；高度不固定是因為槽位數、算力分區數、能力數
//   逐機師不同 —— 寫死高度的下場是內容被裁掉，而裁掉的是最下面的算力表。
//
// ⚠ **內距、字級、顏色全部寫死在這個檔裡，不吃 loadoutTheme 的類別**。
//   兩個理由：① 這張圖的字級階與螢幕版不同（主標 44px，螢幕版最大 30px）；
//   ② html-to-image 會把 computed style 內聯，用 CSS 變數與 Tailwind 類別在這裡沒有好處，
//   反而讓「圖上為什麼長這樣」得跨三個檔案才查得到。
//
// ⚠ **只放配裝與算力，不放技能表**（計畫書 E-2）。技能是機師詳情頁的事；把它塞進來
//   會讓這張圖從「我的配裝」變成「機師懶人包」，而後者本站已經有一頁了。
//
// ⚠ 空槽與無槽**必須出現在表上**（`loadoutSheetRows()`）：看圖的人不能點開來確認
//   「是沒裝，還是這台根本沒有這一格」。

/** 分段條與圖例的顏色。寫死十六進位 —— 見檔頭「不吃 loadoutTheme」的理由。 */
const SEG_HEX: Record<SegKey, string> = {
  chassis: 'rgba(107,114,128,0.55)',
  hands: '#06b6d4',
  shoulder: '#a855f7',
  back: '#3b82f6',
}

const C = {
  bg: '#0a0c10',
  panel: '#14161d',
  line: '#262c3a',
  lineStrong: '#3f4859',
  text: '#e8eaed',
  sub: '#9ca3af',
  dim: '#6b7280',
  orange: '#ff6b2b',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  pink: '#ec4899',
} as const

const ORB = "'Orbitron', sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, monospace"

export interface LoadoutExportCardProps {
  ctx: LoadoutContext
  budget: LoadoutBudget
  /** 已疊過 defaultNdLevels 的完整算力配置 */
  ndLevels: Record<string, number>
  ndAbilityMap: Map<string, NeuralDriveAbility>
  /** ★ 分區（此區算力會改寫敘述） */
  ndZones: Set<string>
  /** 方案名稱。未命名時印機師名當標題 —— 標題留白會讓整張圖看起來像沒做完 */
  name?: string
  /** 產生日期 `YYYY-MM-DD`。由呼叫端傳入而不是這裡取 `new Date()`，元件才保持純渲染 */
  generatedAt: string
  /** 遊戲版本（如 `3.3`）。取不到時傳 undefined，該欄整個不印 */
  gameVersion?: string
  /**
   * 分享碼（`encodeLoadout()` 的產物）。**沒值時該欄整個不印**——
   * 印一個佔位字串會讓人拿去貼，而它解不開。
   *
   * ⚠ 由呼叫端編好傳進來，不在這裡編：這個元件是純渲染，而 encode 需要六個集合的
   *   shareId 索引，把它們拉進來等於讓一張圖的版面依賴整份遊戲資料。
   */
  shareCode?: string
}

export function LoadoutExportCard({
  ctx, budget, ndLevels, ndAbilityMap, ndZones, name, generatedAt, gameVersion, shareCode,
}: LoadoutExportCardProps) {
  const { pilot, mech } = ctx
  const rows = loadoutSheetRows(ctx)
  const w = budget.weight
  const drives = pilot?.neuralDrive ?? []
  const gammaSum = drives
    .filter((d) => isGammaZone(d.name))
    .reduce((n, d) => n + zonePower(d, ndLevels[d.name] ?? 0), 0)

  const usedSlots = rows.filter((r) => r.name !== null).length
  const realSlots = rows.filter((r) => r.state !== 'absent').length

  const art = imageCandidates(pilotFullArtPath(pilot))
  // 與 LoadoutRig 同一個來源（`mech.portrait`），圖已在頁面上載入過 → 匯出時是快取命中
  const mechArt = imageCandidates(mech?.portrait)

  const named = !!name
  const title = name ?? pilot?.name ?? '未命名配裝'

  // 分段條：以總重為分母。總重 0（尚未配裝）時整條留空，不做 0/0
  const total = w.total || 0
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')

  return (
    <div style={{
      width: 1000, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      background: C.bg, color: C.text, overflow: 'hidden',
      fontFamily: "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif",
      lineHeight: 1.7,
    }}>
      {/* ── Key visual：立繪 ＋ 機甲 ＋ 方案名稱 ── */}
      <div style={{
        position: 'relative', height: 356, flexShrink: 0, overflow: 'hidden',
        background: 'linear-gradient(118deg, #14161d 0%, #1b1207 42%, #0a0c10 100%)',
      }}>
        <div style={{
          position: 'absolute', left: -120, top: -60, width: 620, height: 500,
          transform: 'skewX(-14deg)',
          background: 'linear-gradient(160deg, rgba(255,107,43,0.30), rgba(255,107,43,0.02) 68%)',
        }} />

        {art.length > 0 && (
          <FallbackImage
            candidates={art}
            alt=""
            fallback={null}
            style={{
              position: 'absolute', left: 18, bottom: -12, width: 372,
              filter: 'drop-shadow(0 18px 34px rgba(0,0,0,0.7))',
            }}
          />
        )}
        {mechArt.length > 0 && (
          <FallbackImage
            candidates={mechArt}
            alt=""
            fallback={null}
            style={{
              position: 'absolute', right: 22, bottom: 58, width: 350, opacity: 0.94,
              filter: 'drop-shadow(0 16px 30px rgba(0,0,0,0.7))',
            }}
          />
        )}

        <div style={{ position: 'absolute', right: 24, top: 20, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontFamily: ORB, fontSize: 13, fontWeight: 900, letterSpacing: 2, color: C.orange }}>MILKHAMA</span>
          <span style={{ width: 1, height: 15, background: C.lineStrong }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>{SITE_NAME}</span>
        </div>

        <div style={{
          position: 'absolute', left: 404, top: 66, right: 24,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontFamily: ORB, fontSize: 11, letterSpacing: 2, color: C.orange }}>LOADOUT SHEET</div>
          {/*
            ⚠ **未命名時把機師名升成主標，而不是另外印一行「未命名配裝」**（也不是把機師名
              印兩次）。未命名是正常狀態 —— 命名要登入（052-E），未登入的人本來就會走到這裡。
              留一行「未命名配裝」等於在別人的分享圖上寫「這張沒做完」；印兩次機師名則是
              把同一個字放大再放小，讀者會以為那是兩個不同的東西。
          */}
          <div style={{
            fontSize: nameSize(title), fontWeight: 900, letterSpacing: 1,
            lineHeight: 1.14, wordBreak: 'break-word',
          }}>
            {title}
          </div>
          <div style={{ width: 78, height: 3, background: C.orange }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
            {named && <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{pilot?.name ?? '未選機師'}</span>}
            {pilot?.class && (
              <span style={{
                padding: '2px 10px', fontSize: 13, fontWeight: 700, color: C.yellow,
                background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.5)',
              }}>{pilot.class}</span>
            )}
            {pilot?.license && (
              <span style={{ fontSize: 14, color: C.sub }}>{pilot.license}執照</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: C.sub, flexWrap: 'wrap' }}>
            <span style={{ color: C.text, fontWeight: 700 }}>{mech?.name ?? '未選機甲'}</span>
            {mech?.armorType && <><span style={{ color: C.lineStrong }}>/</span><span>{mech.armorType}</span></>}
            {ctx.form?.name && <><span style={{ color: C.lineStrong }}>/</span><span style={{ color: C.yellow }}>{ctx.form.name}</span></>}
          </div>
        </div>

        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
          background: 'linear-gradient(90deg, #ff6b2b, rgba(255,107,43,0.05))',
        }} />
      </div>

      {/* ── 四格數值總覽 ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1,
        background: C.line, flexShrink: 0,
      }}>
        <Stat label="TOTAL WEIGHT" value={w.total.toLocaleString()} />
        <Stat label="OUTPUT" value={budget.output.total.toLocaleString()} tone={C.orange} />
        <Stat
          label={budget.over ? 'OVERWEIGHT' : 'REMAINING'}
          value={budget.dataIncomplete ? '—' : Math.abs(budget.remaining).toLocaleString()}
          tone={budget.dataIncomplete ? C.dim : budget.over ? C.red : C.green}
        />
        <Stat
          label="γ 算力合計"
          value={gammaSum.toLocaleString()}
          suffix={`/${ND_RULES.gammaPairCap}`}
          tone={C.pink}
        />
      </div>

      {/* ── 分段條 ＋ 圖例 ── */}
      <div style={{ display: 'flex', height: 16, flexShrink: 0, background: C.panel }}>
        <div style={{ width: pct(w.chassis), background: SEG_HEX.chassis }} />
        <div style={{ width: pct(w.hands), background: SEG_HEX.hands }} />
        <div style={{ width: pct(w.shoulder), background: SEG_HEX.shoulder }} />
        <div style={{ width: pct(w.back), background: SEG_HEX.back }} />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 20, padding: '9px 20px',
        fontSize: 12, color: C.sub, background: C.panel, flexShrink: 0,
      }}>
        <Legend seg="chassis" n={w.chassis} />
        <Legend seg="hands" n={w.hands} />
        <Legend seg="shoulder" n={w.shoulder} />
        <Legend seg="back" n={w.back} />
        {/* ⚠ 手部「取較重者」必須寫在圖上：那是最容易被誤判成本站少算的一條規則 */}
        <span style={{ marginLeft: 'auto', color: C.dim }}>
          手部取主手／備用<strong style={{ color: C.sub }}>較重者</strong>
          {ctx.capacity.backupHand > 0
            ? `，${w.heavierBank === 'main' ? '備用組' : '主手組'} ${Math.min(w.mainHand, w.backupHand).toLocaleString()} 未計入`
            : ''}
        </span>
      </div>

      {/* ── 主體：槽位表 ｜ 算力分區 ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 372px', gap: 1,
        background: C.line, alignItems: 'stretch',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', background: C.bg, minWidth: 0 }}>
          <SectionHead title="裝備配置" note={`${realSlots} 個槽位 · 已裝 ${usedSlots}`} tone={C.orange} />
          <SheetHeader />
          {rows.map((r) => <SheetLine key={r.key} row={r} />)}
          <div style={{
            marginTop: 'auto', padding: '12px 16px', borderTop: `1px solid ${C.line}`,
            background: 'rgba(18,21,28,0.5)', fontSize: 11, color: C.dim, lineHeight: 1.7,
          }}>
            數值以武器滿級（LV.70）與滿品質階為前提。空槽標「未裝備」、此機甲沒有的格標「—」。
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', background: C.bg, minWidth: 0 }}>
          <SectionHead title="神經驅動算力" note={`${gammaSum} / ${ND_RULES.gammaPairCap}`} tone={C.pink} />
          {drives.length === 0 ? (
            <p style={{ padding: '14px 16px', fontSize: 12, color: C.dim }}>這位機師沒有神經驅動資料。</p>
          ) : (
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {drives.map((d, i) => (
                <div key={d.name} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {i > 0 && <div style={{ height: 1, background: C.line, marginBottom: 7 }} />}
                  <ZoneBar drive={d} lv={ndLevels[d.name] ?? 0} starred={ndZones.has(d.name)} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 26 }}>
                    {(d.levels ?? []).filter((lvl) => lvl.level <= (ndLevels[d.name] ?? 0)).map((lvl) => {
                      const abilityName = resolveNeuralDriveLevel(lvl, ndAbilityMap).name
                      if (!abilityName) return null
                      return (
                        <div key={lvl.level} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          {/* ⚠ 寬度要放得下兩位數 minSum（`Lv6 · 16`）並強制不換行：
                              52px 在 minSum ≥ 10 時會把「· 16」擠到第二行（實測） */}
                          <span style={{
                            fontFamily: MONO, fontSize: 11, color: C.dim,
                            width: 64, flexShrink: 0, whiteSpace: 'nowrap',
                          }}>
                            Lv{lvl.level} · {lvl.minSum}
                          </span>
                          <span style={{ fontSize: 13, color: C.text, minWidth: 0 }}>{abilityName}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {ndZones.size > 0 && (
            <div style={{
              margin: '0 16px 14px', padding: '10px 12px',
              background: 'rgba(236,72,153,0.07)', borderLeft: `2px solid ${C.pink}`,
              fontSize: 12, color: C.sub, lineHeight: 1.7,
            }}>
              標<span style={{ color: C.pink, fontWeight: 700 }}> ★ </span>的分區（
              {[...ndZones].join('、')}）會就地改寫天賦與技能敘述的階名。
            </div>
          )}
        </div>
      </div>

      {/* ── 浮水印 footer ── */}
      <div style={{
        position: 'relative', flexShrink: 0,
        background: 'linear-gradient(90deg, #14161d, #0a0c10 62%)',
        borderTop: `2px solid ${C.orange}`, overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 20, padding: '18px 24px' }}>
          {/* 底噪 wordmark：截圖被裁掉 footer 時仍留下一層來源痕跡 */}
          <div style={{
            position: 'absolute', right: -20, top: -34, fontFamily: ORB, fontSize: 84, fontWeight: 900,
            letterSpacing: 8, color: 'rgba(255,255,255,0.032)', whiteSpace: 'nowrap',
          }}>MILKHAMA</div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: ORB, fontSize: 15, fontWeight: 900, letterSpacing: 1, color: C.orange }}>
              {SITE_DOMAIN}
            </span>
            <span style={{ fontSize: 12, color: C.sub }}>{SITE_TITLE} · 配裝模擬器</span>
            <span style={{ fontSize: 11, color: C.dim }}>非官方社群工具 · 無營利 · 與官方無關</span>
          </div>
          <div style={{ position: 'relative', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
            <FooterField
              label="GENERATED"
              value={gameVersion ? `${generatedAt} · 遊戲版本 ${gameVersion}` : generatedAt}
            />
          </div>
        </div>

        {/* ── 分享碼帶（PLAN-052-C E-1）──
            沒有碼就**整條不印**：印佔位字串會有人拿去貼，而它解不開。

            ⚠ 為什麼是整寬一條、而不是 052-I 原本放在 GENERATED 旁邊的小欄位：
              分享碼是**變長**的（實測空草稿 7 字元、典型 36、含元件與算力 79、
              三套 119），而卡片固定 1000px 寬。放右欄的話 79 字元起就會把左邊的
              站名浮水印擠出畫面 —— 而那正是這張圖存在的理由。整寬 ＋ `break-all`
              讓它自己折行，卡片高度跟著長，任何長度都不會壓到別的東西。 */}
        {shareCode && (
          <div style={{
            position: 'relative', display: 'flex', alignItems: 'baseline', gap: 10,
            padding: '10px 24px 14px', borderTop: '1px solid #232936',
          }}>
            <span style={{
              fontFamily: ORB, fontSize: 9, letterSpacing: 2, color: C.dim, flexShrink: 0,
            }}>SHARE CODE</span>
            <span style={{
              fontFamily: MONO, fontSize: 12, lineHeight: 1.45, color: C.sub,
              wordBreak: 'break-all', minWidth: 0,
            }}>{shareCode}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 小元件 ─────────────────────────────────────────────────────────────────

/** 名稱越長字級越小。24 個中文字在 44px 下會是三行，把 banner 撐破。 */
function nameSize(text: string): number {
  const n = [...text].length
  if (n <= 10) return 44
  if (n <= 16) return 36
  return 30
}

function Stat({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '16px 20px', background: C.bg }}>
      <span style={{ fontFamily: ORB, fontSize: 10, letterSpacing: 2, color: C.dim }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 800, lineHeight: 1.15, color: tone ?? C.text }}>
        {value}
        {suffix && <span style={{ fontSize: 16, color: C.dim }}>{suffix}</span>}
      </span>
    </div>
  )
}

function Legend({ seg, n }: { seg: SegKey; n: number }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 9, height: 9, background: SEG_HEX[seg], display: 'block' }} />
      {SEG_LABEL[seg]} {n.toLocaleString()}
    </span>
  )
}

function SectionHead({ title, note, tone }: { title: string; note: string; tone: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
      background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.lineStrong}`,
    }}>
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: tone }}>{title}</span>
      <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 12, color: C.dim }}>{note}</span>
    </div>
  )
}

const GRID = '96px minmax(0, 1fr) 74px 84px'

function SheetHeader() {
  const cell = { fontSize: 11, color: C.dim } as const
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center',
      padding: '8px 16px', borderBottom: `1px solid ${C.line}`, background: 'rgba(18,21,28,0.5)',
    }}>
      <span style={cell}>部位</span>
      <span style={cell}>武器 / 背包</span>
      <span style={cell}>類型</span>
      <span style={{ ...cell, fontFamily: MONO, textAlign: 'right' }}>重量</span>
    </div>
  )
}

function SheetLine({ row }: { row: SheetRow }) {
  const locked = row.state === 'fixed' || row.state === 'formLocked'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center',
      padding: '11px 16px', borderBottom: `1px solid ${C.line}`,
      background: row.state === 'absent' ? 'rgba(255,255,255,0.012)' : undefined,
    }}>
      <span style={{ fontSize: 13, color: C.sub }}>{row.label}</span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {row.name ? (
          <span style={{ fontSize: 15, fontWeight: 700, color: locked ? C.yellow : C.text }}>{row.name}</span>
        ) : (
          <span style={{ fontSize: 13, color: C.dim }}>
            {row.state === 'absent' ? (row.note ?? '此機甲沒有這一格') : '未裝備'}
          </span>
        )}
        {row.name && row.note && <span style={{ fontSize: 11, color: C.dim }}>{row.note}</span>}
        {row.state === 'weapon' && (
          <span style={{ fontSize: 11, color: C.dim }}>
            {/* 052-D 之前 componentIds 恆為空；欄位先在圖上留位，免得元件上線後版面再變一次 */}
            {row.componentIds.length > 0 ? `元件 ${row.componentIds.length}` : '未裝元件'}
          </span>
        )}
      </span>

      <span style={{ fontSize: 13, color: row.typeLabel === '—' ? C.dim : C.sub }}>{row.typeLabel}</span>
      <span style={{ fontFamily: MONO, fontSize: 14, textAlign: 'right', color: row.weight === null ? C.dim : C.text }}>
        {row.weight === null ? '—' : row.weight.toLocaleString()}
      </span>
    </div>
  )
}

function ZoneBar({ drive, lv, starred }: { drive: NeuralDrive; lv: number; starred: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 17, fontWeight: 800, position: 'relative', width: 30, flexShrink: 0 }}>
        {drive.name}
        {starred && (
          <i style={{ position: 'absolute', top: -5, right: -4, fontSize: 11, color: C.pink, fontStyle: 'normal' }}>★</i>
        )}
      </span>
      <span style={{ display: 'flex', gap: 4, flexGrow: 1, minWidth: 0 }}>
        {(drive.levels ?? []).map((l) => (
          <i key={l.level} style={{
            flexGrow: 1, minWidth: 0, height: 16, display: 'block',
            background: l.level <= lv ? C.yellow : C.panel,
            border: l.level <= lv ? 'none' : `1px solid #2f3646`,
            boxSizing: 'border-box',
          }} />
        ))}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 14, color: C.text, width: 28, textAlign: 'right', flexShrink: 0 }}>
        {zonePower(drive, lv)}
      </span>
    </div>
  )
}

function FooterField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <span style={{ fontFamily: ORB, fontSize: 9, letterSpacing: 2, color: C.dim }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 13, color: C.sub }}>{value}</span>
    </div>
  )
}

// ─── 匯出執行器（PLAN-052-I E-3）────────────────────────────────────────────
//
// **只在按下匯出時才掛載**，掛載即開拍、拍完回報。這樣做的取捨：
//
//   · 常駐一份離屏卡  → 沒有 mount→capture 的競態，但每個進頁的人都要付
//                       `patchVersions` 的讀取與一份 1000px DOM 的 render，
//                       而其中絕大多數人不會匯出。
//   · 按下才掛載（本作法）→ 不匯出的人零成本，代價是要自己等圖與字體就緒。
//
// 等待的部分寫成**輪詢**而不是一次性的 load 監聽：`FallbackImage` 會在載入失敗時
// 換下一個候選，一次性監聽會在第一次 error 就放行，於是拍到一張還沒換好的圖。
//
// ⚠ 拍的是 host 的**子元素**不是 host 本身：host 帶著 `position: fixed; left: -10000px`，
//   html-to-image 會把那份 computed style 一起複製到 clone 上，內容就被推出畫布外了。

interface RunnerProps extends Omit<LoadoutExportCardProps, 'generatedAt' | 'gameVersion'> {
  /** 完成（或失敗）時回報。`error` 為 null ＝ 成功 */
  onDone: (error: Error | null) => void
}

/** 檔名裡不能出現的字元（Windows 最嚴，一律照它清）。 */
const BAD_FILENAME = /[\\/:*?"<>|]/g

export function LoadoutExportRunner({ onDone, ...card }: RunnerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { data: versions, loading } = usePatchVersions()

  // 台服當前版本。取不到就不印那一欄 —— 印一個猜的版本號比不印更糟
  const gameVersion = useMemo(() => versions.find((v) => v.isTwCurrent)?.version, [versions])
  // 掛載當下取一次就好：拍照過程中跨日的機率不值得為它多一個依賴
  const generatedAt = useMemo(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }, [])

  useEffect(() => {
    // patchVersions 未就緒就先不拍：footer 會少一個版本號，而那是這張圖唯一的時間座標
    if (loading) return

    // ⚠ **不要用「已啟動」的 ref 去重**（實測踩過）：StrictMode 會把 effect 跑兩次
    //   （run → cleanup → run），旗標會讓第一次佔住、被 cleanup 取消，第二次直接 return
    //   ⇒ 兩次都沒拍成，按鈕永遠停在「產生中…」。而且這個症狀**只在 dev 出現**，
    //   正式站看起來是好的 —— 那正是最糟的一種：改壞了不會有人發現。
    //   正解是讓這支 effect 本來就可重入：cleanup 取消上一輪，新的一輪重拍。
    let alive = true
    const run = async () => {
      const el = hostRef.current?.firstElementChild as HTMLElement | null
      if (!el) {
        onDone(new Error('匯出版面沒有掛載成功'))
        return
      }
      try {
        await waitForRenderReady(el)
        if (!alive) return
        const dataUrl = await toPng(el, { backgroundColor: '#0a0c10', pixelRatio: 2, skipFonts: false })
        if (!alive) return
        const base = (card.name ?? card.ctx.mech?.name ?? 'loadout').replace(BAD_FILENAME, '_')
        const a = document.createElement('a')
        a.download = `配裝_${base}.png`
        a.href = dataUrl
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        onDone(null)
      } catch (err) {
        console.error('[Loadout] export error:', err)
        if (alive) onDone(err instanceof Error ? err : new Error(String(err)))
      }
    }
    void run()
    return () => { alive = false }
  }, [loading, onDone, card.name, card.ctx.mech?.name])

  return (
    <div
      ref={hostRef}
      aria-hidden
      // 離屏而不是 `display:none`：後者量不到尺寸、圖也不見得會載入
      style={{ position: 'fixed', left: -10000, top: 0, width: 1000, pointerEvents: 'none', zIndex: -1 }}
    >
      <LoadoutExportCard {...card} generatedAt={generatedAt} gameVersion={gameVersion} />
    </div>
  )
}

/** 圖與字體就緒才放行。有硬上限——等不到也要出圖，一張少一張圖好過一個按了沒反應的按鈕。 */
async function waitForRenderReady(el: HTMLElement): Promise<void> {
  try { await document.fonts?.ready } catch { /* 不支援或被拒 → 直接往下走 */ }

  const deadline = Date.now() + 5000
  // 輪詢而不是監聽 load：FallbackImage 換候選時 complete 會再變回 false，
  // 一次性的 load/error 監聽會在第一次失敗就放行
  for (;;) {
    const imgs = [...el.querySelectorAll('img')]
    if (imgs.every((img) => img.complete)) break
    if (Date.now() > deadline) {
      console.warn('[Loadout] 匯出圖等待逾時，仍有圖片未載入完成')
      break
    }
    await new Promise((r) => setTimeout(r, 60))
  }

  // 兩輪 rAF：讓上面 await 期間發生的 src 抽換完成排版後才拍
  await nextFrames(2)
}

