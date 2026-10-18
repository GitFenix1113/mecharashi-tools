import type { Mech } from '../../types'
import { assetUrl } from '../../utils/assets'
import { MECH_CARD_NONE, mechAutoCardKey, mechCard, mechCardCatalog } from '../../utils/gameArt'
import { hasGachaFx, mechGachaFxKey } from '../lore/gacha/gachaFxRegistry'

const CATALOG = mechCardCatalog()

/**
 * 機甲後台：招募插畫改選（欄位 Mech.cardKey，2026-10-19）。
 *
 * 自動對照（scripts/lib/mechGachaCards.json）由開發者依官方卡池表維護，但卡池鍵不一定是那台的英文名
 * （Ranger 其實是龍雀的卡池，遊騎兵自己的是 Ranger02），對錯時管理者要能當場換掉或先藏起來，不必等改版。
 *
 * 用下拉選單＋所選那張的完整預覽，而不是縮圖牆：插畫一張約 230 KB、站上 60 多張，全攤開就是十幾 MB；
 * 選項標上「卡池鍵 — 自動對照到的機甲」，搭配預覽已足夠辨認。
 */
export function MechCardArtField({ form, mechs, onChange }: {
  form: Pick<Mech, 'id' | 'gameId' | 'cardKey'>
  mechs: readonly Pick<Mech, 'id' | 'name' | 'gameId' | 'cardKey'>[]
  onChange: (v: string | undefined) => void
}) {
  const nameOf = (wap: string) => mechs.find((m) => m.gameId === wap)?.name ?? `wap${wap}（未建檔）`
  const auto = mechAutoCardKey(form)
  const pick = form.cardKey
  const card = mechCard(form)
  const live = card ? hasGachaFx(mechGachaFxKey(card.wap)) : false
  const stale = !!pick && pick !== MECH_CARD_NONE && !card
  // 改選到別台的卡池：那台若也自動顯示這張，兩台會撞圖——講明，讓管理者決定那台要不要一起改
  const sharedWith = pick && card && card.wap !== form.gameId
    ? mechs.filter((m) => m.id !== form.id && m.gameId === card.wap && !m.cardKey)
    : []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-text-secondary">招募插畫 cardKey</span>
        <select
          value={pick ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="input-field flex-1 min-w-[240px]"
          aria-label="招募插畫"
        >
          <option value="">{auto ? `自動：${auto}` : '自動：這台沒有對照（沒開過專屬卡池）'}</option>
          <option value={MECH_CARD_NONE}>不顯示招募插畫</option>
          {stale && <option value={pick}>{pick}（站上沒有這張圖）</option>}
          <optgroup label={`改選站上的招募插畫（${CATALOG.length} 張）`}>
            {CATALOG.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key} — {c.wap === form.gameId ? '這台' : nameOf(c.wap)}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {card ? (
        <figure className="space-y-1">
          <a href={assetUrl(card.src)} target="_blank" rel="noreferrer" className="block max-w-xl">
            <img
              src={assetUrl(card.src)}
              alt={`招募插畫 ${card.key}`}
              decoding="async"
              className="w-full aspect-[2600/1080] object-cover rounded border border-border bg-bg-dark"
            />
          </a>
          <figcaption className="text-[11px] text-text-dim">
            卡池鍵 <code>{card.key}</code>・圖在 <code>game/mechs/{card.wap}/card/</code>
            {card.wap !== form.gameId && `（${nameOf(card.wap)}的資料夾）`}・{live ? '有卡池動態' : '沒有卡池動態'}・點圖看原尺寸
          </figcaption>
        </figure>
      ) : (
        <p className={`text-[12px] ${stale ? 'text-accent-red' : 'text-text-dim'}`}>
          {stale
            ? `⚠ 改選的卡池鍵「${pick}」站上沒有圖（可能被移走或改名）：前台目前不顯示招募插畫，請改選其他張或改回自動。`
            : pick === MECH_CARD_NONE
              ? '前台不顯示招募插畫：圖鑑的卡池橫條退回文字狀態、故事館卷宗不出「卡池」卡。'
              : '這台沒有招募插畫。'}
        </p>
      )}

      {sharedWith.length > 0 && (
        <p className="text-[12px] text-accent-yellow">
          ⚠ 這組卡池也是 {sharedWith.map((m) => m.name).join('、')} 的自動對照，兩台會顯示同一張圖；那台若不該用，請到那台改選或設成不顯示。
        </p>
      )}
      <p className="text-[11px] text-text-dim">
        平常留「自動」：對照依官方卡池表維護（<code>scripts/lib/mechGachaCards.json</code>）。自動那張不對時才改選或先設成不顯示，並回報開發者修正對照。
      </p>
    </div>
  )
}
