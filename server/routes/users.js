const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Поиск пользователей
router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }

    const users = await User.find({
      $and: [
        {
          $or: [
            { username: { $regex: q, $options: 'i' } },
            { displayName: { $regex: q, $options: 'i' } }
          ]
        },
        { _id: { $ne: req.user._id } }
      ]
    })
    .select('username displayName avatar status customStatus')
    .limit(20);

    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// Получить пользователя по username
router.get('/:username', auth, async (req, res) => {
  try {
    const user = await User.findOne({ 
      username: req.params.username.toLowerCase() 
    }).select('-password -botToken -email');

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ user: user.toJSON() });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения пользователя' });
  }
});

// Друзья
router.get('/:id/friends', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('friends', 'username displayName avatar status customStatus');
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ friends: user.friends });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения друзей' });
  }
});

// Отправить запрос в друзья
router.post('/friend-request/:userId', auth, async (req, res) => {
  try {
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
    }

    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверка на блокировку
    if (targetUser.blocked.includes(req.user._id)) {
      return res.status(403).json({ error: 'Вы заблокированы этим пользователем' });
    }

    // Уже друзья?
    if (targetUser.friends.includes(req.user._id)) {
      return res.status(400).json({ error: 'Вы уже друзья' });
    }

    // Уже отправлен запрос?
    const existingRequest = targetUser.friendRequests.find(
      r => r.from.toString() === req.user._id.toString()
    );
    if (existingRequest) {
      return res.status(400).json({ error: 'Запрос уже отправлен' });
    }

    targetUser.friendRequests.push({ from: req.user._id });
    await targetUser.save();

    // Уведомление через WebSocket
    const io = req.app.get('io');
    io.to(`user:${targetUser._id}`).emit('friendRequest', {
      from: {
        _id: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      }
    });

    res.json({ message: 'Запрос отправлен' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка отправки запроса' });
  }
});

// Принять запрос в друзья
router.post('/friend-request/:userId/accept', auth, async (req, res) => {
  try {
    const requestIndex = req.user.friendRequests.findIndex(
      r => r.from.toString() === req.params.userId
    );

    if (requestIndex === -1) {
      return res.status(404).json({ error: 'Запрос не найден' });
    }

    const friendUser = await User.findById(req.params.userId);
    if (!friendUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Добавляем друг друга
    req.user.friends.push(friendUser._id);
    friendUser.friends.push(req.user._id);

    // Удаляем запрос
    req.user.friendRequests.splice(requestIndex, 1);

    await req.user.save();
    await friendUser.save();

    // Уведомление
    const io = req.app.get('io');
    io.to(`user:${friendUser._id}`).emit('friendAccepted', {
      user: {
        _id: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      }
    });

    res.json({ message: 'Запрос принят', friend: friendUser.toJSON() });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка принятия запроса' });
  }
});

// Отклонить запрос
router.post('/friend-request/:userId/reject', auth, async (req, res) => {
  try {
    req.user.friendRequests = req.user.friendRequests.filter(
      r => r.from.toString() !== req.params.userId
    );
    await req.user.save();
    res.json({ message: 'Запрос отклонён' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка отклонения запроса' });
  }
});

// Удалить из друзей
router.delete('/friend/:userId', auth, async (req, res) => {
  try {
    req.user.friends = req.user.friends.filter(
      f => f.toString() !== req.params.userId
    );
    await req.user.save();

    await User.findByIdAndUpdate(req.params.userId, {
      $pull: { friends: req.user._id }
    });

    res.json({ message: 'Пользователь удалён из друзей' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления из друзей' });
  }
});

// Заблокировать
router.post('/block/:userId', auth, async (req, res) => {
  try {
    if (!req.user.blocked.includes(req.params.userId)) {
      req.user.blocked.push(req.params.userId);
      // Удаляем из друзей если есть
      req.user.friends = req.user.friends.filter(
        f => f.toString() !== req.params.userId
      );
      await req.user.save();
    }
    res.json({ message: 'Пользователь заблокирован' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка блокировки' });
  }
});

module.exports = router;
