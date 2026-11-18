import { useEffect, useState } from 'react'
import { DemoUiProvider } from './components/demo'
import { Layout, PAGES, type PageId } from './components/Layout'
import { ActivityPage } from './pages/ActivityPage'
import { AddMoneyPage } from './pages/AddMoneyPage'
import { BorrowPage } from './pages/BorrowPage'
import { CashOutPage } from './pages/CashOutPage'
import { DemoPage } from './pages/DemoPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { EarnPage } from './pages/EarnPage'
import { GetCashPage } from './pages/GetCashPage'
import { HomePage } from './pages/HomePage'
import { LiquidationsPage } from './pages/LiquidationsPage'

const fromHash = (): PageId => {
  const h = window.location.hash.slice(1) as PageId
  return PAGES.includes(h) ? h : 'decouvrir'
}

const VIEWS: Record<PageId, () => React.JSX.Element> = {
  decouvrir: DiscoverPage,
  accueil: HomePage,
  // Ancien onglet Presentation fusionné dans Discover (Greg, 18/11/2026) : les anciens liens #presentation restent valides
  presentation: DiscoverPage,
  activite: ActivityPage,
  preter: EarnPage,
  emprunter: BorrowPage,
  demo: DemoPage,
  liquidations: LiquidationsPage,
  cash: GetCashPage,
  retrait: CashOutPage,
  ajouter: AddMoneyPage,
}

export default function App() {
  const [page, setPage] = useState<PageId>(fromHash)

  useEffect(() => {
    const onHash = () => {
      setPage(fromHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const View = VIEWS[page]
  return (
    <DemoUiProvider>
      <Layout page={page}>
        <View />
      </Layout>
    </DemoUiProvider>
  )
}
