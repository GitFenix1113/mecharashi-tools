// PLAN-059 B-1：職業單一來源
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PilotClass } from '../types/enums.ts'
import { PILOT_CLASSES, PILOT_CLASS_NAMES, pilotClassBadgeClass, pilotClassIconKey, pilotClassMeta } from './pilotClasses.ts'

const iconFile = (key: string) => new URL(`../../public/images/game/icons/class/${key}.webp`, import.meta.url)

test('enum 的每個職業都有對照，而且只有一筆', () => {
  assert.deepEqual([...PILOT_CLASS_NAMES].sort(), Object.values(PilotClass).sort())
  assert.equal(new Set(PILOT_CLASS_NAMES).size, PILOT_CLASS_NAMES.length)
})

test('順序＝遊戲內篩選畫面：守護者在機械師前面（和圖示編號相反）', () => {
  assert.deepEqual(PILOT_CLASS_NAMES, ['格鬥家', '突擊手', '狙擊手', '戰術家', '守護者', '機械師', '調構師'])
})

test('官方圖示編號：與 pilots.biometicComputer 的職業單元圖示一致（006 守護者、010 調構師）', () => {
  assert.equal(pilotClassIconKey('守護者', 'l'), 'Icon_pilotclass_006_l')
  assert.equal(pilotClassIconKey('機械師', 's'), 'Icon_pilotclass_005_s')
  assert.equal(pilotClassIconKey('調構師', 'l'), 'Icon_pilotclass_010_l')
  assert.equal(pilotClassIconKey('不存在的職業', 'l'), undefined)
  assert.equal(pilotClassIconKey(undefined, 'l'), undefined)
})

test('每個職業的 _l 與 _s 都在圖庫裡（--emblems 匯入的）', () => {
  for (const c of PILOT_CLASSES) {
    for (const size of ['l', 's'] as const) {
      const key = pilotClassIconKey(c.name, size)!
      assert.ok(fs.existsSync(iconFile(key)), `${c.name} 缺 ${key}.webp`)
    }
  }
})

test('英文名：只有調構師是暫用的非官方譯名', () => {
  assert.deepEqual(PILOT_CLASSES.filter((c) => !c.enOfficial).map((c) => c.name), ['調構師'])
  assert.equal(pilotClassMeta('突擊手')?.en, 'Raider')
})

test('色類名完整、各職業不重複；認不得的職業給中性樣式', () => {
  assert.equal(new Set(PILOT_CLASSES.map((c) => c.text)).size, PILOT_CLASSES.length)
  for (const c of PILOT_CLASSES) {
    assert.match(c.text, /^text-accent-[a-z]+$/)
    assert.match(c.bar, /^bg-accent-[a-z]+$/)
  }
  assert.equal(pilotClassBadgeClass('守護者'), 'text-accent-green bg-accent-green/10 border-accent-green/40')
  assert.equal(pilotClassBadgeClass(''), 'text-text-secondary bg-bg-card border-border')
})
