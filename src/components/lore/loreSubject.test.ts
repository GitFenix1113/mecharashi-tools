import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAKER_UNKNOWN, matchesSubjectQuery, mechSubject, pilotSubject } from './loreSubject.ts'
import type { Mech, MechLoreDoc, MechMaker, Pilot } from '../../types/index.ts'

const pilot = (p: Partial<Pilot> & { nameEn?: string }) => ({ id: 'pilot_003_洛莎', name: '洛莎', class: '突擊手', ...p }) as Pilot & { nameEn?: string }
const mech = (m: Partial<Mech>) => ({ id: 'mech_002_格萊楊', name: '格萊楊', armorType: '輕型', ...m }) as Mech

// ── 機師：每個字串都要與泛化前元件裡的算法一致（機師廳 DOM 零回歸） ─────────────────

test('pilotSubject：序號、檔案標籤、登場版本', () => {
  const s = pilotSubject(pilot({ debutVersion: '1.0' }))
  assert.equal(s.kind, 'pilot')
  assert.equal(s.serial, '003')
  assert.equal(s.fileLabel, 'PILOT FILE')
  assert.equal(s.debutVersion, '1.0')
  assert.equal(s.stamp, undefined, '機師用英文簽名，沒有型號鋼印')
  assert.equal(s.codexHref, '/pilots/pilot_003_%E6%B4%9B%E8%8E%8E')
})

test('pilotSubject：全名與名字相同就不給（直書小字不重複）', () => {
  assert.equal(pilotSubject(pilot({ fullName: '洛莎·迪亞茲' })).fullName, '洛莎·迪亞茲')
  assert.equal(pilotSubject(pilot({ fullName: '洛莎' })).fullName, undefined)
  assert.equal(pilotSubject(pilot({})).fullName, undefined)
})

test('pilotSubject：提示副標與名冊 title 照原本的寫法', () => {
  const s = pilotSubject(pilot({ fullName: '洛莎·迪亞茲', nameEn: 'Rosa Diaz', debutVersion: '1.0' }))
  assert.equal(s.meta, '突擊手 · v1.0')
  assert.equal(s.rosterTitle, '洛莎·迪亞茲 · Rosa Diaz · 突擊手 · v1.0')
  const bare = pilotSubject(pilot({ debutVersion: '' }))
  assert.equal(bare.meta, '突擊手')
  assert.equal(bare.rosterTitle, '洛莎 · 突擊手')
  assert.equal(bare.debutVersion, undefined, '空字串＝沒有登場版本')
})

test('pilotSubject：色調取職業的紙色；認不得的職業退回中性', () => {
  assert.match(pilotSubject(pilot({})).tone, /\S/)
  assert.notEqual(pilotSubject(pilot({})).tone, 'var(--lore-ink-2)')
  assert.equal(pilotSubject(pilot({ class: '還沒補的新職業' as Pilot['class'] })).tone, 'var(--lore-ink-2)')
})

test('pilotSubject 的搜尋欄位與 matchesLoreQuery 相同：英文名、陣營、v 版本都搜得到', () => {
  const s = pilotSubject(pilot({ nameEn: 'Rosa Diaz', faction: '北陸聯合', debutVersion: '3.4' }))
  for (const q of ['rosa', '北陸', '突擊', 'v3.4', '3.4', '', '  ']) assert.ok(matchesSubjectQuery(s, q), q)
  assert.ok(!matchesSubjectQuery(s, '黑曜石'))
})

// ── 機甲 ─────────────────────────────────────────────────────────────────────

test('mechSubject：型號鋼印、序號、檔案標籤、廠商名', () => {
  const lore = { id: 'mech_002_格萊楊', chapters: [], modelNo: 'DD-117', nameEn: 'Glasya' } as MechLoreDoc
  const maker = { id: 'Doll', name: '多爾集團' } as MechMaker
  const s = mechSubject(mech({ debutVersion: '1.0' }), lore, maker)
  assert.equal(s.kind, 'mech')
  assert.equal(s.serial, '002')
  assert.equal(s.fileLabel, 'MECH FILE')
  assert.equal(s.stamp, 'DD-117')
  assert.equal(s.nameEn, 'Glasya')
  assert.equal(s.meta, '多爾集團 · 輕型 · v1.0')
  assert.equal(s.codexHref, '/mechs/mech_002_%E6%A0%BC%E8%90%8A%E6%A5%8A')
  for (const q of ['dd-117', 'glasya', '多爾', '輕型']) assert.ok(matchesSubjectQuery(s, q), q)
})

test('mechSubject：沒有故事資料、沒有廠商也能畫（廠商顯示「廠商未載」，不留白）', () => {
  const s = mechSubject(mech({}), null, null)
  assert.equal(s.stamp, undefined)
  assert.equal(s.nameEn, undefined)
  assert.equal(s.meta, `${MAKER_UNKNOWN} · 輕型`)
  assert.ok(!matchesSubjectQuery(s, MAKER_UNKNOWN), '「廠商未載」只是顯示用，不該被搜到')
})

test('mechSubject：空白字串當作沒填', () => {
  const lore = { id: 'x', chapters: [], modelNo: '  ', nameEn: '' } as MechLoreDoc
  const s = mechSubject(mech({}), lore, { id: 'UKB', name: ' ' } as MechMaker)
  assert.equal(s.stamp, undefined)
  assert.equal(s.nameEn, undefined)
  assert.ok(s.meta.startsWith(MAKER_UNKNOWN))
})
