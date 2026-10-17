import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gachaTitleSuggestions } from './mechGachaTitle.ts'
import type { PatchHalf, PatchVersion, TimedActivity } from '../../data/patchVersions/types.ts'

const act = (name: string, mechs: string[], startDate: string, type = 'specificMechBanner'): TimedActivity =>
  ({ name, mechs, startDate, type } as TimedActivity)
const half = (tw: TimedActivity[] = [], cn: TimedActivity[] = []): PatchHalf => ({ twActivities: tw, cnActivities: cn } as PatchHalf)
const ver = (version: string, upper: PatchHalf, lower: PatchHalf = half()): PatchVersion => ({ version, upper, lower } as PatchVersion)

test('只收這台的機甲卡池：機師卡池、別台、空名稱都不算', () => {
  const v = [ver('3.3', half([
    act('可能性的彼端', ['莫比烏斯X'], '2026/10/01'),
    act('希望再臨之時', ['莫比烏斯X'], '2026/10/01', 'specificPilotBanner'),
    act('鐵幕法典', ['君權'], '2026/10/15'),
    act('  ', ['莫比烏斯X'], '2026/10/01'),
  ]))]
  assert.deepEqual(gachaTitleSuggestions('莫比烏斯X', v).map((s) => s.title), ['可能性的彼端'])
  assert.deepEqual(gachaTitleSuggestions(undefined, v), [])
})

test('同名復刻只留最早那次；只差結尾驚嘆號算同一個；台服在前', () => {
  const v = [
    ver('2.0', half([act('輝光燦然', ['藍柱石'], '2024/10/16')], [act('辉光灿然', ['藍柱石'], '2024/03/01')])),
    ver('3.0', half([act('輝光燦然！', ['藍柱石 '], '2025/12/01')])),
  ]
  const s = gachaTitleSuggestions('藍柱石', v)
  assert.deepEqual(s.map((x) => [x.server, x.title, x.date]), [['tw', '輝光燦然', '2024/10/16'], ['cn', '辉光灿然', '2024/03/01']])
})
