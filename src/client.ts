/**
 * Browser half of @ohmejj/dsh-chat-archive: a dedicated **Settings section**
 * (“对话自动归档”) that appears as its own entry in the Settings dialog's left
 * navigation, bound to the `chat-archive` settings namespace registered by the
 * Host half (src/archiver.ts).
 *
 * IMPORTANT (load-order contract): this file is served VERBATIM by the
 * deployment's client-modules bundle route and executed in a lazy-CJS module
 * loader, so it must stay a self-contained file in the
 * `window.__ModuleLoader__.load({ id, factory })` format:
 *   - NO static imports/exports (this file has none);
 *   - dependencies (react, the snapshot-store helper) are required INSIDE the
 *     factory through the loader-provided require;
 *   - nothing TypeScript-only may survive into dist (tsc strips annotations).
 *
 * Edits are staged locally and written only on Save through the client
 * settings scope; saving persists into the Host settings store (settings.yaml)
 * so values survive restarts and page reloads.
 */

// Ambient globals available in the loader page (this build has no DOM lib).
declare const window: any
declare const document: any
declare const setTimeout: (callback: () => void, delayMs: number) => any

/** Structural settings-scope snapshot used by the section. */
interface ScopeSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value?: Record<string, unknown>
  base?: unknown
  user?: unknown
  writable: boolean
}

/** Structural settings-scope handle used by the section. */
interface SettingsScopeLike {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** One field's wire format + parse rules. */
interface FieldSpec {
  field: string
  format: (value: unknown) => string
  parse: (text: string) => { kind: 'set'; value: unknown } | { kind: 'clear' } | undefined
}

/** Draft the section stages for one field. */
interface Draft {
  text: string
  clear: boolean
}

/** A single staged field's derived view. */
interface FieldView {
  text: string
  overridden: boolean
  invalid: boolean
}

type FieldKey = 'enabled' | 'unit' | 'threshold' | 'intervalMinutes'

/** The section's whole state projection. */
interface SectionState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  enabled: FieldView
  unit: FieldView
  threshold: FieldView
  intervalMinutes: FieldView
}

function dshChatArchiveClientFactory(requireFn: (id: string) => any): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> }
  const React = requireFn('react')
  const { createSnapshotStore } = requireFn('@deepseek-ai/dsh-client-store')

  // ── styles (injected once per page; tokens follow the app's design vars) ──
  const css = [
    '.dsac_section{display:flex;flex-direction:column;gap:6px;max-width:640px;padding-bottom:28px}',
    '.dsac_title{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:24px;margin:0}',
    '.dsac_sub{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5;margin:2px 0 10px}',
    '.dsac_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none}',
    '.dsac_body{padding:2px 16px 8px}',
    '.dsac_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}',
    '.dsac_footer{justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
    '.dsac_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
    '.dsac_ran{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;margin:0;font-size:12px;line-height:1.5}',
    '.dsac_btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
    '.dsac_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
    '.dsac_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
    '.dsac_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
    '.dsac_run{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0}',
    '.dsac_run:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}',
    '.dsac_btn:disabled{opacity:.4;cursor:default}',
    '.dsac_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    '.dsac_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
    '.dsac_field+.dsac_field{border-top:1px solid var(--dsw-alias-border-l2)}',
    '.dsac_head{align-items:center;gap:8px;display:flex}',
    '.dsac_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}',
    '.dsac_badges{align-items:center;gap:8px;display:inline-flex}',
    '.dsac_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
    '.dsac_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
    '.dsac_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
    '.dsac_reset:disabled{cursor:default}',
    '.dsac_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}',
    '.dsac_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
    '.dsac_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
    '.dsac_inputInvalid{border-color:var(--dsw-alias-label-error)}',
    '.dsac_row{display:flex;gap:8px;align-items:stretch}',
    '.dsac_row .dsac_input{flex:1;min-width:0}',
    '.dsac_select{flex:none;width:auto;min-width:96px;appearance:auto}',
    '.dsac_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}',
    '.dsac_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
    '.dsac_toggleRow{align-items:center;gap:10px;display:flex}',
    '.dsac_toggle{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;cursor:pointer}',
    '.dsac_toggle:disabled{cursor:default}',
  ].join('')
  const tagId = '@ohmejj/dsh-chat-archive/settings.css'
  if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@ohmejj/dsh-chat-archive'
    tag.dataset.pluginCss = tagId
    tag.textContent = css
    document.head.appendChild(tag)
  }

  // ── locale ──
  const zh: Record<string, string> = {
    nav: '对话自动归档',
    title: '对话自动归档',
    description: '闲置超过阈值的会话自动进入 DSH 归档集（数据保留，可恢复）。',
    enabled: '启用自动归档',
    enabledHint: '关闭后不执行任何扫描与归档。',
    threshold: '闲置超过以下时长即归档',
    thresholdHint: '以会话最后一次活动（持久化日志写入时间）为准；正在运行的会话不会被归档。',
    thresholdUnitHint: '单位支持：分钟 / 小时 / 天。',
    unitMinutes: '分钟',
    unitHours: '小时',
    unitDays: '天',
    invalidNumber: '必须是正整数',
    interval: '扫描间隔（分钟）',
    intervalHint: 'Host 每隔这么多分钟检查一次（1–10080）。会话须连续闲置满“阈值与间隔中的较大值”才会被归档——即最近一个完整扫描间隔内没有任何对话。',
    runNow: '立即归档',
    ran: '已触发一次归档扫描',
    saved: '已保存，立即生效',
    overridden: '已覆盖',
    reset: '重置',
    save: '保存',
    saving: '保存中…',
    saveFailed: '保存失败',
    discard: '放弃',
    readOnly: '当前连接为只读，无法修改配置。',
  }
  const en: Record<string, string> = {
    nav: 'Auto-archive conversations',
    title: 'Auto-archive conversations',
    description: 'Sessions idle past the threshold move into the DSH archive set (data retained, recoverable).',
    enabled: 'Enable automatic archiving',
    enabledHint: 'When off, no scan or archive ever runs.',
    threshold: 'Archive after this much inactivity',
    thresholdHint: "Measured from the session's last activity (durable log write); running sessions are never archived.",
    thresholdUnitHint: 'Unit: minutes / hours / days.',
    unitMinutes: 'minutes',
    unitHours: 'hours',
    unitDays: 'days',
    invalidNumber: 'Must be a positive integer',
    interval: 'Scan interval (minutes)',
    intervalHint: 'How often the Host re-scans (1–10080). A session is archived only after it has been continuously idle for max(threshold, one full interval) — i.e. no conversation during the most recent scan interval.',
    runNow: 'Archive now',
    ran: 'Archive scan triggered',
    saved: 'Saved — active immediately',
    overridden: 'Overridden',
    reset: 'Reset',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'Save failed',
    discard: 'Discard',
    readOnly: 'This connection is read-only.',
  }
  const lang: 'zh' | 'en' =
    typeof document !== 'undefined' && typeof document.documentElement.lang === 'string' && document.documentElement.lang.toLowerCase().startsWith('zh')
      ? 'zh'
      : 'en'
  const t = (key: string): string => (lang === 'zh' ? zh[key] : en[key]) ?? key

  // ── field specs ──
  function integerField(field: FieldKey): FieldSpec {
    return {
      field,
      format: (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : ''),
      parse: (text: string) => {
        const trimmed = text.trim()
        if (trimmed === '') return { kind: 'clear' }
        const parsed = Number(trimmed)
        return Number.isInteger(parsed) && parsed > 0 ? { kind: 'set', value: parsed } : undefined
      },
    }
  }
  function booleanField(field: FieldKey): FieldSpec {
    return {
      field,
      format: (value: unknown): string => (value === true ? 'true' : 'false'),
      parse: (text: string) => ({ kind: 'set', value: text === 'true' }),
    }
  }
  function unitField(field: FieldKey): FieldSpec {
    return {
      field,
      format: (value: unknown): string => (value === 'minutes' || value === 'hours' || value === 'days' ? value : ''),
      parse: (text: string) => (text === 'minutes' || text === 'hours' || text === 'days' ? { kind: 'set', value: text } : undefined),
    }
  }

  // ── staged form model: edits stage locally; only Save writes ──
  class FormController {
    private readonly scope: SettingsScopeLike
    private readonly specs: Map<string, FieldSpec>
    private readonly staged: Map<string, Draft> = new Map()
    private readonly listeners: Set<() => void> = new Set()
    private saving = false
    private failed = false

    constructor(scope: SettingsScopeLike, specs: readonly FieldSpec[]) {
      this.scope = scope
      this.specs = new Map(specs.map((spec) => [spec.field, spec]))
      scope.subscribe(() => this.publish())
    }

    bind(project: () => unknown): unknown {
      const store = createSnapshotStore(project())
      this.listeners.add(() => store.set(project()))
      return store
    }

    shell(): { available: boolean; writable: boolean; dirty: boolean; invalid: boolean; saving: boolean; failed: boolean } {
      const snapshot = this.scope.getSnapshot()
      const plan = this.plan()
      return {
        available: snapshot.status === 'ready',
        writable: snapshot.writable,
        dirty: plan.length > 0,
        invalid: plan.some((item) => item.run === undefined),
        saving: this.saving,
        failed: this.failed,
      }
    }

    fieldView(field: FieldKey): FieldView {
      const staged = this.staged.get(field)
      const spec = this.specs.get(field)
      if (spec === undefined) return { text: '', overridden: false, invalid: false }
      if (staged === undefined) {
        return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
      }
      const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
      return {
        text: staged.text,
        overridden: write !== undefined && write.kind === 'set',
        invalid: write === undefined,
      }
    }

    actions(): { edit: (field: string, text: string) => void; resetField: (field: string) => void; save: () => Promise<void>; discard: () => void; runNow: () => Promise<void> } {
      return {
        edit: (field: string, text: string) => this.stage(field, { text, clear: false }),
        resetField: (field: string) => {
          this.stage(field, { text: this.specs.get(field)?.format(this.baseValue(field)) ?? '', clear: true })
        },
        save: () => this.save(),
        discard: () => this.discard(),
        runNow: () => this.runNow(),
      }
    }

    private sectionValue(field: string): unknown {
      const value = this.scope.getSnapshot().value
      return value == null ? undefined : value[field]
    }

    private baseValue(field: string): unknown {
      const base = this.scope.getSnapshot().base
      return base != null && typeof base === 'object' ? (base as Record<string, unknown>)[field] : undefined
    }

    private userLayer(): Record<string, unknown> | undefined {
      const user = this.scope.getSnapshot().user
      return user != null && typeof user === 'object' ? (user as Record<string, unknown>) : undefined
    }

    private stored(field: string): boolean {
      const user = this.userLayer()
      return user !== undefined && Object.prototype.hasOwnProperty.call(user, field)
    }

    private stage(field: string, draft: Draft): void {
      this.staged.set(field, draft)
      this.failed = false
      this.publish()
    }

    /** Every staged edit a save would write, in staging order. */
    private plan(): Array<{ field: string; run: (() => Promise<boolean>) | undefined }> {
      const plan: Array<{ field: string; run: (() => Promise<boolean>) | undefined }> = []
      for (const [field, draft] of Array.from(this.staged.entries())) {
        const spec = this.specs.get(field)
        if (spec === undefined) continue
        if (draft.clear) {
          if (this.stored(field)) plan.push({ field, run: () => this.clearField(field) })
          continue
        }
        if (draft.text === spec.format(this.sectionValue(field))) continue
        const write = spec.parse(draft.text)
        if (write === undefined) plan.push({ field, run: undefined })
        else if (write.kind === 'clear') plan.push({ field, run: () => this.clearField(field) })
        else plan.push({ field, run: () => this.storeField(field, write.value) })
      }
      return plan
    }

    private async clearField(field: string): Promise<boolean> {
      await this.scope.unset(field)
      return !this.stored(field)
    }

    private async storeField(field: string, value: unknown): Promise<boolean> {
      await this.scope.set(field, value)
      const user = this.userLayer()
      return user !== undefined && user[field] === value
    }

    private async save(): Promise<void> {
      const plan = this.plan()
      const writes = plan.filter((item) => item.run !== undefined)
      if (plan.length === 0 || this.saving || writes.length !== plan.length) return
      this.saving = true
      this.failed = false
      this.publish()
      let landed = true
      let chain: Promise<void> = Promise.resolve()
      for (const item of writes) {
        chain = chain.then(item.run).then((ok: boolean) => {
          landed = ok && landed
        })
      }
      try {
        await chain
      } catch {
        landed = false
      }
      if (landed) this.staged.clear()
      this.saving = false
      this.failed = !landed
      this.publish()
    }

    private discard(): void {
      if (this.staged.size === 0 && !this.failed) return
      this.staged.clear()
      this.failed = false
      this.publish()
    }

    /** Bump the host-visible runNowTick; the Host scans on the committed change. */
    private async runNow(): Promise<void> {
      const current = this.scope.getSnapshot().value
      const tick = typeof current?.runNowTick === 'number' ? current.runNowTick : 0
      await this.scope.set('runNowTick', tick + 1)
    }

    private publish(): void {
      for (const listener of Array.from(this.listeners)) {
        try {
          listener()
        } catch {
          // a failing projection must not kill the form
        }
      }
    }
  }

  // ── presentational helpers ──
  function FieldHeading(props: { id: string; label: string; overridden: boolean; disabled: boolean; onReset: () => void }) {
    return React.createElement(
      'div',
      { className: 'dsac_head' },
      React.createElement('label', { className: 'dsac_label', htmlFor: props.id }, props.label),
      props.overridden
        ? React.createElement(
            'span',
            { className: 'dsac_badges' },
            React.createElement('span', { className: 'dsac_badge' }, t('overridden')),
            React.createElement('button', { type: 'button', className: 'dsac_reset', disabled: props.disabled, onClick: props.onReset }, t('reset')),
          )
        : null,
    )
  }

  function Note(props: { invalid: boolean; children: string }) {
    return React.createElement('p', { className: props.invalid ? 'dsac_invalid' : 'dsac_hint' }, props.children)
  }

  function ToggleField(props: { label: string; hint: string; checked: boolean; view: FieldView; disabled: boolean; onToggle: (checked: boolean) => void; onReset: () => void }) {
    const id = 'plugin-config-chat-archive-enabled'
    return React.createElement(
      'div',
      { className: 'dsac_field' },
      React.createElement(FieldHeading, { id, label: props.label, overridden: props.view.overridden, disabled: props.disabled, onReset: props.onReset }),
      React.createElement(
        'div',
        { className: 'dsac_toggleRow' },
        React.createElement('input', {
          id,
          className: 'dsac_toggle',
          type: 'checkbox',
          checked: props.checked,
          disabled: props.disabled,
          onChange: (event: { target: { checked: boolean } }) => props.onToggle(event.target.checked),
        }),
      ),
      React.createElement(Note, { invalid: false, children: props.hint }),
    )
  }

  function ThresholdField(props: {
    label: string
    hint: string
    unitHint: string
    threshold: FieldView
    unit: FieldView
    disabled: boolean
    onThreshold: (text: string) => void
    onUnit: (value: string) => void
    onReset: () => void
  }) {
    const id = 'plugin-config-chat-archive-threshold'
    return React.createElement(
      'div',
      { className: 'dsac_field' },
      React.createElement(FieldHeading, { id, label: props.label, overridden: props.threshold.overridden || props.unit.overridden, disabled: props.disabled, onReset: props.onReset }),
      React.createElement(
        'div',
        { className: 'dsac_row' },
        React.createElement('input', {
          id,
          className: props.threshold.invalid ? 'dsac_input dsac_inputInvalid' : 'dsac_input',
          type: 'text',
          inputMode: 'numeric',
          'aria-invalid': props.threshold.invalid || undefined,
          value: props.threshold.text,
          placeholder: '',
          disabled: props.disabled,
          onChange: (event: { target: { value: string } }) => props.onThreshold(event.target.value),
        }),
        React.createElement('select', {
          className: 'dsac_input dsac_select',
          'aria-label': t('threshold') + ' (unit)',
          value: props.unit.text,
          disabled: props.disabled,
          onChange: (event: { target: { value: string } }) => props.onUnit(event.target.value),
          children: [
            React.createElement('option', { key: 'minutes', value: 'minutes' }, t('unitMinutes')),
            React.createElement('option', { key: 'hours', value: 'hours' }, t('unitHours')),
            React.createElement('option', { key: 'days', value: 'days' }, t('unitDays')),
          ],
        }),
      ),
      React.createElement(Note, { invalid: props.threshold.invalid, children: props.threshold.invalid ? t('invalidNumber') : props.hint }),
      React.createElement(Note, { invalid: false, children: props.unitHint }),
    )
  }

  function IntervalField(props: { label: string; hint: string; view: FieldView; disabled: boolean; onEdit: (text: string) => void; onReset: () => void }) {
    const id = 'plugin-config-chat-archive-interval'
    return React.createElement(
      'div',
      { className: 'dsac_field' },
      React.createElement(FieldHeading, { id, label: props.label, overridden: props.view.overridden, disabled: props.disabled, onReset: props.onReset }),
      React.createElement('input', {
        id,
        className: props.view.invalid ? 'dsac_input dsac_inputInvalid' : 'dsac_input',
        type: 'text',
        inputMode: 'numeric',
        'aria-invalid': props.view.invalid || undefined,
        value: props.view.text,
        placeholder: '',
        disabled: props.disabled,
        onChange: (event: { target: { value: string } }) => props.onEdit(event.target.value),
      }),
      React.createElement(Note, { invalid: props.view.invalid, children: props.view.invalid ? t('invalidNumber') : props.hint }),
    )
  }

  function Button(props: { kind: 'run' | 'discard' | 'save'; disabled: boolean; onClick: () => void; children: string }) {
    const className = 'dsac_btn ' + (props.kind === 'run' ? 'dsac_run' : props.kind === 'discard' ? 'dsac_discard' : 'dsac_save')
    return React.createElement('button', { type: 'button', className, disabled: props.disabled, onClick: props.onClick }, props.children)
  }

  // ── the settings section (own left-nav entry) ──
  function ChatArchiveSection(props: {
    useChatArchive: (selector: (state: SectionState) => unknown) => SectionState
    save: () => Promise<void>
    discard: () => void
    runNow: () => Promise<void>
    edit: (field: string, text: string) => void
    resetField: (field: string) => void
  }) {
    const state = props.useChatArchive((snapshot: SectionState) => snapshot)
    const [ran, setRan] = React.useState(false)
    const [saved, setSaved] = React.useState(false)
    if (!state.available) return null
    const writable = state.writable
    const blocked = !state.dirty || state.invalid || state.saving
    const enabled = state.enabled.text === 'true'
    const onSave = (): void => {
      props.save().then(
        () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 4000)
        },
        () => {
          /* write refused — failed banner state covers it */
        },
      )
    }
    const onRunNow = (): void => {
      props.runNow().then(
        () => {
          setRan(true)
          setTimeout(() => setRan(false), 4000)
        },
        () => {
          /* write refused — nothing to show beyond the failed banner state */
        },
      )
    }
    return React.createElement(
      'div',
      { className: 'dsac_section' },
      React.createElement('h2', { className: 'dsac_title' }, t('title')),
      React.createElement('p', { className: 'dsac_sub' }, t('description')),
      React.createElement(
        'div',
        { className: 'dsac_card' },
        React.createElement(
          'div',
          { className: 'dsac_body' },
          !writable ? React.createElement('p', { className: 'dsac_readOnly', role: 'status' }, t('readOnly')) : null,
          React.createElement(ToggleField, {
            label: t('enabled'),
            hint: t('enabledHint'),
            checked: enabled,
            view: state.enabled,
            disabled: !writable,
            onToggle: (checked: boolean) => props.edit('enabled', checked ? 'true' : 'false'),
            onReset: () => props.resetField('enabled'),
          }),
          React.createElement(ThresholdField, {
            label: t('threshold'),
            hint: t('thresholdHint'),
            unitHint: t('thresholdUnitHint'),
            threshold: state.threshold,
            unit: state.unit,
            disabled: !writable,
            onThreshold: (text: string) => props.edit('threshold', text),
            onUnit: (value: string) => props.edit('unit', value),
            onReset: () => {
              props.resetField('threshold')
              props.resetField('unit')
            },
          }),
          React.createElement(IntervalField, {
            label: t('interval'),
            hint: t('intervalHint'),
            view: state.intervalMinutes,
            disabled: !writable,
            onEdit: (text: string) => props.edit('intervalMinutes', text),
            onReset: () => props.resetField('intervalMinutes'),
          }),
          React.createElement(
            'div',
            { className: 'dsac_footer' },
            ran ? React.createElement('p', { className: 'dsac_ran', role: 'status' }, t('ran')) : null,
            saved ? React.createElement('p', { className: 'dsac_ran', role: 'status' }, t('saved')) : null,
            state.failed ? React.createElement('p', { className: 'dsac_failed', role: 'status' }, t('saveFailed')) : null,
            React.createElement(Button, { kind: 'run', disabled: !writable || state.saving, onClick: onRunNow, children: t('runNow') }),
            React.createElement(Button, { kind: 'discard', disabled: !state.dirty || state.saving, onClick: props.discard, children: t('discard') }),
            React.createElement(Button, { kind: 'save', disabled: blocked, onClick: onSave, children: t(state.saving ? 'saving' : 'save') }),
          ),
        ),
      ),
    )
  }

  // ── plugin body ──
  const SETTINGS_NAMESPACE = 'chat-archive'
  const inject = ['slots', 'settingsScope']

  function apply(ctx: { slots: any; settingsScope: { bind(spec: { namespace: string }): SettingsScopeLike } }): void {
    const controller = new FormController(ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }), [
      booleanField('enabled'),
      unitField('unit'),
      integerField('threshold'),
      integerField('intervalMinutes'),
    ])
    const store = controller.bind(() => ({
      ...controller.shell(),
      enabled: controller.fieldView('enabled'),
      unit: controller.fieldView('unit'),
      threshold: controller.fieldView('threshold'),
      intervalMinutes: controller.fieldView('intervalMinutes'),
    }))
    ctx.slots.inject('settings.section', function* () {
      yield ctx.slots.register(
        {
          name: 'settings.section',
          id: 'chat-archive',
          order: 30,
          label: () => t('nav'),
          inject: () => ({
            hooks: { chatArchive: store },
            ...controller.actions(),
          }),
        },
        ChatArchiveSection,
      )
    })
  }

  module.exports.apply = apply
  module.exports.inject = inject
  return module.exports
}

window.__ModuleLoader__.load({
  id: '@ohmejj/dsh-chat-archive',
  factory: dshChatArchiveClientFactory,
})