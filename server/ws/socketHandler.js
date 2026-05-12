const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { JWT_SECRET } = require('../routes/auth');

const onlineUsers = new Map();
const userSockets = new Map();

module.exports = (io, dataPath) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) return next(new Error('Требуется авторизация'));

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, username, display_name, avatar, status, is_bot, verified, is_ceo FROM users WHERE id = ?').get(decoded.userId);
      if (!user) return next(new Error('Пользователь не найден'));

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Недействительный токен'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`✅ ${user.username} подключился`);

    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id).add(socket.id);
    userSockets.set(socket.id, user.id);

    db.prepare('UPDATE users SET status = ?, last_seen = datetime(\'now\') WHERE id = ?').run('online', user.id);

    socket.join(`user:${user.id}`);

    // Оповещаем друзей
    const friends = db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(user.id);
    for (const f of friends) {
      io.to(`user:${f.friend_id}`).emit('userStatus', { userId: user.id, username: user.username, status: 'online' });
    }

    // Онлайн друзья
    const onlineFriends = [];
    for (const f of friends) {
      if (onlineUsers.has(f.friend_id)) {
        const friend = db.prepare('SELECT id, username, display_name, avatar, status, custom_status, verified, is_ceo FROM users WHERE id = ?').get(f.friend_id);
        if (friend) onlineFriends.push(friend);
      }
    }
    socket.emit('onlineFriends', { friends: onlineFriends });

    // Присоединение к каналу
    socket.on('joinChannel', (channelId) => {
      socket.join(`channel:${channelId}`);
    });

    socket.on('leaveChannel', (channelId) => {
      socket.leave(`channel:${channelId}`);
    });

    // Печать
    socket.on('typingStart', (channelId) => {
      socket.to(`channel:${channelId}`).emit('userTyping', { channelId, userId: user.id, username: user.username });
    });

    socket.on('typingStop', (channelId) => {
      socket.to(`channel:${channelId}`).emit('userStoppedTyping', { channelId, userId: user.id });
    });

    // Статус
    socket.on('setStatus', (status) => {
      const valid = ['online', 'idle', 'dnd', 'offline'];
      if (valid.includes(status)) {
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
        const friends = db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(user.id);
        for (const f of friends) {
          io.to(`user:${f.friend_id}`).emit('userStatus', { userId: user.id, username: user.username, status });
        }
      }
    });

    // Звонки P2P
    socket.on('callUser', (data) => {
      io.to(`user:${data.targetUserId}`).emit('incomingCall', {
        from: { id: user.id, username: user.username, display_name: user.display_name, avatar: user.avatar },
        callType: data.callType || 'voice',
        socketId: socket.id
      });
    });

    socket.on('callAccepted', (data) => {
      io.to(`user:${data.targetUserId}`).emit('callAccepted', {
        from: { id: user.id, username: user.username },
        socketId: socket.id,
        callType: data.callType
      });
    });

    socket.on('callRejected', (data) => {
      io.to(`user:${data.targetUserId}`).emit('callRejected', {
        from: { id: user.id, username: user.username }
      });
    });

    socket.on('callEnded', (data) => {
      io.to(`user:${data.targetUserId}`).emit('callEnded', {
        from: { id: user.id, username: user.username }
      });
    });

    // WebRTC сигналинг
    socket.on('callSignal', (data) => {
      io.to(`user:${data.targetUserId}`).emit('callSignal', {
        fromUserId: user.id,
        fromUsername: user.username,
        signal: data.signal,
        callId: data.callId
      });
    });

    // Отключение
    socket.on('disconnect', () => {
      console.log(`❌ ${user.username} отключился`);

      const userId = userSockets.get(socket.id);
      if (userId && onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        if (onlineUsers.get(userId).size === 0) {
          onlineUsers.delete(userId);
          db.prepare('UPDATE users SET status = ?, last_seen = datetime(\'now\') WHERE id = ?').run('offline', user.id);

          const friends = db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(user.id);
          for (const f of friends) {
            io.to(`user:${f.friend_id}`).emit('userStatus', { userId: user.id, username: user.username, status: 'offline' });
          }
        }
      }
      userSockets.delete(socket.id);
    });
  });
};
