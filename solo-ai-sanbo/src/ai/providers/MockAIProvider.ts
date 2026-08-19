import type { DraftRequest, DraftResult, PillarKind } from '../../domain/types.js';
import type { AIProvider } from './AIProvider.js';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

/** AIが決めてはいけない語。文中では空欄にし、leftToYouへ理由を出す。 */
const DO_NOT_DECIDE: Array<{ words: string[]; label: string; reason: string }> = [
  { words: ['いくら', '金額', '費用', '見積', '価格', '料金'], label: '金額', reason: '原価と現場条件を見ないと出せないため' },
  { words: ['いつ', '納期', '工期', '日程', '着工'], label: '納期・日程', reason: '自分の空き状況を確認しないと約束できないため' },
  { words: ['保証', '瑕疵', 'アフター'], label: '保証の範囲', reason: '一人で負える範囲を自分で決める必要があるため' },
  { words: ['契約', '条件', '支払'], label: '契約・支払条件', reason: '後から変えられないため' }
];

/**
 * 建設・解体の見積で漏れやすい項目。
 * 一人でやると本体工事だけ見て、処分と回送を入れ忘れて赤字になる。
 */
const DEMOLITION_ITEMS = [
  '仮設・養生（足場、シート、防音パネル）',
  '解体本体（構造・階数ごとに分ける）',
  '基礎・土間の撤去',
  '残置物の撤去と分別',
  '廃材処分費（品目ごとに分ける／一番ぶれる）',
  '運搬費（台数×往復）',
  '重機の回送費（行き帰りで2回）',
  '整地・仕上げ',
  '近隣あいさつ・養生などの近隣対策',
  '諸経費・現場管理費'
];

const CHECK_ITEMS = [
  'アスベストの事前調査（法令上の届出が要る場合がある）',
  '道路使用許可・道路占用の要否',
  '前面道路の幅と重機の進入可否',
  'ライフラインの停止手続き（電気・ガス・水道）',
  '近隣の建物との離れ（養生の張り方が変わる）'
];

function detectLeftToYou(text: string): DraftResult['leftToYou'] {
  return DO_NOT_DECIDE.filter((rule) => includesAny(text, rule.words)).map(
    (rule) => `${rule.label}：${rule.reason}。文中は【${rule.label}】のままにしています。`
  );
}

function buildReply(request: DraftRequest): DraftResult {
  const text = request.input;
  const asksPrice = includesAny(text, ['いくら', '金額', '費用', '見積', '相場', '価格']);
  const asksSchedule = includesAny(text, ['いつ', '納期', '日程', '着工', '空いて']);

  const body = [
    'ご連絡ありがとうございます。',
    '',
    `いただいた内容は「${text.slice(0, 40)}${text.length > 40 ? '…' : ''}」という理解で合っていますでしょうか。`,
    '',
    ...(asksPrice
      ? ['お見積りは現地を拝見してからお出ししています。おおよその条件だけ先にお伺いできれば、概算の考え方をお伝えできます。', '']
      : []),
    ...(asksSchedule ? ['日程は【納期・日程】でご相談させてください。', ''] : []),
    '下記をお教えいただけますでしょうか。',
    '・場所（住所または最寄り）',
    '・希望の時期',
    '・現場の規模（広さ・階数など）',
    '',
    'お伺いしたうえで、こちらから改めてご連絡いたします。'
  ].join('\n');

  return {
    kind: 'reply',
    text: body,
    checkBeforeSending: [
      '相手の要件を取り違えていないか（1行目の確認文）',
      '相手の名前・敬称が正しいか',
      '自分が実際に対応できる案件か'
    ],
    leftToYou: detectLeftToYou(text)
  };
}

function buildEstimate(request: DraftRequest): DraftResult {
  const text = `${request.input} ${request.context ?? ''}`;
  const isDemolition = includesAny(text, ['解体', '取り壊し', '更地', '空き家']);
  const items = isDemolition
    ? DEMOLITION_ITEMS
    : [
        '事前調査・打ち合わせ',
        '材料費（品目ごとに分ける）',
        '施工費（工程ごとに分ける）',
        '運搬・処分費',
        '諸経費・現場管理費'
      ];

  const body = [
    `【見積項目の案】${request.input}`,
    '',
    ...items.map((item, index) => `${index + 1}. ${item}　数量【　】　単価【　】　金額【　】`),
    '',
    '合計【金額】（税抜）',
    '',
    '※金額はすべて空欄にしています。現地と原価を見てから自分で入れてください。'
  ].join('\n');

  return {
    kind: 'estimate',
    text: body,
    checkBeforeSending: [
      ...(isDemolition ? CHECK_ITEMS : ['必要な許可・届出の有無', '材料の入手にかかる日数']),
      '自分の手間賃を入れ忘れていないか',
      '想定外が起きたときの追加費用の扱いを書いたか'
    ],
    leftToYou: [
      '金額：現地と原価を見ないと出せないため、すべて空欄にしています。',
      '納期・日程：自分の空き状況を確認してから入れてください。'
    ]
  };
}

const CONTENT_ANGLES: Record<PillarKind, string[]> = {
  service: ['実際にやった現場の手順', 'よく聞かれる費用の考え方', '失敗しかけた話と、その後どうしたか'],
  content: ['自分が試して分かったこと', '数字で見せられる変化', '読む人がその日に試せる手順'],
  contract: ['依頼を受けて解決した具体例', '導入前に確認すべきこと', '自分でできる範囲と頼んだほうが早い範囲'],
  other: ['自分の経験', '読む人の困りごと', 'その日に試せる手順']
};

function buildContent(request: DraftRequest): DraftResult {
  const angles = CONTENT_ANGLES[request.pillarKind ?? 'other'];
  const body = [
    `【${request.input}】`,
    '',
    `${request.input}について、実際にやってみて分かったことを書きます。`,
    '',
    ...angles.map((angle) => `・${angle}：【ここに自分の実例を1つ】`),
    '',
    '同じことで困っている方がいれば、コメントかDMで聞いてください。'
  ].join('\n');

  return {
    kind: 'content',
    text: body,
    checkBeforeSending: [
      '自分が本当に体験したことか（伝聞は書かない）',
      '取引先や依頼主が特定できる情報が入っていないか',
      '写真を使う場合、施主の許可を取ったか'
    ],
    leftToYou: [
      '実例：あなたしか持っていない部分なので空欄にしています。ここが埋まらない投稿は出さないでください。'
    ]
  };
}

/**
 * APIキーなしで動く参謀。ルールだけで下書きを作る。
 * 文章の質は実プロバイダに劣るが、「決めない」という原則は同じように守る。
 */
export class MockAIProvider implements AIProvider {
  async draft(request: DraftRequest): Promise<DraftResult> {
    if (request.kind === 'estimate') return buildEstimate(request);
    if (request.kind === 'content') return buildContent(request);
    return buildReply(request);
  }
}
