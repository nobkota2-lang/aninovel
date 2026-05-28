/* ====================================================
 * AniNovel Server Save (v1.1.0)
 * 
 * v1.1: 内蔵の「保存」ボタンをフックしてサーバー保存に振替
 * - pub_ 作品で「保存」を押すと自動でサーバー保存
 * - 「💾 サーバー保存」フローティングボタンも併設
 * - 「📜 履歴」でバージョン復元
 * ==================================================== */

(function(){
  'use strict';
  
  var DEBUG = true;
  function log(){ if(DEBUG && console) console.log.apply(console, ['[ServerSave]'].concat([].slice.call(arguments))); }
  
  function getCurrentWorkId(){
    var params = new URLSearchParams(location.search);
    var w = params.get('work');
    if(w) return w;
    if(window.state){
      return window.state.currentWorkId || window.state.workId || window.state.publishedId || null;
    }
    return null;
  }
  
  // 作品 payload を構築（複数のデータソースに対応）
  function getWorkPayload(){
    var st = window.state;
    // 1. state から構築
    if(st && Array.isArray(st.content)){
      return {
        novel: st.novel,
        chapters: st.chapters,
        characters: st.characters,
        content: st.content,
        displaySettings: st.displaySettings,
        version: '2.2'
      };
    }
    // 2. localStorage の published_works から（フォールバック）
    try {
      var workId = getCurrentWorkId();
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId] && pw[workId].data && Array.isArray(pw[workId].data.content)){
        return pw[workId].data;
      }
    } catch(e){}
    return null;
  }
  
  // カタログ meta を取得
  function getCatalogMeta(){
    try {
      var workId = getCurrentWorkId();
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId]){
        return pw[workId].catalogEntry || null;
      }
    } catch(e){}
    return null;
  }
  
  // ========================================
  // サーバーに保存
  // ========================================
  async function saveToServer(silent){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      if(!silent) alert('この作品はサーバー保存の対象外です（公開作品 pub_ のみ）。\nID: ' + workId);
      return false;
    }
    
    var payload = getWorkPayload();
    if(!payload || !Array.isArray(payload.content)){
      if(!silent) alert('作品データを取得できませんでした。');
      return false;
    }
    
    var note = '';
    if(!silent){
      note = prompt('保存メモ（任意・履歴に表示）:', '');
      if(note === null) return false;
    }
    
    var btn = document.getElementById('srvSaveBtn');
    if(btn){ btn.textContent = '💾 保存中...'; btn.disabled = true; }
    
    try {
      var meta = getCatalogMeta();
      var body = { data: payload, note: note || '保存' };
      if(meta) body.meta = meta;
      
      var res = await fetch('/api/works/' + encodeURIComponent(workId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var result = await res.json();
      
      if(res.ok && result.ok){
        log('Saved:', result);
        if(!silent){
          alert('✅ サーバーに保存しました！\nバージョン履歴: ' + (result.versionCount || 0) + ' 件\n他の端末・ブラウザからも反映されます。');
        } else {
          showToast('✅ サーバーに保存しました');
        }
        return true;
      } else {
        if(!silent) alert('❌ 保存失敗: ' + (result.error || ('HTTP ' + res.status)));
        return false;
      }
    } catch(e) {
      log('Save error:', e);
      if(!silent) alert('❌ 通信エラー: ' + e.message);
      return false;
    } finally {
      if(btn){ btn.textContent = '💾 サーバー保存'; btn.disabled = false; }
    }
  }
  
  // 簡易トースト
  function showToast(msg){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:130px;right:16px;background:#10b981;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:10000;box-shadow:0 2px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(function(){t.remove();}, 500); }, 2500);
  }
  
  // ========================================
  // バージョン履歴
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
      var versions = (result.versions || []).slice().reverse();
      renderVersionModal(workId, versions);
    } catch(e) {
      alert('履歴取得失敗: ' + e.message);
    }
  }
  
  function renderVersionModal(workId, versions){
    var old = document.getElementById('srvVersionModal');
    if(old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'srvVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = function(e){ if(e.target === overlay) overlay.remove(); };
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;font-size:16px;font-weight:700">📜 バージョン履歴</h3><button id="srvVerClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>';
    if(versions.length === 0){
      html += '<p style="color:#666;text-align:center;padding:30px 0">まだ履歴がありません。<br>「保存」すると履歴が作られます。</p>';
    } else {
      html += '<p style="font-size:12px;color:#666;margin-bottom:12px">過去の保存に復元（最大20件）</p><div style="display:flex;flex-direction:column;gap:8px">';
      versions.forEach(function(v){
        var dtStr = new Date(v.savedAt).toLocaleString('ja-JP');
        html += '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">バージョン ' + v.version + '</div><div style="font-size:11px;color:#666">' + dtStr + '</div>' + (v.note ? '<div style="font-size:11px;color:#888;margin-top:2px">📝 ' + escapeHtml(v.note) + '</div>' : '') + '</div><button class="srvRestoreBtn" data-version="' + v.version + '" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap">復元</button></div>';
      });
      html += '</div>';
    }
    box.innerHTML = html;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('srvVerClose').onclick = function(){ overlay.remove(); };
    Array.from(box.querySelectorAll('.srvRestoreBtn')).forEach(function(btn){
      btn.onclick = function(){ restoreVersion(workId, parseInt(btn.getAttribute('data-version'), 10)); };
    });
  }
  
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  
  async function restoreVersion(workId, version){
    if(!confirm('バージョン ' + version + ' に復元しますか？\n※現在の内容は履歴に残ります。\n※復元後リロードします。')) return;
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?version=' + version);
      var result = await res.json();
      if(!result.data){ alert('取得失敗'); return; }
      var putRes = await fetch('/api/works/' + encodeURIComponent(workId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.data, note: 'v' + version + ' から復元' })
      });
      var putResult = await putRes.json();
      if(putRes.ok && putResult.ok){ alert('✅ 復元しました。リロードします。'); location.reload(); }
      else alert('復元失敗: ' + (putResult.error || '不明'));
    } catch(e) { alert('復元エラー: ' + e.message); }
  }
  
  // ========================================
  // 内蔵「保存」ボタンをフック
  // ========================================
  function hookNativeSaveButtons(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0) return;
    
    var buttons = document.querySelectorAll('button');
    buttons.forEach(function(btn){
      if(btn.dataset.srvHooked) return;
      var onclick = btn.getAttribute('onclick') || '';
      var text = (btn.textContent || '').trim();
      
      // saveData/saveMyWork を呼ぶ、またはテキストが「保存」のボタン
      var isSave = (onclick.indexOf('saveData') !== -1 || onclick.indexOf('saveMyWork') !== -1 || text === '保存' || text === '💾保存' || text === '💾 保存');
      var notOther = (text.indexOf('サーバー') === -1 && text.indexOf('公開') === -1 && text.indexOf('自動') === -1);
      
      if(isSave && notOther){
        btn.dataset.srvHooked = '1';
        // onclick 属性を無効化してサーバー保存に置き換え
        btn.removeAttribute('onclick');
        btn.onclick = function(e){
          e.preventDefault();
          log('Native save button clicked → server save');
          saveToServer(false);
          return false;
        };
        log('Hooked native save button:', text);
      }
    });
  }
  
  // ========================================
  // フローティングボタン設置
  // ========================================
  function setupButtons(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0) return;
    
    if(!document.getElementById('srvSaveContainer')){
      var container = document.createElement('div');
      container.id = 'srvSaveContainer';
      container.style.cssText = 'position:fixed;bottom:70px;right:16px;z-index:9998;display:flex;flex-direction:column;gap:8px';
      
      var saveBtn = document.createElement('button');
      saveBtn.id = 'srvSaveBtn';
      saveBtn.textContent = '💾 サーバー保存';
      saveBtn.style.cssText = 'background:#6366f1;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2)';
      saveBtn.onclick = function(){ saveToServer(false); };
      
      var histBtn = document.createElement('button');
      histBtn.id = 'srvHistBtn';
      histBtn.textContent = '📜 履歴';
      histBtn.style.cssText = 'background:#fff;color:#6366f1;border:1px solid #6366f1;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15)';
      histBtn.onclick = showVersionHistory;
      
      container.appendChild(saveBtn);
      container.appendChild(histBtn);
      document.body.appendChild(container);
      log('Floating buttons installed for:', workId);
    }
    
    // 内蔵保存ボタンもフック
    hookNativeSaveButtons();
  }
  
  function init(){
    if(document.body){
      setupButtons();
      setInterval(setupButtons, 2000); // render() でボタンが再生成されるので定期再フック
    } else {
      setTimeout(init, 100);
    }
  }
  
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  window.AniNovelServerSave = {
    save: function(){ return saveToServer(false); },
    showHistory: showVersionHistory,
    getWorkId: getCurrentWorkId,
    getPayload: getWorkPayload
  };
  
  log('Loaded v1.1.0');
})();
