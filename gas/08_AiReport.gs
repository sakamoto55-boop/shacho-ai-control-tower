/**
 * 08_AiReport.gs
 * ------------------------------------------------------------------
 * 経営統括AI第1号。前日分の収集データと経営データを事業別に整理し、
 * Gemini APIに渡して日次報告を生成する。
 *
 * 【AIに任せること】
 *   - 文章の要約、気になる点の指摘、対応候補の優先順位づけ
 * 【AIに任せないこと（重要）】
 *   - 件数のカウント（GAS側で数えてプロンプトに書き込む）
 *   - 売上・原価などの数値の計算（シートの確定値をそのまま渡す）
 *   - 外部への返信文の作成（第1期では作らない）
 *
 * 【コスト・暴走対策】
 *   - 入力は MAX_AI_INPUT_CHARS で切る
 *   - 1日の呼び出し回数を MAX_GEMINI_CALLS_PER_DAY で制限する
 *   - 429/5xx は3回まで指数バックオフで再試行する
 * ------------------------------------------------------------------
 */

var GEMINI_ENDPOINT_ = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * 報告に使うデータを集める。件数の集計はここ（GAS）で確定させる。
 * @param {{start: Date, end: Date, label: string}} range
 */
function gatherReportData_(range) {
  var dateLabel = range.label; // 'yyyy/MM/dd'
  var segments = getSegments_();

  var mails = readRowsForDate_(SHEET.MAIL, dateLabel, 8000);
  var talks = readRowsForDate_(SHEET.TALK, dateLabel, 10000);
  var lines = cfgBool_('ENABLE_LINE_OA', true) ? readRowsForDate_(SHEET.LINE, dateLabel, 3000) : [];

  // 事業区分ごとの入れ物を用意する
  var bySegment = {};
  segments.forEach(function (seg) {
    bySegment[seg] = { segment: seg, mails: [], talks: [] };
  });
  if (!bySegment['その他']) {
    bySegment['その他'] = { segment: 'その他', mails: [], talks: [] };
    segments = segments.concat(['その他']);
  }

  var orgNameToSegment = {};
  getOrganizations_().forEach(function (o) { orgNameToSegment[o.orgName] = o.segment; });

  mails.forEach(function (row) {
    var seg = String(row[2]).trim() || orgNameToSegment[String(row[1]).trim()] || 'その他';
    if (!bySegment[seg]) seg = 'その他';
    bySegment[seg].mails.push(row);
  });

  talks.forEach(function (row) {
    var seg = orgNameToSegment[String(row[1]).trim()] || 'その他';
    if (!bySegment[seg]) seg = 'その他';
    bySegment[seg].talks.push(row);
  });

  return {
    range: range,
    dateLabel: dateLabel,
    segments: segments,
    bySegment: bySegment,
    lines: lines,
    counts: {
      mailTotal: mails.length,
      mailSummary: mails.filter(function (r) { return String(r[7]).toUpperCase() === 'TRUE'; }).length,
      talkTotal: talks.length,
      lineTotal: lines.length
    },
    business: loadBusinessData_()
  };
}

/**
 * 指定日のデータ行を読む。
 * シート末尾から lookbackRows 行だけを見る（全件読むと重いため）。
 */
function readRowsForDate_(sheetName, dateLabel, lookbackRows) {
  var sh = sheet_(sheetName);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = SHEET_HEADERS[sheetName].length;
  var count = Math.min(last - 1, lookbackRows);
  var values = sh.getRange(last - count + 1, 1, count, width).getValues();
  return values.filter(function (row) {
    return cellToDateTimeString_(row[0]).indexOf(dateLabel) === 0;
  }).map(function (row) {
    // 以降の処理が文字列前提なので、日時列だけ揃えておく
    row[0] = cellToDateTimeString_(row[0]);
    return row;
  });
}

/**
 * Geminiに渡すプロンプトを組み立てる。
 * 収集テキストはすべて maskForAi_ を通す。
 */
function buildReportPrompt_(data) {
  var maxChars = cfgNum_('MAX_AI_INPUT_CHARS', 60000);
  var topN = cfgNum_('TOP_ISSUE_COUNT', 3);

  var parts = [];

  parts.push([
    'あなたは4法人からなる企業グループ（建設・解体／地域支援／不動産／福祉）の経営統括AIです。',
    '経営者が毎朝3分で全体像をつかめるように、前日の社内情報を要約してください。',
    '',
    '【対象日】' + data.dateLabel,
    '',
    '【厳守事項】',
    '1. 数値の計算・推定・按分をしてはいけません。「経営データ」に書かれた確定値をそのまま引用するだけにしてください。',
    '   表に無い数値を新たに作ることは禁止です。',
    '2. 件数はすでに集計済みの値を下に示します。自分で数え直さないでください。',
    '3. 断定を避け、事実（誰がいつ何と言ったか）と、あなたの解釈を明確に分けて書いてください。',
    '4. 「対応が必要そうな事項」には、必ず根拠となるメール・トークの日時と発信者を添えてください。',
    '5. 個人の評価、処分、解雇、責任の認定に関する提案はしないでください。',
    '6. 金額・契約・納期・謝罪の文面を確定させる提案はしないでください（判断は経営者が行います）。',
    '7. 【伏字】【電話番号】【メールアドレス】などの表記は、マスキング済みの箇所です。復元しようとしないでください。',
    '8. 情報が乏しい事業については、無理に内容を作らず「特筆すべき動きなし」と書いてください。',
    '',
    '【出力フォーマット】プレーンテキスト。記号での装飾は最小限にし、LINE WORKSで読める形にしてください。',
    '',
    '■ 全社サマリー（3行）',
    '（3行ちょうどで書く）',
    '',
    '■ 事業別の動き'
  ].join('\n'));

  data.segments.forEach(function (seg) {
    parts.push('（' + seg + '）動き / 気になる点');
  });

  parts.push([
    '',
    '■ 対応が必要そうな事項 トップ' + topN,
    '1. 〔事業区分〕内容（根拠：MM/DD HH:MM 発信者 / 種別）',
    '   → なぜ対応が必要か',
    '',
    '以上のフォーマットに沿って、以下のデータから報告を作成してください。',
    '',
    '==================== 集計済みの件数（数え直さないこと） ====================',
    '・収集メール: ' + data.counts.mailTotal + '件（うち要約対象 ' + data.counts.mailSummary + '件）',
    '・LINE WORKSトーク: ' + data.counts.talkTotal + '件',
    '・LINE公式アカウント受信: ' + data.counts.lineTotal + '件',
    '',
    '==================== 経営データ ====================',
    maskBusinessText_(formatBusinessDataForAi_(data.business)),
    '',
    '==================== 事業別の元データ ===================='
  ].join('\n'));

  data.segments.forEach(function (seg) {
    var bucket = data.bySegment[seg];
    if (!bucket) return;
    if (!bucket.mails.length && !bucket.talks.length) {
      parts.push('\n----- ' + seg + ' -----\n（前日のデータなし）');
      return;
    }
    var block = ['\n----- ' + seg + ' -----'];

    var summaryMails = bucket.mails.filter(function (r) { return String(r[7]).toUpperCase() === 'TRUE'; });
    if (summaryMails.length) {
      block.push('[メール（要約対象）' + summaryMails.length + '件]');
      summaryMails.forEach(function (r) {
        block.push('・' + r[0] + ' ' + maskForAi_(r[3]) + ' → 件名:' + maskForAi_(r[6]) + ' / ' + maskForAi_(r[8]));
      });
    } else if (bucket.mails.length) {
      block.push('[メール] 要約対象に該当するものはありません（受信 ' + bucket.mails.length + '件）');
    }

    if (bucket.talks.length) {
      block.push('[LINE WORKSトーク ' + bucket.talks.length + '件]');
      bucket.talks.forEach(function (r) {
        block.push('・' + r[0] + ' [' + maskForAi_(r[2]) + '] ' + maskForAi_(r[3]) + ': ' + maskForAi_(r[5]));
      });
    }
    parts.push(block.join('\n'));
  });

  if (data.lines.length) {
    var lineBlock = ['\n----- LINE公式アカウント（顧客からの受信） -----'];
    data.lines.forEach(function (r) {
      lineBlock.push('・' + r[0] + ' ' + maskForAi_(r[1] || '(名前未取得)') + ': ' + maskForAi_(r[3]));
    });
    parts.push(lineBlock.join('\n'));
  }

  var prompt = parts.join('\n');
  if (prompt.length > maxChars) {
    prompt = prompt.slice(0, maxChars) + '\n\n（※入力上限 ' + maxChars + ' 文字に達したため、ここから先のデータは省略されています。この点を報告の末尾に一言添えてください）';
  }
  return prompt;
}

/**
 * Gemini APIを呼ぶ。
 * APIキーはURLではなくヘッダーで渡す（ログにキーが残るのを避けるため）。
 */
function callGemini_(prompt) {
  guardGeminiQuota_();

  var model = cfg_('GEMINI_MODEL', 'gemini-2.5-flash');
  var url = GEMINI_ENDPOINT_ + encodeURIComponent(model) + ':generateContent';

  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: cfgNum_('GEMINI_TEMPERATURE', 0.2),
      maxOutputTokens: cfgNum_('GEMINI_MAX_OUTPUT_TOKENS', 2048)
    }
  };

  var res = fetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': getProp_('GEMINI_API_KEY', true) },
    payload: JSON.stringify(payload)
  }, 'Gemini API');

  var candidates = res.candidates || [];
  if (!candidates.length) {
    var reason = (res.promptFeedback && res.promptFeedback.blockReason) || '不明';
    throw new Error('Geminiが回答を返しませんでした（理由: ' + reason + '）。入力内容を確認してください。');
  }
  var textParts = (candidates[0].content && candidates[0].content.parts) || [];
  var text = textParts.map(function (p) { return p.text || ''; }).join('');
  if (!text.trim()) {
    throw new Error('Geminiの回答が空でした。GEMINI_MAX_OUTPUT_TOKENS の値を確認してください。');
  }
  return text.trim();
}

/** 1日の呼び出し回数を制限する（コストと暴走の防止） */
function guardGeminiQuota_() {
  var max = cfgNum_('MAX_GEMINI_CALLS_PER_DAY', 5);
  var key = 'GEMINI_CALLS_' + formatDateKey_(new Date());
  var props = scriptProps_();
  var count = Number(props.getProperty(key) || 0);
  if (count >= max) {
    throw new Error('本日のGemini呼び出し上限（' + max + '回）に達しました。CONFIGの MAX_GEMINI_CALLS_PER_DAY で調整できます。');
  }
  props.setProperty(key, String(count + 1));
  cleanupOldQuotaKeys_(props);
}

/** 古い日付のカウンタを掃除する（プロパティが際限なく増えないように） */
function cleanupOldQuotaKeys_(props) {
  var keep = {};
  for (var i = 0; i < 3; i++) {
    keep['GEMINI_CALLS_' + formatDateKey_(new Date(Date.now() - i * 86400000))] = true;
  }
  var all = props.getKeys();
  all.forEach(function (k) {
    if (k.indexOf('GEMINI_CALLS_') === 0 && !keep[k]) props.deleteProperty(k);
  });
}

/**
 * 報告本文を組み立てる（AIの出力にGAS側の確定情報を付ける）。
 */
function composeReportText_(data, aiText) {
  var header = [
    '━━━━━━━━━━━━━━━━━━━━',
    '【グループ日次報告】' + data.dateLabel,
    '━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  var footer = [
    '',
    '────────────────────',
    '収集件数: メール' + data.counts.mailTotal + '件（要約対象' + data.counts.mailSummary + '件） / '
      + 'トーク' + data.counts.talkTotal + '件 / LINE' + data.counts.lineTotal + '件',
    '※本報告はAIによる要約です。判断は元のメール・トークをご確認のうえお願いします。',
    '※このシステムは読み取りと社内通知のみを行います。外部への返信はしません。'
  ].join('\n');

  return header + '\n' + aiText + '\n' + footer;
}
