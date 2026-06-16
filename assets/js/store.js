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

    // Drive the whole UI (header band + every accent) from the saved theme by
    // setting CSS custom properties on :root. All accent styling reads these vars.
    function applyTheme(theme) {
        const c = THEMES[theme] || THEMES.blue;
        const root = document.documentElement;
        root.style.setProperty('--t1', c[0]);
        root.style.setProperty('--t2', c[1]);
        root.style.setProperty('--t3', c[2]);
        root.style.setProperty('--accent', c[2]);
        root.style.setProperty('--accent-2', c[1]);
    }

    function getStoreUrl() {
        const ref = storeRef();
        return ref ? `${window.location.origin}/s/${ref}` : '';
    }

    // Copy a URL and flash a 2-second "Copied!" confirmation on the button.
    function flashCopied(btn) {
        if (!btn) return;
        const icon = btn.querySelector('i');
        const span = btn.querySelector('span');
        const origLabel = span ? span.textContent : '';
        const origIcon = icon ? icon.className : '';
        if (icon) icon.className = 'fas fa-check';
        if (span) span.textContent = 'Copied!';
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
            if (icon) icon.className = origIcon;
            if (span) span.textContent = origLabel;
        }, 2000);
    }

    function copyLink(url, btn) {
        if (!url) return;
        navigator.clipboard.writeText(url)
            .then(() => flashCopied(btn))
            .catch(() => prompt('Copy your store link:', url));
    }

    function updateStoreLinks() {
        const slug = storeRef();
        const url = getStoreUrl();
        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setTxt('publicLinkText', '/s/' + slug);
        const pill = document.getElementById('publicLinkPill'); if (pill && url) pill.href = url;
        const viewBtn = document.getElementById('viewStoreBtn'); if (viewBtn && url) viewBtn.href = url;
        const settLink = document.getElementById('settStoreLink'); if (settLink) settLink.textContent = url || '—';
        const openBtn = document.getElementById('settOpenLinkBtn'); if (openBtn && url) openBtn.href = url;
    }

    async function loadStore() {
        try {
            const data = await apiRequest('/store');
            store = data.store;
            document.getElementById('noStoreSection').classList.add('hidden');
            const shell = document.getElementById('storeShell');
            if (shell) shell.classList.remove('hidden');

            // Header band
            const storeUrl = getStoreUrl();
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
            set('storeName', store.name || 'My Store');
            set('storeDescription', store.description || '');

            updateStoreLinks();
            const copyBtn = document.getElementById('copyLinkBtn');
            if (copyBtn) copyBtn.onclick = () => copyLink(getStoreUrl(), copyBtn);

            applyTheme(storeTheme());

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
            container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="fas fa-share-nodes"></i></div>
                <div class="empty-title">No orders yet</div>
                <div class="empty-text">Share your store link with customers to start making sales. Your most recent orders will appear here.</div>
                <button id="emptyCopyLinkBtn" class="btn-primary px-5 py-2.5 rounded-lg text-sm font-semibold" style="margin:16px auto 0;"><i class="fas fa-copy"></i> <span>Copy Store Link</span></button>
            </div>`;
            const btn = document.getElementById('emptyCopyLinkBtn');
            if (btn) btn.onclick = () => copyLink(getStoreUrl(), btn);
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
        const chipClass = { MTN: 'net-chip-mtn', AirtelTigo: 'net-chip-airteltigo', Telecel: 'net-chip-telecel' };
        const chipIcon = { MTN: 'fa-signal', AirtelTigo: 'fa-broadcast-tower', Telecel: 'fa-satellite-dish' };

        let html = '';
        let hasAny = false;

        networks.forEach(net => {
            const pkgs = packages[net] || [];
            if (!pkgs.length) return;
            hasAny = true;
            const pricedCount = pkgs.filter(p => p.sellingPrice !== null && p.sellingPrice !== undefined).length;

            html += `
            <div class="card bundle-group">
                <div class="bundle-group-head">
                    <span class="net-chip ${chipClass[net]}"><i class="fas ${chipIcon[net]}"></i>${escapeHtml(net)}</span>
                    <span class="priced-counter"><b>${pricedCount}/${pkgs.length}</b> priced</span>
                </div>
                <div style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Package</th>
                                <th style="text-align:right;">Cost</th>
                                <th style="text-align:center;">Your Price</th>
                                <th style="text-align:right;">Profit</th>
                            </tr>
                        </thead>
                        <tbody>`;

            pkgs.forEach(p => {
                const hasPrice = p.sellingPrice !== null && p.sellingPrice !== undefined;
                const displayPrice = hasPrice ? 'GH₵' + Number(p.sellingPrice).toFixed(2) : '—';
                const profit = hasPrice ? (p.sellingPrice - p.costPrice).toFixed(2) : '—';
                const profitColor = hasPrice && p.sellingPrice >= p.costPrice ? 'var(--pos)' : 'var(--text-ghost)';

                html += `
                            <tr data-row-id="${escapeHtml(p.id)}">
                                <td>
                                    <span class="text-white font-medium">${escapeHtml(p.data)}</span>
                                    <span style="color:var(--text-ghost); font-size:12px; margin-left:6px;">${escapeHtml(p.validity || '')}</span>
                                </td>
                                <td style="text-align:right; color:var(--text-dim);" class="tabular">GH₵${p.costPrice.toFixed(2)}</td>
                                <td style="text-align:center;">
                                    <div class="pkg-price-cell inline-flex items-center gap-2" data-pkg-id="${escapeHtml(p.id)}" data-cost="${p.costPrice}" data-current="${hasPrice ? p.sellingPrice : ''}">
                                        <span class="pkg-price-display font-semibold tabular" style="color:var(--pos);">${displayPrice}</span>
                                        <input type="number" step="0.01" min="${p.costPrice}" value="${hasPrice ? p.sellingPrice : ''}" placeholder="0.00" class="pkg-price-input price-input hidden">
                                        <button type="button" class="pkg-edit-btn icon-btn" style="color:var(--text-faint);" title="Edit price"><i class="fas fa-pen"></i></button>
                                        <button type="button" class="pkg-save-btn icon-btn hidden" style="color:var(--pos);" title="Save price"><i class="fas fa-check"></i></button>
                                        <button type="button" class="pkg-cancel-btn icon-btn hidden" style="color:var(--text-faint);" title="Cancel"><i class="fas fa-times"></i></button>
                                    </div>
                                </td>
                                <td style="text-align:right;">
                                    <span class="pkg-profit font-semibold tabular" style="color:${profitColor};" data-pkg-id="${escapeHtml(p.id)}">${profit !== '—' ? 'GH₵' + profit : '—'}</span>
                                </td>
                            </tr>`;
            });

            html += `</tbody></table></div></div>`;
        });

        if (!hasAny) {
            container.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon"><i class="fas fa-box-open"></i></div><div class="empty-title">No bundles available</div><div class="empty-text">There are no data packages to price right now. Check back later.</div></div></div>';
            return;
        }

        container.innerHTML = html;
        wireBundleEditors(container);
    }

    // Inline price editing: live profit + Save disabled while the price is below cost.
    function wireBundleEditors(container) {
        container.querySelectorAll('.pkg-price-cell').forEach(cell => {
            const display = cell.querySelector('.pkg-price-display');
            const input = cell.querySelector('.pkg-price-input');
            const editBtn = cell.querySelector('.pkg-edit-btn');
            const saveBtn = cell.querySelector('.pkg-save-btn');
            const cancelBtn = cell.querySelector('.pkg-cancel-btn');
            const pkgId = cell.dataset.pkgId;
            const cost = parseFloat(cell.dataset.cost);
            const profitEl = container.querySelector(`.pkg-profit[data-pkg-id="${pkgId}"]`);

            function setProfit(text, color) {
                if (!profitEl) return;
                profitEl.textContent = text;
                profitEl.style.color = color;
            }

            function refreshState() {
                const val = parseFloat(input.value);
                const valid = !isNaN(val) && val >= cost;
                saveBtn.disabled = !valid;
                input.classList.toggle('below', !isNaN(val) && val < cost);
                if (valid) setProfit('GH₵' + (val - cost).toFixed(2), 'var(--pos)');
                else if (!isNaN(val)) setProfit('Below cost', '#f87171');
                else setProfit('—', 'var(--text-ghost)');
            }

            function enterEdit() {
                display.classList.add('hidden');
                editBtn.classList.add('hidden');
                input.classList.remove('hidden');
                saveBtn.classList.remove('hidden');
                cancelBtn.classList.remove('hidden');
                refreshState();
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

            editBtn.addEventListener('click', enterEdit);

            cancelBtn.addEventListener('click', () => {
                input.value = cell.dataset.current || '';
                input.classList.remove('below');
                const cur = parseFloat(cell.dataset.current);
                if (!isNaN(cur)) setProfit('GH₵' + (cur - cost).toFixed(2), 'var(--pos)');
                else setProfit('—', 'var(--text-ghost)');
                exitEdit();
            });

            input.addEventListener('input', refreshState);

            saveBtn.addEventListener('click', () => {
                if (!saveBtn.disabled) saveSinglePrice(pkgId, input, display, cell, cost, profitEl, exitEdit);
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (!saveBtn.disabled) saveSinglePrice(pkgId, input, display, cell, cost, profitEl, exitEdit); }
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
            // Re-render so the "X/Y priced" counter and row reflect the new price.
            renderPackages();
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

    let ordersPage = 1;
    const ORDERS_PER_PAGE = 20;
    let lastRenderedOrders = [];

    function renderOrdersPagination(total) {
        const container = document.getElementById('ordersPagination');
        if (!container) return;
        const totalPages = Math.ceil(total / ORDERS_PER_PAGE);
        if (totalPages <= 1) { container.innerHTML = ''; return; }
        const btn = (label, page, disabled, active) =>
            `<button class="order-filter${active ? ' active' : ''}" ${disabled ? 'disabled style="opacity:.4;cursor:not-allowed;"' : ''} data-page="${page}">${label}</button>`;
        let html = btn('‹ Prev', ordersPage - 1, ordersPage === 1, false);
        html += `<span style="color:#94a3b8; font-size:13px; padding:0 8px;">Page ${ordersPage} of ${totalPages}</span>`;
        html += btn('Next ›', ordersPage + 1, ordersPage === totalPages, false);
        container.innerHTML = html;
        container.querySelectorAll('button[data-page]').forEach(b => {
            b.addEventListener('click', () => {
                const p = parseInt(b.dataset.page, 10);
                if (p >= 1 && p <= totalPages) { ordersPage = p; renderOrders(lastRenderedOrders); }
            });
        });
    }

    function renderOrders(orders) {
        const tbody = document.getElementById('ordersList');
        const meta = document.getElementById('ordersMeta');
        if (!tbody) return;

        if (orders !== lastRenderedOrders) { ordersPage = 1; lastRenderedOrders = orders; }

        if (!orders.length) {
            const noneAtAll = !allOrders.length;
            const cell = noneAtAll
                ? `<div class="empty-state"><div class="empty-icon"><i class="fas fa-receipt"></i></div><div class="empty-title">No orders yet</div><div class="empty-text">When customers buy from your store, their orders will show up here.</div></div>`
                : `<div class="empty-state"><div class="empty-icon"><i class="fas fa-filter"></i></div><div class="empty-title">No matching orders</div><div class="empty-text">No orders match your current filters. Try adjusting or clearing them.</div></div>`;
            tbody.innerHTML = `<tr><td colspan="9" style="padding:0;">${cell}</td></tr>`;
            if (meta) meta.textContent = noneAtAll ? '0 orders' : '0 matches';
            renderOrdersPagination(0);
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

        const startIdx = (ordersPage - 1) * ORDERS_PER_PAGE;
        const pageOrders = orders.slice(startIdx, startIdx + ORDERS_PER_PAGE);

        tbody.innerHTML = pageOrders.map(o => {
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

        renderOrdersPagination(orders.length);
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
            const settlement = store.settlementAccount || {};
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

            set('withdrawableBalance', money(settlement.availableBalance));
            set('payoutAvailable', money(settlement.availableBalance));
            set('payoutHoldAmount', money(settlement.holdAmount));
            set('payoutMinAmount', money(store.payoutThreshold));
            set('payoutFeeAmount', 'No fee');

            // Prefill saved mobile money details (only when the field is empty,
            // so we don't clobber what the agent is currently typing).
            const provEl = document.getElementById('payoutMomoProvider');
            const numEl = document.getElementById('payoutMomoNumber');
            if (provEl && !provEl.value) provEl.value = store.momoProvider || '';
            if (numEl && !numEl.value) numEl.value = store.momoNumber || '';

            renderPayouts(payoutsData.payouts);
        } catch (e) {
            toast('Failed to load payouts', 'error');
        }
    }

    function renderPayouts(payouts) {
        const container = document.getElementById('payoutsList');
        if (!payouts.length) {
            container.innerHTML = '<div class="empty-state" style="padding:32px 16px;"><div class="empty-icon"><i class="fas fa-money-bill-transfer"></i></div><div class="empty-title">No withdrawals yet</div><div class="empty-text">Your payout requests will appear here once you make one.</div></div>';
            return;
        }

        const statusColors = { pending: 'badge-warning', approved: 'badge-info', processing: 'badge-info', completed: 'badge-success', failed: 'badge-error', rejected: 'badge-error' };

        container.innerHTML = payouts.map(p => `
            <div style="background:var(--surface-2); border:1px solid var(--line); border-radius:12px; padding:14px 16px;">
                <div class="flex items-center justify-between mb-1.5">
                    <span class="text-white font-semibold text-sm">${escapeHtml(p.payoutId)}</span>
                    <span class="font-bold" style="color:var(--pos);">${money(p.amount)}</span>
                </div>
                <div class="flex items-center justify-between text-xs" style="color:var(--text-faint);">
                    <span><i class="fas fa-${p.method === 'bank_transfer' ? 'university' : 'mobile-alt'} mr-1"></i>${p.method === 'bank_transfer' ? 'Bank Transfer' : 'Mobile Money'}</span>
                    <span class="badge ${statusColors[p.status] || 'badge-info'}">${escapeHtml(p.status)}</span>
                </div>
                <div class="text-xs mt-1" style="color:var(--text-ghost);">${new Date(p.createdAt).toLocaleDateString()}</div>
                ${p.rejectionReason ? `<p class="text-xs mt-2" style="color:#f87171;"><i class="fas fa-info-circle mr-1"></i>${escapeHtml(p.rejectionReason)}</p>` : ''}
            </div>
        `).join('');
    }

    async function submitPayout(e) {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('payoutAmount').value);
        const momoProvider = document.getElementById('payoutMomoProvider').value;
        const momoNumber = document.getElementById('payoutMomoNumber').value.trim();

        if (!amount) {
            toast('Amount is required', 'warning');
            return;
        }
        if (!momoProvider) {
            toast('Select your mobile money network', 'warning');
            return;
        }
        if (!momoNumber) {
            toast('Mobile money number is required', 'warning');
            return;
        }

        try {
            await apiRequest('/store/payouts', {
                method: 'POST',
                body: JSON.stringify({ amount, method: 'momo', momoNumber, momoProvider })
            });
            toast('Payout request submitted!', 'success');
            const amtEl = document.getElementById('payoutAmount');
            if (amtEl) amtEl.value = '';
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
        const waEl = document.getElementById('settStoreWhatsapp');
        if (waEl) waEl.value = store.whatsapp || '';
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
                whatsapp: document.getElementById('settStoreWhatsapp') ? document.getElementById('settStoreWhatsapp').value : undefined,
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
            applyTheme(theme);

            // Keep the header in sync with edits to name/description/link.
            const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
            setTxt('storeName', store.name || 'My Store');
            setTxt('storeDescription', store.description || '');
            updateStoreLinks();

            showSavedPill();
            toast('Store settings updated', 'success');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // Flash the inline "Saved!" pills in the settings tab for ~2.2s.
    function showSavedPill() {
        ['settingsSavedInline', 'settingsSaved'].forEach(id => {
            const pill = document.getElementById(id);
            if (!pill) return;
            pill.classList.add('show');
            clearTimeout(pill._t);
            pill._t = setTimeout(() => pill.classList.remove('show'), 2200);
        });
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

        // Color theme picker — live preview of accents as you pick.
        document.querySelectorAll('.theme-swatch').forEach(s => {
            s.addEventListener('click', () => {
                document.querySelectorAll('.theme-swatch').forEach(x => x.classList.remove('active'));
                s.classList.add('active');
                applyTheme(s.dataset.theme);
            });
        });

        // Settings store link copy
        const settCopyBtn = document.getElementById('settCopyLinkBtn');
        if (settCopyBtn) settCopyBtn.addEventListener('click', () => copyLink(getStoreUrl(), settCopyBtn));

        // Forms
        document.getElementById('createStoreForm').addEventListener('submit', createStore);
        document.getElementById('orderForm').addEventListener('submit', createOrder);
        document.getElementById('payoutForm').addEventListener('submit', submitPayout);
        document.getElementById('storeSettingsForm').addEventListener('submit', saveSettings);

        // Buttons
        const newOrderBtn = document.getElementById('newOrderBtn');
        if (newOrderBtn) newOrderBtn.addEventListener('click', showNewOrder);

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
