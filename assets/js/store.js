/**
 * DataEasy+ - Store Frontend Module
 * Agent store management: data packages, orders, payouts, financials
 */

const StoreApp = (function() {
    'use strict';

    const API = window.API_BASE_URL || '/api';
    let store = null;
    let packages = { MTN: [], AirtelTigo: [], Telecel: [] };
    let currentNetwork = 'MTN';
    let orderNetwork = 'MTN';
    let currentTab = 'overview';
    let allOrders = [];

    // ==========================================
    // AUTH & HTTP
    // ==========================================
    function getToken() {
        try {
            const session = localStorage.getItem('dataeasy_session');
            if (session) return JSON.parse(session).token;
        } catch (e) {}
        return null;
    }

    async function apiRequest(endpoint, options = {}) {
        const token = getToken();
        if (!token) {
            window.location.href = '../pages/login';
            return;
        }

        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers };
        const response = await fetch(`${API}${endpoint}`, { ...options, headers });
        const data = await response.json();

        if (response.status === 401) {
            localStorage.removeItem('dataeasy_session');
            window.location.href = '../pages/login';
            return;
        }
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    // ==========================================
    // TOAST
    // ==========================================
    function toast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-indigo-600', warning: 'bg-yellow-600' };
        const icons = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle', warning: 'exclamation-triangle' };
        const el = document.createElement('div');
        el.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm slide-in-right`;
        el.innerHTML = `<i class="fas fa-${icons[type]}"></i> ${message}`;
        container.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
    }

    // ==========================================
    // MODAL
    // ==========================================
    function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
    }
    function closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    }

    // ==========================================
    // INIT
    // ==========================================
    async function init() {
        if (!getToken()) {
            window.location.href = '../pages/login';
            return;
        }

        setupEventListeners();
        await loadStore();
    }

    function slugify(s) {
        return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function storeRef() {
        if (!store) return '';
        return (store.name && slugify(store.name)) || store.id || '';
    }

    const THEMES = {
        blue:   ['#1e40af', '#2563eb', '#3b82f6'],
        amber:  ['#b45309', '#d97706', '#f59e0b'],
        red:    ['#991b1b', '#dc2626', '#ef4444'],
        green:  ['#15803d', '#16a34a', '#22c55e'],
        purple: ['#6b21a8', '#9333ea', '#a855f7'],
        orange: ['#c2410c', '#ea580c', '#f97316'],
        teal:   ['#0f766e', '#0d9488', '#14b8a6']
    };

    function storeTheme() {
        return (store && store.metadata && store.metadata.theme) || 'blue';
    }

    function applyBannerTheme(theme) {
        const c = THEMES[theme] || THEMES.blue;
        const banner = document.querySelector('.store-banner');
        if (banner) banner.style.background = `linear-gradient(120deg, ${c[0]} 0%, ${c[1]} 55%, ${c[2]} 100%)`;
    }

    function getStoreUrl() {
        const ref = storeRef();
        return ref ? `${window.location.origin}/s/${ref}` : '';
    }

    async function loadStore() {
        try {
            const data = await apiRequest('/store');
            store = data.store;
            document.getElementById('noStoreSection').classList.add('hidden');
            const shell = document.getElementById('storeShell');
            if (shell) shell.classList.remove('hidden');

            // Banner
            const slug = storeRef();
            const storeUrl = getStoreUrl();
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
            set('storeName', store.name || 'My Store');
            set('storeCode', store.id ? String(store.id).slice(0, 5) : '');
            set('publicLinkText', '/s/' + slug);

            const pill = document.getElementById('publicLinkPill');
            if (pill && storeUrl) pill.href = storeUrl;
            const viewBtn = document.getElementById('viewStoreBtn');
            if (viewBtn && storeUrl) viewBtn.href = storeUrl;
            const copyBtn = document.getElementById('copyLinkBtn');
            if (copyBtn) copyBtn.onclick = () => {
                if (!storeUrl) return;
                navigator.clipboard.writeText(storeUrl)
                    .then(() => toast('Store link copied!', 'success'))
                    .catch(() => prompt('Copy your store link:', storeUrl));
            };

            applyBannerTheme(storeTheme());

            loadDashboard();
            loadPackages();
        } catch (e) {
            if (e.message.includes('not found') || e.message.includes('Create a store')) {
                document.getElementById('noStoreSection').classList.remove('hidden');
                const shell = document.getElementById('storeShell');
                if (shell) shell.classList.add('hidden');
            } else {
                toast(e.message, 'error');
            }
        }
    }

    // ==========================================
    // TAB NAVIGATION
    // ==========================================
    function showTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        const tabEl = document.getElementById(`tab-${tab}`);
        if (tabEl) tabEl.classList.remove('hidden');

        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tab) btn.classList.add('active');
        });

        if (tab === 'overview') loadDashboard();
        else if (tab === 'bundles') loadPackages();
        else if (tab === 'orders') loadOrders();
        else if (tab === 'earnings') loadPayouts();
        else if (tab === 'settings') loadSettings();
    }

    // ==========================================
    // DASHBOARD
    // ==========================================
    async function loadDashboard() {
        try {
            const data = await apiRequest('/store/dashboard');
            const d = data.dashboard;
            const s = d.settlement;
            const totalProfit = (s.totalRevenue || 0) - (s.totalCostOfGoods || 0);

            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('statTotalSales', d.totalOrders);
            set('statTotalRevenue', money(s.totalRevenue));
            set('statTotalProfit', money(totalProfit));
            set('statWithdrawable', money(s.availableBalance));
            set('profitBalanceAmount', money(s.availableBalance));
            set('bundlesListedCount', d.activePackages);
        } catch (e) {
            toast('Failed to load dashboard', 'error');
        }

        loadRecentOrders();
    }

    async function loadRecentOrders() {
        const container = document.getElementById('recentOrdersList');
        try {
            const data = await apiRequest('/store/orders?limit=10&page=1');
            const orders = data.orders || [];
            const total = (data.pagination && (data.pagination.total != null ? data.pagination.total : data.pagination.count)) || orders.length;
            const totalEl = document.getElementById('recentOrdersTotal');
            if (totalEl) totalEl.textContent = total;
            renderRecentOrders(orders);
        } catch (e) {
            if (container) container.innerHTML = '<p class="text-center py-10" style="color:#475569;">Failed to load orders.</p>';
        }
    }

    function renderRecentOrders(orders) {
        const container = document.getElementById('recentOrdersList');
        if (!container) return;

        if (!orders.length) {
            container.innerHTML = '<p class="text-center py-10" style="color:#475569;">No orders yet.</p>';
            return;
        }

        const statusClass = {
            sent: 'st-success', fulfilled: 'st-success', completed: 'st-success', paid: 'st-info',
            processing: 'st-info', pending: 'st-warning', partial: 'st-warning', failed: 'st-error', cancelled: 'st-error', refunded: 'st-error'
        };

        container.innerHTML = orders.map(o => {
            const item = (o.items && o.items[0]) || {};
            const net = item.network || detectNetwork(item.productName || item.data || '');
            const dataLabel = item.data || (item.productName || '').replace(/\s*Data$/i, '').replace(new RegExp('^' + net + '\\s*', 'i'), '') || item.productName || 'Bundle';
            const phone = item.phoneNumber || item.phone || o.customerPhone || '';
            const title = phone ? `${escapeHtml(dataLabel)} — ${escapeHtml(phone)}` : escapeHtml(dataLabel);
            const profit = typeof o.profit === 'number' ? o.profit : ((o.subtotal || 0) - (o.totalCost || 0));
            const status = orderDisplayStatus(o);

            return `
            <div class="order-row">
                <span class="net-badge ${netClass(net)}">${escapeHtml(net)}</span>
                <div class="order-info">
                    <div class="order-title">${title}</div>
                    <div class="order-date">${fmtDateTime(o.createdAt)}</div>
                </div>
                <div class="order-money">
                    <div class="order-amount">${money(o.subtotal)}</div>
                    <div class="order-profit">+${money(profit)}</div>
                </div>
                <span class="status-badge ${statusClass[status] || 'st-info'}">${escapeHtml(o.status || '')}</span>
            </div>`;
        }).join('');
    }

    // ==========================================
    // DATA PACKAGES
    // ==========================================
    async function loadPackages() {
        try {
            const data = await apiRequest('/store/packages');
            packages = data.packages;
            renderPackages();
        } catch (e) {
            toast('Failed to load packages', 'error');
        }
    }

    function renderPackages() {
        const container = document.getElementById('packagesList');
        const networks = ['MTN', 'AirtelTigo', 'Telecel'];
        const networkStyle = {
            MTN: { accent: 'yellow-500', label: 'bg-yellow-500 text-black', icon: 'fa-signal' },
            AirtelTigo: { accent: 'red-500', label: 'bg-red-500 text-white', icon: 'fa-broadcast-tower' },
            Telecel: { accent: 'blue-500', label: 'bg-blue-500 text-white', icon: 'fa-satellite-dish' }
        };

        let html = '';
        let hasAny = false;

        networks.forEach(net => {
            const pkgs = packages[net] || [];
            if (!pkgs.length) return;
            hasAny = true;
            const style = networkStyle[net];

            html += `
            <div class="card overflow-hidden">
                <div class="flex items-center gap-3 px-5 py-3 border-b border-[#374151]">
                    <span class="${style.label} text-xs font-bold px-3 py-1 rounded-full"><i class="fas ${style.icon} mr-1"></i>${escapeHtml(net)}</span>
                    <span class="text-gray-500 text-xs">${pkgs.length} package${pkgs.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="border-b border-[#374151] text-gray-500 text-[11px] uppercase tracking-wider">
                                <th class="text-left py-3 px-5 font-medium">Package</th>
                                <th class="text-right py-3 px-5 font-medium">Cost Price</th>
                                <th class="text-center py-3 px-5 font-medium">Selling Price</th>
                                <th class="text-right py-3 px-5 font-medium">Profit</th>
                            </tr>
                        </thead>
                        <tbody>`;

            pkgs.forEach(p => {
                const hasPrice = p.sellingPrice !== null && p.sellingPrice !== undefined;
                const displayPrice = hasPrice ? 'GH₵' + Number(p.sellingPrice).toFixed(2) : '—';
                const profit = hasPrice ? (p.sellingPrice - p.costPrice).toFixed(2) : '—';
                const profitColor = hasPrice && p.sellingPrice > p.costPrice ? 'text-green-400' : (hasPrice && p.sellingPrice < p.costPrice ? 'text-red-400' : 'text-gray-500');

                html += `
                            <tr class="border-b border-[#374151]/50 hover:bg-[#1f2937]/60 transition-colors" data-row-id="${escapeHtml(p.id)}">
                                <td class="py-3 px-5">
                                    <span class="text-white font-medium text-sm">${escapeHtml(p.data)}</span>
                                    <span class="text-gray-500 text-xs ml-2">${escapeHtml(p.validity || '')}</span>
                                </td>
                                <td class="py-3 px-5 text-right text-gray-400 text-sm tabular-nums">GH₵${p.costPrice.toFixed(2)}</td>
                                <td class="py-3 px-5 text-center">
                                    <div class="pkg-price-cell inline-flex items-center gap-2" data-pkg-id="${escapeHtml(p.id)}" data-cost="${p.costPrice}" data-current="${hasPrice ? p.sellingPrice : ''}">
                                        <span class="pkg-price-display text-green-400 font-semibold text-sm tabular-nums">${displayPrice}</span>
                                        <input type="number" step="0.01" min="${p.costPrice}" value="${hasPrice ? p.sellingPrice : ''}"
                                            placeholder="0.00"
                                            class="pkg-price-input hidden bg-[#111827] border border-[#374151] text-green-400 text-sm text-center rounded-lg px-2 py-1 w-24 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 focus:outline-none">
                                        <button class="pkg-edit-btn text-gray-400 hover:text-indigo-400 text-xs transition" title="Edit price">
                                            <i class="fas fa-pen"></i>
                                        </button>
                                        <button class="pkg-save-btn hidden text-green-400 hover:text-green-300 text-xs transition" title="Save price">
                                            <i class="fas fa-check"></i>
                                        </button>
                                        <button class="pkg-cancel-btn hidden text-gray-500 hover:text-red-400 text-xs transition" title="Cancel">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                </td>
                                <td class="py-3 px-5 text-right">
                                    <span class="pkg-profit ${profitColor} text-sm font-semibold tabular-nums" data-pkg-id="${escapeHtml(p.id)}">${profit !== '—' ? 'GH₵' + profit : '—'}</span>
                                </td>
                            </tr>`;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            </div>`;
        });

        if (!hasAny) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No packages available.</p>';
            return;
        }

        container.innerHTML = html;

        // Edit / Save / Cancel handlers
        container.querySelectorAll('.pkg-price-cell').forEach(cell => {
            const display = cell.querySelector('.pkg-price-display');
            const input = cell.querySelector('.pkg-price-input');
            const editBtn = cell.querySelector('.pkg-edit-btn');
            const saveBtn = cell.querySelector('.pkg-save-btn');
            const cancelBtn = cell.querySelector('.pkg-cancel-btn');
            const pkgId = cell.dataset.pkgId;
            const cost = parseFloat(cell.dataset.cost);
            const profitEl = container.querySelector(`.pkg-profit[data-pkg-id="${pkgId}"]`);

            function enterEdit() {
                display.classList.add('hidden');
                editBtn.classList.add('hidden');
                input.classList.remove('hidden');
                saveBtn.classList.remove('hidden');
                cancelBtn.classList.remove('hidden');
                input.focus();
                input.select();
            }

            function exitEdit() {
                input.classList.add('hidden');
                saveBtn.classList.add('hidden');
                cancelBtn.classList.add('hidden');
                display.classList.remove('hidden');
                editBtn.classList.remove('hidden');
            }

            function updateProfit(val) {
                if (profitEl) {
                    if (!isNaN(val) && val >= cost) {
                        profitEl.textContent = 'GH₵' + (val - cost).toFixed(2);
                        profitEl.className = 'pkg-profit text-green-400 text-sm font-semibold tabular-nums';
                    } else if (!isNaN(val)) {
                        profitEl.textContent = 'Too low';
                        profitEl.className = 'pkg-profit text-red-400 text-sm font-semibold tabular-nums';
                    } else {
                        profitEl.textContent = '—';
                        profitEl.className = 'pkg-profit text-gray-500 text-sm font-semibold tabular-nums';
                    }
                }
            }

            editBtn.addEventListener('click', enterEdit);

            cancelBtn.addEventListener('click', () => {
                input.value = cell.dataset.current || '';
                updateProfit(parseFloat(cell.dataset.current));
                exitEdit();
            });

            input.addEventListener('input', () => updateProfit(parseFloat(input.value)));

            saveBtn.addEventListener('click', () => saveSinglePrice(pkgId, input, display, cell, cost, profitEl, exitEdit));

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveSinglePrice(pkgId, input, display, cell, cost, profitEl, exitEdit); }
                if (e.key === 'Escape') { cancelBtn.click(); }
            });
        });
    }

    async function saveSinglePrice(pkgId, input, display, cell, cost, profitEl, exitEdit) {
        const val = parseFloat(input.value);
        if (isNaN(val) || val < cost) {
            toast('Selling price must be at least GH₵' + cost.toFixed(2), 'warning');
            return;
        }

        const pricing = [{ packageId: pkgId, sellingPrice: val, active: true }];

        try {
            const data = await apiRequest('/store/packages/pricing', {
                method: 'PUT',
                body: JSON.stringify({ pricing })
            });
            toast('Price saved!', 'success');
            if (data.warnings && data.warnings.length) {
                data.warnings.forEach(w => toast(w, 'warning'));
            }
            // Update local data + display
            ['MTN', 'AirtelTigo', 'Telecel'].forEach(net => {
                const pkg = (packages[net] || []).find(pk => String(pk.id) === String(pkgId));
                if (pkg) pkg.sellingPrice = val;
            });
            display.textContent = 'GH₵' + val.toFixed(2);
            cell.dataset.current = val;
            if (profitEl) {
                profitEl.textContent = 'GH₵' + (val - cost).toFixed(2);
                profitEl.className = 'pkg-profit text-green-400 text-sm font-semibold tabular-nums';
            }
            exitEdit();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // ==========================================
    // ORDERS
    // ==========================================
    async function loadOrders() {
        const tbody = document.getElementById('ordersList');
        try {
            const data = await apiRequest('/store/orders?limit=200&page=1');
            allOrders = data.orders || [];
            applyOrderFilters();
        } catch (e) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:32px; color:#475569;">Failed to load orders.</td></tr>';
        }
    }

    function orderPrimaryItem(o) {
        return (o.items && o.items[0]) || {};
    }

    function orderPhone(o) {
        const it = orderPrimaryItem(o);
        return it.phoneNumber || it.phone || o.customerPhone || '';
    }
    // Display status for the Orders table.
    // Payment lifecycle (status) takes priority; once paid, the bundle delivery
    // status (deliveryStatus) drives what the customer/agent sees, mirroring the
    // normal bundle flow: paid → processing → completed (or failed).
    function orderDisplayStatus(o) {
        const pay = (o.status || '').toLowerCase();
        if (pay === 'pending') return 'pending';
        if (pay === 'cancelled') return 'cancelled';
        if (pay === 'refunded') return 'refunded';
        if (pay === 'fulfilled') return 'completed';
        // paid → reflect the bundle delivery lifecycle
        const d = (o.deliveryStatus || '').toLowerCase();
        if (d === 'delivered') return 'completed';
        if (d === 'failed') return 'failed';
        if (d === 'partially delivered') return 'partial';
        return 'processing';
    }

    function applyOrderFilters() {
        const phoneEl = document.getElementById('orderPhoneFilter');
        const statusEl = document.getElementById('orderStatusFilter');
        const startEl = document.getElementById('orderStartDate');
        const endEl = document.getElementById('orderEndDate');
        const phone = (phoneEl ? phoneEl.value : '').trim().toLowerCase();
        const status = statusEl ? statusEl.value : 'all';
        const start = startEl ? startEl.value : '';
        const end = endEl ? endEl.value : '';

        let rows = allOrders.slice();
        if (phone) rows = rows.filter(o => orderPhone(o).toLowerCase().includes(phone));
        if (status && status !== 'all') rows = rows.filter(o => orderDisplayStatus(o) === status);
        if (start) { const s = new Date(start + 'T00:00:00'); rows = rows.filter(o => new Date(o.createdAt) >= s); }
        if (end) { const e = new Date(end + 'T23:59:59'); rows = rows.filter(o => new Date(o.createdAt) <= e); }
        renderOrders(rows);
    }

    function renderOrders(orders) {
        const tbody = document.getElementById('ordersList');
        const meta = document.getElementById('ordersMeta');
        if (!tbody) return;

        if (!orders.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:32px; color:#475569;">No orders found.</td></tr>';
            if (meta) meta.textContent = '0 orders';
            return;
        }

        if (meta) {
            const sorted = orders.map(o => new Date(o.createdAt)).filter(d => !isNaN(d)).sort((a, b) => a - b);
            const fmtD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const range = sorted.length ? `${fmtD(sorted[0])} → ${fmtD(sorted[sorted.length - 1])} · ` : '';
            meta.textContent = `${range}${orders.length} order${orders.length > 1 ? 's' : ''}`;
        }

        const statusClass = {
            sent: 'st-success', fulfilled: 'st-success', completed: 'st-success', paid: 'st-info',
            processing: 'st-info', pending: 'st-warning', failed: 'st-error', cancelled: 'st-error', refunded: 'st-error'
        };
        const paidStates = ['paid', 'fulfilled', 'completed', 'sent'];

        tbody.innerHTML = orders.map(o => {
            const item = orderPrimaryItem(o);
            const net = item.network || detectNetwork(item.productName || item.data || '');
            const dataLabel = item.data || (item.productName || '').replace(/\s*Data$/i, '').replace(new RegExp('^' + net + '\\s*', 'i'), '') || item.productName || 'Bundle';
            const phone = orderPhone(o);
            const profit = typeof o.profit === 'number' ? o.profit : ((o.subtotal || 0) - (o.totalCost || 0));
            const status = orderDisplayStatus(o);
            const num = (String(o.orderId || '').match(/(\d+)\s*$/) || [])[1];
            const isPaid = !!o.paidAt || paidStates.includes((o.status || '').toLowerCase());

            return `
            <tr>
                <td style="color:#64748b;">#${escapeHtml(num || o.orderId || '')}</td>
                <td class="text-white" style="font-weight:600;">${escapeHtml(dataLabel)}</td>
                <td><span class="net-badge ${netClass(net)}">${escapeHtml(net)}</span></td>
                <td style="color:#94a3b8; font-family:ui-monospace,monospace;">${escapeHtml(phone)}</td>
                <td class="text-white" style="font-weight:600;">${money(o.subtotal)}</td>
                <td style="color:#22c55e; font-weight:600;">+${money(profit)}</td>
                <td><span class="badge ${isPaid ? 'badge-success' : 'badge-warning'}">${isPaid ? 'Paid' : 'Unpaid'}</span></td>
                <td><span class="status-badge ${statusClass[status] || 'st-info'}">${escapeHtml(status)}</span></td>
                <td style="color:#64748b; white-space:nowrap;">${fmtDateTime(o.createdAt)}</td>
            </tr>`;
        }).join('');
    }

    function showNewOrder() {
        renderOrderPackages();
        document.getElementById('orderForm').reset();
        document.getElementById('orderItemsSummary').classList.add('hidden');
        openModal('orderModal');
    }

    function renderOrderPackages() {
        // Only show packages the agent has priced
        const networkPkgs = (packages[orderNetwork] || []).filter(p => p.inStore && p.sellingPrice);
        const container = document.getElementById('orderPackageSelect');

        if (!networkPkgs.length) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No priced packages for this network. Set prices in the Packages tab first.</p>';
        } else {
            container.innerHTML = networkPkgs.map(p => `
                <label class="flex items-center gap-3 bg-[#111827] p-2 rounded-lg cursor-pointer">
                    <input type="checkbox" class="order-pkg-cb" data-package-id="${escapeHtml(p.id)}" data-price="${p.sellingPrice}" data-name="${escapeHtml(p.data)} (${escapeHtml(orderNetwork)})">
                    <div class="flex-1">
                        <span class="text-white text-sm">${escapeHtml(p.data)}</span>
                        <span class="text-gray-500 text-xs ml-1">${escapeHtml(p.validity)}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-green-400 text-sm font-semibold">GH₵${p.sellingPrice.toFixed(2)}</span>
                        <span class="text-gray-600 text-[10px] block">cost GH₵${p.costPrice.toFixed(2)}</span>
                    </div>
                    <input type="number" min="1" value="1" class="order-pkg-qty input-field w-16 px-2 py-1 rounded text-xs text-center hidden" data-package-id="${escapeHtml(p.id)}">
                </label>
            `).join('');

            container.querySelectorAll('.order-pkg-cb').forEach(cb => {
                cb.addEventListener('change', function() {
                    const qtyInput = container.querySelector(`.order-pkg-qty[data-package-id="${this.dataset.packageId}"]`);
                    qtyInput.classList.toggle('hidden', !this.checked);
                    updateOrderSummary();
                });
            });
            container.querySelectorAll('.order-pkg-qty').forEach(qty => {
                qty.addEventListener('input', updateOrderSummary);
            });
        }
    }

    function updateOrderSummary() {
        const checkboxes = document.querySelectorAll('.order-pkg-cb:checked');
        const summaryDiv = document.getElementById('orderItemsSummary');
        const listDiv = document.getElementById('orderItemsList');
        const totalSpan = document.getElementById('orderTotal');

        if (!checkboxes.length) {
            summaryDiv.classList.add('hidden');
            return;
        }

        summaryDiv.classList.remove('hidden');
        let total = 0;
        let html = '';

        checkboxes.forEach(cb => {
            const qty = parseInt(document.querySelector(`.order-pkg-qty[data-package-id="${cb.dataset.packageId}"]`).value) || 1;
            const lineTotal = qty * parseFloat(cb.dataset.price);
            total += lineTotal;
            html += `<div class="flex justify-between text-sm text-gray-300"><span>${qty}x ${cb.dataset.name}</span><span>GH₵${lineTotal.toFixed(2)}</span></div>`;
        });

        listDiv.innerHTML = html;
        totalSpan.textContent = `GH₵${total.toFixed(2)}`;
    }

    async function createOrder(e) {
        e.preventDefault();
        const checkboxes = document.querySelectorAll('.order-pkg-cb:checked');
        if (!checkboxes.length) {
            toast('Select at least one data package', 'warning');
            return;
        }

        const items = [];
        checkboxes.forEach(cb => {
            const qty = parseInt(document.querySelector(`.order-pkg-qty[data-package-id="${cb.dataset.packageId}"]`).value) || 1;
            items.push({
                packageId: cb.dataset.packageId,
                quantity: qty,
                sellingPrice: parseFloat(cb.dataset.price)
            });
        });

        const body = {
            customerName: document.getElementById('orderCustName').value,
            customerEmail: document.getElementById('orderCustEmail').value,
            customerPhone: document.getElementById('orderCustPhone').value,
            items,
            notes: document.getElementById('orderNotes').value
        };

        const btn = document.getElementById('createOrderBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Creating...';

        try {
            const data = await apiRequest('/store/orders', { method: 'POST', body: JSON.stringify(body) });
            closeModal('orderModal');
            toast('Order created! Payment link generated.', 'success');

            if (data.payment && data.payment.authorizationUrl) {
                try {
                    await navigator.clipboard.writeText(data.payment.authorizationUrl);
                    toast('Payment link copied to clipboard!', 'info');
                } catch (e) {
                    prompt('Share this payment link with the customer:', data.payment.authorizationUrl);
                }
            }

            loadOrders();
            loadDashboard();
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-credit-card mr-1"></i> Create Order & Send Payment Link';
        }
    }

    async function verifyPayment(reference) {
        try {
            const data = await apiRequest(`/store/orders/${reference}/verify`);
            toast(data.message || 'Payment verified!', 'success');
            loadOrders();
            loadDashboard();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function fulfillOrder(orderId) {
        try {
            await apiRequest(`/store/orders/${orderId}/fulfill`, { method: 'PUT' });
            toast('Order marked as fulfilled', 'success');
            loadOrders();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // ==========================================
    // PAYOUTS
    // ==========================================
    async function loadPayouts() {
        try {
            const [payoutsData, storeData] = await Promise.all([
                apiRequest('/store/payouts?limit=50'),
                apiRequest('/store')
            ]);
            store = storeData.store;
            const settlement = store.settlementAccount;

            document.getElementById('withdrawableBalance').textContent = `GH₵${settlement.availableBalance.toFixed(2)}`;
            document.getElementById('payoutHoldAmount').textContent = `GH₵${settlement.holdAmount.toFixed(2)}`;
            document.getElementById('payoutAvailable').textContent = `GH₵${settlement.availableBalance.toFixed(2)}`;

            renderPayouts(payoutsData.payouts);
        } catch (e) {
            toast('Failed to load payouts', 'error');
        }
    }

    function renderPayouts(payouts) {
        const container = document.getElementById('payoutsList');
        if (!payouts.length) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No payout requests yet.</p>';
            return;
        }

        const statusColors = { pending: 'badge-warning', approved: 'badge-info', processing: 'badge-info', completed: 'badge-success', failed: 'badge-error', rejected: 'badge-error' };

        container.innerHTML = payouts.map(p => `
            <div class="card p-4">
                <div class="flex items-center justify-between mb-2">
                    <div>
                        <span class="text-white font-semibold text-sm">${escapeHtml(p.payoutId)}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full ml-2 ${statusColors[p.status]}">${p.status}</span>
                    </div>
                    <span class="text-green-400 font-bold">GH₵${p.amount.toFixed(2)}</span>
                </div>
                <div class="flex items-center justify-between text-xs text-gray-500">
                    <span><i class="fas fa-${p.method === 'bank_transfer' ? 'university' : 'mobile-alt'} mr-1"></i>${p.method === 'bank_transfer' ? 'Bank Transfer' : 'Mobile Money'}</span>
                    <span>${new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                ${p.rejectionReason ? `<p class="text-red-400 text-xs mt-1"><i class="fas fa-info-circle mr-1"></i>${escapeHtml(p.rejectionReason)}</p>` : ''}
            </div>
        `).join('');
    }

    function showPayoutModal() {
        if (store && store.settlementAccount) {
            document.getElementById('payoutAvailable').textContent = `GH₵${store.settlementAccount.availableBalance.toFixed(2)}`;
        }
        document.getElementById('payoutForm').reset();
        document.getElementById('payoutDestination').classList.add('hidden');
        openModal('payoutModal');
    }

    async function submitPayout(e) {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('payoutAmount').value);
        const method = document.getElementById('payoutMethod').value;

        if (!amount || !method) {
            toast('Amount and method are required', 'warning');
            return;
        }

        try {
            await apiRequest('/store/payouts', {
                method: 'POST',
                body: JSON.stringify({ amount, method })
            });
            closeModal('payoutModal');
            toast('Payout request submitted!', 'success');
            loadPayouts();
            loadDashboard();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // ==========================================
    // SETTINGS
    // ==========================================
    function loadSettings() {
        if (!store) return;
        document.getElementById('settStoreName').value = store.name || '';
        document.getElementById('settStorePhone').value = store.phone || '';
        document.getElementById('settStoreDesc').value = store.description || '';
        document.getElementById('settStoreLoc').value = store.location || '';
        document.getElementById('settBankName').value = store.bankName || '';
        document.getElementById('settBankAcct').value = store.bankAccountNumber || '';
        document.getElementById('settBankAcctName').value = store.bankAccountName || '';
        document.getElementById('settMomoNum').value = store.momoNumber || '';
        document.getElementById('settMomoProv').value = store.momoProvider || '';

        const theme = storeTheme();
        document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === theme));

        const url = getStoreUrl();
        const linkEl = document.getElementById('settStoreLink');
        if (linkEl) linkEl.textContent = url || '—';
        const openBtn = document.getElementById('settOpenLinkBtn');
        if (openBtn && url) openBtn.href = url;
    }

    async function saveSettings(e) {
        e.preventDefault();
        try {
            const activeSwatch = document.querySelector('.theme-swatch.active');
            const theme = activeSwatch ? activeSwatch.dataset.theme : 'blue';
            const body = {
                name: document.getElementById('settStoreName').value,
                phone: document.getElementById('settStorePhone').value,
                description: document.getElementById('settStoreDesc').value,
                location: document.getElementById('settStoreLoc').value,
                bankName: document.getElementById('settBankName').value,
                bankAccountNumber: document.getElementById('settBankAcct').value,
                bankAccountName: document.getElementById('settBankAcctName').value,
                momoNumber: document.getElementById('settMomoNum').value,
                momoProvider: document.getElementById('settMomoProv').value,
                metadata: { theme }
            };
            const data = await apiRequest('/store', { method: 'PUT', body: JSON.stringify(body) });
            store = data.store;
            applyBannerTheme(theme);
            toast('Store settings updated', 'success');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // ==========================================
    // CREATE STORE
    // ==========================================
    async function createStore(e) {
        e.preventDefault();
        try {
            const body = {
                name: document.getElementById('newStoreName').value,
                description: document.getElementById('newStoreDesc').value,
                location: document.getElementById('newStoreLoc').value,
                phone: document.getElementById('newStorePhone').value
            };
            await apiRequest('/store', { method: 'POST', body: JSON.stringify(body) });
            toast('Store created!', 'success');
            await loadStore();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // ==========================================
    // HELPERS
    // ==========================================
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function money(n) {
        return 'GH₵' + (Number(n) || 0).toFixed(2);
    }

    function fmtDateTime(d) {
        if (!d) return '';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '';
        const day = dt.getDate();
        const mon = dt.toLocaleString('en-US', { month: 'short' });
        const year = dt.getFullYear();
        let h = dt.getHours();
        const m = String(dt.getMinutes()).padStart(2, '0');
        const ap = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return `${day} ${mon} ${year}, ${String(h).padStart(2, '0')}:${m} ${ap}`;
    }

    function detectNetwork(str) {
        const s = String(str || '').toLowerCase();
        if (s.includes('airtel') || s.includes('tigo')) return 'AirtelTigo';
        if (s.includes('telecel') || s.includes('vodafone')) return 'Telecel';
        return 'MTN';
    }

    function netClass(net) {
        const k = String(net || '').toLowerCase();
        if (k.includes('airtel') || k.includes('tigo')) return 'net-airteltigo';
        if (k.includes('telecel') || k.includes('vodafone')) return 'net-telecel';
        return 'net-mtn';
    }

    // ==========================================
    // EVENT LISTENERS
    // ==========================================
    function setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => showTab(btn.dataset.tab));
        });

        // Global event delegation for data-action buttons
        document.addEventListener('click', function(e) {
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                if (action === 'goto-orders') showTab('orders');
                else if (action === 'goto-earnings') showTab('earnings');
                else if (action === 'verify-payment') verifyPayment(actionBtn.dataset.ref);
                else if (action === 'fulfill-order') fulfillOrder(actionBtn.dataset.orderId);
                return;
            }
            const closeBtn = e.target.closest('[data-close-modal]');
            if (closeBtn) {
                closeModal(closeBtn.dataset.closeModal);
            }
        });

        // Order filters (client-side)
        const phoneFilter = document.getElementById('orderPhoneFilter');
        if (phoneFilter) phoneFilter.addEventListener('input', applyOrderFilters);
        ['orderStatusFilter', 'orderStartDate', 'orderEndDate'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', applyOrderFilters);
        });
        const todayBtn = document.getElementById('ordersTodayBtn');
        if (todayBtn) todayBtn.addEventListener('click', () => {
            const t = new Date();
            const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
            document.getElementById('orderStartDate').value = d;
            document.getElementById('orderEndDate').value = d;
            applyOrderFilters();
        });
        const clearBtn = document.getElementById('ordersClearBtn');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (phoneFilter) phoneFilter.value = '';
            document.getElementById('orderStatusFilter').value = 'all';
            document.getElementById('orderStartDate').value = '';
            document.getElementById('orderEndDate').value = '';
            applyOrderFilters();
        });

        // Color theme picker
        document.querySelectorAll('.theme-swatch').forEach(s => {
            s.addEventListener('click', () => {
                document.querySelectorAll('.theme-swatch').forEach(x => x.classList.remove('active'));
                s.classList.add('active');
            });
        });

        // Settings store link copy
        const settCopyBtn = document.getElementById('settCopyLinkBtn');
        if (settCopyBtn) settCopyBtn.addEventListener('click', () => {
            const url = getStoreUrl();
            if (!url) return;
            navigator.clipboard.writeText(url)
                .then(() => toast('Store link copied!', 'success'))
                .catch(() => prompt('Copy your store link:', url));
        });

        // Forms
        document.getElementById('createStoreForm').addEventListener('submit', createStore);
        document.getElementById('orderForm').addEventListener('submit', createOrder);
        document.getElementById('payoutForm').addEventListener('submit', submitPayout);
        document.getElementById('storeSettingsForm').addEventListener('submit', saveSettings);

        // Buttons
        const newOrderBtn = document.getElementById('newOrderBtn');
        if (newOrderBtn) newOrderBtn.addEventListener('click', showNewOrder);
        const reqPayoutBtn = document.getElementById('requestPayoutBtn');
        if (reqPayoutBtn) reqPayoutBtn.addEventListener('click', showPayoutModal);

        // Network tabs inside order modal
        document.querySelectorAll('.order-network-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                orderNetwork = btn.dataset.orderNetwork;
                document.querySelectorAll('.order-network-tab').forEach(b => {
                    b.classList.remove('bg-yellow-500', 'text-black', 'font-semibold', 'bg-red-500', 'text-white', 'bg-blue-500');
                    b.classList.add('bg-[#374151]', 'text-gray-300');
                });
                const colorMap = { MTN: ['bg-yellow-500', 'text-black', 'font-semibold'], AirtelTigo: ['bg-red-500', 'text-white', 'font-semibold'], Telecel: ['bg-blue-500', 'text-white', 'font-semibold'] };
                btn.classList.remove('bg-[#374151]', 'text-gray-300');
                (colorMap[orderNetwork] || colorMap.MTN).forEach(c => btn.classList.add(c));
                renderOrderPackages();
            });
        });

        // Payout method change -> show destination
        document.getElementById('payoutMethod').addEventListener('change', function() {
            const dest = document.getElementById('payoutDestination');
            const destText = document.getElementById('payoutDestText');
            if (!store) return;
            if (this.value === 'bank_transfer') {
                destText.textContent = store.bankAccountNumber ? `${store.bankName} - ${store.bankAccountNumber} (${store.bankAccountName})` : 'No bank details configured';
                dest.classList.remove('hidden');
            } else if (this.value === 'momo') {
                destText.textContent = store.momoNumber ? `${store.momoProvider} - ${store.momoNumber}` : 'No MoMo details configured';
                dest.classList.remove('hidden');
            } else {
                dest.classList.add('hidden');
            }
        });

    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        init,
        showTab,
        verifyPayment,
        fulfillOrder,
        closeModal,
        openModal
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', StoreApp.init);
