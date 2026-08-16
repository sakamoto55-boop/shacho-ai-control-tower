import type { SnsInquiryInput } from '../../src/domain/types.js';

export const fixtureSnsInquiries: Record<string, SnsInquiryInput> = {
  /** 見積依頼・時期・連絡先が揃った当日返信すべき反響 */
  hotDemolition: {
    channel: 'instagram',
    externalInquiryId: 'ig-0001',
    receivedAt: '2026-08-17T01:00:00.000Z',
    accountName: '@tanaka_home',
    displayName: '田中',
    text: '空き家の解体をお願いしたいです。木造2階建て、約40坪です。今月中に見積が欲しいので、現地を見に来ていただけますか。電話は090-0000-0000です。',
    postRef: 'https://example.com/post/1',
    area: '前橋市'
  },

  /** 検討時期は言っているが、規模も連絡先も分からない反響 */
  warmExterior: {
    channel: 'google_business',
    externalInquiryId: 'gbp-0002',
    receivedAt: '2026-08-17T02:00:00.000Z',
    accountName: 'sato@example.com',
    displayName: '佐藤',
    text: '駐車場の外構工事の費用はいくらぐらいになりますか。相場を教えてください。来月には着工したいと考えています。'
  },

  /** 感想コメント。長期フォロー対象。 */
  coldComment: {
    channel: 'x',
    externalInquiryId: 'x-0003',
    receivedAt: '2026-08-17T03:00:00.000Z',
    accountName: '@watcher',
    displayName: '',
    text: '施工きれいですね！'
  },

  /** 業者からの売り込みDM */
  spam: {
    channel: 'instagram',
    externalInquiryId: 'ig-0004',
    receivedAt: '2026-08-17T04:00:00.000Z',
    accountName: '@growth_agency',
    displayName: '集客サポート',
    text: 'DM失礼します。相互フォローと集客支援のご案内です。月収アップのノウハウをLINEに登録でお渡しします。'
  }
};
