import { Routes, Route, Link, NavLink, useLocation } from 'react-router-dom'
import { useAccount, useBalance } from 'wagmi'

import WalletConnect from './components/WalletConnect'
import CreateCommitment from './components/CreateCommitment'
import EvidenceSubmit from './components/EvidenceSubmit'
import PublicFeed from './components/PublicFeed'
import CommitmentDetail from './components/CommitmentDetail'

function Header() {
  const location = useLocation()
  const isDetail = location.pathname.startsWith('/commitment/')

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/" className="brand-mark" aria-label="Vouch home">
          <span className="brand-glyph" aria-hidden="true">V</span>
          <span>Vouch</span>
          <span className="brand-tag">Monad</span>
        </Link>

        {!isDetail && (
          <nav className="nav nav-desktop" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>Feed</NavLink>
            <NavLink to="/create" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>Create</NavLink>
            <NavLink to="/evidence" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>Evidence</NavLink>
          </nav>
        )}

        <WalletConnect />
      </div>
    </header>
  )
}

function MobileNav() {
  return (
    <nav className="nav-mobile" aria-label="Mobile">
      <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>Feed</NavLink>
      <NavLink to="/create" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>Create</NavLink>
      <NavLink to="/evidence" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>Evidence</NavLink>
    </nav>
  )
}

function useWalletState() {
  const { address, isConnected } = useAccount()
  const { data: balance } = useBalance({ address, watch: true })
  return { address, isConnected, balance }
}

export default function App() {
  const { address, isConnected, balance } = useWalletState()

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<PublicFeed address={address} isConnected={isConnected} />} />
          <Route
            path="/create"
            element={<CreateCommitment address={address} isConnected={isConnected} balanceMon={balance?.formatted ?? '0'} />}
          />
          <Route path="/evidence" element={<EvidenceSubmit address={address} isConnected={isConnected} />} />
          <Route path="/commitment/:id" element={<CommitmentDetail address={address} isConnected={isConnected} />} />
          <Route path="*" element={<PublicFeed address={address} isConnected={isConnected} />} />
        </Routes>
      </main>
      <MobileNav />
    </div>
  )
}
