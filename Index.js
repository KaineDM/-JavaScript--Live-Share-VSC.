const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
require("dotenv").config()

const connectDB = require("./config/database")
const authRoutes = require("./routes/auth")
const taskRoutes = require("./routes/tasks")
const userRoutes = require("./routes/users")
const socketHandler = require("./socket/socketHandler")

// Инициализация Express приложения
const app = express()
const server = http.createServer(app)

// Настройка Socket.IO с поддержкой CORS
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
})

// Подключение к базе данных
connectDB()

// Middleware для безопасности
app.use(helmet())

// Rate limiting для предотвращения DDoS атак
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP
  message: "Слишком много запросов с этого IP, попробуйте позже.",
})
app.use(limiter)

// CORS настройки
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
)

// Парсинг JSON
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Логирование запросов в development режиме
if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
    next()
  })
}

// API маршруты
app.use("/api/auth", authRoutes)
app.use("/api/tasks", taskRoutes)
app.use("/api/users", userRoutes)

// Обработка Socket.IO соединений
socketHandler(io)

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error("Ошибка сервера:", err.stack)
  res.status(500).json({
    message: "Внутренняя ошибка сервера",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  })
})

// Обработка несуществующих маршрутов
app.use("*", (req, res) => {
  res.status(404).json({ message: "Маршрут не найден" })
})

const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`)
  console.log(`📊 Режим: ${process.env.NODE_ENV || "development"}`)
  console.log(`🔗 Socket.IO готов к подключениям`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM получен, завершение работы сервера...")
  server.close(() => {
    console.log("Сервер остановлен")
    process.exit(0)
  })
})

module.exports = app
