"""
Пример бота для Stasya Messenger
Использует HTTP API для отправки сообщений

Установка: pip install requests flask
"""

import requests
import time
from flask import Flask, request, jsonify

# Конфигурация
BASE_URL = "https://your-stasya-app.onrender.com"  # Замените на ваш URL
BOT_TOKEN = "stasya_bot_your_token_here"  # Токен бота

app = Flask(__name__)

def send_message(channel_id, content=None, embed=None):
    """Отправка сообщения в канал"""
    headers = {
        "X-Bot-Token": BOT_TOKEN,
        "Content-Type": "application/json"
    }
    
    data = {}
    if content:
        data["content"] = content
    if embed:
        data["embed"] = embed
    
    response = requests.post(
        f"{BASE_URL}/api/messages/bot/{channel_id}",
        headers=headers,
        json=data
    )
    
    return response.json()

# ===== Примеры команд =====

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "name": "Stasya Bot Example",
        "version": "1.0.0",
        "commands": ["/ping", "/time", "/weather", "/embed"]
    })

@app.route("/ping", methods=["GET"])
def ping():
    return jsonify({"response": "pong! 🏓"})

@app.route("/time", methods=["GET"])
def current_time():
    from datetime import datetime
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return jsonify({"response": f"Текущее время: {now}"})

@app.route("/embed", methods=["GET"])
def embed_example():
    return jsonify({
        "embed": {
            "title": "Пример Embed сообщения",
            "description": "Это красивое embed-сообщение от бота",
            "color": "#6C5CE7",
            "fields": [
                {"name": "Поле 1", "value": "Значение 1", "inline": True},
                {"name": "Поле 2", "value": "Значение 2", "inline": True}
            ],
            "footer": "Stasya Messenger Bot API"
        }
    })

# ===== Автономный режим (без Flask) =====

def standalone_bot():
    """Пример бота без веб-сервера"""
    print("🤖 Бот запущен!")
    
    # Отправка простого сообщения
    result = send_message(
        channel_id="CHANNEL_ID_HERE",
        content="Привет! Я бот Stasya Messenger! 🚀"
    )
    print(f"Сообщение отправлено: {result}")
    
    # Отправка embed
    embed_result = send_message(
        channel_id="CHANNEL_ID_HERE",
        embed={
            "title": "Информация",
            "description": "Я могу отправлять красивые сообщения!",
            "color": "#6C5CE7",
            "footer": "Stasya Bot v1.0"
        }
    )
    print(f"Embed отправлен: {embed_result}")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        # Запуск как веб-сервер
        app.run(host="0.0.0.0", port=5000)
    else:
        # Автономный режим
        standalone_bot()
