const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Создать бота
router.post('/create', auth, async (req, res) => {
  try {
    const { username, displayName } = req.body;

    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Имя бота должно быть не менее 3 символов' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Имя бота может содержать только буквы, цифры и _' });
    }

    const botUsername = `bot_${username.toLowerCase()}`;
    
    const existing = await User.findOne({ username: botUsername });
    if (existing) {
      return res.status(400).json({ error: 'Бот с таким именем уже существует' });
    }

    const botToken = `stasya_bot_${uuidv4().replace(/-/g, '')}`;

    const bot = new User({
      username: botUsername,
      email: `${botUsername}@bots.stasya.local`,
      password: uuidv4(),
      displayName: displayName || `🤖 ${username}`,
      isBot: true,
      botToken,
      botOwner: req.user._id,
      status: 'online'
    });

    await bot.save();

    res.status(201).json({
      bot: bot.toJSON(),
      token: botToken
    });
  } catch (error) {
    console.error('Ошибка создания бота:', error);
    res.status(500).json({ error: 'Ошибка создания бота' });
  }
});

// Список ботов пользователя
router.get('/my', auth, async (req, res) => {
  try {
    const bots = await User.find({
      isBot: true,
      botOwner: req.user._id
    }).select('-password');

    res.json({ bots });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения ботов' });
  }
});

// Регенерировать токен бота
router.post('/:botId/regenerate-token', auth, async (req, res) => {
  try {
    const bot = await User.findOne({
      _id: req.params.botId,
      isBot: true,
      botOwner: req.user._id
    });

    if (!bot) {
      return res.status(404).json({ error: 'Бот не найден' });
    }

    bot.botToken = `stasya_bot_${uuidv4().replace(/-/g, '')}`;
    await bot.save();

    res.json({ token: bot.botToken });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления токена' });
  }
});

// Удалить бота
router.delete('/:botId', auth, async (req, res) => {
  try {
    const bot = await User.findOneAndDelete({
      _id: req.params.botId,
      isBot: true,
      botOwner: req.user._id
    });

    if (!bot) {
      return res.status(404).json({ error: 'Бот не найден' });
    }

    res.json({ message: 'Бот удалён' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления бота' });
  }
});

// Информация о боте (публичная)
router.get('/:botId', auth, async (req, res) => {
  try {
    const bot = await User.findOne({
      _id: req.params.botId,
      isBot: true
    }).select('username displayName avatar isBot status createdAt');

    if (!bot) {
      return res.status(404).json({ error: 'Бот не найден' });
    }

    res.json({ bot });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения информации о боте' });
  }
});

module.exports = router;
