// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.PG_CONN_STRING,
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};
