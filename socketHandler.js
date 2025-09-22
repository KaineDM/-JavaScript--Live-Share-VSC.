const jwt = require("jsonwebtoken")
const User = require("../models/User")

// Хранилище активных пользователей
const activeUsers = new Map()
const userSessions = new Map()

// Middleware для аутентификации Socket.IO соединений
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token

    if (!token) {
      return next(new Error("Токен аутентификации не предоставлен"))
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id).select("-password")

    if (!user || !user.isActive) {
      return next(new Error("Пользователь не найден или неактивен"))
    }

    socket.user = user
    next()
  } catch (error) {
    next(new Error("Недействительный токен аутентификации"))
  }
}

const socketHandler = (io) => {
  // Применяем middleware аутентификации
  io.use(authenticateSocket)

  io.on("connection", (socket) => {
    console.log(`👤 Пользователь подключен: ${socket.user.name} (${socket.user.email})`)

    // Добавляем пользователя в список активных
    activeUsers.set(socket.user.id, {
      id: socket.user.id,
      name: socket.user.name,
      email: socket.user.email,
      avatar: socket.user.avatar,
      socketId: socket.id,
      connectedAt: new Date(),
      status: "online",
    })

    // Сохраняем сессию пользователя
    if (!userSessions.has(socket.user.id)) {
      userSessions.set(socket.user.id, new Set())
    }
    userSessions.get(socket.user.id).add(socket.id)

    // Присоединяем к персональной комнате
    socket.join(`user_${socket.user.id}`)

    // Уведомляем всех о новом подключении
    socket.broadcast.emit("userConnected", {
      user: activeUsers.get(socket.user.id),
      timestamp: new Date(),
    })

    // Отправляем список активных пользователей новому подключению
    socket.emit("activeUsers", Array.from(activeUsers.values()))

    // Обработка присоединения к комнате задачи
    socket.on("joinTaskRoom", (taskId) => {
      socket.join(`task_${taskId}`)
      console.log(`📋 ${socket.user.name} присоединился к задаче ${taskId}`)

      // Уведомляем других участников комнаты
      socket.to(`task_${taskId}`).emit("userJoinedTask", {
        user: activeUsers.get(socket.user.id),
        taskId,
        timestamp: new Date(),
      })
    })

    // Обработка покидания комнаты задачи
    socket.on("leaveTaskRoom", (taskId) => {
      socket.leave(`task_${taskId}`)
      console.log(`📋 ${socket.user.name} покинул задачу ${taskId}`)

      // Уведомляем других участников комнаты
      socket.to(`task_${taskId}`).emit("userLeftTask", {
        user: activeUsers.get(socket.user.id),
        taskId,
        timestamp: new Date(),
      })
    })

    // Обработка обновлений задач в реальном времени
    socket.on("taskUpdate", (data) => {
      const { taskId, changes, type } = data

      // Валидация данных
      if (!taskId || !changes || !type) {
        socket.emit("error", { message: "Некорректные данные для обновления задачи" })
        return
      }

      // Отправляем обновление всем участникам комнаты задачи
      socket.to(`task_${taskId}`).emit("taskUpdated", {
        taskId,
        changes,
        type,
        updatedBy: {
          id: socket.user.id,
          name: socket.user.name,
          avatar: socket.user.avatar,
        },
        timestamp: new Date(),
      })

      console.log(`📝 ${socket.user.name} обновил задачу ${taskId}: ${type}`)
    })

    // Обработка комментариев к задачам
    socket.on("addComment", (data) => {
      const { taskId, comment } = data

      if (!taskId || !comment || !comment.trim()) {
        socket.emit("error", { message: "Комментарий не может быть пустым" })
        return
      }

      const commentData = {
        id: Date.now().toString(),
        text: comment.trim(),
        user: {
          id: socket.user.id,
          name: socket.user.name,
          avatar: socket.user.avatar,
        },
        createdAt: new Date(),
      }

      // Отправляем комментарий всем участникам комнаты задачи
      io.to(`task_${taskId}`).emit("newComment", {
        taskId,
        comment: commentData,
      })

      console.log(`💬 ${socket.user.name} добавил комментарий к задаче ${taskId}`)
    })

    // Обработка индикатора набора текста
    socket.on("typing", (data) => {
      const { taskId, isTyping } = data

      socket.to(`task_${taskId}`).emit("userTyping", {
        user: {
          id: socket.user.id,
          name: socket.user.name,
        },
        taskId,
        isTyping,
        timestamp: new Date(),
      })
    })

    // Обработка изменения статуса пользователя
    socket.on("updateStatus", (status) => {
      const validStatuses = ["online", "away", "busy", "offline"]

      if (!validStatuses.includes(status)) {
        socket.emit("error", { message: "Некорректный статус" })
        return
      }

      // Обновляем статус в активных пользователях
      if (activeUsers.has(socket.user.id)) {
        activeUsers.get(socket.user.id).status = status

        // Уведомляем всех о изменении статуса
        socket.broadcast.emit("userStatusChanged", {
          userId: socket.user.id,
          status,
          timestamp: new Date(),
        })
      }
    })

    // Обработка отключения
    socket.on("disconnect", (reason) => {
      console.log(`👋 Пользователь отключен: ${socket.user.name} (${reason})`)

      // Удаляем сокет из сессий пользователя
      if (userSessions.has(socket.user.id)) {
        userSessions.get(socket.user.id).delete(socket.id)

        // Если у пользователя больше нет активных сессий
        if (userSessions.get(socket.user.id).size === 0) {
          userSessions.delete(socket.user.id)
          activeUsers.delete(socket.user.id)

          // Уведомляем всех об отключении пользователя
          socket.broadcast.emit("userDisconnected", {
            userId: socket.user.id,
            timestamp: new Date(),
          })
        }
      }
    })

    // Обработка ошибок сокета
    socket.on("error", (error) => {
      console.error(`❌ Ошибка сокета для ${socket.user.name}:`, error)
    })
  })

  // Периодическая очистка неактивных соединений
  setInterval(
    () => {
      const now = new Date()
      const timeout = 30 * 60 * 1000 // 30 минут

      for (const [userId, userData] of activeUsers.entries()) {
        if (now - userData.connectedAt > timeout) {
          activeUsers.delete(userId)
          userSessions.delete(userId)

          io.emit("userDisconnected", {
            userId,
            timestamp: now,
            reason: "timeout",
          })
        }
      }
    },
    5 * 60 * 1000,
  ) // Проверяем каждые 5 минут
}

module.exports = socketHandler
