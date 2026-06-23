import React from 'react'
import { LayoutDashboard, ClipboardList, Bot, Hammer, UserPlus, CreditCard, Settings } from 'lucide-react'

const Sidebar: React.FC = () => {
  const navItems = [
    { label: 'Dashboard', icon: <LayoutDashboard size={16} />, active: true },
    { label: 'Tasks', icon: <ClipboardList size={16} />, active: false },
    { label: 'Agents', icon: <Bot size={16} />, active: false },
    { label: 'Builder', icon: <Hammer size={16} />, active: false },
    { label: 'Register', icon: <UserPlus size={16} />, active: false },
    { label: 'Payments', icon: <CreditCard size={16} />, active: false },
    { label: 'Settings', icon: <Settings size={16} />, active: false },
  ]

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[200px] bg-background-primary border-r border-border-subtle hidden lg:flex flex-col z-50">
      {/* Logo Area */}
      <div className="flex items-center gap-3 h-[73px] px-6 border-b border-border-subtle">
        <div className="w-[30px] h-[30px] rounded-[8px] bg-gradient-primary flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(56,189,248,0.4)]">
          a
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-[15px] leading-tight text-text-primary tracking-wide">
            ai-net
          </span>
          <span className="text-[10px] text-text-secondary tracking-[0.05em] mt-0.5">
            Agent Network
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6 px-3 flex flex-col gap-1.5">
        {navItems.map((item, idx) => (
          <button
            key={idx}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-all group w-full text-left bg-transparent hover:bg-background-surface-alt/50`}
          >
            <span className={`${item.active ? 'text-accent-cyan' : 'text-text-secondary group-hover:text-text-primary'} transition-colors`}>
              {item.icon}
            </span>
            <span className={`${item.active ? 'text-text-primary font-semibold' : 'text-text-secondary font-medium'} tracking-wide transition-colors group-hover:text-text-primary`}>
              {item.label}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
