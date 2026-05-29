/* ====================================================
 * AniNovel Server Save (v1.2.0)
 * 
 * v1.2 変更点:
 * - MutationObserver でボタン出現を即検出（タイミング問題を解消）
 * - 内蔵保存処理を実行してからサーバー保存（state反映を維持）
 * - エラー抑制で「保存先が見つかりません」を出さない
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
      if(pw[workId]){
        return pw[workId].catalogEntry || null;
      }
    } catch(e){}
    return null;
  }
  
  // localStorage の published_works に作品データを補完
  // (内蔵saveData() が「保存先(pub_)が見つかりません」を出さないように)
  function ensurePublishedWorksEntry(){
    try {
      var workId = getCurrentWorkId();
      if(!workId || workId.indexOf('pub_') !== 0) return;
      
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId]) return; // 既にあれば何もしない
      
      // state からエントリを作って補完
      var payload = getWorkPayload();
      if(!payload) return;
      
      pw[workId] = {
        catalogEntry: {
          id: workId,
          title: payload.novel ? payload.novel.title : '',
          author: payload.novel ? payload.novel.author : '',
        },
        data: payload,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('aninovel_published_works', JSON.stringify(pw));
      log('published_works エントリ補完:', workId);
    } catch(e){
      log('エントリ補完エラー:', e);
    }
  }
  
  // ========================================
  // サーバー保存
  // ========================================
  async function saveToServer(silent){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      if(!silent) alert('公開作品(pub_)のみサーバー保存可能です。\nID: ' + workId);
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
          alert('✅ サーバーに保存しました！\nバージョン履歴: ' + (result.versionCount || 0) + ' 件');
        } else {
          showToast('✅ サーバー保存完了');
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
  
  function showToast(msg, bgColor){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:130px;right:16px;background:' + (bgColor || '#10b981') + ';color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:10000;box-shadow:0 2px 12px rgba(0,0,0,0.2)';
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
  // 内蔵「保存」ボタンをフック（v1.2: 内蔵処理も実行）
  // ========================================
  function hookNativeSaveButtons(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0) return 0;
    
    // 補完: published_works に作品エントリがなければ作る（内蔵保存エラー対策）
    ensurePublishedWorksEntry();
    
    var hookedCount = 0;
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
          log('Native save clicked, text="' + text + '"');
          
          // 内蔵処理を実行（state反映 + localStorage保存）。エラーは抑制
          if(origOnclick){
            try {
              var fn = new Function(origOnclick);
              fn.call(btn);
              log('Native save executed');
            } catch(err) {
              log('Native save error suppressed:', err.message);
            }
          }
          
          // 少し待ってからサーバー保存（state反映を待つ）
          setTimeout(function(){
            saveToServer(true); // silent モード（toast表示のみ）
          }, 150);
          return false;
        };
        log('Hooked:', text);
        hookedCount++;
      }
    });
    return hookedCount;
  }
  
  // ========================================
  // フローティングボタン
  // ========================================
  function setupFloatingButtons(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0){
      var existing = document.getElementById('srvSaveContainer');
      if(existing) existing.remove();
      return;
    }
    
    if(document.getElementById('srvSaveContainer')) return;
    
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
    log('Floating buttons installed:', workId);
  }
  
  // ========================================
  // MutationObserver でリアルタイム検出
  // ========================================
  var setupTimer = null;
  function debouncedSetup(){
    if(setupTimer) return;
    setupTimer = setTimeout(function(){
      setupTimer = null;
      setupFloatingButtons();
      hookNativeSaveButtons();
    }, 100);
  }
  
  function startObserver(){
    if(window._srvObserverStarted) return;
    window._srvObserverStarted = true;
    
    var observer = new MutationObserver(function(mutations){
      // ボタン関連の変化があった時だけフック実行
      var relevant = false;
      for(var i=0; i<mutations.length; i++){
        var m = mutations[i];
        if(m.addedNodes && m.addedNodes.length){
          for(var j=0; j<m.addedNodes.length; j++){
            var n = m.addedNodes[j];
            if(n.nodeType === 1){
              if(n.tagName === 'BUTTON' || (n.querySelector && n.querySelector('button'))){
                relevant = true;
                break;
              }
            }
          }
        }
        if(relevant) break;
      }
      if(relevant) debouncedSetup();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    log('MutationObserver started');
  }
  
  function init(){
    if(!document.body){ setTimeout(init, 100); return; }
    
    setupFloatingButtons();
    hookNativeSaveButtons();
    startObserver();
    setInterval(function(){
      setupFloatingButtons();
      hookNativeSaveButtons();
    }, 2000); // フォールバック
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
    getWorkId: getCurrentWorkId,
    getPayload: getWorkPayload,
    hookButtons: hookNativeSaveButtons
  };
  
  log('Loaded v1.2.0');
})();
