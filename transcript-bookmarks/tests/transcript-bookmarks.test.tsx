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

// The engine beneath the plugin: this session's id (a test moves it, as a
// /clear or /resume does), its saved bookmarks, and a record of the toasts,
// panes and copies the plugin asks for.
function world(on: On, entries: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  const seen = { session: SESSION, store, toasts: [] as string[], opened: [] as string[], copied: [] as string[] }
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
  on('session.id', () => ({ value: seen.session }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
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
    expect((await row.find({ key: `mark:msg-${surface}` }))?.text).toBe('📌')
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

test('/bookmark outside fullscreen says it needs fullscreen', async ($, on) => {
  const seen = world(on)
  on('ui.selection', () => ({ value: { text: 'selected anyway', requestId: 'msg-sel' } }))
  await start($)

  const ran = await $.command.run({
    command: 'bookmark',
    args: 'a label',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(ran.text).toMatch(/needs the fullscreen terminal/)
  expect(stored(seen)).toBeUndefined()
})

test('/bookmarks opens the pane, on the main screen too', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(seen.opened).toEqual([])

  const ran = await $.command.run({
    command: 'bookmarks',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(ran.text).toBeUndefined()
  expect(seen.opened).toEqual(['bookmarks'])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /No bookmarks yet/ })).toBeDefined()
})

test('stops at 200 bookmarks until one is deleted', async ($, on) => {
  const full = Array.from({ length: 200 }, (_, i) => ({ ...saved[0], id: `b${i}`, requestId: `msg-${i}` }))
  const seen = world(on, { [`bookmarks:${SESSION}`]: full })
  on('ui.selection', () => ({ value: { text: 'one too many', requestId: 'msg-sel' } }))
  await start($)
  const bookmark = () =>
    $.command.run({
      command: 'bookmark',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  await bookmark()
  expect(seen.toasts).toContain('You have 200 bookmarks already: delete some first')
  expect(stored(seen)?.length).toBe(200)
  expect(stored(seen)?.some(b => b.excerpt === 'one too many')).toBe(false)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'del:b0' })
  await bookmark()
  expect(stored(seen)?.length).toBe(200)
  expect(stored(seen)?.[0]?.excerpt).toBe('one too many')
})

test('keeps up to 2,000 characters of a bookmark\'s text', async ($, on) => {
  const seen = world(on)
  on('ui.selection', () => ({ value: { text: 'x'.repeat(2500), requestId: 'msg-sel' } }))
  await start($)

  await $.command.run({
    command: 'bookmark',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  const excerpt = stored(seen)?.[0]?.excerpt
  expect(excerpt?.length).toBe(2000)
  expect(excerpt?.endsWith('x…')).toBe(true)
})

test('keeps the 50 most recent sessions with bookmarks', async ($, on) => {
  const older = Array.from({ length: 50 }, (_, i) => `old-${i}`)
  const seen = world(on, {
    'bookmarks-index': older,
    ...Object.fromEntries(older.map(id => [`bookmarks:${id}`, saved])),
  })
  on('ui.selection', () => ({ value: { text: 'new here', requestId: 'msg-sel' } }))
  await start($)
  const bookmark = () =>
    $.command.run({
      command: 'bookmark',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  await bookmark()
  expect(seen.store.get('bookmarks-index')).toEqual([...older.slice(1), SESSION])
  expect(seen.store.has('bookmarks:old-0')).toBe(false)
  expect(seen.store.has('bookmarks:old-1')).toBe(true)

  // Saving this session again moves it to the end, and drops no one else.
  await bookmark()
  expect(seen.store.get('bookmarks-index')).toEqual([...older.slice(1), SESSION])
  expect(seen.store.has('bookmarks:old-1')).toBe(true)
  expect(stored(seen)?.length).toBe(2)
})

test('/clear empties the list and the old session keeps its bookmarks', async ($, on) => {
  const seen = world(on, { [`bookmarks:${SESSION}`]: saved })
  on('ui.selection', () => ({ value: { text: 'after the clear', requestId: 'msg-new' } }))
  await start($)
  const row = await $.ui.mount({
    plugin: 'transcript-bookmarks',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-a',
    props: { text: 'First answer', isFirstOfReply: true },
    viewport: FULLSCREEN,
  })
  expect((await row.find({ key: 'mark:msg-a' }))?.text).toBe('★')

  seen.session = 'session-2'
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  expect((await row.find({ key: 'mark:msg-a' }))?.text).toBe('📌')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /No bookmarks yet/ })).toBeDefined()

  await $.command.run({
    command: 'bookmark',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect((seen.store.get('bookmarks:session-2') as unknown[] | undefined)?.length).toBe(1)
  expect(stored(seen)?.map(b => b.id)).toEqual(['a', 'b'])
})

test('/resume swaps in the resumed session\'s bookmarks', async ($, on) => {
  const seen = world(on, {
    [`bookmarks:${SESSION}`]: saved,
    'bookmarks:session-0': [{ ...saved[0], id: 'z', excerpt: 'From the earlier session' }],
  })
  await start($)

  seen.session = 'session-0'
  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: SESSION } })
  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ text: /No bookmarks yet/ })).toBeDefined()
  await before.unmount()

  await $.command.run({
    command: 'bookmarks',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /From the earlier session/ })).toBeDefined()
  expect(await pane.find({ text: /First answer/ })).toBeUndefined()
  expect(stored(seen)?.map(b => b.id)).toEqual(['a', 'b'])
})
