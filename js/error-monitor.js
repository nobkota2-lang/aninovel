/* アニノベル エラー監視
 * バックエンド未稼働時はlocalStorage保存、Sentry設定後は自動転送
 *
 * 設定 (各HTML):
 *   window.ANINOVEL_SENTRY_DSN='https://xxx@sentry.io/yyy';
 *   または
 *   window.ANINOVEL_ERROR_ENDPOINT='https://api.aninovel.com/errors';
 *
 * 機能:
 *   - window.onerror, unhandledrejection 捕捉
 *   - console.error 上書きで全エラー記録
 *   - 重複抑制 (同一エラー60秒間1回)
 *   - サンプリング (本番は5%程度に絞る、設定可)
 *   - パンくず(breadcrumb)記録 (直近20アクション)
 */
(function(){
  'use strict';
  var SENTRY_DSN=window.ANINOVEL_SENTRY_DSN||null;
  var ENDPOINT=window.ANINOVEL_ERROR_ENDPOINT||null;
  var SAMPLE_RATE=typeof window.ANINOVEL_ERROR_SAMPLE==='number'?window.ANINOVEL_ERROR_SAMPLE:1.0;
  var QUEUE_KEY='aninovel_errors_v1';
  var MAX_QUEUE=200;
  var DEDUPE_MS=60000;

  var lastSent={}; // {sig: ts}
  var breadcrumbs=[];

  function load(){try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');}catch(e){return [];}}
  function save(q){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q.slice(-MAX_QUEUE)));}catch(e){}}

  function addBreadcrumb(category,message,data){
    breadcrumbs.push({ts:new Date().toISOString(),category:category,message:String(message||'').slice(0,200),data:data});
    if(breadcrumbs.length>20)breadcrumbs.shift();
  }

  function getUser(){try{var u=JSON.parse(localStorage.getItem('aninovel_user'));return u&&u.id?{id:u.id}:{id:'anon'};}catch(e){return {id:'anon'};}}

  function record(level,err,extra){
    if(Math.random()>SAMPLE_RATE)return;
    var msg=(err&&err.message)||String(err);
    var stack=(err&&err.stack)||'';
    var sig=level+'|'+msg.slice(0,80);
    var now=Date.now();
    if(lastSent[sig]&&now-lastSent[sig]<DEDUPE_MS)return;
    lastSent[sig]=now;

    var entry={
      level:level,
      message:msg,
      stack:stack,
      url:location.href,
      ua:navigator.userAgent,
      ts:new Date().toISOString(),
      build:window.__ANINOVEL_BUILD__||null,
      user:getUser(),
      breadcrumbs:breadcrumbs.slice(),
      extra:extra||null
    };

    if(SENTRY_DSN){
      sendToSentry(entry).catch(function(){enqueueLocal(entry);});
    }else if(ENDPOINT){
      sendToEndpoint(entry).catch(function(){enqueueLocal(entry);});
    }else{
      enqueueLocal(entry);
    }
  }

  function enqueueLocal(entry){
    var q=load();q.push(entry);save(q);
  }

  async function sendToSentry(entry){
    // Sentry DSN: https://<key>@<host>/<project>
    var m=SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
    if(!m)throw new Error('invalid DSN');
    var auth='Sentry sentry_version=7,sentry_key='+m[1]+',sentry_client=aninovel/1.0';
    var url='https://'+m[2]+'/api/'+m[3]+'/store/';
    var payload={
      message:entry.message,
      level:entry.level,
      platform:'javascript',
      timestamp:entry.ts,
      release:entry.build||'unknown',
      user:entry.user,
      tags:{url:entry.url},
      breadcrumbs:{values:entry.breadcrumbs.map(function(b){return {timestamp:new Date(b.ts).getTime()/1000,category:b.category,message:b.message};})},
      extra:{stack:entry.stack,extra:entry.extra,ua:entry.ua}
    };
    var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Sentry-Auth':auth},body:JSON.stringify(payload)});
    if(!r.ok)throw new Error('sentry HTTP '+r.status);
  }

  async function sendToEndpoint(entry){
    var r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry),keepalive:true});
    if(!r.ok)throw new Error('endpoint HTTP '+r.status);
  }

  // ===== 自動キャプチャ =====
  window.addEventListener('error',function(e){record('error',e.error||e.message,{filename:e.filename,line:e.lineno,col:e.colno});});
  window.addEventListener('unhandledrejection',function(e){record('error',e.reason,{type:'unhandledrejection'});});

  // console.error 上書き
  var _origErr=console.error.bind(console);
  console.error=function(){
    try{record('warning',Array.prototype.map.call(arguments,String).join(' '),null);}catch(e){}
    _origErr.apply(null,arguments);
  };

  // 主要なユーザアクションを breadcrumb として記録
  document.addEventListener('click',function(e){
    var t=e.target;
    if(!t)return;
    var label=(t.textContent||'').trim().slice(0,40)||t.id||t.className;
    if(label)addBreadcrumb('click',label);
  },true);

  document.addEventListener('visibilitychange',function(){addBreadcrumb('visibility',document.visibilityState);});

  // ページ離脱時に未送信エラーを再送試行
  window.addEventListener('pagehide',function(){
    if(!ENDPOINT&&!SENTRY_DSN)return;
    var q=load();
    if(!q.length)return;
    try{navigator.sendBeacon(ENDPOINT||'/_sink',JSON.stringify({batch:q}));save([]);}catch(e){}
  });

  // 公開API
  window.AninovelMonitor={
    capture:record,
    breadcrumb:addBreadcrumb,
    queued:load,
    flush:function(){var q=load();save([]);return q;}
  };

  console.info('[Monitor] エラー監視初期化(sample='+SAMPLE_RATE+', dest='+(SENTRY_DSN?'sentry':ENDPOINT?'endpoint':'local')+')');
})();
