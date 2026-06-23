import React from 'react'
import Navbar from '../components/landing/Navbar'
import Sidebar from '../components/landing/Sidebar'
import Hero from '../components/landing/Hero'
import StatsBar from '../components/landing/StatsBar'
import SpecialistAgentsSection from '../components/landing/SpecialistAgentsSection'

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-background-primary text-text-primary font-sans flex relative overflow-x-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-[200px] relative z-10">
        <Navbar />

        {/* Main Content Area */}
        <main className="flex-1 w-full relative z-10">
          <Hero />
          <StatsBar />
          <SpecialistAgentsSection />
        </main>
      </div>
    </div>
  )
}

export default LandingPage
