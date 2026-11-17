/**
 * verify-guard: a host plugin that notices when a session works inside a real
 * project and injects one user-role reminder about the project's verification
 * baseline.
 *
 * It never runs commands and never edits files. Detection is a bounded,
 * synchronous marker walk from the session working directory.
 *
 * The row's `config` decides whether the reminder is injected at all and how
 * often; the configuration page in **Plugins** writes it.
 */

import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import {
  detectProject, guardText, normalizeConfig, shouldNotify,
} from './detect.js'

export {
  BASELINE_CANDIDATES, MAX_ANCESTOR_HOPS, NOTICE_MODES, PROJECT_MARKERS,
  detectProject, findBaseline, guardText, normalizeConfig, shouldNotify, verdictKey,
} from './detect.js'

export const name = 'verify-guard'
export const inject = ['agents', 'workingDirectory']

/** Editable row configuration; the Plugins page renders it as a form. */
export const Config = z.object({
  enabled: z.boolean().default(true).description(
    'Inject the verification reminder. Off keeps the plugin loaded but silent.',
  ),
  notice: z.union([
    z.const('project'),
    z.const('step'),
    z.const('baseline-only'),
  ]).default('project').description(
    'When to remind: once per project, before every step, or only when the project has no baseline.',
  ),
})

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
 * @param {{ enabled?: boolean, notice?: string }} [config] - row configuration
 */
export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config)
  // Silent means silent: no listener is registered, so a disabled row costs
  // nothing per step.
  if (!settings.enabled) return

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
    const verdict = shouldNotify(settings, info, seen.get(agent.session))
    seen.set(agent.session, verdict.key)
    if (!verdict.notify) return decision

    try {
      const message = noticeMessage(guardText(info), `verify-guard: ${info.baseline === null ? 'baseline missing' : 'baseline present'}`)
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      ctx.logger.warn('verify-guard: injection failed, passing through: %o', error)
      return decision
    }
  })
}
