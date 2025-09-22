const express = require("express")
const router = express.Router()
const Task = require("../models/Task")
const User = require("../models/User") // Import User model
const auth = require("../middleware/auth")
const { body, validationResult, param } = require("express-validator")

// Middleware для валидации задач
const validateTask = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Название задачи должно содержать от 1 до 100 символов"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Описание не может быть длиннее 500 символов"),
  body("status").optional().isIn(["todo", "in-progress", "review", "done"]).withMessage("Некорректный статус задачи"),
  body("priority").optional().isIn(["low", "medium", "high", "urgent"]).withMessage("Некорректный приоритет задачи"),
  body("dueDate").optional().isISO8601().withMessage("Некорректная дата выполнения"),
  body("estimatedHours")
    .optional()
    .isFloat({ min: 0, max: 1000 })
    .withMessage("Оценка времени должна быть от 0 до 1000 часов"),
]

// GET /api/tasks - Получить все задачи с фильтрацией и пагинацией
router.get("/", auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      priority,
      assignedTo,
      createdBy,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query

    // Построение фильтра
    const filter = {}

    if (status) filter.status = status
    if (priority) filter.priority = priority
    if (assignedTo) filter.assignedTo = assignedTo
    if (createdBy) filter.createdBy = createdBy

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ]
    }

    // Построение сортировки
    const sort = {}
    sort[sortBy] = sortOrder === "desc" ? -1 : 1

    // Выполнение запроса с пагинацией
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    const [tasks, total] = await Promise.all([
      Task.find(filter).sort(sort).skip(skip).limit(Number.parseInt(limit)),
      Task.countDocuments(filter),
    ])

    // Вычисление метаданных пагинации
    const totalPages = Math.ceil(total / Number.parseInt(limit))
    const hasNextPage = Number.parseInt(page) < totalPages
    const hasPrevPage = Number.parseInt(page) > 1

    res.json({
      success: true,
      data: {
        tasks,
        pagination: {
          currentPage: Number.parseInt(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number.parseInt(limit),
          hasNextPage,
          hasPrevPage,
        },
      },
    })
  } catch (error) {
    console.error("Ошибка при получении задач:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка при получении задач",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

// POST /api/tasks - Создать новую задачу
router.post("/", auth, validateTask, async (req, res) => {
  try {
    // Проверка валидации
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Ошибки валидации",
        errors: errors.array(),
      })
    }

    const taskData = {
      ...req.body,
      createdBy: req.user.id,
    }

    const task = new Task(taskData)
    await task.save()

    // Обновляем статистику пользователя
    await req.user.updateOne({ $inc: { "stats.tasksCreated": 1 } })

    // Отправляем уведомление через Socket.IO
    req.app.get("io").emit("taskCreated", {
      task: await task.populate("assignedTo createdBy", "name email avatar"),
      createdBy: req.user,
    })

    res.status(201).json({
      success: true,
      message: "Задача успешно создана",
      data: task,
    })
  } catch (error) {
    console.error("Ошибка при создании задачи:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка при создании задачи",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

// GET /api/tasks/:id - Получить задачу по ID
router.get("/:id", auth, [param("id").isMongoId().withMessage("Некорректный ID задачи")], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Некорректный ID задачи",
        errors: errors.array(),
      })
    }

    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Задача не найдена",
      })
    }

    res.json({
      success: true,
      data: task,
    })
  } catch (error) {
    console.error("Ошибка при получении задачи:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка при получении задачи",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

// PUT /api/tasks/:id - Обновить задачу
router.put(
  "/:id",
  auth,
  [param("id").isMongoId().withMessage("Некорректный ID задачи"), ...validateTask],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Ошибки валидации",
          errors: errors.array(),
        })
      }

      const task = await Task.findById(req.params.id)

      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Задача не найдена",
        })
      }

      // Проверка прав доступа
      if (task.createdBy.toString() !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Недостаточно прав для изменения этой задачи",
        })
      }

      // Отслеживание изменения статуса для статистики
      const oldStatus = task.status
      const newStatus = req.body.status

      Object.assign(task, req.body)
      await task.save()

      // Обновление статистики при завершении задачи
      if (oldStatus !== "done" && newStatus === "done" && task.assignedTo) {
        await User.findByIdAndUpdate(task.assignedTo, {
          $inc: { "stats.tasksCompleted": 1 },
        })
      }

      // Отправка уведомления через Socket.IO
      req.app.get("io").emit("taskUpdated", {
        task,
        updatedBy: req.user,
        changes: req.body,
      })

      res.json({
        success: true,
        message: "Задача успешно обновлена",
        data: task,
      })
    } catch (error) {
      console.error("Ошибка при обновлении задачи:", error)
      res.status(500).json({
        success: false,
        message: "Ошибка при обновлении задачи",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      })
    }
  },
)

// DELETE /api/tasks/:id - Удалить задачу
router.delete("/:id", auth, [param("id").isMongoId().withMessage("Некорректный ID задачи")], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Некорректный ID задачи",
        errors: errors.array(),
      })
    }

    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Задача не найдена",
      })
    }

    // Проверка прав доступа
    if (task.createdBy.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Недостаточно прав для удаления этой задачи",
      })
    }

    await task.deleteOne()

    // Отправка уведомления через Socket.IO
    req.app.get("io").emit("taskDeleted", {
      taskId: req.params.id,
      deletedBy: req.user,
    })

    res.json({
      success: true,
      message: "Задача успешно удалена",
    })
  } catch (error) {
    console.error("Ошибка при удалении задачи:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка при удалении задачи",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

module.exports = router
