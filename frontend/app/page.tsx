"use client";

import { useState, useEffect } from "react";
import { useUser, UserButton, RedirectToSignIn } from "@clerk/nextjs"; 

export default function Home() {
  const { isLoaded, isSignedIn, user } = useUser(); 
  const [transactions, setTransactions] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("All Time");
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [budgetCaps, setBudgetCaps] = useState({ total_limit: 2500000, food_limit: 1920000, fuel_limit: 168000, maint_limit: 412000 });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempCaps, setTempCaps] = useState(budgetCaps);

  const secureHeaders = {
    "Content-Type": "application/json",
    "x-user-id": user?.id || "",
  };

  const fetchData = async () => {
    if (!user) return;
    try {
      const [txRes, setRes] = await Promise.all([
        fetch("http://localhost:8000/api/transactions", { headers: secureHeaders }),
        fetch("http://localhost:8000/api/settings", { headers: secureHeaders })
      ]);
      if (txRes.ok) setTransactions(await txRes.json());
      if (setRes.ok) {
        const settings = await setRes.json();
        setBudgetCaps(settings);
        setTempCaps(settings);
      }
    } catch (error: any) { console.error("Network Failed: " + error.message); }
  };

  useEffect(() => { if (user) fetchData(); }, [user]);

  const handleSaveSettings = async () => {
    try {
      await fetch("http://localhost:8000/api/settings", {
        method: "PUT", headers: secureHeaders,
        body: JSON.stringify(tempCaps),
      });
      setBudgetCaps(tempCaps);
      setIsSettingsOpen(false);
    } catch (e: any) { console.error("Settings Save Failed: " + e.message); }
  };

  const handleAdd = async () => {
    if (!inputText.trim()) return;
    try {
      if (editingId) {
        await fetch(`http://localhost:8000/api/transactions/${editingId}`, {
          method: "PUT", headers: secureHeaders,
          body: JSON.stringify({ text: inputText }),
        });
        setEditingId(null);
      } else {
        await fetch("http://localhost:8000/api/add", {
          method: "POST", headers: secureHeaders,
          body: JSON.stringify({ text: inputText }),
        });
      }
      setInputText("");
      fetchData();
    } catch (e: any) { console.error("Save Failed: " + e.message); }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`http://localhost:8000/api/transactions/${id}`, { 
        method: "DELETE", headers: secureHeaders 
      });
      fetchData();
    } catch (e: any) { console.error("Delete Failed: " + e.message); }
  };

  const handleSettle = async (id: string) => {
    try {
      await fetch(`http://localhost:8000/api/transactions/${id}/settle`, { 
        method: "PUT", headers: secureHeaders 
      });
      fetchData();
    } catch (e: any) { console.error("Settle Failed: " + e.message); }
  };

  const handleEditClick = (t: any) => {
    const parts = [];
    if (t.is_split && t.split_amount < 0) parts.push("owe");
    const displayAmt = (t.amount >= 1000 && t.amount % 1000 === 0) ? `${t.amount / 1000}k` : t.amount.toString();
    parts.push(displayAmt);
    parts.push(t.description);
    if (t.is_split && t.owed_by) {
      if (t.split_amount < 0) parts.push(`@${t.owed_by}`);
      else {
        const displaySplit = (t.split_amount >= 1000 && t.split_amount % 1000 === 0) ? `${t.split_amount / 1000}k` : t.split_amount.toString();
        parts.push(`@${t.owed_by} ${displaySplit}`);
      }
    }
    setInputText(parts.join(" "));
    setEditingId(t.id);
  };

  const handleMenuAction = (action: () => void) => {
    action();
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  // 1. If Clerk is still booting up, show the loading screen
  if (!isLoaded) return <div className="h-screen bg-[#0a0a0a] flex items-center justify-center text-white font-bold tracking-widest text-sm">LOADING SECURE VAULT...</div>;
  
  // 2. If Clerk is ready but you aren't logged in, instantly teleport you to the Clerk Login page
  if (!isSignedIn) return <RedirectToSignIn />;

  const archive = transactions.reduce((acc, t) => {
    const d = new Date(t.created_at);
    const year = d.getFullYear().toString();
    const monthName = d.toLocaleString('en-US', { month: 'long' });
    const day = d.getDate().toString();
    const monthKey = `${monthName} ${year}`;
    const dayKey = `${monthName} ${day}, ${year}`;
    if (!acc[year]) acc[year] = {};
    if (!acc[year][monthKey]) acc[year][monthKey] = { name: monthName, count: 0, days: {} };
    acc[year][monthKey].count++;
    if (!acc[year][monthKey].days[dayKey]) acc[year][monthKey].days[dayKey] = { dayNumber: day, count: 0 };
    acc[year][monthKey].days[dayKey].count++;
    return acc;
  }, {} as Record<string, Record<string, { name: string, count: number, days: Record<string, { dayNumber: string, count: number }> }>>);

  const sortedYears = Object.keys(archive).sort((a, b) => Number(b) - Number(a));
  const toggleMonth = (monthKey: string) => setExpandedMonths(prev => ({ ...prev, [monthKey]: !prev[monthKey] }));

  const timeFilteredTransactions = transactions.filter(t => {
    if (selectedPeriod === "All Time") return true;
    const d = new Date(t.created_at);
    return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}` === selectedPeriod || 
           `${d.toLocaleString('en-US', { month: 'long' })} ${d.getDate()}, ${d.getFullYear()}` === selectedPeriod;
  });

  const finalTransactions = timeFilteredTransactions.filter(t => 
    t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.owed_by && t.owed_by.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  let actualTotal = 0; let nominalTotal = 0; let foodSpent = 0; let fuelSpent = 0; let maintSpent = 0;

  timeFilteredTransactions.forEach(t => {
    let actualCost = t.amount; let nominalCost = t.amount;
    if (t.is_split) {
      if (t.split_amount > 0) {
        actualCost = t.amount - t.split_amount; 
        nominalCost = t.is_settled ? (t.amount - t.split_amount) : t.amount; 
      } else if (t.split_amount < 0) {
        actualCost = Math.abs(t.split_amount); 
        nominalCost = t.is_settled ? Math.abs(t.split_amount) : 0; 
      }
    }
    actualTotal += actualCost; nominalTotal += nominalCost;
    if (t.category.includes("Food")) foodSpent += actualCost;
    if (t.category.includes("Fuel")) fuelSpent += actualCost;
    if (t.category.includes("Maintenance")) maintSpent += actualCost;
  });

  const owedToMeDict: { [key: string]: number } = {};
  const iOweDict: { [key: string]: number } = {};

  timeFilteredTransactions.forEach(t => {
    if (t.is_split && t.owed_by && !t.is_settled) {
      if (t.split_amount > 0) owedToMeDict[t.owed_by] = (owedToMeDict[t.owed_by] || 0) + t.split_amount;
      else if (t.split_amount < 0) iOweDict[t.owed_by] = (iOweDict[t.owed_by] || 0) + Math.abs(t.split_amount);
    }
  });

  const totalOwedToMe = Object.values(owedToMeDict).reduce((sum, a) => sum + a, 0);
  const totalIOwe = Object.values(iOweDict).reduce((sum, a) => sum + a, 0);
  const formatIDR = (num: number) => `Rp ${num.toLocaleString("id-ID")}`;
  const formatTime = (isoString: string) => new Date(isoString).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const getBarColor = (spent: number, cap: number) => (spent / cap >= 1) ? "bg-red-500" : (spent / cap >= 0.8) ? "bg-yellow-500" : "bg-emerald-500";

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white font-sans overflow-hidden">
      
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#111111] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold tracking-tight text-white flex justify-between mb-6">
              Budget Caps
              <button onClick={() => { setIsSettingsOpen(false); setTempCaps(budgetCaps); }} className="text-gray-500 hover:text-white transition-colors">✕</button>
            </h2>
            
            {(() => {
              const subTotal = tempCaps.food_limit + tempCaps.fuel_limit + tempCaps.maint_limit;
              const remaining = tempCaps.total_limit - subTotal;
              const isOverBudget = subTotal > tempCaps.total_limit;
              
              return (
                <>
                  <div className="space-y-4">
                    {[
                      { label: "Total Stipend Limit", key: "total_limit" },
                      { label: "🍔 Food & Social", key: "food_limit" },
                      { label: "🏍️ Fuel & Transport", key: "fuel_limit" },
                      { label: "⚙️ Subs & Maintenance", key: "maint_limit" }
                    ].map((item) => (
                      <div key={item.key} className="space-y-1">
                        <label className="text-xs text-gray-400 font-medium ml-1">{item.label}</label>
                        <input 
                          type="text" 
                          inputMode="numeric"
                          value={tempCaps[item.key as keyof typeof tempCaps] === 0 ? "" : tempCaps[item.key as keyof typeof tempCaps].toLocaleString("id-ID")} 
                          placeholder="0"
                          onChange={(e) => {
                            const rawValue = e.target.value.replace(/\D/g, "");
                            setTempCaps({...tempCaps, [item.key]: rawValue === "" ? 0 : Number(rawValue)});
                          }}
                          className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm"
                        />
                        {item.key === "total_limit" && (
                          <p className={`text-[10px] ml-2 font-medium ${remaining < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                            {remaining < 0 ? 'Over budget by ' : 'Unallocated: '} {formatIDR(Math.abs(remaining))}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  <div className="space-y-3 mt-6">
                    {isOverBudget && (
                      <p className="text-red-500 text-[11px] font-medium text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20">
                        ⚠️ Categories ({formatIDR(subTotal)}) exceed Total Stipend ({formatIDR(tempCaps.total_limit)}).
                      </p>
                    )}
                    <button 
                      onClick={handleSaveSettings} 
                      disabled={isOverBudget}
                      className={`w-full font-bold py-3 rounded-xl transition-all shadow-lg ${isOverBudget ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95'}`}
                    >
                      Save Changes
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {isSidebarOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-all duration-300" onClick={() => setIsSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 bg-[#111111] border-r border-white/5 flex flex-col h-full transition-all duration-300 ease-in-out shrink-0 overflow-hidden shadow-2xl ${isSidebarOpen ? "translate-x-0 w-64" : "-translate-x-full w-64 md:translate-x-0 md:w-0"}`}>
        <div className="w-64 min-w-[16rem] h-full flex flex-col">
          <div className="p-6 border-b border-white/5 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <UserButton appearance={{ elements: { userButtonAvatarBox: "w-8 h-8 rounded-lg" } }} />
              <h2 className="font-bold tracking-widest text-emerald-500 text-sm">FRICTIONLESS</h2>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-500 hover:text-white">✕</button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="space-y-2 border-b border-white/5 pb-4">
              <button onClick={() => handleMenuAction(() => setIsSettingsOpen(true))} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-white transition-all">
                <span>⚙️</span> Manage Budget Caps
              </button>
            </div>

            <button onClick={() => handleMenuAction(() => setSelectedPeriod("All Time"))} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${selectedPeriod === "All Time" ? "bg-emerald-500/10 text-emerald-400" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}>All Time</button>
            {sortedYears.map(year => (
              <div key={year} className="space-y-2">
                <h3 className="text-[10px] font-bold text-gray-600 tracking-widest uppercase pl-3">{year}</h3>
                <div className="space-y-1">
                  {Object.entries(archive[year]).map(([monthKey, monthData]: [string, any]) => (
                    <div key={monthKey} className="space-y-1">
                      <div className="flex gap-1 items-center">
                        <button onClick={() => toggleMonth(monthKey)} className="p-1 text-gray-500 hover:text-white transition-colors">{expandedMonths[monthKey] ? '▼' : '▶'}</button>
                        <button onClick={() => handleMenuAction(() => setSelectedPeriod(monthKey))} className={`flex-1 flex justify-between items-center px-2 py-2 rounded-lg text-sm transition-all ${selectedPeriod === monthKey ? "bg-emerald-500/10 text-emerald-400 font-bold" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}><span>{monthData.name}</span><span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full">{monthData.count}</span></button>
                      </div>
                      {expandedMonths[monthKey] && (
                        <div className="pl-6 space-y-1 mt-1">
                          {Object.entries(monthData.days).sort((a: [string, any], b: [string, any]) => Number(b[1].dayNumber) - Number(a[1].dayNumber)).map(([dayKey, dayData]: [string, any]) => (
                            <button key={dayKey} onClick={() => handleMenuAction(() => setSelectedPeriod(dayKey))} className={`w-full flex justify-between items-center px-3 py-1.5 rounded-lg text-xs transition-all ${selectedPeriod === dayKey ? "bg-white/10 text-white font-bold" : "text-gray-500 hover:bg-white/5 hover:text-gray-300"}`}><span>Day {dayData.dayNumber}</span><span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded-full">{dayData.count}</span></button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 pb-12 relative">
        <div className="max-w-xl mx-auto space-y-6 pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 -ml-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all focus:outline-none active:scale-95"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
              <h2 className="text-xl font-bold tracking-tight text-white">{selectedPeriod}</h2>
            </div>
          </div>
          
          <div className="bg-[#1a1a1a] rounded-2xl p-6 shadow-lg border border-white/5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 tracking-widest uppercase mb-1">Actual Spent in {selectedPeriod}</p>
              <h1 className="text-4xl font-bold tracking-tight">{formatIDR(actualTotal)}</h1>
              <p className="text-xs text-gray-500 mt-1 font-medium">Nominal Cash Flow: {formatIDR(nominalTotal)}</p>
            </div>
            <div className="pt-3 border-t border-white/5 flex gap-4">
              <div className="flex-1 bg-white/5 p-3 rounded-xl border border-emerald-500/10">
                <p className="text-[10px] font-semibold text-emerald-500 tracking-widest uppercase mb-1">Owed To Me</p>
                <h2 className="text-lg font-bold text-white mb-2">{formatIDR(totalOwedToMe)}</h2>
                <div className="text-xs text-gray-400 space-y-1">{Object.entries(owedToMeDict).map(([name, amt]) => (<div key={name} className="flex justify-between"><span>{name}</span> <span className="text-white">{formatIDR(amt)}</span></div>))}</div>
              </div>
              <div className="flex-1 bg-white/5 p-3 rounded-xl border border-red-500/10">
                <p className="text-[10px] font-semibold text-red-500 tracking-widest uppercase mb-1">I Owe</p>
                <h2 className="text-lg font-bold text-white mb-2">{formatIDR(totalIOwe)}</h2>
                <div className="text-xs text-gray-400 space-y-1">{Object.entries(iOweDict).map(([name, amt]) => (<div key={name} className="flex justify-between"><span>{name}</span> <span className="text-white">{formatIDR(amt)}</span></div>))}</div>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1a1a] rounded-2xl p-5 shadow-lg border border-white/5 space-y-4">
            <h3 className="text-sm font-bold tracking-wide text-gray-300">Allowance Burn Velocity</h3>
            <div className="space-y-1.5"><div className="flex justify-between text-xs font-medium"><span className="text-gray-300 font-bold">Total Stipend Limit</span><span className="text-gray-400">{formatIDR(actualTotal)} / {formatIDR(budgetCaps.total_limit)}</span></div><div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden"><div className={`h-full transition-all duration-500 ${getBarColor(actualTotal, budgetCaps.total_limit)}`} style={{ width: `${Math.min((actualTotal / budgetCaps.total_limit) * 100, 100)}%` }}></div></div></div>
            <div className="pt-2 border-t border-white/5 space-y-3">
              <div className="space-y-1"><div className="flex justify-between text-[11px]"><span className="text-gray-400">🍔 Food & Social</span><span className="text-gray-500">{formatIDR(foodSpent)} / {formatIDR(budgetCaps.food_limit)}</span></div><div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden"><div className={`h-full transition-all duration-300 ${getBarColor(foodSpent, budgetCaps.food_limit)}`} style={{ width: `${Math.min((foodSpent / budgetCaps.food_limit) * 100, 100)}%` }}></div></div></div>
              <div className="space-y-1"><div className="flex justify-between text-[11px]"><span className="text-gray-400">🏍️ Fuel & Transport</span><span className="text-gray-500">{formatIDR(fuelSpent)} / {formatIDR(budgetCaps.fuel_limit)}</span></div><div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden"><div className={`h-full transition-all duration-300 ${getBarColor(fuelSpent, budgetCaps.fuel_limit)}`} style={{ width: `${Math.min((fuelSpent / budgetCaps.fuel_limit) * 100, 100)}%` }}></div></div></div>
              <div className="space-y-1"><div className="flex justify-between text-[11px]"><span className="text-gray-400">⚙️ Subs & Maintenance</span><span className="text-gray-500">{formatIDR(maintSpent)} / {formatIDR(budgetCaps.maint_limit)}</span></div><div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden"><div className={`h-full transition-all duration-300 ${getBarColor(maintSpent, budgetCaps.maint_limit)}`} style={{ width: `${Math.min((maintSpent / budgetCaps.maint_limit) * 100, 100)}%` }}></div></div></div>
            </div>
          </div>

          <div className="flex gap-2">
            <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()} placeholder="e.g., owe 50k ayam geprek @salwa" className={`flex-1 bg-[#1a1a1a] border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all text-sm shadow-lg ${editingId ? 'border-emerald-500/50 focus:ring-emerald-500/50' : 'border-white/10 focus:ring-white/20'}`} />
            {editingId && (
              <button onClick={() => {setEditingId(null); setInputText("");}} className="bg-gray-800 text-gray-300 font-semibold px-4 py-3 rounded-xl hover:bg-gray-700 active:scale-95 transition-all text-sm shadow-lg">✕</button>
            )}
            <button onClick={handleAdd} className={`${editingId ? 'bg-emerald-500 text-white' : 'bg-white text-black'} font-semibold px-5 py-3 rounded-xl hover:opacity-80 active:scale-95 transition-all text-sm shadow-lg`}>
              {editingId ? 'Save' : 'Add'}
            </button>
          </div>

          <div className="relative shadow-lg rounded-xl">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="🔍 Quick search ledger..." className="w-full bg-[#161616] border border-white/5 rounded-xl px-4 py-3 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-white/20 transition-all" />
            {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-3 text-xs text-gray-500 hover:text-white">✕</button>}
          </div>

          <div className="space-y-4 pt-2 border-l border-white/10 ml-2 pl-4">
             {finalTransactions.length === 0 ? <p className="text-xs text-gray-600 italic pl-2 pt-2">No matching items found</p> : (
               finalTransactions.map((t) => (
                 <div key={t.id} className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 flex flex-col gap-2 relative group transition-all hover:bg-[#1f1f1f]">
                   <div className="absolute -left-[21.5px] top-5 w-2 h-2 rounded-full bg-gray-700 group-hover:bg-emerald-500 transition-all"></div>
                   <div className="flex justify-between items-start">
                     <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold">{formatIDR(t.amount)}</h3>
                        <span className="text-[10px] text-gray-500 font-medium tracking-wide">{formatTime(t.created_at)}</span>
                     </div>
                     <div className="flex gap-2">
                       {t.is_split ? (
                         <button onClick={() => handleSettle(t.id)} className={`transition-all text-sm hover:scale-110 ${t.is_settled ? 'text-emerald-500' : 'text-gray-600 hover:text-emerald-400'}`}>
                           {t.is_settled ? '✅' : '✔️'}
                         </button>
                       ) : null}
                       <button onClick={() => handleEditClick(t)} className="text-gray-600 hover:text-blue-400 hover:scale-110 transition-all text-sm">✏️</button>
                       <button onClick={() => handleDelete(t.id)} className="text-gray-600 hover:text-red-500 hover:scale-110 transition-all text-sm">🗑️</button>
                     </div>
                   </div>
                   <p className={`text-sm capitalize transition-all ${t.is_settled ? 'text-gray-600 line-through' : 'text-gray-400'}`}>{t.description}</p>
                   <div className="flex flex-wrap gap-2 mt-1">
                      <span className="bg-white/5 px-2 py-0.5 rounded text-[10px] text-gray-400 font-medium">{t.category}</span>
                      {(t.is_split === true && t.split_amount > 0) ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${t.is_settled ? 'bg-gray-800 text-gray-600 border-gray-700 line-through' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10'}`}>
                          {t.owed_by} owes {formatIDR(t.split_amount)}
                        </span>
                      ) : null}
                      {(t.is_split === true && t.split_amount < 0) ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${t.is_settled ? 'bg-gray-800 text-gray-600 border-gray-700 line-through' : 'bg-red-500/10 text-red-400 border-red-500/10'}`}>
                          I owe {t.owed_by} {formatIDR(Math.abs(t.split_amount))}
                        </span>
                      ) : null}
                   </div>
                 </div>
               ))
             )}
          </div>
        </div>
      </main>
    </div>
  );
}