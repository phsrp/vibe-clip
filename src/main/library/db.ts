// The clip library database (SQLite, built into Electron, no extra install).
// Stored at %APPDATA%/Vibe Clip/library.db. The video files themselves stay in your save folder.
import { app } from 'electron'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { createLogger } from '../logger'

const log = createLogger('db')

export interface ClipRow {
  id: number
  path: string
  title: string
  kind: 'clip' | 'recording' | 'screenshot'
  game: string
  game_name: string
  created_at: number
  duration: number
  size: number
  width: number
  height: number
  thumb: string | null
  shared: number
}

let db: DatabaseSync | null = null

// Each entry upgrades the database by one version. Never edit old entries; add new ones.
const MIGRATIONS: string[] = [
  `CREATE TABLE clips (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     path TEXT NOT NULL UNIQUE COLLATE NOCASE,
     title TEXT NOT NULL,
     kind TEXT NOT NULL,
     game TEXT NOT NULL DEFAULT 'desktop',
     game_name TEXT NOT NULL DEFAULT 'Desktop',
     created_at INTEGER NOT NULL,
     duration REAL NOT NULL DEFAULT 0,
     size INTEGER NOT NULL DEFAULT 0,
     width INTEGER NOT NULL DEFAULT 0,
     height INTEGER NOT NULL DEFAULT 0,
     thumb TEXT,
     shared INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX clips_created ON clips(created_at);
   CREATE INDEX clips_game ON clips(game);
   CREATE TABLE collections (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE collection_clips (
     collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
     clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
     added_at INTEGER NOT NULL,
     PRIMARY KEY (collection_id, clip_id)
   );`
]

export function getDb(): DatabaseSync {
  if (db) return db
  const file = path.join(app.getPath('userData'), 'library.db')
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = version; v < MIGRATIONS.length; v++) {
    log.info(`Upgrading database to version ${v + 1}`)
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  log.info(`Library database ready: ${file}`)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
