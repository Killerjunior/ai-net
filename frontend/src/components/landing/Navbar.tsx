import React from 'react'
import { Search, ExternalLink, Copy, Wallet } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'

const Navbar: React.FC = () => {
  const { publicKey, connected, disconnect } = useWallet()

  const truncateKey = (key: string) => {
    if (key.length <= 8) return key
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }

  const copyToClipboard = () => {
    if (publicKey) navigator.clipboard.writeText(publicKey)
  }

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-8 h-[73px] bg-background-primary border-b border-border-subtle">

      {/* Global Search */}
      <div className="flex items-center bg-background-surface rounded-lg px-3 h-[30px] w-[280px] focus-within:ring-1 focus-within:ring-accent-cyan/30 transition-colors">
        <Search size={10} className="text-text-secondary mr-2 flex-shrink-0" />
        <input
          type="text"
        // placeholder="Search agents, tasks..."
        //className="bg-transparent border-none outline-none text-[11px] text-text-primary w-full placeholder:text-text-secondary"
        />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        {/* Network Pill */}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-background-surface border border-background-surface-alt">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-green shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
          <span className="text-[13px] font-medium text-text-secondary">Base Sepolia</span>
        </div>

        {connected && publicKey ? (
          <div className="flex items-center gap-2 bg-background-surface border border-background-surface-alt rounded-full px-4 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-green shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
            <span className="text-[13px] font-medium text-text-primary font-mono tracking-wide">
              {truncateKey(publicKey)}
            </span>
            <button onClick={copyToClipboard} aria-label="Copy public key" className="text-text-secondary hover:text-text-primary transition-colors ml-1">
              <Copy size={14} aria-hidden="true" />
            </button>
            <button onClick={disconnect} aria-label="Disconnect wallet" className="text-text-secondary hover:text-text-primary transition-colors ml-1">
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            className="group flex items-center gap-2 bg-background-surface border border-border-subtle rounded-full px-4 py-1.5 cursor-pointer hover:border-accent-cyan/50 transition-all"
          >
            <Wallet size={14} className="text-accent-cyan" />
            <span className="text-[13px] font-medium text-text-secondary group-hover:text-text-primary transition-colors">Connect Wallet</span>
          </button>
        )}
      </div>
    </header>
  )
}

export default Navbar
