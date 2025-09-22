const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

class LiveShareCIIntegration {
  constructor(config) {
    this.config = {
      projectPath: process.cwd(),
      liveShareSessionId: null,
      webhookUrl: process.env.LIVESHARE_WEBHOOK_URL,
      ...config,
    }
  }

  // Автоматическое создание Live Share сессии при создании PR
  async createSessionForPR(prNumber, participants) {
    console.log(`🔄 Создание Live Share сессии для PR #${prNumber}`)

    try {
      // Создание временной ветки для совместной работы
      const branchName = `liveshare/pr-${prNumber}-${Date.now()}`
      execSync(`git checkout -b ${branchName}`, { cwd: this.config.projectPath })

      // Генерация конфигурации сессии
      const sessionConfig = {
        id: `pr-${prNumber}-${Date.now()}`,
        branch: branchName,
        participants: participants,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4 часа
        permissions: {
          read: participants,
          write: participants.filter((p) => p.role === "developer"),
          admin: participants.filter((p) => p.role === "lead"),
        },
      }

      // Сохранение конфигурации
      const configPath = path.join(this.config.projectPath, ".liveshare", "session.json")
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify(sessionConfig, null, 2))

      // Отправка уведомлений участникам
      await this.notifyParticipants(sessionConfig)

      console.log(`✅ Live Share сессия создана: ${sessionConfig.id}`)
      return sessionConfig
    } catch (error) {
      console.error("❌ Ошибка при создании Live Share сессии:", error)
      throw error
    }
  }

  // Интеграция с системой code review
  async integrateWithCodeReview(prNumber) {
    const reviewConfig = {
      // Автоматические проверки перед началом сессии
      preSessionChecks: ["npm test", "npm run lint", "npm run type-check"],

      // Действия во время сессии
      sessionActions: ["real-time-testing", "collaborative-debugging", "live-code-review"],

      // Действия после завершения сессии
      postSessionActions: ["auto-commit-changes", "run-full-test-suite", "update-pr-status"],
    }

    console.log(`🔍 Запуск интегрированного code review для PR #${prNumber}`)

    // Выполнение предварительных проверок
    for (const check of reviewConfig.preSessionChecks) {
      try {
        console.log(`⚡ Выполнение: ${check}`)
        execSync(check, {
          cwd: this.config.projectPath,
          stdio: "inherit",
        })
        console.log(`✅ ${check} - успешно`)
      } catch (error) {
        console.error(`❌ ${check} - ошибка:`, error.message)
        throw new Error(`Предварительная проверка не пройдена: ${check}`)
      }
    }

    return reviewConfig
  }

  // Автоматическое сохранение и синхронизация изменений
  async autoSaveAndSync() {
    const saveInterval = setInterval(
      async () => {
        try {
          // Проверка наличия несохраненных изменений
          const gitStatus = execSync("git status --porcelain", {
            cwd: this.config.projectPath,
            encoding: "utf8",
          })

          if (gitStatus.trim()) {
            console.log("💾 Обнаружены изменения, выполняется автосохранение...")

            // Создание автоматического коммита
            const timestamp = new Date().toISOString()
            execSync("git add .", { cwd: this.config.projectPath })
            execSync(`git commit -m "Auto-save: Live Share session ${timestamp}"`, {
              cwd: this.config.projectPath,
            })

            // Отправка в удаленный репозиторий
            execSync("git push origin HEAD", { cwd: this.config.projectPath })

            console.log("✅ Автосохранение завершено")

            // Уведомление участников
            await this.notifyParticipants({
              type: "auto-save",
              timestamp: timestamp,
              message: "Изменения автоматически сохранены и синхронизированы",
            })
          }
        } catch (error) {
          console.error("❌ Ошибка автосохранения:", error.message)
        }
      },
      5 * 60 * 1000,
    ) // Каждые 5 минут

    return () => clearInterval(saveInterval)
  }

  // Мониторинг качества кода в реальном времени
  async startQualityMonitoring() {
    console.log("📊 Запуск мониторинга качества кода...")

    const qualityChecks = {
      linting: {
        command: "npm run lint -- --format json",
        threshold: 0, // Максимальное количество ошибок
      },
      testing: {
        command: "npm test -- --coverage --json",
        threshold: 80, // Минимальное покрытие тестами
      },
      complexity: {
        command: "npx complexity-report --format json src/",
        threshold: 10, // Максимальная цикломатическая сложность
      },
    }

    const monitoringInterval = setInterval(
      async () => {
        const results = {}

        for (const [checkName, config] of Object.entries(qualityChecks)) {
          try {
            const output = execSync(config.command, {
              cwd: this.config.projectPath,
              encoding: "utf8",
            })

            const result = JSON.parse(output)
            results[checkName] = {
              status: "success",
              data: result,
              timestamp: new Date().toISOString(),
            }
          } catch (error) {
            results[checkName] = {
              status: "error",
              error: error.message,
              timestamp: new Date().toISOString(),
            }
          }
        }

        // Анализ результатов и отправка уведомлений
        await this.analyzeQualityResults(results)
      },
      2 * 60 * 1000,
    ) // Каждые 2 минуты

    return () => clearInterval(monitoringInterval)
  }

  // Анализ результатов проверки качества
  async analyzeQualityResults(results) {
    const issues = []

    // Проверка результатов линтинга
    if (results.linting?.status === "success") {
      const lintErrors = results.linting.data.filter((item) => item.severity === "error")
      if (lintErrors.length > 0) {
        issues.push({
          type: "linting",
          severity: "error",
          count: lintErrors.length,
          message: `Обнаружено ${lintErrors.length} ошибок линтинга`,
        })
      }
    }

    // Проверка покрытия тестами
    if (results.testing?.status === "success") {
      const coverage = results.testing.data.coverageMap?.total?.statements?.pct || 0
      if (coverage < 80) {
        issues.push({
          type: "coverage",
          severity: "warning",
          value: coverage,
          message: `Покрытие тестами: ${coverage}% (требуется минимум 80%)`,
        })
      }
    }

    // Отправка уведомлений о проблемах
    if (issues.length > 0) {
      await this.notifyParticipants({
        type: "quality-issues",
        issues: issues,
        timestamp: new Date().toISOString(),
      })
    }
  }

  // Отправка уведомлений участникам
  async notifyParticipants(data) {
    if (!this.config.webhookUrl) {
      console.log("📢 Уведомление участникам:", JSON.stringify(data, null, 2))
      return
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        console.log("✅ Уведомление отправлено участникам")
      } else {
        console.error("❌ Ошибка отправки уведомления:", response.statusText)
      }
    } catch (error) {
      console.error("❌ Ошибка отправки уведомления:", error.message)
    }
  }

  // Завершение сессии и очистка
  async endSession() {
    console.log("🏁 Завершение Live Share сессии...")

    try {
      // Финальное сохранение изменений
      const gitStatus = execSync("git status --porcelain", {
        cwd: this.config.projectPath,
        encoding: "utf8",
      })

      if (gitStatus.trim()) {
        execSync("git add .", { cwd: this.config.projectPath })
        execSync('git commit -m "Final commit: Live Share session ended"', {
          cwd: this.config.projectPath,
        })
        execSync("git push origin HEAD", { cwd: this.config.projectPath })
      }

      // Удаление временных файлов
      const configPath = path.join(this.config.projectPath, ".liveshare")
      if (fs.existsSync(configPath)) {
        fs.rmSync(configPath, { recursive: true, force: true })
      }

      // Финальное уведомление
      await this.notifyParticipants({
        type: "session-ended",
        timestamp: new Date().toISOString(),
        message: "Live Share сессия завершена, все изменения сохранены",
      })

      console.log("✅ Сессия успешно завершена")
    } catch (error) {
      console.error("❌ Ошибка при завершении сессии:", error)
      throw error
    }
  }
}

module.exports = LiveShareCIIntegration
