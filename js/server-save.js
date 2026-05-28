/* ====================================================
 * AniNovel Server Save (v1.0.0)
 * 
 * 作者が作品をサーバー(Cloudflare KV)に保存する機能。
 * - 「💾 サーバー保存」ボタン
 * - 「📜 バージョン履歴」ボタン（過去20版まで復元可能）
 * 
 * 配置: /js/server-save.js
 * 読み込み: viewer.html の </body> 直前に
 *   <script src="js/server-save.js"></script>
 * 
 * pub_ で始まる作品を表示中のみボタンを表示する。
 * ==================================================== */

(function(){
  'use strict';
  
  var DEBUG = true;
  function log(){ if(DEBUG && console) console.log.apply(console, ['[ServerSave]'].concat([].slice.call(arguments))); }
  
  // ========================================
  // 現在の作品 ID を取得
  // ========================================
  function getCurrentWorkId(){
    var params = new URLSearchParams(location.search);
    var w = params.get('work');
    if(w) return w;
    // state からも試す
    if(window.state){
      return window.state.currentWorkId || window.state.workId || window.state.publishedId || null;
    }
    return null;
  }
  
  // ========================================
  // 作品データ payload を構築
  // ========================================
  function getWorkPayload(){
    var st = window.state;
    if(!st) return null;
    return {
      novel: st.novel,
      chapters: st.chapters,
      characters: st.characters,
      content: st.content,
      displaySettings: st.displaySettings,
      version: '2.2'
    };
  }
  
  // ========================================
  // サーバーに保存
  // ========================================
  async function saveToServer(){
    var workId = getCurrentWorkId();
    if(!workId){
      alert('作品IDが取得できません。');
      return;
    }
    if(workId.indexOf('pub_') !== 0){
      alert('この作品はサーバー保存の対象外です。\n（公開作品 pub_ のみ対応）\n\n現在のID: ' + workId);
      return;
    }
    
    var payload = getWorkPayload();
    if(!payload || !Array.isArray(payload.content)){
      alert('作品データを取得できませんでした。');
      return;
    }
    
    var note = prompt('保存メモ（任意・バージョン履歴に表示されます）:', '');
    if(note === null) return; // キャンセル
    
    var btn = document.getElementById('srvSaveBtn');
    if(btn){ btn.textContent = '💾 保存中...'; btn.disabled = true; }
    
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload, note: note })
      });
      var result = await res.json();
      
      if(res.ok && result.ok){
        log('Saved:', result);
        alert('✅ サーバーに保存しました！\n\nバージョン履歴: ' + (result.versionCount || 0) + ' 件\n他のユーザーや別の端末からも反映されます。');
      } else {
        alert('❌ 保存失敗: ' + (result.error || ('HTTP ' + res.status)));
      }
    } catch(e) {
      log('Save error:', e);
      alert('❌ 通信エラー: ' + e.message);
    } finally {
      if(btn){ btn.textContent = '💾 サーバー保存'; btn.disabled = false; }
    }
  }
  
  // ========================================
  // バージョン履歴を表示
  // ========================================
  async function showVersionHistory(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      alert('公開作品(pub_)のみバージョン履歴があります。');
      return;
    }
    
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?versions=1');
      var result = await res.json();
      var versions = (result.versions || []).slice().reverse(); // 新しい順
      
      renderVersionModal(workId, versions);
    } catch(e) {
      alert('履歴の取得に失敗しました: ' + e.message);
    }
  }
  
  // バージョン履歴モーダルを描画
  function renderVersionModal(workId, versions){
    // 既存モーダルを除去
    var old = document.getElementById('srvVersionModal');
    if(old) old.remove();
    
    var overlay = document.createElement('div');
    overlay.id = 'srvVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = function(e){ if(e.target === overlay) overlay.remove(); };
    
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.3)';
    
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h3 style="margin:0;font-size:16px;font-weight:700">📜 バージョン履歴</h3>'
      + '<button id="srvVerClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666">✕</button></div>';
    
    if(versions.length === 0){
      html += '<p style="color:#666;text-align:center;padding:30px 0">まだ履歴がありません。<br>「💾 サーバー保存」で保存すると履歴が作られます。</p>';
    } else {
      html += '<p style="font-size:12px;color:#666;margin-bottom:12px">過去の保存内容に復元できます（最大20件保持）</p>';
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      versions.forEach(function(v){
        var dt = new Date(v.savedAt);
        var dtStr = dt.toLocaleString('ja-JP');
        html += '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px">'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:13px">バージョン ' + v.version + '</div>'
          + '<div style="font-size:11px;color:#666">' + dtStr + '</div>'
          + (v.note ? '<div style="font-size:11px;color:#888;margin-top:2px">📝 ' + escapeHtml(v.note) + '</div>' : '')
          + '</div>'
          + '<button class="srvRestoreBtn" data-version="' + v.version + '" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap">復元</button>'
          + '</div>';
      });
      html += '</div>';
    }
    
    box.innerHTML = html;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    document.getElementById('srvVerClose').onclick = function(){ overlay.remove(); };
    
    // 復元ボタン
    Array.from(box.querySelectorAll('.srvRestoreBtn')).forEach(function(btn){
      btn.onclick = function(){
        var ver = parseInt(btn.getAttribute('data-version'), 10);
        restoreVersion(workId, ver);
      };
    });
  }
  
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  
  // 特定バージョンに復元
  async function restoreVersion(workId, version){
    if(!confirm('バージョン ' + version + ' に復元しますか？\n\n※現在の内容は新しいバージョンとして履歴に残ります。\n※復元後、画面をリロードします。')){
      return;
    }
    
    try {
      // 1. 指定バージョンのデータを取得
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?version=' + version);
      var result = await res.json();
      if(!result.data){
        alert('バージョンデータの取得に失敗しました。');
        return;
      }
      
      // 2. それを最新版として保存（PUT）
      var putRes = await fetch('/api/works/' + encodeURIComponent(workId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.data, note: 'v' + version + ' から復元' })
      });
      var putResult = await putRes.json();
      
      if(putRes.ok && putResult.ok){
        alert('✅ バージョン ' + version + ' に復元しました。\nページをリロードします。');
        location.reload();
      } else {
        alert('復元失敗: ' + (putResult.error || '不明'));
      }
    } catch(e) {
      alert('復元エラー: ' + e.message);
    }
  }
  
  // ========================================
  // フローティングボタンを設置
  // ========================================
  function setupButtons(){
    var workId = getCurrentWorkId();
    // pub_ 作品のみボタン表示
    if(!workId || workId.indexOf('pub_') !== 0){
      log('Not a pub_ work, buttons hidden. workId:', workId);
      return;
    }
    
    if(document.getElementById('srvSaveContainer')) return; // 既に設置済み
    
    var container = document.createElement('div');
    container.id = 'srvSaveContainer';
    container.style.cssText = 'position:fixed;bottom:70px;right:16px;z-index:9998;display:flex;flex-direction:column;gap:8px';
    
    var saveBtn = document.createElement('button');
    saveBtn.id = 'srvSaveBtn';
    saveBtn.textContent = '💾 サーバー保存';
    saveBtn.style.cssText = 'background:#6366f1;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2)';
    saveBtn.onclick = saveToServer;
    
    var histBtn = document.createElement('button');
    histBtn.id = 'srvHistBtn';
    histBtn.textContent = '📜 履歴';
    histBtn.style.cssText = 'background:#fff;color:#6366f1;border:1px solid #6366f1;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15)';
    histBtn.onclick = showVersionHistory;
    
    container.appendChild(saveBtn);
    container.appendChild(histBtn);
    document.body.appendChild(container);
    
    log('Buttons installed for work:', workId);
  }
  
  function init(){
    if(document.body){
      setupButtons();
      // SPAでURL変化に対応（念のため定期チェック）
      setInterval(setupButtons, 3000);
    } else {
      setTimeout(init, 100);
    }
  }
  
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // デバッグ用公開
  window.AniNovelServerSave = {
    save: saveToServer,
    showHistory: showVersionHistory,
    getWorkId: getCurrentWorkId,
    getPayload: getWorkPayload
  };
  
  log('Loaded v1.0.0');
})();
