const express = require('express');
const router = express.Router();
const Channel = require('../models/Channel');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const crypto = require('crypto');

// Создать канал/группу
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, description, isPublic } = req.body;

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Название канала должно быть не менее 2 символов' });
    }

    const channel = new Channel({
      name,
      type: type || 'text',
      description: description || '',
      isPublic: isPublic || false,
      owner: req.user._id,
      members: [{
        user: req.user._id,
        role: 'owner'
      }]
    });

    if (isPublic || type === 'group') {
      channel.generateInvite();
    }

    await channel.save();

    // Популируем members
    await channel.populate('members.user', 'username displayName avatar status');

    res.status(201).json({ channel });
  } catch (error) {
    console.error('Ошибка создания канала:', error);
    res.status(500).json({ error: 'Ошибка создания канала' });
  }
});

// Получить каналы пользователя
router.get('/', auth, async (req, res) => {
  try {
    const channels = await Channel.find({
      'members.user': req.user._id
    })
    .populate('members.user', 'username displayName avatar status')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });

    res.json({ channels });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения каналов' });
  }
});

// Получить конкретный канал
router.get('/:channelId', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.channelId)
      .populate('members.user', 'username displayName avatar status customStatus')
      .populate('lastMessage');

    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    // Проверка доступа
    const isMember = channel.members.some(
      m => m.user._id.toString() === req.user._id.toString()
    );
    if (!isMember && !channel.isPublic) {
      return res.status(403).json({ error: 'Нет доступа к каналу' });
    }

    res.json({ channel });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения канала' });
  }
});

// Присоединиться по инвайт-коду
router.post('/join/:inviteCode', auth, async (req, res) => {
  try {
    const channel = await Channel.findOne({ inviteCode: req.params.inviteCode });

    if (!channel) {
      return res.status(404).json({ error: 'Неверный код приглашения' });
    }

    const isMember = channel.members.some(
      m => m.user.toString() === req.user._id.toString()
    );

    if (isMember) {
      return res.status(400).json({ error: 'Вы уже участник' });
    }

    channel.members.push({
      user: req.user._id,
      role: 'member'
    });

    await channel.save();
    await channel.populate('members.user', 'username displayName avatar status');

    // Уведомление через WebSocket
    const io = req.app.get('io');
    io.to(`channel:${channel._id}`).emit('memberJoined', {
      channelId: channel._id,
      user: {
        _id: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      }
    });

    res.json({ channel });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка присоединения' });
  }
});

// Создать инвайт
router.post('/:channelId/invite', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    const member = channel.members.find(
      m => m.user.toString() === req.user._id.toString()
    );
    if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    channel.generateInvite();
    await channel.save();

    res.json({ inviteCode: channel.inviteCode });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка создания инвайта' });
  }
});

// Создать DM (личные сообщения)
router.post('/dm/:userId', auth, async (req, res) => {
  try {
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Нельзя создать DM с собой' });
    }

    const otherUser = await User.findById(req.params.userId);
    if (!otherUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверяем существующий DM
    let dm = await Channel.findOne({
      type: 'dm',
      'members.user': { $all: [req.user._id, otherUser._id] },
      $expr: { $eq: [{ $size: '$members' }, 2] }
    }).populate('members.user', 'username displayName avatar status');

    if (dm) {
      return res.json({ channel: dm });
    }

    // Создаём новый DM
    dm = new Channel({
      name: `${req.user.username}-${otherUser.username}`,
      type: 'dm',
      members: [
        { user: req.user._id, role: 'member' },
        { user: otherUser._id, role: 'member' }
      ]
    });

    await dm.save();
    await dm.populate('members.user', 'username displayName avatar status');

    res.status(201).json({ channel: dm });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка создания DM' });
  }
});

// Покинуть канал
router.post('/:channelId/leave', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    channel.members = channel.members.filter(
      m => m.user.toString() !== req.user._id.toString()
    );

    if (channel.members.length === 0) {
      await Channel.findByIdAndDelete(channel._id);
      return res.json({ message: 'Канал удалён' });
    }

    // Передаём владение если owner уходит
    if (channel.owner?.toString() === req.user._id.toString()) {
      const newOwner = channel.members.find(m => m.role === 'admin') || channel.members[0];
      if (newOwner) {
        newOwner.role = 'owner';
        channel.owner = newOwner.user;
      }
    }

    await channel.save();
    res.json({ message: 'Вы покинули канал' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка выхода из канала' });
  }
});

module.exports = router;
