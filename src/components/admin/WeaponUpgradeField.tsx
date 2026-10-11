// 武器管理：製作・進階關係（PLAN-031 的 upgrade 欄位；後台編輯入口 2026-10-11 補上）
//
// 原本 42 條關係是 PLAN-031 用腳本依「技能名真子集」推導、一次寫入的，後台沒有入口——
// 之後新建的武器一律沒有前置。現在改由維護者在這裡手動指定，**不做任何推論或建議**
// （站長 2026-10-11：資料由我們處理）。推導腳本也已失效：它讀 weapon.skills[].name，
// PLAN-032 改成引用之後武器上只剩 skillId。
//
// 候選**只列同種類**：遊戲裡火箭只能由火箭製作，不存在跨種類的轉換（站長 2026-10-11）。
// 這是遊戲規則不是推論，所以直接鎖死、不給篩選；已存的前置若種類不同（例如後來改了種類）只標警告。
//
// **只有專屬武器（isExclusive）有前置**（站長 2026-10-11；實測 42 條前置全掛在專屬武器上）。
// 非專屬武器不給挑選器——順帶也擋掉最常見的填反：在 S+ 材料那把填了 SS 成品。
// 以後遊戲出現例外再放寬。已存的前置若落在非專屬武器上（例如後來取消了專屬）只標警告、不自動刪，
// 刪不刪由維護者決定（博物館原則：刪掉的資料不會自己長回來）。
//
// 只存「前置」（upgrade.fromWeaponId）；「可進階為」由前台 buildUpgradeIndex 反查，不存（雙向欄位會失同步）。
//
// 「特種背包製作」（複合武器：武器融合背包進階，會投影進背包圖鑑）**只有背後武器**可以設。
// 部位改掉時這裡只顯示警告，真正的移除在存檔時由 normalizeWeaponUpgrade 統一處理。
import { useMemo, useState } from 'react'
import type { Weapon, WeaponUpgrade } from '../../types'
import { useGameData } from '../../contexts/GameDataContext'
import { useBackpacks } from '../../hooks/useFirestore'
import { buildUpgradeIndex, upgradeDescendants } from '../../utils/weaponUpgrade'
import { WeaponIcon } from '../icons/WeaponIcon'
import { Field } from '../../pages/user/admin/shared'
import { WEAPON_RARITY_CLASS } from '../../pages/user/admin/constants'

type UpgradeForm = Pick<Weapon, 'id' | 'kind' | 'equipSlot' | 'isExclusive' | 'upgrade'>

export function WeaponUpgradeField({
  form,
  onChange,
}: {
  form: UpgradeForm
  onChange: (upgrade: WeaponUpgrade | undefined) => void
}) {
  const { weapons } = useGameData()
  const [search, setSearch] = useState('')

  const byId   = useMemo(() => new Map(weapons.map((w) => [w.id, w])), [weapons])
  const index  = useMemo(() => buildUpgradeIndex(weapons), [weapons])

  // 排除自己與自己的下游（子、孫…）：選了會形成循環
  const blocked = useMemo(() => {
    const s = upgradeDescendants(index, form.id)
    s.add(form.id)
    return s
  }, [index, form.id])

  // 上限 80：select 選項太多會卡；標籤要寫「前 N／共 M」，只寫 N 會被當成總數
  const { candidates, total } = useMemo(() => {
    if (!form.kind) return { candidates: [], total: 0 }
    const q = search.trim().toLowerCase()
    const all = weapons
      .filter((w) => !blocked.has(w.id))
      .filter((w) => w.kind === form.kind)
      .filter((w) => !q || w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    return { candidates: all.slice(0, 80), total: all.length }
  }, [weapons, blocked, form.kind, search])

  const upgrade  = form.upgrade
  const parentId = upgrade?.fromWeaponId
  const parent   = parentId ? byId.get(parentId) : undefined
  const children = (index.childrenOf.get(form.id) ?? []).map((id) => byId.get(id)?.name ?? id)
  const isBack   = form.equipSlot === 'back'
  const isComposite = upgrade?.station === 'specialBackpack'
  const kindMismatch = !!parent && !!form.kind && parent.kind !== form.kind
  const canHaveParent = !!form.isExclusive

  function setParent(id: string) {
    if (!id) return
    // 換前置時保留特種背包製作的設定（站別與融合背包屬於「這把武器怎麼做出來」，不跟著母武器走）
    onChange({ ...upgrade, fromWeaponId: id })
    setSearch('')
  }

  return (
    <div className="p-3 bg-bg-dark rounded-lg border border-border/60 space-y-3">
      <p className="text-xs text-text-dim font-medium uppercase tracking-wider">製作・進階關係 upgrade</p>

      {!canHaveParent && !parentId ? (
        <p className="text-[12px] text-text-dim">
          前置武器：只有專屬武器才有前置，這把不是專屬武器，不需要設定。
          （若確定是專屬武器，先到「戰鬥屬性・射程・插槽 → 專屬武器設定」勾選 isExclusive。）
        </p>
      ) : (
      <Field label={`前置武器 fromWeaponId（這把武器由哪把武器製作／進階而來；只列同種類${form.kind ? `「${form.kind}」` : ''}）`}>
        {parentId ? (
          <div className="flex items-center gap-2 bg-bg-card border border-border rounded-lg px-2.5 py-1.5">
            {parent && <WeaponIcon gameId={parent.gameId} icon={parent.icon} name={parent.name} size="sm" />}
            <div className="flex-1 min-w-0 truncate">
              {parent
                ? <span className="text-sm font-medium text-text-primary">{parent.name}</span>
                : <span className="text-sm text-accent-red">⚠ 找不到此武器</span>}
              <span className="text-[11px] text-text-dim font-mono ml-2">{parentId}</span>
            </div>
            {parent && (
              <span className={`text-[12px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${WEAPON_RARITY_CLASS[parent.rarity] ?? 'text-text-dim border-border'}`}>{parent.rarity}</span>
            )}
            <button
              onClick={() => onChange(undefined)}
              className="text-[13px] px-1.5 py-0.5 text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 shrink-0"
              title="清除前置（特種背包製作也一併清除）"
            >✕</button>
          </div>
        ) : (
          <p className="text-[12px] text-text-dim">未設定（不是由其他武器製作而來，就維持空白）</p>
        )}
        {!canHaveParent && (
          <p className="text-[12px] text-accent-yellow mt-1">
            ⚠ 只有專屬武器才有前置，這把不是專屬武器卻設了前置。誤填的話按 ✕ 清除；確定是新的例外請先回報。
          </p>
        )}
        {kindMismatch && (
          <p className="text-[12px] text-accent-yellow mt-1">
            ⚠ 前置武器的種類是「{parent!.kind}」，這把是「{form.kind}」。遊戲沒有跨種類製作，請確認其中一邊的種類是否填錯。
          </p>
        )}
        {!canHaveParent ? null : !form.kind ? (
          <p className="text-[12px] text-text-dim mt-2">先在上方選好武器種類，才會列出可選的前置武器。</p>
        ) : (
        <div className="grid grid-cols-[1fr_2fr] gap-2 mt-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋武器名稱或 ID..."
            className="input-field py-1 text-xs"
          />
          <select value="" onChange={(e) => setParent(e.target.value)} className="input-field py-1 text-xs">
            <option value="">
              {parentId ? '更換前置武器' : '＋ 選擇前置武器'}
              {total > candidates.length ? `（列出前 ${candidates.length}／共 ${total} 把，請用搜尋縮小）` : `（${total} 把）`}
            </option>
            {candidates.map((w) => (
              <option key={w.id} value={w.id}>{w.name}〔{w.rarity}〕 — {w.id}</option>
            ))}
          </select>
        </div>
        )}
      </Field>
      )}

      {children.length > 0 && (
        <p className="text-[12px] text-text-secondary">
          可進階為：{children.join('、')}
          <span className="text-text-dim">（在那幾把武器上設定前置；這裡不必填）</span>
        </p>
      )}

      {isBack && (canHaveParent || isComposite) ? (
        <div className="pt-2 border-t border-border/40 space-y-2">
          <label className={`flex items-center gap-2 text-sm cursor-pointer ${parentId ? 'text-text-secondary' : 'text-text-dim cursor-not-allowed'}`}>
            <input
              type="checkbox"
              checked={isComposite}
              disabled={!parentId}
              onChange={(e) => parentId && onChange(e.target.checked
                ? { ...upgrade, fromWeaponId: parentId, station: 'specialBackpack' }
                : { fromWeaponId: parentId })}
              className="accent-accent-pink w-4 h-4"
            />
            <span>特種背包製作（複合武器：武器融合背包進階而成，會同時出現在背包圖鑑）</span>
          </label>
          {!parentId && <p className="text-[11px] text-text-dim">先選前置武器，才能設定特種背包製作。</p>}
          {isComposite && parentId && (
            <FusedBackpackSelect
              value={upgrade?.fusedBackpackId}
              onChange={(id) => onChange({ ...upgrade, fromWeaponId: parentId, station: 'specialBackpack', fusedBackpackId: id })}
            />
          )}
        </div>
      ) : isComposite ? (
        <p className="text-[12px] text-accent-yellow">
          ⚠ 特種背包製作只有背後武器能設定。目前部位不是背後，儲存時會移除特種背包製作與融合背包，只保留前置武器。
        </p>
      ) : null}
    </div>
  )
}

/** 融合背包挑選。只在勾了特種背包製作時才掛載，武器分頁平常不為此多載 backpacks 集合 */
function FusedBackpackSelect({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (id: string | undefined) => void
}) {
  const { data: backpacks, loading } = useBackpacks()
  const [search, setSearch] = useState('')

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = backpacks
      .filter((b) => !q || b.name.toLowerCase().includes(q) || b.id.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    // 已選中的一律留在清單內，否則 select 會顯示空白
    const sel = value ? backpacks.find((b) => b.id === value) : undefined
    return sel && !filtered.includes(sel) ? [sel, ...filtered] : filtered
  }, [backpacks, search, value])

  const missing = !!value && !loading && !backpacks.some((b) => b.id === value)

  return (
    <Field label="融合背包 fusedBackpackId（照實機確認填寫；不確定就留空）">
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋背包名稱或 ID..."
          className="input-field py-1 text-xs"
        />
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="input-field py-1 text-xs"
          disabled={loading}
        >
          <option value="">{loading ? '背包載入中…' : '（未指定）'}</option>
          {list.map((b) => (
            <option key={b.id} value={b.id}>{b.name}〔{b.rarity}・{b.type}〕 — {b.id}</option>
          ))}
        </select>
      </div>
      {missing && <p className="text-[11px] text-accent-red mt-1">⚠ 找不到背包 {value}（可能已刪除或 ID 打錯）</p>}
    </Field>
  )
}
