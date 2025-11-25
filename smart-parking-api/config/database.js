import mysql from 'mysql2'

export default class DatabaseConfig {
  constructor() {
    this.host = 'localhost'
    this.user = 'root'
    this.password = 'nurihan38'
    this.database = 'smart_parking'

    this.connection = mysql.createPool({
      host: this.host,
      user: this.user,
      password: this.password,
      database: this.database,
      connectionLimit: 10,
    })
    
    // Bağlantıyı test et
    this.testConnection()
  }
  
  testConnection() {
    this.connection.getConnection((err, connection) => {
      if (err) {
        console.error('Database connection failed:', err)
        return
      }
      console.log('Database connected successfully')
      connection.release()
    })
  }

  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, params, (err, results) => {
        if (err) return reject(err)
        resolve(results)
      })
    })
  }
}

// ESM’de default export
export const db = new DatabaseConfig()
