const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: process.env.DB_USER || 'vendas_user',
    host: process.env.DB_HOST || 'db', // Note: host is 'db' in docker network
    database: process.env.DB_NAME || 'vendasapp',
    password: process.env.DB_PASSWORD || 'vendas_password',
    port: process.env.DB_PORT || 5432,
});

async function seed() {
    try {
        const hash = await bcrypt.hash('admin123', 10);
        const res = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING', ['admin', hash]);
        if(res.rowCount > 0) {
            console.log('✅ Default Admin user created successfully (username: admin, pass: admin123).');
        } else {
            console.log('✅ Admin user already exists.');
        }
    } catch(err) {
        console.error('❌ Error creating admin user:', err);
    } finally {
        pool.end();
    }
}
seed();
