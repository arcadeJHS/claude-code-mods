export type BookmarkKind = 'user' | 'assistant' | 'tool' | 'selection'

export type Bookmark = {
  id: string
  /** The transcript row to scroll back to; absent when a selection spanned several rows. */
  requestId?: string
  kind: BookmarkKind
  title: string
  excerpt: string
  createdAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'transcript-bookmarks': {
      list: Bookmark[]
      /** The session id the list was loaded for, so a hot reload keeps it and a /clear drops it. */
      loadedFor: string
      /** Per transcript row: whether a bookmark points at it, so each row redraws alone. */
      marked: StateFamily<boolean>
    }
  }
}
