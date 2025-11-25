import express from 'express'
const router = express.Router()
import { db } from '../config/database.js' // db olarak import ediyoruz

router.get('/vehicleTypes', async (req, res) => {
  try {
    const vehicleTypes = await db.query(
      'SELECT * FROM smart_parking.vehicletypes'
    )
    console.log('Vehicle types from DB:', vehicleTypes) // Debug için
    res.status(200).json(vehicleTypes)
  } catch (error) {
    console.error('Database error:', error) // Hatayı logla
    res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message })
  }
})

router.post('/saveVehicle', async (req, res) => {
  const { user_id, plate_number, vehicle_type_id } = req.body

  try {
    const existing = await db.query(
      'SELECT * FROM vehicles WHERE user_id = ?',
      [user_id]
    )
    if (existing.length > 0) {
      return res
        .status(400)
        .json({ message: 'User already has a vehicle registered' })
    }
    const response = await db.query(
      'INSERT INTO vehicles (user_id, plate_number, vehicle_type_id) VALUES (?, ?, ?)',
      [user_id, plate_number, vehicle_type_id]
    )
    if (response.affectedRows === 0) {
      return res.status(500).json({ message: 'Failed to save vehicle' })
    }
    res.status(201).json({ message: 'Vehicle saved successfully' })
  } catch (error) {
    console.error('Save vehicle error:', error) // Hatayı logla
    res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message })
  }
})

export default router
