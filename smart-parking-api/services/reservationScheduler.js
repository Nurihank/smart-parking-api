import cron from 'node-cron'
import fetch from 'node-fetch'

// Reservation checker class
class ReservationScheduler {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl
    this.isRunning = false
  }

  // 2 dakikada bir süresi dolan rezervasyonları kontrol et
  start() {
    if (this.isRunning) {
      console.log('Reservation scheduler zaten çalışıyor')
      return
    }

    console.log('Reservation scheduler başlatılıyor...')

    // Her 2 dakikada bir çalış (*/2 * * * *)
    this.cronJob = cron.schedule(
      '*/2 * * * *',
      async () => {
        try {
          console.log(
            `[${new Date().toISOString()}] Süresi dolan rezervasyonlar kontrol ediliyor...`
          )

          const response = await fetch(
            `${this.baseUrl}/api/reservations/check-expired`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            }
          )

          if (response.ok) {
            const result = await response.json()
            if (result.cancelled_reservations > 0) {
              console.log(
                `✅ ${result.cancelled_reservations} adet süresi dolan rezervasyon iptal edildi`
              )
            } else {
              console.log('✅ Süresi dolan rezervasyon bulunamadı')
            }
          } else {
            console.error(
              '❌ Rezervasyon kontrolü başarısız:',
              response.statusText
            )
          }
        } catch (error) {
          console.error('❌ Rezervasyon kontrol hatası:', error.message)
        }
      },
      {
        scheduled: false,
        timezone: 'Europe/Istanbul',
      }
    )

    this.cronJob.start()
    this.isRunning = true
    console.log(
      '✅ Reservation scheduler başlatıldı - Her 2 dakikada bir kontrol edilecek'
    )
  }

  // Scheduler'ı durdur
  stop() {
    if (this.cronJob) {
      this.cronJob.stop()
      this.isRunning = false
      console.log('❌ Reservation scheduler durduruldu')
    }
  }

  // Manuel kontrol çalıştır
  async checkNow() {
    try {
      console.log('Manuel rezervasyon kontrolü başlatılıyor...')

      const response = await fetch(
        `${this.baseUrl}/api/reservations/check-expired`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.ok) {
        const result = await response.json()
        console.log('✅ Manuel kontrol tamamlandı:', result.message)
        return result
      } else {
        console.error('❌ Manuel kontrol başarısız:', response.statusText)
        return null
      }
    } catch (error) {
      console.error('❌ Manuel kontrol hatası:', error.message)
      return null
    }
  }

  // Durum bilgisi
  getStatus() {
    return {
      isRunning: this.isRunning,
      baseUrl: this.baseUrl,
    }
  }
}

// Singleton instance
const reservationScheduler = new ReservationScheduler()

export default reservationScheduler
