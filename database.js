const mongoose = require("mongoose")

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/collabtask"

    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })

    console.log(`📦 MongoDB подключена: ${conn.connection.host}`)

    // Обработка событий подключения
    mongoose.connection.on("error", (err) => {
      console.error("Ошибка MongoDB:", err)
    })

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB отключена")
    })

    // Graceful shutdown для MongoDB
    process.on("SIGINT", async () => {
      await mongoose.connection.close()
      console.log("Соединение с MongoDB закрыто")
      process.exit(0)
    })
  } catch (error) {
    console.error("Ошибка подключения к MongoDB:", error.message)
    process.exit(1)
  }
}

module.exports = connectDB
