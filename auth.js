const jwt = require("jsonwebtoken")
const User = require("../models/User")

const auth = async (req, res, next) => {
  try {
    // Получаем токен из заголовка Authorization
    const authHeader = req.header("Authorization")

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Токен доступа не предоставлен",
      })
    }

    const token = authHeader.substring(7) // Убираем 'Bearer ' из начала

    // Верифицируем токен
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Находим пользователя по ID из токена
    const user = await User.findById(decoded.id).select("-password")

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Пользователь не найден",
      })
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Аккаунт пользователя деактивирован",
      })
    }

    // Добавляем пользователя в объект запроса
    req.user = user
    next()
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Недействительный токен",
      })
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Токен истек",
      })
    }

    console.error("Ошибка аутентификации:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка сервера при аутентификации",
    })
  }
}

// Middleware для проверки ролей
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Пользователь не аутентифицирован",
      })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Недостаточно прав для выполнения этого действия",
      })
    }

    next()
  }
}

module.exports = { auth, authorize }
