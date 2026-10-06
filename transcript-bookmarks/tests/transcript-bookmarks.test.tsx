import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const SESSION = 'session-1'
const FULLSCREEN = { columns: 160, rows: 50, isFullscreen: true }

const PANE = {
  plugin: 'transcript-bookmarks',
  component: 'Pane',
  requestId: 'bookmarks',
  props: {
    title: 'Bookmarks',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const saved = [
  { id: 'a', requestId: 'msg-a', kind: 'assistant', title: 'claude', excerpt: 'First answer\nwith two lines', createdAt: 0 },
  { id: 'b', requestId: 'msg-b', kind: 'user', title: 'you', excerpt: 'Second prompt', createdAt: 0 },
]

// The engine beneath the plugin: this session's id, its saved bookmarks, and
// a record of the toasts, panes and copies the plugin asks for.
function world(on: On, entries: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  const seen = { store, toasts: [] as string[], opened: [] as string[], copied: [] as string[] }
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own drawing of a message, which the plugin wraps.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('session.id', () => ({ value: SESSION }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.copy', ($, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  return seen
}

const start = ($: Engine) =>
  $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const stored = (seen: ReturnType<typeof world>) =>
  seen.store.get(`bookmarks:${SESSION}`) as { id: string; excerpt: string }[] | undefined

test('restores the saved bookmarks and Delete removes one', async ($, on) => {
  const seen = world(on, { [`bookmarks:${SESSION}`]: saved })
  await start($)
  expect(seen.opened).toContain('bookmarks')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /First answer/ })).toBeDefined()
    expect(await ui.find({ text: /Second prompt/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'del:a' })
  expect(await ui.find({ text: /First answer/ })).toBeUndefined()
  expect(await ui.find({ text: /Second prompt/ })).toBeDefined()
  expect(stored(seen)?.map(b => b.id)).toEqual(['b'])

  await ui.press({ key: 'clear-all' })
  expect(await ui.find({ key: 'del:b' })).toBeUndefined()
  expect(stored(seen)).toBeUndefined()
})

test('the hover mark bookmarks a message once', async ($, on) => {
  const seen = world(on)
  await start($)

  for (const surface of SURFACES) {
    const row = await $.ui.mount({
      plugin: 'transcript-bookmarks',
      surface,
      component: 'AssistantMessage',
      requestId: `msg-${surface}`,
      props: { text: `Answer drawn on ${surface}`, isFirstOfReply: true },
      viewport: FULLSCREEN,
    })
    expect((await row.find({ key: `mark:msg-${surface}` }))?.text).toBe('🔖')
    await row.press({ key: `mark:msg-${surface}` })
    expect((await row.find({ key: `mark:msg-${surface}` }))?.text).toBe('★')
    await row.press({ key: `mark:msg-${surface}` })
    expect(seen.toasts).toContain('That message is already bookmarked')
    await row.unmount()
  }

  expect(seen.opened).toContain('bookmarks')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /Answer drawn on terminal/ })).toBeDefined()
  expect(await pane.find({ text: /Answer drawn on desktop/ })).toBeDefined()
  expect(stored(seen)?.length).toBe(2)
})

test('no mark on the terminal main screen, where nothing hovers', async ($, on) => {
  world(on)
  await start($)
  const row = await $.ui.mount({
    plugin: 'transcript-bookmarks',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-main',
    props: { text: 'Plain', isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  })
  expect(await row.find({ key: 'mark:msg-main' })).toBeUndefined()
})

test('/bookmark saves the selected text under its label', async ($, on) => {
  world(on)
  on('ui.selection', () => ({ value: { text: 'the part that matters', requestId: 'msg-sel' } }))
  await start($)

  const ran = await $.command.run({
    command: 'bookmark',
    args: ' auth idea ',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toBeUndefined()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /auth idea · selection/ })).toBeDefined()
  expect(await pane.find({ text: /the part that matters/ })).toBeDefined()
})

test('a selection in a drawn message takes that message\'s title', async ($, on) => {
  world(on)
  on('ui.selection', () => ({ value: { text: 'one line of it', requestId: 'tool-1' } }))
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.tool}</Text>
  })
  await start($)

  await $.ui.mount({
    plugin: 'transcript-bookmarks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'tool-1',
    props: {
      tool_use_id: 'tool-1',
      tool: 'Edit',
      input: { file_path: '/repo/src/api/cache.ts' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
    viewport: FULLSCREEN,
  })
  await $.command.run({
    command: 'bookmark',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /Edit\(api\/cache\.ts\) · selection/ })).toBeDefined()
  expect(await pane.find({ text: /one line of it/ })).toBeDefined()
})

test('/bookmark with nothing selected says what to do', async ($, on) => {
  const seen = world(on)
  on('ui.selection', () => ({ value: undefined }))
  await start($)

  const ran = await $.command.run({
    command: 'bookmark',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toMatch(/Nothing is selected/)
  expect(stored(seen)).toBeUndefined()
})

test('Go to that cannot scroll copies the text and says why', async ($, on) => {
  // Nothing beneath a test scrolls a transcript row, so every jump here is
  // refused; the real scroll is the session's.
  const seen = world(on, { [`bookmarks:${SESSION}`]: saved })
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'jump:b' })
  expect(seen.copied).toEqual(['Second prompt'])
  expect(seen.toasts.some(t => t.startsWith("Can't scroll to that message"))).toBe(true)
})

test('a selection across several messages is kept, without a place to jump', async ($, on) => {
  const seen = world(on)
  on('ui.selection', () => ({ value: { text: 'spans two rows' } }))
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'add-selection' })
  expect(await pane.find({ text: /spans two rows/ })).toBeDefined()
  const id = stored(seen)?.[0]?.id
  await pane.press({ key: `jump:${id}` })
  expect(seen.copied).toEqual([])
  expect(seen.toasts.some(t => t.includes('no single place to jump to'))).toBe(true)
})
