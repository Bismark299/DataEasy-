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
    let currentTab = 'dashboard';
    let currentFinTab = 'income';
    let orderFilter = 'all';
    let dashOrders = [];
    let dashPage = 1;
    let dashPerPage = 20;
    let dashTotalPages = 1;

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

    async function loadStore() {
        try {
            const data = await apiRequest('/store');
            store = data.store;
            document.getElementById('noStoreSection').classList.add('hidden');
            document.querySelectorAll('.tab-content').forEach(el => {
                if (el.id === `tab-${currentTab}`) el.classList.remove('hidden');
            });

            // Populate sidebar store name
            const sidebarName = document.getElementById('sidebarStoreName');
            if (sidebarName && store.name) sidebarName.textContent = store.name;

            // Populate dashboard store info banner
            const storeUrl = store.id ? `${window.location.origin}/store/shop.html?store=${store.id}` : '';
            const banner = document.getElementById('storeInfoBanner');
            if (banner) {
                const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
                set('bannerStoreName', store.name);
                set('bannerStoreDesc', store.description);
                set('bannerStoreLocText', store.location);
                set('bannerStorePhoneText', store.phone);
                set('bannerStoreLink', storeUrl);
                const loc = document.getElementById('bannerStoreLoc');
                const ph = document.getElementById('bannerStorePhone');
                if (loc) loc.style.display = store.location ? '' : 'none';
                if (ph) ph.style.display = store.phone ? '' : 'none';
                const openLink = document.getElementById('bannerOpenLink');
                if (openLink && storeUrl) openLink.href = storeUrl;
                const copyBtn = document.getElementById('bannerCopyLink');
                if (copyBtn) copyBtn.onclick = () => {
                    navigator.clipboard.writeText(storeUrl).then(() => toast('Store link copied!', 'success')).catch(() => toast('Copy failed', 'error'));
                };
                banner.classList.remove('hidden');
            }

            // Show store link (packages tab)
            const linkSection = document.getElementById('storeLinkSection');
            if (linkSection && storeUrl) {
                document.getElementById('storeLinkUrl').textContent = storeUrl;
                linkSection.classList.remove('hidden');
            }

            loadDashboard();
            loadPackages();
        } catch (e) {
            if (e.message.includes('not found') || e.message.includes('Create a store')) {
                document.getElementById('noStoreSection').classList.remove('hidden');
                document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
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

        const titles = { dashboard: 'Dashboard', packages: 'Packages & Pricing', orders: 'Store Orders', payouts: 'Payouts', financials: 'Financials', settings: 'Settings' };
        const titleEl = document.getElementById('pageTitle');
        if (titleEl) titleEl.textContent = titles[tab] || 'Store';

        if (tab === 'dashboard') loadDashboard();
        else if (tab === 'packages') loadPackages();
        else if (tab === 'orders') loadOrders();
        else if (tab === 'payouts') loadPayouts();
        else if (tab === 'financials') loadFinancials();
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

            document.getElementById('availableBalance').textContent = `₵${s.availableBalance.toFixed(2)}`;
            document.getElementById('ledgerBalance').textContent = `₵${s.ledgerBalance.toFixed(2)}`;
            document.getElementById('todaySales').textContent = `₵${d.today.salesTotal.toFixed(2)}`;
            document.getElementById('todayCount').textContent = d.today.salesCount;
            document.getElementById('totalRevenue').textContent = `₵${s.totalRevenue.toFixed(2)}`;
            document.getElementById('totalCommission').textContent = `₵${s.totalCommissionPaid.toFixed(2)}`;
            document.getElementById('totalPayouts').textContent = `₵${s.totalPayouts.toFixed(2)}`;
            document.getElementById('pendingPayoutsCount').textContent = d.pendingPayouts;
            document.getElementById('totalOrders').textContent = d.totalOrders;
            document.getElementById('activePackages').textContent = d.activePackages;
            document.getElementById('holdAmount').textContent = `₵${s.holdAmount.toFixed(2)}`;
            // Update sidebar balance
            const sb = document.getElementById('sidebarBalance');
            if (sb) sb.textContent = `₵${s.availableBalance.toFixed(2)}`;
        } catch (e) {
            toast('Failed to load dashboard', 'error');
        }

        loadDashboardOrders();
    }

    async function loadDashboardOrders() {
        const dateEl = document.getElementById('dashOrderDate');
        if (dateEl && !dateEl.value) {
            dateEl.value = new Date().toISOString().split('T')[0];
        }
        try {
            const params = new URLSearchParams({ limit: dashPerPage, page: dashPage });
            const dateVal = dateEl ? dateEl.value : '';
            if (dateVal) params.set('date', dateVal);
            const data = await apiRequest('/store/orders?' + params.toString());
            dashOrders = data.orders || [];
            dashTotalPages = (data.pagination && data.pagination.pages) || 1;
            filterAndRenderDashOrders();
        } catch (e) {
            const tbody = document.getElementById('dashOrdersBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-500 py-8">Failed to load orders.</td></tr>';
        }
    }

    function filterAndRenderDashOrders() {
        const statusVal = (document.getElementById('dashOrderStatus') || {}).value || '';
        const searchVal = ((document.getElementById('dashOrderSearch') || {}).value || '').trim();

        let filtered = dashOrders;
        if (statusVal) filtered = filtered.filter(o => (o.status || '').toLowerCase() === statusVal.toLowerCase());
        if (searchVal) filtered = filtered.filter(o =>
            (o.items || []).some(i => (i.phoneNumber || i.phone || '').includes(searchVal)) ||
            (o.customerPhone || '').includes(searchVal)
        );

        renderDashboardOrders(filtered);
    }

    function renderDashboardOrders(orders) {
        const tbody = document.getElementById('dashOrdersBody');
        if (!tbody) return;

        if (!orders.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-500 py-8">No orders found.</td></tr>';
            return;
        }

        const statusColors = { sent: 'badge-success', processing: 'badge-info', pending: 'badge-warning', failed: 'badge-error' };

        tbody.innerHTML = orders.map(o => {
            const phone = (o.items || []).map(i => i.phoneNumber || i.phone || '').filter(Boolean).join(', ') || o.customerPhone || '—';
            const dataSize = (o.items || []).map(i => `${i.quantity || 1}x ${escapeHtml(i.data || i.productName || '')}`).join(', ') || '—';
            const profit = typeof o.profit === 'number' ? o.profit.toFixed(2) : ((o.subtotal || 0) - (o.totalCost || 0)).toFixed(2);
            return `
            <tr class="border-b border-[#374151] hover:bg-[#1f2937]/50">
                <td class="py-3 px-4 text-gray-400 text-xs">${new Date(o.createdAt).toLocaleDateString()}</td>
                <td class="py-3 px-4 text-white text-xs font-mono">${escapeHtml(o.orderId)}</td>
                <td class="py-3 px-4 text-gray-300 text-xs">${escapeHtml(phone)}</td>
                <td class="py-3 px-4 text-gray-300 text-xs">${dataSize}</td>
                <td class="py-3 px-4 text-green-400 font-semibold text-xs">₵${(o.subtotal || 0).toFixed(2)}</td>
                <td class="py-3 px-4"><span class="text-[10px] px-2 py-0.5 rounded-full ${statusColors[(o.status || '').toLowerCase()] || 'badge-info'}">${escapeHtml(o.status || '')}</span></td>
                <td class="py-3 px-4 text-green-400 text-xs">₵${profit}</td>
            </tr>`;
        }).join('');

        // Info text
        const infoEl = document.getElementById('dashOrderInfo');
        if (infoEl) infoEl.textContent = `Page ${dashPage} of ${dashTotalPages}`;

        // Pagination
        const pagDiv = document.getElementById('dashPagination');
        if (pagDiv) {
            if (dashTotalPages <= 1) { pagDiv.innerHTML = ''; return; }
            let html = `<button class="dash-page-btn px-3 py-1 rounded text-xs ${dashPage <= 1 ? 'text-gray-600 cursor-not-allowed' : 'text-indigo-400 hover:bg-[#374151]'}" data-page="${dashPage - 1}" ${dashPage <= 1 ? 'disabled' : ''}>&laquo; Prev</button>`;
            const start = Math.max(1, dashPage - 2);
            const end = Math.min(dashTotalPages, dashPage + 2);
            for (let i = start; i <= end; i++) {
                html += `<button class="dash-page-btn px-3 py-1 rounded text-xs ${i === dashPage ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-[#374151]'}" data-page="${i}">${i}</button>`;
            }
            html += `<button class="dash-page-btn px-3 py-1 rounded text-xs ${dashPage >= dashTotalPages ? 'text-gray-600 cursor-not-allowed' : 'text-indigo-400 hover:bg-[#374151]'}" data-page="${dashPage + 1}" ${dashPage >= dashTotalPages ? 'disabled' : ''}>Next &raquo;</button>`;
            pagDiv.innerHTML = html;
            pagDiv.querySelectorAll('.dash-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const p = parseInt(btn.dataset.page);
                    if (p >= 1 && p <= dashTotalPages && p !== dashPage) {
                        dashPage = p;
                        loadDashboardOrders();
                    }
                });
            });
        }
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
                const displayPrice = hasPrice ? '₵' + Number(p.sellingPrice).toFixed(2) : '—';
                const profit = hasPrice ? (p.sellingPrice - p.costPrice).toFixed(2) : '—';
                const profitColor = hasPrice && p.sellingPrice > p.costPrice ? 'text-green-400' : (hasPrice && p.sellingPrice < p.costPrice ? 'text-red-400' : 'text-gray-500');

                html += `
                            <tr class="border-b border-[#374151]/50 hover:bg-[#1f2937]/60 transition-colors" data-row-id="${escapeHtml(p.id)}">
                                <td class="py-3 px-5">
                                    <span class="text-white font-medium text-sm">${escapeHtml(p.data)}</span>
                                    <span class="text-gray-500 text-xs ml-2">${escapeHtml(p.validity || '')}</span>
                                </td>
                                <td class="py-3 px-5 text-right text-gray-400 text-sm tabular-nums">₵${p.costPrice.toFixed(2)}</td>
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
                                    <span class="pkg-profit ${profitColor} text-sm font-semibold tabular-nums" data-pkg-id="${escapeHtml(p.id)}">${profit !== '—' ? '₵' + profit : '—'}</span>
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
                        profitEl.textContent = '₵' + (val - cost).toFixed(2);
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
            toast('Selling price must be at least ₵' + cost.toFixed(2), 'warning');
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
            display.textContent = '₵' + val.toFixed(2);
            cell.dataset.current = val;
            if (profitEl) {
                profitEl.textContent = '₵' + (val - cost).toFixed(2);
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
        try {
            const status = orderFilter === 'all' ? '' : `&status=${orderFilter}`;
            const data = await apiRequest(`/store/orders?limit=50${status}`);
            renderOrders(data.orders);
        } catch (e) {
            toast('Failed to load orders', 'error');
        }
    }

    function renderOrders(orders) {
        const container = document.getElementById('ordersList');
        if (!orders.length) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No orders found.</p>';
            return;
        }

        const statusColors = { pending: 'badge-warning', paid: 'badge-info', fulfilled: 'badge-success', cancelled: 'badge-error', refunded: 'badge-error' };

        container.innerHTML = orders.map(o => `
            <div class="card p-4">
                <div class="flex items-center justify-between mb-2">
                    <div>
                        <span class="text-white font-semibold text-sm">${escapeHtml(o.orderId)}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full ml-2 ${statusColors[o.status] || 'badge-info'}">${o.status}</span>
                    </div>
                    <span class="text-green-400 font-bold">₵${o.subtotal.toFixed(2)}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-400"><i class="fas fa-user mr-1"></i>${escapeHtml(o.customerName)}</span>
                    <span class="text-gray-500 text-xs">${new Date(o.createdAt).toLocaleDateString()}</span>
                </div>
                <div class="text-xs text-gray-500 mt-1">
                    ${o.items.map(i => `${i.quantity}x ${escapeHtml(i.productName)}`).join(', ')}
                </div>
                <div class="flex gap-2 mt-3">
                    ${o.status === 'pending' ? `<button data-action="verify-payment" data-ref="${escapeHtml(o.paymentReference)}" class="text-xs bg-indigo-600 text-white px-3 py-1 rounded">Verify Payment</button>` : ''}
                    ${o.status === 'paid' ? `<button data-action="fulfill-order" data-order-id="${escapeHtml(o.orderId)}" class="text-xs bg-green-600 text-white px-3 py-1 rounded">Mark Fulfilled</button>` : ''}
                </div>
            </div>
        `).join('');
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
                        <span class="text-green-400 text-sm font-semibold">₵${p.sellingPrice.toFixed(2)}</span>
                        <span class="text-gray-600 text-[10px] block">cost ₵${p.costPrice.toFixed(2)}</span>
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
            html += `<div class="flex justify-between text-sm text-gray-300"><span>${qty}x ${cb.dataset.name}</span><span>₵${lineTotal.toFixed(2)}</span></div>`;
        });

        listDiv.innerHTML = html;
        totalSpan.textContent = `₵${total.toFixed(2)}`;
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

            document.getElementById('withdrawableBalance').textContent = `₵${settlement.availableBalance.toFixed(2)}`;
            document.getElementById('payoutHoldAmount').textContent = `₵${settlement.holdAmount.toFixed(2)}`;
            document.getElementById('payoutAvailable').textContent = `₵${settlement.availableBalance.toFixed(2)}`;

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
                    <span class="text-green-400 font-bold">₵${p.amount.toFixed(2)}</span>
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
            document.getElementById('payoutAvailable').textContent = `₵${store.settlementAccount.availableBalance.toFixed(2)}`;
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
    // FINANCIALS
    // ==========================================
    async function loadFinancials() {
        const startDate = document.getElementById('finStartDate').value;
        const endDate = document.getElementById('finEndDate').value;
        const params = [];
        if (startDate) params.push(`startDate=${startDate}`);
        if (endDate) params.push(`endDate=${endDate}`);
        const qs = params.length ? `?${params.join('&')}` : '';

        if (currentFinTab === 'income') loadIncomeStatement(qs);
        else if (currentFinTab === 'balance') loadBalanceSheet();
        else if (currentFinTab === 'cashflow') loadCashFlow(qs);
        else if (currentFinTab === 'ledger') loadLedger();
    }

    async function loadIncomeStatement(qs) {
        try {
            const data = await apiRequest(`/store/financials/income-statement${qs}`);
            const d = data.data;
            document.getElementById('financialContent').innerHTML = `
                <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-file-invoice-dollar mr-2 text-indigo-400"></i>Income Statement (Profit & Loss)</h3>
                <p class="text-gray-500 text-xs mb-4">Period: ${escapeHtml(data.period.startDate)} to ${escapeHtml(data.period.endDate)}</p>
                <div class="space-y-3">
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-300">Gross Revenue</span>
                        <span class="text-white font-semibold">₵${d.grossRevenue.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-400 pl-4">Less: Cost of Goods Sold</span>
                        <span class="text-red-400">(₵${d.costOfGoodsSold.toFixed(2)})</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#374151] bg-[#111827] px-3 rounded">
                        <span class="text-white font-bold">Gross Profit</span>
                        <span class="text-green-400 font-bold">₵${d.grossProfit.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-400 pl-4">Less: Platform Commissions</span>
                        <span class="text-red-400">(₵${d.expenses.platformCommissions.toFixed(2)})</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-400 pl-4">Less: Refunds</span>
                        <span class="text-red-400">(₵${d.expenses.refunds.toFixed(2)})</span>
                    </div>
                    <div class="flex justify-between py-3 bg-gradient-to-r from-[#111827] to-[#1f2937] px-3 rounded-lg">
                        <span class="text-white font-bold text-lg">Net Profit</span>
                        <span class="text-xl font-bold ${d.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}">₵${d.netProfit.toFixed(2)}</span>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${escapeHtml(e.message)}</p>`;
        }
    }

    async function loadBalanceSheet() {
        try {
            const data = await apiRequest('/store/financials/balance-sheet');
            const d = data.data;
            document.getElementById('financialContent').innerHTML = `
                <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-balance-scale mr-2 text-purple-400"></i>Balance Sheet</h3>
                <p class="text-gray-500 text-xs mb-4">As of ${new Date(data.date).toLocaleString()}</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h4 class="text-indigo-400 font-semibold mb-3 border-b border-[#374151] pb-1">ASSETS</h4>
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Cash & Equivalents</span><span class="text-white">₵${d.assets.cashAndEquivalents.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Held Funds</span><span class="text-white">₵${d.assets.heldFunds.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Inventory Value</span><span class="text-white">₵${d.assets.inventoryValue.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Accounts Receivable</span><span class="text-white">₵${d.assets.accountsReceivable.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm font-bold border-t border-[#374151] pt-2"><span class="text-white">Total Assets</span><span class="text-green-400">₵${d.assets.totalAssets.toFixed(2)}</span></div>
                        </div>
                    </div>
                    <div>
                        <h4 class="text-red-400 font-semibold mb-3 border-b border-[#374151] pb-1">LIABILITIES & EQUITY</h4>
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Pending Payouts</span><span class="text-white">₵${d.liabilities.pendingPayouts.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Funds on Hold</span><span class="text-white">₵${d.liabilities.fundsOnHold.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm font-bold border-t border-[#374151] pt-2"><span class="text-white">Total Liabilities</span><span class="text-red-400">₵${d.liabilities.totalLiabilities.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm font-bold mt-4 border-t border-[#374151] pt-2"><span class="text-white">Equity (Retained Earnings)</span><span class="text-purple-400">₵${d.equity.totalEquity.toFixed(2)}</span></div>
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${escapeHtml(e.message)}</p>`;
        }
    }

    async function loadCashFlow(qs) {
        try {
            const data = await apiRequest(`/store/financials/cash-flow${qs}`);
            const d = data.data;
            document.getElementById('financialContent').innerHTML = `
                <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-exchange-alt mr-2 text-green-400"></i>Cash Flow Statement</h3>
                <p class="text-gray-500 text-xs mb-4">Period: ${escapeHtml(data.period.startDate)} to ${escapeHtml(data.period.endDate)}</p>
                <div class="space-y-3">
                    <h4 class="text-green-400 font-semibold">INFLOWS</h4>
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-300 pl-4">Customer Payments</span>
                        <span class="text-green-400">+₵${d.inflows.customerPayments.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 bg-[#111827] px-3 rounded">
                        <span class="text-white font-semibold">Total Inflows</span>
                        <span class="text-green-400 font-bold">₵${d.inflows.totalInflows.toFixed(2)}</span>
                    </div>
                    <h4 class="text-red-400 font-semibold mt-4">OUTFLOWS</h4>
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-300 pl-4">Payouts to Agent</span>
                        <span class="text-red-400">-₵${d.outflows.payoutsToAgent.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#374151]">
                        <span class="text-gray-300 pl-4">Refunds Issued</span>
                        <span class="text-red-400">-₵${d.outflows.refundsIssued.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 bg-[#111827] px-3 rounded">
                        <span class="text-white font-semibold">Total Outflows</span>
                        <span class="text-red-400 font-bold">₵${d.outflows.totalOutflows.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-3 bg-gradient-to-r from-[#111827] to-[#1f2937] px-3 rounded-lg mt-4">
                        <span class="text-white font-bold text-lg">Net Cash Flow</span>
                        <span class="text-xl font-bold ${d.netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}">₵${d.netCashFlow.toFixed(2)}</span>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${escapeHtml(e.message)}</p>`;
        }
    }

    async function loadLedger() {
        try {
            const data = await apiRequest('/store/financials/ledger?limit=100');
            const entries = data.entries;
            if (!entries.length) {
                document.getElementById('financialContent').innerHTML = '<p class="text-gray-500 text-center py-8">No ledger entries yet.</p>';
                return;
            }

            document.getElementById('financialContent').innerHTML = `
                <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-book mr-2 text-yellow-400"></i>Ledger (Transaction Log)</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-gray-400 text-xs border-b border-[#374151]">
                                <th class="py-2 text-left">Date</th>
                                <th class="py-2 text-left">Description</th>
                                <th class="py-2 text-left">Account</th>
                                <th class="py-2 text-right">Debit</th>
                                <th class="py-2 text-right">Credit</th>
                                <th class="py-2 text-right">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entries.map(e => `
                                <tr class="border-b border-[#374151]/50 hover:bg-[#111827]">
                                    <td class="py-2 text-gray-500 text-xs">${new Date(e.createdAt).toLocaleDateString()}</td>
                                    <td class="py-2 text-gray-300">${escapeHtml(e.description)}</td>
                                    <td class="py-2"><span class="text-xs px-2 py-0.5 rounded bg-[#374151] text-gray-300">${e.account}</span></td>
                                    <td class="py-2 text-right ${e.type === 'debit' ? 'text-red-400' : 'text-gray-600'}">${e.type === 'debit' ? `₵${e.amount.toFixed(2)}` : '-'}</td>
                                    <td class="py-2 text-right ${e.type === 'credit' ? 'text-green-400' : 'text-gray-600'}">${e.type === 'credit' ? `₵${e.amount.toFixed(2)}` : '-'}</td>
                                    <td class="py-2 text-right text-white">₵${e.balanceAfter.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${escapeHtml(e.message)}</p>`;
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
    }

    async function saveSettings(e) {
        e.preventDefault();
        try {
            const body = {
                name: document.getElementById('settStoreName').value,
                phone: document.getElementById('settStorePhone').value,
                description: document.getElementById('settStoreDesc').value,
                location: document.getElementById('settStoreLoc').value,
                bankName: document.getElementById('settBankName').value,
                bankAccountNumber: document.getElementById('settBankAcct').value,
                bankAccountName: document.getElementById('settBankAcctName').value,
                momoNumber: document.getElementById('settMomoNum').value,
                momoProvider: document.getElementById('settMomoProv').value
            };
            const data = await apiRequest('/store', { method: 'PUT', body: JSON.stringify(body) });
            store = data.store;
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
                else if (action === 'goto-payouts') showTab('payouts');
                else if (action === 'refresh-financials') loadFinancials();
                else if (action === 'verify-payment') verifyPayment(actionBtn.dataset.ref);
                else if (action === 'fulfill-order') fulfillOrder(actionBtn.dataset.orderId);
                return;
            }
            const closeBtn = e.target.closest('[data-close-modal]');
            if (closeBtn) {
                closeModal(closeBtn.dataset.closeModal);
            }
        });

        // Financial sub-tabs
        document.querySelectorAll('.fin-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                currentFinTab = btn.dataset.fin;
                document.querySelectorAll('.fin-tab').forEach(b => {
                    b.classList.remove('bg-indigo-600', 'text-white');
                    b.classList.add('bg-[#374151]', 'text-gray-300');
                });
                btn.classList.remove('bg-[#374151]', 'text-gray-300');
                btn.classList.add('bg-indigo-600', 'text-white');
                loadFinancials();
            });
        });

        // Order filters
        document.querySelectorAll('.order-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                orderFilter = btn.dataset.filter;
                document.querySelectorAll('.order-filter').forEach(b => {
                    b.classList.remove('bg-indigo-600', 'text-white');
                    b.classList.add('bg-[#374151]', 'text-gray-300');
                });
                btn.classList.remove('bg-[#374151]', 'text-gray-300');
                btn.classList.add('bg-indigo-600', 'text-white');
                loadOrders();
            });
        });

        // Forms
        document.getElementById('createStoreForm').addEventListener('submit', createStore);
        document.getElementById('orderForm').addEventListener('submit', createOrder);
        document.getElementById('payoutForm').addEventListener('submit', submitPayout);
        document.getElementById('storeSettingsForm').addEventListener('submit', saveSettings);

        // Buttons
        document.getElementById('newOrderBtn').addEventListener('click', showNewOrder);
        document.getElementById('requestPayoutBtn').addEventListener('click', showPayoutModal);
        document.getElementById('copyStoreLinkBtn').addEventListener('click', function() {
            const url = document.getElementById('storeLinkUrl').textContent;
            if (url) {
                navigator.clipboard.writeText(url).then(() => toast('Store link copied!', 'success')).catch(() => {
                    prompt('Copy your store link:', url);
                });
            }
        });



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

        // Dashboard order filters
        const dashStatusEl = document.getElementById('dashOrderStatus');
        if (dashStatusEl) dashStatusEl.addEventListener('change', filterAndRenderDashOrders);
        const dashDateEl = document.getElementById('dashOrderDate');
        if (dashDateEl) dashDateEl.addEventListener('change', () => { dashPage = 1; loadDashboardOrders(); });
        const dashPerPageEl = document.getElementById('dashPerPage');
        if (dashPerPageEl) dashPerPageEl.addEventListener('change', () => { dashPerPage = parseInt(dashPerPageEl.value) || 20; dashPage = 1; loadDashboardOrders(); });
        const dashSearch = document.getElementById('dashOrderSearch');
        if (dashSearch) {
            let debounce;
            dashSearch.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(filterAndRenderDashOrders, 300);
            });
        }

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

        // Set agent code + avatar initials
        try {
            const user = JSON.parse(localStorage.getItem('dataeasy_user') || '{}');
            document.getElementById('agentCode').textContent = user.agentCode || '';
            const avatar = document.getElementById('agentAvatarInitials');
            if (avatar && user.fullName) {
                const parts = (user.fullName || '').split(' ').filter(Boolean);
                avatar.textContent = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0] || 'SA').slice(0, 2);
                avatar.textContent = avatar.textContent.toUpperCase();
            }
        } catch (e) {}
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        init,
        showTab,
        verifyPayment,
        fulfillOrder,
        loadFinancials,
        closeModal,
        openModal
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', StoreApp.init);
