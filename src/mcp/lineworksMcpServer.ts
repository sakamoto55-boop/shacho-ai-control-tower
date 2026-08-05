import {
  LineworksApiClient,
  isDryRun,
  loadLineworksApiConfigFromEnv,
  loadRecipientsFromEnv,
  type LineworksRecipient
} from '../connectors/lineworksApi.js';

// claude.ai のカスタムコネクタ（MCP Streamable HTTP）向けの最小実装。
// 対応メソッド: initialize / ping / tools/list / tools/call / notifications/*
// セッション管理は行わないステートレス構成（仕様上許容されている）。

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'shacho-ai-lineworks', version: '0.1.0' };

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpDependencies {
  listRecipients(): LineworksRecipient[];
  dryRun(): boolean;
  sendText(recipient: LineworksRecipient, text: string): Promise<void>;
}

export function createDefaultMcpDependencies(): McpDependencies {
  let client: LineworksApiClient | null = null;
  return {
    listRecipients: () => loadRecipientsFromEnv(),
    dryRun: () => isDryRun(),
    sendText: async (recipient, text) => {
      if (!client) {
        const config = loadLineworksApiConfigFromEnv();
        if (!config) {
          throw new Error(
            'LINE WORKSのAPI設定が不足しています。LINEWORKS_CLIENT_ID / LINEWORKS_CLIENT_SECRET / LINEWORKS_SERVICE_ACCOUNT / LINEWORKS_PRIVATE_KEY / LINEWORKS_BOT_ID を設定してください。'
          );
        }
        client = new LineworksApiClient(config);
      }
      await client.sendTextMessage(recipient, text);
    }
  };
}

const TOOLS = [
  {
    name: 'lineworks_list_recipients',
    description:
      '送信可能なLINE WORKSの宛先一覧を返します。宛先はサーバー側の許可リスト（LINEWORKS_RECIPIENTS）で管理されており、ここに載っている相手にのみメッセージを送れます。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'lineworks_send_message',
    description:
      '許可リストに登録済みの宛先（社内の担当者またはトークルーム）へLINE WORKSのテキストメッセージを送信します。宛先名はlineworks_list_recipientsで確認できます。LINEWORKS_DRY_RUN=false でない限り実送信は行わず、送信内容のプレビューのみ返します。',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: '宛先名（許可リストのnameと完全一致。例: 竹内）'
        },
        text: {
          type: 'string',
          description: '送信するメッセージ本文（日本語）'
        }
      },
      required: ['recipient', 'text'],
      additionalProperties: false
    }
  }
];

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function toolText(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

async function callTool(name: string, args: Record<string, unknown>, deps: McpDependencies): Promise<ToolResult> {
  if (name === 'lineworks_list_recipients') {
    const recipients = deps.listRecipients();
    if (recipients.length === 0) {
      return toolText(
        '宛先が未設定です。サーバーの環境変数 LINEWORKS_RECIPIENTS に宛先リスト（JSON配列）を設定してください。'
      );
    }
    const lines = recipients.map(
      (r) => `- ${r.name}（${r.type === 'channel' ? 'トークルーム' : '個別トーク'}）`
    );
    return toolText(`送信可能な宛先:\n${lines.join('\n')}\n\nドライラン: ${deps.dryRun() ? 'ON（実送信しません）' : 'OFF（実送信します）'}`);
  }

  if (name === 'lineworks_send_message') {
    const recipientName = typeof args.recipient === 'string' ? args.recipient.trim() : '';
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!recipientName || !text) {
      return toolText('recipient と text は必須です。', true);
    }

    const recipients = deps.listRecipients();
    const recipient = recipients.find((r) => r.name === recipientName);
    if (!recipient) {
      const known = recipients.map((r) => r.name).join('、') || '（未設定）';
      return toolText(
        `宛先「${recipientName}」は許可リストに登録されていません。登録済みの宛先: ${known}`,
        true
      );
    }

    if (deps.dryRun()) {
      return toolText(
        [
          '【ドライラン】実際には送信していません。LINEWORKS_DRY_RUN=false で実送信になります。',
          `宛先: ${recipient.name}（${recipient.type === 'channel' ? 'トークルーム' : '個別トーク'}）`,
          '--- 送信予定の本文 ---',
          text
        ].join('\n')
      );
    }

    await deps.sendText(recipient, text);
    return toolText(`送信しました。\n宛先: ${recipient.name}\n--- 本文 ---\n${text}`);
  }

  return toolText(`不明なツールです: ${name}`, true);
}

function jsonRpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * MCPのJSON-RPCメッセージを1件処理する。
 * 通知（idなし）の場合はnullを返す（HTTP 202で応答すること）。
 */
export async function handleMcpMessage(
  message: JsonRpcMessage,
  deps: McpDependencies = createDefaultMcpDependencies()
): Promise<Record<string, unknown> | null> {
  const method = message.method ?? '';

  // 通知（レスポンス不要）
  if (message.id === undefined || message.id === null) {
    return null;
  }

  const id = message.id;

  if (method === 'initialize') {
    const requested = (message.params?.protocolVersion as string | undefined) ?? '';
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0];
    return jsonRpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO
    });
  }

  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const name = (message.params?.name as string | undefined) ?? '';
    const args = (message.params?.arguments as Record<string, unknown> | undefined) ?? {};
    try {
      const result = await callTool(name, args, deps);
      return jsonRpcResult(id, result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return jsonRpcResult(id, toolText(`ツール実行に失敗しました: ${detail}`, true));
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
