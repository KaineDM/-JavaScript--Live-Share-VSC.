const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Имя пользователя обязательно"],
      trim: true,
      maxlength: [50, "Имя не может быть длиннее 50 символов"],
    },
    email: {
      type: String,
      required: [true, "Email обязателен"],
      unique: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Введите корректный email"],
    },
    password: {
      type: String,
      required: [true, "Пароль обязателен"],
      minlength: [6, "Пароль должен содержать минимум 6 символов"],
      select: false,
    },
    avatar: {
      type: String,
      default: function () {
        // Генерируем аватар на основе инициалов
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(this.name)}&background=random`
      },
    },
    role: {
      type: String,
      enum: ["user", "admin", "manager"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    preferences: {
      theme: {
        type: String,
        enum: ["light", "dark", "auto"],
        default: "light",
      },
      notifications: {
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        taskAssigned: { type: Boolean, default: true },
        taskCompleted: { type: Boolean, default: true },
      },
      language: {
        type: String,
        default: "ru",
      },
    },
    stats: {
      tasksCreated: { type: Number, default: 0 },
      tasksCompleted: { type: Number, default: 0 },
      totalHoursLogged: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.password
        return ret
      },
    },
  },
)

// Виртуальное поле для полного имени
userSchema.virtual("fullName").get(function () {
  return this.name
})

// Виртуальное поле для статистики эффективности
userSchema.virtual("efficiency").get(function () {
  if (this.stats.tasksCreated === 0) return 0
  return Math.round((this.stats.tasksCompleted / this.stats.tasksCreated) * 100)
})

// Хеширование пароля перед сохранением
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next()

  try {
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// Метод для проверки пароля
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password)
}

// Метод для обновления статистики последнего входа
userSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date()
  return this.save({ validateBeforeSave: false })
}

// Индексы для оптимизации
userSchema.index({ email: 1 })
userSchema.index({ isActive: 1, role: 1 })

module.exports = mongoose.model("User", userSchema)
