import type { AnalyzeMessageInput } from '../../src/domain/types.js';

export const fixtureMessages: Record<string, AnalyzeMessageInput> = {
  estimateToday: {
    source: 'manual_import',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: 'A社 田中様',
    senderAddress: '',
    roomName: '',
    subject: '解体工事の見積依頼',
    text: 'A社から解体工事の見積を今日中に出してほしいと依頼。金額は概算でよいとのこと。'
  },
  siteStop: {
    source: 'lineworks',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '工務部',
    senderAddress: '',
    roomName: '現場配置・緊急対応ルーム',
    subject: '',
    text: 'B現場で追加外注が必要。今日決めないと明日の作業が止まります。'
  },
  complaint: {
    source: 'gmail',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: 'C様',
    senderAddress: 'customer@example.com',
    roomName: '',
    subject: '昨日の対応について',
    text: 'C様から昨日の対応についてかなり怒っている様子。至急折り返し希望。'
  },
  paymentDelay: {
    source: 'manual_import',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '業務サポート部',
    senderAddress: '',
    roomName: '',
    subject: '',
    text: 'D社の入金が予定日を過ぎても確認できない。確認お願いします。'
  },
  doneReport: {
    source: 'lineworks',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '現場担当',
    senderAddress: '',
    roomName: '工務部ルーム',
    subject: '',
    text: '本日の作業完了しました。写真も共有済みです。'
  },

  // --- chatHistory対応：社長が最後に発言 → 返信不要 ---
  // 社長が「見積りではなく予算確認を」と指示した後、成相から「確認します」と返信が来た。
  // 最後の発言者は成相（other）だが、社長の指示に対する単純な了解返信なので返信不要と判定する。
  // 注：「確認し報告致します」は確認・報告ワードを含むが、社長が最後に発言した後の履行なので返信不要。
  presidentLastSender: {
    source: 'lineworks',
    receivedAt: '2026-06-12T08:45:00.000Z',
    senderName: '社長',
    senderAddress: '',
    roomName: '見積もり申請',
    subject: '',
    text: '見積り出すのではなく、予算いくらか聴いてください。',
    chatHistory: [
      {
        senderType: 'other',
        senderName: '成相健一',
        text: '見積りを出しました。確認お願いします。',
        timestamp: '2026-06-12T08:30:00.000Z'
      },
      {
        senderType: 'president',
        senderName: '社長',
        text: '見積り出すのではなく、予算いくらか聴いてください。',
        timestamp: '2026-06-12T08:45:00.000Z'
      }
    ]
  },

  // --- chatHistory対応：相手が最後に発言 → 返信必要 ---
  otherLastSender: {
    source: 'lineworks',
    receivedAt: '2026-06-12T10:00:00.000Z',
    senderName: '川野真紀',
    senderAddress: '',
    roomName: 'スケジュール管理',
    subject: '',
    text: '6.15 月曜日 13:30～ 定期総会があります。参加されますか？',
    chatHistory: [
      {
        senderType: 'other',
        senderName: '川野真紀',
        text: '6.15 月曜日 13:30～ 定期総会があります。参加されますか？',
        timestamp: '2026-06-12T10:00:00.000Z'
      }
    ]
  },

  // --- 建設業：外構工事の見積依頼 ---
  constructionEstimate: {
    source: 'gmail',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '山田様',
    senderAddress: 'yamada@example.com',
    roomName: '',
    subject: '外構工事の見積をお願いしたい',
    text: '新築の外構工事（フェンス・駐車場・植栓）の見積をお願いしたいです。予算は150万円程度を考えています。現地確認はいつ頃可能でしょうか。'
  },

  // --- 解体業：近隣クレーム ---
  demolitionComplaint: {
    source: 'lineworks',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '工務部 鈴木',
    senderAddress: '',
    roomName: '現場対応ルーム',
    subject: '',
    text: '解体現場の近隣から騒音と振動についてクレームが入っています。お客様が直接会社に電話してくるかもしれません。至急対応方针を教えてください。'
  },

  // --- 不動産：入居申込 ---
  realEstateInquiry: {
    source: 'gmail',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '佐藤様',
    senderAddress: 'sato@example.com',
    roomName: '',
    subject: '○○マンション入居申込について',
    text: '先日内見した○○マンション201号室への入居を希望します。入居希望日は7月1日です。申込書類を送付いただけますか。'
  },

  // --- 福祉：利用者対応 ---
  welfareStaffReport: {
    source: 'lineworks',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '施設担当 田中',
    senderAddress: '',
    roomName: '福祉施設ルーム',
    subject: '',
    text: '利用者のAさんが昨日から体調不良で、ご家族への連絡が必要です。施設長の判断をいただけますか。'
  },

  // --- 協力会社：人員手配依頼 ---
  partnerManpowerRequest: {
    source: 'lineworks',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '協力会社 中村',
    senderAddress: '',
    roomName: '外注・協力会社ルーム',
    subject: '',
    text: '来週月曜日から。3日間、職人2名の応援をお願いできますか。現場は出雲市内です。費用は日圴2万円でいかがでしょうか。'
  },

  // --- 完了報告：タスク不要 ---
  completionReport: {
    source: 'lineworks',
    receivedAt: '2026-06-12T00:00:00.000Z',
    senderName: '現場担当 伊藤',
    senderAddress: '',
    roomName: '工務部ルーム',
    subject: '',
    text: '本日の解体作業、予定通り完了しました。産廃の搬出も完了。写真は共有フォルダに上げています。'
  }
};
