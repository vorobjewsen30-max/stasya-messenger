const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

// Хранилище активных соединений
const onlineUsers = new Map(); // userId -> Set<socketId>
const userSockets = new Map(); // socketId -> userId

module.exports = (io, dataPath) => {
  // Middleware для аутентификации WebSocket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                    socket.handshake.query.token;

      if (!token) {
        return next(new Error('Требуется авторизация'));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password -botToken');

      if (!user) {
        return next(new Error('Пользователь не найден'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Недействительный токен'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`✅ ${user.username} подключился (${socket.id})`);

    // Сохраняем соединение
    if (!onlineUsers.has(user._id.toString())) {
      onlineUsers.set(user._id.toString(), new Set());
    }
    onlineUsers.get(user._id.toString()).add(socket.id);
    userSockets.set(socket.id, user._id.toString());

    // Обновляем статус
    await User.findByIdAndUpdate(user._id, { 
      status: 'online',
      lastSeen: new Date()
    });

    // Присоединяем к персональной комнате
    socket.join(`user:${user._id}`);

    // Оповещаем друзей о входе
    const userWithFriends = await User.findById(user._id).populate('friends', '_id');
    if (userWithFriends?.friends) {
      userWithFriends.friends.forEach(friend => {
        io.to(`user:${friend._id}`).emit('userStatus', {
          userId: user._id,
          username: user.username,
          status: 'online'
        });
      });
    }

    // Отправляем список онлайн-друзей
    const onlineFriends = [];
    if (userWithFriends?.friends) {
      for (const friend of userWithFriends.friends) {
        if (onlineUsers.has(friend._id.toString())) {
          const friendUser = await User.findById(friend._id)
            .select('username displayName avatar status customStatus');
          if (friendUser) {
            onlineFriends.push(friendUser);
          }
        }
      }
    }
    socket.emit('onlineFriends', { friends: onlineFriends });

    // ===== Обработчики событий =====

    // Присоединение к каналу
    socket.on('joinChannel', (channelId) => {
      socket.join(`channel:${channelId}`);
      console.log(`${user.username} присоединился к каналу ${channelId}`);
    });

    // Выход из канала
    socket.on('leaveChannel', (channelId) => {
      socket.leave(`channel:${channelId}`);
    });

    // Начало печати
    socket.on('typingStart', (channelId) => {
      socket.to(`channel:${channelId}`).emit('userTyping', {
        channelId,
        userId: user._id,
        username: user.username
      });
    });

    // Конец печати
    socket.on('typingStop', (channelId) => {
      socket.to(`channel:${channelId}`).emit('userStoppedTyping', {
        channelId,
        userId: user._id
      });
    });

    // WebRTC сигналинг
    socket.on('callSignal', (data) => {
      const { targetUserId, signal, callId } = data;
      io.to(`user:${targetUserId}`).emit('callSignal', {
        fromUserId: user._id,
        fromUsername: user.username,
        signal,
        callId
      });
    });

    // Обновление статуса
    socket.on('setStatus', async (status) => {
      const validStatuses = ['online', 'idle', 'dnd', 'offline'];
      if (validStatuses.includes(status)) {
        await User.findByIdAndUpdate(user._id, { status });
        
        const userWithFriends = await User.findById(user._id).populate('friends', '_id');
        if (userWithFriends?.friends) {
          userWithFriends.friends.forEach(friend => {
            io.to(`user:${friend._id}`).emit('userStatus', {
              userId: user._id,
              username: user.username,
              status
            });
          });
        }
      }
    });

    // Прямой звонок другу (P2P)
    socket.on('callUser', (data) => {
      const { targetUserId, callType = 'voice' } = data;
      io.to(`user:${targetUserId}`).emit('incomingCall', {
        from: {
          _id: user._id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar
        },
        callType,
        socketId: socket.id
      });
    });

    socket.on('callAccepted', (data) => {
      const { targetUserId, callType } = data;
      io.to(`user:${targetUserId}`).emit('callAccepted', {
        from: {
          _id: user._id,
          username: user.username
        },
        socketId: socket.id,
        callType
      });
    });

    socket.on('callRejected', (data) => {
      const { targetUserId } = data;
      io.to(`user:${targetUserId}`).emit('callRejected', {
        from: {
          _id: user._id,
          username: user.username
        }
      });
    });

    socket.on('callEnded', (data) => {
      const { targetUserId } = data;
      io.to(`user:${targetUserId}`).emit('callEnded', {
        from: {
          _id: user._id,
          username: user.username
        }
      });
    });

    // Отключение
    socket.on('disconnect', async () => {
      console.log(`❌ ${user.username} отключился (${socket.id})`);

      // Убираем сокет из хранилища
      const userId = userSockets.get(socket.id);
      if (userId && onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        
        // Если нет других соединений, ставим offline
        if (onlineUsers.get(userId).size === 0) {
          onlineUsers.delete(userId);
          
          await User.findByIdAndUpdate(user._id, {
            status: 'offline',
            lastSeen: new Date()
          });

          // Оповещаем друзей
          const userWithFriends = await User.findById(user._id).populate('friends', '_id');
          if (userWithFriends?.friends) {
            userWithFriends.friends.forEach(friend => {
              io.to(`user:${friend._id}`).emit('userStatus', {
                userId: user._id,
                username: user.username,
                status: 'offline'
              });
            });
          }
        }
      }

      userSockets.delete(socket.id);
    });
  });
};
