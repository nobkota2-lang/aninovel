/* ====================================================
 * AniNovel Server Save (v1.6.0)
 * 
 * v1.6 新機能:
 * - ☁ クラウド保存：読者設定をサーバーに保存（バージョン管理付き）
 * - 起動時の自動取得：ログインユーザーは最新の設定で開始
 * - 「📁 ギャラリーから選ぶ」ボタン：編集モーダルに追加
 * - 色変更後の render() 強制呼出（補助）
 * 
 * 作者モード：[💾 保存(緑)] [📤 公開保存(青)] [📜 履歴]
 * 読者モード：[💾 PC保存] [📁 PC読込] [☁ クラウド保存] [☁ クラウド読込] [📜 履歴]
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
  
  // ユーザーID取得
  function getCurrentUserId(){
    try {
      var u = JSON.parse(localStorage.getItem('aninovel_user') || 'null');
      if(u && u.id) return u.id;
      if(u && u.userId) return u.userId;
    } catch(e){}
    // フォールバック: state.user から
    if(window.state && window.state.user){
      return window.state.user.id || window.state.user.userId || null;
    }
    // my_works のキーから推測（user_xxx）
    try {
      var mw = JSON.parse(localStorage.getItem('aninovel_my_works') || '{}');
      var keys = Object.keys(mw);
      if(keys.length && keys[0].indexOf('user_') === 0) return keys[0];
    } catch(e){}
    return null;
  }
  
  // ========================================
  // 作品保存（既存）
  // ========================================
  function getWorkPayload(){
    var st = window.state;
    if(st && Array.isArray(st.content)){
      return { novel: st.novel, chapters: st.chapters, characters: st.characters, content: st.content, displaySettings: st.displaySettings, version: '2.2' };
    }
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
  async function saveToServer(silent){
    if(!isAuthorMode()){ if(!silent) alert('公開保存は作者モードのみ'); return false; }
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){ if(!silent) alert('公開作品(pub_)のみ可能'); return false; }
    var payload = getWorkPayload();
    if(!payload || !Array.isArray(payload.content)){ if(!silent) alert('作品データ取得失敗'); return false; }
    
    var note = '';
    if(!silent){
      note = prompt('保存メモ（任意）:', '');
      if(note === null) return false;
    }
    
    var btn = document.querySelector('[data-srv-publish]');
    var orig = btn ? btn.textContent : '';
    if(btn){ btn.textContent = '⏳ 公開中...'; btn.disabled = true; }
    
    try {
      var body = { data: payload, note: note || '公開保存' };
      var meta = getCatalogMeta(); if(meta) body.meta = meta;
      var res = await fetch('/api/works/' + encodeURIComponent(workId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      var result = await res.json();
      if(res.ok && result.ok){
        if(!silent) alert('✅ サーバー保存完了\nバージョン: ' + (result.versionCount || 0));
        else showToast('✅ 公開保存完了');
        return true;
      } else { if(!silent) alert('❌ 失敗: ' + (result.error || res.status)); return false; }
    } catch(e){ if(!silent) alert('❌ エラー: ' + e.message); return false; }
    finally { if(btn){ btn.textContent = orig || '📤 公開保存'; btn.disabled = false; } }
  }
  
  function showToast(msg, color){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:' + (color || '#10b981') + ';color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(function(){t.remove();}, 500); }, 2500);
  }
  
  // ========================================
  // 作品バージョン履歴
  // ========================================
  async function showWorkHistory(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){ alert('公開作品(pub_)のみ履歴があります'); return; }
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?versions=1');
      var result = await res.json();
      showHistoryModal('📜 作品バージョン履歴', (result.versions || []).slice().reverse(), function(version){ restoreWorkVersion(workId, version); });
    } catch(e){ alert('履歴取得失敗: ' + e.message); }
  }
  async function restoreWorkVersion(workId, version){
    if(!confirm('バージョン ' + version + ' に復元しますか？\n復元後リロードします。')) return;
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?version=' + version);
      var result = await res.json();
      if(!result.data){ alert('取得失敗'); return; }
      var putRes = await fetch('/api/works/' + encodeURIComponent(workId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: result.data, note: 'v'+version+' から復元' }) });
      var pr = await putRes.json();
      if(putRes.ok && pr.ok){ alert('✅ 復元完了。リロードします'); location.reload(); }
      else alert('失敗: ' + (pr.error || '不明'));
    } catch(e){ alert('エラー: ' + e.message); }
  }
  
  function showHistoryModal(title, versions, onRestore){
    var old = document.getElementById('srvVersionModal'); if(old) old.remove();
    var overlay = document.createElement('div'); overlay.id='srvVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
    var box = document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;font-size:16px;font-weight:700">' + escapeHtml(title) + '</h3><button id="srvVerClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>';
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
      btn.onclick = function(){ overlay.remove(); onRestore(parseInt(btn.getAttribute('data-version'),10)); };
    });
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  
  // ========================================
  // 作者ボタン挿入
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
    if(document.querySelector('[data-srv-publish]')) return;
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
    histBtn.onclick = function(e){ e.preventDefault(); showWorkHistory(); return false; };
    
    saveBtn.parentNode.insertBefore(pubBtn, saveBtn.nextSibling);
    saveBtn.parentNode.insertBefore(histBtn, pubBtn.nextSibling);
    log('Author buttons inserted');
  }
  
  // ========================================
  // 読者設定の収集・適用
  // ========================================
  function collectReaderSettings(){
    var st = window.state || {};
    var settings = {
      _appVersion: 'aninovel-reader-1.0',
      _savedAt: new Date().toISOString(),
      _workId: getCurrentWorkId(),
      state: {
        readerCustom: st.readerCustom,
        readerCustomCharId: st.readerCustomCharId,
        readerProfileCurrent: st.readerProfileCurrent,
        readerProfileList: st.readerProfileList,
        darkMode: st.darkMode,
        displaySettings: st.displaySettings,
        bookmarks: st.bookmarks,
      },
      localStorage: {}
    };
    ['aninovel_user', 'aninovel_reader_profiles', 'aninovel_data', 'aninovel_analytics_consent_v1'].forEach(function(k){
      var v = localStorage.getItem(k);
      if(v !== null) settings.localStorage[k] = v;
    });
    return settings;
  }
  function applyReaderSettings(settings){
    if(settings.localStorage){
      Object.keys(settings.localStorage).forEach(function(k){
        var v = settings.localStorage[k];
        if(v !== null && typeof v === 'string'){ try { localStorage.setItem(k, v); } catch(e){} }
      });
    }
    if(settings.state && window.state){
      ['readerCustom','readerCustomCharId','readerProfileCurrent','readerProfileList','darkMode','displaySettings','bookmarks'].forEach(function(k){
        if(settings.state[k] !== undefined) window.state[k] = settings.state[k];
      });
    }
    try { if(typeof window.render === 'function'){ window.render(); return true; } } catch(e){ log('render失敗:', e); }
    return false;
  }
  
  // PC 保存・読込
  function saveReaderSettingsLocal(){
    var s = collectReaderSettings();
    var blob = new Blob([JSON.stringify(s, null, 2)], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url;
    a.download = 'aninovel-settings-' + (getCurrentWorkId() || 'all') + '-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 100);
    showToast('💾 PCにダウンロード');
  }
  function loadReaderSettingsLocal(){
    var input = document.createElement('input');
    input.type='file'; input.accept='application/json,.json'; input.style.display='none';
    input.onchange = function(e){
      var file = e.target.files && e.target.files[0]; if(!file){ input.remove(); return; }
      var reader = new FileReader();
      reader.onload = function(ev){
        try {
          var s = JSON.parse(ev.target.result);
          if(!s._appVersion){ if(!confirm('AniNovel の設定ファイルではないかも。読込しますか?')) return; }
          var ok = applyReaderSettings(s);
          showToast(ok ? '✅ 設定を読み込みました' : '✅ localStorage 更新（リロード推奨）');
        } catch(err){ alert('❌ 読込失敗: ' + err.message); }
      };
      reader.readAsText(file);
      setTimeout(function(){ input.remove(); }, 1000);
    };
    document.body.appendChild(input); input.click();
  }
  
  // ========================================
  // ☁ クラウド保存・読込（新機能）
  // ========================================
  async function saveReaderSettingsCloud(silent){
    var userId = getCurrentUserId();
    if(!userId){
      if(!silent) alert('ログインが必要です。クラウド保存はログイン中のみ可能。');
      return false;
    }
    var settings = collectReaderSettings();
    var note = '';
    if(!silent){
      note = prompt('保存メモ（任意）:', '');
      if(note === null) return false;
    }
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(userId) + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: settings, note: note || '読者設定保存' })
      });
      var r = await res.json();
      if(res.ok && r.ok){
        if(!silent) alert('☁ クラウド保存完了\nバージョン: ' + (r.versionCount || 0) + '\n他端末からも自動取得されます');
        else showToast('☁ クラウド保存完了', '#0ea5e9');
        return true;
      } else { if(!silent) alert('❌ 失敗: ' + (r.error || res.status)); return false; }
    } catch(e){ if(!silent) alert('❌ エラー: ' + e.message); return false; }
  }
  async function loadReaderSettingsCloud(){
    var userId = getCurrentUserId();
    if(!userId){ alert('ログインが必要です'); return false; }
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(userId) + '/settings');
      if(res.status === 404){ alert('クラウドに設定がまだありません'); return false; }
      var settings = await res.json();
      var ok = applyReaderSettings(settings);
      showToast(ok ? '☁ 設定を読み込みました' : '☁ localStorage 更新（リロード推奨）', '#0ea5e9');
      return true;
    } catch(e){ alert('❌ エラー: ' + e.message); return false; }
  }
  async function showReaderHistory(){
    var userId = getCurrentUserId();
    if(!userId){ alert('ログインが必要です'); return; }
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(userId) + '/settings?versions=1');
      var result = await res.json();
      showHistoryModal('📜 設定バージョン履歴', (result.versions || []).slice().reverse(), async function(version){
        if(!confirm('バージョン ' + version + ' に復元しますか？')) return;
        var r2 = await fetch('/api/users/' + encodeURIComponent(userId) + '/settings?version=' + version);
        var d = await r2.json();
        if(!d.data){ alert('取得失敗'); return; }
        applyReaderSettings(d.data);
        showToast('✅ 復元しました', '#0ea5e9');
      });
    } catch(e){ alert('履歴取得失敗: ' + e.message); }
  }
  
  // 起動時の自動取得
  async function autoLoadOnStart(){
    if(window._srvAutoLoaded) return;
    window._srvAutoLoaded = true;
    if(isAuthorMode()) return; // 作者モードは対象外
    var userId = getCurrentUserId();
    if(!userId){ log('User not logged in, skip auto-load'); return; }
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(userId) + '/settings');
      if(res.status === 404){ log('Cloud settings not found for', userId); return; }
      var settings = await res.json();
      applyReaderSettings(settings);
      log('Auto-loaded cloud settings for', userId);
      showToast('☁ クラウドから設定を読込', '#0ea5e9');
    } catch(e){ log('Auto-load failed:', e); }
  }
  
  // ========================================
  // 読者ボタン挿入
  // ========================================
  function setupReaderButtons(){
    if(isAuthorMode()) return;
    if(document.getElementById('srvReaderInline')) return;
    var toolbar = document.querySelector('.toolbar');
    if(!toolbar) return;
    
    var container = document.createElement('div');
    container.id = 'srvReaderInline';
    container.style.cssText = 'display:inline-flex;gap:4px;align-items:center;margin-left:8px;flex-wrap:wrap';
    
    function mkBtn(text, title, onClick, color){
      var b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.className = 'btn';
      b.style.cssText = 'background:#fff;color:' + (color || '#6366f1') + ';border:1px solid ' + (color || '#6366f1') + ';padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600';
      b.onclick = onClick;
      return b;
    }
    
    container.appendChild(mkBtn('💾 PC保存', '個人設定をPCにJSON保存', saveReaderSettingsLocal));
    container.appendChild(mkBtn('📁 PC読込', 'PCから設定JSON読込', loadReaderSettingsLocal));
    
    var userId = getCurrentUserId();
    if(userId){
      container.appendChild(mkBtn('☁ クラウド保存', 'サーバーに保存（端末間同期）', function(){ saveReaderSettingsCloud(false); }, '#0ea5e9'));
      container.appendChild(mkBtn('☁ 読込', 'クラウドから設定を読込', loadReaderSettingsCloud, '#0ea5e9'));
      container.appendChild(mkBtn('📜', '設定の履歴', showReaderHistory, '#0ea5e9'));
    }
    
    toolbar.appendChild(container);
    log('Reader buttons inserted (logged-in=' + !!userId + ')');
  }
  
  // ========================================
  // 「📁 ギャラリーから選ぶ」を編集モーダルに挿入
  // ========================================
  function setupGalleryButtonInEditModal(){
    // 編集モーダルが開いている時
    if(!window.state || !window.state.editingItem) return;
    if(document.getElementById('srvGalBtnInEdit')) return;
    
    // 編集モーダル内の「画像選択」「アイコン」エリアを探す
    // 典型的に: <input type="file"> や、img をクリックする UI
    var modal = document.querySelector('.modal-overlay') || document.querySelector('[class*="edit"]');
    if(!modal) return;
    
    // 画像選択 input を探す
    var fileInputs = modal.querySelectorAll('input[type="file"][accept*="image"]');
    if(fileInputs.length === 0) return;
    
    var fileInput = fileInputs[0];
    var anchor = fileInput.parentNode;
    if(!anchor) return;
    
    var btn = document.createElement('button');
    btn.id = 'srvGalBtnInEdit';
    btn.type = 'button';
    btn.textContent = '🎨 ギャラリーから選ぶ';
    btn.className = 'btn';
    btn.style.cssText = 'background:#10b981;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-top:6px;margin-left:6px';
    btn.onclick = function(e){
      e.preventDefault();
      // ギャラリーモーダルを開く
      try {
        window.state.imageGalleryOpen = true;
        // editingItem.data.icon に反映するため、現在の編集対象を記憶
        window.state._galleryTarget = 'editingItem';
        if(typeof window.render === 'function') window.render();
        log('Gallery opened from edit modal');
      } catch(err){
        alert('ギャラリーを開けませんでした: ' + err.message);
      }
      return false;
    };
    anchor.appendChild(btn);
    log('Gallery button added in edit modal');
  }
  
  // ========================================
  // 古いボタンを削除
  // ========================================
  function removeOldFloating(){
    ['srvSaveContainer', 'srvReaderContainer', 'srvAuthorFloating'].forEach(function(id){
      var el = document.getElementById(id); if(el) el.remove();
    });
  }
  
  function setupAll(){
    removeOldFloating();
    if(isAuthorMode()){
      var r = document.getElementById('srvReaderInline'); if(r) r.remove();
      setupAuthorButtons();
    } else {
      ['data-srv-publish', 'data-srv-hist'].forEach(function(attr){
        document.querySelectorAll('[' + attr + ']').forEach(function(el){ el.remove(); });
      });
      setupReaderButtons();
    }
    // 編集モーダル用ボタン（両モード共通）
    setupGalleryButtonInEditModal();
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
    // 起動時にクラウドから読者設定を自動取得（少し遅延）
    setTimeout(autoLoadOnStart, 1500);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  
  // ========================================
  // 公開 API
  // ========================================
  window.AniNovelServerSave = {
    // 作品
    save: function(){ return saveToServer(false); },
    showHistory: showWorkHistory,
    // 読者 PC
    saveLocal: saveReaderSettingsLocal,
    loadLocal: loadReaderSettingsLocal,
    // 読者 クラウド
    saveCloud: function(){ return saveReaderSettingsCloud(false); },
    loadCloud: loadReaderSettingsCloud,
    showCloudHistory: showReaderHistory,
    autoLoad: autoLoadOnStart,
    // ユーティリティ
    getWorkId: getCurrentWorkId,
    getUserId: getCurrentUserId,
    isAuthor: isAuthorMode,
    getPayload: getWorkPayload,
    // デバッグ
    snapshotState: function(){ window._srvSnap = JSON.parse(JSON.stringify(window.state.characters)); console.log('[ServerSave] 色を変更してから diffState() を実行'); },
    diffState: function(){
      if(!window._srvSnap){ console.log('snapshotState() を先に'); return; }
      window.state.characters.forEach(function(c, i){
        var before = window._srvSnap[i]; if(!before){ console.log('[' + i + '] 新規'); return; }
        Object.keys(c).forEach(function(k){
          if(JSON.stringify(c[k]) !== JSON.stringify(before[k])){
            console.log('[' + i + '] ' + (c.name||c.id) + ': ' + k + ' =', before[k], '→', c[k]);
          }
        });
      });
    },
    showCharKeys: function(idx){
      var c = window.state.characters[idx || 0]; if(!c){ console.log('なし'); return; }
      console.log('keys:', Object.keys(c)); console.log(JSON.stringify(c, null, 2));
    },
    // 強制 render() （色変更が反映されない時用）
    forceRender: function(){ try { if(window.render) { window.render(); console.log('rendered'); } } catch(e){ console.log('err:', e); } }
  };
  
  log('Loaded v1.6.0');
})();
