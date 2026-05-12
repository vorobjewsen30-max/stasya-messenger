const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Путь к БД на Render Disk (или локально)
const DATA_PATH = process.env.RENDER_DISK_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

const DB_PATH = path.join(DATA_PATH, 'stasya.db');
const db = new Database(DB_PATH);

// Включаем WAL режим для производительности
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== СОЗДАНИЕ ТАБЛИЦ =====

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    custom_status TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    is_bot INTEGER DEFAULT 0,
    bot_token TEXT UNIQUE,
    bot_owner TEXT,
    last_seen TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_user) REFERENCES users(id),
    FOREIGN KEY (to_user) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS blocked (
    user_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    PRIMARY KEY (user_id, blocked_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (blocked_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    owner_id TEXT,
    is_public INTEGER DEFAULT 0,
    invite_code TEXT UNIQUE,
    last_message_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (channel_id, user_id),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT DEFAULT '',
    type TEXT DEFAULT 'text',
    reply_to TEXT,
    edited INTEGER DEFAULT 0,
    edited_at TEXT,
    deleted INTEGER DEFAULT 0,
    pinned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT,
    url TEXT,
    size INTEGER,
    mime_type TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );

  CREATE TABLE IF NOT EXISTS embeds (
    id TEXT PRIMARY KEY,
    message_id TEXT UNIQUE,
    title TEXT,
    description TEXT,
    color TEXT,
    image TEXT,
    thumbnail TEXT,
    footer TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );

  CREATE TABLE IF NOT EXISTS embed_fields (
    id TEXT PRIMARY KEY,
    embed_id TEXT NOT NULL,
    name TEXT,
    value TEXT,
    inline INTEGER DEFAULT 0,
    FOREIGN KEY (embed_id) REFERENCES embeds(id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    initiator_id TEXT NOT NULL,
    status TEXT DEFAULT 'ringing',
    type TEXT DEFAULT 'voice',
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    duration INTEGER DEFAULT 0,
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (initiator_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS call_participants (
    call_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    left_at TEXT,
    is_muted INTEGER DEFAULT 0,
    is_deafened INTEGER DEFAULT 0,
    is_video INTEGER DEFAULT 0,
    is_screen_sharing INTEGER DEFAULT 0,
    PRIMARY KEY (call_id, user_id),
    FOREIGN KEY (call_id) REFERENCES calls(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
  CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
`);

// ===== ХЕЛПЕРЫ =====

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ===== ЭКСПОРТ =====

module.exports = {
  db,
  generateId,
  generateToken,
  DATA_PATH,
  DB_PATH
};
