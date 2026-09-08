// db.js — opens (or creates) the SQLite database and applies the schema.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function openDatabase(filePath = path.join(__dirname, 'cafe-inventory.db')) {
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  return db;
}

module.exports = { openDatabase };
