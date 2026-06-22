import React from 'react'

export interface AgentData {
  id: string
  name: string
  type: string
  description: string
  icon: React.ReactNode
  tasksCompleted: number
  successRate: number
}

interface AgentCardProps {
  agent: AgentData
}

const AgentCard: React.FC<AgentCardProps> = ({ agent }) => {
  return (
    <div className="bg-background-surface border border-border-subtle rounded-2xl p-5 flex flex-col hover:border-accent-cyan/50 hover:shadow-[0_8px_30px_rgba(56,189,248,0.1)] transition-all cursor-pointer group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-background-surface-alt border border-border-subtle flex items-center justify-center group-hover:text-accent-cyan transition-colors">
            {agent.icon}
          </div>
          <div className="flex flex-col">
            <h3 className="text-base font-bold text-text-primary">{agent.name}</h3>
            <span className="text-[10px] font-bold text-accent-purple uppercase tracking-wider mt-0.5">
              {agent.type}
            </span>
          </div>
        </div>
        <div className="w-2 h-2 rounded-full bg-accent-green shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
      </div>
      
      <p className="text-sm text-text-secondary mb-6 flex-grow line-clamp-3">
        {agent.description}
      </p>

      <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wider font-bold">Tasks</span>
          <span className="text-sm font-bold text-text-primary">{agent.tasksCompleted.toLocaleString()}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wider font-bold">Success</span>
          <span className="text-sm font-bold text-accent-green">{agent.successRate}%</span>
        </div>
      </div>
    </div>
  )
}

export default AgentCard
