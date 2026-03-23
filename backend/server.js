const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));

// Database connection
const poolConfig = process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
} : {
    user: process.env.DB_USER || 'vendas_user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'vendasapp',
    password: process.env.DB_PASSWORD || 'vendas_password',
    port: process.env.DB_PORT || 5432,
};

const pool = new Pool(poolConfig);

// Retry DB connection on startup
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const JWT_SECRET = process.env.JWT_SECRET || 'vendas_super_secret_key';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: 'Acesso negado' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Sessão expirada' });
        req.user = user;
        next();
    });
}

// --- API ROUTES ---

// Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role',
            [username, hash]
        );
        res.json({ message: 'Usuário cadastrado com sucesso!', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') { // unique violation
            return res.status(400).json({ error: 'Este nome de usuário já existe' });
        }
        console.error(err);
        res.status(500).json({ error: 'Erro interno ao cadastrar' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Senha incorreta' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ token, user: { username: user.username, role: user.role } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Get all products
app.get('/api/products', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

// Add a product
app.post('/api/products', authenticateToken, async (req, res) => {
    const { name, category, barcode, cost, price, stock } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO products (name, category, barcode, cost, price, stock, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [name, category, barcode, cost, price, stock, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar produto' });
    }
});

// Update product stock (restock)
app.put('/api/products/:id/stock', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { qtyChange } = req.body;
    try {
        const result = await pool.query(
            'UPDATE products SET stock = stock + $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [qtyChange, id, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar estoque' });
    }
});

// Get all sales
app.get('/api/sales', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sales WHERE user_id = $1 ORDER BY timestamp DESC', [req.user.id]);
        // Rename keys to match frontend (total_price -> totalPrice)
        const mappedRows = result.rows.map(row => ({
            id: row.id,
            productId: row.product_id,
            productName: row.product_name,
            quantity: row.quantity,
            price: row.price,
            cost: row.cost,
            totalPrice: row.total_price,
            totalProfit: row.total_profit,
            timestamp: row.timestamp
        }));
        res.json(mappedRows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar vendas' });
    }
});

// Add a sale
app.post('/api/sales', authenticateToken, async (req, res) => {
    const { productId, productName, quantity, price, cost, totalPrice, totalProfit } = req.body;
    
    // Use transaction
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Check stock
        const productRes = await client.query('SELECT stock FROM products WHERE id = $1 AND user_id = $2 FOR UPDATE', [productId, req.user.id]);
        if(productRes.rows.length === 0) throw new Error('Produto não encontrado');
        if(productRes.rows[0].stock < quantity) throw new Error('Estoque insuficiente');
        
        // Update stock
        await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND user_id = $3', [quantity, productId, req.user.id]);
        
        // Insert sale
        const saleRes = await client.query(
            `INSERT INTO sales 
            (product_id, product_name, quantity, price, cost, total_price, total_profit, user_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [productId, productName, quantity, price, cost, totalPrice, totalProfit, req.user.id]
        );
        
        await client.query('COMMIT');
        
        const row = saleRes.rows[0];
        res.json({
            id: row.id,
            productId: row.product_id,
            productName: row.product_name,
            quantity: row.quantity,
            price: row.price,
            cost: row.cost,
            totalPrice: row.total_price,
            totalProfit: row.total_profit,
            timestamp: row.timestamp
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Delete a sale
app.delete('/api/sales/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get sale details
        const saleRes = await client.query('SELECT * FROM sales WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        if(saleRes.rows.length === 0) throw new Error('Venda não encontrada ou sem permissão');
        const sale = saleRes.rows[0];
        
        // Restore stock
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2 AND user_id = $3', [sale.quantity, sale.product_id, req.user.id]);
        
        // Delete sale
        await client.query('DELETE FROM sales WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        
        await client.query('COMMIT');
        res.json({ message: 'Venda apagada e estoque restaurado' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Erro ao apagar venda' });
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`API running on port ${port}`);
});
