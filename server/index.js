require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const { db, DATA_PATH, DB_PATH } = require('./database');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Слишком много запросов' }
});
app.use('/api/', limiter);

// Статические файлы
app.use('/uploads', express.static(DATA_PATH));

// WebSocket
const io = new Server(server, {
  cors: { origin: process.env.NODE_ENV === 'production' ? false : '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.set('io', io);
app.set('dataPath', DATA_PATH);

require('./ws/socketHandler')(io, DATA_PATH);

// API маршруты
const { router: authRouter } = require('./routes/auth');
app.use('/api/auth', authRouter);
app.use('/api/users', require('./routes/users'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/bots', require('./routes/bots'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/upload', require('./routes/upload'));

// Клиент в production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
  });
}

// Запуск
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stasya Messenger запущен на порту ${PORT}`);
  console.log(`📁 Данные: ${DATA_PATH}`);
  console.log(`🗄️ База данных: ${DB_PATH}`);
  console.log(`✅ SQLite готов, Render Disk не требуется отдельно!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Завершение...');
  db.close();
  server.close(() => process.exit(0));
});

module.exports = { app, server, io };
