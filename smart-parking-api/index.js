import express from 'express'
import cors from 'cors'
import userRoutes from './routes/userRoutes.js'
import vehicleRoutes from './routes/vehicleRoutes.js'
import rezervationsRoutes from './routes/rezervationsRoutes.js'
import reservationScheduler from './services/reservationScheduler.js'
import mqttService from './services/mqttService.js'

const app = express()
const port = 3000

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))


app.use('/api/user', userRoutes)
app.use('/api/vehicle', vehicleRoutes)
app.use('/api', rezervationsRoutes)

// Sistem durumu endpoint'i
app.get('/api/system/status', (req, res) => {
  const schedulerStatus = reservationScheduler.getStatus()
  const mqttStatus = mqttService.getStatus()

  res.json({
    message: 'Sistem durumu',
    server: {
      status: 'running',
      port: port,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    scheduler: schedulerStatus,
    mqtt: mqttStatus,
  })
})

// Manuel rezervasyon kontrolü endpoint'i
app.post('/api/system/check-reservations', async (req, res) => {
  const result = await reservationScheduler.checkNow()
  res.json(result || { error: 'Kontrol başarısız' })
})

// MQTT test endpoint'i
app.post('/api/system/mqtt/test', (req, res) => {
  const { topic, message } = req.body

  if (!topic || !message) {
    return res.status(400).json({ error: 'Topic ve message gerekli' })
  }

  const success = mqttService.publishMessage(topic, message)
  res.json({
    success: success,
    message: success ? 'MQTT mesajı gönderildi' : 'MQTT mesajı gönderilemedi',
  })
})

// Sunucuyu başlat
app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`)
  console.log('📋 Available endpoints:')
  console.log('   GET  /api/system/status - Sistem durumu')
  console.log('   POST /api/reservations - Yeni rezervasyon')
  console.log('   GET  /api/reservations/active - Aktif rezervasyonlar')
  console.log('   GET  /api/parking-spots/status - Park yeri durumları')
  console.log('')

  // Reservation scheduler'ı başlat
  console.log('🕐 Reservation scheduler başlatılıyor...')
  reservationScheduler.start()

  // MQTT servisini başlat
  console.log('📡 MQTT servisi başlatılıyor...')
  mqttService.connect()
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Sunucu kapatılıyor...')

  reservationScheduler.stop()
  mqttService.disconnect()

  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Sunucu sonlandırılıyor...')

  reservationScheduler.stop()
  mqttService.disconnect()

  process.exit(0)
})
