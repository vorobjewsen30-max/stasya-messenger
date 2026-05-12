const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Путь к БД на Render Disk
const DATA_PATH = process.env.RENDER_DISK_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

const DB_PATH = path.join(DATA_PATH, 'stasya.db');

let db = null;

// Инициализация БД
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Загружаем существующую БД или создаём новую
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('📂 База данных загружена');
  } else {
    db = new SQL.Database();
    console.log('🆕 Создана новая база данных');
  }

  // Создаём таблицы
  db.run(`
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
    )
  `);

  db.run(`CREATE TABLE IF NOT EXISTS friends (user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, friend_id))`);
  db.run(`CREATE TABLE IF NOT EXISTS friend_requests (id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS blocked (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (user_id, blocked_id))`);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'text',
      description TEXT DEFAULT '', icon TEXT DEFAULT '', owner_id TEXT,
      is_public INTEGER DEFAULT 0, invite_code TEXT UNIQUE,
      last_message_id TEXT, created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  db.run(`CREATE TABLE IF NOT EXISTS channel_members (channel_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member', joined_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (channel_id, user_id))`);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL,
      content TEXT DEFAULT '', type TEXT DEFAULT 'text', reply_to TEXT,
      edited INTEGER DEFAULT 0, edited_at TEXT, deleted INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  db.run(`CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, filename TEXT, url TEXT, size INTEGER, mime_type TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS embeds (id TEXT PRIMARY KEY, message_id TEXT UNIQUE, title TEXT, description TEXT, color TEXT, image TEXT, thumbnail TEXT, footer TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS embed_fields (id TEXT PRIMARY KEY, embed_id TEXT NOT NULL, name TEXT, value TEXT, inline INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS reactions (message_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (message_id, user_id, emoji))`);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, initiator_id TEXT NOT NULL,
      status TEXT DEFAULT 'ringing', type TEXT DEFAULT 'voice',
      started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, duration INTEGER DEFAULT 0
    )
  `);
  
  db.run(`CREATE TABLE IF NOT EXISTS call_participants (call_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT DEFAULT (datetime('now')), left_at TEXT, is_muted INTEGER DEFAULT 0, is_deafened INTEGER DEFAULT 0, is_video INTEGER DEFAULT 0, is_screen_sharing INTEGER DEFAULT 0, PRIMARY KEY (call_id, user_id))`);

  // Индексы
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id)');

  saveDatabase();
  return db;
}

// Сохранение на диск
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Автосохранение каждые 30 секунд
setInterval(() => {
  saveDatabase();
}, 30000);

// Сохранение при выходе
process.on('exit', () => saveDatabase());
process.on('SIGTERM', () => { saveDatabase(); process.exit(0); });
process.on('SIGINT', () => { saveDatabase(); process.exit(0); });

// Хелперы
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Обёртки для совместимости с существующим кодом
function prepare(sql) {
  return {
    get: (...params) => {
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const columns = stmt.getColumnNames();
          const values = stmt.get();
          const obj = {};
          columns.forEach((col, i) => obj[col] = values[i]);
          stmt.free();
          return obj;
        }
        stmt.free();
        return undefined;
      } catch (e) {
        console.error('SQL get error:', e.message, sql);
        return undefined;
      }
    },
    all: (...params) => {
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        const columns = stmt.getColumnNames();
        while (stmt.step()) {
          const values = stmt.get();
          const obj = {};
          columns.forEach((col, i) => obj[col] = values[i]);
          results.push(obj);
        }
        stmt.free();
        return results;
      } catch (e) {
        console.error('SQL all error:', e.message, sql);
        return [];
      }
    },
    run: (...params) => {
      try {
        db.run(sql, params);
        saveDatabase();
        return { changes: 1 };
      } catch (e) {
        console.error('SQL run error:', e.message, sql);
        return { changes: 0 };
      }
    }
  };
}

function exec(sql) {
  try {
    db.run(sql);
    saveDatabase();
  } catch (e) {
    console.error('SQL exec error:', e.message);
  }
}

module.exports = {
  initDatabase,
  getDb: () => db,
  db: new Proxy({}, {
    get(target, prop) {
      if (prop === 'prepare') return prepare;
      if (prop === 'exec') return exec;
      if (prop === 'run') return (sql, params) => { try { db.run(sql, params); saveDatabase(); } catch(e) { console.error(e.message); } };
      return undefined;
    }
  }),
  prepare,
  exec,
  generateId,
  generateToken,
  saveDatabase,
  DATA_PATH,
  DB_PATH
};
