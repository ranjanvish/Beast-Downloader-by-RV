const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)}});
const menus=[],opened=[];
const chrome={alarms:{create:async()=>{},onAlarm:event()},runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture'+p,onInstalled:event(),onStartup:event(),onMessage:event()},storage:{local:{get:async()=>({}),set:async()=>{}}},permissions:{onAdded:event(),onRemoved:event(),getAll:async()=>({origins:[]})},scripting:{unregisterContentScripts:async()=>{}},contextMenus:{removeAll:async()=>{},create:m=>menus.push(m),onClicked:event()},tabs:{query:async()=>[],create:async p=>opened.push(p),onRemoved:event(),onUpdated:event()},commands:{onCommand:event()},webRequest:{onHeadersReceived:event()}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../.output/chrome-mv3/background.js'),'utf8'),{chrome,URL,console,Map,Date});
(async()=>{
 chrome.runtime.onInstalled.listeners[0]();await new Promise(r=>setImmediate(r));
 for(const kind of ['image','video','audio']){
  assert.ok(menus.some(m=>m.id==='beast-'+kind&&m.contexts[0]===kind));
  chrome.contextMenus.onClicked.listeners[0]({srcUrl:'https://example.com/source',mediaType:kind,pageUrl:'https://example.com/page'},{id:5});
  const url=new URL(opened.at(-1).url);assert.equal(url.searchParams.get('kind'),kind);assert.equal(url.searchParams.get('target'),'https://example.com/source');
 }
 chrome.contextMenus.onClicked.listeners[0]({srcUrl:'blob:https://youtube.com/123',mediaType:'video',pageUrl:'https://www.youtube.com/watch?v=test'},{id:5});
 assert.equal(new URL(opened.at(-1).url).searchParams.get('target'),'https://www.youtube.com/watch?v=test');
 const count=opened.length, listener=chrome.runtime.onMessage.listeners[0];
 await listener({type:'open-media',kind:'video',target:'https://example.com/video'},{id:'hostile',url:'https://example.com',tab:{id:1}});
 await listener({type:'overlay',enabled:true},{id:'fixture',url:'https://example.com',tab:{id:1}});
 assert.equal(opened.length,count);
 console.log('PASS: separate image/video/audio context menus, exact clicked source, blob/page fallback, untrusted sender rejection and content-script privilege separation.');
})().catch(e=>{console.error(e);process.exitCode=1});
