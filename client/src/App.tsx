import { useState } from 'react'
import type { Screen } from './types'
import { companies } from './data/mockData'
import Navigation from './components/Navigation'
import VoiceModal from './components/VoiceModal'
import Home from './components/screens/Home'
import AiChat from './components/screens/AiChat'
import TodayActions from './components/screens/TodayActions'
import CreateRequest from './components/screens/CreateRequest'
import Dashboard from './components/screens/Dashboard'
import Settings from './components/screens/Settings'
import CockpitScreen from './components/screens/CockpitScreen'

const SCREEN_TITLES: Record<Screen, string> = {
  home: 'AI社長室',
  chat: 'AI相談チャット',
  actions: '今日の要対応',
  create: '作成依頼',
  dashboard: '経営ダッシュボード',
  settings: '設定',
  cockpit: 'AIコックピット',
}

const SCREEN_SUBS: Record<Screen, string> = {
  home: 'LCC株式会社',
  chat: 'なんでも聞いてください',
  actions: '本日の確認事項',
  create: '文書・資料・指示文',
  dashboard: '財務・リスク状況',
  settings: 'アカウント・連携設定',
  cockpit: '会社の今を30秒で把握',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [company, setCompany] = useState('lcc')
  const [showVoice, setShowVoice] = useState(false)

  const companyData = companies.find((c) => c.id === company)
  const sub = screen === 'home' ? (companyData?.name ?? 'LCC株式会社') : SCREEN_SUBS[screen]

  function navigate(s: Screen) {
    setScreen(s)
  }

  return (
    <div className="app-shell">
      {/* ヘッダー */}
      <header className="app-header">
        <div>
          <div className="app-header-title">{SCREEN_TITLES[screen]}</div>
          <div className="app-header-sub">{sub}</div>
        </div>
        <button
          onClick={() => navigate('settings')}
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            color: '#fff',
          }}
        >
          ⚙️
        </button>
      </header>

      {/* スクリーン */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {screen === 'home' && (
          <Home onNavigate={navigate} company={companyData?.name ?? 'LCC株式会社'} onVoice={() => setShowVoice(true)} />
        )}
        {screen === 'chat' && <AiChat onVoice={() => setShowVoice(true)} onNavigate={navigate} />}
        {screen === 'actions' && <TodayActions />}
        {screen === 'create' && <CreateRequest onNavigateToChat={() => navigate('chat')} />}
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'settings' && (
          <Settings
            company={company}
            onCompanyChange={(id) => {
              setCompany(id)
              navigate('home')
            }}
          />
        )}
        {screen === 'cockpit' && <CockpitScreen />}
      </main>

      {/* フローティングマイクボタン（チャット画面以外） */}
      {screen !== 'chat' && (
        <button
          onClick={() => setShowVoice(true)}
          style={{
            position: 'absolute',
            bottom: 'calc(var(--nav-height) + var(--safe-bottom) + 16px)',
            right: 16,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'var(--orange)',
            color: '#fff',
            fontSize: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(249,115,22,0.4)',
            zIndex: 50,
          }}
        >
          🎤
        </button>
      )}

      {/* ボトムナビ */}
      <Navigation current={screen} onNavigate={navigate} />

      {/* 音声入力モーダル */}
      {showVoice && <VoiceModal onClose={() => setShowVoice(false)} />}
    </div>
  )
}
