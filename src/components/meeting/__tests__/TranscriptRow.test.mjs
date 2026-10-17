import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSync} from 'esbuild';
const require=createRequire(import.meta.url);
const code=buildSync({entryPoints:['src/components/meeting/TranscriptRow.tsx'],bundle:true,platform:'node',format:'cjs',external:['react','react-dom','react/jsx-runtime'],write:false}).outputFiles[0].text;
const compiled={exports:{}};new Function('require','module','exports',code)(require,compiled,compiled.exports);
const {TranscriptRow}=compiled.exports;
const render=entry=>renderToStaticMarkup(React.createElement(TranscriptRow,{row:{key:'s',sourceIndex:0,entry:{segmentId:'s',speaker:'user',text:'虚构完成转录',timestamp:1,...entry}},onTextChange(){},formatTime:()=> '0:01'}));
test('finished transcript rows expose editing regardless of recognition provider',()=>{
 for(const provider of ['local-sensevoice','local-whisper','doubao-auc'])assert.match(render({provider,isFinal:true}),/aria-label="编辑此段转录"/);
});
test('streaming partials never expose transcript editing',()=>{
 for(const partial of [{isFinal:false},{final:false}])assert.doesNotMatch(render(partial),/aria-label="编辑此段转录"|aria-label="编辑转录"/);
});
