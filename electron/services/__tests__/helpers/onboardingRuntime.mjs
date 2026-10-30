import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(import.meta.dirname, '../../../..');
function source(relative) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  return ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
}
function evaluate(text, globals) {
  const module = { exports: {} };
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, Buffer, setTimeout, clearTimeout, console, process, ...globals });
  return module.exports;
}
export function mainMethods(names, globals = {}) {
  const ast = source('electron/main.ts');
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppState');
  const methods = names.map(name => {
    const node = cls.members.find(member => member.name?.getText(ast) === name);
    if (!node) throw new Error(`Missing actual AppState method ${name}`);
    return node.getText(ast);
  });
  return evaluate(`class AppState { ${methods.join('\n')} }; module.exports = AppState;`, globals);
}
export function ipcHandler(channel, globals = {}) {
  const ast = source('electron/ipcHandlers.ts'); let statement;
  function visit(node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'safeHandle'
      && node.expression.arguments[0]?.text === channel) statement = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); if (!statement) throw new Error(`Missing actual IPC ${channel}`);
  let handler; evaluate(statement, { safeHandle: (_name, fn) => handler = fn, ...globals });
  return handler;
}
export function localIpcFunction(name, globals = {}) {
  const ast = source('electron/ipcHandlers.ts'); let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer?.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); if (!value) throw new Error(`Missing local function ${name}`);
  return evaluate(`module.exports = ${value};`, globals);
}
export function settingsAudioEffect(globals = {}) {
  const ast = source('src/components/SettingsOverlay.tsx'); let value;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
        && node.arguments[0]?.getText(ast).includes('startAudioTest')) value = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); if (!value) throw new Error('Missing settings audio effect');
  return evaluate(`module.exports = ${value};`, globals);
}
export function appPermissionEffect(globals = {}) {
  const ast = source('src/App.tsx'); let value;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('maybeShowPermissionsToaster')) value = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); if (!value) throw new Error('Missing actual App permission effect');
  return evaluate(`module.exports = ${value};`, globals);
}

export function mainInitializer(name, globals = {}) {
  const ast = source('electron/main.ts'); let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer?.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); if (!value) throw new Error(`Missing main initializer ${name}`);
  return evaluate(`module.exports = ${value};`, globals);
}
