require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Определяем путь для Render Disk
const DATA_PATH = process.env.RENDER_DISK_PATH || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api/', limiter);

// Статические файлы (аватары, файлы)
app.use('/uploads', express.static(DATA_PATH));

// WebSocket setup
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Делаем io доступным для маршрутов
app.set('io', io);
app.set('dataPath', DATA_PATH);

// Подключаем WebSocket обработчики
require('./ws/socketHandler')(io, DATA_PATH);

// Подключаем маршруты API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/bots', require('./routes/bots'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/upload', require('./routes/upload'));

// Обслуживаем клиент в production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
  });
}

// Подключение к MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stasya-messenger';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB подключена');
    
    // Запуск сервера
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Stasya Messenger запущен на порту ${PORT}`);
      console.log(`📁 Данные хранятся в: ${DATA_PATH}`);
    });
  })
  .catch(err => {
    console.error('❌ Ошибка подключения к MongoDB:', err.message);
    // Запускаем даже без БД для тестов
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Stasya Messenger запущен на порту ${PORT} (без БД)`);
    });
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM получен, закрываем...');
  server.close(() => {
    mongoose.connection.close(false);
    process.exit(0);
  });
});

module.exports = { app, server, io };
