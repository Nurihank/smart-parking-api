import mqtt from 'mqtt'
import fetch from 'node-fetch'

class MQTTService {
  constructor(
    brokerUrl = 'mqtt://localhost:1883',
    baseApiUrl = 'http://localhost:3000'
  ) {
    this.brokerUrl = brokerUrl
    this.baseApiUrl = baseApiUrl
    this.client = null
    this.isConnected = false

    // MQTT Topic'leri
    this.topics = {
      vehicleDetected: 'parking/spot/+/vehicle/detected', // parking/spot/1/vehicle/detected
      vehicleLeft: 'parking/spot/+/vehicle/left', // parking/spot/1/vehicle/left
      spotStatus: 'parking/spot/+/status', // parking/spot/1/status
    }
  }

  // MQTT broker'a bağlan
  connect() {
    if (this.client) {
      console.log('MQTT zaten bağlı')
      return
    }

    console.log(`MQTT broker'a bağlanılıyor: ${this.brokerUrl}`)

    this.client = mqtt.connect(this.brokerUrl, {
      clientId: `parking-api-${Math.random().toString(16).substr(2, 8)}`,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 30 * 1000,
    })

    // Bağlantı eventi
    this.client.on('connect', () => {
      console.log("✅ MQTT broker'a bağlanıldı")
      this.isConnected = true
      this.subscribeToTopics()
    })

    // Mesaj alındığında
    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message.toString())
    })

    // Hata eventi
    this.client.on('error', (error) => {
      console.error('❌ MQTT bağlantı hatası:', error.message)
      this.isConnected = false
    })

    // Bağlantı koptu
    this.client.on('close', () => {
      console.log('⚠️  MQTT bağlantısı kesildi')
      this.isConnected = false
    })

    // Yeniden bağlanma
    this.client.on('reconnect', () => {
      console.log('🔄 MQTT yeniden bağlanılıyor...')
    })
  }

  // Topic'lere abone ol
  subscribeToTopics() {
    Object.values(this.topics).forEach((topic) => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`❌ Topic'e abone olma hatası (${topic}):`, err.message)
        } else {
          console.log(`✅ Topic'e abone olundu: ${topic}`)
        }
      })
    })
  }

  // Gelen mesajları işle
  async handleMessage(topic, message) {
    try {
      console.log(`📨 MQTT Mesaj alındı - Topic: ${topic}, Message: ${message}`)

      // Topic'ten spot ID'sini çıkar (örnek: parking/spot/1/vehicle/detected -> spot ID: 1)
      const topicParts = topic.split('/')
      const spotId = parseInt(topicParts[2])

      if (!spotId) {
        console.error('❌ Geçersiz spot ID:', topic)
        return
      }

      // Mesajı JSON olarak parse et
      let data
      try {
        data = JSON.parse(message)
      } catch (e) {
        // JSON değilse string olarak işle
        data = { message: message }
      }

      // Topic türüne göre işlem yap
      if (topic.includes('/vehicle/detected')) {
        await this.handleVehicleDetected(spotId, data)
      } else if (topic.includes('/vehicle/left')) {
        await this.handleVehicleLeft(spotId, data)
      } else if (topic.includes('/status')) {
        await this.handleSpotStatus(spotId, data)
      }
    } catch (error) {
      console.error('❌ MQTT mesaj işleme hatası:', error.message)
    }
  }

  // Araç tespit edildiğinde
  async handleVehicleDetected(spotId, data) {
    try {
      console.log(`🚗 Araç tespit edildi - Spot ID: ${spotId}`)

      // Aktif rezervasyonu bul
      const response = await fetch(`${this.baseApiUrl}/api/reservations/active`)
      const result = await response.json()

      const activeReservation = result.data.find((r) => r.spot_id === spotId)

      if (activeReservation) {
        // Araç geldi endpoint'ini çağır
        const arrivalResponse = await fetch(
          `${this.baseApiUrl}/api/reservations/${activeReservation.reservation_id}/vehicle-arrived`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spot_id: spotId }),
          }
        )

        if (arrivalResponse.ok) {
          console.log(
            `✅ Araç gelişi kaydedildi - Rezervasyon ID: ${activeReservation.reservation_id}`
          )

          // ESP32'ye onay mesajı gönder
          this.publishMessage(`parking/spot/${spotId}/confirmation`, {
            status: 'vehicle_arrived',
            reservation_id: activeReservation.reservation_id,
            timestamp: new Date().toISOString(),
          })
        } else {
          console.error(
            '❌ Araç gelişi kaydedilemedi:',
            arrivalResponse.statusText
          )
        }
      } else {
        console.log(`⚠️  Spot ${spotId} için aktif rezervasyon bulunamadı`)

        // ESP32'ye uyarı mesajı gönder
        this.publishMessage(`parking/spot/${spotId}/warning`, {
          status: 'no_reservation',
          message: 'Bu spot için aktif rezervasyon bulunmamaktadır',
          timestamp: new Date().toISOString(),
        })
      }
    } catch (error) {
      console.error('❌ Araç tespit işleme hatası:', error.message)
    }
  }

  // Araç ayrıldığında
  async handleVehicleLeft(spotId, data) {
    try {
      console.log(`🚗💨 Araç ayrıldı - Spot ID: ${spotId}`)

      // Aktif rezervasyonu bul
      const response = await fetch(`${this.baseApiUrl}/api/reservations/active`)
      const result = await response.json()

      const activeReservation = result.data.find((r) => r.spot_id === spotId)

      if (activeReservation) {
        // Araç ayrıldı endpoint'ini çağır
        const departureResponse = await fetch(
          `${this.baseApiUrl}/api/reservations/${activeReservation.reservation_id}/vehicle-left`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spot_id: spotId }),
          }
        )

        if (departureResponse.ok) {
          console.log(
            `✅ Araç ayrılışı kaydedildi - Rezervasyon ID: ${activeReservation.reservation_id}`
          )

          // ESP32'ye onay mesajı gönder
          this.publishMessage(`parking/spot/${spotId}/confirmation`, {
            status: 'vehicle_left',
            reservation_id: activeReservation.reservation_id,
            timestamp: new Date().toISOString(),
          })
        } else {
          console.error(
            '❌ Araç ayrılışı kaydedilemedi:',
            departureResponse.statusText
          )
        }
      } else {
        console.log(`⚠️  Spot ${spotId} için aktif rezervasyon bulunamadı`)
      }
    } catch (error) {
      console.error('❌ Araç ayrılış işleme hatası:', error.message)
    }
  }

  // Spot durumu değiştiğinde
  async handleSpotStatus(spotId, data) {
    try {
      console.log(
        `📊 Spot durumu güncellendi - Spot ID: ${spotId}, Durum: ${
          data.status || data.message
        }`
      )

      // Gerekirse veritabanı güncelleme işlemleri burada yapılabilir
    } catch (error) {
      console.error('❌ Spot durumu işleme hatası:', error.message)
    }
  }

  // MQTT mesajı yayınla
  publishMessage(topic, payload) {
    if (!this.isConnected || !this.client) {
      console.error('❌ MQTT bağlı değil, mesaj gönderilemedi')
      return false
    }

    const message =
      typeof payload === 'string' ? payload : JSON.stringify(payload)

    this.client.publish(topic, message, (err) => {
      if (err) {
        console.error(`❌ MQTT mesaj gönderme hatası (${topic}):`, err.message)
      } else {
        console.log(`📤 MQTT mesajı gönderildi - Topic: ${topic}`)
      }
    })

    return true
  }

  // Bağlantıyı kapat
  disconnect() {
    if (this.client) {
      this.client.end()
      this.client = null
      this.isConnected = false
      console.log('❌ MQTT bağlantısı kapatıldı')
    }
  }

  // Durum bilgisi
  getStatus() {
    return {
      isConnected: this.isConnected,
      brokerUrl: this.brokerUrl,
      topics: this.topics,
    }
  }
}

// Singleton instance
const mqttService = new MQTTService()

export default mqttService
