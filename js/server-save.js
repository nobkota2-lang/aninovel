/* ====================================================
 * AniNovel Server Save (v1.16.0)
 * 
 * v1.13 大改修:
 * - 独自ギャラリーモーダル復活、ただし DOM 直接構築（innerHTML 使わず）
 * - 画像クリック時、確実に onSelect が呼ばれる（クロージャで src を保持）
 * - 読者カスタムモーダルは閉じない（z-index で上に重ねる）
 * ==================================================== */

(function(){
  'use strict';
  function _lang(){try{if(window.state&&window.state.lang)return window.state.lang;var l=localStorage.getItem('aninovel_lang');if(l)return l;}catch(e){}return 'ja';}
  function _t(ja,en){return _lang()==='en'?en:ja;}
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
    t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:'+(color||'#10b981')+';color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(function(){t.remove();},500); }, 2500);
  }
  
  // ========================================
  // 作品保存
  // ========================================
  function getWorkPayload(){ var st=window.state; if(st&&Array.isArray(st.content)) return { novel:st.novel, chapters:st.chapters, characters:st.characters, content:st.content, displaySettings:st.displaySettings, version:'2.2' }; return null; }
  function getCatalogMeta(){ try { var w=getCurrentWorkId(); var pl=getWorkPayload(); if(!w||!pl||!pl.novel) return null; var nv=pl.novel; var content=Array.isArray(pl.content)?pl.content:[]; var chars=Array.isArray(pl.characters)?pl.characters:[]; var cc=content.reduce(function(s,it){return s+(((it.text||it.html||'')+'').length);},0); var pg=content.filter(function(x){return x&&(x.type==='pageBreak'||x.type==='page'||x.type==='chapter');}).length; return { id:w, title:nv.title||'無題', author:nv.author||'', description:nv.description||'', coverColor:nv.coverColor||'#6366F1', coverImage:nv.coverImage||'', pageCount:(pg>0?pg:1), charCount:cc, characterCount:chars.length, tags:(Array.isArray(nv.tags)?nv.tags:[]), createdAt:nv.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString() }; } catch(e){ return null; } }
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
        data: payload, publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _autoFilled: true
      };
      localStorage.setItem('aninovel_published_works', JSON.stringify(pw));
    } catch(e){}
  }
  
  async function saveToServer(silent){
    if(!isAuthorMode()){ if(!silent) alert(_t('公開保存は作者モードのみ','Publishing is available in Author mode only')); return false; }
    var w=getCurrentWorkId();
    if(!w || w.indexOf('pub_')!==0){ if(!silent) alert(_t('公開作品のみ可能','Published works only')); return false; }
    // 表紙が my_ パスのままなら実体を pub_ へコピーしてパスを書き換える
    try{
      var _ci=(window.state&&state.novel&&state.novel.coverImage)||'';
      var _mm=_ci.match(/\/api\/cover\/(my_[A-Za-z0-9_]+)/);
      if(_mm){
        var _res=await fetch('/api/cover/'+_mm[1]);
        if(_res.ok){var _bl=await _res.blob();var _pr=await fetch('/api/cover/'+w,{method:'PUT',headers:{'Content-Type':_bl.type||'image/png'},body:_bl});if(_pr.ok){state.novel.coverImage='/api/cover/'+w+'?t='+Date.now();console.info('[Publish] 表紙をmy_→pub_へコピー');}}
      }
    }catch(_e){console.warn('[Publish] 表紙コピー失敗:',_e);}
    var p=getWorkPayload(); if(!p){ if(!silent) alert(_t('データ取得失敗','Failed to fetch data')); return false; }
    var note=silent?'':prompt('保存メモ:',''); if(!silent && note===null) return false;
    var btn=document.querySelector('[data-srv-publish]'); var orig=btn?btn.textContent:'';
    if(btn){ btn.textContent='⏳ 公開中...'; btn.disabled=true; }
    try {
      var body={ data:p, note:note||'公開保存' }; var m=getCatalogMeta(); if(m){ try{ var _tr=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:'en',title:m.title||'',author:m.author||'',items:[{id:'d',text:m.description||''}],characters:[]})}); if(_tr.ok){ var _tj=await _tr.json(); if(_tj){ if(_tj.title)m.titleEn=_tj.title; if(_tj.author)m.authorEn=_tj.author; if(_tj.items&&_tj.items[0]&&_tj.items[0].text)m.descriptionEn=_tj.items[0].text; console.info('[Publish] 英訳meta生成:',m.titleEn||'(なし)'); } } }catch(_te){console.warn('[Publish] 英訳生成スキップ:',_te);} body.meta=m; }
      var r=await fetch('/api/works/'+encodeURIComponent(w),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var d=await r.json();
      if(r.ok && d.ok){ try{ if(typeof saveData==='function') saveData(true); }catch(_e){} if(!silent) alert('✅ 保存完了\nv:'+(d.versionCount||0)); else showToast('✅ 公開保存完了'); return true; }
      else { if(!silent) alert('❌ '+(d.error||r.status)); return false; }
    } catch(e){ if(!silent) alert('❌ '+e.message); return false; }
    finally { if(btn){ btn.textContent=orig||_t('📤 公開保存','📤 Publish'); btn.disabled=false; } }
  }
  
  async function showWorkHistory(){
    var w=getCurrentWorkId(); if(!w||w.indexOf('pub_')!==0){ alert(_t('公開作品のみ','Published works only')); return; }
    try { var r=await fetch('/api/works/'+encodeURIComponent(w)+'?versions=1'); var d=await r.json();
      showHistoryModal(_t('📜 作品バージョン履歴','📜 Version history'), (d.versions||[]).slice().reverse(), function(v){ restoreWorkVersion(w,v); }); } catch(e){ alert(_t('失敗:','Failed: ')+e.message); }
  }
  async function restoreWorkVersion(w, ver){
    if(!confirm(_t('v'+ver+'に復元?','Restore v'+ver+'?'))) return;
    try { var r=await fetch('/api/works/'+encodeURIComponent(w)+'?version='+ver); var d=await r.json(); if(!d.data){alert(_t('失敗','Failed'));return;}
      var pr=await fetch('/api/works/'+encodeURIComponent(w),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d.data,note:'v'+ver+'復元'})});
      var p=await pr.json(); if(pr.ok && p.ok){ alert(_t('✅ 復元完了','✅ Restored')); location.reload(); } } catch(e){ alert('err:'+e.message); }
  }
  
  function showHistoryModal(title, versions, onRestore){
    var old=document.getElementById('srvVerModal'); if(old) old.remove();
    var ov=document.createElement('div'); ov.id='srvVerModal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick=function(e){ if(e.target===ov) ov.remove(); };
    var b=document.createElement('div');
    b.style.cssText='background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px';
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:16px';
    var h3=document.createElement('h3'); h3.textContent=title; h3.style.cssText='margin:0;font-size:16px;font-weight:700';
    var cls=document.createElement('button'); cls.textContent='✕'; cls.style.cssText='background:none;border:none;font-size:20px;cursor:pointer';
    cls.onclick=function(){ ov.remove(); };
    hdr.appendChild(h3); hdr.appendChild(cls); b.appendChild(hdr);
    if(versions.length===0){
      var em=document.createElement('p'); em.textContent=_t('履歴なし','No history'); em.style.cssText='color:#666;text-align:center;padding:30px 0';
      b.appendChild(em);
    } else {
      var list=document.createElement('div'); list.style.cssText='display:flex;flex-direction:column;gap:8px';
      versions.forEach(function(v){
        var row=document.createElement('div');
        row.style.cssText='border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px';
        var info=document.createElement('div'); info.style.cssText='flex:1';
        var v1=document.createElement('div'); v1.textContent='v'+v.version; v1.style.cssText='font-weight:600;font-size:13px'; info.appendChild(v1);
        var dt=document.createElement('div'); dt.textContent=new Date(v.savedAt).toLocaleString('ja-JP'); dt.style.cssText='font-size:11px;color:#666'; info.appendChild(dt);
        if(v.note){ var nt=document.createElement('div'); nt.textContent='📝 '+v.note; nt.style.cssText='font-size:11px;color:#888;margin-top:2px'; info.appendChild(nt); }
        var btn=document.createElement('button'); btn.textContent=_t('復元','Restore');
        btn.style.cssText='background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer';
        (function(ver){ btn.onclick=function(){ ov.remove(); onRestore(ver); }; })(v.version);
        row.appendChild(info); row.appendChild(btn); list.appendChild(row);
      });
      b.appendChild(list);
    }
    ov.appendChild(b); document.body.appendChild(ov);
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
    var pb=document.createElement('button'); pb.setAttribute('data-srv-publish','1'); pb.textContent=_t('📤 公開保存','📤 Publish');
    pb.className=sb.className||'btn';
    pb.style.cssText='background:#6366f1;color:#fff;padding:6px 12px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;margin-left:4px';
    pb.onclick=function(e){ e.preventDefault(); saveToServer(false); return false; };
    var hb=document.createElement('button'); hb.setAttribute('data-srv-hist','1'); hb.textContent='📜';
    hb.className=sb.className||'btn';
    hb.style.cssText='background:#fff;color:#6366f1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid #6366f1;cursor:pointer;margin-left:4px';
    hb.onclick=function(e){ e.preventDefault(); showWorkHistory(); return false; };
    sb.parentNode.insertBefore(pb, sb.nextSibling); sb.parentNode.insertBefore(hb, pb.nextSibling);
  }
  
  // ========================================
  // 読者クラウド保存
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
    var uid=getCurrentUserId(); if(!uid){ if(!silent) alert(_t('ログイン要','Sign-in required')); return false; }
    var s=collectReaderSettings(); var note=silent?'':prompt('保存メモ:',''); if(!silent && note===null) return false;
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:s,note:note||'読者設定'})});
      var d=await r.json(); if(r.ok && d.ok){ if(!silent) alert(_t('☁ 保存完了','☁ Saved')); else showToast(_t('☁ 保存完了','☁ Saved'),'#0ea5e9'); return true; } return false;
    } catch(e){ return false; }
  }
  async function loadReaderSettingsCloud(){
    var uid=getCurrentUserId(); if(!uid){ alert(_t('ログイン要','Sign-in required')); return false; }
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings'); if(r.status===404){ alert(_t('クラウドに設定なし','No settings in cloud')); return false; }
      var s=await r.json(); applyReaderSettings(s); showToast(_t('☁ 設定読込','☁ Load settings'),'#0ea5e9'); return true;
    } catch(e){ return false; }
  }
  async function showReaderHistory(){
    var uid=getCurrentUserId(); if(!uid){ alert(_t('ログイン要','Sign-in required')); return; }
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings?versions=1'); var d=await r.json();
      showHistoryModal(_t('📜 読者設定の履歴','📜 Reader settings history'), (d.versions||[]).slice().reverse(), async function(v){
        if(!confirm(_t('v'+v+'に復元?','Restore v'+v+'?'))) return;
        var r2=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings?version='+v);
        var dd=await r2.json(); if(!dd.data){alert(_t('失敗','Failed')); return;}
        applyReaderSettings(dd.data); showToast('✅ 復元','#0ea5e9');
      });
    } catch(e){}
  }
  async function autoLoadOnStart(){
    if(window._srvAutoLoaded) return; window._srvAutoLoaded=true;
    if(isAuthorMode()) return; var uid=getCurrentUserId(); if(!uid) return;
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings');
      if(r.status===404) return; var s=await r.json(); applyReaderSettings(s); showToast(_t('☁ クラウドから読込','☁ Load from cloud'),'#0ea5e9');
    } catch(e){}
  }
  
  function setupReaderButtons(){
    if(isAuthorMode()) return;
    if(document.getElementById('srvReaderInline')) return;
    var tb=document.querySelector('.toolbar'); if(!tb) return;
    var uid=getCurrentUserId(); if(!uid) return;
    var c=document.createElement('div'); c.id='srvReaderInline';
    c.style.cssText='display:inline-flex;gap:4px;align-items:center;margin-left:8px;flex-wrap:wrap';
    function mk(t,ti,cb){ var b=document.createElement('button'); b.textContent=t; b.title=ti; b.className='btn';
      b.style.cssText='background:#fff;color:#0ea5e9;border:1px solid #0ea5e9;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600';
      b.onclick=cb; return b; }
    c.appendChild(mk('☁ 設定保存','クラウドに保存',function(){ saveReaderSettingsCloud(false); }));
    c.appendChild(mk(_t('☁ 読込','☁ Load'),'クラウドから',loadReaderSettingsCloud));
    c.appendChild(mk('📜','設定の履歴',showReaderHistory));
    tb.appendChild(c);
  }
  
  // ========================================
  // ★★ 独自ギャラリーモーダル（DOM 直接構築版）★★
  // ========================================
  var _manifest = null;
  
  async function loadManifest(){
    if(_manifest && _manifest.groups && _manifest.groups.length) return _manifest;
    if(window.state && window.state.galleryManifest && window.state.galleryManifest.groups && window.state.galleryManifest.groups.length){
      _manifest = window.state.galleryManifest;
      return _manifest;
    }
    log('Fetching manifest from /data/gallery-manifest.json');
    try {
      var r=await fetch('/data/gallery-manifest.json');
      if(!r.ok){ alert('manifest取得失敗: HTTP ' + r.status); return null; }
      _manifest = await r.json();
      log('Manifest loaded, groups:', _manifest.groups ? _manifest.groups.length : 0);
      if(!_manifest.groups || !_manifest.groups.length){ alert('manifest が groups を含んでいません'); return null; }
      if(window.state) window.state.galleryManifest = _manifest;
      return _manifest;
    } catch(e){ alert('manifest取得失敗: '+e.message); return null; }
  }
  
  async function openReaderGallery(){
    log('openReaderGallery called');
    log('readerCustomCharId:', window.state ? window.state.readerCustomCharId : '(no state)');
    
    // ★ まず即座に「読込中」モーダルを表示（クリック検知の視覚確認）
    showLoadingModal();
    
    // readerCustomCharId が空でも、編集中のキャラを探す
    var charId = window.state.readerCustomCharId;
    if(!charId){
      // 編集モーダルの onchange から推測
      var labels = document.querySelectorAll('label');
      for(var i=0; i<labels.length; i++){
        var inp = labels[i].querySelector('input[type="file"][accept*="image"]');
        if(inp){
          var oc = inp.getAttribute('onchange') || '';
          var m = oc.match(/readerCustom\[['"]([^'"]+)['"]\]/);
          if(m){ charId = m[1]; log('Recovered charId from DOM:', charId); break; }
        }
      }
    }
    
    if(!charId){
      closeLoadingModal();
      alert(_t('キャラ未選択。読者カスタムモーダルが開いているか確認してください。','No character selected. Make sure the reader customization modal is open.'));
      return;
    }
    
    var ch = (window.state.characters || []).find(function(c){ return c.id === charId; });
    log('Character found:', ch ? ch.name : '(not found)', 'gender:', ch ? ch.gender : '?');
    
    var manifest = await loadManifest();
    if(!manifest){ closeLoadingModal(); log('loadManifest returned null'); return; }
    
    // ★ 性別は毎回最新の characters から取得（性別変更追従）
    var freshCh = (window.state.characters || []).find(function(c){ return c.id === charId; });
    var gender = freshCh ? freshCh.gender : (ch ? ch.gender : null);
    
    var groups = manifest.groups.slice();
    if(gender === 'male' || gender === 'female'){
      groups = groups.filter(function(g){ return g.gender === gender || !g.gender; });
    }
    
    log('Opening reader gallery, charId:', charId, 'gender:', gender, 'groups:', groups.length);
    
    closeLoadingModal();
    showCategories(groups, charId);
  }
  
  // ★ 読込中モーダル（クリック検知の視覚確認用）
  function showLoadingModal(){
    closeLoadingModal();
    var ov = document.createElement('div');
    ov.id = 'srvLoadingModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:20px 30px;border-radius:12px;font-size:14px;font-weight:600';
    box.textContent = '🎨 ギャラリー読込中...';
    ov.appendChild(box);
    document.body.appendChild(ov);
  }
  function closeLoadingModal(){
    var ov = document.getElementById('srvLoadingModal');
    if(ov) ov.remove();
  }
  
  // カテゴリー画面
  function showCategories(groups, charId){
    closeGalleryModal();
    
    var ov = document.createElement('div');
    ov.id = 'srvCustGal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99997;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.addEventListener('click', function(e){ if(e.target === ov) closeGalleryModal(); });
    
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;padding:20px';
    ov.appendChild(box);
    
    // ヘッダー
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
    var h3 = document.createElement('h3'); h3.textContent = '🎨 ギャラリー'; h3.style.cssText = 'margin:0;font-size:16px;font-weight:700';
    var closeBtn = document.createElement('button'); closeBtn.textContent = '✕'; closeBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:#666';
    closeBtn.addEventListener('click', closeGalleryModal);
    hdr.appendChild(h3); hdr.appendChild(closeBtn);
    box.appendChild(hdr);
    
    var desc = document.createElement('p'); desc.textContent = _t('カテゴリーを選んでください','Please select a category'); desc.style.cssText = 'font-size:12px;color:#666;margin:0 0 12px 0';
    box.appendChild(desc);
    
    // グリッド
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px';
    
    groups.forEach(function(g, idx){
      var btn = document.createElement('div');
      btn.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;padding:8px;cursor:pointer;text-align:center;background:#fafafa';
      
      if(g.items && g.items[0]){
        var img = document.createElement('img');
        img.src = g.items[0].p;
        img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:50%;background:#eee';
        img.loading = 'lazy';
        btn.appendChild(img);
      }
      
      var lbl = document.createElement('div'); lbl.textContent = g.label || ''; lbl.style.cssText = 'font-size:11px;margin-top:4px;font-weight:600';
      btn.appendChild(lbl);
      
      var cnt = document.createElement('div'); cnt.textContent = (g.items || []).length + '件'; cnt.style.cssText = 'font-size:10px;color:#666';
      btn.appendChild(cnt);
      
      // クロージャでgroupを保持
      (function(group){
        btn.addEventListener('click', function(){
          log('Category clicked:', group.label);
          showImages(group, groups, charId);
        });
      })(g);
      
      grid.appendChild(btn);
    });
    
    box.appendChild(grid);
    document.body.appendChild(ov);
  }
  
  // 画像一覧
  function showImages(group, allGroups, charId){
    closeGalleryModal();
    
    var ov = document.createElement('div');
    ov.id = 'srvCustGal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99997;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.addEventListener('click', function(e){ if(e.target === ov) closeGalleryModal(); });
    
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;padding:20px';
    ov.appendChild(box);
    
    // ヘッダー
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
    var hdrLeft = document.createElement('div');
    var backBtn = document.createElement('button'); backBtn.textContent = '← カテゴリ';
    backBtn.style.cssText = 'background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px';
    backBtn.addEventListener('click', function(){ showCategories(allGroups, charId); });
    hdrLeft.appendChild(backBtn);
    var lblSpan = document.createElement('span'); lblSpan.textContent = group.label || ''; lblSpan.style.cssText = 'margin-left:8px;font-weight:600';
    hdrLeft.appendChild(lblSpan);
    var closeBtn = document.createElement('button'); closeBtn.textContent = '✕'; closeBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:#666';
    closeBtn.addEventListener('click', closeGalleryModal);
    hdr.appendChild(hdrLeft); hdr.appendChild(closeBtn);
    box.appendChild(hdr);
    
    // 画像グリッド
    var imgGrid = document.createElement('div');
    imgGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;margin-bottom:12px';
    box.appendChild(imgGrid);
    
    var pager = document.createElement('div');
    pager.style.cssText = 'display:flex;justify-content:center;gap:8px;align-items:center';
    box.appendChild(pager);
    
    // ★ 先に DOM に追加（getElementById は使わないが、念のため）
    document.body.appendChild(ov);
    
    var perPage = 30;
    var page = 0;
    var items = group.items || [];
    var total = items.length;
    var pages = Math.ceil(total / perPage);
    
    function renderPage(){
      // クリア（DOM要素を全削除）
      while(imgGrid.firstChild) imgGrid.removeChild(imgGrid.firstChild);
      while(pager.firstChild) pager.removeChild(pager.firstChild);
      
      var start = page * perPage;
      var end = Math.min(start + perPage, total);
      
      for(var i = start; i < end; i++){
        var item = items[i];
        var img = document.createElement('img');
        img.src = item.p;
        img.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;background:#eee';
        img.loading = 'lazy';
        
        // ★ クロージャで src を保持
        (function(src){
          img.addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            log('Image clicked:', src, 'charId:', charId);
            closeGalleryModal();
            applyReaderIcon(charId, src);
          });
        })(item.p);
        
        imgGrid.appendChild(img);
      }
      
      if(pages > 1){
        var prevBtn = document.createElement('button');
        prevBtn.textContent = _t('← 前','← Prev');
        prevBtn.disabled = (page <= 0);
        prevBtn.style.cssText = 'background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px' + (page <= 0 ? ';opacity:0.5' : '');
        prevBtn.addEventListener('click', function(){ if(page > 0){ page--; renderPage(); } });
        pager.appendChild(prevBtn);
        
        var pageInfo = document.createElement('span');
        pageInfo.textContent = (page + 1) + ' / ' + pages;
        pageInfo.style.cssText = 'font-size:12px';
        pager.appendChild(pageInfo);
        
        var nextBtn = document.createElement('button');
        nextBtn.textContent = _t('次 →','Next →');
        nextBtn.disabled = (page >= pages - 1);
        nextBtn.style.cssText = 'background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px' + (page >= pages - 1 ? ';opacity:0.5' : '');
        nextBtn.addEventListener('click', function(){ if(page < pages - 1){ page++; renderPage(); } });
        pager.appendChild(nextBtn);
      }
    }
    renderPage();
  }
  
  function closeGalleryModal(){
    var ov = document.getElementById('srvCustGal');
    if(ov) ov.remove();
  }
  
  function applyReaderIcon(charId, src){
    log('Applying icon:', charId, src);
    if(!window.state.readerCustom) window.state.readerCustom = {};
    if(!window.state.readerCustom[charId]) window.state.readerCustom[charId] = {};
    window.state.readerCustom[charId].iconImage = src;
    if(typeof window.saveReaderCustom === 'function'){
      try { window.saveReaderCustom(window._workParam || getCurrentWorkId()); log('saveReaderCustom called'); } catch(e){ log('saveReaderCustom err:', e); }
    }
    if(typeof window.render === 'function') window.render();
    showToast(_t('✅ アイコン設定','✅ Icon applied'));
  }
  
  // ボタン挿入: v1.16 で削除（viewer.html の標準ギャラリーボタンを使う）
  function setupGalleryButtons(){
    // 既存の挿入済みボタンがあればクリーンアップ
    document.querySelectorAll('[data-srv-gal="1"]').forEach(function(el){ el.remove(); });
  }
  
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
  
  function hookResetButton(){
    document.querySelectorAll('button').forEach(function(btn){
      if(btn.dataset.srvResetHooked) return;
      var oc=btn.getAttribute('onclick')||'';
      var t=(btn.textContent||'').trim();
      if(oc.indexOf('resetToAuthorDefaults')!==-1 || t==='作者推奨に戻す' || (t.indexOf('推奨')!==-1 && t.indexOf('戻')!==-1)){
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
      }
    });
  }
  function forceResetReaderCustom(){
    var workId=window._workParam||getCurrentWorkId();
    if(!confirm(_t('読者カスタマイズを完全にクリアし、作者推奨の設定に戻しますか？','Completely clear reader customization and reset to author defaults?'))) return;
    try {
      if(window.state){ window.state.readerCustom=null; window.state.readerCustomOpen=false; }
      try { var profiles=JSON.parse(localStorage.getItem('aninovel_reader_profiles')||'{}'); if(profiles[workId]){
        Object.keys(profiles[workId]).forEach(function(pn){
          if(profiles[workId][pn] && profiles[workId][pn].readerCustom) profiles[workId][pn].readerCustom=null;
          if(profiles[workId][pn] && typeof profiles[workId][pn]==='object') delete profiles[workId][pn].readerCustom;
        }); localStorage.setItem('aninovel_reader_profiles', JSON.stringify(profiles)); } } catch(e){}
      try { var d=JSON.parse(localStorage.getItem('aninovel_data')||'{}'); if(d && d.readerCustom){ delete d.readerCustom; localStorage.setItem('aninovel_data', JSON.stringify(d)); } } catch(e){}
      if(typeof window.saveReaderCustom==='function'){ try { window.saveReaderCustom(workId); } catch(e){} }
      if(typeof window.render==='function') window.render();
      showToast(_t('✅ 作者推奨に戻しました','✅ Reset to author defaults'));
    } catch(e){ alert('❌ '+e.message); }
  }
  
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
    openGallery:openReaderGallery,
    getWorkId:getCurrentWorkId, getUserId:getCurrentUserId, isAuthor:isAuthorMode,
    forceRender:function(){ if(window.render){ try{ window.render(); console.log('rendered'); }catch(e){ console.log(e); } } }
  };
  log('Loaded v1.16.0');
})();

// deploy: 20260530195429