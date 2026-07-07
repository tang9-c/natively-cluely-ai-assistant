// E2E smoke: 用真实 Windchill MCP URL 验证 adapter 真能跑通。
// 这不进入 CI(避免外网依赖 + 凭证)——只作为手动验证用。
//
// 实现上避开了 @modelcontextprotocol/sdk 在 Node 24 上的 schema 兼容问题
// (`v3Schema.safeParse is not a function`),直接用 fetch 调 JSON-RPC,
// 然后把真实响应喂给 wrapWindchillPartResults(来自 dist-electron),
// 证明 adapter 在真数据上行为正确。
import { wrapWindchillPartResults } from '../dist-electron/electron/services/business-system/WindchillBusinessContextAdapter.js';

const MCPUrl = process.env.WINDCHILL_URL;
const TOKEN = process.env.WINDCHILL_MCP_TOKEN;
if (!MCPUrl || !TOKEN) {
    console.error('Missing WINDCHILL_URL or WINDCHILL_MCP_TOKEN env var; skipping live integration smoke.');
    process.exit(0);
}

async function rpc(method, params, id) {
    const res = await fetch(MCPUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }),
    });
    if (!res.ok) {
        throw new Error(`RPC ${method} failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.json();
}

(async () => {
    // initialize (per MCP spec)
    await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'natively-windchill-e2e', version: '0.0.1' },
    }, 1);

    // 真打 Windchill part_search
    const raw = await rpc('tools/call', {
        name: 'part_search',
        arguments: { number: '*', limit: 2 },
    }, 2);

    const textPayload = raw?.result?.content?.find?.((c) => c?.type === 'text')?.text;
    if (!textPayload) {
        console.error('Unexpected response shape:', JSON.stringify(raw));
        process.exit(1);
    }
    const odata = JSON.parse(textPayload);

    // 喂给 adapter 的 wrapper,看真实 OData 包装出什么样的 BusinessSystemQueryResult
    const wrapped = wrapWindchillPartResults(odata, 'Windchill PLM');
    console.log('---E2E wrap result---');
    console.log(JSON.stringify(wrapped, null, 2));
})().catch((e) => {
    console.error('E2E failed:', e.message);
    process.exit(1);
});
