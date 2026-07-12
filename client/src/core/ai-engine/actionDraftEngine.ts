// 推奨アクション下書きエンジン
// 社長承認が必要なアクションの下書きを生成する
// 外部送信・保存・実行は一切行わない（UI表示・社長確認のみ）

import type { ActionDraft, DecisionItem, EvidenceSource, ApprovalStatus } from './aiEngineTypes'
import type { UnifiedInboxItem, UnifiedNotification } from '../providers/providerTypes'

function makeEvidence(type: EvidenceSource['type'], id: string, title: string, snippet: string, source: string): EvidenceSource {
  return { type, id, title, snippet, source }
}

export function buildApprovalQueue(
  inbox: UnifiedInboxItem[],
  notifications: UnifiedNotification[],
  decisions: DecisionItem[]
): ActionDraft[] {
  const drafts: ActionDraft[] = []

  // 1. 受信箱からの返信下書き（優先度A・承認必要）
  for (const item of inbox.filter((i) => i.priority === 'A' && i.requiresApproval)) {
    drafts.push({
      id: `draft-inbox-${item.id}`,
      title: `返信下書き: ${item.subject ?? '（件名なし）'}`,
      actionType: 'reply',
      targetName: item.fromName ?? item.from,
      targetContext: `${item.source} · ${item.subject ?? ''}`,
      draftText: generateReplyDraft(item),
      reason: `優先度A案件のため社長確認が必要です。送信前に必ず承認してください。`,
      evidenceSources: [makeEvidence('inbox', item.id, item.subject ?? '', item.bodyPreview?.slice(0, 60) ?? '', item.source)],
      requiresApproval: true,
      approvalStatus: 'pending' as ApprovalStatus,
      externalSendDisabled: true,
      saveDisabled: true,
      readOnly: true,
      writeEnabled: false,
    })
  }

  // 2. 緊急通知からの報告・連絡下書き
  for (const notif of notifications.filter((n) => n.urgency === 'critical' || (n.urgency === 'high' && n.riskFlag))) {
    drafts.push({
      id: `draft-notif-${notif.id}`,
      title: `対応連絡下書き: ${notif.title}`,
      actionType: notif.category === 'accident' || notif.category === 'sos' ? 'report' : 'confirm',
      targetName: notif.senderName ?? '担当者',
      targetContext: `LINE WORKS · ${notif.category} · ${notif.senderDepartment ?? ''}`,
      draftText: generateNotifDraft(notif),
      reason: `${notif.urgency === 'critical' ? '緊急' : '重要'}通知への対応連絡です。内容を確認してから送信してください。`,
      evidenceSources: [makeEvidence('notification', notif.id, notif.title, notif.body.slice(0, 60), notif.source)],
      requiresApproval: true,
      approvalStatus: 'pending' as ApprovalStatus,
      externalSendDisabled: true,
      saveDisabled: true,
      readOnly: true,
      writeEnabled: false,
    })
  }

  // 3. 決断リストからの委任・確認依頼下書き（承認必要かつ重要度A）
  for (const decision of decisions.filter((d) => d.requiresApproval && d.importance === 'A' && d.category === 'bank')) {
    const alreadyIn = drafts.some((dr) => dr.evidenceSources.some((e) => decision.evidenceSources.some((de) => de.id === e.id)))
    if (alreadyIn) continue
    drafts.push({
      id: `draft-decision-${decision.id}`,
      title: `確認依頼下書き: ${decision.title}`,
      actionType: 'confirm',
      targetName: '担当者・税理士',
      targetContext: `${decision.category} · ${decision.summary.slice(0, 40)}`,
      draftText: generateDecisionDraft(decision),
      reason: decision.reason,
      evidenceSources: decision.evidenceSources.slice(0, 2),
      requiresApproval: true,
      approvalStatus: 'pending' as ApprovalStatus,
      externalSendDisabled: true,
      saveDisabled: true,
      readOnly: true,
      writeEnabled: false,
    })
  }

  return drafts.slice(0, 6)
}

function generateReplyDraft(item: UnifiedInboxItem): string {
  const deadline = item.deadline ? `\n※ 期限: ${item.deadline}` : ''
  return `お世話になっております。

${item.fromName ?? item.from} 様

ご連絡いただきありがとうございます。
「${item.subject ?? '件名なし'}」について確認いたしました。

（ここに社長の回答を記入してください）

何卒よろしくお願いいたします。${deadline}

---
⚠️ この下書きは社長確認用です。送信前に必ず内容を確認し、承認を行ってください。
外部への送信は行っておりません。`
}

function generateNotifDraft(notif: UnifiedNotification): string {
  const categoryLabelMap: Record<string, string> = {
    accident: '事故対応',
    sos: 'SOS対応',
    absence: '欠勤対応',
    vehicle: '車両トラブル対応',
    delay: '遅延対応',
    finance: '財務対応',
    operation: '業務対応',
    other: '対応',
  }
  const categoryLabel = categoryLabelMap[notif.category ?? 'other'] ?? '対応'

  return `【${categoryLabel}】連絡

${notif.senderName ?? '担当者'} さんへ

状況を確認しました。
以下の対応を行います:

1. ${notif.suggestedAction ?? '状況確認と必要な対応を実施します'}
2. 関係者への連絡・報告
3. 事後記録の作成

引き続き状況を報告してください。

---
⚠️ この下書きは社長確認用です。送信前に必ず内容を確認し、承認を行ってください。
外部への送信は行っておりません。`
}

function generateDecisionDraft(decision: DecisionItem): string {
  return `【確認依頼】${decision.title}

お世話になっております。

以下の件について、ご確認・ご対応をお願いいたします。

件名: ${decision.title}
概要: ${decision.summary}
推奨アクション: ${decision.suggestedAction}
期限: ${decision.timeEstimate}

ご確認のほど、よろしくお願いいたします。

---
⚠️ この下書きは社長確認用です。送信前に必ず内容を確認し、承認を行ってください。
外部への送信は行っておりません。`
}
