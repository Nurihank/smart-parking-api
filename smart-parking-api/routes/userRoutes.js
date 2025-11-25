import { db } from '../config/database.js' // db olarak import ediyoruz
import express from 'express'
const router = express.Router()
import bcrypt from 'bcryptjs'


router.post('/register', async (req, res) => {
  const { email, password, fullName } = req.body
  const hashedPassword = await bcrypt.hash(password, 10)

  try {
    const isUserExist = await db.query('SELECT * FROM users WHERE email = ?', [
      email,
    ])
    if (isUserExist.length > 0) {
      return res.status(400).json({ message: 'User already exists' })
    }
    const response = await db.query(
      'INSERT INTO users (email, password, full_name) VALUES (?, ?, ?)',
      [email, hashedPassword, fullName]
    )
    if (response.affectedRows === 0) {
      return res.status(500).json({ message: 'Failed to register user' })
    }
    res.status(201).json({ message: 'User registered successfully' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Internal Server Error' })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body

  try {
    const users = await db.query('SELECT * FROM users WHERE email = ?', [email])

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    const user = users[0]

    const isPasswordValid = await bcrypt.compare(password, user.password_hash)
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    res.status(200).json({ message: 'Login successful', user_id: user.user_id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Internal Server Error' })
  }
})

export default router
