window.__ModuleLoader__.load({
  id: 'dsh-verify-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'verifyGuard'

    const en = {
      summary: 'Reminds the agent to run the project verification baseline before claiming completion.',
      enabled: 'Inject the reminder',
      enabledHint: 'Off keeps the plugin loaded but silent.',
      notice: 'When to remind',
      project: 'Once per project',
      projectHint: 'One notice per project root, and again when its baseline appears or disappears.',
      step: 'Every step',
      stepHint: 'A notice before every model step. Strongest, and the noisiest.',
      baselineOnly: 'Only without a baseline',
      baselineOnlyHint: 'Stay silent for projects that already have verify.ps1 or verify.sh.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      unsaved: 'Unsaved changes',
      failed: 'The deployment did not accept these values; they were left for you to correct.',
      loading: 'Reading the current configuration…',
      unavailable: 'This deployment did not expose a configuration form for this plugin.',
      readOnly: 'This deployment stores configuration read-only.',
    }

    const zh = {
      summary: '在声称完成前提醒 Agent 先运行项目的验证基线。',
      enabled: '注入提醒',
      enabledHint: '关闭后插件仍在加载，但不会说话。',
      notice: '提醒时机',
      project: '每个项目一次',
      projectHint: '每个项目根提醒一次；基线出现或消失时会再提醒一次。',
      step: '每一步',
      stepHint: '每次模型步之前都提醒。强度最高，也最吵。',
      baselineOnly: '仅在缺基线时',
      baselineOnlyHint: '已有 verify.ps1 或 verify.sh 的项目保持静默。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      unsaved: '有未保存的修改',
      failed: '本部署没有接受这些值，已保留供你修改。',
      loading: '正在读取当前配置…',
      unavailable: '本部署没有为该插件提供配置表单。',
      readOnly: '本部署的配置为只读。',
    }

    const token = {
      text: 'var(--dsw-alias-text, inherit)',
      muted: 'var(--dsw-alias-text-secondary, rgba(127, 127, 127, 0.8))',
      border: 'var(--dsw-alias-border, rgba(127, 127, 127, 0.35))',
      accent: 'var(--dsw-alias-accent, #2f7fe0)',
      surface: 'var(--dsw-alias-bg, transparent)',
    }

    const NOTICE_OPTIONS = [
      ['project', 'projectHint'],
      ['step', 'stepHint'],
      ['baseline-only', 'baselineOnlyHint'],
    ]

    const LABEL_KEYS = {
      project: 'project',
      step: 'step',
      'baseline-only': 'baselineOnly',
    }

    function style(extra) {
      return Object.assign({ color: token.text, font: 'inherit' }, extra)
    }

    function Toggle(props) {
      const { checked, disabled, label, hint, onChange } = props
      const track = style({
        width: 36,
        height: 20,
        flex: 'none',
        marginTop: 2,
        padding: 0,
        borderRadius: 10,
        border: `1px solid ${checked ? token.accent : token.border}`,
        background: checked ? token.accent : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        position: 'relative',
        transition: 'background 120ms ease, border-color 120ms ease',
      })
      const knob = {
        position: 'absolute',
        top: 1,
        left: checked ? 17 : 1,
        width: 16,
        height: 16,
        borderRadius: 8,
        background: checked ? '#fff' : token.border,
        transition: 'left 120ms ease',
      }
      return h('div', { style: style({ display: 'flex', gap: 12, alignItems: 'flex-start' }) },
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled,
          onClick: () => { if (!disabled) onChange(!checked) },
          style: track,
        }, h('span', { style: knob })),
        h('span', { style: style({ display: 'flex', flexDirection: 'column', gap: 2 }) },
          h('span', { style: style({ fontSize: 14 }) }, label),
          h('span', { style: style({ fontSize: 12, color: token.muted }) }, hint),
        ),
      )
    }

    function NoticeChoice(props) {
      const { value, current, disabled, label, hint, onSelect } = props
      const selected = value === current
      return h('label', {
        style: style({
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          padding: '8px 10px',
          borderRadius: 8,
          border: `1px solid ${selected ? token.accent : token.border}`,
          cursor: disabled ? 'default' : 'pointer',
        }),
      },
        h('input', {
          type: 'radio',
          name: 'verify-guard-notice',
          value,
          checked: selected,
          disabled,
          onChange: () => { if (!disabled) onSelect(value) },
          style: { marginTop: 3, accentColor: token.accent },
        }),
        h('span', { style: style({ display: 'flex', flexDirection: 'column', gap: 2 }) },
          h('span', { style: style({ fontSize: 14 }) }, label),
          h('span', { style: style({ fontSize: 12, color: token.muted }) }, hint),
        ),
      )
    }

    function VerifyGuardForm(props) {
      const { t, form } = props
      const text = typeof t === 'function' ? t : (key) => key
      const snapshot = form === undefined ? undefined : form.state
      const accepted = snapshot === undefined ? {} : (snapshot.value || {})
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const revision = snapshot === undefined ? undefined : snapshot.revision

      React.useEffect(() => { setDraft(null) }, [revision])

      if (snapshot === undefined) {
        return h('p', { style: style({ fontSize: 13, color: token.muted }) }, text('unavailable'))
      }
      if (snapshot.status === 'loading') {
        return h('p', { style: style({ fontSize: 13, color: token.muted }) }, text('loading'))
      }
      if (snapshot.status === 'unavailable') {
        return h('p', { style: style({ fontSize: 13, color: token.muted }) }, text('unavailable'))
      }

      const readOnly = snapshot.writable === false
      const staged = draft === null ? accepted : draft
      const enabled = staged.enabled !== false
      const notice = typeof staged.notice === 'string' ? staged.notice : 'project'
      const dirty = staged.enabled !== accepted.enabled || staged.notice !== accepted.notice

      function edit(next) {
        setDraft(Object.assign({ enabled, notice }, next))
        setNote('')
      }

      async function save() {
        if (form === undefined || readOnly) return
        const ops = []
        if (staged.enabled !== accepted.enabled) ops.push({ op: 'set', path: ['enabled'], value: staged.enabled !== false })
        if (staged.notice !== accepted.notice) ops.push({ op: 'set', path: ['notice'], value: notice })
        if (ops.length === 0) return
        setBusy(true)
        setNote('')
        try {
          const acceptedWrite = await form.mutate(ops, snapshot.revision)
          setNote(acceptedWrite ? text('saved') : text('failed'))
          if (acceptedWrite) setDraft(null)
        } catch (error) {
          setNote(text('failed'))
          console.error('verify-guard: configuration write failed', error)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: style({ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 560 }) },
        h(Toggle, {
          checked: enabled,
          disabled: readOnly || busy,
          label: text('enabled'),
          hint: text('enabledHint'),
          onChange: (value) => edit({ enabled: value }),
        }),
        h('fieldset', { style: style({ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }) },
          h('legend', { style: style({ padding: 0, marginBottom: 6, fontSize: 13, color: token.muted }) }, text('notice')),
          NOTICE_OPTIONS.map(([value, hintKey]) => h(NoticeChoice, {
            key: value,
            value,
            current: notice,
            disabled: readOnly || busy,
            label: text(LABEL_KEYS[value]),
            hint: text(hintKey),
            onSelect: (next) => edit({ notice: next }),
          })),
        ),
        h('div', { style: style({ display: 'flex', alignItems: 'center', gap: 12 }) },
          h('button', {
            type: 'button',
            disabled: busy || readOnly || !dirty,
            onClick: () => { void save() },
            style: style({
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${dirty && !readOnly ? token.accent : token.border}`,
              background: 'transparent',
              cursor: busy || readOnly || !dirty ? 'default' : 'pointer',
              opacity: busy || readOnly || !dirty ? 0.6 : 1,
              fontSize: 13,
            }),
          }, busy ? text('saving') : text('save')),
          h('span', { style: style({ fontSize: 12, color: token.muted }) },
            note || (readOnly ? text('readOnly') : (dirty ? text('unsaved') : '')),
          ),
        ),
      )
    }

    function VerifyGuardConfig(props) {
      const { t, view, form } = props
      const text = typeof t === 'function' ? t : (key) => key
      if (view === 'summary') return text('summary')
      return h(VerifyGuardForm, { t: text, form })
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'verify-guard: dictionaries')
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-verify-guard#verify-guard',
          locale: NS,
        }, VerifyGuardConfig))
      },
    }
  },
})
