import { useEffect, useState } from 'react'
import { DemoUiProvider } from './components/demo'
import { Layout, PAGES, type PageId } from './components/Layout'
import { ActivityPage } from './pages/ActivityPage'
import { BorrowPage } from './pages/BorrowPage'
import { CashOutPage } from './pages/CashOutPage'
import { DemoPage } from './pages/DemoPage'
import { EarnPage } from './pages/EarnPage'
import { EvaluatePage } from './pages/EvaluatePage'
import { HelpPage } from './pages/HelpPage'
import { HomePage } from './pages/HomePage'
import { LiquidationPage } from './pages/LiquidationPage'
import { PresentationPage } from './pages/PresentationPage'

const fromHash = (): PageId => {
  const h = window.location.hash.slice(1) as PageId
  return PAGES.includes(h) ? h : 'accueil'
}

const VIEWS: Record<PageId, () => React.JSX.Element> = {
  accueil: HomePage,
  presentation: PresentationPage,
  activite: ActivityPage,
  preter: EarnPage,
  emprunter: BorrowPage,
  demo: DemoPage,
  evaluation: EvaluatePage,
  liquidation: LiquidationPage,
  aide: HelpPage,
  retrait: CashOutPage,
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
