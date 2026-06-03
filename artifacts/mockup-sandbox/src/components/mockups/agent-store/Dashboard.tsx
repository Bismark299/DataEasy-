import React, { useState } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  WalletCards,
  LineChart,
  Settings,
  Bell,
  Search,
  Plus,
  ArrowUpRight,
  MoreHorizontal,
  Filter,
  Download,
  Store,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export function Dashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "packages", label: "Packages", icon: Package },
    { id: "orders", label: "Orders", icon: ShoppingBag },
    { id: "payouts", label: "Payouts", icon: WalletCards },
    { id: "financials", label: "Financials", icon: LineChart },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const orders = [
    { id: "ORD-8812", date: "Today 10:23", phone: "0241234567", package: "MTN 5GB", network: "MTN", amount: 14.50, status: "Fulfilled", profit: 1.50 },
    { id: "ORD-8811", date: "Today 09:45", phone: "0501234567", package: "AirtelTigo 2GB", network: "AirtelTigo", amount: 8.00, status: "Paid", profit: 0.80 },
    { id: "ORD-8810", date: "Today 08:30", phone: "0271234567", package: "Telecel 10GB", network: "Telecel", amount: 25.00, status: "Fulfilled", profit: 2.50 },
    { id: "ORD-8809", date: "Yesterday", phone: "0244567890", package: "MTN 1GB", network: "MTN", amount: 5.50, status: "Fulfilled", profit: 0.55 },
    { id: "ORD-8808", date: "Yesterday", phone: "0506789012", package: "AirtelTigo 5GB", network: "AirtelTigo", amount: 18.00, status: "Pending", profit: 1.80 },
  ];

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'Fulfilled':
        return <Badge className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20 font-medium">Fulfilled</Badge>;
      case 'Paid':
        return <Badge className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/20 font-medium">Paid</Badge>;
      case 'Pending':
        return <Badge className="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20 font-medium">Pending</Badge>;
      default:
        return <Badge variant="outline" className="text-slate-400 border-slate-700">{status}</Badge>;
    }
  };

  const getNetworkBadge = (network: string) => {
    switch(network) {
      case 'MTN':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/20">MTN</span>;
      case 'AirtelTigo':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20"><span className="text-blue-400 mr-1">AT</span></span>;
      case 'Telecel':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-600/10 text-red-500 border border-red-600/20">Telecel</span>;
      default:
        return <span>{network}</span>;
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#070b14] text-slate-300 overflow-hidden font-sans relative selection:bg-indigo-500/30">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .font-sans { font-family: 'Plus Jakarta Sans', sans-serif; }
        .text-gradient { background: linear-gradient(135deg, #818cf8 0%, #c084fc 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .card-gradient { background: linear-gradient(180deg, rgba(15, 23, 42, 0.4) 0%, rgba(10, 15, 28, 0.8) 100%); border: 1px solid rgba(255, 255, 255, 0.05); }
        .stat-glow { position: absolute; inset: 0; background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.08), transparent 50%); pointer-events: none; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}} />

      {/* Decorative background blurs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-900/10 blur-[120px] pointer-events-none" />

      {/* Sidebar */}
      <aside className="w-[240px] flex-shrink-0 flex flex-col border-r border-slate-800/40 bg-[#0a0f1c]/80 backdrop-blur-xl z-20">
        <div className="h-16 flex items-center px-6 border-b border-slate-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Store className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">DataEasy<span className="text-indigo-400">+</span></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-1">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2">Menu</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === item.id
                  ? "bg-indigo-500/10 text-indigo-400"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <item.icon className={`w-4 h-4 ${activeTab === item.id ? "text-indigo-400" : "text-slate-500"}`} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800/40 mt-auto">
          <div className="flex items-center gap-3 p-3 rounded-xl card-gradient">
            <Avatar className="w-10 h-10 border border-slate-700/50">
              <AvatarFallback className="bg-slate-800 text-slate-300 font-semibold">SA</AvatarFallback>
            </Avatar>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-semibold text-slate-200 truncate">Smart Agent</span>
              <span className="text-xs text-indigo-400 truncate">₵847.30 Available</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800/40 bg-[#0a0f1c]/50 backdrop-blur-md sticky top-0 z-20">
          <h1 className="text-xl font-semibold text-white">Dashboard</h1>
          
          <div className="flex items-center gap-4">
            <div className="relative group hidden md:block">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-indigo-400 transition-colors" />
              <Input 
                placeholder="Search orders..." 
                className="w-64 pl-9 bg-slate-900/50 border-slate-800 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50 transition-all rounded-full text-sm h-9"
              />
            </div>
            
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-full h-9 w-9">
              <Bell className="w-4 h-4" />
            </Button>
            
            <Button className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-lg shadow-indigo-500/20 border-0 h-9 rounded-full px-4 text-sm font-medium transition-all hover:scale-[1.02]">
              <Plus className="w-4 h-4 mr-1.5" /> New Order
            </Button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Primary KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              
              <div className="rounded-2xl card-gradient p-5 relative overflow-hidden group">
                <div className="stat-glow"></div>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                    <WalletCards className="w-5 h-5 text-emerald-400" />
                  </div>
                  <Badge variant="outline" className="bg-emerald-500/5 text-emerald-400 border-emerald-500/20 font-medium">Ready</Badge>
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">Available Balance</div>
                <div className="text-3xl font-bold text-white tracking-tight">₵847.30</div>
              </div>

              <div className="rounded-2xl card-gradient p-5 relative overflow-hidden group">
                <div className="stat-glow"></div>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                    <LineChart className="w-5 h-5 text-indigo-400" />
                  </div>
                  <span className="text-xs font-semibold text-emerald-400 flex items-center bg-emerald-500/10 px-2 py-1 rounded-full"><ArrowUpRight className="w-3 h-3 mr-0.5"/> +12%</span>
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">Today's Sales</div>
                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-bold text-white tracking-tight">₵47.50</div>
                  <div className="text-sm text-slate-500">/ 3 orders</div>
                </div>
              </div>

              <div className="rounded-2xl card-gradient p-5 relative overflow-hidden group">
                <div className="stat-glow"></div>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
                    <LayoutDashboard className="w-5 h-5 text-violet-400" />
                  </div>
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">Total Revenue</div>
                <div className="text-3xl font-bold text-white tracking-tight">₵12,450.00</div>
              </div>

              <div className="rounded-2xl card-gradient p-5 relative overflow-hidden group">
                <div className="stat-glow"></div>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                    <ArrowUpRight className="w-5 h-5 text-amber-400" />
                  </div>
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">Total Payouts</div>
                <div className="text-3xl font-bold text-white tracking-tight">₵10,200.00</div>
              </div>

            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Orders", value: "847" },
                { label: "Priced Packages", value: "24" },
                { label: "On Hold", value: "₵150.00" },
                { label: "Cost of Goods", value: "₵9,870.00" }
              ].map((stat, i) => (
                <div key={i} className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4 text-center hover:bg-slate-800/30 transition-colors">
                  <div className="text-xl font-bold text-slate-200 mb-1">{stat.value}</div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Orders Table Section */}
            <div className="rounded-2xl card-gradient overflow-hidden">
              <div className="p-5 border-b border-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Recent Orders</h2>
                  <p className="text-sm text-slate-500">Latest transactions from your store.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" className="bg-slate-900/50 border-slate-700 hover:bg-slate-800 text-slate-300">
                    <Filter className="w-4 h-4 mr-2" /> Filter
                  </Button>
                  <Button variant="outline" size="sm" className="bg-slate-900/50 border-slate-700 hover:bg-slate-800 text-slate-300">
                    <Download className="w-4 h-4 mr-2" /> Export
                  </Button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-400 bg-slate-900/50 uppercase font-semibold">
                    <tr>
                      <th className="px-6 py-4 font-semibold tracking-wider">Reference</th>
                      <th className="px-6 py-4 font-semibold tracking-wider">Date</th>
                      <th className="px-6 py-4 font-semibold tracking-wider">Customer Phone</th>
                      <th className="px-6 py-4 font-semibold tracking-wider">Package</th>
                      <th className="px-6 py-4 font-semibold tracking-wider text-right">Amount</th>
                      <th className="px-6 py-4 font-semibold tracking-wider text-right">Profit</th>
                      <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                      <th className="px-6 py-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {orders.map((order, i) => (
                      <tr key={i} className="hover:bg-slate-800/20 transition-colors group">
                        <td className="px-6 py-4 font-medium text-slate-300">{order.id}</td>
                        <td className="px-6 py-4 text-slate-400">{order.date}</td>
                        <td className="px-6 py-4 text-slate-300">{order.phone}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {getNetworkBadge(order.network)}
                            <span className="text-slate-300">{order.package.split(' ')[1]}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-slate-200">₵{order.amount.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right font-medium text-emerald-400">+₵{order.profit.toFixed(2)}</td>
                        <td className="px-6 py-4">{getStatusBadge(order.status)}</td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-slate-800/40 flex items-center justify-between text-sm text-slate-500 bg-slate-900/20">
                <span>Showing 1 to 5 of 847 orders</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-transparent hover:bg-slate-800 text-slate-300" disabled>Previous</Button>
                  <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-transparent hover:bg-slate-800 text-slate-300">Next</Button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
