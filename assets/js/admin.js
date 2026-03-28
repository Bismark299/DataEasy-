/**
 * DataEasy+ - Admin Module
 * Admin dashboard functionality
 * Supports both API backend and localStorage fallback
 */
(function() {
    'use strict';

    const { Storage, Toast, EventBus } = DataEasyUtils;
    const { Format } = DataEasyUtils;

    // ==========================================
    // ADMIN CONFIGURATION
    // ==========================================
    // Admin auth is handled by the backend API - no hardcoded credentials
    const ADMIN_CREDENTIALS = [];

    let useAPI = false; // Will be set based on backend availability

    // ==========================================
    // ADMIN STATE
    // ==========================================
    let state = {
        currentPage: 'dashboard',
        sidebarCollapsed: false,
        filters: {
            orders: { status: 'all', network: 'all', date: 'all' },
            users: { search: '', status: 'all' },
            transactions: { status: 'all', date: 'all' }
        }
    };

    // ==========================================
    // CHECK API AVAILABILITY
    // ==========================================
    async function checkAPIAvailability() {
        if (typeof DataEasyAPI !== 'undefined') {
            try {
                const available = await DataEasyAPI.isBackendAvailable();
                useAPI = available && DataEasyAPI.Auth.isAdminAuthenticated();
            } catch (e) {
                useAPI = false;
            }
        }
        return useAPI;
    }

    // ==========================================
    // ADMIN AUTHENTICATION
    // ==========================================
    function isAdminCredentials(username, password) {
        return ADMIN_CREDENTIALS.find(
            admin => admin.username === username && admin.password === password
        );
    }

    function getAdminSession() {
        // Check for token stored by API or localStorage
        const token = localStorage.getItem('dataeasy_admin_token');
        const adminData = localStorage.getItem('dataeasy_admin');
        
        if (token && adminData) {
            try {
                return JSON.parse(adminData);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    function setAdminSession(admin) {
        // Generate a simple token for localStorage fallback
        const token = 'local_admin_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
        localStorage.setItem('dataeasy_admin_token', token);
        localStorage.setItem('dataeasy_admin', JSON.stringify({
            username: admin.username,
            name: admin.name,
            role: admin.role,
            loginTime: new Date().toISOString()
        }));
    }

    function clearAdminSession() {
        localStorage.removeItem('dataeasy_admin_token');
        localStorage.removeItem('dataeasy_admin');
        if (typeof DataEasyAPI !== 'undefined') {
            DataEasyAPI.clearTokens();
        }
    }

    function requireAdmin() {
        // Check API admin token first
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAdminAuthenticated()) {
            return { username: 'admin', name: 'Administrator', role: 'admin' };
        }
        
        const session = getAdminSession();
        if (!session) {
            window.location.href = '../pages/login?redirect=admin';
            return false;
        }
        return session;
    }

    // ==========================================
    // DATA ACCESS (API or localStorage)
    // ==========================================
    async function getAllOrders() {
        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Admin.getOrders({ limit: 100 });
                if (response.success) {
                    return response.orders.map(order => ({
                        id: order.orderId,
                        items: order.items,
                        network: order.network,
                        total: order.total,
                        deliveryStatus: order.deliveryStatus,
                        paymentStatus: order.paymentStatus,
                        createdAt: order.createdAt,
                        userName: order.customer?.name || 'Unknown',
                        userEmail: order.customer?.email || ''
                    }));
                }
            } catch (e) {
                // Fall back to localStorage
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users') || [];
        const allOrders = [];
        
        users.forEach(user => {
            const userOrders = Storage.get(`orders_${user.email}`) || [];
            userOrders.forEach(order => {
                allOrders.push({
                    ...order,
                    userEmail: user.email,
                    userName: user.fullName || user.name || 'Unknown'
                });
            });
        });

        // Also check for orders in main orders key
        const mainOrders = Storage.get('orders') || [];
        mainOrders.forEach(order => {
            if (!allOrders.find(o => o.id === order.id)) {
                allOrders.push(order);
            }
        });

        return allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    async function getAllUsers() {
        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Admin.getUsers({ limit: 100 });
                if (response.success) {
                    return response.users.map(user => ({
                        id: user._id,
                        name: user.fullName,
                        email: user.email,
                        phone: user.phone,
                        walletBalance: user.walletBalance,
                        orderCount: user.orderCount,
                        isActive: user.isActive,
                        createdAt: user.createdAt
                    }));
                }
            } catch (e) {
                // Fall back to localStorage
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users') || [];
        return users.map(user => ({
            ...user,
            name: user.fullName || user.name || 'Unknown'
        }));
    }

    async function getAllTransactions() {
        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Admin.getTransactions({ limit: 100 });
                if (response.success) {
                    return response.transactions.map(tx => ({
                        id: tx._id,
                        type: tx.type,
                        amount: tx.amount,
                        description: tx.description,
                        reference: tx.reference,
                        status: tx.status,
                        date: tx.createdAt,
                        userName: tx.user?.name || 'Unknown',
                        userEmail: tx.user?.email || ''
                    }));
                }
            } catch (e) {
                // Fall back to localStorage
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users') || [];
        const allTransactions = [];
        
        users.forEach(user => {
            const wallet = Storage.get('wallet') || {};
            const userTransactions = wallet.transactions || [];
            userTransactions.forEach(tx => {
                allTransactions.push({
                    ...tx,
                    userEmail: user.email,
                    userName: user.name
                });
            });
        });

        return allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function getUserWallet(email) {
        return Storage.get(`wallet_${email}`) || Storage.get('wallet') || { balance: 0 };
    }

    async function updateUserWallet(userId, amount, type, description) {
        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Admin.adjustWallet(userId, Math.abs(amount), type, description);
                if (response.success) {
                    Toast.success(response.message);
                    return true;
                }
            } catch (e) {
                Toast.error(e.message || 'Failed to adjust wallet');
                return false;
            }
        }

        // Fallback to localStorage
        const wallet = Storage.get('wallet') || { balance: 0 };
        if (type === 'credit') {
            wallet.balance = (wallet.balance || 0) + Math.abs(amount);
        } else {
            wallet.balance = Math.max(0, (wallet.balance || 0) - Math.abs(amount));
        }
        Storage.set('wallet', wallet);
        return true;
    }

    async function updateOrderStatus(orderId, newStatus, userEmail = null) {
        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Admin.updateOrderStatus(orderId, newStatus);
                if (response.success) {
                    Toast.success(response.message);
                    return true;
                }
            } catch (e) {
                Toast.error(e.message || 'Failed to update order');
                return false;
            }
        }

        // Fallback to localStorage
        if (userEmail) {
            const orders = Storage.get(`orders_${userEmail}`) || [];
            const orderIndex = orders.findIndex(o => o.id === orderId);
            
            if (orderIndex !== -1) {
                orders[orderIndex].deliveryStatus = newStatus;
                orders[orderIndex].updatedAt = new Date().toISOString();
                Storage.set(`orders_${userEmail}`, orders);
                Toast.success('Order status updated');
                return true;
            }
        }

        // Try main orders
        const mainOrders = Storage.get('orders') || [];
        const idx = mainOrders.findIndex(o => o.id === orderId);
        if (idx !== -1) {
            mainOrders[idx].deliveryStatus = newStatus;
            mainOrders[idx].updatedAt = new Date().toISOString();
            Storage.set('orders', mainOrders);
            Toast.success('Order status updated');
            return true;
        }

        return false;
    }

    // ==========================================
    // STATISTICS
    // ==========================================
    async function getStats() {
        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Admin.getDashboard();
                if (response.success) {
                    return {
                        todayOrders: response.stats.todayOrders,
                        todayRevenue: response.stats.todayRevenue,
                        pendingDeliveries: response.stats.pendingDeliveries,
                        totalOrders: Object.values(response.ordersByStatus || {}).reduce((a, b) => a + b, 0),
                        totalRevenue: response.stats.todayRevenue, // Would need backend change for total
                        totalUsers: response.stats.totalUsers,
                        totalTransactions: 0,
                        ordersByNetwork: { MTN: 0, AirtelTigo: 0, Telecel: 0 },
                        ordersByStatus: response.ordersByStatus || { Processing: 0, Delivered: 0, Failed: 0 },
                        last7Days: []
                    };
                }
            } catch (e) {
                // Fall back to localStorage
            }
        }

        // Fallback to localStorage
        const orders = await getAllOrders();
        const users = await getAllUsers();
        const transactions = await getAllTransactions();
        const today = new Date().toDateString();

        const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today);
        const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        const pendingDeliveries = orders.filter(o => o.deliveryStatus === 'Processing' || o.deliveryStatus === 'Pending').length;
        const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

        const ordersByNetwork = { MTN: 0, AirtelTigo: 0, Telecel: 0 };
        orders.forEach(o => {
            if (o.network && ordersByNetwork[o.network] !== undefined) {
                ordersByNetwork[o.network]++;
            }
        });

        const ordersByStatus = { Processing: 0, Delivered: 0, Failed: 0 };
        orders.forEach(o => {
            const status = o.deliveryStatus || 'Processing';
            if (ordersByStatus[status] !== undefined) {
                ordersByStatus[status]++;
            }
        });

        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toDateString();
            const dayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === dateStr);
            last7Days.push({
                date: date.toLocaleDateString('en-US', { weekday: 'short' }),
                revenue: dayOrders.reduce((sum, o) => sum + (o.total || 0), 0),
                orders: dayOrders.length
            });
        }

        return {
            todayOrders: todayOrders.length,
            todayRevenue,
            pendingDeliveries,
            totalOrders: orders.length,
            totalRevenue,
            totalUsers: users.length,
            totalTransactions: transactions.length,
            ordersByNetwork,
            ordersByStatus,
            last7Days
        };
    }

    // ==========================================
    // UI RENDERING
    // ==========================================
    function renderSidebar() {
        const session = getAdminSession();
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
        
        const menuItems = [
            { id: 'index', icon: 'fas fa-chart-line', label: 'Dashboard', href: 'index' },
            { id: 'orders', icon: 'fas fa-shopping-bag', label: 'Orders', href: 'orders' },
            { id: 'users', icon: 'fas fa-users', label: 'Users', href: 'users' },
            { id: 'packages', icon: 'fas fa-box', label: 'Packages', href: 'packages' },
            { id: 'transactions', icon: 'fas fa-wallet', label: 'Transactions', href: 'transactions' },
            { id: 'settings', icon: 'fas fa-cog', label: 'Settings', href: 'settings' }
        ];

        return `
            <aside id="admin-sidebar" class="fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-700 z-40 transform transition-transform duration-300 lg:translate-x-0 -translate-x-full">
                <!-- Logo -->
                <div class="p-4 border-b border-gray-700">
                    <a href="index" class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                            <i class="fas fa-bolt text-white text-lg"></i>
                        </div>
                        <div>
                            <h1 class="text-white font-bold">DataEasy+</h1>
                            <p class="text-gray-400 text-xs">Admin Panel</p>
                        </div>
                    </a>
                </div>

                <!-- Navigation -->
                <nav class="p-4 space-y-1">
                    ${menuItems.map(item => `
                        <a href="${item.href}" 
                           class="flex items-center gap-3 px-4 py-3 rounded-lg transition ${currentPage === item.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}">
                            <i class="${item.icon} w-5 text-center"></i>
                            <span>${item.label}</span>
                        </a>
                    `).join('')}
                </nav>

                <!-- Admin Info -->
                <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-700">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                            <i class="fas fa-user text-white"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-white font-medium truncate">${session?.name || 'Admin'}</p>
                            <p class="text-gray-400 text-xs">${session?.role || 'admin'}</p>
                        </div>
                    </div>
                    <button data-action="admin-logout" class="w-full px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition flex items-center justify-center gap-2">
                        <i class="fas fa-sign-out-alt"></i>
                        <span>Logout</span>
                    </button>
                </div>
            </aside>
        `;
    }

    function renderHeader(title) {
        return `
            <header class="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-700 z-30">
                <div class="flex items-center justify-between px-4 lg:px-6 py-4">
                    <div class="flex items-center gap-4">
                        <button id="sidebar-toggle" class="lg:hidden text-gray-400 hover:text-white">
                            <i class="fas fa-bars text-xl"></i>
                        </button>
                        <h1 class="text-white text-xl font-semibold">${title}</h1>
                    </div>
                    <div class="flex items-center gap-4">
                        <a href="../index" class="text-gray-400 hover:text-white text-sm flex items-center gap-2">
                            <i class="fas fa-external-link-alt"></i>
                            <span class="hidden sm:inline">View Site</span>
                        </a>
                    </div>
                </div>
            </header>
        `;
    }

    function renderStatsCards(stats) {
        const cards = [
            { label: "Today's Orders", value: stats.todayOrders, icon: 'fas fa-shopping-bag', color: 'blue', change: '+12%' },
            { label: "Today's Revenue", value: `GH₵${stats.todayRevenue.toFixed(2)}`, icon: 'fas fa-coins', color: 'green', change: '+8%' },
            { label: 'Pending Deliveries', value: stats.pendingDeliveries, icon: 'fas fa-clock', color: 'yellow', change: '-5%' },
            { label: 'Total Users', value: stats.totalUsers, icon: 'fas fa-users', color: 'purple', change: '+3%' }
        ];

        return `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                ${cards.map(card => `
                    <div class="bg-gray-800 rounded-xl p-5 border border-gray-700">
                        <div class="flex items-start justify-between mb-3">
                            <div class="w-12 h-12 bg-${card.color}-500/20 rounded-lg flex items-center justify-center">
                                <i class="${card.icon} text-${card.color}-400 text-xl"></i>
                            </div>
                            <span class="text-${card.change.startsWith('+') ? 'green' : 'red'}-400 text-sm font-medium">${card.change}</span>
                        </div>
                        <p class="text-gray-400 text-sm mb-1">${card.label}</p>
                        <p class="text-white text-2xl font-bold">${card.value}</p>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderRecentOrders(orders) {
        const recent = orders.slice(0, 10);
        
        return `
            <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div class="p-4 border-b border-gray-700 flex items-center justify-between">
                    <h3 class="text-white font-semibold">Recent Orders</h3>
                    <a href="orders" class="text-blue-400 text-sm hover:underline">View All</a>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-900/50">
                            <tr>
                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Order ID</th>
                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Customer</th>
                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Network</th>
                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Total</th>
                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Status</th>
                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Date</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-700">
                            ${recent.length === 0 ? `
                                <tr>
                                    <td colspan="6" class="text-center text-gray-500 py-8">No orders yet</td>
                                </tr>
                            ` : recent.map(order => `
                                <tr class="hover:bg-gray-700/50 transition">
                                    <td class="px-4 py-3 text-white font-mono text-sm">#${order.id}</td>
                                    <td class="px-4 py-3 text-gray-300 text-sm">${order.userName || order.userEmail}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-1 rounded text-xs font-medium ${getNetworkClass(order.network)}">${order.network || 'N/A'}</span>
                                    </td>
                                    <td class="px-4 py-3 text-white font-medium">GH₵${order.total.toFixed(2)}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-1 rounded text-xs font-medium ${getStatusClass(order.deliveryStatus)}">${order.deliveryStatus || 'Processing'}</span>
                                    </td>
                                    <td class="px-4 py-3 text-gray-400 text-sm">${formatDate(order.createdAt)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderNetworkChart(ordersByNetwork) {
        const total = Object.values(ordersByNetwork).reduce((a, b) => a + b, 0) || 1;
        
        return `
            <div class="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 class="text-white font-semibold mb-4">Orders by Network</h3>
                <div class="space-y-3">
                    ${Object.entries(ordersByNetwork).map(([network, count]) => {
                        const percent = Math.round((count / total) * 100);
                        const color = network === 'MTN' ? 'yellow' : (network === 'AirtelTigo' ? 'red' : 'red');
                        return `
                            <div>
                                <div class="flex justify-between text-sm mb-1">
                                    <span class="text-gray-300">${network}</span>
                                    <span class="text-gray-400">${count} (${percent}%)</span>
                                </div>
                                <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
                                    <div class="h-full bg-${color}-500 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderStatusChart(ordersByStatus) {
        return `
            <div class="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h3 class="text-white font-semibold mb-4">Delivery Status</h3>
                <div class="flex justify-around">
                    ${Object.entries(ordersByStatus).map(([status, count]) => {
                        const color = status === 'Delivered' ? 'green' : (status === 'Failed' ? 'red' : 'yellow');
                        const icon = status === 'Delivered' ? 'check-circle' : (status === 'Failed' ? 'times-circle' : 'clock');
                        return `
                            <div class="text-center">
                                <div class="w-16 h-16 bg-${color}-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                                    <i class="fas fa-${icon} text-${color}-400 text-2xl"></i>
                                </div>
                                <p class="text-white text-xl font-bold">${count}</p>
                                <p class="text-gray-400 text-sm">${status}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================
    function getNetworkClass(network) {
        switch (network) {
            case 'MTN': return 'bg-yellow-500/20 text-yellow-400';
            case 'AirtelTigo': return 'bg-red-500/20 text-red-400';
            case 'Telecel': return 'bg-red-500/20 text-red-400';
            default: return 'bg-gray-500/20 text-gray-400';
        }
    }

    function getStatusClass(status) {
        switch (status) {
            case 'Delivered': return 'bg-green-500/20 text-green-400';
            case 'Failed': return 'bg-red-500/20 text-red-400';
            case 'Pending': return 'bg-orange-500/20 text-orange-400';
            case 'Processing':
            default: return 'bg-yellow-500/20 text-yellow-400';
        }
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function formatDateTime(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleString('en-GB', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // ==========================================
    // PAGE INITIALIZERS
    // ==========================================
    async function initDashboard() {
        const session = requireAdmin();
        if (!session) return;

        // Check API availability
        await checkAPIAvailability();

        const stats = await getStats();
        const orders = await getAllOrders();

        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
            ${renderSidebar()}
            <div class="lg:ml-64 min-h-screen">
                ${renderHeader('Dashboard')}
                <main class="p-4 lg:p-6">
                    ${renderStatsCards(stats)}
                    <div class="grid lg:grid-cols-3 gap-6 mb-6">
                        <div class="lg:col-span-2">
                            ${renderRecentOrders(orders)}
                        </div>
                        <div class="space-y-6">
                            ${renderNetworkChart(stats.ordersByNetwork)}
                            ${renderStatusChart(stats.ordersByStatus)}
                        </div>
                    </div>
                </main>
            </div>
        `;

        initSidebarToggle();
    }

    async function initOrdersPage() {
        const session = requireAdmin();
        if (!session) return;

        await checkAPIAvailability();
        const orders = await getAllOrders();

        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
            ${renderSidebar()}
            <div class="lg:ml-64 min-h-screen">
                ${renderHeader('Orders')}
                <main class="p-4 lg:p-6">
                    <!-- Filters -->
                    <div class="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-6">
                        <div class="flex flex-wrap gap-4">
                            <select id="filter-status" class="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                                <option value="all">All Status</option>
                                <option value="Pending">Pending</option>
                                <option value="Processing">Processing</option>
                                <option value="Delivered">Delivered</option>
                                <option value="Failed">Failed</option>
                            </select>
                            <select id="filter-network" class="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                                <option value="all">All Networks</option>
                                <option value="MTN">MTN</option>
                                <option value="AirtelTigo">AirtelTigo</option>
                                <option value="Telecel">Telecel</option>
                            </select>
                            <input type="text" id="search-order" placeholder="Search order ID..." class="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none flex-1 min-w-[200px]">
                        </div>
                    </div>

                    <!-- Orders Table -->
                    <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead class="bg-gray-900/50">
                                    <tr>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Order ID</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Customer</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Items</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Network</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Total</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Status</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Date</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="orders-tbody" class="divide-y divide-gray-700">
                                    ${renderOrderRows(orders)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </main>
            </div>
        `;

        initSidebarToggle();
        initOrderFilters();
    }

    function renderOrderRows(orders) {
        if (orders.length === 0) {
            return `<tr><td colspan="8" class="text-center text-gray-500 py-8">No orders found</td></tr>`;
        }

        return orders.map(order => `
            <tr class="hover:bg-gray-700/50 transition" data-order-id="${order.id}" data-user-email="${order.userEmail}" data-status="${order.deliveryStatus || 'Processing'}" data-network="${order.network || ''}">
                <td class="px-4 py-3 text-white font-mono text-sm">#${order.id}</td>
                <td class="px-4 py-3">
                    <p class="text-gray-300 text-sm">${order.userName || 'N/A'}</p>
                    <p class="text-gray-500 text-xs">${order.userEmail}</p>
                </td>
                <td class="px-4 py-3 text-gray-300 text-sm">${order.items?.length || 0} items</td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded text-xs font-medium ${getNetworkClass(order.network)}">${order.network || 'N/A'}</span>
                </td>
                <td class="px-4 py-3 text-white font-medium">GH₵${order.total.toFixed(2)}</td>
                <td class="px-4 py-3">
                    <select class="status-select bg-gray-700 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none ${getStatusSelectClass(order.deliveryStatus)}" data-order-id="${order.id}" data-user-email="${order.userEmail}">
                        <option value="Pending" ${order.deliveryStatus === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="Processing" ${order.deliveryStatus === 'Processing' ? 'selected' : ''}>Processing</option>
                        <option value="Delivered" ${order.deliveryStatus === 'Delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="Failed" ${order.deliveryStatus === 'Failed' ? 'selected' : ''}>Failed</option>
                    </select>
                </td>
                <td class="px-4 py-3 text-gray-400 text-sm">${formatDateTime(order.createdAt)}</td>
                <td class="px-4 py-3">
                    <button class="view-order-btn text-blue-400 hover:text-blue-300" data-order-id="${order.id}" data-user-email="${order.userEmail}">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function getStatusSelectClass(status) {
        switch (status) {
            case 'Delivered': return 'text-green-400';
            case 'Failed': return 'text-red-400';
            case 'Pending': return 'text-orange-400';
            default: return 'text-yellow-400';
        }
    }

    function initOrderFilters() {
        const statusFilter = document.getElementById('filter-status');
        const networkFilter = document.getElementById('filter-network');
        const searchInput = document.getElementById('search-order');
        const tbody = document.getElementById('orders-tbody');

        function applyFilters() {
            const status = statusFilter.value;
            const network = networkFilter.value;
            const search = searchInput.value.toLowerCase();

            const rows = tbody.querySelectorAll('tr[data-order-id]');
            rows.forEach(row => {
                const rowStatus = row.dataset.status;
                const rowNetwork = row.dataset.network;
                const orderId = row.dataset.orderId.toLowerCase();

                const matchStatus = status === 'all' || rowStatus === status;
                const matchNetwork = network === 'all' || rowNetwork === network;
                const matchSearch = !search || orderId.includes(search);

                row.style.display = matchStatus && matchNetwork && matchSearch ? '' : 'none';
            });
        }

        statusFilter?.addEventListener('change', applyFilters);
        networkFilter?.addEventListener('change', applyFilters);
        searchInput?.addEventListener('input', applyFilters);

        // Status change handler
        document.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const orderId = e.target.dataset.orderId;
                const userEmail = e.target.dataset.userEmail;
                const newStatus = e.target.value;

                const success = await updateOrderStatus(orderId, newStatus, userEmail);
                if (success) {
                    e.target.className = `status-select bg-gray-700 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none ${getStatusSelectClass(newStatus)}`;
                    e.target.closest('tr').dataset.status = newStatus;
                }
            });
        });
    }

    async function initUsersPage() {
        const session = requireAdmin();
        if (!session) return;

        await checkAPIAvailability();
        const users = await getAllUsers();

        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
            ${renderSidebar()}
            <div class="lg:ml-64 min-h-screen">
                ${renderHeader('Users')}
                <main class="p-4 lg:p-6">
                    <!-- Search -->
                    <div class="bg-gray-800 rounded-xl p-4 border border-gray-700 mb-6">
                        <input type="text" id="search-user" placeholder="Search by name or email..." class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                    </div>

                    <!-- Users Grid -->
                    <div id="users-grid" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${renderUserCards(users)}
                    </div>
                </main>
            </div>
        `;

        initSidebarToggle();
        initUserSearch();
    }

    function renderUserCards(users) {
        if (users.length === 0) {
            return `<div class="col-span-full text-center text-gray-500 py-8">No users registered yet</div>`;
        }

        return users.map(user => {
            const wallet = user.walletBalance !== undefined ? { balance: user.walletBalance } : getUserWallet(user.email);
            const orderCount = user.orderCount !== undefined ? user.orderCount : (Storage.get(`orders_${user.email}`) || []).length;
            
            return `
                <div class="user-card bg-gray-800 rounded-xl p-5 border border-gray-700" data-user-id="${user.id || user._id}" data-name="${(user.name || '').toLowerCase()}" data-email="${(user.email || '').toLowerCase()}">
                    <div class="flex items-start gap-4 mb-4">
                        <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                            <span class="text-white font-bold text-lg">${(user.name || 'U').charAt(0).toUpperCase()}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <h3 class="text-white font-semibold truncate">${user.name || 'Unknown'}</h3>
                            <p class="text-gray-400 text-sm truncate">${user.email || ''}</p>
                            <p class="text-gray-500 text-xs">${user.phone || 'No phone'}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-4">
                        <div class="bg-gray-700/50 rounded-lg p-3 text-center">
                            <p class="text-green-400 font-bold">GH₵${(wallet.balance || 0).toFixed(2)}</p>
                            <p class="text-gray-400 text-xs">Balance</p>
                        </div>
                        <div class="bg-gray-700/50 rounded-lg p-3 text-center">
                            <p class="text-blue-400 font-bold">${orderCount}</p>
                            <p class="text-gray-400 text-xs">Orders</p>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button class="flex-1 px-3 py-2 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 transition text-sm" data-action="adjust-wallet" data-user-id="${user.id || user._id}" data-user-email="${user.email}">
                            <i class="fas fa-wallet mr-1"></i> Adjust
                        </button>
                        <button class="flex-1 px-3 py-2 bg-gray-600/20 text-gray-400 rounded-lg hover:bg-gray-600/30 transition text-sm" data-action="view-user-orders" data-user-email="${user.email}">
                            <i class="fas fa-history mr-1"></i> Orders
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function initUserSearch() {
        const searchInput = document.getElementById('search-user');
        const cards = document.querySelectorAll('.user-card');

        searchInput?.addEventListener('input', () => {
            const search = searchInput.value.toLowerCase();
            cards.forEach(card => {
                const name = card.dataset.name || '';
                const email = card.dataset.email || '';
                const match = !search || name.includes(search) || email.includes(search);
                card.style.display = match ? '' : 'none';
            });
        });
    }

    async function adjustWallet(userIdOrEmail, email) {
        // Support both userId (for API) and email (for localStorage)
        const userId = userIdOrEmail;
        const userEmail = email || userIdOrEmail;
        
        const wallet = getUserWallet(userEmail);
        const currentBalance = (wallet.balance || 0).toFixed(2);
        
        // Create modal dialog instead of prompt
        const modalHtml = `
            <div id="wallet-adjust-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
                    <h3 class="text-lg font-semibold text-white mb-4">Adjust Wallet Balance</h3>
                    <p class="text-gray-400 mb-4">Current balance: <span class="text-white font-bold">GH₵${currentBalance}</span></p>
                    <div class="mb-4">
                        <label class="block text-gray-400 text-sm mb-2">Amount (positive to add, negative to subtract)</label>
                        <input type="number" id="wallet-adjust-amount" step="0.01" class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500" placeholder="e.g. 50 or -20">
                    </div>
                    <div class="flex gap-3 justify-end">
                        <button id="wallet-adjust-cancel" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500">Cancel</button>
                        <button id="wallet-adjust-confirm" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500">Confirm</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById('wallet-adjust-modal');
        const input = document.getElementById('wallet-adjust-amount');
        input.focus();
        
        return new Promise((resolve) => {
            const cleanup = () => modal.remove();
            
            document.getElementById('wallet-adjust-cancel').onclick = () => {
                cleanup();
                resolve();
            };
            
            modal.onclick = (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve();
                }
            };
            
            const processAdjustment = async () => {
                const amount = input.value;
                if (!amount) {
                    cleanup();
                    resolve();
                    return;
                }
                
                const numAmount = parseFloat(amount);
                if (isNaN(numAmount)) {
                    Toast.error('Invalid amount');
                    return;
                }
                
                cleanup();
                
                const type = numAmount >= 0 ? 'credit' : 'debit';
                const description = numAmount >= 0 ? 'Admin credit' : 'Admin debit';
                
                const success = await updateUserWallet(userId, numAmount, type, description);
                
                if (success) {
                    const newBalance = type === 'credit' 
                        ? (wallet.balance || 0) + Math.abs(numAmount) 
                        : Math.max(0, (wallet.balance || 0) - Math.abs(numAmount));
                    Toast.success(`Wallet updated! New balance: GH₵${newBalance.toFixed(2)}`);
                    initUsersPage();
                }
                resolve();
            };
            
            document.getElementById('wallet-adjust-confirm').onclick = processAdjustment;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') processAdjustment();
                if (e.key === 'Escape') { cleanup(); resolve(); }
            };
        });
    }

    function viewUserOrders(email) {
        const orders = Storage.get(`orders_${email}`) || [];
        const user = getAllUsers().find(u => u.email === email);
        
        if (orders.length === 0) {
            Toast.info(`${user?.name || email} has no orders yet`);
            return;
        }

        // Show orders in modal
        let message = `Orders for ${user?.name || email}:\n\n`;
        orders.slice(0, 5).forEach(order => {
            message += `#${order.id} - GH₵${order.total.toFixed(2)} - ${order.deliveryStatus || 'Processing'}\n`;
        });
        if (orders.length > 5) {
            message += `\n... and ${orders.length - 5} more orders`;
        }
        
        if (typeof showAlert === 'function') {
            showAlert({
                title: 'User Orders',
                message: message,
                type: 'info'
            });
        } else {
            // Fallback for pages without admin-common.js
        }
    }

    function initPackagesPage() {
        const session = requireAdmin();
        if (!session) return;

        // Get packages from cart module
        const allPackages = {
            MTN: DataEasyCart.getPackages('MTN'),
            AirtelTigo: DataEasyCart.getPackages('AirtelTigo'),
            Telecel: DataEasyCart.getPackages('Telecel')
        };

        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
            ${renderSidebar()}
            <div class="lg:ml-64 min-h-screen">
                ${renderHeader('Packages')}
                <main class="p-4 lg:p-6">
                    <div class="space-y-6">
                        ${Object.entries(allPackages).map(([network, packages]) => `
                            <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                <div class="p-4 border-b border-gray-700 flex items-center justify-between">
                                    <h3 class="text-white font-semibold flex items-center gap-2">
                                        <span class="w-3 h-3 rounded-full ${network === 'MTN' ? 'bg-yellow-500' : 'bg-red-500'}"></span>
                                        ${network} Packages
                                    </h3>
                                    <span class="text-gray-400 text-sm">${packages.length} packages</span>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full">
                                        <thead class="bg-gray-900/50">
                                            <tr>
                                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">ID</th>
                                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Name</th>
                                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Data</th>
                                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Validity</th>
                                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Price</th>
                                                <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Popular</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-700">
                                            ${packages.map(pkg => `
                                                <tr class="hover:bg-gray-700/50 transition">
                                                    <td class="px-4 py-3 text-gray-400 font-mono text-sm">${pkg.id}</td>
                                                    <td class="px-4 py-3 text-white">${pkg.name}</td>
                                                    <td class="px-4 py-3 text-gray-300">${pkg.data}</td>
                                                    <td class="px-4 py-3 text-gray-400">${pkg.validity}</td>
                                                    <td class="px-4 py-3 text-green-400 font-medium">GH₵${pkg.price.toFixed(2)}</td>
                                                    <td class="px-4 py-3">
                                                        ${pkg.popular ? '<span class="text-yellow-400"><i class="fas fa-star"></i></span>' : '<span class="text-gray-600"><i class="far fa-star"></i></span>'}
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <p class="text-gray-500 text-sm text-center mt-6">
                        <i class="fas fa-info-circle mr-1"></i>
                        Package pricing is defined in assets/js/cart.js
                    </p>
                </main>
            </div>
        `;

        initSidebarToggle();
    }

    async function initTransactionsPage() {
        const session = requireAdmin();
        if (!session) return;

        await checkAPIAvailability();
        const transactions = await getAllTransactions();

        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
            ${renderSidebar()}
            <div class="lg:ml-64 min-h-screen">
                ${renderHeader('Transactions')}
                <main class="p-4 lg:p-6">
                    <!-- Stats -->
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
                            <p class="text-gray-400 text-sm">Total Transactions</p>
                            <p class="text-white text-2xl font-bold">${transactions.length}</p>
                        </div>
                        <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
                            <p class="text-gray-400 text-sm">Total Volume</p>
                            <p class="text-green-400 text-2xl font-bold">GH₵${transactions.filter(t => t.type === 'credit').reduce((s, t) => s + (t.amount || 0), 0).toFixed(2)}</p>
                        </div>
                    </div>

                    <!-- Transactions Table -->
                    <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead class="bg-gray-900/50">
                                    <tr>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Reference</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">User</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Type</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Amount</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Status</th>
                                        <th class="text-left text-gray-400 text-xs font-medium px-4 py-3">Date</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-700">
                                    ${transactions.length === 0 ? `
                                        <tr><td colspan="6" class="text-center text-gray-500 py-8">No transactions yet</td></tr>
                                    ` : transactions.map(tx => `
                                        <tr class="hover:bg-gray-700/50 transition">
                                            <td class="px-4 py-3 text-gray-400 font-mono text-xs">${tx.reference || 'N/A'}</td>
                                            <td class="px-4 py-3">
                                                <p class="text-gray-300 text-sm">${tx.userName || 'N/A'}</p>
                                                <p class="text-gray-500 text-xs">${tx.userEmail}</p>
                                            </td>
                                            <td class="px-4 py-3">
                                                <span class="px-2 py-1 rounded text-xs font-medium ${tx.type === 'credit' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                                                    ${tx.type === 'credit' ? 'Top-up' : 'Debit'}
                                                </span>
                                            </td>
                                            <td class="px-4 py-3 ${tx.type === 'credit' ? 'text-green-400' : 'text-red-400'} font-medium">
                                                ${tx.type === 'credit' ? '+' : '-'}GH₵${tx.amount.toFixed(2)}
                                            </td>
                                            <td class="px-4 py-3">
                                                <span class="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">Completed</span>
                                            </td>
                                            <td class="px-4 py-3 text-gray-400 text-sm">${formatDateTime(tx.date)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </main>
            </div>
        `;

        initSidebarToggle();
    }

    function initSettingsPage() {
        const session = requireAdmin();
        if (!session) return;

        const app = document.getElementById('app');
        if (!app) return;

        app.innerHTML = `
            ${renderSidebar()}
            <div class="lg:ml-64 min-h-screen">
                ${renderHeader('Settings')}
                <main class="p-4 lg:p-6">
                    <div class="max-w-2xl space-y-6">
                        <!-- Platform Settings -->
                        <div class="bg-gray-800 rounded-xl border border-gray-700 p-6">
                            <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
                                <i class="fas fa-globe text-blue-400"></i>
                                Platform Settings
                            </h3>
                            <div class="space-y-4">
                                <div>
                                    <label class="block text-gray-400 text-sm mb-2">Platform Name</label>
                                    <input type="text" value="DataEasy+" class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                                </div>
                                <div>
                                    <label class="block text-gray-400 text-sm mb-2">Support Email</label>
                                    <input type="email" value="support@dataeasyplus.com" class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                                </div>
                            </div>
                        </div>

                        <!-- Paystack Settings -->
                        <div class="bg-gray-800 rounded-xl border border-gray-700 p-6">
                            <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
                                <i class="fas fa-credit-card text-green-400"></i>
                                Paystack Settings
                            </h3>
                            <div class="space-y-4">
                                <div class="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 text-yellow-400 text-sm">
                                    <i class="fas fa-info-circle mr-2"></i>
                                    Paystack keys are configured via Render environment variables (PAYSTACK_PUBLIC_KEY, PAYSTACK_SECRET_KEY)
                                </div>
                            </div>
                        </div>

                        <!-- Admin Account -->
                        <div class="bg-gray-800 rounded-xl border border-gray-700 p-6">
                            <h3 class="text-white font-semibold mb-4 flex items-center gap-2">
                                <i class="fas fa-user-shield text-purple-400"></i>
                                Admin Account
                            </h3>
                            <div class="space-y-4">
                                <div>
                                    <label class="block text-gray-400 text-sm mb-2">Current Password</label>
                                    <input type="password" placeholder="Enter current password" class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                                </div>
                                <div>
                                    <label class="block text-gray-400 text-sm mb-2">New Password</label>
                                    <input type="password" placeholder="Enter new password" class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none">
                                </div>
                            </div>
                        </div>

                        <button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition">
                            <i class="fas fa-save mr-2"></i>
                            Save Settings
                        </button>
                    </div>
                </main>
            </div>
        `;

        initSidebarToggle();
    }

    // ==========================================
    // SIDEBAR TOGGLE
    // ==========================================
    function initSidebarToggle() {
        const toggle = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('admin-sidebar');

        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('-translate-x-full');
            });

            // Close on outside click (mobile)
            document.addEventListener('click', (e) => {
                if (window.innerWidth < 1024 && 
                    !sidebar.contains(e.target) && 
                    !toggle.contains(e.target) &&
                    !sidebar.classList.contains('-translate-x-full')) {
                    sidebar.classList.add('-translate-x-full');
                }
            });
        }
    }

    // ==========================================
    // LOGOUT
    // ==========================================
    function logout() {
        clearAdminSession();
        Toast.success('Logged out successfully');
        window.location.href = '../pages/login';
    }

    // ==========================================
    // GLOBAL EVENT DELEGATION (CSP-safe)
    // ==========================================
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'admin-logout') {
            logout();
        } else if (action === 'adjust-wallet') {
            adjustWallet(btn.dataset.userId, btn.dataset.userEmail);
        } else if (action === 'view-user-orders') {
            viewUserOrders(btn.dataset.userEmail);
        }
    });

    // ==========================================
    // PUBLIC API
    // ==========================================
    window.DataEasyAdmin = {
        // Auth
        isAdminCredentials,
        getAdminSession,
        setAdminSession,
        clearAdminSession,
        requireAdmin,
        logout,

        // Data
        getAllOrders,
        getAllUsers,
        getAllTransactions,
        getStats,
        updateOrderStatus,
        adjustWallet,
        viewUserOrders,

        // Page initializers
        initDashboard,
        initOrdersPage,
        initUsersPage,
        initPackagesPage,
        initTransactionsPage,
        initSettingsPage
    };
})();
