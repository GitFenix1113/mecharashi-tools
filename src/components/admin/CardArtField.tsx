import { assetUrl } from '../../utils/assets'
import { CARD_NONE, mechAutoCardKey, mechCard, mechCardCatalog, pilotAutoCardKey, pilotCard, pilotCardCatalog, type CardSubject, type GachaCard } from '../../utils/gameArt'
import type { GachaSubjectKind } from '../gacha/gachaBannerStatus'
import { hasGachaFx, mechGachaFxKey, pilotGachaFxKey } from '../lore/gacha/gachaFxRegistry'

/** 兩邊只差這幾項：查表的函式、卡池動態的鍵、圖的資料夾與對照表 */
const KINDS = {
  mech: {
    noun: '這台', catalog: mechCardCatalog(), auto: mechAutoCardKey, card: mechCard, fxKey: mechGachaFxKey,
    dir: 'game/mechs', table: 'scripts/lib/mechGachaCards.json', unnamed: (id: string) => `wap${id}（未建檔）`,
  },
  pilot: {
    noun: '這位', catalog: pilotCardCatalog(), auto: pilotAutoCardKey, card: pilotCard, fxKey: pilotGachaFxKey,
    // 機師的圖資料夾只為站上的機師建，對不到名字多半是 DB 還沒填這個 gameId（例：NPC 轉正的摩根娜），不是沒建檔
    dir: 'game/pilots', table: 'scripts/lib/pilotGachaCards.json', unnamed: (id: string) => `${id}（還沒有機師填這個 gameId）`,
  },
} satisfies Record<GachaSubjectKind, {
  noun: string; catalog: GachaCard[]; auto: (s: CardSubject) => string | undefined; card: (s: CardSubject) => GachaCard | undefined
  fxKey: (home: string | undefined) => string | undefined; dir: string; table: string; unnamed: (id: string) => string
}>

interface Entity { id: string; name: string; gameId?: string; cardKey?: string }

/**
 * 機甲／機師後台：招募插畫改選（欄位 Mech.cardKey／Pilot.cardKey；機甲 2026-10-19、機師同日比照）。
 *
 * 自動對照（scripts/lib/{mech,pilot}GachaCards.json）由開發者依官方卡池表維護，但卡池鍵不一定是那台的英文名
 * （Ranger 其實是龍雀的卡池，遊騎兵自己的是 Ranger02），對錯時管理者要能當場換掉或先藏起來，不必等改版；
 * 機師這邊還有「NPC 轉正、還沒連上 gameId」的情形，自動對照查不到、改選就能先上。
 *
 * 用下拉選單＋所選那張的完整預覽，而不是縮圖牆：插畫一張約 230 KB、站上 60 多張，全攤開就是十幾 MB；
 * 選項標上「卡池鍵 — 自動對照到的機甲／機師」，搭配預覽已足夠辨認。
 */
export function CardArtField({ kind, form, entities, onChange }: {
  kind: GachaSubjectKind
  form: Entity
  entities: readonly Entity[]
  onChange: (v: string | undefined) => void
}) {
  const k = KINDS[kind]
  const nameOf = (home: string) => entities.find((e) => e.gameId === home)?.name ?? k.unnamed(home)
  const auto = k.auto(form)
  const pick = form.cardKey
  const card = k.card(form)
  const live = card ? hasGachaFx(k.fxKey(card.home)) : false
  const stale = !!pick && pick !== CARD_NONE && !card
  // 改選到別人的卡池：那邊若也自動顯示這張，兩邊會撞圖——講明，讓管理者決定那邊要不要一起改
  const sharedWith = pick && card && card.home !== form.gameId
    ? entities.filter((e) => e.id !== form.id && e.gameId === card.home && !e.cardKey)
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
          <option value="">{auto ? `自動：${auto}` : `自動：${k.noun}沒有對照（${form.gameId ? '沒開過專屬卡池' : '還沒填 gameId'}）`}</option>
          <option value={CARD_NONE}>不顯示招募插畫</option>
          {stale && <option value={pick}>{pick}（站上沒有這張圖）</option>}
          <optgroup label={`改選站上的招募插畫（${k.catalog.length} 張）`}>
            {k.catalog.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key} — {c.home === form.gameId ? k.noun : nameOf(c.home)}
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
            卡池鍵 <code>{card.key}</code>・圖在 <code>{k.dir}/{card.home}/card/</code>
            {card.home !== form.gameId && `（${nameOf(card.home)}的資料夾）`}・{live ? '有卡池動態' : '沒有卡池動態'}・點圖看原尺寸
          </figcaption>
        </figure>
      ) : (
        <p className={`text-[12px] ${stale ? 'text-accent-red' : 'text-text-dim'}`}>
          {stale
            ? `⚠ 改選的卡池鍵「${pick}」站上沒有圖（可能被移走或改名）：前台目前不顯示招募插畫，請改選其他張或改回自動。`
            : pick === CARD_NONE
              ? '前台不顯示招募插畫：圖鑑的卡池橫條退回文字狀態、故事館卷宗不出「卡池」卡。'
              : `${k.noun}沒有招募插畫。`}
        </p>
      )}

      {sharedWith.length > 0 && (
        <p className="text-[12px] text-accent-yellow">
          ⚠ 這組卡池也是 {sharedWith.map((e) => e.name).join('、')} 的自動對照，兩邊會顯示同一張圖；那邊若不該用，請到那邊改選或設成不顯示。
        </p>
      )}
      <p className="text-[11px] text-text-dim">
        平常留「自動」：對照依官方卡池表維護（<code>{k.table}</code>）。自動那張不對時才改選或先設成不顯示，並回報開發者修正對照。
      </p>
    </div>
  )
}
