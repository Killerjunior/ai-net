import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ExternalLink, Copy, Wallet, Menu, X, Command,
  LayoutDashboard, ClipboardList, Bot, Hammer, UserPlus, CreditCard, Settings,
} from 'lucide-react'
import { useWallet } from '../../context/WalletContext'

const navItems = [
  { label: 'Dashboard', icon: <LayoutDashboard size={16} />, route: '/dashboard' },
  { label: 'Tasks', icon: <ClipboardList size={16} />, route: '/tasks/new' },
  { label: 'Agents', icon: <Bot size={16} />, route: '/agents' },
  { label: 'Builder', icon: <Hammer size={16} />, route: '#' },
  { label: 'Register', icon: <UserPlus size={16} />, route: '#' },
  { label: 'Payments', icon: <CreditCard size={16} />, route: '/wallet' },
  { label: 'Settings', icon: <Settings size={16} />, route: '#' },
]

const Navbar: React.FC = () => {
  const { publicKey, connected, disconnect } = useWallet()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const mobileSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mobileSearchOpen && mobileSearchRef.current) {
      mobileSearchRef.current.focus()
    }
  }, [mobileSearchOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setMobileSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setMobileSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const truncateKey = (key: string) => {
    if (key.length <= 8) return key
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }

  const copyToClipboard = () => {
    if (publicKey) navigator.clipboard.writeText(publicKey)
  }

  const handleNavClick = (route: string) => {
    if (route === '#') return
    setMobileMenuOpen(false)
    navigate(route)
  }

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-8 h-[64px] bg-background-primary/70 backdrop-blur-2xl border-b border-border-subtle shadow-[0_1px_0_rgba(255,255,255,0.03)]">
        {/* Left: Hamburger + Logo */}
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-background-surface transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <motion.div
              animate={{ rotate: mobileMenuOpen ? 90 : 0 }}
              transition={{ duration: 0.2 }}
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </motion.div>
          </motion.button>

          <motion.div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => navigate('/')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="w-[28px] h-[28px] rounded-[7px] bg-gradient-primary flex items-center justify-center font-bold text-white text-sm shadow-[0_0_14px_rgba(56,189,248,0.35)]">
              a
            </div>
            <span className="font-bold text-[15px] text-text-primary tracking-wide hidden sm:inline">
              ai-net
            </span>
          </motion.div>
        </div>

        {/* Center: Global Search (Desktop) */}
        <div className="flex-1 max-w-[360px] mx-auto sm:mx-0 sm:flex-none sm:w-[280px] hidden sm:block">
          <div className={`flex items-center h-[34px] rounded-lg border transition-all ${searchFocused ? 'border-accent-cyan/40 bg-background-surface/80 shadow-[0_0_12px_rgba(56,189,248,0.07)]' : 'border-border-subtle/60 bg-background-surface/50'}`}>
            <div className="flex items-center justify-center pl-3">
              <Search size={15} className={`transition-colors duration-200 ${searchFocused ? 'text-accent-cyan' : 'text-text-secondary/40'}`} />
            </div>
            <input
              type="text"
              placeholder="Search agents, tasks..."
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="flex-1 bg-transparent pl-2.5 pr-2 text-[13px] text-text-primary placeholder:text-text-secondary/30 outline-none min-w-0"
            />
            <div className="flex items-center pr-2.5">
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-background-surface-alt/60 border border-border-subtle/40">
                <Command size={10} className="text-text-secondary/40" />
                <span className="text-[10px] font-medium text-text-secondary/40">K</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Network + Wallet */}
        <div className="flex items-center gap-1.5">
          <motion.div
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-background-surface/50 border border-border-subtle/60"
            whileHover={{ borderColor: 'rgba(52,211,153,0.3)' }}
            transition={{ duration: 0.2 }}
          >
            <span className="relative flex w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-40" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-accent-green shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            </span>
            <span className="text-[12px] font-medium text-text-secondary tracking-wide">
              Stellar Testnet
            </span>
          </motion.div>

          {/* Mobile Search Toggle */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            className="sm:hidden flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary/60 hover:text-text-primary hover:bg-background-surface transition-colors"
            onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            aria-label="Search"
          >
            <Search size={16} />
          </motion.button>

          {connected && publicKey ? (
            <div className="flex items-center gap-1 bg-background-surface/50 border border-border-subtle/60 rounded-full pl-2.5 pr-1.5 py-1">
              <span className="relative flex w-1.5 h-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-40" />
                <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-accent-green shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              </span>
              <span className="text-[12px] font-medium text-text-primary font-mono tracking-wide mx-1.5">
                {truncateKey(publicKey)}
              </span>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={copyToClipboard}
                aria-label="Copy public key"
                className="flex items-center justify-center w-6 h-6 rounded-md text-text-secondary/50 hover:text-text-primary hover:bg-background-surface transition-colors"
              >
                <Copy size={11} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={disconnect}
                aria-label="Disconnect wallet"
                className="flex items-center justify-center w-6 h-6 rounded-md text-text-secondary/50 hover:text-red-400 hover:bg-background-surface transition-colors"
              >
                <ExternalLink size={11} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="group flex items-center gap-2 bg-background-surface/50 border border-border-subtle/60 rounded-full px-3 py-1.5 cursor-pointer hover:border-accent-cyan/40 hover:bg-background-surface/80 hover:shadow-[0_0_20px_rgba(56,189,248,0.06)] transition-all"
            >
              <Wallet size={13} className="text-accent-cyan group-hover:scale-110 transition-transform" />
              <span className="text-[12px] font-medium text-text-secondary group-hover:text-text-primary transition-colors hidden sm:inline">
                Connect Wallet
              </span>
            </motion.button>
          )}
        </div>
      </header>

      {/* Mobile Search Bar */}
      <AnimatePresence>
        {mobileSearchOpen && (
          <motion.div
            className="sm:hidden relative z-30 px-4 pb-3 pt-2 bg-background-primary/95 backdrop-blur-2xl border-b border-border-subtle"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center h-10 rounded-lg bg-background-surface border border-border-subtle/60">
              <div className="flex items-center justify-center pl-3">
                <Search size={15} className="text-text-secondary/40" />
              </div>
              <input
                ref={mobileSearchRef}
                type="text"
                placeholder="Search agents, tasks..."
                onKeyDown={(e) => e.key === 'Escape' && setMobileSearchOpen(false)}
                className="flex-1 bg-transparent pl-2.5 pr-3 text-[14px] text-text-primary placeholder:text-text-secondary/30 outline-none min-w-0"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            className="fixed inset-0 z-30 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.nav
              className="relative w-[260px] h-full bg-background-primary border-r border-border-subtle/80 pt-5 px-3 flex flex-col gap-0.5 shadow-2xl"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            >
              <div className="flex items-center gap-3 px-3 pb-5 mb-3 border-b border-border-subtle/60">
                <div className="w-[30px] h-[30px] rounded-[8px] bg-gradient-primary flex items-center justify-center font-bold text-white text-sm shadow-[0_0_14px_rgba(56,189,248,0.35)]">
                  a
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-[15px] leading-tight text-text-primary tracking-wide">
                    ai-net
                  </span>
                  <span className="text-[10px] text-text-secondary/60 tracking-[0.05em]">
                    Agent Network
                  </span>
                </div>
              </div>
              {navItems.map((item, idx) => (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * idx, duration: 0.2 }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-all w-full text-left font-medium ${
                    item.route === '#'
                      ? 'text-text-secondary/30 cursor-not-allowed'
                      : 'text-text-secondary hover:text-text-primary hover:bg-background-surface/80 active:bg-background-surface'
                  }`}
                  onClick={() => handleNavClick(item.route)}
                >
                  <span className={`${item.route === '#' ? 'opacity-40' : 'opacity-70 group-hover:opacity-100'}`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </motion.button>
              ))}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default Navbar
