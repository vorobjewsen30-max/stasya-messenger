# Stasya Messenger - Полноценный мессенджер

Современный мессенджер с функциями как у Discord:
- 💬 Текстовые чаты и личные сообщения
- 📞 Голосовые и видео звонки (WebRTC)
- 🤖 API для создания ботов
- 👥 Каналы, группы, DM
- 🔐 JWT аутентификация
- 😀 Реакции на сообщения
- 📌 Закрепление сообщений
- 🔗 Инвайт-коды
- 🎨 Тёмная тема
- 📁 Загрузка файлов

## Быстрый старт

### Установка
```bash
npm install
```

### Настройка
Создайте файл `.env`:
```
PORT=3000
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_secret_key
```

### Запуск
```bash
# Разработка
npm run dev

# Продакшн
npm start
```

## API для ботов

### Создание бота
```http
POST /api/bots/create
Authorization: Bearer <user_token>
Content-Type: application/json

{
  "username": "mybot",
  "displayName": "Мой Бот"
}
```

### Отправка сообщения ботом
```http
POST /api/messages/bot/:channelId
X-Bot-Token: <bot_token>
Content-Type: application/json

{
  "content": "Привет от бота!",
  "embed": {
    "title": "Заголовок",
    "description": "Описание",
    "color": "#6C5CE7"
  }
}
```

## Деплой на Render

1. Создайте Web Service
2. Подключите репозиторий
3. Добавьте Render Disk (путь: `/var/data`)
4. Установите переменные окружения:
   - `MONGODB_URI` - строка подключения MongoDB
   - `JWT_SECRET` - секретный ключ
   - `RENDER_DISK_PATH=/var/data`
   - `NODE_ENV=production`
5. Build Command: `npm run build`
6. Start Command: `npm start`

## Технологии

- **Backend**: Node.js, Express, Socket.IO, MongoDB/Mongoose
- **Frontend**: React 18, React Router
- **Real-time**: WebSocket (Socket.IO)
- **Звонки**: WebRTC (simple-peer)
- **Auth**: JWT + bcrypt
