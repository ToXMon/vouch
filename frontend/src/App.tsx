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
  const navItem = 'px-3 py-1.5 text-sm rounded-md transition-colors font-medium'
  const active = 'bg-emerald-400/10 text-emerald-300'
  const idle = 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2 text-zinc-100">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-emerald-400/15 font-bold text-emerald-300">V</span>
          <span className="text-lg font-semibold tracking-tight">Vouch</span>
          <span className="ml-1 hidden rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 sm:inline">Monad</span>
        </Link>

        {!isDetail && (
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>Feed</NavLink>
            <NavLink to="/create" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>Create</NavLink>
            <NavLink to="/evidence" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>Evidence</NavLink>
          </nav>
        )}

        <WalletConnect />
      </div>
    </header>
  )
}

function MobileNav() {
  const navItem = 'flex-1 px-3 py-2 text-center text-xs font-medium transition-colors'
  const active = 'text-emerald-300'
  const idle = 'text-zinc-500'
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-white/5 bg-zinc-950/95 backdrop-blur-md sm:hidden" aria-label="Mobile">
      <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>Feed</NavLink>
      <NavLink to="/create" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>Create</NavLink>
      <NavLink to="/evidence" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>Evidence</NavLink>
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pb-10">
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
