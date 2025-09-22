const express = require("express")
const router = express.Router()
const Task = require("../models/Task")
const User = require("../models/User")
const auth = require("../middleware/auth")

// GET /api/analytics/dashboard - Получить данные для дашборда
router.get("/dashboard", auth, async (req, res) => {
  try {
    // Разработчик A: Базовая структура endpoint
    const userId = req.user.id
    const { period = "30d" } = req.query

    // Вычисляем диапазон дат на основе периода
    const now = new Date()
    let startDate

    switch (period) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Разработчик B: Добавляет агрегационные запросы
    const [taskStats, statusDistribution, priorityDistribution, recentActivity, teamPerformance] = await Promise.all([
      // Общая статистика задач
      Task.aggregate([
        {
          $match: {
            $or: [{ createdBy: userId }, { assignedTo: userId }],
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            completedTasks: {
              $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] },
            },
            inProgressTasks: {
              $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] },
            },
            avgEstimatedHours: { $avg: "$estimatedHours" },
            avgActualHours: { $avg: "$actualHours" },
          },
        },
      ]),

      // Распределение по статусам
      Task.aggregate([
        {
          $match: {
            $or: [{ createdBy: userId }, { assignedTo: userId }],
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      // Распределение по приоритетам
      Task.aggregate([
        {
          $match: {
            $or: [{ createdBy: userId }, { assignedTo: userId }],
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$priority",
            count: { $sum: 1 },
          },
        },
      ]),

      // Недавняя активность
      Task.find({
        $or: [{ createdBy: userId }, { assignedTo: userId }],
        updatedAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      })
        .populate("createdBy assignedTo", "name avatar")
        .sort({ updatedAt: -1 })
        .limit(10),

      // Производительность команды (если пользователь - менеджер)
      req.user.role === "manager" || req.user.role === "admin"
        ? Task.aggregate([
            {
              $match: {
                createdAt: { $gte: startDate },
                assignedTo: { $exists: true },
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignee",
              },
            },
            {
              $unwind: "$assignee",
            },
            {
              $group: {
                _id: "$assignedTo",
                name: { $first: "$assignee.name" },
                avatar: { $first: "$assignee.avatar" },
                totalTasks: { $sum: 1 },
                completedTasks: {
                  $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] },
                },
                avgCompletionTime: {
                  $avg: {
                    $cond: [{ $eq: ["$status", "done"] }, { $subtract: ["$updatedAt", "$createdAt"] }, null],
                  },
                },
              },
            },
            {
              $addFields: {
                completionRate: {
                  $multiply: [{ $divide: ["$completedTasks", "$totalTasks"] }, 100],
                },
              },
            },
            { $sort: { completionRate: -1 } },
            { $limit: 10 },
          ])
        : [],
    ])

    // Разработчик A: Формирование ответа
    const dashboardData = {
      period,
      dateRange: {
        start: startDate,
        end: now,
      },
      overview: {
        totalTasks: taskStats[0]?.totalTasks || 0,
        completedTasks: taskStats[0]?.completedTasks || 0,
        inProgressTasks: taskStats[0]?.inProgressTasks || 0,
        completionRate: taskStats[0]?.totalTasks
          ? Math.round((taskStats[0].completedTasks / taskStats[0].totalTasks) * 100)
          : 0,
        avgEstimatedHours: Math.round((taskStats[0]?.avgEstimatedHours || 0) * 10) / 10,
        avgActualHours: Math.round((taskStats[0]?.avgActualHours || 0) * 10) / 10,
      },
      distributions: {
        status: statusDistribution.reduce((acc, item) => {
          acc[item._id] = item.count
          return acc
        }, {}),
        priority: priorityDistribution.reduce((acc, item) => {
          acc[item._id] = item.count
          return acc
        }, {}),
      },
      recentActivity: recentActivity.map((task) => ({
        id: task._id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        createdBy: task.createdBy,
        assignedTo: task.assignedTo,
        updatedAt: task.updatedAt,
      })),
      teamPerformance: teamPerformance.map((member) => ({
        userId: member._id,
        name: member.name,
        avatar: member.avatar,
        totalTasks: member.totalTasks,
        completedTasks: member.completedTasks,
        completionRate: Math.round(member.completionRate),
        avgCompletionTime: member.avgCompletionTime
          ? Math.round((member.avgCompletionTime / (1000 * 60 * 60 * 24)) * 10) / 10 // в днях
          : null,
      })),
    }

    res.json({
      success: true,
      data: dashboardData,
    })
  } catch (error) {
    console.error("Ошибка при получении аналитики:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка при получении данных аналитики",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

// GET /api/analytics/trends - Получить тренды по задачам
router.get("/trends", auth, async (req, res) => {
  try {
    const { period = "30d", granularity = "day" } = req.query
    const userId = req.user.id

    // Разработчик B: Вычисление периода и гранулярности
    const now = new Date()
    let startDate, groupFormat

    switch (period) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        groupFormat =
          granularity === "hour"
            ? { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } }
            : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
        break
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        groupFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
        break
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        groupFormat =
          granularity === "week"
            ? { $dateToString: { format: "%Y-W%U", date: "$createdAt" } }
            : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        groupFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
    }

    // Разработчик A: Агрегация данных для трендов
    const trends = await Task.aggregate([
      {
        $match: {
          $or: [{ createdBy: userId }, { assignedTo: userId }],
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            date: groupFormat,
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.date",
          data: {
            $push: {
              status: "$_id.status",
              count: "$count",
            },
          },
          totalTasks: { $sum: "$count" },
        },
      },
      { $sort: { _id: 1 } },
    ])

    // Разработчик B: Форматирование данных для фронтенда
    const formattedTrends = trends.map((trend) => {
      const statusCounts = {
        todo: 0,
        "in-progress": 0,
        review: 0,
        done: 0,
      }

      trend.data.forEach((item) => {
        statusCounts[item.status] = item.count
      })

      return {
        date: trend._id,
        ...statusCounts,
        total: trend.totalTasks,
      }
    })

    res.json({
      success: true,
      data: {
        period,
        granularity,
        trends: formattedTrends,
      },
    })
  } catch (error) {
    console.error("Ошибка при получении трендов:", error)
    res.status(500).json({
      success: false,
      message: "Ошибка при получении трендов",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

module.exports = router
