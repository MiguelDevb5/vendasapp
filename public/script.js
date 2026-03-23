// --- STATE MANAGEMENT (API Integration) ---
const Store = {
    products: [],
    sales: [],
    token: localStorage.getItem('vendas_token') || null,

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            ...(this.token && { 'Authorization': `Bearer ${this.token}` })
        };
    },

    async login(username, password) {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if(!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro no login');
        }
        const data = await res.json();
        this.token = data.token;
        localStorage.setItem('vendas_token', this.token);
    },

    async register(username, password) {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if(!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro no cadastro');
        }
        // Auto login after register
        await this.login(username, password);
    },

    logout() {
        this.token = null;
        localStorage.removeItem('vendas_token');
        window.location.reload();
    },
    
    async loadState() {
        try {
            const [prodRes, salesRes] = await Promise.all([
                fetch('/api/products', { headers: this.getHeaders() }),
                fetch('/api/sales', { headers: this.getHeaders() })
            ]);
            if(prodRes.status === 401 || prodRes.status === 403) throw new Error('AuthError');
            this.products = await prodRes.json();
            this.sales = await salesRes.json();
        } catch (err) {
            if(err.message === 'AuthError') throw err;
            console.error('Failed to load state', err);
            showToast('Erro ao carregar dados do servidor', 'error');
        }
    },
    
    getProducts() {
        return this.products;
    },
    
    async addProduct(product) {
        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(product)
            });
            const newProd = await res.json();
            this.products.unshift(newProd); // prepend
            return newProd;
        } catch (err) {
            console.error(err);
            throw err;
        }
    },
    
    async restockProduct(id, qtyChange) {
        try {
            const res = await fetch(`/api/products/${id}/stock`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({ qtyChange })
            });
            const updatedProd = await res.json();
            const index = this.products.findIndex(p => p.id == id);
            if(index !== -1) {
                this.products[index].stock = updatedProd.stock;
            }
            return updatedProd;
        } catch (err) {
            console.error(err);
            throw err;
        }
    },
    
    getSales() {
        return this.sales;
    },
    
    async addSale(sale) {
        try {
            const res = await fetch('/api/sales', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(sale)
            });
            
            if(!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Erro ao vender');
            }
            
            const newSale = await res.json();
            this.sales.unshift(newSale);
            
            // update stock locally for immediate visual update
            const pIdx = this.products.findIndex(p => p.id == sale.productId);
            if(pIdx !== -1) this.products[pIdx].stock -= sale.quantity;
            
            return newSale;
        } catch (err) {
            console.error(err);
            throw err;
        }
    },
    
    async deleteSale(id) {
        try {
            const res = await fetch(`/api/sales/${id}`, { method: 'DELETE', headers: this.getHeaders() });
            if(!res.ok) throw new Error('Erro ao apagar venda');
            
            const index = this.sales.findIndex(s => s.id == id);
            if(index !== -1) {
                const sale = this.sales[index];
                // Restore local stock for immediate feedback
                const pIdx = this.products.findIndex(p => p.id == sale.productId);
                if(pIdx !== -1) this.products[pIdx].stock += sale.quantity;
                
                this.sales.splice(index, 1);
            }
        } catch (err) {
            console.error(err);
            throw err;
        }
    }
};

// --- UTILITIES ---
const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatDate = (isoString) => {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).format(date);
};

const getDayGroup = (isoString) => {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};

const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// --- UI UPDATES ---
const UI = {
    renderDashboard() {
        const products = Store.getProducts();
        const sales = Store.getSales();

        let totalRevenue = 0;
        let totalProfit = 0;
        
        sales.forEach(sale => {
            totalRevenue += parseFloat(sale.totalPrice);
            totalProfit += parseFloat(sale.totalProfit);
        });

        const totalStock = products.reduce((acc, p) => acc + p.stock, 0);

        document.getElementById('dashboard-revenue').innerText = formatCurrency(totalRevenue);
        document.getElementById('dashboard-profit').innerText = formatCurrency(totalProfit);
        document.getElementById('dashboard-stock').innerText = `${totalStock} un`;
        document.getElementById('dashboard-sales-count').innerText = sales.length;

        // Render low stock alerts
        const lowStockContainer = document.getElementById('dashboard-low-stock');
        lowStockContainer.innerHTML = '';
        const lowStockProducts = products.filter(p => p.stock < 5).sort((a,b) => a.stock - b.stock);
        if(lowStockProducts.length === 0) {
            lowStockContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.9rem;">Tudo certo com o estoque!</span>`;
        } else {
            lowStockProducts.forEach(p => {
                lowStockContainer.innerHTML += `
                    <div class="alert-item">
                        <span>${p.name} ${p.category ? `(${p.category})` : ''}</span>
                        <span class="badge ${p.stock === 0 ? 'badge-danger' : 'badge-warning'}">${p.stock} un</span>
                    </div>
                `;
            });
        }

        // Render recent sales
        const recentBody = document.getElementById('dashboard-recent-sales');
        recentBody.innerHTML = '';
        const recentSales = sales.slice(0, 5); // Already sorted desc from state
        
        if (recentSales.length === 0) {
            recentBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted)">Nenhuma venda registrada ainda.</td></tr>`;
        } else {
            recentSales.forEach(sale => {
                recentBody.innerHTML += `
                    <tr>
                        <td><strong>${sale.productName}</strong></td>
                        <td style="color: var(--text-muted)">${formatDate(sale.timestamp)}</td>
                        <td>${sale.quantity}x</td>
                        <td style="color: var(--success); font-weight: 600;">${formatCurrency(sale.totalPrice)}</td>
                    </tr>
                `;
            });
        }
    },

    renderInventoryTable() {
        const products = Store.getProducts();
        const list = document.getElementById('inventory-list');
        list.innerHTML = '';
        
        if (products.length === 0) {
            list.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 2rem;">Nenhum produto cadastrado.</td></tr>`;
            return;
        }

        products.forEach(p => {
            const stockClass = p.stock <= 5 ? (p.stock === 0 ? 'badge-danger' : 'badge-warning') : 'badge-success';
            const stockText = p.stock === 0 ? 'Sem Estoque' : `${p.stock} un`;

            list.innerHTML += `
                <tr>
                    <td>
                        <strong>${p.name}</strong>
                        ${p.barcode ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;"><i class="ri-barcode-box-line"></i> ${p.barcode}</div>` : ''}
                    </td>
                    <td style="color: var(--text-muted);">${p.category || '-'}</td>
                    <td>${formatCurrency(p.cost)}</td>
                    <td>${formatCurrency(p.price)}</td>
                    <td><span class="badge ${stockClass}">${stockText}</span></td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="App.restockProduct(${p.id})">
                            <i class="ri-add-line"></i> Repor
                        </button>
                    </td>
                </tr>
            `;
        });
    },

    renderSalesForm() {
        const products = Store.getProducts();
        const select = document.getElementById('sale-product');
        // keep first option disabled
        select.innerHTML = '<option value="" disabled selected>Escolha um produto do estoque...</option>';
        
        products.forEach(p => {
            if(p.stock > 0) {
                select.innerHTML += `<option value="${p.id}" data-price="${p.price}" data-cost="${p.cost}">${p.name} (${p.stock} un disponíveis) - ${formatCurrency(p.price)}</option>`;
            }
        });

        // Reset inputs
        document.getElementById('sale-quantity').value = 1;
        document.getElementById('sale-total').value = '';
    },

    renderHistory() {
        const sales = Store.getSales();
        const container = document.getElementById('history-grouped-list');
        container.innerHTML = '';

        if (sales.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 3rem; color: var(--text-muted);">Nenhum histórico de vendas.</div>`;
            return;
        }
        
        // Group by day
        const grouped = {};
        sales.forEach(s => {
            const day = getDayGroup(s.timestamp);
            if(!grouped[day]) grouped[day] = [];
            grouped[day].push(s);
        });

        Object.keys(grouped).forEach(day => {
            let groupHtml = `<div class="history-day-group"><h3>${day}</h3><div class="history-list">`;
            
            grouped[day].forEach(sale => {
                groupHtml += `
                    <div class="history-item">
                        <div class="hi-details">
                            <span class="hi-title">${sale.quantity}x ${sale.productName}</span>
                            <span class="hi-meta"><i class="ri-time-line"></i> ${formatDate(sale.timestamp).split(' ')[1]}</span>
                        </div>
                        <div style="display: flex; align-items: center;">
                            <div class="hi-amounts">
                                <span class="hi-total">+ ${formatCurrency(sale.totalPrice)}</span>
                                <span class="hi-profit">Lucro: ${formatCurrency(sale.totalProfit)}</span>
                            </div>
                            <div class="hi-actions">
                                <button class="btn btn-danger" onclick="App.handleDeleteSale(${sale.id})" title="Apagar Venda">
                                    <i class="ri-delete-bin-line"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });

            groupHtml += `</div></div>`;
            container.innerHTML += groupHtml;
        });
    },

    updateSalesTotalPreview() {
        const select = document.getElementById('sale-product');
        const qtyInput = document.getElementById('sale-quantity');
        const totalInput = document.getElementById('sale-total');

        if(select.value) {
            const selectedOpt = select.options[select.selectedIndex];
            const price = parseFloat(selectedOpt.getAttribute('data-price'));
            const qty = parseInt(qtyInput.value) || 0;
            totalInput.value = formatCurrency(price * qty);
        } else {
            totalInput.value = '';
        }
    }
};

// --- CONTROLLER / APP LOGIC ---
const App = {
    async init() {
        this.bindEvents();
        
        if (Store.token) {
            try {
                await Store.loadState();
                this.updateAllViews();
                document.getElementById('login-screen').classList.remove('active');
                document.getElementById('main-app').style.display = 'flex';
            } catch(e) {
                // Token invalid or expired
                Store.logout();
            }
        }
        
        // Setup Date
        const now = new Date();
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('current-date').innerText = now.toLocaleDateString('pt-BR', dateOptions);
    },

    updateAllViews() {
        UI.renderDashboard();
        UI.renderInventoryTable();
        UI.renderSalesForm();
        UI.renderHistory();
    },

    bindEvents() {
        // Auth
        document.getElementById('form-login')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            btn.disabled = true;
            try {
                await Store.login(document.getElementById('login-username').value, document.getElementById('login-password').value);
                await App.init();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
        
        document.getElementById('form-register')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            btn.disabled = true;
            try {
                await Store.register(document.getElementById('reg-username').value, document.getElementById('reg-password').value);
                await App.init();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });

        document.getElementById('link-show-register')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form-container').style.display = 'none';
            document.getElementById('register-form-container').style.display = 'block';
        });
        
        document.getElementById('link-show-login')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form-container').style.display = 'none';
            document.getElementById('login-form-container').style.display = 'block';
        });

        document.getElementById('btn-logout')?.addEventListener('click', () => Store.logout());

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const target = e.currentTarget.getAttribute('data-target');
                window.navTo(target);
            });
        });

        // Add Product Modal
        document.getElementById('btn-add-product').addEventListener('click', () => {
            document.getElementById('modal-product').classList.add('active');
        });

        document.getElementById('btn-close-product').addEventListener('click', () => {
            document.getElementById('modal-product').classList.remove('active');
        });

        document.getElementById('btn-cancel-product').addEventListener('click', () => {
            document.getElementById('modal-product').classList.remove('active');
        });

        // Form Submit: Add Product
        document.getElementById('form-product').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true;

            const name = document.getElementById('prod-name').value;
            const category = document.getElementById('prod-category').value;
            const barcode = document.getElementById('prod-barcode').value;
            const cost = parseFloat(document.getElementById('prod-cost').value);
            const price = parseFloat(document.getElementById('prod-price').value);
            const stock = parseInt(document.getElementById('prod-stock').value);

            try {
                await Store.addProduct({ name, category, barcode, cost, price, stock });
                
                e.target.reset();
                document.getElementById('modal-product').classList.remove('active');
                this.updateAllViews();
                showToast('Produto adicionado ao estoque!');
            } catch (err) {
                showToast('Erro ao adicionar produto', 'error');
            } finally {
                btn.disabled = false;
            }
        });

        // Sales Form updates total automatically
        document.getElementById('sale-product').addEventListener('change', UI.updateSalesTotalPreview);
        document.getElementById('sale-quantity').addEventListener('input', UI.updateSalesTotalPreview);

        // Barcode fast select
        document.getElementById('sale-barcode')?.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') {
                e.preventDefault();
                const code = e.target.value.trim();
                const product = Store.getProducts().find(p => p.barcode === code);
                if(product) {
                    if(product.stock > 0) {
                        document.getElementById('sale-product').value = product.id;
                        UI.updateSalesTotalPreview();
                        e.target.value = ''; // clear
                        showToast(`Produto bipado: ${product.name}`);
                    } else {
                        showToast('Produto fora de estoque!', 'error');
                    }
                } else {
                    showToast('Código não encontrado', 'error');
                }
            }
        });

        // Form Submit: Sale
        document.getElementById('form-sale').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            
            const select = document.getElementById('sale-product');
            if(!select.value) {
                showToast('Selecione um produto!', 'error');
                return;
            }

            const productId = select.value;
            const selectedOpt = select.options[select.selectedIndex];
            const productName = selectedOpt.text.split(' (')[0]; 
            const price = parseFloat(selectedOpt.getAttribute('data-price'));
            const cost = parseFloat(selectedOpt.getAttribute('data-cost'));
            const quantity = parseInt(document.getElementById('sale-quantity').value);

            const totalPrice = price * quantity;
            const totalCost = cost * quantity;
            const totalProfit = totalPrice - totalCost;

            try {
                btn.disabled = true;
                await Store.addSale({ productId, productName, quantity, price, cost, totalPrice, totalProfit });
                
                this.updateAllViews();
                showToast('Venda registrada com sucesso!');
                window.navTo('dashboard');
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });
    },

    async handleDeleteSale(id) {
        if(confirm('Tem certeza que deseja apagar esta venda? O estoque será devolvido.')) {
            try {
                await Store.deleteSale(id);
                this.updateAllViews();
                showToast('Venda apagada e estoque atualizado.');
            } catch(e) {
                showToast('Erro ao apagar venda', 'error');
            }
        }
    },

    async restockProduct(id) {
        const qty = prompt('Adicionar qual quantidade ao estoque?');
        const parsed = parseInt(qty);
        if(parsed && parsed > 0) {
            try {
                await Store.restockProduct(id, parsed);
                this.updateAllViews();
                showToast('Estoque atualizado com sucesso!');
            } catch (e) {
                showToast('Erro ao atualizar estoque', 'error');
            }
        }
    }
};

// Global Nav Function
window.navTo = (targetId) => {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-item[data-target="${targetId}"]`).classList.add('active');

    document.querySelectorAll('.content-section').forEach(el => el.classList.remove('active'));
    document.getElementById(targetId).classList.add('active');
};

// EXPORT TO GLOBAL WINDOW OBJECT FOR INLINE EVENTS
window.App = App;

// Start App
document.addEventListener('DOMContentLoaded', () => {
    window.App.init();
});
