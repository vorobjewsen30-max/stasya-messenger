# 🔧 Подключение MongoDB к Stasya Messenger

## Вариант 1: MongoDB Atlas (Бесплатно, облако)

### Шаг 1: Регистрация
1. Иди на https://www.mongodb.com/cloud/atlas/register
2. Зарегистрируйся (можно через Google/GitHub)
3. Ответь на вопросы (цель: "Build a new app", язык: JavaScript)

### Шаг 2: Создание кластера
1. Выбери **FREE** план (M0 Sandbox)
2. Провайдер: AWS, регион: Frankfurt (или ближайший)
3. Нажми "Create Deployment"

### Шаг 3: Настройка доступа
1. В левом меню → **Database Access**
2. "Add New Database User"
3. Выбери **Password** (не Certificate)
4. Логин: `stasya_admin`
5. Пароль: придумай сложный (сохрани!)
6. Privileges: **Atlas admin**
7. Нажми "Add User"

### Шаг 4: Сетевой доступ
1. В левом меню → **Network Access**
2. "Add IP Address"
3. Нажми **"Allow Access from Anywhere"** (0.0.0.0/0)
4. Или добавь "Current IP Address" + IP Render

### Шаг 5: Получение строки подключения
1. В левом меню → **Database** (или "Overview")
2. Нажми кнопку **"Connect"** на кластере
3. Выбери **"Drivers"** (или "Connect your application")
4. Скопируй строку, она выглядит так:
```
mongodb+srv://stasya_admin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```
5. Замени `<password>` на свой пароль
6. Добавь название БД перед `?`:
```
mongodb+srv://stasya_admin:ТВОЙ_ПАРОЛЬ@cluster0.xxxxx.mongodb.net/stasya-messenger?retryWrites=true&w=majority
```

### Шаг 6: Указать в Render
Добавь переменную окружения в Render:
```
MONGODB_URI=mongodb+srv://stasya_admin:ТВОЙ_ПАРОЛЬ@cluster0.xxxxx.mongodb.net/stasya-messenger?retryWrites=true&w=majority
```

---

## Вариант 2: Локальная MongoDB (для тестов)

### Установка на Windows:
```powershell
# Скачай и установи MongoDB Community Server:
# https://www.mongodb.com/try/download/community
```

### После установки строка подключения:
```
MONGODB_URI=mongodb://localhost:27017/stasya-messenger
```

---

## Проверка подключения

После добавления MONGODB_URI в Render, сервер сам подключится.
В логах Render ты увидишь:
```
✅ MongoDB подключена
🚀 Stasya Messenger запущен на порту 3000
```
