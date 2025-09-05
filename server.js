const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// PostgreSQL
const pool = new Pool({
  user: "postgres",       // твой логин
  host: "localhost",
  database: "infis_chat", // название базы
  password: "password",   // пароль к Postgres
  port: 5431,             // порт PostgreSQL
});

app.use(express.static("public")); // папка с HTML/CSS/JS

// Список активных пользователей по комнатам
const activeUsers = {}; // { roomName: [username1, username2, ...] }

io.on("connection", (socket) => {
  console.log("New user connected");

  // Пользователь заходит в чат
  socket.on("joinChat", async (chat, username) => {
    socket.join(chat);
    socket.username = username;
    socket.chat = chat;

    if (!activeUsers[chat]) activeUsers[chat] = [];
    if (!activeUsers[chat].includes(username)) activeUsers[chat].push(username);

    // Отправляем список активных пользователей всем в комнате
    io.to(chat).emit("updateUsers", activeUsers[chat]);

    // Отправляем все старые сообщения из БД
    const res = await pool.query(
      "SELECT * FROM messages WHERE chat=$1 ORDER BY timestamp ASC",
      [chat]
    );
    socket.emit("loadMessages", res.rows);
  });

  // Новый сообщение
  socket.on("sendMessage", async ({ chat, username, message }) => {
    // Сохраняем сообщение в БД
    const res = await pool.query(
      "INSERT INTO messages (chat, username, message) VALUES ($1,$2,$3) RETURNING *",
      [chat, username, message]
    );

    // Отправляем всем в комнате
    io.to(chat).emit("newMessage", res.rows[0]);
  });

  // Пользователь покидает чат
  socket.on("leaveChat", () => {
    const chat = socket.chat;
    const username = socket.username;

    if (chat && activeUsers[chat]) {
      activeUsers[chat] = activeUsers[chat].filter(u => u !== username);
      io.to(chat).emit("updateUsers", activeUsers[chat]);
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
    }

    console.log("User disconnected");
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});