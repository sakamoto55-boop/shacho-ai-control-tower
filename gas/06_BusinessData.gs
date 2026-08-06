/**
 * 06_BusinessData.gs
 * ------------------------------------------------------------------
 * 既存の経営データ（売上・原価・課題）スプレッドシートの参照。
 *
 * 【設計原則3の実装】
 * 数値はAIに計算させない。ここで読むのは getDisplayValues()、
 * つまりシート側で計算・書式設定まで終わった「確定した表示値」だけ。
 * 集計も加工もこちらでは行わず、そのまま表としてAIに渡す。
 * AIには「この表の数字を書き写すことはしてよいが、
 * 足し算・引き算・推定はしてはならない」と指示する（08_AiReport.gs）。
 *
 * 参照するだけで、書き込みは一切しない。
 * ------------------------------------------------------------------
 */

/**
 * 経営データを読み込む。
 * @return {Array<{title: string, rows: Array<Array<string>>}>}
 */
function loadBusinessData_() {
  var ssId = getProp_('BIZ_SPREADSHEET_ID', false);
  if (!ssId) return [];

  var specs = [
    { title: '売上', range: cfg_('BIZ_SALES_RANGE', '') },
    { title: '原価', range: cfg_('BIZ_COST_RANGE', '') },
    { title: '課題', range: cfg_('BIZ_ISSUE_RANGE', '') }
  ].filter(function (s) { return s.range; });

  if (!specs.length) return [];

  var ss;
  try {
    ss = SpreadsheetApp.openById(ssId);
  } catch (e) {
    throw new Error('経営データのスプレッドシートを開けませんでした。BIZ_SPREADSHEET_ID の値と、このスクリプトの実行者に閲覧権限があるかを確認してください。');
  }

  var result = [];
  specs.forEach(function (spec) {
    try {
      var values = ss.getRange(spec.range).getDisplayValues();
      var rows = values.filter(function (row) {
        return row.some(function (c) { return String(c).trim() !== ''; });
      });
      if (rows.length) result.push({ title: spec.title, rows: rows });
    } catch (e) {
      // 範囲指定の誤りで全体を止めない。RUN_LOGに残して次へ進む
      logRun_('biz:' + spec.title, 'ERROR', 0, 0, '範囲 ' + spec.range + ' を読めませんでした: ' + e);
    }
  });
  return result;
}

/**
 * 経営データをAIに渡すテキスト（タブ区切りの表）に整形する。
 * 表の形のまま渡すことで、AIが数字を作文しにくくなる。
 */
function formatBusinessDataForAi_(dataSets) {
  if (!dataSets.length) return '（経営データの連携は未設定です）';
  return dataSets.map(function (ds) {
    var body = ds.rows.map(function (row) {
      return row.map(function (c) { return String(c).trim(); }).join('\t');
    }).join('\n');
    return '【' + ds.title + '（シートで確定済みの値。計算しないでそのまま引用すること）】\n' + body;
  }).join('\n\n');
}
