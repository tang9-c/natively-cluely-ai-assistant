import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

// 静态 wiring 测试:确保生产 IPC 路径通过上下文准备模块构造 BusinessSystemContextService
// 并显式注入 plmAdapter。否则 Windchill adapter 等于"代码存在但生产不调用"。
test('ipcHandlers wires plmAdapter into BusinessSystemContextService', () => {
    const ipcSource = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
    const contextSource = fs.readFileSync(
        path.join(root, 'electron/services/context/WhatToSayContextPreparation.ts'),
        'utf8',
    );

    assert.match(
        ipcSource,
        /prepareWhatToSayContext/,
        'ipcHandlers.ts should call the context preparation module used by generate-what-to-say',
    );

    assert.match(
        contextSource,
        /from\s+['"]\.\.\/business-system\/WindchillBusinessContextAdapter['"]/,
        'WhatToSayContextPreparation.ts should import the Windchill adapter factory',
    );

    assert.match(
        contextSource,
        /new\s+BusinessSystemContextService\(\s*\{[\s\S]*?plmAdapter\s*:\s*createWindchillBusinessContextAdapter/,
        'WhatToSayContextPreparation.ts must pass plmAdapter into BusinessSystemContextService',
    );
});
