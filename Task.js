const mongoose = require("mongoose")

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Название задачи обязательно"],
      trim: true,
      maxlength: [100, "Название не может быть длиннее 100 символов"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Описание не может быть длиннее 500 символов"],
    },
    status: {
      type: String,
      enum: ["todo", "in-progress", "review", "done"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    dueDate: {
      type: Date,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        text: {
          type: String,
          required: true,
          maxlength: [300, "Комментарий не может быть длиннее 300 символов"],
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    attachments: [
      {
        filename: String,
        originalName: String,
        mimetype: String,
        size: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    estimatedHours: {
      type: Number,
      min: 0,
      max: 1000,
    },
    actualHours: {
      type: Number,
      min: 0,
      max: 1000,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// Виртуальное поле для вычисления прогресса
taskSchema.virtual("progress").get(function () {
  const statusProgress = {
    todo: 0,
    "in-progress": 25,
    review: 75,
    done: 100,
  }
  return statusProgress[this.status] || 0
})

// Индексы для оптимизации запросов
taskSchema.index({ status: 1, createdAt: -1 })
taskSchema.index({ assignedTo: 1, status: 1 })
taskSchema.index({ createdBy: 1, createdAt: -1 })
taskSchema.index({ tags: 1 })

// Middleware для автоматического заполнения связанных данных
taskSchema.pre(/^find/, function (next) {
  this.populate({
    path: "assignedTo createdBy",
    select: "name email avatar",
  }).populate({
    path: "comments.user",
    select: "name avatar",
  })
  next()
})

module.exports = mongoose.model("Task", taskSchema)
