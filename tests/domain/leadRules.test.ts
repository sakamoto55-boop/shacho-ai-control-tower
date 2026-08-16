import { describe, expect, it } from 'vitest';
import {
  detectBusinessLine,
  detectInquirySpam,
  estimateLeadValueYen,
  isOpenLeadStage,
  scoreLead,
  winProbability
} from '../../src/domain/leadRules.js';

describe('detectBusinessLine', () => {
  it('解体の反響を解体事業として判定する', () => {
    expect(detectBusinessLine('空き家の解体をお願いしたいです')).toBe('demolition');
  });

  it('外構を建設より優先して判定する', () => {
    expect(detectBusinessLine('駐車場の外構工事を検討しています')).toBe('exterior');
  });

  it('判別できない場合はunknownを返す', () => {
    expect(detectBusinessLine('こんにちは')).toBe('unknown');
  });
});

describe('scoreLead', () => {
  it('見積依頼と時期の明示がある反響をhotにする', () => {
    const result = scoreLead(
      '解体の見積をお願いしたいです。今月中に現地を見に来ていただけますか。電話は090-0000-0000です。'
    );
    expect(result.temperature).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.buyingSignals).toContain('見積依頼');
  });

  it('感想だけのコメントはcoldになる', () => {
    const result = scoreLead('素敵ですね！');
    expect(result.temperature).toBe('cold');
    expect(result.buyingSignals).toHaveLength(0);
  });

  it('本文に書かれていない項目を不足情報として返す', () => {
    const result = scoreLead('費用はいくらぐらいですか');
    expect(result.missingInfo).toContain('連絡先（電話またはメール）');
  });
});

describe('detectInquirySpam', () => {
  it('売り込みDMを弾く', () => {
    const result = detectInquirySpam('相互フォローお願いします！');
    expect(result.isSpam).toBe(true);
    expect(result.reason).toContain('相互フォロー');
  });

  it('工事の相談を含む場合はスパムにしない', () => {
    const result = detectInquirySpam('SEO対策の話ではなく、外構工事の見積をお願いしたいです');
    expect(result.isSpam).toBe(false);
  });
});

describe('estimateLeadValueYen', () => {
  it('本文の金額表記を優先する', () => {
    expect(estimateLeadValueYen('demolition', '予算は300万円ぐらいです')).toBe(3_000_000);
  });

  it('坪数から規模を反映する', () => {
    const small = estimateLeadValueYen('demolition', '20坪の解体です');
    const large = estimateLeadValueYen('demolition', '80坪の解体です');
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(large as number).toBeGreaterThan(small as number);
  });

  it('判断材料がなければnullを返す', () => {
    expect(estimateLeadValueYen('unknown', 'こんにちは')).toBeNull();
  });
});

describe('winProbability', () => {
  it('段階が進むほど確度が上がる', () => {
    expect(winProbability('proposed', 'warm')).toBeGreaterThan(winProbability('new', 'warm'));
  });

  it('受注・失注は温度感で補正しない', () => {
    expect(winProbability('won', 'cold')).toBe(1);
    expect(winProbability('lost', 'hot')).toBe(0);
  });
});

describe('isOpenLeadStage', () => {
  it('受注・失注以外を進行中とみなす', () => {
    expect(isOpenLeadStage('estimating')).toBe(true);
    expect(isOpenLeadStage('won')).toBe(false);
    expect(isOpenLeadStage('lost')).toBe(false);
  });
});
