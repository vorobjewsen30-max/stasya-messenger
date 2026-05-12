const express = require('express');
const router = express.Router();
const Call = require('../models/Call');
const Channel = require('../models/Channel');
const { auth } = require('../middleware/auth');

// Начать звонок
router.post('/start/:channelId', auth, async (req, res) => {
  try {
    const { type = 'voice' } = req.body;
    const channel = await Channel.findById(req.params.channelId);

    if (!channel) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    const isMember = channel.members.some(
      m => m.user.toString() === req.user._id.toString()
    );
    if (!isMember) {
      return res.status(403).json({ error: 'Вы не участник канала' });
    }

    // Проверяем активные звонки в канале
    const activeCall = await Call.findOne({
      channel: channel._id,
      status: { $in: ['ringing', 'active'] }
    });

    if (activeCall) {
      return res.status(400).json({ error: 'В канале уже идёт звонок' });
    }

    const call = new Call({
      channel: channel._id,
      initiator: req.user._id,
      type,
      participants: [{
        user: req.user._id,
        isVideo: type === 'video'
      }]
    });

    await call.save();
    await call.populate('participants.user', 'username displayName avatar');

    // Уведомляем участников канала
    const io = req.app.get('io');
    io.to(`channel:${channel._id}`).emit('callStarted', {
      call: {
        _id: call._id,
        channelId: channel._id,
        channelName: channel.name,
        initiator: {
          _id: req.user._id,
          username: req.user.username,
          displayName: req.user.displayName,
          avatar: req.user.avatar
        },
        type,
        status: 'ringing'
      }
    });

    res.status(201).json({ call });
  } catch (error) {
    console.error('Ошибка начала звонка:', error);
    res.status(500).json({ error: 'Ошибка начала звонка' });
  }
});

// Присоединиться к звонку
router.post('/:callId/join', auth, async (req, res) => {
  try {
    const call = await Call.findById(req.params.callId);
    
    if (!call) {
      return res.status(404).json({ error: 'Звонок не найден' });
    }

    if (call.status === 'ended') {
      return res.status(400).json({ error: 'Звонок завершён' });
    }

    const isParticipant = call.participants.find(
      p => p.user.toString() === req.user._id.toString() && !p.leftAt
    );

    if (isParticipant) {
      return res.status(400).json({ error: 'Вы уже в звонке' });
    }

    call.participants.push({
      user: req.user._id,
      isVideo: req.body.video || false
    });

    if (call.status === 'ringing') {
      call.status = 'active';
    }

    await call.save();
    await call.populate('participants.user', 'username displayName avatar');

    const io = req.app.get('io');
    io.to(`channel:${call.channel}`).emit('callParticipantJoined', {
      callId: call._id,
      user: {
        _id: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      }
    });

    res.json({ call });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка присоединения к звонку' });
  }
});

// Покинуть звонок
router.post('/:callId/leave', auth, async (req, res) => {
  try {
    const call = await Call.findById(req.params.callId);
    
    if (!call) {
      return res.status(404).json({ error: 'Звонок не найден' });
    }

    const participant = call.participants.find(
      p => p.user.toString() === req.user._id.toString() && !p.leftAt
    );

    if (!participant) {
      return res.status(400).json({ error: 'Вы не в звонке' });
    }

    participant.leftAt = new Date();
    
    // Проверяем остались ли участники
    const activeParticipants = call.participants.filter(p => !p.leftAt);
    if (activeParticipants.length === 0) {
      call.status = 'ended';
      call.endedAt = new Date();
      call.duration = Math.floor((call.endedAt - call.startedAt) / 1000);
    }

    await call.save();

    const io = req.app.get('io');
    io.to(`channel:${call.channel}`).emit('callParticipantLeft', {
      callId: call._id,
      userId: req.user._id
    });

    if (call.status === 'ended') {
      io.to(`channel:${call.channel}`).emit('callEnded', {
        callId: call._id,
        duration: call.duration
      });
    }

    res.json({ call });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка выхода из звонка' });
  }
});

// Получить активные звонки пользователя
router.get('/active', auth, async (req, res) => {
  try {
    const calls = await Call.find({
      status: { $in: ['ringing', 'active'] },
      'participants.user': req.user._id,
      'participants.leftAt': null
    })
    .populate('participants.user', 'username displayName avatar')
    .populate('channel', 'name');

    res.json({ calls });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения звонков' });
  }
});

// WebRTC сигналинг
router.post('/signal/:callId', auth, async (req, res) => {
  try {
    const { targetUserId, signal } = req.body;
    const call = await Call.findById(req.params.callId);

    if (!call) {
      return res.status(404).json({ error: 'Звонок не найден' });
    }

    const io = req.app.get('io');
    io.to(`user:${targetUserId}`).emit('callSignal', {
      callId: call._id,
      fromUserId: req.user._id,
      signal
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сигналинга' });
  }
});

module.exports = router;
