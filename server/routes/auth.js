const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, generateId } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'stasya-super-secret-key-change-in-production-2024';

function generateJWT(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, email, display_name, avatar, status, custom_status, bio, is_bot, bot_token, bot_owner, last_seen, created_at FROM users WHERE id = ?').get(decoded.userId);
    
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

function botAuthMiddleware(req, res, next) {
  try {
    const botToken = req.header('X-Bot-Token') || req.query.bot_token;
    if (!botToken) return res.status(401).json({ error: 'Требуется бот-токен' });

    const bot = db.prepare('SELECT * FROM users WHERE bot_token = ? AND is_bot = 1').get(botToken);
    if (!bot) return res.status(401).json({ error: 'Бот не найден' });

    req.bot = bot;
    req.isBot = true;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Недействительный бот-токен' });
  }
}

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 30 символов' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Имя пользователя может содержать только буквы, цифры и _' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username.toLowerCase(), email.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'Имя пользователя или email уже заняты' });
    }

    const id = generateId();
    const hashedPassword = await bcrypt.hash(password, 10);

    db.prepare(`
      INSERT INTO users (id, username, email, password, display_name, status, last_seen)
      VALUES (?, ?, ?, ?, ?, 'online', datetime('now'))
    `).run(id, username.toLowerCase(), email.toLowerCase(), hashedPassword, displayName || username);

    const user = db.prepare('SELECT id, username, email, display_name, avatar, status, custom_status, bio, is_bot, last_seen, created_at FROM users WHERE id = ?').get(id);
    const token = generateJWT(id);

    res.status(201).json({ token, user });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login.toLowerCase(), login.toLowerCase());
    if (!user) return res.status(400).json({ error: 'Неверный логин или пароль' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Неверный логин или пароль' });

    db.prepare('UPDATE users SET status = ?, last_seen = datetime(\'now\') WHERE id = ?').run('online', user.id);

    const token = generateJWT(user.id);
    const { password: _, ...userData } = user;

    res.json({ token, user: userData });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Текущий пользователь
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Обновить профиль
router.patch('/me', authMiddleware, (req, res) => {
  try {
    const { displayName, bio, customStatus, avatar } = req.body;
    const updates = [];
    const params = [];

    if (displayName !== undefined) { updates.push('display_name = ?'); params.push(displayName); }
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (customStatus !== undefined) { updates.push('custom_status = ?'); params.push(customStatus); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }

    if (updates.length > 0) {
      params.push(req.user.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    const user = db.prepare('SELECT id, username, email, display_name, avatar, status, custom_status, bio, is_bot, last_seen, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// Выход
router.post('/logout', authMiddleware, (req, res) => {
  db.prepare('UPDATE users SET status = ?, last_seen = datetime(\'now\') WHERE id = ?').run('offline', req.user.id);
  res.json({ message: 'Вы вышли' });
});

module.exports = { router, authMiddleware, botAuthMiddleware, generateJWT, JWT_SECRET };
