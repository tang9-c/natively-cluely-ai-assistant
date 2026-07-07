import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

// 静态 wiring 测试:确保生产路径 ipcHandlers.ts 真的在构造 BusinessSystemContextService
// 时显式注入 plmAdapter。否则这次加的 Windchill adapter 等于"代码存在但生产不调用"。
test('ipcHandlers wires plmAdapter into BusinessSystemContextService', () => {
    const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

    // 必须加载 createWindchillBusinessContextAdapter(ipcHandlers.ts 内部用 require,不是 import)
    assert.match(
        source,
        /require\s*\(\s*['"]\.\/services\/business-system\/WindchillBusinessContextAdapter['"]\s*\)/,
        'ipcHandlers.ts should require the Windchill adapter factory',
    );

    // 必须传 plmAdapter 字段
    assert.match(
        source,
        /new\s+BusinessSystemContextService\(\s*\{[\s\S]*?plmAdapter\s*:\s*createWindchillBusinessContextAdapter/,
        'ipcHandlers.ts must pass plmAdapter (from createWindchillBusinessContextAdapter) into BusinessSystemContextService',
    );
});
