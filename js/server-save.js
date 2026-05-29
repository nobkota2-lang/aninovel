/* ====================================================
 * AniNovel Server Save (v1.5.0)
 * 
 * v1.5 変更点（修正）:
 * - 読込で reload() しない → モード変更を防ぐ
 * - state + localStorage 両方を保存/復元
 * - isAuthorMode は絶対に変更しない
 * - render() を呼んで即座に画面反映
 * ==================================================== */

(function(){
  'use strict';
  
  var DEBUG = true;
  function log(){ if(DEBUG && console) console.log.apply(console, ['[ServerSave]'].concat([].slice.call(arguments))); }
  
  function getCurrentWorkId(){
    var params = new URLSearchParams(location.search);
    return params.get('work') || (window.state && (window.state.currentWorkId || window.state.workId)) || null;
  }
  
  function isAuthorMode(){ return !!(window.state && window.state.isAuthorMode); }
  
  function getWorkPayload(){
    var st = window.state;
    if(st && Array.isArray(st.content)){
      return { novel: st.novel, chapters: st.chapters, characters: st.characters, content: st.content, displaySettings: st.displaySettings, version: '2.2' };
    }
    try {
      var workId = getCurrentWorkId();
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId] && pw[workId].data && Array.isArray(pw[workId].data.content)) return pw[workId].data;
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
  
  // ========================================
  // サーバー保存（公開保存）
  // ========================================
  async function saveToServer(silent){
    if(!isAuthorMode()){ if(!silent) alert('公開保存は作者モードでのみ可能です。'); return false; }
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      if(!silent) alert('公開作品(pub_)のみ公開保存可能です。');
      return false;
    }
    var payload = getWorkPayload();
    if(!payload || !Array.isArray(payload.content)){ if(!silent) alert('作品データを取得できませんでした。'); return false; }
    
    var note = '';
    if(!silent){
      note = prompt('保存メモ（任意・履歴に表示）:', '');
      if(note === null) return false;
    }
    
    var btn = document.querySelector('[data-srv-publish]');
    var orig = btn ? btn.textContent : '';
    if(btn){ btn.textContent = '⏳ 公開中...'; btn.disabled = true; }
    
    try {
      var body = { data: payload, note: note || '公開保存' };
      var meta = getCatalogMeta();
      if(meta) body.meta = meta;
      var res = await fetch('/api/works/' + encodeURIComponent(workId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      var result = await res.json();
      if(res.ok && result.ok){
        if(!silent) alert('✅ サーバーに公開保存しました！\nバージョン履歴: ' + (result.versionCount || 0) + ' 件');
        else showToast('✅ 公開保存完了');
        return true;
      } else {
        if(!silent) alert('❌ 公開失敗: ' + (result.error || ('HTTP ' + res.status)));
        return false;
      }
    } catch(e) {
      if(!silent) alert('❌ 通信エラー: ' + e.message);
      return false;
    } finally {
      if(btn){ btn.textContent = orig || '📤 公開保存'; btn.disabled = false; }
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
  // 履歴
  // ========================================
  async function showVersionHistory(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){ alert('公開作品(pub_)のみ履歴があります。'); return; }
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?versions=1');
      var result = await res.json();
      renderVersionModal(workId, (result.versions || []).slice().reverse());
    } catch(e) { alert('履歴取得失敗: ' + e.message); }
  }
  function renderVersionModal(workId, versions){
    var old = document.getElementById('srvVersionModal'); if(old) old.remove();
    var overlay = document.createElement('div'); overlay.id='srvVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
    var box = document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;font-size:16px;font-weight:700">📜 バージョン履歴</h3><button id="srvVerClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>';
    if(versions.length===0) html += '<p style="color:#666;text-align:center;padding:30px 0">まだ履歴がありません。</p>';
    else {
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      versions.forEach(function(v){
        var dtStr = new Date(v.savedAt).toLocaleString('ja-JP');
        html += '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="flex:1"><div style="font-weight:600;font-size:13px">バージョン ' + v.version + '</div><div style="font-size:11px;color:#666">' + dtStr + '</div>' + (v.note?'<div style="font-size:11px;color:#888;margin-top:2px">📝 ' + escapeHtml(v.note) + '</div>':'') + '</div><button class="srvRestoreBtn" data-version="' + v.version + '" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer">復元</button></div>';
      });
      html += '</div>';
    }
    box.innerHTML = html; overlay.appendChild(box); document.body.appendChild(overlay);
    document.getElementById('srvVerClose').onclick = function(){ overlay.remove(); };
    Array.from(box.querySelectorAll('.srvRestoreBtn')).forEach(function(btn){
      btn.onclick = function(){ restoreVersion(workId, parseInt(btn.getAttribute('data-version'),10)); };
    });
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  async function restoreVersion(workId, version){
    if(!confirm('バージョン ' + version + ' に復元しますか？\n復元後リロードします。')) return;
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?version=' + version);
      var result = await res.json();
      if(!result.data){ alert('取得失敗'); return; }
      var putRes = await fetch('/api/works/' + encodeURIComponent(workId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: result.data, note: 'v'+version+' から復元' }) });
      var putResult = await putRes.json();
      if(putRes.ok && putResult.ok){ alert('✅ 復元しました。リロードします。'); location.reload(); }
      else alert('復元失敗: ' + (putResult.error || '不明'));
    } catch(e) { alert('復元エラー: ' + e.message); }
  }
  
  // ========================================
  // 作者モード：ボタン挿入
  // ========================================
  function findNativeSaveButton(){
    var buttons = document.querySelectorAll('button');
    for(var i=0; i<buttons.length; i++){
      var btn = buttons[i];
      var onclick = btn.getAttribute('onclick') || '';
      var text = (btn.textContent || '').trim();
      if((onclick === 'saveData()' || onclick.indexOf('saveData') !== -1 || text === '💾 保存' || text === '保存') 
         && text.indexOf('サーバー') === -1 && text.indexOf('公開') === -1){
        return btn;
      }
    }
    return null;
  }
  function setupAuthorButtons(){
    if(!isAuthorMode()) return;
    var existingPub = document.querySelector('[data-srv-publish]');
    if(existingPub && document.contains(existingPub)) return;
    var saveBtn = findNativeSaveButton();
    if(!saveBtn || !saveBtn.parentNode) return;
    
    var pubBtn = document.createElement('button');
    pubBtn.setAttribute('data-srv-publish', '1');
    pubBtn.textContent = '📤 公開保存';
    pubBtn.title = 'サーバーに保存して公開';
    pubBtn.className = saveBtn.className || 'btn';
    pubBtn.style.cssText = 'background:#6366f1;color:#fff;padding:6px 12px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;margin-left:4px';
    pubBtn.onclick = function(e){ e.preventDefault(); saveToServer(false); return false; };
    
    var histBtn = document.createElement('button');
    histBtn.setAttribute('data-srv-hist', '1');
    histBtn.textContent = '📜';
    histBtn.title = 'バージョン履歴';
    histBtn.className = saveBtn.className || 'btn';
    histBtn.style.cssText = 'background:#fff;color:#6366f1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid #6366f1;cursor:pointer;margin-left:4px';
    histBtn.onclick = function(e){ e.preventDefault(); showVersionHistory(); return false; };
    
    saveBtn.parentNode.insertBefore(pubBtn, saveBtn.nextSibling);
    saveBtn.parentNode.insertBefore(histBtn, pubBtn.nextSibling);
    log('Author buttons inserted');
  }
  
  // ========================================
  // 読者モード：保存/読込（v1.5 修正版）
  // 重要: isAuthorMode は絶対に変更しない、reload() しない
  // ========================================
  
  // 読者個人設定を全て収集（state + 関連localStorage）
  function collectReaderSettings(){
    var st = window.state || {};
    var settings = {
      _appVersion: 'aninovel-reader-1.0',
      _savedAt: new Date().toISOString(),
      _workId: getCurrentWorkId(),
      // state からのデータ
      state: {
        readerCustom: st.readerCustom,
        readerCustomCharId: st.readerCustomCharId,
        readerProfileCurrent: st.readerProfileCurrent,
        readerProfileList: st.readerProfileList,
        darkMode: st.darkMode,
        displaySettings: st.displaySettings,
        bookmarks: st.bookmarks,
      },
      // localStorage からのデータ（読者個人設定キーのみ）
      localStorage: {}
    };
    // 読者設定に関連するキーのみ
    var readerKeys = ['aninovel_user', 'aninovel_reader_profiles', 'aninovel_data', 'aninovel_analytics_consent_v1'];
    readerKeys.forEach(function(k){
      var v = localStorage.getItem(k);
      if(v !== null) settings.localStorage[k] = v;
    });
    return settings;
  }
  
  // 読者設定を適用（isAuthorMode は絶対に変えない）
  function applyReaderSettings(settings){
    // 1. localStorage を更新（永続化）
    if(settings.localStorage){
      Object.keys(settings.localStorage).forEach(function(k){
        var v = settings.localStorage[k];
        if(v !== null && v !== undefined && typeof v === 'string'){
          try { localStorage.setItem(k, v); } catch(e){ log('localStorage set失敗:', k, e); }
        }
      });
    }
    // 2. state を更新（isAuthorMode は絶対除外）
    if(settings.state && window.state){
      var safeKeys = ['readerCustom', 'readerCustomCharId', 'readerProfileCurrent', 
                      'readerProfileList', 'darkMode', 'displaySettings', 'bookmarks'];
      safeKeys.forEach(function(k){
        if(settings.state[k] !== undefined){
          window.state[k] = settings.state[k];
        }
      });
    }
    // 3. 再描画（reload() の代わり）
    try {
      if(typeof window.render === 'function'){
        window.render();
        log('Re-rendered');
        return true;
      }
    } catch(e){ log('render() 失敗:', e); }
    return false;
  }
  
  function saveReaderSettingsLocal(){
    var settings = collectReaderSettings();
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
            if(!confirm('AniNovel の設定ファイルではない可能性があります。それでも読み込みますか？')) return;
          }
          // 適用（reload しない、モード変更しない）
          var rendered = applyReaderSettings(settings);
          if(rendered){
            alert('✅ 設定を読み込みました。\n画面に反映されています。\n（必要なら画面の操作でさらに反映してください）');
          } else {
            // render() が失敗した場合のみリロードを提案（モード維持のため確認）
            if(confirm('✅ 設定を localStorage に保存しました。\n完全反映のため、リロードしますか？\n（読者モードを維持したい場合は「いいえ」）')){
              location.reload();
            }
          }
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
  
  function setupReaderButtons(){
    if(isAuthorMode()) return;
    var existing = document.getElementById('srvReaderInline');
    if(existing && document.contains(existing)) return;
    var toolbar = document.querySelector('.toolbar');
    if(!toolbar) return;
    
    var container = document.createElement('div');
    container.id = 'srvReaderInline';
    container.style.cssText = 'display:inline-flex;gap:4px;align-items:center;margin-left:8px';
    
    var saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 設定保存';
    saveBtn.title = '個人設定を PC に JSON 保存';
    saveBtn.className = 'btn';
    saveBtn.style.cssText = 'background:#fff;color:#6366f1;border:1px solid #6366f1;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600';
    saveBtn.onclick = saveReaderSettingsLocal;
    
    var loadBtn = document.createElement('button');
    loadBtn.textContent = '📁 読込';
    loadBtn.title = 'PC から設定 JSON を読込';
    loadBtn.className = 'btn';
    loadBtn.style.cssText = saveBtn.style.cssText;
    loadBtn.onclick = loadReaderSettingsLocal;
    
    container.appendChild(saveBtn);
    container.appendChild(loadBtn);
    toolbar.appendChild(container);
    log('Reader buttons inserted into .toolbar');
  }
  
  function removeOldFloating(){
    ['srvSaveContainer', 'srvReaderContainer', 'srvAuthorFloating'].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.remove();
    });
  }
  
  function setupAll(){
    removeOldFloating();
    if(isAuthorMode()){
      var r = document.getElementById('srvReaderInline');
      if(r) r.remove();
      setupAuthorButtons();
    } else {
      ['data-srv-publish', 'data-srv-hist'].forEach(function(attr){
        document.querySelectorAll('[' + attr + ']').forEach(function(el){ el.remove(); });
      });
      setupReaderButtons();
    }
  }
  
  var setupTimer = null;
  function debouncedSetup(){ if(setupTimer) return; setupTimer = setTimeout(function(){ setupTimer=null; setupAll(); }, 100); }
  function startObserver(){
    if(window._srvObserverStarted) return;
    window._srvObserverStarted = true;
    var observer = new MutationObserver(debouncedSetup);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function init(){
    if(!document.body){ setTimeout(init, 100); return; }
    setupAll();
    startObserver();
    setInterval(setupAll, 2000);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  
  window.AniNovelServerSave = {
    save: function(){ return saveToServer(false); },
    showHistory: showVersionHistory,
    saveLocal: saveReaderSettingsLocal,
    loadLocal: loadReaderSettingsLocal,
    getWorkId: getCurrentWorkId,
    isAuthor: isAuthorMode,
    getPayload: getWorkPayload,
    // デバッグ用
    snapshotState: function(){
      window._srvSnap = JSON.parse(JSON.stringify(window.state.characters));
      console.log('[ServerSave] スナップショット保存。色を変更してから diffState() を実行');
    },
    diffState: function(){
      if(!window._srvSnap){ console.log('先に snapshotState() を実行してください'); return; }
      console.log('=== スナップショット以降の変化 ===');
      window.state.characters.forEach(function(c, i){
        var before = window._srvSnap[i];
        if(!before){ console.log('[' + i + '] 新規'); return; }
        Object.keys(c).forEach(function(k){
          if(JSON.stringify(c[k]) !== JSON.stringify(before[k])){
            console.log('[' + i + '] ' + (c.name||c.id) + ': ' + k + ' =', before[k], '→', c[k]);
          }
        });
      });
    },
    // デバッグ用：state.characters[N] の全キー
    showCharKeys: function(idx){
      var c = window.state.characters[idx || 0];
      if(!c){ console.log('characters[' + idx + '] なし'); return; }
      console.log('keys:', Object.keys(c));
      console.log('内容:', JSON.stringify(c, null, 2));
    }
  };
  
  log('Loaded v1.5.0');
})();
