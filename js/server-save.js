/* ====================================================
 * AniNovel Server Save (v1.12.0)
 * 
 * v1.12 大改修:
 * - 独自ギャラリーモーダル廃止
 * - viewer.html 内蔵の openGallery() を流用（作者モードと同じUI）
 * - editingItem を一時設定して性別フィルタを効かせ、選択結果を readerCustom に転送
 * ==================================================== */

(function(){
  'use strict';
  var DEBUG = true;
  function log(){ if(DEBUG && console) console.log.apply(console, ['[ServerSave]'].concat([].slice.call(arguments))); }
  
  function getCurrentWorkId(){
    var p = new URLSearchParams(location.search);
    return p.get('work') || (window.state && (window.state.currentWorkId || window.state.workId)) || null;
  }
  function isAuthorMode(){ return !!(window.state && window.state.isAuthorMode); }
  function getCurrentUserId(){
    try { var u=JSON.parse(localStorage.getItem('aninovel_user')||'null'); if(u&&(u.id||u.userId)) return u.id||u.userId; } catch(e){}
    if(window.state && window.state.user) return window.state.user.id || window.state.user.userId || null;
    try { var mw=JSON.parse(localStorage.getItem('aninovel_my_works')||'{}'); var ks=Object.keys(mw); if(ks.length && ks[0].indexOf('user_')===0) return ks[0]; } catch(e){}
    return null;
  }
  function showToast(msg, color){
    var t=document.createElement('div'); t.textContent=msg;
    t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:'+(color||'#10b981')+';color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:10003;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(function(){t.remove();},500); }, 2500);
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  
  // ========================================
  // 作品保存（公開）
  // ========================================
  function getWorkPayload(){ var st=window.state; if(st&&Array.isArray(st.content)) return { novel:st.novel, chapters:st.chapters, characters:st.characters, content:st.content, displaySettings:st.displaySettings, version:'2.2' }; return null; }
  function getCatalogMeta(){ try { var w=getCurrentWorkId(); var pw=JSON.parse(localStorage.getItem('aninovel_published_works')||'{}'); if(pw[w]) return pw[w].catalogEntry||null; } catch(e){} return null; }
  
  // 自動保存エラー防止
  function ensurePublishedWorksEntry(){
    var workId = getCurrentWorkId();
    if(!workId || workId.indexOf('pub_') !== 0) return;
    try {
      var pw = JSON.parse(localStorage.getItem('aninovel_published_works') || '{}');
      if(pw[workId]) return;
      var payload = getWorkPayload();
      if(!payload) return;
      pw[workId] = {
        catalogEntry: { id: workId, title: payload.novel ? payload.novel.title : '', author: payload.novel ? payload.novel.author : '' },
        data: payload,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _autoFilled: true
      };
      localStorage.setItem('aninovel_published_works', JSON.stringify(pw));
      log('Auto-filled published_works entry for:', workId);
    } catch(e){ log('ensure error:', e); }
  }
  
  async function saveToServer(silent){
    if(!isAuthorMode()){ if(!silent) alert('公開保存は作者モードのみ'); return false; }
    var w=getCurrentWorkId();
    if(!w || w.indexOf('pub_')!==0){ if(!silent) alert('公開作品のみ可能'); return false; }
    var p=getWorkPayload(); if(!p){ if(!silent) alert('データ取得失敗'); return false; }
    var note=silent?'':prompt('保存メモ:',''); if(!silent && note===null) return false;
    var btn=document.querySelector('[data-srv-publish]'); var orig=btn?btn.textContent:'';
    if(btn){ btn.textContent='⏳ 公開中...'; btn.disabled=true; }
    try {
      var body={ data:p, note:note||'公開保存' }; var m=getCatalogMeta(); if(m) body.meta=m;
      var r=await fetch('/api/works/'+encodeURIComponent(w),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var d=await r.json();
      if(r.ok && d.ok){ if(!silent) alert('✅ 保存完了\nv:'+(d.versionCount||0)); else showToast('✅ 公開保存完了'); return true; }
      else { if(!silent) alert('❌ '+(d.error||r.status)); return false; }
    } catch(e){ if(!silent) alert('❌ '+e.message); return false; }
    finally { if(btn){ btn.textContent=orig||'📤 公開保存'; btn.disabled=false; } }
  }
  
  async function showWorkHistory(){
    var w=getCurrentWorkId(); if(!w||w.indexOf('pub_')!==0){ alert('公開作品のみ'); return; }
    try { var r=await fetch('/api/works/'+encodeURIComponent(w)+'?versions=1'); var d=await r.json();
      showHistoryModal('📜 作品バージョン履歴', (d.versions||[]).slice().reverse(), function(v){ restoreWorkVersion(w,v); }); } catch(e){ alert('失敗:'+e.message); }
  }
  async function restoreWorkVersion(w, ver){
    if(!confirm('v'+ver+'に復元?')) return;
    try { var r=await fetch('/api/works/'+encodeURIComponent(w)+'?version='+ver); var d=await r.json(); if(!d.data){alert('失敗');return;}
      var pr=await fetch('/api/works/'+encodeURIComponent(w),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d.data,note:'v'+ver+'復元'})});
      var p=await pr.json(); if(pr.ok && p.ok){ alert('✅ 復元完了'); location.reload(); } } catch(e){ alert('err:'+e.message); }
  }
  function showHistoryModal(title, versions, onRestore){
    var old=document.getElementById('srvVerModal'); if(old) old.remove();
    var ov=document.createElement('div'); ov.id='srvVerModal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick=function(e){ if(e.target===ov) ov.remove(); };
    var b=document.createElement('div');
    b.style.cssText='background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px';
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;font-size:16px;font-weight:700">'+escapeHtml(title)+'</h3><button id="srvVerClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>';
    if(versions.length===0) h+='<p style="color:#666;text-align:center;padding:30px 0">履歴なし</p>';
    else { h+='<div style="display:flex;flex-direction:column;gap:8px">';
      versions.forEach(function(v){ var dt=new Date(v.savedAt).toLocaleString('ja-JP');
        h+='<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="flex:1"><div style="font-weight:600;font-size:13px">v'+v.version+'</div><div style="font-size:11px;color:#666">'+dt+'</div>'+(v.note?'<div style="font-size:11px;color:#888;margin-top:2px">📝 '+escapeHtml(v.note)+'</div>':'')+'</div><button class="srvRBtn" data-version="'+v.version+'" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer">復元</button></div>';
      }); h+='</div>'; }
    b.innerHTML=h; ov.appendChild(b); document.body.appendChild(ov);
    document.getElementById('srvVerClose').onclick=function(){ ov.remove(); };
    Array.from(b.querySelectorAll('.srvRBtn')).forEach(function(btn){ btn.onclick=function(){ ov.remove(); onRestore(parseInt(btn.getAttribute('data-version'),10)); }; });
  }
  
  // ========================================
  // 作者ボタン
  // ========================================
  function findNativeSaveButton(){
    var bs=document.querySelectorAll('button');
    for(var i=0;i<bs.length;i++){ var btn=bs[i]; var oc=btn.getAttribute('onclick')||''; var t=(btn.textContent||'').trim();
      if((oc==='saveData()'||oc.indexOf('saveData')!==-1||t==='💾 保存'||t==='保存') && t.indexOf('サーバー')===-1 && t.indexOf('公開')===-1) return btn;
    } return null;
  }
  function setupAuthorButtons(){
    if(!isAuthorMode()) return;
    if(document.querySelector('[data-srv-publish]')) return;
    var sb=findNativeSaveButton(); if(!sb||!sb.parentNode) return;
    var pb=document.createElement('button'); pb.setAttribute('data-srv-publish','1'); pb.textContent='📤 公開保存'; pb.title='サーバー保存して公開';
    pb.className=sb.className||'btn';
    pb.style.cssText='background:#6366f1;color:#fff;padding:6px 12px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;margin-left:4px';
    pb.onclick=function(e){ e.preventDefault(); saveToServer(false); return false; };
    var hb=document.createElement('button'); hb.setAttribute('data-srv-hist','1'); hb.textContent='📜'; hb.title='バージョン履歴';
    hb.className=sb.className||'btn';
    hb.style.cssText='background:#fff;color:#6366f1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid #6366f1;cursor:pointer;margin-left:4px';
    hb.onclick=function(e){ e.preventDefault(); showWorkHistory(); return false; };
    sb.parentNode.insertBefore(pb, sb.nextSibling); sb.parentNode.insertBefore(hb, pb.nextSibling);
  }
  
  // ========================================
  // 読者設定 クラウド保存
  // ========================================
  function collectReaderSettings(){
    var st=window.state||{};
    var s={ _appVersion:'aninovel-reader-1.0', _savedAt:new Date().toISOString(), _workId:getCurrentWorkId(),
      state:{ readerCustom:st.readerCustom, readerCustomCharId:st.readerCustomCharId, readerProfileCurrent:st.readerProfileCurrent, readerProfileList:st.readerProfileList, darkMode:st.darkMode, displaySettings:st.displaySettings, bookmarks:st.bookmarks },
      localStorage:{} };
    ['aninovel_user','aninovel_reader_profiles','aninovel_data','aninovel_analytics_consent_v1'].forEach(function(k){ var v=localStorage.getItem(k); if(v!==null) s.localStorage[k]=v; });
    return s;
  }
  function applyReaderSettings(s){
    if(s.localStorage) Object.keys(s.localStorage).forEach(function(k){ var v=s.localStorage[k]; if(typeof v==='string') try{ localStorage.setItem(k,v); }catch(e){} });
    if(s.state && window.state) ['readerCustom','readerCustomCharId','readerProfileCurrent','readerProfileList','darkMode','displaySettings','bookmarks'].forEach(function(k){ if(s.state[k]!==undefined) window.state[k]=s.state[k]; });
    try { if(typeof window.render==='function'){ window.render(); return true; } } catch(e){}
    return false;
  }
  async function saveReaderSettingsCloud(silent){
    var uid=getCurrentUserId(); if(!uid){ if(!silent) alert('ログインが必要です'); return false; }
    var s=collectReaderSettings(); var note=silent?'':prompt('保存メモ:',''); if(!silent && note===null) return false;
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:s,note:note||'読者設定'})});
      var d=await r.json(); if(r.ok && d.ok){ if(!silent) alert('☁ クラウド保存完了\nv:'+(d.versionCount||0)); else showToast('☁ クラウド保存完了','#0ea5e9'); return true; }
      else { if(!silent) alert('❌ '+(d.error||r.status)); return false; }
    } catch(e){ if(!silent) alert('❌ '+e.message); return false; }
  }
  async function loadReaderSettingsCloud(){
    var uid=getCurrentUserId(); if(!uid){ alert('ログインが必要です'); return false; }
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings');
      if(r.status===404){ alert('クラウドに設定なし'); return false; }
      var s=await r.json(); var ok=applyReaderSettings(s); showToast(ok?'☁ 設定を読込':'☁ localStorage更新','#0ea5e9'); return true;
    } catch(e){ alert('❌ '+e.message); return false; }
  }
  async function showReaderHistory(){
    var uid=getCurrentUserId(); if(!uid){ alert('ログイン要'); return; }
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings?versions=1'); var d=await r.json();
      showHistoryModal('📜 読者設定の履歴', (d.versions||[]).slice().reverse(), async function(v){
        if(!confirm('v'+v+'に復元?')) return;
        var r2=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings?version='+v);
        var dd=await r2.json(); if(!dd.data){alert('失敗'); return;}
        applyReaderSettings(dd.data); showToast('✅ 復元','#0ea5e9');
      });
    } catch(e){ alert('失敗:'+e.message); }
  }
  async function autoLoadOnStart(){
    if(window._srvAutoLoaded) return; window._srvAutoLoaded=true;
    if(isAuthorMode()) return; var uid=getCurrentUserId(); if(!uid) return;
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings');
      if(r.status===404) return; var s=await r.json(); applyReaderSettings(s); showToast('☁ クラウドから読込','#0ea5e9');
    } catch(e){ log('AutoLoad err:',e); }
  }
  
  function setupReaderButtons(){
    if(isAuthorMode()) return;
    if(document.getElementById('srvReaderInline')) return;
    var tb=document.querySelector('.toolbar'); if(!tb) return;
    var uid=getCurrentUserId();
    if(!uid) return;
    var c=document.createElement('div'); c.id='srvReaderInline';
    c.style.cssText='display:inline-flex;gap:4px;align-items:center;margin-left:8px;flex-wrap:wrap';
    function mk(t,ti,cb){ var b=document.createElement('button'); b.textContent=t; b.title=ti; b.className='btn';
      b.style.cssText='background:#fff;color:#0ea5e9;border:1px solid #0ea5e9;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600';
      b.onclick=cb; return b; }
    c.appendChild(mk('☁ 設定保存','クラウドに保存',function(){ saveReaderSettingsCloud(false); }));
    c.appendChild(mk('☁ 読込','クラウドから',loadReaderSettingsCloud));
    c.appendChild(mk('📜','設定の履歴',showReaderHistory));
    tb.appendChild(c);
  }
  
  // ========================================
  // ★★ 読者モードで viewer.html 内蔵ギャラリーを流用 ★★
  // ========================================
  
  // viewer.html の openGallery() を呼ぶ前に editingItem を一時設定し、
  // 選択結果（iconImage の変化）を監視して readerCustom に転送する
  function openGalleryForReader(){
    var charId = window.state.readerCustomCharId;
    if(!charId){ alert('キャラ未選択'); return; }
    
    var ch = (window.state.characters || []).find(function(c){ return c.id === charId; });
    if(!ch){ alert('キャラが見つかりません'); return; }
    
    // 一時的に editingItem を設定（ギャラリーの性別フィルタが効くように）
    var origEditingItem = window.state.editingItem;
    var origEditModalOpen = window.state.editModalOpen;
    var origReaderCustomOpen = window.state.readerCustomOpen;
    
    // 読者カスタムモーダルは一旦閉じる（重なって見えにくくならないように）
    window.state.readerCustomOpen = false;
    
    window.state.editingItem = {
      type: 'character',
      data: {
        id: charId,
        gender: ch.gender,
        iconImage: ''  // 初期化（変更検出のため）
      }
    };
    // editModalOpen は触らない（編集モーダルは開かない）
    
    log('Opening native gallery for reader, charId:', charId, 'gender:', ch.gender);
    
    // 選択結果を監視
    var startTime = Date.now();
    var watchInterval = setInterval(function(){
      var stillOpen = window.state.imageGalleryOpen;
      var newImage = window.state.editingItem && window.state.editingItem.data && window.state.editingItem.data.iconImage;
      
      // 画像が選択された OR ギャラリーが閉じられた
      if(!stillOpen || (newImage && newImage !== '')){
        clearInterval(watchInterval);
        
        if(newImage && newImage !== ''){
          // 画像が選択された → readerCustom に反映
          log('Image selected:', newImage);
          if(!window.state.readerCustom) window.state.readerCustom = {};
          if(!window.state.readerCustom[charId]) window.state.readerCustom[charId] = {};
          window.state.readerCustom[charId].iconImage = newImage;
          
          if(typeof window.saveReaderCustom === 'function'){
            try { 
              window.saveReaderCustom(window._workParam || getCurrentWorkId()); 
              log('saveReaderCustom called');
            } catch(e){ log('saveReaderCustom err:', e); }
          }
          showToast('✅ アイコン設定');
        }
        
        // 元の状態を復元
        window.state.editingItem = origEditingItem;
        window.state.editModalOpen = origEditModalOpen;
        window.state.readerCustomOpen = origReaderCustomOpen;
        window.state.imageGalleryOpen = false;
        
        if(typeof window.render === 'function') window.render();
      }
      
      // 30秒タイムアウト
      if(Date.now() - startTime > 30000){
        clearInterval(watchInterval);
        window.state.editingItem = origEditingItem;
        window.state.editModalOpen = origEditModalOpen;
        window.state.readerCustomOpen = origReaderCustomOpen;
        log('Gallery watch timeout');
      }
    }, 200);
    
    // viewer.html 内蔵のギャラリーを開く
    if(typeof window.openGallery === 'function'){
      window.openGallery();
    } else {
      window.state.imageGalleryOpen = true;
      if(typeof window.render === 'function') window.render();
    }
  }
  
  // ボタン挿入（読者モードのみ）
  function setupGalleryButtons(){
    document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(input){
      var label=input.closest('label'); if(!label) return;
      if(label.parentNode.querySelector('[data-srv-gal="1"]')) return;
      var onchange=input.getAttribute('onchange')||'';
      var isReader=onchange.indexOf('readerCustom')!==-1;
      var isAuthor=onchange.indexOf('state.editingItem')!==-1;
      if(isAuthor) return; // 作者モードは viewer.html の既存ボタンを使う
      if(!isReader) return;
      
      var btn=document.createElement('button');
      btn.setAttribute('data-srv-gal','1');
      btn.type='button';
      btn.className='btn';
      btn.style.cssText='background:#10b981;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-left:6px';
      btn.textContent='🎨 ギャラリーから選ぶ';
      btn.onclick=function(e){
        e.preventDefault();
        openGalleryForReader();
        return false;
      };
      label.parentNode.insertBefore(btn, label.nextSibling);
    });
  }
  
  // ========================================
  // 著作権警告
  // ========================================
  function setupCopyrightWarning(){
    document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(input){
      if(input.dataset.srvCopy) return;
      var oc=input.getAttribute('onchange')||'';
      if(oc.indexOf('state.editingItem')===-1) return;
      input.dataset.srvCopy='1';
      input.addEventListener('change', function(e){
        if(!isAuthorMode()) return;
        if(window._srvCopyOk) return;
        var ok=confirm('⚠️ 著作権に関する注意\n\nこの画像は作品の一部として公開されます。\n\n以下は使用しないでください:\n・著名人・芸能人の写真\n・アニメ/漫画/ゲームのキャラクター\n・他者の写真（無許可）\n・ロゴ・商標\n\n続行しますか？');
        if(!ok){ input.value=''; e.preventDefault(); e.stopPropagation(); return false; }
        window._srvCopyOk=true;
      }, true);
    });
  }
  
  // ========================================
  // 「作者推奨に戻す」ボタンフック
  // ========================================
  function hookResetButton(){
    document.querySelectorAll('button').forEach(function(btn){
      if(btn.dataset.srvResetHooked) return;
      var oc=btn.getAttribute('onclick')||'';
      var t=(btn.textContent||'').trim();
      var matched = ( oc.indexOf('resetToAuthorDefaults')!==-1 || t === '作者推奨に戻す' || t === '🔄 作者推奨に戻す' || (t.indexOf('作者推奨')!==-1 && t.indexOf('戻')!==-1) || (t.indexOf('推奨')!==-1 && t.indexOf('戻')!==-1));
      if(matched){
        btn.dataset.srvResetHooked='1';
        btn.removeAttribute('onclick');
        var newBtn = btn.cloneNode(true);
        newBtn.dataset.srvResetHooked='1';
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          forceResetReaderCustom();
          return false;
        }, true);
        log('Reset button hooked:', t);
      }
    });
  }
  function forceResetReaderCustom(){
    var workId=window._workParam||getCurrentWorkId();
    if(!confirm('読者カスタマイズを完全にクリアし、作者推奨の設定に戻しますか？')) return;
    try {
      if(window.state){ window.state.readerCustom=null; window.state.readerCustomOpen=false; }
      try {
        var profiles=JSON.parse(localStorage.getItem('aninovel_reader_profiles')||'{}');
        if(profiles[workId]){
          Object.keys(profiles[workId]).forEach(function(pn){
            if(profiles[workId][pn] && profiles[workId][pn].readerCustom) profiles[workId][pn].readerCustom=null;
            if(profiles[workId][pn] && typeof profiles[workId][pn]==='object') delete profiles[workId][pn].readerCustom;
          });
          localStorage.setItem('aninovel_reader_profiles', JSON.stringify(profiles));
        }
      } catch(e){ log('LS reset:',e); }
      try { var d=JSON.parse(localStorage.getItem('aninovel_data')||'{}'); if(d && d.readerCustom){ delete d.readerCustom; localStorage.setItem('aninovel_data', JSON.stringify(d)); } } catch(e){}
      if(typeof window.saveReaderCustom==='function'){ try { window.saveReaderCustom(workId); } catch(e){} }
      if(typeof window.render==='function') window.render();
      showToast('✅ 作者推奨の設定に戻しました');
    } catch(e){ alert('❌ '+e.message); }
  }
  
  // 読者モードで👥非表示
  function hideCharacterListButtonInReader(){
    if(isAuthorMode()) return;
    document.querySelectorAll('button').forEach(function(btn){
      if(btn.dataset.srvHiddenChar) return;
      var t=(btn.textContent||'').trim();
      var title=btn.getAttribute('title')||'';
      if(t==='👥' || t.indexOf('👥')!==-1 || title.indexOf('登場人物')!==-1){
        btn.dataset.srvHiddenChar='1';
        btn.dataset.srvOrigDisplay=btn.style.display||'';
        btn.style.display='none';
      }
    });
  }
  function restoreCharacterListButton(){
    document.querySelectorAll('[data-srv-hidden-char="1"]').forEach(function(btn){
      btn.style.display=btn.dataset.srvOrigDisplay||'';
      delete btn.dataset.srvHiddenChar;
    });
  }
  
  // ========================================
  // 起動
  // ========================================
  function removeOldFloating(){
    ['srvSaveContainer','srvReaderContainer','srvAuthorFloating','srvCustGallery'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
  }
  function setupAll(){
    ensurePublishedWorksEntry();
    removeOldFloating();
    if(isAuthorMode()){
      var r=document.getElementById('srvReaderInline'); if(r) r.remove();
      restoreCharacterListButton();
      setupAuthorButtons();
    } else {
      ['data-srv-publish','data-srv-hist'].forEach(function(a){ document.querySelectorAll('['+a+']').forEach(function(el){ el.remove(); }); });
      setupReaderButtons();
      hideCharacterListButtonInReader();
    }
    setupGalleryButtons();
    setupCopyrightWarning();
    hookResetButton();
  }
  var sT=null;
  function debouncedSetup(){ if(sT) return; sT=setTimeout(function(){ sT=null; setupAll(); }, 100); }
  function startObserver(){
    if(window._srvObserverStarted) return; window._srvObserverStarted=true;
    var o=new MutationObserver(debouncedSetup); o.observe(document.body, { childList:true, subtree:true });
  }
  function init(){
    if(!document.body){ setTimeout(init, 100); return; }
    setupAll(); startObserver();
    setInterval(setupAll, 2000);
    setTimeout(autoLoadOnStart, 1500);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  
  window.AniNovelServerSave={
    save:function(){ return saveToServer(false); }, showHistory:showWorkHistory,
    saveCloud:function(){ return saveReaderSettingsCloud(false); }, loadCloud:loadReaderSettingsCloud, showCloudHistory:showReaderHistory,
    forceReset:forceResetReaderCustom,
    openGallery:openGalleryForReader,
    getWorkId:getCurrentWorkId, getUserId:getCurrentUserId, isAuthor:isAuthorMode,
    forceRender:function(){ if(window.render){ try{ window.render(); console.log('rendered'); }catch(e){ console.log(e); } } }
  };
  log('Loaded v1.12.0');
})();

// deploy: 20260530074131