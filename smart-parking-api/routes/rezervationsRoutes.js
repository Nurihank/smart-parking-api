import { db } from '../config/database.js' // db olarak import ediyoruz
import express from 'express'
const router = express.Router()

// Rezervasyon oluşturma (Mobil uygulama için)
router.post('/reservations', async (req, res) => {
  const { user_id, spot_id, vehicle_id } = req.body

  try {
    // Önce kullanıcının aktif bir rezervasyonu olup olmadığını kontrol et
    const [existingReservation] = await db.query(
      'SELECT reservation_id FROM reservations WHERE user_id = ? AND reservation_status = ?',
      [user_id, 'Aktif']
    )

    if (existingReservation) {
      return res.status(400).json({
        error: 'Zaten aktif bir rezervasyonunuz bulunmaktadır',
        existing_reservation_id: existingReservation.reservation_id,
      })
    }

    // Önce spot'un müsait olup olmadığını kontrol et
    const [spotCheck] = await db.query(
      'SELECT status FROM parkingspots WHERE spot_id = ?',
      [spot_id]
    )

    if (!spotCheck || spotCheck.status !== 'Boş') {
      return res.status(400).json({ error: 'Park yeri müsait değil' })
    }

    const start_time = new Date()
    const expected_end_time = new Date(start_time.getTime() + 10 * 60 * 1000) // +10 dakika

    // Rezervasyon oluştur
    const [reservationResult] = await db.query(
      `INSERT INTO reservations 
            (user_id, spot_id, vehicle_id, start_time, expected_end_time, reservation_status)
            VALUES (?, ?, ?, ?, ?, 'Aktif')`,
      [user_id, spot_id, vehicle_id, start_time, expected_end_time]
    )

    // Park yerini rezerve durumuna getir
    await db.query('UPDATE parkingspots SET status = ? WHERE spot_id = ?', [
      'Rezerve',
      spot_id,
    ])

    // Durum log'unu kaydet
    await db.query(
      'INSERT INTO spotstatuslog (spot_id, status) VALUES (?, ?)',
      [spot_id, 'Rezerve']
    )

    res.status(201).json({
      message: 'Rezervasyon oluşturuldu',
      reservation_id: reservationResult.insertId,
      expected_end_time: expected_end_time,
    })
  } catch (error) {
    console.error('Error creating reservation:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Araç geldiğinde durumu güncelleme (ESP32/MQTT için)
router.put('/reservations/:reservationId/vehicle-arrived', async (req, res) => {
  const { reservationId } = req.params
  const { spot_id } = req.body

  try {
    // Rezervasyonun aktif olup olmadığını kontrol et
    const [reservation] = await db.query(
      'SELECT * FROM reservations WHERE reservation_id = ? AND reservation_status = ?',
      [reservationId, 'Aktif']
    )

    if (!reservation) {
      return res.status(404).json({ error: 'Aktif rezervasyon bulunamadı' })
    }

    // Park yerini dolu durumuna getir
    await db.query('UPDATE parkingspots SET status = ? WHERE spot_id = ?', [
      'Dolu',
      spot_id,
    ])

    // Rezervasyon durumunu güncelle (araç geldi, park etti)
    const actual_end_time = new Date()
    await db.query(
      'UPDATE reservations SET actual_end_time = ? WHERE reservation_id = ?',
      [actual_end_time, reservationId]
    )

    // Durum log'unu kaydet
    await db.query(
      'INSERT INTO spotstatuslog (spot_id, status) VALUES (?, ?)',
      [spot_id, 'Dolu']
    )

    res.json({
      message: 'Araç park yerine ulaştı, durum güncellendi',
      actual_arrival_time: actual_end_time,
    })
  } catch (error) {
    console.error('Error updating vehicle arrival:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Araç ayrıldığında durumu güncelleme (ESP32/MQTT için)
router.put('/reservations/:reservationId/vehicle-left', async (req, res) => {
  const { reservationId } = req.params
  const { spot_id } = req.body

  try {
    // Önce rezervasyon bilgilerini al (süre hesaplamak için)
    const [reservation] = await db.query(
      'SELECT * FROM reservations WHERE reservation_id = ?',
      [reservationId]
    )

    if (!reservation) {
      return res.status(404).json({ error: 'Rezervasyon bulunamadı' })
    }

    const actual_end_time = new Date()
    const start_time = new Date(reservation.start_time)
    const parking_duration = Math.round(
      (actual_end_time - start_time) / (1000 * 60)
    ) // Dakika cinsinden

    // Rezervasyonu bitir ve ayrılış zamanını kaydet
    await db.query(
      'UPDATE reservations SET reservation_status = ?, actual_end_time = ? WHERE reservation_id = ?',
      ['Bitti', actual_end_time, reservationId]
    )

    // Park yerini boş durumuna getir
    await db.query('UPDATE parkingspots SET status = ? WHERE spot_id = ?', [
      'Boş',
      spot_id,
    ])

    // Durum log'unu kaydet
    await db.query(
      'INSERT INTO spotstatuslog (spot_id, status) VALUES (?, ?)',
      [spot_id, 'Boş']
    )

    res.json({
      message: 'Araç ayrıldı, park yeri müsaite açıldı',
      actual_departure_time: actual_end_time,
      parking_duration_minutes: parking_duration,
      parking_start_time: start_time,
    })
  } catch (error) {
    console.error('Error updating vehicle departure:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Manuel rezervasyon iptali
router.put('/reservations/:reservationId/cancel', async (req, res) => {
  const { reservationId } = req.params

  try {
    // Rezervasyonu iptal et
    const [result] = await db.query(
      'UPDATE reservations SET reservation_status = ? WHERE reservation_id = ? AND reservation_status = ?',
      ['İptalEdildi', reservationId, 'Aktif']
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Aktif rezervasyon bulunamadı' })
    }

    // Park yerini tekrar boş yap
    const [reservation] = await db.query(
      'SELECT spot_id FROM reservations WHERE reservation_id = ?',
      [reservationId]
    )

    if (reservation) {
      await db.query('UPDATE parkingspots SET status = ? WHERE spot_id = ?', [
        'Boş',
        reservation.spot_id,
      ])

      // Durum log'unu kaydet
      await db.query(
        'INSERT INTO spotstatuslog (spot_id, status) VALUES (?, ?)',
        [reservation.spot_id, 'Boş']
      )
    }

    res.json({
      message: 'Rezervasyon iptal edildi',
    })
  } catch (error) {
    console.error('Error cancelling reservation:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Süresi dolan rezervasyonları kontrol etme (Cron job için)
router.post('/reservations/check-expired', async (req, res) => {
  try {
    const currentTime = new Date()

    // Süresi dolan aktif rezervasyonları bul
    const [expiredReservations] = await db.query(
      `SELECT reservation_id, spot_id 
       FROM reservations 
       WHERE reservation_status = 'Aktif' 
       AND expected_end_time < ? 
       AND actual_end_time IS NULL`,
      [currentTime]
    )

    let cancelledCount = 0

    for (const reservation of expiredReservations) {
      // Rezervasyonu iptal et
      await db.query(
        'UPDATE reservations SET reservation_status = ? WHERE reservation_id = ?',
        ['İptalEdildi', reservation.reservation_id]
      )

      // Park yerini boş yap
      await db.query('UPDATE parkingspots SET status = ? WHERE spot_id = ?', [
        'Boş',
        reservation.spot_id,
      ])

      // Durum log'unu kaydet
      await db.query(
        'INSERT INTO spotstatuslog (spot_id, status) VALUES (?, ?)',
        [reservation.spot_id, 'Boş']
      )

      cancelledCount++
    }

    res.json({
      message: `${cancelledCount} adet süresi dolan rezervasyon iptal edildi`,
      cancelled_reservations: expiredReservations.length,
    })
  } catch (error) {
    console.error('Error checking expired reservations:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Aktif rezervasyonları listeleme
router.get('/reservations/active', async (req, res) => {
  try {
    const [activeReservations] = await db.query(
      `SELECT r.*, u.username, p.spot_name, v.plate_number
       FROM reservations r
       LEFT JOIN users u ON r.user_id = u.user_id
       LEFT JOIN parkingspots p ON r.spot_id = p.spot_id
       LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
       WHERE r.reservation_status = 'Aktif'
       ORDER BY r.start_time DESC`
    )

    res.json({
      message: 'Aktif rezervasyonlar listelendi',
      data: activeReservations,
    })
  } catch (error) {
    console.error('Error fetching active reservations:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Kullanıcının aktif rezervasyonunu getir
router.get('/reservations/user/:userId/active', async (req, res) => {
  const { userId } = req.params

  try {
    const [activeReservation] = await db.query(
      `SELECT r.*, p.spot_name, v.plate_number
       FROM reservations r
       LEFT JOIN parkingspots p ON r.spot_id = p.spot_id
       LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
       WHERE r.user_id = ? AND r.reservation_status = 'Aktif'`,
      [userId]
    )

    if (!activeReservation) {
      return res.json({
        message: 'Aktif rezervasyon bulunamadı',
        data: null,
      })
    }

    res.json({
      message: 'Kullanıcının aktif rezervasyonu getirildi',
      data: activeReservation,
    })
  } catch (error) {
    console.error('Error fetching user active reservation:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Kullanıcının rezervasyon geçmişi
router.get('/reservations/user/:userId', async (req, res) => {
  const { userId } = req.params

  try {
    const [userReservations] = await db.query(
      `SELECT r.*, p.spot_name, v.plate_number
       FROM reservations r
       LEFT JOIN parkingspots p ON r.spot_id = p.spot_id
       LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
       WHERE r.user_id = ?
       ORDER BY r.start_time DESC`,
      [userId]
    )

    res.json({
      message: 'Kullanıcı rezervasyonları listelendi',
      data: userReservations,
    })
  } catch (error) {
    console.error('Error fetching user reservations:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Park yeri durumlarını gösterme
router.get('/parking-spots/status', async (req, res) => {
  try {
    const [spots] = await db.query(
      'SELECT * FROM parkingspots ORDER BY spot_id'
    )

    res.json({
      message: 'Park yeri durumları listelendi',
      data: spots,
    })
  } catch (error) {
    console.error('Error fetching parking spots:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
