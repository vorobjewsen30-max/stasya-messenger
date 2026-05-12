# 🚀 Деплой Stasya Messenger на Render

## Шаг 1: Подготовка MongoDB Atlas

1. Иди на https://www.mongodb.com/atlas
2. Создай бесплатный кластер (Free Tier)
3. Создай пользователя БД (Database Access)
4. Добавь свой IP в Network Access (или 0.0.0.0/0 для всех)
5. Получи строку подключения:
   ```
   mongodb+srv://user:password@cluster.mongodb.net/stasya-messenger?retryWrites=true&w=majority
   ```

## Шаг 2: Деплой на Render

### Вариант А: Через render.yaml (Blueprint)

1. Залей проект на GitHub
2. На Render нажми "New" → "Blueprint"
3. Подключи репозиторий
4. Render сам создаст Web Service + Disk

### Вариант Б: Вручную

1. На Render нажми "New" → "Web Service"
2. Подключи GitHub репозиторий
3. Настройки:
   - **Name**: stasya-messenger
   - **Region**: Frankfurt (или ближайший)
   - **Branch**: main
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Starter ($7/мес) или Free

4. Добавь **Render Disk**:
   - Нажми "Add Disk"
   - Name: `stasya-data`
   - Mount Path: `/var/data`
   - Size: 1 GB (бесплатно)

5. Добавь **Environment Variables**:
   ```
   NODE_ENV=production
   PORT=3000
   MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/stasya-messenger?retryWrites=true&w=majority
   JWT_SECRET=твой-супер-секретный-ключ-минимум-32-символа
   RENDER_DISK_PATH=/var/data
   ```

6. Нажми "Create Web Service"

## Шаг 3: Проверка

После деплоя открой URL сервиса. Ты должен увидеть страницу входа Stasya Messenger.

### Проверка API:
```bash
# Регистрация
curl -X POST https://your-app.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@admin.com","password":"admin123"}'

# Вход
curl -X POST https://your-app.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'
```

## Шаг 4: Создание бота

1. Войди в мессенджер
2. Используй API для создания бота:
```bash
curl -X POST https://your-app.onrender.com/api/bots/create \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"mybot","displayName":"Мой Бот"}'
```

3. Сохрани полученный токен бота
4. Используй примеры из папки `examples/`

## Важно!

- Render Disk доступен только на платном плане ($7/мес)
- Бесплатный план Render: сервис засыпает после 15 мин неактивности
- Для продакшена используй сложный JWT_SECRET
- Файлы на Render Disk сохраняются между деплоями
- MongoDB Atlas бесплатный кластер: 512 MB
