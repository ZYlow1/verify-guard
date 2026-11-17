/**
 * Unit tests for verify-guard. Plain node:assert, no test runner.
 * Run: node test/detect.test.mjs
 *
 * The core module has no plugin-framework import, so this file never needs the
 * harness: `index.js` is the only file that imports schemastery.
 */

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MAX_ANCESTOR_HOPS, detectProject, guardText, normalizeConfig, shouldNotify, verdictKey,
} from '../detect.js'

const root = join(tmpdir(), `verify-guard-test-${process.pid}`)
let passed = 0
let failed = 0

function check(label, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${label}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${label}: ${error.message}`)
  }
}

function constProbe(hasMarker) {
  return {
    exists: (path) => hasMarker(path),
    readdir: () => [],
  }
}

const BASELINE = { path: 'verify.ps1', command: 'powershell -File .\\verify.ps1' }
const WITH_BASELINE = { isProject: true, root: 'C:\\work\\app', markers: ['package.json'], baseline: BASELINE }
const WITHOUT_BASELINE = { isProject: true, root: 'C:\\work\\app', markers: ['package.json'], baseline: null }
const NOT_PROJECT = { isProject: false, root: null, markers: [], baseline: null }

try {
  rmSync(root, { recursive: true, force: true })

  // 1. plain temporary directory is not a project
  const plain = join(root, 'plain')
  mkdirSync(plain, { recursive: true })
  check('non-project temp dir -> false', () => {
    const info = detectProject(plain)
    assert.equal(info.isProject, false)
    assert.equal(info.root, null)
  })

  // 2. deep subdirectory resolves the real project root
  const project = join(root, 'project')
  const deep = join(project, 'src', 'a', 'b')
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(project, 'package.json'), '{"name":"fixture"}')
  check('deep subdir -> project root', () => {
    const info = detectProject(deep)
    assert.equal(info.isProject, true)
    assert.equal(info.root, project)
    assert.deepEqual(info.markers, ['package.json'])
  })

  // 3. baseline is discovered
  mkdirSync(join(project, '.dsh', 'verify'), { recursive: true })
  writeFileSync(join(project, '.dsh', 'verify', 'verify.ps1'), '# stub')
  check('project with verify.ps1 -> baseline', () => {
    const info = detectProject(deep)
    assert.equal(info.baseline.path, '.dsh/verify/verify.ps1')
    assert.match(info.baseline.command, /verify\.ps1$/)
    assert.match(guardText(info), /Project verification baseline/)
  })

  // 4. drive root is never a project, even when a probe reports markers there
  check('drive root -> false (real fs)', () => {
    assert.equal(detectProject('D:\\').isProject, false)
  })
  check('drive root -> false (marker probe always true)', () => {
    const info = detectProject('D:\\', {
      homeDir: 'C:\\Users\\fixture',
      probe: constProbe(() => true),
    })
    assert.equal(info.isProject, false)
  })

  // 5. depth boundary: exactly MAX_ANCESTOR_HOPS is found, one more is not
  let limitCursor = project
  for (let i = 0; i < MAX_ANCESTOR_HOPS; i += 1) {
    limitCursor = join(limitCursor, 'd')
    mkdirSync(limitCursor)
  }
  const limit = limitCursor
  check(`marker at ${MAX_ANCESTOR_HOPS} hops -> true`, () => {
    assert.equal(detectProject(limit).isProject, true)
  })
  const beyond = join(limit, 'd')
  mkdirSync(beyond, { recursive: true })
  check(`marker at ${MAX_ANCESTOR_HOPS + 1} hops -> false`, () => {
    assert.equal(detectProject(beyond).isProject, false)
  })

  // 6. home directory and its direct children are skipped as roots
  check('home and direct children -> skipped', () => {
    const home = 'C:\\Users\\fixture'
    const probe = constProbe((path) => path.toLowerCase().startsWith(home.toLowerCase()))
    assert.equal(detectProject(home, { homeDir: home, probe }).isProject, false)
    assert.equal(detectProject(join(home, 'Documents'), { homeDir: home, probe }).isProject, false)
  })

  // 7. row configuration is read defensively
  check('empty config -> enabled, once per project', () => {
    assert.deepEqual(normalizeConfig(undefined), { enabled: true, notice: 'project' })
    assert.deepEqual(normalizeConfig({}), { enabled: true, notice: 'project' })
  })
  check('explicit false / unknown values -> defaults', () => {
    assert.deepEqual(normalizeConfig({ enabled: false }), { enabled: false, notice: 'project' })
    assert.deepEqual(normalizeConfig({ notice: 'whenever' }), { enabled: true, notice: 'project' })
    assert.deepEqual(normalizeConfig('garbage'), { enabled: true, notice: 'project' })
  })
  check('accepted notice values survive', () => {
    for (const notice of ['project', 'step', 'baseline-only']) {
      assert.equal(normalizeConfig({ notice }).notice, notice)
    }
  })

  // 8. notice decisions
  check('non-project -> never notifies', () => {
    assert.deepEqual(shouldNotify({}, NOT_PROJECT, undefined), { notify: false, key: '' })
  })
  check('project mode -> once per verdict, again when the baseline changes', () => {
    const first = shouldNotify({}, WITH_BASELINE, undefined)
    assert.equal(first.notify, true)
    assert.equal(first.key, verdictKey(WITH_BASELINE))
    assert.equal(shouldNotify({}, WITH_BASELINE, first.key).notify, false)
    assert.equal(shouldNotify({}, WITHOUT_BASELINE, first.key).notify, true)
  })
  check('step mode -> every step', () => {
    const key = verdictKey(WITH_BASELINE)
    assert.equal(shouldNotify({ notice: 'step' }, WITH_BASELINE, key).notify, true)
    assert.equal(shouldNotify({ notice: 'step' }, WITHOUT_BASELINE, undefined).notify, true)
  })
  check('baseline-only -> silent when a baseline exists', () => {
    const config = { notice: 'baseline-only' }
    assert.equal(shouldNotify(config, WITH_BASELINE, undefined).notify, false)
    const first = shouldNotify(config, WITHOUT_BASELINE, undefined)
    assert.equal(first.notify, true)
    assert.equal(shouldNotify(config, WITHOUT_BASELINE, first.key).notify, false)
  })
  check('enabled false -> silent in every mode', () => {
    for (const notice of ['project', 'step', 'baseline-only']) {
      assert.equal(shouldNotify({ enabled: false, notice }, WITH_BASELINE, undefined).notify, false)
    }
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n== RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed) ==`)
process.exit(failed === 0 ? 0 : 1)
