// PLAN-032 M1：武器技能雙格式解析單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Weapon, WeaponSkill, PilotSkillDoc } from '../types/index.ts'
import { resolveWeaponSkills, hasWeaponSkills, isWeaponSkillRef } from './weaponSkills.ts'

// ── 測試素材 ─────────────────────────────────────────────────────────────────
// 取真實案例：凝神待發同時被 [赤狐·改 S+] carry 與 [魔笛 SS] use 持有，
// 是本計畫「activation 必須留掛載側」的證據來源。
const 凝神待發: PilotSkillDoc = {
  id: 'skill_凝神待發',
  name: '凝神待發',
  type: '被動技能',
  domain: 'weapon',
  description: '普通攻擊前，若沒有移動過，本次攻擊可以[瞄準]，每回合最多發動3次',
  descriptionRefs: { description: { 瞄準: { refType: 'glossary', refId: 'gt_瞄準' } } },
  icon: 'https://cdn/Icon_skill_passive_5186.png',
  iconLocal: '/images/weapons/skills/Icon_skill_passive_5186.png',
  effects: [],
  buffIds: ['buff_瞄準'],
}

const embedded: WeaponSkill = {
  name: '起爆',
  type: '被動技能',
  activation: 'carry',
  description: '造成傷害時，對命中的部位造成15%武器攻擊力的固定傷害',
  iconLocal: '/images/weapons/skills/Icon_skill_passive_1115.png',
  effects: [],
  buffIds: ['buff_起爆'],
}

const map = new Map<string, PilotSkillDoc>([[凝神待發.id, 凝神待發]])
const skills = (arr: Weapon['skills']) => arr

// ── 鑑別鍵 ───────────────────────────────────────────────────────────────────
test('isWeaponSkillRef：以 skillId 欄位存在與否鑑別，不看 activation', () => {
  assert.equal(isWeaponSkillRef({ skillId: 'skill_凝神待發', activation: 'use' }), true)
  assert.equal(isWeaponSkillRef(embedded), false)   // 內嵌也有 activation，故不可用它當鑑別鍵
})

// ── 解析 ─────────────────────────────────────────────────────────────────────
test('引用格式：技能本體取自技能庫，activation 取自掛載側', () => {
  const [sk] = resolveWeaponSkills(skills([{ skillId: 'skill_凝神待發', activation: 'use' }]), map)
  assert.equal(sk.id, 'skill_凝神待發')
  assert.equal(sk.name, '凝神待發')
  assert.equal(sk.activation, 'use')                       // ← 掛載側勝出（doc 根本沒這欄）
  assert.equal(sk.description, 凝神待發.description)
  assert.deepEqual(sk.buffIds, ['buff_瞄準'])
  assert.equal(sk.origin, '武器技能:凝神待發')
})

test('同一份定義被兩把武器以不同 activation 掛載 → 各自正確', () => {
  const 赤狐 = resolveWeaponSkills(skills([{ skillId: 'skill_凝神待發', activation: 'carry' }]), map)
  const 魔笛 = resolveWeaponSkills(skills([{ skillId: 'skill_凝神待發', activation: 'use' }]), map)
  assert.equal(赤狐[0].activation, 'carry')
  assert.equal(魔笛[0].activation, 'use')
  assert.equal(赤狐[0].description, 魔笛[0].description)   // 定義只有一份 → 不可能漂移
})

test('內嵌格式：原地攤平，id 為空字串', () => {
  const [sk] = resolveWeaponSkills(skills([embedded]), map)
  assert.equal(sk.id, '')                                  // 未遷移＝無技能庫 doc
  assert.equal(sk.name, '起爆')
  assert.equal(sk.activation, 'carry')
  assert.deepEqual(sk.buffIds, ['buff_起爆'])
})

test('雙格式混用：順序保留', () => {
  const out = resolveWeaponSkills(
    skills([embedded, { skillId: 'skill_凝神待發', activation: 'use' }]), map)
  assert.deepEqual(out.map((s) => s.name), ['起爆', '凝神待發'])
})

// ── 優雅降級 ─────────────────────────────────────────────────────────────────
test('查不到的 skillId 略過而非拋錯（技能庫未載入 / doc 被刪）', () => {
  const out = resolveWeaponSkills(
    skills([{ skillId: 'skill_不存在', activation: 'carry' }, embedded]), map)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, '起爆')
})

test('空技能庫時，引用格式解析為 0 筆（M6 flip 前後的 loading 狀態）', () => {
  const out = resolveWeaponSkills(
    skills([{ skillId: 'skill_凝神待發', activation: 'use' }]), new Map())
  assert.deepEqual(out, [])
})

test('undefined / 空陣列邊界', () => {
  assert.deepEqual(resolveWeaponSkills(undefined, map), [])
  assert.deepEqual(resolveWeaponSkills(skills([]), map), [])
})

// ── gate ─────────────────────────────────────────────────────────────────────
test('hasWeaponSkills：斷鏈的引用不算「有技能」（避免渲染空技能區）', () => {
  const 斷鏈 = skills([{ skillId: 'skill_不存在', activation: 'carry' }])
  assert.equal(斷鏈.length > 0, true)                       // 裸 .length 會誤判為有
  assert.equal(hasWeaponSkills(斷鏈, map), false)           // 這正是本函式存在的理由
  assert.equal(hasWeaponSkills(skills([embedded]), map), true)
  assert.equal(hasWeaponSkills(undefined, map), false)
})

// ── M6 flip 前的行為契約：模擬 flip 後的資料形狀 ──────────────────────────────
// 這組測試存在的理由：flip 是單向的，而「技能庫還沒載入」是每次冷開頁都會經過的狀態。
// 若那個瞬間的行為不對，症狀是「武器技能區偶爾空白」——難重現、難追。

test('flip 後 + 技能庫未載入 → 解析 0 筆，hasWeaponSkills 為 false', () => {
  const flipped = skills([
    { skillId: 'skill_起爆', activation: 'carry' },
    { skillId: 'skill_凝神待發', activation: 'use' },
  ])
  // 載入中：GameDataContext 尚未填入 pilotSkills，map 為空
  assert.deepEqual(resolveWeaponSkills(flipped, new Map()), [])
  assert.equal(hasWeaponSkills(flipped, new Map()), false)   // ← gate 關閉，不渲染空技能區
  // 載入完成（map 有 skill_凝神待發、無 skill_起爆）→ gate 開啟，顯示查得到的那筆
  assert.equal(hasWeaponSkills(flipped, map), true)
  assert.deepEqual(resolveWeaponSkills(flipped, map).map(s => s.name), ['凝神待發'])
})

test('flip 後 + 技能庫已載入 → 只解析得到庫裡有的那些（部分斷鏈仍降級）', () => {
  const flipped = skills([
    { skillId: 'skill_不存在', activation: 'carry' },
    { skillId: 'skill_凝神待發', activation: 'use' },
  ])
  const out = resolveWeaponSkills(flipped, map)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, '凝神待發')
  assert.equal(hasWeaponSkills(flipped, map), true)   // 至少一筆解析得到 → gate 開啟
})

test('ResolvedWeaponSkill 涵蓋消費端需要的全部欄位（欄位漏了就是前台少顯示一塊）', () => {
  const doc: PilotSkillDoc = {
    ...凝神待發,
    id: 'skill_專武', name: '專武技能',
    enhancesTalentName: '悖想先驅',
    enhancedTalentDescription: '強化後的天賦原文',
  }
  const [sk] = resolveWeaponSkills(
    skills([{ skillId: 'skill_專武', activation: 'equip' }]),
    new Map([[doc.id, doc]]),
  )
  // 逐一對齊消費端實際讀的欄位（WeaponSkillCard / PilotDetailPage / WeaponsPage / BackpacksPage）
  for (const k of ['id', 'name', 'type', 'activation', 'description', 'descriptionRefs',
                   'iconLocal', 'effects', 'buffIds', 'enhancesTalentName',
                   'enhancedTalentDescription', 'origin'] as const) {
    assert.ok(sk[k] !== undefined, `ResolvedWeaponSkill 缺少 ${k}`)
  }
  assert.equal(sk.enhancesTalentName, '悖想先驅')
  assert.equal(sk.enhancedTalentDescription, '強化後的天賦原文')
  assert.equal(sk.activation, 'equip')   // 掛載側，非 doc 的欄位
})
