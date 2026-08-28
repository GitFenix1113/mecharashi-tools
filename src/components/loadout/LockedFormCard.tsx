import type { MechForm } from '../../types'
import { lockedMounts, loadoutBudget, type LoadoutContext } from '../../utils/loadoutRules'
import { mountLabel } from '../../utils/mechSlots'
import { slotKey } from '../../types/slots'
import { resolveIconSrc } from '../../utils/assets'
import { WeaponIcon } from '../icons/WeaponIcon'
import { RefText } from '../refs/RefText'
import { HUD, HUD_READONLY, HUD_TAG, SEG_TEXT, slotSegKey } from './loadoutTheme'

// ─── 唯讀形態卡（PLAN-052-F C-1／C-2）────────────────────────────────────────
//
// `equipSetKeys()` 刻意讓「鎖死整套配裝」的形態**不佔分頁** —— 那是對的：點進去
// 什麼都不能改，是一個假的互動。但那個決定有另一半沒有做完：海莉絲切到虛粒子時，
// 耀星／隕星／千星在模擬器裡是**零存在感**的，玩家在三個分頁之間切換、
// 卻找不到官方形態頁上明明有的第四格，會把它當成「站上漏了」。這張卡是那另一半。
//
// ⚠ **它不是分頁、也不可點**。視覺上靠 052-I 已定的那條規則分辨：
//   **切角（`hud-cut*`）＝ 可互動，圓角（`rounded`）＝ 唯讀**。本卡通篇圓角、
//   沒有任何 hover、沒有 `cursor-pointer`。
//
// ⚠ **不渲染「被鎖住的技能」**（PLAN-041 決策十）：`restrict.lockedSkillIds` 早在
//   2026-08-12 就從型別上拿掉了，那三支技能由 `description` 內的
//   `[虛粒子刃][虛粒子炮][虛粒子矩陣]` 引用完整表達（可 hover、可級聯）。
//   而且該形態下三支已被強化為 EX 版，列基礎版名稱等於顯示玩家看不到的東西。
//
// ⚠ **不做成 `FormCard`（機師詳情頁那張）的第二個消費端**：那張卡回答的是
//   「這個形態是什麼」，會反查全庫的模組與技能、疊四層來源；這一頁回答的是
//   「這一套裝了什麼」。同一份資料、兩個問題，硬共用會讓配裝頁長出一塊
//   跟配裝無關的百科內容。

interface Props {
  form: MechForm
  /**
   * **這個形態自己的** context —— 呼叫端用 `buildContext(draft, form.id, world)` 建。
   *
   * ⚠ 不是傳目前分頁那一份。全鎖形態的整套裝備 100% 由 `form.restrict.mounts` derive
   *   （`lockedMounts()`），而 `loadoutWeightSet()` 對 `ctx.lock` 有專門的分支 ——
   *   拿別的分頁的 ctx 進來會算出那一頁的重量、掛上這一頁的名字。
   */
  ctx: LoadoutContext
}

export function LockedFormCard({ form, ctx }: Props) {
  const mounts = lockedMounts(ctx)
  const budget = loadoutBudget(ctx)
  const armamentWeight = mounts.reduce((n, m) => n + (ctx.world.weapons.get(m.weaponId)?.weight ?? 0), 0)

  /**
   * 可用出力有沒有一個講得出口的值。
   *
   * ⚠ **沒有機甲時不可以印那組數字**（本機實測踩到）：出力來自軀幹，沒選機甲時
   *   `budget.output.total` 是 0，於是這一格會印成「300 / 0」—— 看起來像超重了 300，
   *   實際上只是還沒選機甲。分母是 0 的比值不是資訊，是雜訊。
   *   本頁其他地方早有同一條慣例（槽位圖的 `available={budget.dataIncomplete ? undefined : …}`：
   *   「數值未公布的機甲不印可用 N —— 那個 N 是負的，印出來等於用一個算不出來的數字去嚇人」）。
   * ⚠ `dataIncomplete`（美杜莎MK2 全 0）走同一條路：那是資料狀態，不是配裝結果。
   */
  const hasBudget = !!ctx.chassis && !budget.dataIncomplete

  return (
    <section className={`rounded-xl border p-3.5 space-y-2.5 ${
      form.isSignature
        ? 'border-accent-yellow/40 bg-accent-yellow/[0.04]'
        : `${HUD_READONLY} rounded-xl`
    }`}>
      {/* ── 標頭 ── */}
      <div className="flex items-center gap-2.5">
        {form.icon && (
          <img
            src={resolveIconSrc(form.icon)}
            alt=""
            className="w-9 h-9 rounded object-contain bg-bg-dark border border-border/60 shrink-0"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className={`${HUD.label} text-text-dim mb-0.5`}>Locked Form</div>
          <div className="flex items-center gap-2 flex-wrap">
            {form.isSignature && <span className="text-accent-yellow shrink-0">★</span>}
            <h3 className={`${HUD.cardTitle} text-text-primary truncate`}>{form.name}</h3>
            {form.isSignature && (
              <span className={`${HUD_TAG} border-accent-yellow/40 text-accent-yellow shrink-0 px-1.5 py-0.5 text-[11px]`}>
                天賦專屬
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 為什麼它不是一個分頁 ──
          這一句是整張卡存在的理由，所以排在武裝清單之前：玩家先要知道
          「這一格不是站上漏了，是本來就改不了」，才會把下面那份清單讀成事實而不是缺口。 */}
      <p className={`${HUD.body} text-text-secondary`}>
        <span className="text-accent-yellow font-semibold">武裝焊死</span>
        ：本形態下<b className="text-text-primary">所有槽位皆不可調整</b>（雙手／雙肩／背部），
        因此不另開配裝分頁。
      </p>

      {/* ── 焊死的那幾把 ── */}
      <div className="space-y-1.5">
        {mounts.map(({ weaponId, ref }) => {
          const w = ctx.world.weapons.get(weaponId)
          const seg = SEG_TEXT[slotSegKey(ref.slot)]
          return (
            // key 用 slotKey() 而不是 weaponId：同一把武器可能掛在兩格（帕斯卡的兩肩）
            <div
              key={slotKey(ref)}
              className={`${HUD_READONLY} rounded-lg flex items-center gap-2.5 px-2 py-1.5`}
            >
              <WeaponIcon icon={w?.icon} name={w?.name ?? weaponId} size="sm" />
              <div className="min-w-0 flex-1">
                {w
                  ? <div className={`${HUD.bodyStrong} text-text-primary truncate`}>{w.name}</div>
                  : <div className={`${HUD.bodyStrong} text-accent-red truncate`}>⚠ 查無此武器：{weaponId}</div>}
                <div className="text-[11px] text-text-dim truncate">
                  <span className={seg}>{mountLabel({ weaponId, slot: ref.slot, side: ref.side })}</span>
                  {w && <> · {w.type || '—'}{w.kind ? ` · ${w.kind}` : ''}</>}
                </div>
              </div>
              {/* 重量用該槽位分段的顏色 —— 與槽位圖、帳本列同一套對照（`slotSegKey`） */}
              <span className={`${HUD.numSm} shrink-0 ${seg}`}>{(w?.weight ?? 0).toLocaleString()}</span>
            </div>
          )
        })}
      </div>

      {/* ── C-2：這一套的重量／出力 ──
          ⚠ **要印，而且印的是真數字。** 本工項原本的描述是「固定武裝的重量實測為 0，
            所以算與不算等價；建議改印一行『此形態武裝固定，不佔配裝額度』」——
            **那三句話都不成立**（2026-08-28 回查資料層）：
            耀星／隕星／千星**各 100，合計 300**；`loadoutWeightSet()` 的檔頭註解逐字寫著
            「固定武裝要**計入**：golden fixture ④虛粒子形態 1125 ＝ 825 ＋（100＋100）＋ 100」，
            而 1125 正是官方整備畫面上的數字（總綱決策一①的四組對帳之一）。
            重量為 0 的是**曜**的幽弧／夜燼（那兩筆連 type／kind 都還是空字串，屬資料佔位）。
            印「不佔配裝額度」會同時與引擎、官方畫面、既有 golden fixture 三邊打臉。
          ⚠ 數字一律走 `loadoutBudget()`，元件不自己加總（`LoadoutBudget` 的型別註解）。 */}
      <div className="rounded-lg border border-border-subtle bg-bg-dark px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`${HUD.labelCjk} text-text-dim`}>
            {hasBudget ? '總重 ／ 可用出力' : '固定武裝合計'}
          </span>
          <span className={HUD.num}>
            {hasBudget ? (
              <>
                <b className="text-text-primary text-[15px]">{budget.weight.total.toLocaleString()}</b>
                <span className="text-text-dim"> / {budget.output.total.toLocaleString()}</span>
              </>
            ) : (
              <b className="text-text-primary text-[15px]">{armamentWeight.toLocaleString()}</b>
            )}
          </span>
        </div>
        <p className="text-[11px] text-text-dim leading-relaxed mt-1">
          {hasBudget ? (
            <>
              這一套<b className="text-text-secondary">照樣計入重量</b>（三把固定武裝合計
              <span className={HUD.num}> {armamentWeight.toLocaleString()}</span>
              ），只是玩家改不了 —— 官方整備畫面顯示的也是同一個數字。
            </>
          ) : (
            <>
              固定武裝<b className="text-text-secondary">照樣計入總重</b>，只是玩家改不了。
              {ctx.chassis
                ? '這台機甲的官方出力數值尚未公布，因此不列出可用出力。'
                : '總重與可用出力要選好機甲才算得出來（出力來自軀幹）。'}
            </>
          )}
        </p>
      </div>

      {/* ── 形態固有正文 ──
          走 `RefText`（PLAN-019 引用層）：正文裡的 [虛粒子刃][反擊先手] 等 token
          在這裡一樣 hover 得開，而那正是「被鎖住的技能」唯一該出現的地方（決策十）。 */}
      <div className={`${HUD.body} text-text-secondary border-t border-border pt-2.5`}>
        <div className={`${HUD.label} text-accent-orange mb-1`}>Form Effect</div>
        <RefText text={form.description} refs={form.descriptionRefs} />
      </div>
    </section>
  )
}
