/* アニノベル 海賊サイト対策モジュール
 * 注意: 完全な保護は不可能。あくまで「素人」を排除し、抑止・検出・追跡可能にする目的。
 * 本格的な保護は #2+#3 でサーバ動的配信に移行してから。
 *
 * 機能:
 *   1. 透かし(ウォーターマーク): ページに不可視文字でユーザID/タイムスタンプを埋込
 *   2. ホスト検証: 公式ドメイン以外で動作した場合に警告 + 解析ビーコン送信
 *   3. 右クリック/コピー抑止 (offモード可、UX影響大)
 *   4. DevTools 開閉検知 (情報レベルの抑止)
 *   5. ホットリンク防止 (画像が外部から参照されている場合の検知)
 *   6. カナリアトークン: ページに不可視のユニークIDを埋込み、海賊サイトに残った場合に追跡可能
 */
(function(){
  'use strict';

  // ===== 設定 =====
  var CONFIG={
    // 公式ホスト一覧。これ以外で動作した場合に警告(将来 aninovel.com 追加予定)
    officialHosts:[
      'nobkota2-lang.github.io',
      'aninovel.com',
      'www.aninovel.com',
      'aninovel.pages.dev',
      'localhost',
      '127.0.0.1'
    ],
    // 通報用エンドポイント (将来 Supabase Edge Function に置換)
    reportEndpoint:null, // 例: 'https://api.aninovel.com/report-piracy'
    // 右クリック・コピー抑止 (UX 影響大、デフォOFF)
    blockRightClick:false,
    blockCopy:false,
    blockSelect:false,
    // DevTools 検知 (検知のみ、強制終了はしない)
    detectDevTools:true,
    // カナリアトークン (ページHTMLに埋め込む)
    enableCanary:true
  };
  window.ANINOVEL_ANTIPIRACY_CONFIG=window.ANINOVEL_ANTIPIRACY_CONFIG||{};
  for(var k in window.ANINOVEL_ANTIPIRACY_CONFIG){CONFIG[k]=window.ANINOVEL_ANTIPIRACY_CONFIG[k];}

  // ===== 1. ホスト検証 =====
  function isOfficialHost(){
    var h=location.hostname.toLowerCase();
    return CONFIG.officialHosts.some(function(o){return h===o||h.endsWith('.'+o);});
  }

  function reportSuspicious(reason,extra){
    var data={
      reason:reason,
      url:location.href,
      host:location.hostname,
      referrer:document.referrer||'(direct)',
      ua:navigator.userAgent,
      ts:new Date().toISOString(),
      extra:extra||null
    };
    console.warn('[Anti-Piracy] 不審アクセス検知:',data);
    if(CONFIG.reportEndpoint){
      try{
        navigator.sendBeacon(CONFIG.reportEndpoint,JSON.stringify(data));
      }catch(e){}
    }
  }

  // ===== 2. 不可視透かし =====
  // ユーザIDやタイムスタンプを zero-width 文字で本文末尾に埋込
  // → 海賊サイトに転載された場合、原本の出所を特定可能
  function injectWatermark(){
    try{
      var u=null;
      try{u=JSON.parse(localStorage.getItem('aninovel_user'));}catch(e){}
      var uid=(u&&u.id)||'anon';
      var ts=Date.now();
      var payload=uid+'|'+ts+'|'+location.pathname;
      // base36 → zero-width binary
      var zw=Array.prototype.map.call(payload,function(c){
        return c.charCodeAt(0).toString(2).padStart(8,'0').replace(/0/g,'​').replace(/1/g,'‌');
      }).join('‍');
      var span=document.createElement('span');
      span.setAttribute('data-an-wm','1');
      span.style.cssText='position:absolute;width:0;height:0;overflow:hidden';
      span.textContent=zw;
      (document.body||document.documentElement).appendChild(span);
    }catch(e){}
  }

  // ===== 3. カナリアトークン =====
  // 一意のIDをセッション毎に発行し、海賊サイトに残った場合に出所追跡可能
  function injectCanary(){
    if(!CONFIG.enableCanary)return;
    try{
      var canary=Math.random().toString(36).slice(2)+Date.now().toString(36);
      var meta=document.createElement('meta');
      meta.name='x-aninovel-canary';
      meta.content=canary;
      document.head.appendChild(meta);
      try{sessionStorage.setItem('aninovel_canary',canary);}catch(e){}
    }catch(e){}
  }

  // ===== 4. 右クリック等の抑止 (任意) =====
  function applyUiGuards(){
    if(CONFIG.blockRightClick){
      document.addEventListener('contextmenu',function(e){
        // 編集中の入力欄・textarea は除外 (UX保護)
        var t=e.target;
        if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
        e.preventDefault();
      });
    }
    if(CONFIG.blockCopy){
      document.addEventListener('copy',function(e){
        var t=e.target;
        if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
        e.preventDefault();
        // クリップボードにマーカーテキストを書く
        try{e.clipboardData.setData('text/plain','— アニノベルの作品は著作権法で保護されています。無断転載は禁止です。https://aninovel.com —');}catch(_){}
      });
    }
    if(CONFIG.blockSelect){
      var s=document.createElement('style');
      s.textContent='.bubble,.bubble *,.vertical-item,.narration-plain{user-select:none;-webkit-user-select:none}';
      document.head.appendChild(s);
    }
  }

  // ===== 5. DevTools 検知 (情報レベル) =====
  function detectDevTools(){
    if(!CONFIG.detectDevTools)return;
    var threshold=160;
    var fired=false;
    setInterval(function(){
      var w=window.outerWidth-window.innerWidth;
      var h=window.outerHeight-window.innerHeight;
      var open=(w>threshold||h>threshold);
      if(open&&!fired){
        fired=true;
        console.info('%c⚠ アニノベルからのお願い','color:#C0392B;font-size:18px;font-weight:bold');
        console.info('%c当サイトのコンテンツは著作権法で保護されています。','color:#666;font-size:14px');
        console.info('%c無断転載・複製・改変は禁止です。違反は法的措置の対象となります。','color:#666;font-size:14px');
        console.info('%c不具合報告・お問い合わせ: https://aninovel.com/legal/dmca.html','color:#3498DB;font-size:12px');
      }else if(!open){
        fired=false;
      }
    },2000);
  }

  // ===== 6. ホットリンク防止 (画像) =====
  // 同じドメイン以外から img タグで自サイトの画像が参照された場合 referer で検知
  // (本格対応はサーバ側 Referer チェックで行う必要がある)

  // ===== 初期化 =====
  function init(){
    injectCanary();
    injectWatermark();
    applyUiGuards();
    detectDevTools();
    if(!isOfficialHost()){
      reportSuspicious('non-official-host');
      // 警告バナー
      try{
        var bn=document.createElement('div');
        bn.style.cssText='position:fixed;top:0;left:0;right:0;background:#C0392B;color:#fff;padding:14px;text-align:center;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.3)';
        bn.innerHTML='⚠ このサイトは「アニノベル」公式サイトではありません。無断転載の可能性があります。 公式: <a href="https://aninovel.com" style="color:#fff;text-decoration:underline">aninovel.com</a>';
        (document.body||document.documentElement).appendChild(bn);
      }catch(e){}
    }
  }

  if(document.readyState==='complete'||document.readyState==='interactive')init();
  else document.addEventListener('DOMContentLoaded',init);

  // 公開API (将来モデレーション・通報UIから利用)
  window.AninovelAntiPiracy={
    config:CONFIG,
    isOfficialHost:isOfficialHost,
    report:reportSuspicious,
    getCanary:function(){try{return sessionStorage.getItem('aninovel_canary');}catch(e){return null;}}
  };
})();
