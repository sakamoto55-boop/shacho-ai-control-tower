/**
 * 07_Masking.gs
 * ------------------------------------------------------------------
 * AIに渡す前のマスキング（設計原則3）。
 *
 * ルールは CONFIG_MASK シートで管理する。
 *   種別 regex … 正規表現。gフラグを自動で付けて全置換する
 *   種別 word  … 単純な文字列置換（氏名・施設名・病名などの固有名詞向け）
 *
 * 【重要】
 * - AIへ渡すテキストは、必ず maskForAi_() を通すこと。
 *   08_AiReport.gs のプロンプト組み立てで漏れなく適用している。
 * - 経営データ（売上・原価）には正規表現ルールを当てない。
 *   電話番号のパターンが金額や社員番号に誤ヒットして、
 *   数字が壊れた状態でAIに渡るのを防ぐため。
 *   固有名詞（word ルール）だけを適用する。
 * ------------------------------------------------------------------
 */

var MASK_RULES_CACHE_ = null;

function maskRules_() {
  if (!MASK_RULES_CACHE_) MASK_RULES_CACHE_ = getMaskRules_();
  return MASK_RULES_CACHE_;
}

function clearMaskRulesCache_() {
  MASK_RULES_CACHE_ = null;
}

/**
 * 収集したテキスト（メール・トーク・LINE）用のマスキング。
 * 正規表現ルールと固有名詞ルールの両方を適用する。
 */
function maskForAi_(text) {
  return applyMaskRules_(text, true);
}

/**
 * 経営データ用のマスキング。固有名詞ルールのみを適用する。
 * 数値を壊さないための区別。
 */
function maskBusinessText_(text) {
  return applyMaskRules_(text, false);
}

function applyMaskRules_(text, useRegex) {
  var s = String(text == null ? '' : text);
  if (!s) return '';
  var rules = maskRules_();
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (rule.kind === 'word') {
      s = replaceAllLiteral_(s, rule.pattern, rule.replacement);
    } else if (rule.kind === 'regex' && useRegex) {
      try {
        s = s.replace(new RegExp(rule.pattern, 'g'), rule.replacement);
      } catch (e) {
        // 不正な正規表現が1件あっても他のルールは適用し続ける
        logRun_('mask', 'ERROR', 0, 0, '正規表現が不正です: ' + rule.pattern + ' / ' + e);
      }
    }
  }
  return s;
}

/** 正規表現を使わない全置換（記号を含む固有名詞でも安全に置換するため） */
function replaceAllLiteral_(text, search, replacement) {
  if (!search) return text;
  return text.split(search).join(replacement);
}

/**
 * マスキングの効き具合を確認するための要約。
 * 「何件伏せ字にしたか」をRUN_LOGに残す用途。
 */
function countMaskHits_(before, after) {
  var pattern = /【[^】]{1,12}】/g;
  var beforeHits = (String(before).match(pattern) || []).length;
  var afterHits = (String(after).match(pattern) || []).length;
  return Math.max(0, afterHits - beforeHits);
}
