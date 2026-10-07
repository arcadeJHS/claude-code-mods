import { atom, memberOf, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  Register,
  RenderElement,
  RenderSurface,
  RenderViewport,
} from 'claude-code'

import type { Bookmark, BookmarkKind } from '../types'

const PANE = 'bookmarks'
const TITLE = 'Bookmarks'
const STORE_PREFIX = 'bookmarks:'
const STORE_INDEX = 'bookmarks-index'
const MAX_BOOKMARKS = 200
const MAX_SESSIONS = 50
const MAX_TEXT = 2000
const MAX_TITLES = 500
const PREVIEW_LINES = 3

const list = atom({ plugin: 'transcript-bookmarks', key: 'list' } as const, [])
const loadedFor = atom({ plugin: 'transcript-bookmarks', key: 'loadedFor' } as const, '')
const marked = atom({ plugin: 'transcript-bookmarks', key: 'marked' } as const, false)

type $ = EngineInterface
type MessageKind = Exclude<BookmarkKind, 'selection'>
type RowTitle = { kind: MessageKind; title: string }
type Row = RowTitle & { text: string }
type NewBookmark = Omit<Bookmark, 'id' | 'createdAt'>

// Who wrote each drawn transcript row, so a selection (which only names its
// row) can be titled. Titles only: a row's text is kept just when its 📌 is
// pressed. A cache: a reload redraws the rows and refills it.
const titles = new Map<string, RowTitle>()

function remember(requestId: string, { kind, title }: RowTitle) {
  titles.delete(requestId)
  titles.set(requestId, { kind, title })
  if (titles.size > MAX_TITLES) {
    const oldest = titles.keys().next().value
    if (oldest !== undefined) titles.delete(oldest)
  }
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function asBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (b): b is Bookmark =>
      isRecord(b) &&
      typeof b.id === 'string' &&
      typeof b.title === 'string' &&
      typeof b.excerpt === 'string' &&
      typeof b.createdAt === 'number',
  )
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : []

function toolTitle(tool: string, input: unknown): { title: string; text: string } {
  const args = isRecord(input) ? input : {}
  const arg = [args.file_path, args.notebook_path, args.command, args.pattern, args.url, args.description]
    .find((v): v is string => typeof v === 'string' && v.length > 0)
  if (arg === undefined) return { title: tool, text: tool }
  const short = arg === args.file_path || arg === args.notebook_path
    ? arg.split('/').slice(-2).join('/')
    : arg.split('\n')[0] ?? arg
  return { title: `${tool}(${clip(short, 40)})`, text: arg }
}

function clockTime(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function previewLines(excerpt: string) {
  const lines = excerpt.split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== '')
  const shown = lines.slice(0, PREVIEW_LINES)
  if (lines.length > PREVIEW_LINES) shown.push('…')
  return shown.length > 0 ? shown : ['(no text)']
}

// Hover marks need a pointer: the fullscreen terminal, or an app surface.
function showsMarks(surface: RenderSurface, viewport: RenderViewport | undefined) {
  if (surface === 'terminal') return viewport?.isFullscreen === true
  return surface !== 'mobile'
}

async function persist($: $) {
  const id = await $.session.id()
  const items = await read($, list)
  const index = asStrings(await $.store.get(STORE_INDEX)).filter(s => s !== id)
  if (items.length === 0) {
    await $.store.delete(STORE_PREFIX + id)
  } else {
    await $.store.set(STORE_PREFIX + id, items)
    index.push(id)
  }
  for (const old of index.splice(0, Math.max(0, index.length - MAX_SESSIONS))) {
    await $.store.delete(STORE_PREFIX + old)
  }
  await $.store.set(STORE_INDEX, index)
}

async function syncMark($: $, requestId: string | undefined) {
  if (requestId === undefined) return
  const items = await read($, list)
  const isMarked = items.some(b => b.requestId === requestId)
  await update($, memberOf(marked, { requestId }), () => isMarked)
}

async function replaceList($: $, next: Bookmark[]) {
  const previous = await read($, list)
  await update($, list, () => next)
  const rows = new Set([...previous, ...next].map(b => b.requestId))
  for (const requestId of rows) await syncMark($, requestId)
}

// Loads this session's saved bookmarks once per session id: a hot reload
// keeps the list, a resumed session gets its own back.
async function ensureLoaded($: $) {
  const id = await $.session.id()
  if ((await read($, loadedFor)) === id) return
  await replaceList($, asBookmarks(await $.store.get(STORE_PREFIX + id)))
  await update($, loadedFor, () => id)
}

const openPane = ($: $) => $.ui.open({ id: PANE, title: TITLE })

async function addBookmark($: $, bookmark: NewBookmark) {
  await ensureLoaded($)
  if ((await read($, list)).length >= MAX_BOOKMARKS) {
    $.ui.toast(`You have ${MAX_BOOKMARKS} bookmarks already: delete some first`)
    return
  }
  const createdAt = await $.clock.now()
  const added: Bookmark = {
    ...bookmark,
    excerpt: clip(bookmark.excerpt, MAX_TEXT),
    id: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
  }
  await update($, list, items => [added, ...items])
  await syncMark($, added.requestId)
  await persist($)
  await openPane($)
  $.ui.toast(`Bookmarked: ${added.title}`)
}

async function removeBookmark($: $, id: string) {
  const gone = (await read($, list)).find(b => b.id === id)
  await update($, list, items => items.filter(b => b.id !== id))
  await syncMark($, gone?.requestId)
  await persist($)
}

async function clearAll($: $) {
  await replaceList($, [])
  await persist($)
}

async function markMessage($: $, requestId: string, row: Row) {
  await ensureLoaded($)
  const already = (await read($, list)).find(b => b.requestId === requestId && b.kind !== 'selection')
  if (already !== undefined) {
    await openPane($)
    $.ui.toast('That message is already bookmarked')
    return
  }
  await addBookmark($, { requestId, kind: row.kind, title: row.title, excerpt: row.text })
}

// Answers with why nothing was bookmarked, or undefined once it was.
async function bookmarkSelection($: $, label: string): Promise<string | undefined> {
  const selection = await $.ui.selection()
  if (selection === undefined || selection.text.trim() === '') {
    return 'Nothing is selected: select text in the transcript with the mouse first (fullscreen mode).'
  }
  const info = selection.requestId === undefined ? undefined : titles.get(selection.requestId)
  await addBookmark($, {
    requestId: selection.requestId,
    kind: 'selection',
    title: label !== '' ? label : (info?.title ?? 'selection'),
    excerpt: selection.text,
  })
  if (selection.requestId === undefined) {
    $.ui.toast('Saved, but the selection spans several messages, so it has no single place to jump to')
  }
  return undefined
}

async function jump($: $, bookmark: Bookmark, surface: RenderSurface) {
  if (bookmark.requestId === undefined) {
    $.ui.toast('This bookmark spans several messages, so there is no single place to jump to')
    return
  }
  const why = await $.ui
    .scroll({ to: { requestId: bookmark.requestId }, block: 'start' })
    .then(scrolled => scrolled.deny, (error: unknown) => String(error instanceof Error ? error.message : error))
  if (why === undefined) return
  const copied = await $.ui.copy({ text: bookmark.excerpt, surface })
  $.ui.toast(
    `Can't scroll to that message (${why}).` +
      (copied.isCopied ? ' Its text is on the clipboard.' : ''),
  )
}

// The engine's own drawing of a row, with a 📌 at its top right that shows on
// hover and stays as ★ once the row is bookmarked. The 📌 carries the row's
// text, so nothing else needs to remember it.
function markable(
  $: $,
  ui: Pick<ElementTable, 'Box' | 'Button'>,
  requestId: string,
  drawing: RenderElement,
  row: Row,
  isMarked: boolean,
) {
  const { Box, Button } = ui
  return (
    <Box key={`bm:${requestId}`} flexDirection="column">
      {drawing}
      <Box
        position="absolute"
        top={0}
        right={1}
        {...(isMarked ? {} : { display: 'none', hover: { display: 'flex' } })}
      >
        <Button
          plain
          dimColor
          key={`mark:${requestId}`}
          label={isMarked ? '★' : '📌'}
          onPress={() => markMessage($, requestId, row)}
        />
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bookmarks',
      description: 'Open the bookmarks pane',
      immediate: true,
    })
    await $.command.register({
      name: 'bookmark',
      description: 'Bookmark the text you selected with the mouse',
      argumentHint: '[label]',
      immediate: true,
    })
    await ensureLoaded($)
    if ((await read($, list)).length > 0) void openPane($)

    return next(e)
  })

  // A /clear or /resume moves the process to another session id: its rows are
  // gone, so the list is too (the old session's stay saved for its resume).
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await replaceList($, [])
      await update($, loadedFor, () => '')
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await ensureLoaded($)

    return next(e)
  })

  on('command.run', { command: 'bookmarks' }, async $ => {
    await ensureLoaded($)
    await openPane($)

    return {}
  })

  on('command.run', { command: 'bookmark' }, async ($, e) => {
    if (!e.presentation.isFullscreen) {
      return { text: 'Bookmarking a selection needs the fullscreen terminal (CLAUDE_CODE_NO_FLICKER=1, outside tmux).' }
    }
    const refusal = await bookmarkSelection($, e.args.trim())

    return refusal === undefined ? {} : { text: refusal }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawing = await next(e)
    const row: Row = { kind: 'assistant', title: 'claude', text: e.props.text }
    remember(e.requestId, row)
    if (!showsMarks(e.surface, e.viewport)) return drawing

    return markable($, $.ui.resolve(e), e.requestId, drawing, row, await read($, memberOf(marked, e)))
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawing = await next(e)
    const title = e.props.from?.name ?? (e.props.origin.kind === 'task-notification' ? 'task' : 'you')
    const row: Row = { kind: 'user', title, text: e.props.text }
    remember(e.requestId, row)
    if (!showsMarks(e.surface, e.viewport)) return drawing

    return markable($, $.ui.resolve(e), e.requestId, drawing, row, await read($, memberOf(marked, e)))
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawing = await next(e)
    const row: Row = { kind: 'tool', ...toolTitle(e.props.tool, e.props.input) }
    remember(e.requestId, row)
    if (!showsMarks(e.surface, e.viewport)) return drawing

    return markable($, $.ui.resolve(e), e.requestId, drawing, row, await read($, memberOf(marked, e)))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const items = await read($, list)

    return (
      <Box flexDirection="column" width={Math.max(10, e.props.bodyColumns)}>
        <Box flexDirection="row" gap={1}>
          <Button
            key="add-selection"
            variant="primary"
            label="+ Bookmark selection"
            onPress={async () => {
              const refusal = await bookmarkSelection($, '')
              if (refusal !== undefined) $.ui.toast(refusal)
            }}
          />
          {items.length > 0 && (
            <Button key="clear-all" label="Clear all" onPress={() => clearAll($)} />
          )}
        </Box>
        {items.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>
              No bookmarks yet. Hover a message and click 📌, or select text with the mouse and
              press "+ Bookmark selection" (or type /bookmark).
            </Text>
          </Box>
        )}
        {items.map(bookmark => (
          <Box key={`b:${bookmark.id}`} flexDirection="column" marginTop={1}>
            <Text dimColor wrap="truncate-end">
              {bookmark.title}
              {bookmark.kind === 'selection' ? ' · selection' : ''} · {clockTime(bookmark.createdAt)}
            </Text>
            {previewLines(bookmark.excerpt).map(line => (
              <Text wrap="truncate-end">{line}</Text>
            ))}
            <Box flexDirection="row" gap={1}>
              <Button
                key={`jump:${bookmark.id}`}
                label="Go to"
                dimColor={bookmark.requestId === undefined}
                onPress={press => jump($, bookmark, press.surface)}
              />
              <Button
                key={`del:${bookmark.id}`}
                label="Delete"
                onPress={() => removeBookmark($, bookmark.id)}
              />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
