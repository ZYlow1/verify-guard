/**
 * verify-guard core: project detection, reminder text, and the pure decision
 * that says whether one step should carry a verification notice.
 *
 * This module has no plugin-framework imports, so the test suite can load it
 * with plain Node.
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

/** Files whose presence marks a directory as a project root. */
export const PROJECT_MARKERS = [
  '.git',
  'pyproject.toml',
  'package.json',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
]

/** Baseline entry points, most specific first. */
export const BASELINE_CANDIDATES = [
  { path: '.dsh/verify/verify.ps1', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\.dsh\\verify\\verify.ps1' },
  { path: '.dsh/verify/verify.sh', command: 'bash ./.dsh/verify/verify.sh' },
  { path: 'verify.ps1', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\verify.ps1' },
  { path: 'verify.sh', command: 'bash ./verify.sh' },
]

/** How many ancestor directories above the working directory may be probed. */
export const MAX_ANCESTOR_HOPS = 4

/** Accepted values of the `notice` setting. */
export const NOTICE_MODES = ['project', 'step', 'baseline-only']

const NOT_A_PROJECT = { isProject: false, root: null, markers: [], baseline: null }

function normalize(directory) {
  const absolute = resolve(directory)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function defaultProbe() {
  return {
    exists: (path) => existsSync(path),
    readdir: (path) => readdirSync(path),
  }
}

function markersAt(directory, probe) {
  const markers = PROJECT_MARKERS.filter((marker) => probe.exists(join(directory, marker)))
  if (markers.length > 0) return markers
  try {
    if (probe.readdir(directory).some((entry) => entry.endsWith('.sln'))) return ['*.sln']
  } catch {
    // Unreadable directory: carry on as if it has no marker.
  }
  return []
}

/** Resolve the baseline entry point, if the project has one. */
export function findBaseline(projectRoot, probe = defaultProbe()) {
  for (const candidate of BASELINE_CANDIDATES) {
    if (probe.exists(join(projectRoot, ...candidate.path.split('/')))) return { ...candidate }
  }
  return null
}

/**
 * Walk up from `cwd` to the nearest directory carrying a project marker.
 *
 * Boundaries (all mandatory):
 * - at most {@link MAX_ANCESTOR_HOPS} hops above `cwd` are probed;
 * - a filesystem root never counts as a project, even when it holds markers;
 * - the user home directory and its direct children never count as project roots.
 *
 * @param {string} cwd - absolute session working directory
 * @param {{ homeDir?: string, probe?: { exists: (path: string) => boolean, readdir: (path: string) => string[] } }} [options]
 * @returns {{ isProject: boolean, root: string | null, markers: string[], baseline: { path: string, command: string } | null }}
 */
export function detectProject(cwd, options = {}) {
  const probe = options.probe ?? defaultProbe()
  const home = normalize(options.homeDir ?? homedir())
  let directory = resolve(cwd)

  for (let depth = 0; depth <= MAX_ANCESTOR_HOPS; depth += 1) {
    const parent = dirname(directory)
    if (parent === directory) return { ...NOT_A_PROJECT }

    const candidateIsHome = normalize(directory) === home
    const candidateIsDirectHomeChild = normalize(parent) === home
    if (!candidateIsHome && !candidateIsDirectHomeChild) {
      const markers = markersAt(directory, probe)
      if (markers.length > 0) {
        return { isProject: true, root: directory, markers, baseline: findBaseline(directory, probe) }
      }
    }

    directory = parent
  }

  return { ...NOT_A_PROJECT }
}

/** Compose the reminder text for one detection result. */
export function guardText(info) {
  const lines = ['<system-reminder>']
  if (info.baseline) {
    lines.push(`Project verification baseline: ${info.root}`)
    lines.push(`Before claiming any task complete, run it and paste the real output: ${info.baseline.command}`)
    lines.push('If a check fails, fix the failure first. Do not add features and do not report success without a run.')
  } else {
    lines.push(`Project root: ${info.root} (markers: ${info.markers.join(', ')}).`)
    lines.push('No verification baseline is installed (no verify.ps1 or verify.sh).')
    lines.push('Before changing code, scan read-only and propose a baseline; do not create files until the user confirms.')
  }
  lines.push('</system-reminder>')
  return lines.join('\n')
}

/**
 * Read a row `config` defensively: the value may be missing, partial, or hand
 * edited in the profile patch. Unknown values fall back to the defaults.
 *
 * @param {unknown} input - raw row configuration
 * @returns {{ enabled: boolean, notice: 'project' | 'step' | 'baseline-only' }}
 */
export function normalizeConfig(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const notice = NOTICE_MODES.includes(source.notice) ? source.notice : 'project'
  return { enabled: source.enabled !== false, notice }
}

/** The deduplication key of one verdict: the root plus which baseline applies. */
export function verdictKey(info) {
  if (!info.isProject) return ''
  return `${info.root}|${info.baseline === null ? '' : info.baseline.path}`
}

/**
 * Decide whether one step should carry a notice, given the row configuration,
 * the detection result, and the session's previous key.
 *
 * @param {unknown} config - raw or normalized row configuration
 * @param {{ isProject: boolean, root: string | null, baseline: { path: string } | null }} info
 * @param {string | undefined} lastKey - the key injected for this session before
 * @returns {{ notify: boolean, key: string }}
 */
export function shouldNotify(config, info, lastKey) {
  const settings = normalizeConfig(config)
  if (!settings.enabled) return { notify: false, key: lastKey ?? '' }
  if (!info.isProject) return { notify: false, key: '' }

  const key = verdictKey(info)
  if (settings.notice === 'baseline-only' && info.baseline !== null) return { notify: false, key }
  if (settings.notice === 'step') return { notify: true, key }
  return { notify: key !== lastKey, key }
}
