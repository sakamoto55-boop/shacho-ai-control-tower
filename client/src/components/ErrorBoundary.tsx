// エラー境界: 子コンポーネントで例外が起きても画面全体を真っ白にしない。
// 利用者向けの日本語メッセージを表示し、開発用にconsoleへログを残す。

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  label?: string
}

interface State {
  hasError: boolean
  message: string
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 握りつぶさず開発ログに残す（利用者向け表示とは分離）
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            background: '#FEF2F2',
            border: '1.5px solid #FCA5A5',
            borderRadius: 12,
            padding: '14px 16px',
            margin: '10px 0',
            color: '#991B1B',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ 表示中に問題が発生しました</div>
          <div style={{ fontSize: 12 }}>
            {this.props.label ? `${this.props.label}の` : ''}読み込みに失敗しました。他の項目は引き続き表示されています。
            ページを再読み込みすると回復する場合があります。
          </div>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            style={{
              marginTop: 10,
              background: '#991B1B',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            再試行
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
