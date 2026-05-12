const express = require('express');
const router = express.Router();
const { db, generateId } = require('../database');
const { authMiddleware } = require('./auth');
const crypto = require('crypto');

// Создать бота
router.post('/create', authMiddleware, (req, res) => {
  try {
    const { username, displayName } = req.body;
    if (!username || username.length < 3) return res.status(400).json({ error: 'Имя бота должно быть не менее 3 символов' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Только буквы, цифры и _' });

    const botUsername = `bot_${username.toLowerCase()}`;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(botUsername);
    if (existing) return res.status(400).json({ error: 'Бот с таким именем уже существует' });

    const id = generateId();
    const botToken = `stasya_bot_${crypto.randomBytes(24).toString('hex')}`;

    db.prepare(`
      INSERT INTO users (id, username, email, password, display_name, is_bot, bot_token, bot_owner, status)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'online')
    `).run(id, botUsername, `${botUsername}@bots.stasya.local`, crypto.randomBytes(16).toString('hex'), displayName || `🤖 ${username}`, botToken, req.user.id);

    const bot = db.prepare('SELECT id, username, display_name, avatar, is_bot, status, created_at FROM users WHERE id = ?').get(id);
    res.status(201).json({ bot, token: botToken });
  } catch (error) {
    console.error('Ошибка создания бота:', error);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Список ботов
router.get('/my', authMiddleware, (req, res) => {
  const bots = db.prepare('SELECT id, username, display_name, avatar, is_bot, status, bot_token, created_at FROM users WHERE is_bot = 1 AND bot_owner = ?').all(req.user.id);
  res.json({ bots });
});

// Регенерировать токен
router.post('/:botId/regenerate-token', authMiddleware, (req, res) => {
  const bot = db.prepare('SELECT * FROM users WHERE id = ? AND is_bot = 1 AND bot_owner = ?').get(req.params.botId, req.user.id);
  if (!bot) return res.status(404).json({ error: 'Бот не найден' });

  const newToken = `stasya_bot_${crypto.randomBytes(24).toString('hex')}`;
  db.prepare('UPDATE users SET bot_token = ? WHERE id = ?').run(newToken, bot.id);

  res.json({ token: newToken });
});

// Удалить бота
router.delete('/:botId', authMiddleware, (req, res) => {
  const bot = db.prepare('SELECT id FROM users WHERE id = ? AND is_bot = 1 AND bot_owner = ?').get(req.params.botId, req.user.id);
  if (!bot) return res.status(404).json({ error: 'Бот не найден' });

  db.prepare('DELETE FROM users WHERE id = ?').run(bot.id);
  res.json({ message: 'Бот удалён' });
});

// Инфо о боте
router.get('/:botId', authMiddleware, (req, res) => {
  const bot = db.prepare('SELECT id, username, display_name, avatar, is_bot, status, created_at FROM users WHERE id = ? AND is_bot = 1').get(req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Бот не найден' });
  res.json({ bot });
});

module.exports = router;
