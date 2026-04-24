const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ DB Error:', err.message);
  } else {
    console.log('✅ Saftech: Connected to Supabase');
    release();
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
};