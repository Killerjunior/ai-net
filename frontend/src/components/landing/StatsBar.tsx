import React from 'react'

const StatsBar: React.FC = () => {
  const stats = [
    { label: 'AI Agents', value: '7+', valueColor: 'text-[#60A5FA]' }, // Blue
    { label: 'Per Task', value: '15 XLM', valueColor: 'text-[#22D3EE]' }, // Cyan
    { label: 'Network', value: 'Stellar', valueColor: 'text-[#60A5FA]' }, // Blue
    { label: 'Payment Rail', value: 'Soroban', valueColor: 'text-[#818CF8]' }, // Purple
  ]

  return (
    <section className="px-4 max-w-[800px] mx-auto mb-20 w-full relative z-10">
      <div className="bg-background-surface border border-border-subtle rounded-2xl p-8 flex flex-wrap md:flex-nowrap justify-between items-center shadow-lg">
        {stats.map((stat, idx) => (
          <div key={idx} className="flex flex-col items-center flex-1 min-w-[120px]">
            <span className={`text-[26px] font-bold mb-1.5 tracking-tight ${stat.valueColor}`}>
              {stat.value}
            </span>
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-[0.05em] text-center">
              {stat.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default StatsBar
