const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));

app.use(bodyParser.json());

// Initialize SQLite database
const dbFile = path.resolve(__dirname, 'botdata.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegramId TEXT UNIQUE,
    username TEXT,
    firstName TEXT,
    lastName TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    content TEXT,
    imageUrl TEXT,
    scheduledFor DATETIME,
    sent BOOLEAN DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);

  // Add other tables for promotions, pricing, analytics as needed
});

app.get('/', (req, res) => {
  res.send('Bot Management API running');
});

// Export db to use in other modules
module.exports = { app, db };

app.get('/users', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/messages', (req, res) => {
  const { userId, content, imageUrl, scheduledFor } = req.body;
  if (!userId || !content) {
    return res.status(400).json({ error: 'userId and content are required' });
  }

  const sql = 'INSERT INTO messages (userId, content, imageUrl, scheduledFor) VALUES (?, ?, ?, ?)';
  db.run(sql, [userId, content, imageUrl || null, scheduledFor || null], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ message: 'Message created', id: this.lastID });
  });
});

app.listen(PORT, () => {
  console.log('Server listening on port ' + PORT);
});
