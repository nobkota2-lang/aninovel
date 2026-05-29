/* ====================================================
 * AniNovel Server Save (v1.7.0)
 * 
 * v1.7 修正:
 * - 読者カスタムモーダルに「🎨 ギャラリーから選ぶ」ボタンを正しく挿入
 * - ギャラリー画像クリックを capture でフック → 読者モードなら readerCustom に反映
 * - 画像アップロード時、作者モードに著作権警告
 * - forceReset(): 「作者推奨に戻す」が効かない時の強制リセット
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
  function getCurrentUserId(){
    try { var u = JSON.parse(localStorage.getItem('aninovel_user') || 'null'); if(u && (u.id || u.userId)) return u.id || u.userId; } catch(e){}
    if(window.state && window.state.user) return window.state.user.id || window.state.user.userId || null;
    try { var mw = JSON.parse(localStorage.getItem('aninovel_my_works') || '{}'); var keys = Object.keys(mw); if(keys.length && keys[0].indexOf('user_')===0) return keys[0]; } catch(e){}
    return null;
  }
  
  function getWorkPayload(){
    var st = window.state;
    if(st && Array.isArray(st.content)) return { novel: st.novel, chapters: st.chapters, characters: st.characters, content: st.content, displaySettings: st.displaySettings, version: '2.2' };
    return null;
  }
  function getCatalogMeta(){
    try { var workId = getCurrentWorkId(); var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}'); if(pw[workId]) return pw[workId].catalogEntry || null; } catch(e){}
    return null;
  }
  
  // ========================================
  // 作品保存（既存）
  // ========================================
  async function saveToServer(silent){
    if(!isAuthorMode()){ if(!silent) alert('公開保存は作者モードのみ'); return false; }
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){ if(!silent) alert('公開作品(pub_)のみ可能'); return false; }
    var payload = getWorkPayload();
    if(!payload){ if(!silent) alert('作品データ取得失敗'); return false; }
    var note = silent ? '' : prompt('保存メモ:', '');
    if(!silent && note === null) return false;
    var btn = document.querySelector('[data-srv-publish]');
    var orig = btn ? btn.textContent : '';
    if(btn){ btn.textContent = '⏳ 公開中...'; btn.disabled = true; }
    try {
      var body = { data: payload, note: note || '公開保存' };
      var meta = getCatalogMeta(); if(meta) body.meta = meta;
      var res = await fetch('/api/works/' + encodeURIComponent(workId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      var r = await res.json();
      if(res.ok && r.ok){ if(!silent) alert('✅ サーバー保存完了\nバージョン: ' + (r.versionCount || 0)); else showToast('✅ 公開保存完了'); return true; }
      else { if(!silent) alert('❌ 失敗: ' + (r.error || res.status)); return false; }
    } catch(e){ if(!silent) alert('❌ ' + e.message); return false; }
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
  // 履歴
  // ========================================
  async function showWorkHistory(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){ alert('公開作品(pub_)のみ'); return; }
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?versions=1');
      var r = await res.json();
      showHistoryModal('📜 作品バージョン履歴', (r.versions || []).slice().reverse(), function(v){ restoreWorkVersion(workId, v); });
    } catch(e){ alert('履歴失敗: ' + e.message); }
  }
  async function restoreWorkVersion(workId, version){
    if(!confirm('v' + version + ' に復元しますか？')) return;
    try {
      var res = await fetch('/api/works/' + encodeURIComponent(workId) + '?version=' + version);
      var d = await res.json();
      if(!d.data){ alert('取得失敗'); return; }
      var pr = await fetch('/api/works/' + encodeURIComponent(workId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: d.data, note: 'v'+version+' 復元' }) });
      var p = await pr.json();
      if(pr.ok && p.ok){ alert('✅ 復元完了。リロードします'); location.reload(); }
    } catch(e){ alert('err: ' + e.message); }
  }
  function showHistoryModal(title, versions, onRestore){
    var old = document.getElementById('srvVersionModal'); if(old) old.remove();
    var overlay = document.createElement('div'); overlay.id='srvVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
    var box = document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;font-size:16px;font-weight:700">' + escapeHtml(title) + '</h3><button id="srvVerClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>';
    if(versions.length===0) html += '<p style="color:#666;text-align:center;padding:30px 0">履歴なし</p>';
    else { html += '<div style="display:flex;flex-direction:column;gap:8px">'; versions.forEach(function(v){
      var dtStr = new Date(v.savedAt).toLocaleString('ja-JP');
      html += '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="flex:1"><div style="font-weight:600;font-size:13px">v' + v.version + '</div><div style="font-size:11px;color:#666">' + dtStr + '</div>' + (v.note?'<div style="font-size:11px;color:#888;margin-top:2px">📝 ' + escapeHtml(v.note) + '</div>':'') + '</div><button class="srvRestoreBtn" data-version="' + v.version + '" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer">復元</button></div>';
    }); html += '</div>'; }
    box.innerHTML = html; overlay.appendChild(box); document.body.appendChild(overlay);
    document.getElementById('srvVerClose').onclick = function(){ overlay.remove(); };
    Array.from(box.querySelectorAll('.srvRestoreBtn')).forEach(function(btn){ btn.onclick = function(){ overlay.remove(); onRestore(parseInt(btn.getAttribute('data-version'),10)); }; });
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  
  // ========================================
  // 作者ボタン
  // ========================================
  function findNativeSaveButton(){
    var buttons = document.querySelectorAll('button');
    for(var i=0; i<buttons.length; i++){
      var btn = buttons[i];
      var onclick = btn.getAttribute('onclick') || '';
      var text = (btn.textContent || '').trim();
      if((onclick === 'saveData()' || onclick.indexOf('saveData') !== -1 || text === '💾 保存' || text === '保存') && text.indexOf('サーバー')===-1 && text.indexOf('公開')===-1) return btn;
    }
    return null;
  }
  function setupAuthorButtons(){
    if(!isAuthorMode()) return;
    if(document.querySelector('[data-srv-publish]')) return;
    var saveBtn = findNativeSaveButton(); if(!saveBtn || !saveBtn.parentNode) return;
    var pubBtn = document.createElement('button');
    pubBtn.setAttribute('data-srv-publish','1');
    pubBtn.textContent = '📤 公開保存'; pubBtn.title='サーバーに保存して公開';
    pubBtn.className = saveBtn.className || 'btn';
    pubBtn.style.cssText = 'background:#6366f1;color:#fff;padding:6px 12px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;margin-left:4px';
    pubBtn.onclick = function(e){ e.preventDefault(); saveToServer(false); return false; };
    var histBtn = document.createElement('button');
    histBtn.setAttribute('data-srv-hist','1');
    histBtn.textContent = '📜'; histBtn.title='バージョン履歴';
    histBtn.className = saveBtn.className || 'btn';
    histBtn.style.cssText = 'background:#fff;color:#6366f1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid #6366f1;cursor:pointer;margin-left:4px';
    histBtn.onclick = function(e){ e.preventDefault(); showWorkHistory(); return false; };
    saveBtn.parentNode.insertBefore(pubBtn, saveBtn.nextSibling);
    saveBtn.parentNode.insertBefore(histBtn, pubBtn.nextSibling);
  }
  
  // ========================================
  // 読者設定の収集・適用・PC保存・読込・クラウド保存・読込
  // ========================================
  function collectReaderSettings(){
    var st = window.state || {};
    var s = { _appVersion:'aninovel-reader-1.0', _savedAt:new Date().toISOString(), _workId:getCurrentWorkId(),
      state: { readerCustom:st.readerCustom, readerCustomCharId:st.readerCustomCharId, readerProfileCurrent:st.readerProfileCurrent, readerProfileList:st.readerProfileList, darkMode:st.darkMode, displaySettings:st.displaySettings, bookmarks:st.bookmarks },
      localStorage: {} };
    ['aninovel_user','aninovel_reader_profiles','aninovel_data','aninovel_analytics_consent_v1'].forEach(function(k){ var v=localStorage.getItem(k); if(v!==null) s.localStorage[k]=v; });
    return s;
  }
  function applyReaderSettings(settings){
    if(settings.localStorage) Object.keys(settings.localStorage).forEach(function(k){ var v=settings.localStorage[k]; if(typeof v==='string') try{ localStorage.setItem(k,v); }catch(e){} });
    if(settings.state && window.state) ['readerCustom','readerCustomCharId','readerProfileCurrent','readerProfileList','darkMode','displaySettings','bookmarks'].forEach(function(k){ if(settings.state[k]!==undefined) window.state[k]=settings.state[k]; });
    try { if(typeof window.render === 'function'){ window.render(); return true; } } catch(e){}
    return false;
  }
  function saveReaderSettingsLocal(){
    var s = collectReaderSettings();
    var blob = new Blob([JSON.stringify(s, null, 2)], {type:'application/json'});
    var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href=url;
    a.download = 'aninovel-settings-' + (getCurrentWorkId()||'all') + '-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 100);
    showToast('💾 PCにダウンロード');
  }
  function loadReaderSettingsLocal(){
    var input = document.createElement('input'); input.type='file'; input.accept='application/json,.json'; input.style.display='none';
    input.onchange = function(e){
      var file=e.target.files && e.target.files[0]; if(!file){ input.remove(); return; }
      var rdr = new FileReader();
      rdr.onload = function(ev){ try { var s=JSON.parse(ev.target.result); if(!s._appVersion && !confirm('AniNovelファイルでない可能性。続行?')) return; var ok = applyReaderSettings(s); showToast(ok?'✅ 設定を読込':'✅ localStorage更新（リロード推奨）'); } catch(err){ alert('❌ ' + err.message); } };
      rdr.readAsText(file);
      setTimeout(function(){ input.remove(); }, 1000);
    };
    document.body.appendChild(input); input.click();
  }
  async function saveReaderSettingsCloud(silent){
    var uid = getCurrentUserId();
    if(!uid){ if(!silent) alert('ログインが必要です'); return false; }
    var s = collectReaderSettings();
    var note = silent ? '' : prompt('保存メモ:', '');
    if(!silent && note===null) return false;
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(uid) + '/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: s, note: note || '読者設定保存' }) });
      var r = await res.json();
      if(res.ok && r.ok){ if(!silent) alert('☁ クラウド保存完了\nバージョン: ' + (r.versionCount||0)); else showToast('☁ クラウド保存完了','#0ea5e9'); return true; }
      else { if(!silent) alert('❌ ' + (r.error || res.status)); return false; }
    } catch(e){ if(!silent) alert('❌ ' + e.message); return false; }
  }
  async function loadReaderSettingsCloud(){
    var uid = getCurrentUserId(); if(!uid){ alert('ログインが必要です'); return false; }
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(uid) + '/settings');
      if(res.status===404){ alert('クラウドに設定なし'); return false; }
      var s = await res.json();
      var ok = applyReaderSettings(s);
      showToast(ok?'☁ 設定を読込':'☁ localStorage更新（リロード推奨）','#0ea5e9');
      return true;
    } catch(e){ alert('❌ ' + e.message); return false; }
  }
  async function showReaderHistory(){
    var uid = getCurrentUserId(); if(!uid){ alert('ログイン要'); return; }
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(uid) + '/settings?versions=1');
      var r = await res.json();
      showHistoryModal('📜 設定バージョン履歴', (r.versions || []).slice().reverse(), async function(v){
        if(!confirm('v' + v + ' に復元?')) return;
        var r2 = await fetch('/api/users/' + encodeURIComponent(uid) + '/settings?version=' + v);
        var d = await r2.json(); if(!d.data){ alert('取得失敗'); return; }
        applyReaderSettings(d.data); showToast('✅ 復元しました','#0ea5e9');
      });
    } catch(e){ alert('履歴失敗: ' + e.message); }
  }
  async function autoLoadOnStart(){
    if(window._srvAutoLoaded) return; window._srvAutoLoaded = true;
    if(isAuthorMode()) return;
    var uid = getCurrentUserId(); if(!uid) return;
    try {
      var res = await fetch('/api/users/' + encodeURIComponent(uid) + '/settings');
      if(res.status === 404) return;
      var s = await res.json();
      applyReaderSettings(s);
      showToast('☁ クラウドから設定を読込','#0ea5e9');
    } catch(e){ log('Auto-load failed:', e); }
  }
  
  // ========================================
  // 読者ボタン
  // ========================================
  function setupReaderButtons(){
    if(isAuthorMode()) return;
    if(document.getElementById('srvReaderInline')) return;
    var toolbar = document.querySelector('.toolbar'); if(!toolbar) return;
    var c = document.createElement('div');
    c.id = 'srvReaderInline';
    c.style.cssText = 'display:inline-flex;gap:4px;align-items:center;margin-left:8px;flex-wrap:wrap';
    function mk(text, title, onClick, color){
      var b = document.createElement('button');
      b.textContent = text; b.title = title; b.className = 'btn';
      b.style.cssText = 'background:#fff;color:' + (color||'#6366f1') + ';border:1px solid ' + (color||'#6366f1') + ';padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600';
      b.onclick = onClick; return b;
    }
    c.appendChild(mk('💾 PC保存','個人設定をPCに保存',saveReaderSettingsLocal));
    c.appendChild(mk('📁 PC読込','PCから設定読込',loadReaderSettingsLocal));
    var uid = getCurrentUserId();
    if(uid){
      c.appendChild(mk('☁ クラウド保存','サーバーに保存（端末間同期）',function(){ saveReaderSettingsCloud(false); },'#0ea5e9'));
      c.appendChild(mk('☁ 読込','クラウドから読込',loadReaderSettingsCloud,'#0ea5e9'));
      c.appendChild(mk('📜','設定の履歴',showReaderHistory,'#0ea5e9'));
    }
    toolbar.appendChild(c);
  }
  
  // ========================================
  // 🎨 ギャラリーボタン（編集モーダル・読者カスタムモーダル両対応）
  // ========================================
  function setupGalleryButtons(){
    // 全ての input[type=file][accept*=image] を見つけて、その隣に挿入
    document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(input){
      var label = input.closest('label');
      if(!label) return;
      if(label.parentNode.querySelector('[data-srv-gal="1"]')) return; // 既に挿入済み
      
      var onchange = input.getAttribute('onchange') || '';
      // 読者カスタム or 作者編集 の input か判定
      var isReaderCustom = onchange.indexOf('readerCustom') !== -1;
      var isAuthorEdit = onchange.indexOf('state.editingItem') !== -1;
      
      if(!isReaderCustom && !isAuthorEdit) return; // 関係ないfileは無視
      
      var btn = document.createElement('button');
      btn.setAttribute('data-srv-gal', '1');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.style.cssText = 'background:#10b981;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-left:6px';
      btn.textContent = '🎨 ギャラリーから選ぶ';
      btn.onclick = function(e){
        e.preventDefault();
        try {
          // 読者モードの場合はターゲットを記憶
          window._srvGalTarget = isReaderCustom ? 'readerCustom' : 'editingItem';
          if(typeof window.openGallery === 'function'){
            window.openGallery();
          } else {
            window.state.imageGalleryOpen = true;
            window.state.galleryGroup = null;
            window.state.galleryPage = 0;
            if(typeof window.render === 'function') window.render();
          }
        } catch(err){ alert('エラー: ' + err.message); }
        return false;
      };
      label.parentNode.insertBefore(btn, label.nextSibling);
      log('Gallery button inserted (' + (isReaderCustom ? 'reader' : 'author') + ')');
    });
  }
  
  // ========================================
  // ⚠ 著作権警告（作者モードのみ、画像アップロード時）
  // ========================================
  function setupCopyrightWarning(){
    document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(input){
      if(input.dataset.srvCopyright) return;
      input.dataset.srvCopyright = '1';
      var onchange = input.getAttribute('onchange') || '';
      // 作者の editing 用 input のみ警告
      if(onchange.indexOf('state.editingItem') === -1) return;
      
      input.addEventListener('change', function(e){
        if(!isAuthorMode()) return;
        // 警告を一度だけ
        if(!window._srvCopyrightWarned){
          window._srvCopyrightWarned = true;
          var ok = confirm(
            '⚠️ 著作権に関する注意\n\n' +
            '作者モードでアップロードした画像は、作品の一部として「公開」されます。\n\n' +
            '以下は使用しないでください:\n' +
            '・著名人・芸能人・スポーツ選手などの写真\n' +
            '・アニメ・漫画・ゲームのキャラクター\n' +
            '・他者が撮影した写真（無許可）\n' +
            '・ロゴ・商標・ブランド画像\n\n' +
            '違反すると著作権侵害となり、法的措置の対象になる場合があります。\n\n' +
            '続行しますか？'
          );
          if(!ok){
            input.value = '';
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        }
      }, true);
    });
  }
  
  // ========================================
  // ギャラリー画像クリックをフック（読者モード対応）
  // ========================================
  function setupGalleryImageHooks(){
    if(!window.state || !window.state.imageGalleryOpen) return;
    // ギャラリー内の画像 / カード要素
    document.querySelectorAll('[data-galimg], .gallery-item, .gallery-cat-btn').forEach(function(el){
      if(el.dataset.srvGalImgHooked) return;
      el.dataset.srvGalImgHooked = '1';
      
      el.addEventListener('click', function(e){
        // 読者モードかつ ターゲットが readerCustom の場合
        if(window._srvGalTarget !== 'readerCustom') return;
        if(!window.state.readerCustomCharId) return;
        
        // 画像のパスを取得
        var img = el.tagName === 'IMG' ? el : el.querySelector('img');
        var src = img ? img.getAttribute('src') : (el.getAttribute('data-galimg') || el.style.backgroundImage.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1'));
        if(!src) return;
        
        // readerCustom に反映
        var cid = window.state.readerCustomCharId;
        if(!window.state.readerCustom) window.state.readerCustom = {};
        if(!window.state.readerCustom[cid]) window.state.readerCustom[cid] = {};
        window.state.readerCustom[cid].iconImage = src;
        window.state.imageGalleryOpen = false;
        window._srvGalTarget = null;
        // 永続化
        if(typeof window.saveReaderCustom === 'function'){
          window.saveReaderCustom(window._workParam || getCurrentWorkId());
        }
        if(typeof window.render === 'function') window.render();
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showToast('✅ アイコンを設定しました');
        return false;
      }, true); // capture
    });
  }
  
  // ========================================
  // 強制リセット（作者推奨に戻す が効かない時用）
  // ========================================
  function forceResetReaderCustom(){
    var workId = window._workParam || getCurrentWorkId();
    if(!confirm('この作品の読者カスタマイズを完全にクリアして、作者推奨の設定に戻しますか？')) return;
    try {
      if(window.state){
        window.state.readerCustom = null;
        window.state.readerCustomOpen = false;
      }
      // localStorage の reader_profiles から該当作品の readerCustom を削除
      try {
        var profiles = JSON.parse(localStorage.getItem('aninovel_reader_profiles') || '{}');
        if(profiles[workId]){
          Object.keys(profiles[workId]).forEach(function(profName){
            if(profiles[workId][profName] && profiles[workId][profName].readerCustom){
              profiles[workId][profName].readerCustom = null;
            }
          });
          localStorage.setItem('aninovel_reader_profiles', JSON.stringify(profiles));
        }
      } catch(e){ log('LS reset:', e); }
      // viewer.html の関数を呼ぶ
      if(typeof window.saveReaderCustom === 'function'){
        window.saveReaderCustom(workId);
      }
      if(typeof window.render === 'function') window.render();
      showToast('✅ 作者推奨に戻しました');
    } catch(e){ alert('❌ ' + e.message); }
  }
  
  // ========================================
  // 起動
  // ========================================
  function removeOldFloating(){
    ['srvSaveContainer','srvReaderContainer','srvAuthorFloating'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
  }
  function setupAll(){
    removeOldFloating();
    if(isAuthorMode()){
      var r = document.getElementById('srvReaderInline'); if(r) r.remove();
      setupAuthorButtons();
    } else {
      ['data-srv-publish','data-srv-hist'].forEach(function(attr){ document.querySelectorAll('[' + attr + ']').forEach(function(el){ el.remove(); }); });
      setupReaderButtons();
    }
    setupGalleryButtons();         // 編集モーダル・読者カスタムモーダル両方
    setupCopyrightWarning();       // 作者モードのみ警告
    setupGalleryImageHooks();      // ギャラリー画像クリック（読者モード対応）
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
    setTimeout(autoLoadOnStart, 1500);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  
  window.AniNovelServerSave = {
    save: function(){ return saveToServer(false); },
    showHistory: showWorkHistory,
    saveLocal: saveReaderSettingsLocal,
    loadLocal: loadReaderSettingsLocal,
    saveCloud: function(){ return saveReaderSettingsCloud(false); },
    loadCloud: loadReaderSettingsCloud,
    showCloudHistory: showReaderHistory,
    forceReset: forceResetReaderCustom,
    autoLoad: autoLoadOnStart,
    getWorkId: getCurrentWorkId,
    getUserId: getCurrentUserId,
    isAuthor: isAuthorMode,
    snapshotState: function(){ window._srvSnap = JSON.parse(JSON.stringify(window.state.characters)); console.log('snapshot saved'); },
    diffState: function(){ if(!window._srvSnap){ console.log('snapshotState first'); return; } window.state.characters.forEach(function(c,i){ var b=window._srvSnap[i]; if(!b){console.log('['+i+'] 新規'); return;} Object.keys(c).forEach(function(k){ if(JSON.stringify(c[k])!==JSON.stringify(b[k])) console.log('['+i+'] '+(c.name||c.id)+': '+k+' =', b[k], '→', c[k]); }); }); },
    showCharKeys: function(idx){ var c=window.state.characters[idx||0]; if(!c){console.log('なし'); return;} console.log('keys:', Object.keys(c)); console.log(JSON.stringify(c,null,2)); },
    forceRender: function(){ try { if(window.render){ window.render(); console.log('rendered'); } } catch(e){ console.log('err:', e); } }
  };
  
  log('Loaded v1.7.0');
})();
