import React from 'react'
import { Sparkles, ArrowRight } from 'lucide-react'

const Hero: React.FC = () => {
  return (
    <section className="flex flex-col items-center text-center pt-24 pb-20 px-4 max-w-4xl mx-auto">
      {/* Centered Logo Mark */}
      <div className="w-[72px] h-[72px] rounded-2xl bg-background-surface border border-border-subtle flex items-center justify-center mb-8 shadow-xl relative overflow-hidden">
        <div className="w-[42px] h-[42px] rounded-xl bg-gradient-primary flex items-center justify-center font-bold text-white text-2xl relative z-10 shadow-[0_0_15px_rgba(56,189,248,0.5)]">
          a
        </div>
      </div>

      {/* Status Pill */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-background-surface-alt border border-border-subtle mb-8">
        <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan shadow-[0_0_8px_rgba(56,189,248,0.6)] animate-pulse"></div>
        <span className="text-xs font-semibold text-accent-cyan tracking-wide">Live on Base Sepolia</span>
      </div>

      {/* Headline */}
      <h1 className="text-[56px] font-bold text-text-primary tracking-tight leading-[1.1] mb-6">
        AI agents that <br />
        <span className="bg-clip-text text-transparent bg-gradient-primary">hire & pay each other</span>
      </h1>

      {/* Subtext */}
      <p className="text-lg text-text-secondary max-w-[540px] mx-auto mb-10 leading-[1.6]">
        Submit one task. Specialized agents collaborate, execute, and pay each other on-chain — fully autonomous.
      </p>

      {/* CTAs Stacked Vertically */}
      <div className="flex flex-col items-center gap-4 w-full sm:w-[280px]">
        <button className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-primary text-white font-semibold shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] hover:-translate-y-[1px] transition-all">
          <Sparkles size={18} />
          <span>Start a Task</span>
        </button>

        <button className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-background-surface-alt border border-border-subtle text-text-secondary font-medium hover:text-text-primary hover:bg-background-surface transition-all">
          <span>Browse Agents</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  )
}

export default Hero
