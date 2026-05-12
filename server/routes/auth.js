const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth, generateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    // Валидация
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 30 символов' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Имя пользователя может содержать только буквы, цифры и _' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    // Проверка существования
    const existingUser = await User.findOne({ 
      $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }] 
    });

    if (existingUser) {
      if (existingUser.username === username.toLowerCase()) {
        return res.status(400).json({ error: 'Имя пользователя уже занято' });
      }
      return res.status(400).json({ error: 'Email уже используется' });
    }

    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      displayName: displayName || username,
      status: 'online',
      lastSeen: new Date()
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// Вход
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    // Ищем по username или email
    const user = await User.findOne({
      $or: [
        { username: login.toLowerCase() },
        { email: login.toLowerCase() }
      ]
    });

    if (!user) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    // Обновляем статус
    user.status = 'online';
    user.lastSeen = new Date();
    await user.save();

    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// Получить текущего пользователя
router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user.toJSON() });
});

// Обновить профиль
router.patch('/me', auth, async (req, res) => {
  try {
    const updates = {};
    const allowedUpdates = ['displayName', 'bio', 'customStatus', 'avatar'];
    
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true }
    ).select('-password -botToken');

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// Выход
router.post('/logout', auth, async (req, res) => {
  try {
    req.user.status = 'offline';
    req.user.lastSeen = new Date();
    await req.user.save();
    res.json({ message: 'Вы вышли из системы' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при выходе' });
  }
});

module.exports = router;
