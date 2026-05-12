# 🚀 Деплой Stasya Messenger на Render (SQLite)

## Никакой MongoDB не нужен! База данных — SQLite на Render Disk.

## Шаг 1: Залей на GitHub
```bash
git remote add origin https://github.com/ТВОЙ-АККАУНТ/stasya-messenger.git
git push -u origin master
```

## Шаг 2: Деплой на Render

1. Иди на https://dashboard.render.com
2. "New" → "Web Service"
3. Подключи GitHub репозиторий
4. Настройки:
   - **Name**: stasya-messenger
   - **Region**: Frankfurt
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Starter ($7/мес, нужен для Render Disk)

5. **Добавь Render Disk** (важно!):
   - Name: `stasya-data`
   - Mount Path: `/var/data`
   - Size: 1 GB

6. **Environment Variables**:
   ```
   NODE_ENV=production
   PORT=3000
   JWT_SECRET=твой-супер-секретный-ключ
   RENDER_DISK_PATH=/var/data
   ```

7. Нажми "Create Web Service"

## Готово! 🎉

Сервер сам создаст `stasya.db` на Render Disk.
Все данные (пользователи, сообщения, каналы) хранятся в одном файле SQLite.

### Проверка:
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

### Преимущества SQLite:
- ✅ Не нужен MongoDB Atlas
- ✅ Один файл на Render Disk
- ✅ Данные сохраняются между деплоями
- ✅ Быстро, без задержек сети
- ✅ 1 GB диска хватит на ~100K сообщений
