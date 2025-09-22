const WebSocket = require("ws")
const { performance } = require("perf_hooks")

class LiveSharePerformanceTest {
  constructor(config) {
    this.config = {
      serverUrl: "ws://localhost:5000",
      testDuration: 60000, // 1 минута
      participantCount: 5,
      operationsPerSecond: 10,
      ...config,
    }

    this.participants = []
    this.metrics = {
      latency: [],
      throughput: [],
      errors: [],
      memoryUsage: [],
    }
  }

  // Симуляция участника Live Share сессии
  async createParticipant(participantId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.serverUrl)
      const participant = {
        id: participantId,
        socket: ws,
        operations: 0,
        latencies: [],
      }

      ws.on("open", () => {
        console.log(`👤 Участник ${participantId} подключен`)

        // Аутентификация участника
        ws.send(
          JSON.stringify({
            type: "auth",
            token: `test-token-${participantId}`,
            userId: `user-${participantId}`,
          }),
        )

        resolve(participant)
      })

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data)

          if (message.type === "operation-ack") {
            const latency = performance.now() - message.timestamp
            participant.latencies.push(latency)
            this.metrics.latency.push(latency)
          }
        } catch (error) {
          this.metrics.errors.push({
            participantId,
            error: error.message,
            timestamp: Date.now(),
          })
        }
      })

      ws.on("error", (error) => {
        this.metrics.errors.push({
          participantId,
          error: error.message,
          timestamp: Date.now(),
        })
        reject(error)
      })

      this.participants.push(participant)
    })
  }

  // Генерация операций редактирования
  generateEditOperation(participantId) {
    const operations = [
      {
        type: "insert",
        position: Math.floor(Math.random() * 1000),
        content: `// Код от участника ${participantId}\nconst variable${Date.now()} = "test";\n`,
        timestamp: performance.now(),
      },
      {
        type: "delete",
        position: Math.floor(Math.random() * 500),
        length: Math.floor(Math.random() * 50) + 1,
        timestamp: performance.now(),
      },
      {
        type: "replace",
        position: Math.floor(Math.random() * 500),
        length: Math.floor(Math.random() * 20) + 1,
        content: `updatedValue${Date.now()}`,
        timestamp: performance.now(),
      },
    ]

    return operations[Math.floor(Math.random() * operations.length)]
  }

  // Запуск теста латентности
  async runLatencyTest() {
    console.log("🚀 Запуск теста латентности...")

    const startTime = performance.now()
    const testPromises = []

    for (const participant of this.participants) {
      const promise = new Promise((resolve) => {
        const interval = setInterval(() => {
          if (performance.now() - startTime > this.config.testDuration) {
            clearInterval(interval)
            resolve()
            return
          }

          const operation = this.generateEditOperation(participant.id)
          participant.socket.send(
            JSON.stringify({
              type: "edit-operation",
              operation,
              sessionId: "test-session",
            }),
          )

          participant.operations++
        }, 1000 / this.config.operationsPerSecond)
      })

      testPromises.push(promise)
    }

    await Promise.all(testPromises)
    console.log("✅ Тест латентности завершен")
  }

  // Тест пропускной способности
  async runThroughputTest() {
    console.log("🚀 Запуск теста пропускной способности...")

    const startTime = performance.now()
    let totalOperations = 0
    const throughputInterval = setInterval(() => {
      const currentThroughput = totalOperations / ((performance.now() - startTime) / 1000)
      this.metrics.throughput.push(currentThroughput)
      console.log(`📊 Текущая пропускная способность: ${currentThroughput.toFixed(2)} операций/сек`)
    }, 5000)

    // Интенсивная генерация операций
    const intensiveTest = setInterval(() => {
      for (const participant of this.participants) {
        for (let i = 0; i < 5; i++) {
          const operation = this.generateEditOperation(participant.id)
          participant.socket.send(
            JSON.stringify({
              type: "edit-operation",
              operation,
              sessionId: "throughput-test",
            }),
          )
          totalOperations++
        }
      }
    }, 100)

    setTimeout(() => {
      clearInterval(intensiveTest)
      clearInterval(throughputInterval)
      console.log("✅ Тест пропускной способности завершен")
    }, this.config.testDuration)
  }

  // Мониторинг использования памяти
  startMemoryMonitoring() {
    const memoryInterval = setInterval(() => {
      const memUsage = process.memoryUsage()
      this.metrics.memoryUsage.push({
        timestamp: Date.now(),
        heapUsed: memUsage.heapUsed / 1024 / 1024, // MB
        heapTotal: memUsage.heapTotal / 1024 / 1024, // MB
        external: memUsage.external / 1024 / 1024, // MB
        rss: memUsage.rss / 1024 / 1024, // MB
      })
    }, 1000)

    return () => clearInterval(memoryInterval)
  }

  // Анализ результатов
  analyzeResults() {
    const latencies = this.metrics.latency.filter((l) => l > 0)
    const throughputs = this.metrics.throughput.filter((t) => t > 0)

    const results = {
      latency: {
        avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        p95: this.percentile(latencies, 95),
        p99: this.percentile(latencies, 99),
      },
      throughput: {
        avg: throughputs.reduce((a, b) => a + b, 0) / throughputs.length,
        max: Math.max(...throughputs),
        min: Math.min(...throughputs),
      },
      errors: {
        total: this.metrics.errors.length,
        rate: (this.metrics.errors.length / ((this.participants.length * this.config.testDuration) / 1000)) * 100,
      },
      memory: {
        peak: Math.max(...this.metrics.memoryUsage.map((m) => m.heapUsed)),
        avg: this.metrics.memoryUsage.reduce((a, b) => a + b.heapUsed, 0) / this.metrics.memoryUsage.length,
      },
    }

    return results
  }

  percentile(arr, p) {
    const sorted = arr.slice().sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[index]
  }

  // Основной метод запуска тестов
  async runTests() {
    console.log(`🎯 Начало тестирования Live Share производительности`)
    console.log(`👥 Участников: ${this.config.participantCount}`)
    console.log(`⏱️ Длительность: ${this.config.testDuration / 1000} секунд`)

    const stopMemoryMonitoring = this.startMemoryMonitoring()

    try {
      // Создание участников
      for (let i = 1; i <= this.config.participantCount; i++) {
        await this.createParticipant(i)
        await new Promise((resolve) => setTimeout(resolve, 500)) // Задержка между подключениями
      }

      console.log(`✅ Все ${this.participants.length} участников подключены`)

      // Запуск тестов
      await this.runLatencyTest()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await this.runThroughputTest()

      // Анализ результатов
      const results = this.analyzeResults()

      console.log("\n📈 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:")
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
      console.log(`📊 Латентность:`)
      console.log(`   Средняя: ${results.latency.avg.toFixed(2)} мс`)
      console.log(`   Минимальная: ${results.latency.min.toFixed(2)} мс`)
      console.log(`   Максимальная: ${results.latency.max.toFixed(2)} мс`)
      console.log(`   95-й процентиль: ${results.latency.p95.toFixed(2)} мс`)
      console.log(`   99-й процентиль: ${results.latency.p99.toFixed(2)} мс`)

      console.log(`\n🚀 Пропускная способность:`)
      console.log(`   Средняя: ${results.throughput.avg.toFixed(2)} операций/сек`)
      console.log(`   Максимальная: ${results.throughput.max.toFixed(2)} операций/сек`)

      console.log(`\n❌ Ошибки:`)
      console.log(`   Всего: ${results.errors.total}`)
      console.log(`   Частота: ${results.errors.rate.toFixed(2)}%`)

      console.log(`\n💾 Память:`)
      console.log(`   Пиковое использование: ${results.memory.peak.toFixed(2)} MB`)
      console.log(`   Среднее использование: ${results.memory.avg.toFixed(2)} MB`)

      return results
    } finally {
      stopMemoryMonitoring()

      // Закрытие соединений
      for (const participant of this.participants) {
        participant.socket.close()
      }
    }
  }
}

// Запуск тестов с различными конфигурациями
async function runPerformanceTests() {
  const testConfigurations = [
    { participantCount: 2, operationsPerSecond: 5, testDuration: 30000 },
    { participantCount: 5, operationsPerSecond: 10, testDuration: 60000 },
    { participantCount: 10, operationsPerSecond: 15, testDuration: 90000 },
    { participantCount: 20, operationsPerSecond: 20, testDuration: 120000 },
  ]

  const allResults = []

  for (const config of testConfigurations) {
    console.log(`\n🔄 Тестирование конфигурации: ${JSON.stringify(config)}`)

    const test = new LiveSharePerformanceTest(config)
    const results = await test.runTests()

    allResults.push({
      config,
      results,
    })

    // Пауза между тестами
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  // Сводный отчет
  console.log("\n📋 СВОДНЫЙ ОТЧЕТ ПО ВСЕМ ТЕСТАМ:")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

  allResults.forEach((test, index) => {
    console.log(`\nТест ${index + 1} (${test.config.participantCount} участников):`)
    console.log(`  Средняя латентность: ${test.results.latency.avg.toFixed(2)} мс`)
    console.log(`  Пропускная способность: ${test.results.throughput.avg.toFixed(2)} оп/сек`)
    console.log(`  Частота ошибок: ${test.results.errors.rate.toFixed(2)}%`)
  })

  return allResults
}

// Экспорт для использования в других модулях
module.exports = { LiveSharePerformanceTest, runPerformanceTests }

// Запуск тестов если файл выполняется напрямую
if (require.main === module) {
  runPerformanceTests().catch(console.error)
}
