const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const { auth, botAuth } = require('../middleware/auth');

// Получить сообщения канала (с пагинацией)
router.get('/:channelId', auth, async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    const channelId = req.params.channelId;

    // Проверка доступа к каналу
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    const isMember = channel.members.some(
      m => m.user.toString() === req.user._id.toString()
    );
    if (!isMember && !channel.isPublic) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const query = { channel: channelId, deleted: false };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .populate('author', 'username displayName avatar isBot')
      .populate('replyTo')
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 100));

    res.json({ messages: messages.reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения сообщений' });
  }
});

// Отправить сообщение
router.post('/:channelId', auth, async (req, res) => {
  try {
    const { content, type, attachments, embed, replyTo } = req.body;
    const channelId = req.params.channelId;

    if (!content && !attachments?.length && !embed) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Проверка доступа
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    const isMember = channel.members.some(
      m => m.user.toString() === req.user._id.toString()
    );
    if (!isMember) {
      return res.status(403).json({ error: 'Вы не участник канала' });
    }

    const message = new Message({
      channel: channelId,
      author: req.user._id,
      content: content || '',
      type: type || 'text',
      attachments: attachments || [],
      embed: embed || null,
      replyTo: replyTo || null
    });

    await message.save();
    await message.populate('author', 'username displayName avatar isBot');
    await message.populate('replyTo');

    // Обновляем lastMessage канала
    channel.lastMessage = message._id;
    await channel.save();

    // Отправляем через WebSocket
    const io = req.app.get('io');
    io.to(`channel:${channelId}`).emit('newMessage', { message });

    // Отправляем уведомление если это ответ
    if (replyTo) {
      const repliedMsg = await Message.findById(replyTo).populate('author', '_id');
      if (repliedMsg && repliedMsg.author._id.toString() !== req.user._id.toString()) {
        io.to(`user:${repliedMsg.author._id}`).emit('notification', {
          type: 'reply',
          message: `${req.user.username} ответил на ваше сообщение`,
          channelId,
          messageId: message._id
        });
      }
    }

    res.status(201).json({ message });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: 'Ошибка отправки сообщения' });
  }
});

// Редактировать сообщение
router.patch('/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    if (message.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Нельзя редактировать чужие сообщения' });
    }

    if (Date.now() - message.createdAt > 3600000) {
      return res.status(400).json({ error: 'Сообщение можно редактировать только в течение часа' });
    }

    message.content = req.body.content || message.content;
    message.edited = true;
    message.editedAt = new Date();
    await message.save();
    await message.populate('author', 'username displayName avatar isBot');

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('messageEdited', { message });

    res.json({ message });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка редактирования' });
  }
});

// Удалить сообщение
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    const channel = await Channel.findById(message.channel);
    const member = channel?.members.find(
      m => m.user.toString() === req.user._id.toString()
    );

    const isAuthor = message.author.toString() === req.user._id.toString();
    const isModerator = member && ['owner', 'admin', 'moderator'].includes(member.role);

    if (!isAuthor && !isModerator) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    message.deleted = true;
    message.content = '[Сообщение удалено]';
    message.attachments = [];
    await message.save();

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('messageDeleted', { 
      messageId: message._id,
      channelId: message.channel
    });

    res.json({ message: 'Сообщение удалено' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// Добавить реакцию
router.post('/:messageId/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    let reaction = message.reactions.find(r => r.emoji === emoji);
    
    if (reaction) {
      if (reaction.users.includes(req.user._id)) {
        // Убрать реакцию
        reaction.users = reaction.users.filter(
          u => u.toString() !== req.user._id.toString()
        );
        if (reaction.users.length === 0) {
          message.reactions = message.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        reaction.users.push(req.user._id);
      }
    } else {
      message.reactions.push({ emoji, users: [req.user._id] });
    }

    await message.save();

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('messageReaction', {
      messageId: message._id,
      channelId: message.channel,
      reactions: message.reactions
    });

    res.json({ reactions: message.reactions });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка реакции' });
  }
});

// Закрепить сообщение
router.post('/:messageId/pin', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    const channel = await Channel.findById(message.channel);
    const member = channel?.members.find(
      m => m.user.toString() === req.user._id.toString()
    );

    if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    message.pinned = !message.pinned;
    await message.save();

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('messagePinned', {
      messageId: message._id,
      channelId: message.channel,
      pinned: message.pinned
    });

    res.json({ pinned: message.pinned });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка закрепления' });
  }
});

// ===== BOT API =====

// Отправить сообщение от бота
router.post('/bot/:channelId', botAuth, async (req, res) => {
  try {
    const { content, embed } = req.body;
    const channelId = req.params.channelId;

    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    const message = new Message({
      channel: channelId,
      author: req.bot._id,
      content: content || '',
      type: embed ? 'embed' : 'text',
      embed: embed || null
    });

    await message.save();
    await message.populate('author', 'username displayName avatar isBot');

    channel.lastMessage = message._id;
    await channel.save();

    const io = req.app.get('io');
    io.to(`channel:${channelId}`).emit('newMessage', { message });

    res.status(201).json({ message });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка отправки сообщения ботом' });
  }
});

module.exports = router;
