/**
 * verify-guard: a host plugin that notices when a session works inside a real
 * project and injects one user-role reminder about the project's verification
 * baseline.
 *
 * It never runs commands and never edits files. Detection is a bounded,
 * synchronous marker walk from the session working directory.
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const name = 'verify-guard'
export const inject = ['agents', 'workingDirectory']

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

function noticeMessage(text, summary) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'verify-guard', form: 'notice', summary },
  }
}

/**
 * Register the pre-step guard.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context
 */
export function apply(ctx) {
  // session -> last injected verdict. Safe because `Agent.session` is a readonly
  // field of the single ReactLoopAgent that runs every step
  // (dsh-agent-loop/src/agent.ts:137-141), so the same object recurs across steps;
  // a reconstructed session (resume) gets exactly one fresh notice, and weak keys
  // keep no history.
  const seen = new WeakMap()

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision

    let cwd
    try {
      cwd = await ctx.workingDirectory.ensure(agent, signal)
    } catch (error) {
      ctx.logger.warn('verify-guard: working directory unavailable: %o', error)
      return decision
    }
    signal.throwIfAborted()

    const info = detectProject(cwd)
    const key = info.isProject ? `${info.root}|${info.baseline === null ? '' : info.baseline.path}` : ''
    if (seen.get(agent.session) === key) return decision
    if (!info.isProject) {
      seen.set(agent.session, key)
      return decision
    }

    try {
      const message = noticeMessage(guardText(info), `verify-guard: ${info.baseline === null ? 'baseline missing' : 'baseline present'}`)
      seen.set(agent.session, key)
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      ctx.logger.warn('verify-guard: injection failed, passing through: %o', error)
      return decision
    }
  })
}
