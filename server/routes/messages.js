const express = require('express');
const router = express.Router();
const { db, generateId } = require('../database');
const { authMiddleware, botAuthMiddleware } = require('./auth');

// Поиск сообщений
router.get('/search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ messages: [] });

  const messages = db.prepare(`
    SELECT m.*, c.name as channel_name FROM messages m
    JOIN channels c ON m.channel_id = c.id
    JOIN channel_members cm ON c.id = cm.channel_id AND cm.user_id = ?
    WHERE m.content LIKE ? AND m.deleted = 0
    ORDER BY m.created_at DESC
    LIMIT 30
  `).all(req.user.id, `%${q}%`);

  const enriched = messages.map(msg => {
    const author = db.prepare('SELECT id, username, display_name, avatar, is_bot FROM users WHERE id = ?').get(msg.author_id);
    return { ...msg, author };
  });

  res.json({ messages: enriched });
});

// Получить сообщения
router.get('/:channelId', authMiddleware, (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    const channelId = req.params.channelId;

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const member = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, req.user.id);
    if (!member && !channel.is_public) return res.status(403).json({ error: 'Нет доступа' });

    let query = 'SELECT * FROM messages WHERE channel_id = ? AND deleted = 0';
    const params = [channelId];

    if (before) {
      query += ' AND created_at < ?';
      params.push(before);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.min(parseInt(limit), 100));

    const messages = db.prepare(query).all(...params);
    const enriched = messages.reverse().map(enrichMessage);

    res.json({ messages: enriched });
  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Отправить сообщение
router.post('/:channelId', authMiddleware, (req, res) => {
  try {
    const { content, type, attachments, embed, replyTo } = req.body;
    const channelId = req.params.channelId;

    if (!content && !attachments?.length && !embed) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const member = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Вы не участник' });

    const messageId = generateId();

    db.prepare(`
      INSERT INTO messages (id, channel_id, author_id, content, type, reply_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, channelId, req.user.id, content || '', type || (embed ? 'embed' : 'text'), replyTo || null);

    // Вложения
    if (attachments?.length) {
      const insertAttach = db.prepare('INSERT INTO attachments (id, message_id, filename, url, size, mime_type) VALUES (?, ?, ?, ?, ?, ?)');
      for (const att of attachments) {
        insertAttach.run(generateId(), messageId, att.filename, att.url, att.size, att.mimeType);
      }
    }

    // Embed
    if (embed) {
      const embedId = generateId();
      db.prepare('INSERT INTO embeds (id, message_id, title, description, color, image, thumbnail, footer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(embedId, messageId, embed.title, embed.description, embed.color, embed.image, embed.thumbnail, embed.footer);
      if (embed.fields?.length) {
        const insertField = db.prepare('INSERT INTO embed_fields (id, embed_id, name, value, inline) VALUES (?, ?, ?, ?, ?)');
        for (const field of embed.fields) {
          insertField.run(generateId(), embedId, field.name, field.value, field.inline ? 1 : 0);
        }
      }
    }

    // Обновляем last_message_id
    db.prepare('UPDATE channels SET last_message_id = ? WHERE id = ?').run(messageId, channelId);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    const enriched = enrichMessage(message);

    const io = req.app.get('io');
    io.to(`channel:${channelId}`).emit('newMessage', { message: enriched });

    // Уведомление об ответе
    if (replyTo) {
      const replied = db.prepare('SELECT author_id FROM messages WHERE id = ?').get(replyTo);
      if (replied && replied.author_id !== req.user.id) {
        io.to(`user:${replied.author_id}`).emit('notification', {
          type: 'reply',
          message: `${req.user.username} ответил на ваше сообщение`,
          channelId,
          messageId
        });
      }
    }

    res.status(201).json({ message: enriched });
  } catch (error) {
    console.error('Ошибка отправки:', error);
    res.status(500).json({ error: 'Ошибка отправки' });
  }
});

// Редактировать сообщение
router.patch('/:messageId', authMiddleware, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (message.author_id !== req.user.id) return res.status(403).json({ error: 'Нельзя редактировать чужие сообщения' });

    const age = Date.now() - new Date(message.created_at + 'Z').getTime();
    if (age > 3600000) return res.status(400).json({ error: 'Можно редактировать только в течение часа' });

    db.prepare('UPDATE messages SET content = ?, edited = 1, edited_at = datetime(\'now\') WHERE id = ?').run(req.body.content || message.content, message.id);

    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id);
    const enriched = enrichMessage(updated);

    const io = req.app.get('io');
    io.to(`channel:${message.channel_id}`).emit('messageEdited', { message: enriched });

    res.json({ message: enriched });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Удалить сообщение
router.delete('/:messageId', authMiddleware, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

    const member = db.prepare('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?').get(message.channel_id, req.user.id);
    const isAuthor = message.author_id === req.user.id;
    const isMod = member && ['owner', 'admin', 'moderator'].includes(member.role);

    if (!isAuthor && !isMod) return res.status(403).json({ error: 'Недостаточно прав' });

    db.prepare('UPDATE messages SET deleted = 1, content = \'[Сообщение удалено]\' WHERE id = ?').run(message.id);
    db.prepare('DELETE FROM attachments WHERE message_id = ?').run(message.id);

    const io = req.app.get('io');
    io.to(`channel:${message.channel_id}`).emit('messageDeleted', { messageId: message.id, channelId: message.channel_id });

    res.json({ message: 'Сообщение удалено' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Реакции
router.post('/:messageId/react', authMiddleware, (req, res) => {
  try {
    const { emoji } = req.body;
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

    const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(message.id, req.user.id, emoji);

    if (existing) {
      db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(message.id, req.user.id, emoji);
    } else {
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(message.id, req.user.id, emoji);
    }

    const reactions = getReactions(message.id);
    const io = req.app.get('io');
    io.to(`channel:${message.channel_id}`).emit('messageReaction', { messageId: message.id, channelId: message.channel_id, reactions });

    res.json({ reactions });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Закрепить
router.post('/:messageId/pin', authMiddleware, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });

    const member = db.prepare('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?').get(message.channel_id, req.user.id);
    if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) return res.status(403).json({ error: 'Недостаточно прав' });

    const newPinned = message.pinned ? 0 : 1;
    db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(newPinned, message.id);

    const io = req.app.get('io');
    io.to(`channel:${message.channel_id}`).emit('messagePinned', { messageId: message.id, channelId: message.channel_id, pinned: !!newPinned });

    res.json({ pinned: !!newPinned });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ===== BOT API =====
router.post('/bot/:channelId', botAuthMiddleware, (req, res) => {
  try {
    const { content, embed } = req.body;
    const channelId = req.params.channelId;

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const messageId = generateId();
    db.prepare('INSERT INTO messages (id, channel_id, author_id, content, type) VALUES (?, ?, ?, ?, ?)').run(messageId, channelId, req.bot.id, content || '', embed ? 'embed' : 'text');

    if (embed) {
      const embedId = generateId();
      db.prepare('INSERT INTO embeds (id, message_id, title, description, color, image, thumbnail, footer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(embedId, messageId, embed.title, embed.description, embed.color, embed.image, embed.thumbnail, embed.footer);
      if (embed.fields?.length) {
        const insertField = db.prepare('INSERT INTO embed_fields (id, embed_id, name, value, inline) VALUES (?, ?, ?, ?, ?)');
        for (const field of embed.fields) {
          insertField.run(generateId(), embedId, field.name, field.value, field.inline ? 1 : 0);
        }
      }
    }

    db.prepare('UPDATE channels SET last_message_id = ? WHERE id = ?').run(messageId, channelId);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    const enriched = enrichMessage(message);

    const io = req.app.get('io');
    io.to(`channel:${channelId}`).emit('newMessage', { message: enriched });

    res.status(201).json({ message: enriched });
  } catch (error) {
    console.error('Ошибка бота:', error);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ===== ХЕЛПЕРЫ =====

function enrichMessage(msg) {
  const author = db.prepare('SELECT id, username, display_name, avatar, is_bot FROM users WHERE id = ?').get(msg.author_id);
  const attachments = db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(msg.id);
  const embed = db.prepare('SELECT * FROM embeds WHERE message_id = ?').get(msg.id);
  const reactions = getReactions(msg.id);
  let replyTo = null;
  if (msg.reply_to) {
    replyTo = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.reply_to);
  }

  if (embed) {
    embed.fields = db.prepare('SELECT * FROM embed_fields WHERE embed_id = ?').all(embed.id);
  }

  return { ...msg, author, attachments, embed, reactions, replyTo };
}

function getReactions(messageId) {
  const rows = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?').all(messageId);
  const map = {};
  for (const row of rows) {
    if (!map[row.emoji]) map[row.emoji] = { emoji: row.emoji, users: [] };
    map[row.emoji].users.push(row.user_id);
  }
  return Object.values(map);
}

module.exports = router;
