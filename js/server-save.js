/* ====================================================
 * AniNovel Server Save (v1.3.0)
 * 
 * v1.3 変更点:
 * - 作者モードのみサーバー保存（state.isAuthorMode で判定）
 * - 「📜 履歴」ボタンを内蔵「保存」ボタンの隣にインライン配置
 * - フローティングボタン廃止
 * - 読者モード：右下に「💾 設定をPCに保存」「📁 設定を読込」（ローカルJSON）
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
  
  function isAuthorMode(){
    return !!(window.state && window.state.isAuthorMode);
  }
  
  function getWorkPayload(){
    var st = window.state;
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
    try {
      var workId = getCurrentWorkId();
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId] && pw[workId].data && Array.isArray(pw[workId].data.content)){
        return pw[workId].data;
      }
    } catch(e){}
    return null;
  }
  
  function getCatalogMeta(){
    try {
      var workId = getCurrentWorkId();
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId]) return pw[workId].catalogEntry || null;
    } catch(e){}
    return null;
  }
  
  function ensurePublishedWorksEntry(){
    try {
      var workId = getCurrentWorkId();
      if(!workId || workId.indexOf('pub_') !== 0) return;
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId]) return;
      var payload = getWorkPayload();
      if(!payload) return;
      pw[workId] = {
        catalogEntry: { id: workId, title: payload.novel ? payload.novel.title : '', author: payload.novel ? payload.novel.author : '' },
        data: payload,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('aninovel_published_works', JSON.stringify(pw));
      log('Filled published_works entry:', workId);
    } catch(e){ log('Fill error:', e); }
  }
  
  // ========================================
  // サーバー保存（作者モードのみ）
  // ========================================
  async function saveToServer(silent){
    if(!isAuthorMode()){
      if(!silent) alert('サーバー保存は作者モードでのみ可能です。');
      return false;
    }
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      if(!silent) alert('公開作品(pub_)のみサーバー保存可能です。');
      return false;
    }
    var payload = getWorkPayload();
    if(!payload || !Array.isArray(payload.content)){
      if(!silent) alert('作品データを取得できませんでした。');
      return false;
    }
    
    var note = '';
    if(!silent){
      note = prompt('保存メモ（任意）:', '');
      if(note === null) return false;
    }
    
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
        if(!silent) alert('✅ サーバーに保存しました！\nバージョン履歴: ' + (result.versionCount || 0) + ' 件');
        else showToast('✅ サーバー保存完了');
        return true;
      } else {
        if(!silent) alert('❌ 保存失敗: ' + (result.error || ('HTTP ' + res.status)));
        return false;
      }
    } catch(e) {
      if(!silent) alert('❌ 通信エラー: ' + e.message);
      return false;
    }
  }
  
  function showToast(msg, color){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:' + (color || '#10b981') + ';color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(function(){t.remove();}, 500); }, 2500);
  }
  
  // ========================================
  // バージョン履歴
  // ========================================
  async function showVersionHistory(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      alert('公開作品(pub_)のみ履歴があります。');
      return;
    }
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?versions=1');
      var result = await res.json();
      var versions = (result.versions || []).slice().reverse();
      renderVersionModal(workId, versions);
    } catch(e) { alert('履歴取得失敗: ' + e.message); }
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
      html += '<p style="color:#666;text-align:center;padding:30px 0">まだ履歴がありません。</p>';
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
    if(!confirm('バージョン ' + version + ' に復元しますか？\n復元後リロードします。')) return;
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
  // 内蔵保存ボタンをフック（作者モードのみ）
  // ========================================
  function hookNativeSaveButtons(){
    if(!isAuthorMode()) return; // 読者モードでは何もしない
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0) return;
    
    ensurePublishedWorksEntry();
    
    var buttons = document.querySelectorAll('button');
    buttons.forEach(function(btn){
      if(btn.dataset.srvHooked) return;
      var onclick = btn.getAttribute('onclick') || '';
      var text = (btn.textContent || '').trim();
      
      var isSave = (onclick.indexOf('saveData') !== -1 || 
                    onclick.indexOf('saveMyWork') !== -1 || 
                    text === '保存' || text === '💾保存' || text === '💾 保存');
      var notOther = (text.indexOf('サーバー') === -1 && 
                      text.indexOf('公開') === -1 && 
                      text.indexOf('自動') === -1);
      
      if(isSave && notOther){
        btn.dataset.srvHooked = '1';
        var origOnclick = onclick;
        btn.removeAttribute('onclick');
        btn.onclick = function(e){
          e.preventDefault();
          if(origOnclick){
            try { (new Function(origOnclick)).call(btn); } catch(err){ log('Native suppressed:', err.message); }
          }
          setTimeout(function(){ saveToServer(true); }, 150);
          return false;
        };
        // 履歴ボタンを隣に挿入
        insertHistoryButton(btn);
        log('Hooked save+inserted history:', text);
      }
    });
  }
  
  // 内蔵保存ボタンの隣に「📜」をインライン挿入
  function insertHistoryButton(saveBtn){
    if(!saveBtn || !saveBtn.parentNode) return;
    // 既にこの保存ボタンの隣に履歴がある？
    if(saveBtn.nextElementSibling && saveBtn.nextElementSibling.dataset.srvHist === '1') return;
    
    var histBtn = document.createElement('button');
    histBtn.dataset.srvHist = '1';
    histBtn.textContent = '📜';
    histBtn.title = 'バージョン履歴';
    // 保存ボタンのスタイルを継承（class）+ 履歴ボタン用調整
    histBtn.className = saveBtn.className || '';
    histBtn.style.cssText = (saveBtn.getAttribute('style') || '') + ';margin-left:6px;min-width:auto;padding:6px 10px';
    histBtn.onclick = function(e){
      e.preventDefault();
      showVersionHistory();
      return false;
    };
    saveBtn.parentNode.insertBefore(histBtn, saveBtn.nextSibling);
  }
  
  // ========================================
  // 読者モード：ローカルPC保存・読込
  // ========================================
  function getReaderSettings(){
    var st = window.state || {};
    return {
      readerCustom: st.readerCustom,
      readerCustomCharId: st.readerCustomCharId,
      readerProfileCurrent: st.readerProfileCurrent,
      readerProfileList: st.readerProfileList,
      darkMode: st.darkMode,
      displaySettings: st.displaySettings,
      bookmarks: st.bookmarks,
      workId: getCurrentWorkId(),
      savedAt: new Date().toISOString(),
      _appVersion: 'aninovel-reader-1.0'
    };
  }
  
  function saveReaderSettingsLocal(){
    var settings = getReaderSettings();
    var blob = new Blob([JSON.stringify(settings, null, 2)], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var workId = getCurrentWorkId() || 'unknown';
    var dtStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    a.download = 'aninovel-settings-' + workId + '-' + dtStr + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 100);
    showToast('💾 PCにダウンロードしました');
  }
  
  function loadReaderSettingsLocal(){
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.onchange = function(e){
      var file = e.target.files && e.target.files[0];
      if(!file){ input.remove(); return; }
      var reader = new FileReader();
      reader.onload = function(ev){
        try {
          var settings = JSON.parse(ev.target.result);
          if(!settings || !settings._appVersion){
            if(!confirm('このファイルは AniNovel の設定ファイルではない可能性があります。それでも読み込みますか？')) return;
          }
          // state に適用
          var st = window.state;
          if(st){
            ['readerCustom', 'readerCustomCharId', 'readerProfileCurrent', 'readerProfileList',
             'darkMode', 'displaySettings', 'bookmarks'].forEach(function(k){
              if(settings[k] !== undefined) st[k] = settings[k];
            });
          }
          // localStorage にも反映（読者プロファイル）
          try {
            if(settings.readerProfileList){
              localStorage.setItem('aninovel_reader_profiles', JSON.stringify(settings.readerProfileList));
            }
          } catch(e){}
          alert('✅ 設定を読み込みました。\nページをリロードして反映します。');
          location.reload();
        } catch(err){
          alert('❌ 読み込み失敗: ' + err.message);
        }
      };
      reader.readAsText(file);
      setTimeout(function(){ input.remove(); }, 1000);
    };
    document.body.appendChild(input);
    input.click();
  }
  
  // ========================================
  // ボタン配置
  // ========================================
  function setupButtons(){
    // モードに応じて切り替え
    var authorContainer = document.getElementById('srvAuthorFloating'); // v1.2の残骸があれば
    var readerContainer = document.getElementById('srvReaderContainer');
    var oldFloating = document.getElementById('srvSaveContainer');
    
    if(isAuthorMode()){
      // 作者モード：読者用ボタンを消す
      if(readerContainer) readerContainer.remove();
      if(oldFloating) oldFloating.remove();
      // 内蔵保存をフック（履歴ボタンも隣に挿入される）
      hookNativeSaveButtons();
    } else {
      // 読者モード：作者用ボタンを消す
      if(authorContainer) authorContainer.remove();
      if(oldFloating) oldFloating.remove();
      // 既にフックされた保存ボタンは元に戻す？（複雑なので維持）
      // 読者モード用ボタンを設置
      setupReaderButtons();
    }
  }
  
  function setupReaderButtons(){
    if(document.getElementById('srvReaderContainer')) return;
    
    var container = document.createElement('div');
    container.id = 'srvReaderContainer';
    container.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:9998;display:flex;flex-direction:column;gap:6px';
    
    var saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 設定をPCに保存';
    saveBtn.title = '読者の個人設定（ブックマーク・表示・キャラ設定など）を JSON でダウンロード';
    saveBtn.style.cssText = 'background:#fff;color:#6366f1;border:1px solid #6366f1;padding:8px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.12)';
    saveBtn.onclick = saveReaderSettingsLocal;
    
    var loadBtn = document.createElement('button');
    loadBtn.textContent = '📁 設定を読込';
    loadBtn.title = 'PC から設定 JSON を読み込み';
    loadBtn.style.cssText = saveBtn.style.cssText;
    loadBtn.onclick = loadReaderSettingsLocal;
    
    container.appendChild(saveBtn);
    container.appendChild(loadBtn);
    document.body.appendChild(container);
    log('Reader buttons installed');
  }
  
  // ========================================
  // 起動 + MutationObserver
  // ========================================
  var setupTimer = null;
  function debouncedSetup(){
    if(setupTimer) return;
    setupTimer = setTimeout(function(){ setupTimer = null; setupButtons(); }, 100);
  }
  
  function startObserver(){
    if(window._srvObserverStarted) return;
    window._srvObserverStarted = true;
    var observer = new MutationObserver(function(){ debouncedSetup(); });
    observer.observe(document.body, { childList: true, subtree: true });
    log('MutationObserver started');
  }
  
  function init(){
    if(!document.body){ setTimeout(init, 100); return; }
    setupButtons();
    startObserver();
    setInterval(setupButtons, 2000); // モード切替検出用フォールバック
  }
  
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  window.AniNovelServerSave = {
    save: function(){ return saveToServer(false); },
    saveQuiet: function(){ return saveToServer(true); },
    showHistory: showVersionHistory,
    saveLocal: saveReaderSettingsLocal,
    loadLocal: loadReaderSettingsLocal,
    getWorkId: getCurrentWorkId,
    isAuthor: isAuthorMode,
    getPayload: getWorkPayload
  };
  
  log('Loaded v1.3.0');
})();
