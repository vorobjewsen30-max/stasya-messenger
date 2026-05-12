const express = require('express');
const router = express.Router();
const { db, generateId } = require('../database');
const { authMiddleware } = require('./auth');
const crypto = require('crypto');

// Создать канал
router.post('/', authMiddleware, (req, res) => {
  try {
    const { name, type, description, isPublic } = req.body;
    if (!name || name.length < 2) return res.status(400).json({ error: 'Название должно быть не менее 2 символов' });

    const id = generateId();
    const inviteCode = (isPublic || type === 'group') ? crypto.randomBytes(6).toString('hex') : null;

    db.prepare('INSERT INTO channels (id, name, type, description, owner_id, is_public, invite_code) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name, type || 'text', description || '', req.user.id, isPublic ? 1 : 0, inviteCode);
    db.prepare('INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'owner');

    const channel = getChannel(id);
    res.status(201).json({ channel });
  } catch (error) {
    console.error('Ошибка создания канала:', error);
    res.status(500).json({ error: 'Ошибка создания канала' });
  }
});

// Получить каналы пользователя
router.get('/', authMiddleware, (req, res) => {
  const channels = db.prepare(`
    SELECT c.* FROM channels c 
    JOIN channel_members cm ON c.id = cm.channel_id 
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id);

  const result = channels.map(ch => enrichChannel(ch));
  res.json({ channels: result });
});

// Получить канал
router.get('/:channelId', authMiddleware, (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Канал не найден' });

  const member = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, req.user.id);
  if (!member && !channel.is_public) return res.status(403).json({ error: 'Нет доступа' });

  res.json({ channel: enrichChannel(channel) });
});

// Присоединиться по инвайту
router.post('/join/:inviteCode', authMiddleware, (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE invite_code = ?').get(req.params.inviteCode);
  if (!channel) return res.status(404).json({ error: 'Неверный код' });

  const member = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, req.user.id);
  if (member) return res.status(400).json({ error: 'Вы уже участник' });

  db.prepare('INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)').run(channel.id, req.user.id, 'member');

  const io = req.app.get('io');
  io.to(`channel:${channel.id}`).emit('memberJoined', {
    channelId: channel.id,
    user: { id: req.user.id, username: req.user.username, display_name: req.user.display_name, avatar: req.user.avatar }
  });

  res.json({ channel: enrichChannel(channel) });
});

// Создать инвайт
router.post('/:channelId/invite', authMiddleware, (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Канал не найден' });

  const member = db.prepare('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, req.user.id);
  if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) return res.status(403).json({ error: 'Недостаточно прав' });

  const inviteCode = crypto.randomBytes(6).toString('hex');
  db.prepare('UPDATE channels SET invite_code = ? WHERE id = ?').run(inviteCode, channel.id);

  res.json({ inviteCode });
});

// Создать DM
router.post('/dm/:userId', authMiddleware, (req, res) => {
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Нельзя создать DM с собой' });

  const other = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!other) return res.status(404).json({ error: 'Пользователь не найден' });

  // Ищем существующий DM
  const existingDM = db.prepare(`
    SELECT c.id FROM channels c
    WHERE c.type = 'dm' 
    AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2
    AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = ?)
    AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = ?)
  `).get(req.user.id, req.params.userId);

  if (existingDM) {
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(existingDM.id);
    return res.json({ channel: enrichChannel(channel) });
  }

  const id = generateId();
  db.prepare('INSERT INTO channels (id, name, type) VALUES (?, ?, ?)').run(id, `${req.user.username}-${other.id}`, 'dm');
  db.prepare('INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'member');
  db.prepare('INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)').run(id, req.params.userId, 'member');

  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
  res.status(201).json({ channel: enrichChannel(channel) });
});

// Покинуть канал
router.post('/:channelId/leave', authMiddleware, (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Канал не найден' });

  db.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').run(channel.id, req.user.id);

  const remaining = db.prepare('SELECT COUNT(*) as count FROM channel_members WHERE channel_id = ?').get(channel.id);
  if (remaining.count === 0) {
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    return res.json({ message: 'Канал удалён' });
  }

  if (channel.owner_id === req.user.id) {
    const newOwner = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ? AND role = ?').get(channel.id, 'admin')
      || db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ? LIMIT 1').get(channel.id);
    if (newOwner) {
      db.prepare('UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?').run('owner', channel.id, newOwner.user_id);
      db.prepare('UPDATE channels SET owner_id = ? WHERE id = ?').run(newOwner.user_id, channel.id);
    }
  }

  res.json({ message: 'Вы покинули канал' });
});

// ===== ХЕЛПЕРЫ =====

function getChannel(id) {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
}

function enrichChannel(channel) {
  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.custom_status, cm.role
    FROM channel_members cm JOIN users u ON cm.user_id = u.id
    WHERE cm.channel_id = ?
  `).all(channel.id);

  const lastMessage = channel.last_message_id 
    ? db.prepare('SELECT * FROM messages WHERE id = ?').get(channel.last_message_id) 
    : null;

  return { ...channel, members, lastMessage };
}

module.exports = router;
