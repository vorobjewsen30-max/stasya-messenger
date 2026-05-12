const express = require('express');
const router = express.Router();
const { db, generateId } = require('../database');
const { authMiddleware } = require('./auth');

// Поиск пользователей
router.get('/search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ users: [] });

  const users = db.prepare(`
    SELECT id, username, display_name, avatar, status, custom_status 
    FROM users 
    WHERE (username LIKE ? OR display_name LIKE ?) AND id != ?
    LIMIT 20
  `).all(`%${q}%`, `%${q}%`, req.user.id);

  res.json({ users });
});

// Получить пользователя
router.get('/:username', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, avatar, status, custom_status, bio, is_bot, last_seen, created_at FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user });
});

// Друзья
router.get('/:id/friends', authMiddleware, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.custom_status 
    FROM friends f JOIN users u ON f.friend_id = u.id 
    WHERE f.user_id = ?
  `).all(req.params.id);
  res.json({ friends });
});

// Отправить запрос в друзья
router.post('/friend-request/:userId', authMiddleware, (req, res) => {
  try {
    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'Нельзя добавить себя' });
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    // Проверка блокировки
    const blocked = db.prepare('SELECT 1 FROM blocked WHERE user_id = ? AND blocked_id = ?').get(req.params.userId, req.user.id);
    if (blocked) return res.status(403).json({ error: 'Вы заблокированы' });

    // Уже друзья?
    const alreadyFriend = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, req.params.userId);
    if (alreadyFriend) return res.status(400).json({ error: 'Вы уже друзья' });

    // Уже отправлен запрос?
    const existing = db.prepare('SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ?').get(req.user.id, req.params.userId);
    if (existing) return res.status(400).json({ error: 'Запрос уже отправлен' });

    db.prepare('INSERT INTO friend_requests (id, from_user, to_user) VALUES (?, ?, ?)').run(generateId(), req.user.id, req.params.userId);

    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('friendRequest', {
      from: { id: req.user.id, username: req.user.username, display_name: req.user.display_name, avatar: req.user.avatar }
    });

    res.json({ message: 'Запрос отправлен' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Принять запрос
router.post('/friend-request/:userId/accept', authMiddleware, (req, res) => {
  try {
    const request = db.prepare('SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ?').get(req.params.userId, req.user.id);
    if (!request) return res.status(404).json({ error: 'Запрос не найден' });

    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(req.user.id, req.params.userId);
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(req.params.userId, req.user.id);
    db.prepare('DELETE FROM friend_requests WHERE id = ?').run(request.id);

    const friend = db.prepare('SELECT id, username, display_name, avatar, status FROM users WHERE id = ?').get(req.params.userId);

    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('friendAccepted', {
      user: { id: req.user.id, username: req.user.username, display_name: req.user.display_name, avatar: req.user.avatar }
    });

    res.json({ message: 'Запрос принят', friend });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Отклонить запрос
router.post('/friend-request/:userId/reject', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?').run(req.params.userId, req.user.id);
  res.json({ message: 'Запрос отклонён' });
});

// Удалить из друзей
router.delete('/friend/:userId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, req.params.userId, req.params.userId, req.user.id);
  res.json({ message: 'Удалён из друзей' });
});

// Заблокировать
router.post('/block/:userId', authMiddleware, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO blocked (user_id, blocked_id) VALUES (?, ?)').run(req.user.id, req.params.userId);
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, req.params.userId, req.params.userId, req.user.id);
  res.json({ message: 'Заблокирован' });
});

module.exports = router;
