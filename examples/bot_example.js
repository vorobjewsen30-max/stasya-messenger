/**
 * Пример бота для Stasya Messenger на Node.js
 * 
 * Установка: npm install axios
 * Запуск: node bot_example.js
 */

const axios = require('axios');

// Конфигурация
const BASE_URL = 'https://your-stasya-app.onrender.com'; // Замените на ваш URL
const BOT_TOKEN = 'stasya_bot_your_token_here'; // Токен бота

// Отправка сообщения
async function sendMessage(channelId, content, embed = null) {
  try {
    const response = await axios.post(
      `${BASE_URL}/api/messages/bot/${channelId}`,
      { content, embed },
      {
        headers: {
          'X-Bot-Token': BOT_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Ошибка отправки:', error.response?.data || error.message);
    return null;
  }
}

// Примеры использования
async function main() {
  console.log('🤖 Бот Stasya Messenger запущен!\n');

  const CHANNEL_ID = 'YOUR_CHANNEL_ID'; // Замените на ID канала

  // 1. Простое сообщение
  await sendMessage(CHANNEL_ID, 'Привет всем! Я бот на Node.js 🚀');

  // 2. Embed сообщение
  await sendMessage(CHANNEL_ID, null, {
    title: '📊 Статистика сервера',
    description: 'Информация о состоянии системы',
    color: '#6C5CE7',
    fields: [
      { name: 'CPU', value: '45%', inline: true },
      { name: 'RAM', value: '8.2 GB / 16 GB', inline: true },
      { name: 'Uptime', value: '7 дней', inline: true }
    ],
    footer: 'Stasya Bot • Обновлено только что'
  });

  // 3. Сообщение с эмодзи
  const emojis = ['🎉', '✨', '💜', '🌟', '🎮'];
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  await sendMessage(CHANNEL_ID, `Случайный эмодзи: ${randomEmoji}`);

  console.log('✅ Все сообщения отправлены!');
}

// Запуск
main().catch(console.error);
