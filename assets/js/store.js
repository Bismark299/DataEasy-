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
        const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-yellow-600' };
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

            // Show store link
            const linkSection = document.getElementById('storeLinkSection');
            if (linkSection && store.id) {
                const storeUrl = `${window.location.origin}/store/shop.html?store=${store.id}`;
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
            btn.classList.remove('active', 'text-white');
            btn.classList.add('text-gray-400');
            if (btn.dataset.tab === tab) {
                btn.classList.add('active', 'text-white');
                btn.classList.remove('text-gray-400');
            }
        });

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
            document.getElementById('cogsTotal').textContent = `₵${s.totalCostOfGoods.toFixed(2)}`;
        } catch (e) {
            toast('Failed to load dashboard', 'error');
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
        const networkPkgs = packages[currentNetwork] || [];
        if (!networkPkgs.length) {
            container.innerHTML = '<p class="text-gray-500 col-span-full text-center py-8">No packages available for this network.</p>';
            return;
        }

        const networkColors = {
            MTN: { bg: 'from-yellow-500/20 to-yellow-600/10', border: 'border-yellow-500/30', text: 'text-yellow-400', accent: 'yellow' },
            AirtelTigo: { bg: 'from-red-500/20 to-red-600/10', border: 'border-red-500/30', text: 'text-red-400', accent: 'red' },
            Telecel: { bg: 'from-blue-500/20 to-blue-600/10', border: 'border-blue-500/30', text: 'text-blue-400', accent: 'blue' }
        };
        const colors = networkColors[currentNetwork] || networkColors.MTN;

        container.innerHTML = networkPkgs.map(p => {
            const hasPrice = p.sellingPrice !== null && p.sellingPrice !== undefined;
            const profit = hasPrice ? (p.sellingPrice - p.costPrice).toFixed(2) : '—';
            const profitColor = hasPrice && p.sellingPrice > p.costPrice ? 'text-green-400' : 'text-gray-500';
            const isActive = p.inStore;

            return `
            <div class="card p-4 bg-gradient-to-br ${colors.bg} ${colors.border} ${!isActive ? 'opacity-60' : ''}">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <h3 class="text-white font-bold text-lg">${escapeHtml(p.data)}</h3>
                        <p class="text-gray-400 text-xs">${escapeHtml(p.validity)} · ${escapeHtml(currentNetwork)}</p>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer pkg-active-toggle" data-pkg-id="${escapeHtml(p.id)}" ${isActive ? 'checked' : ''}>
                        <div class="w-9 h-5 bg-gray-600 peer-checked:bg-green-500 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p class="text-gray-500 text-[10px] uppercase">Cost</p>
                        <p class="text-gray-400 text-sm font-semibold">₵${p.costPrice.toFixed(2)}</p>
                    </div>
                    <div>
                        <p class="text-gray-500 text-[10px] uppercase">Selling</p>
                        <input type="number" step="0.01" min="${p.costPrice}" value="${hasPrice ? p.sellingPrice : ''}" 
                            placeholder="${p.costPrice.toFixed(2)}"
                            class="pkg-selling-price w-full bg-[#0f172a] border border-[#334155] text-white text-sm text-center rounded px-1 py-1 focus:border-${colors.accent}-500 focus:outline-none"
                            data-pkg-id="${escapeHtml(p.id)}" data-cost="${p.costPrice}">
                    </div>
                    <div>
                        <p class="text-gray-500 text-[10px] uppercase">Profit</p>
                        <p class="pkg-profit ${profitColor} text-sm font-semibold" data-pkg-id="${escapeHtml(p.id)}">₵${profit}</p>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Live profit calculation
        container.querySelectorAll('.pkg-selling-price').forEach(input => {
            input.addEventListener('input', function() {
                const cost = parseFloat(this.dataset.cost);
                const selling = parseFloat(this.value);
                const profitEl = container.querySelector(`.pkg-profit[data-pkg-id="${this.dataset.pkgId}"]`);
                if (profitEl) {
                    if (!isNaN(selling) && selling >= cost) {
                        profitEl.textContent = `₵${(selling - cost).toFixed(2)}`;
                        profitEl.className = 'pkg-profit text-green-400 text-sm font-semibold';
                        profitEl.dataset.pkgId = this.dataset.pkgId;
                    } else if (!isNaN(selling)) {
                        profitEl.textContent = 'Too low';
                        profitEl.className = 'pkg-profit text-red-400 text-sm font-semibold';
                        profitEl.dataset.pkgId = this.dataset.pkgId;
                    } else {
                        profitEl.textContent = '₵—';
                        profitEl.className = 'pkg-profit text-gray-500 text-sm font-semibold';
                        profitEl.dataset.pkgId = this.dataset.pkgId;
                    }
                }
            });
        });
    }

    async function savePricing() {
        const inputs = document.querySelectorAll('.pkg-selling-price');
        const toggles = document.querySelectorAll('.pkg-active-toggle');

        const pricingMap = {};
        toggles.forEach(t => {
            pricingMap[t.dataset.pkgId] = { active: t.checked };
        });
        inputs.forEach(inp => {
            const val = parseFloat(inp.value);
            if (!isNaN(val)) {
                if (!pricingMap[inp.dataset.pkgId]) pricingMap[inp.dataset.pkgId] = {};
                pricingMap[inp.dataset.pkgId].sellingPrice = val;
                if (pricingMap[inp.dataset.pkgId].active === undefined) pricingMap[inp.dataset.pkgId].active = true;
            }
        });

        const pricing = Object.entries(pricingMap)
            .filter(([, v]) => v.sellingPrice !== undefined)
            .map(([packageId, v]) => ({
                packageId,
                sellingPrice: v.sellingPrice,
                active: v.active !== false
            }));

        if (!pricing.length) {
            toast('Set selling prices for at least one package', 'warning');
            return;
        }

        const btn = document.getElementById('savePricingBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';

        try {
            const data = await apiRequest('/store/packages/pricing', {
                method: 'PUT',
                body: JSON.stringify({ pricing })
            });
            toast('Prices saved!', 'success');
            if (data.warnings && data.warnings.length) {
                data.warnings.forEach(w => toast(w, 'warning'));
            }
            await loadPackages();
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save mr-1"></i> Save Prices';
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
                    ${o.status === 'pending' ? `<button data-action="verify-payment" data-ref="${escapeHtml(o.paymentReference)}" class="text-xs bg-blue-600 text-white px-3 py-1 rounded">Verify Payment</button>` : ''}
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
                <label class="flex items-center gap-3 bg-[#0f172a] p-2 rounded-lg cursor-pointer">
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
                <h3 class="text-lg font-bold text-white mb-4"><i class="fas fa-file-invoice-dollar mr-2 text-blue-400"></i>Income Statement (Profit & Loss)</h3>
                <p class="text-gray-500 text-xs mb-4">Period: ${escapeHtml(data.period.startDate)} to ${escapeHtml(data.period.endDate)}</p>
                <div class="space-y-3">
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-300">Gross Revenue</span>
                        <span class="text-white font-semibold">₵${d.grossRevenue.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-400 pl-4">Less: Cost of Goods Sold</span>
                        <span class="text-red-400">(₵${d.costOfGoodsSold.toFixed(2)})</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#334155] bg-[#0f172a] px-3 rounded">
                        <span class="text-white font-bold">Gross Profit</span>
                        <span class="text-green-400 font-bold">₵${d.grossProfit.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-400 pl-4">Less: Platform Commissions</span>
                        <span class="text-red-400">(₵${d.expenses.platformCommissions.toFixed(2)})</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-400 pl-4">Less: Refunds</span>
                        <span class="text-red-400">(₵${d.expenses.refunds.toFixed(2)})</span>
                    </div>
                    <div class="flex justify-between py-3 bg-gradient-to-r from-[#0f172a] to-[#1e293b] px-3 rounded-lg">
                        <span class="text-white font-bold text-lg">Net Profit</span>
                        <span class="text-xl font-bold ${d.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}">₵${d.netProfit.toFixed(2)}</span>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${e.message}</p>`;
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
                        <h4 class="text-blue-400 font-semibold mb-3 border-b border-[#334155] pb-1">ASSETS</h4>
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Cash & Equivalents</span><span class="text-white">₵${d.assets.cashAndEquivalents.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Held Funds</span><span class="text-white">₵${d.assets.heldFunds.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Inventory Value</span><span class="text-white">₵${d.assets.inventoryValue.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Accounts Receivable</span><span class="text-white">₵${d.assets.accountsReceivable.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm font-bold border-t border-[#334155] pt-2"><span class="text-white">Total Assets</span><span class="text-green-400">₵${d.assets.totalAssets.toFixed(2)}</span></div>
                        </div>
                    </div>
                    <div>
                        <h4 class="text-red-400 font-semibold mb-3 border-b border-[#334155] pb-1">LIABILITIES & EQUITY</h4>
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Pending Payouts</span><span class="text-white">₵${d.liabilities.pendingPayouts.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-gray-300">Funds on Hold</span><span class="text-white">₵${d.liabilities.fundsOnHold.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm font-bold border-t border-[#334155] pt-2"><span class="text-white">Total Liabilities</span><span class="text-red-400">₵${d.liabilities.totalLiabilities.toFixed(2)}</span></div>
                            <div class="flex justify-between text-sm font-bold mt-4 border-t border-[#334155] pt-2"><span class="text-white">Equity (Retained Earnings)</span><span class="text-purple-400">₵${d.equity.totalEquity.toFixed(2)}</span></div>
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${e.message}</p>`;
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
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-300 pl-4">Customer Payments</span>
                        <span class="text-green-400">+₵${d.inflows.customerPayments.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 bg-[#0f172a] px-3 rounded">
                        <span class="text-white font-semibold">Total Inflows</span>
                        <span class="text-green-400 font-bold">₵${d.inflows.totalInflows.toFixed(2)}</span>
                    </div>
                    <h4 class="text-red-400 font-semibold mt-4">OUTFLOWS</h4>
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-300 pl-4">Payouts to Agent</span>
                        <span class="text-red-400">-₵${d.outflows.payoutsToAgent.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 border-b border-[#334155]">
                        <span class="text-gray-300 pl-4">Refunds Issued</span>
                        <span class="text-red-400">-₵${d.outflows.refundsIssued.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-2 bg-[#0f172a] px-3 rounded">
                        <span class="text-white font-semibold">Total Outflows</span>
                        <span class="text-red-400 font-bold">₵${d.outflows.totalOutflows.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between py-3 bg-gradient-to-r from-[#0f172a] to-[#1e293b] px-3 rounded-lg mt-4">
                        <span class="text-white font-bold text-lg">Net Cash Flow</span>
                        <span class="text-xl font-bold ${d.netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}">₵${d.netCashFlow.toFixed(2)}</span>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${e.message}</p>`;
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
                            <tr class="text-gray-400 text-xs border-b border-[#334155]">
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
                                <tr class="border-b border-[#334155]/50 hover:bg-[#0f172a]">
                                    <td class="py-2 text-gray-500 text-xs">${new Date(e.createdAt).toLocaleDateString()}</td>
                                    <td class="py-2 text-gray-300">${escapeHtml(e.description)}</td>
                                    <td class="py-2"><span class="text-xs px-2 py-0.5 rounded bg-[#334155] text-gray-300">${e.account}</span></td>
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
            document.getElementById('financialContent').innerHTML = `<p class="text-red-400">${e.message}</p>`;
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
                    b.classList.remove('bg-blue-600', 'text-white');
                    b.classList.add('bg-[#334155]', 'text-gray-300');
                });
                btn.classList.remove('bg-[#334155]', 'text-gray-300');
                btn.classList.add('bg-blue-600', 'text-white');
                loadFinancials();
            });
        });

        // Order filters
        document.querySelectorAll('.order-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                orderFilter = btn.dataset.filter;
                document.querySelectorAll('.order-filter').forEach(b => {
                    b.classList.remove('bg-blue-600', 'text-white');
                    b.classList.add('bg-[#334155]', 'text-gray-300');
                });
                btn.classList.remove('bg-[#334155]', 'text-gray-300');
                btn.classList.add('bg-blue-600', 'text-white');
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
        document.getElementById('savePricingBtn').addEventListener('click', savePricing);
        document.getElementById('copyStoreLinkBtn').addEventListener('click', function() {
            const url = document.getElementById('storeLinkUrl').textContent;
            if (url) {
                navigator.clipboard.writeText(url).then(() => toast('Store link copied!', 'success')).catch(() => {
                    prompt('Copy your store link:', url);
                });
            }
        });

        // Network filter tabs on packages page
        document.querySelectorAll('.network-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                currentNetwork = btn.dataset.network;
                document.querySelectorAll('.network-filter').forEach(b => {
                    b.classList.remove('bg-yellow-500', 'text-black', 'font-semibold', 'bg-red-500', 'text-white', 'bg-blue-500');
                    b.classList.add('bg-[#334155]', 'text-gray-300');
                });
                const colorMap = { MTN: ['bg-yellow-500', 'text-black', 'font-semibold'], AirtelTigo: ['bg-red-500', 'text-white', 'font-semibold'], Telecel: ['bg-blue-500', 'text-white', 'font-semibold'] };
                btn.classList.remove('bg-[#334155]', 'text-gray-300');
                (colorMap[currentNetwork] || colorMap.MTN).forEach(c => btn.classList.add(c));
                renderPackages();
            });
        });

        // Network tabs inside order modal
        document.querySelectorAll('.order-network-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                orderNetwork = btn.dataset.orderNetwork;
                document.querySelectorAll('.order-network-tab').forEach(b => {
                    b.classList.remove('bg-yellow-500', 'text-black', 'font-semibold', 'bg-red-500', 'text-white', 'bg-blue-500');
                    b.classList.add('bg-[#334155]', 'text-gray-300');
                });
                const colorMap = { MTN: ['bg-yellow-500', 'text-black', 'font-semibold'], AirtelTigo: ['bg-red-500', 'text-white', 'font-semibold'], Telecel: ['bg-blue-500', 'text-white', 'font-semibold'] };
                btn.classList.remove('bg-[#334155]', 'text-gray-300');
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

        // Set agent code
        try {
            const user = JSON.parse(localStorage.getItem('dataeasy_user') || '{}');
            document.getElementById('agentCode').textContent = user.agentCode || '';
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
