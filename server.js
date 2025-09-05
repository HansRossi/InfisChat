const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// PostgreSQL - улучшенная конфигурация
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const pool = new Pool(poolConfig);

// Проверка подключения к базе данных
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to database successfully');
    release();
  }
});

// Создание таблицы, если она не существует
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Messages table ready');
  } catch (err) {
    console.error('Error creating table:', err);
  }
})();

app.use(express.static("public"));

// Список активных пользователей по комнатам
const activeUsers = {};

io.on("connection", (socket) => {
  console.log("New user connected");

  // Пользователь заходит в чат
  socket.on("joinChat", async (chat, username) => {
    try {
      socket.join(chat);
      socket.username = username;
      socket.chat = chat;

      if (!activeUsers[chat]) activeUsers[chat] = [];
      if (!activeUsers[chat].includes(username)) {
        activeUsers[chat].push(username);
      }

      // Отправляем список активных пользователей
      io.to(chat).emit("updateUsers", activeUsers[chat]);

      // Загружаем историю сообщений
      const res = await pool.query(
        "SELECT * FROM messages WHERE chat=$1 ORDER BY timestamp ASC",
        [chat]
      );
      socket.emit("loadMessages", res.rows);
      
      // Уведомляем о новом пользователе
      socket.to(chat).emit("userJoined", username);
    } catch (err) {
      console.error('Error joining chat:', err);
    }
  });

  // Новое сообщение
  socket.on("sendMessage", async ({ chat, username, message }) => {
    try {
      // Сохраняем сообщение в БД
      const res = await pool.query(
        "INSERT INTO messages (chat, username, message) VALUES ($1,$2,$3) RETURNING *",
        [chat, username, message]
      );

      // Отправляем всем в комнате
      io.to(chat).emit("newMessage", res.rows[0]);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  });

  // Изменение имени пользователя
  socket.on("changeUsername", async ({ oldUsername, newUsername }) => {
    try {
      const chat = socket.chat;
      
      // Обновляем имя в активных пользователях
      if (chat && activeUsers[chat]) {
        const index = activeUsers[chat].indexOf(oldUsername);
        if (index !== -1) {
          activeUsers[chat][index] = newUsername;
        }
      }
      
      // Обновляем имя в сообщениях БД
      await pool.query(
        "UPDATE messages SET username=$1 WHERE username=$2 AND chat=$3",
        [newUsername, oldUsername, chat]
      );
      
      socket.username = newUsername;
      io.to(chat).emit("usernameChanged", { oldUsername, newUsername });
      io.to(chat).emit("updateUsers", activeUsers[chat]);
    } catch (err) {
      console.error('Error changing username:', err);
    }
  });

  // Пользователь покидает чат
  socket.on("leaveChat", () => {
    const chat = socket.chat;
    const username = socket.username;

    if (chat && activeUsers[chat]) {
      activeUsers[chat] = activeUsers[chat].filter(u => u !== username);
      io.to(chat).emit("updateUsers", activeUsers[chat]);
      socket.to(chat).emit("userLeft", username);
    }

    socket.leave(chat);
  });

  // Пользователь отключился
  socket.on("disconnect", () => {
    const chat = socket.chat;
    const username = socket.username;

    if (chat && activeUsers[chat]) {
      activeUsers[chat] = activeUsers[chat].filter(u => u !== username);
      io.to(chat).emit("updateUsers", activeUsers[chat]);
      socket.to(chat).emit("userLeft", username);
    }

    console.log("User disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});