const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'stasya-super-secret-key-change-in-production-2024';

// Middleware для проверки JWT токена
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -botToken');

    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
};

// Middleware для проверки бот-токена
const botAuth = async (req, res, next) => {
  try {
    const botToken = req.header('X-Bot-Token') || req.query.bot_token;
    
    if (!botToken) {
      return res.status(401).json({ error: 'Требуется бот-токен' });
    }

    const bot = await User.findOne({ botToken, isBot: true }).select('-password');

    if (!bot) {
      return res.status(401).json({ error: 'Бот не найден' });
    }

    req.bot = bot;
    req.isBot = true;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Недействительный бот-токен' });
  }
};

// Генерация JWT токена
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
};

module.exports = { auth, botAuth, generateToken, JWT_SECRET };
