const express = require('express');
const router = express.Router();
const { db, generateId } = require('../database');
const { authMiddleware } = require('./auth');

// Начать звонок
router.post('/start/:channelId', authMiddleware, (req, res) => {
  try {
    const { type = 'voice' } = req.body;
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const member = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Вы не участник' });

    const activeCall = db.prepare('SELECT id FROM calls WHERE channel_id = ? AND status IN (\'ringing\', \'active\')').get(channel.id);
    if (activeCall) return res.status(400).json({ error: 'В канале уже идёт звонок' });

    const callId = generateId();
    db.prepare('INSERT INTO calls (id, channel_id, initiator_id, type) VALUES (?, ?, ?, ?)').run(callId, channel.id, req.user.id, type);
    db.prepare('INSERT INTO call_participants (call_id, user_id, is_video) VALUES (?, ?, ?)').run(callId, req.user.id, type === 'video' ? 1 : 0);

    const call = getCall(callId);

    const io = req.app.get('io');
    io.to(`channel:${channel.id}`).emit('callStarted', {
      call: {
        id: call.id,
        channelId: channel.id,
        channelName: channel.name,
        initiator: { id: req.user.id, username: req.user.username, display_name: req.user.display_name, avatar: req.user.avatar },
        type,
        status: 'ringing'
      }
    });

    res.status(201).json({ call });
  } catch (error) {
    console.error('Ошибка звонка:', error);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Присоединиться
router.post('/:callId/join', authMiddleware, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) return res.status(404).json({ error: 'Звонок не найден' });
    if (call.status === 'ended') return res.status(400).json({ error: 'Звонок завершён' });

    const participant = db.prepare('SELECT 1 FROM call_participants WHERE call_id = ? AND user_id = ? AND left_at IS NULL').get(call.id, req.user.id);
    if (participant) return res.status(400).json({ error: 'Вы уже в звонке' });

    db.prepare('INSERT INTO call_participants (call_id, user_id, is_video) VALUES (?, ?, ?)').run(call.id, req.user.id, req.body.video ? 1 : 0);

    if (call.status === 'ringing') {
      db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('active', call.id);
    }

    const updatedCall = getCall(call.id);

    const io = req.app.get('io');
    io.to(`channel:${call.channel_id}`).emit('callParticipantJoined', {
      callId: call.id,
      user: { id: req.user.id, username: req.user.username, display_name: req.user.display_name, avatar: req.user.avatar }
    });

    res.json({ call: updatedCall });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Покинуть звонок
router.post('/:callId/leave', authMiddleware, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) return res.status(404).json({ error: 'Звонок не найден' });

    db.prepare('UPDATE call_participants SET left_at = datetime(\'now\') WHERE call_id = ? AND user_id = ? AND left_at IS NULL').run(call.id, req.user.id);

    const activeParticipants = db.prepare('SELECT COUNT(*) as count FROM call_participants WHERE call_id = ? AND left_at IS NULL').get(call.id);
    
    const io = req.app.get('io');
    io.to(`channel:${call.channel_id}`).emit('callParticipantLeft', { callId: call.id, userId: req.user.id });

    if (activeParticipants.count === 0) {
      db.prepare('UPDATE calls SET status = ?, ended_at = datetime(\'now\'), duration = (julianday(\'now\') - julianday(started_at)) * 86400 WHERE id = ?').run('ended', call.id);
      io.to(`channel:${call.channel_id}`).emit('callEnded', { callId: call.id });
    }

    const updatedCall = getCall(call.id);
    res.json({ call: updatedCall });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Активные звонки
router.get('/active', authMiddleware, (req, res) => {
  const calls = db.prepare(`
    SELECT DISTINCT c.* FROM calls c
    JOIN call_participants cp ON c.id = cp.call_id
    WHERE cp.user_id = ? AND cp.left_at IS NULL AND c.status IN ('ringing', 'active')
  `).all(req.user.id);

  const result = calls.map(call => getCall(call.id));
  res.json({ calls: result });
});

// Сигналинг
router.post('/signal/:callId', authMiddleware, (req, res) => {
  const { targetUserId, signal } = req.body;
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
  if (!call) return res.status(404).json({ error: 'Звонок не найден' });

  const io = req.app.get('io');
  io.to(`user:${targetUserId}`).emit('callSignal', { callId: call.id, fromUserId: req.user.id, signal });

  res.json({ success: true });
});

// ===== ХЕЛПЕР =====

function getCall(id) {
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  if (!call) return null;

  const participants = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, cp.*
    FROM call_participants cp JOIN users u ON cp.user_id = u.id
    WHERE cp.call_id = ?
  `).all(id);

  const channel = db.prepare('SELECT id, name FROM channels WHERE id = ?').get(call.channel_id);

  return { ...call, participants, channel };
}

module.exports = router;
