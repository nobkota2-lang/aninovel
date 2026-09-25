/* ====================================================
 * AniNovel Server Save (v1.18.0)
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
  function getCatalogMeta(){ try { var w=getCurrentWorkId(); var pl=getWorkPayload(); if(!w||!pl||!pl.novel) return null; var nv=pl.novel; var content=Array.isArray(pl.content)?pl.content:[]; var chars=Array.isArray(pl.characters)?pl.characters:[]; var cc=content.reduce(function(s,it){return s+(((it.text||it.html||'')+'').length);},0); var pg=content.filter(function(x){return x&&(x.type==='pageBreak'||x.type==='page'||x.type==='chapter');}).length; return { id:w, title:nv.title||'無題', author:nv.author||'', description:nv.description||'', coverColor:nv.coverColor||'#6366F1', coverImage:nv.coverImage||'', pageCount:(pg>0?pg:1), charCount:cc, characterCount:chars.length, tags:(Array.isArray(nv.tags)?nv.tags:[]), sourceLang:(nv.sourceLang||'ja'), createdAt:nv.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString() }; } catch(e){ return null; } }
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
      var body={ data:p, note:note||'公開保存' }; var m=getCatalogMeta(); if(m){ try{ var _src=(m.sourceLang||'ja'); var _tgt=(_src==='en')?'ja':'en'; var _sfx=(_tgt==='en')?'En':'Ja';
        // カード訳の方針: 手書きの訳は守り、原文が変わったフィールドだけ機械翻訳で更新する。
        // 判定材料は「カタログに入っている前回の原文」。訳だけ手で直しても原文は変わらないので手書きは保護される。
        var _pv=null;
        try{ var _cr=await fetch('/api/catalog?t='+Date.now(),{cache:'no-store'}); if(_cr.ok){ var _cj=await _cr.json(); var _cl=_cj.works||_cj.items||_cj.list||(Array.isArray(_cj)?_cj:[]); _pv=_cl.filter(function(w){return (w.id||w.workId)===m.id;})[0]||null; } }catch(_pe){}
        var _need={};
        ['title','author','description'].forEach(function(f){
          if(!_pv){ _need[f]=true; return; }                       // 新規公開 → 全部生成
          if(!_pv[f+_sfx]){ _need[f]=true; return; }               // 訳がまだ無い → 生成
          _need[f]=((_pv[f]||'')!==(m[f]||''));                    // 原文が変わった → 再生成
          if(!_need[f]) m[f+_sfx]=_pv[f+_sfx];                     // 変わっていない → 既存の訳を維持
        });
        if(_pv&&_pv['tags'+_sfx]&&!m['tags'+_sfx]) m['tags'+_sfx]=_pv['tags'+_sfx];
        if(_need.title||_need.author||_need.description){
          var _tr=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:_tgt,source:_src,title:m.title||'',author:m.author||'',items:[{id:'d',text:m.description||''}],characters:[]})});
          if(_tr.ok){ var _tj=await _tr.json(); if(_tj){ if(_need.title&&_tj.title)m['title'+_sfx]=_tj.title; if(_need.author&&_tj.author)m['author'+_sfx]=_tj.author; if(_need.description&&_tj.items&&_tj.items[0]&&_tj.items[0].text)m['description'+_sfx]=_tj.items[0].text; } }
          console.info('[Publish] 原文が変わったので訳を更新:',Object.keys(_need).filter(function(k){return _need[k];}).join(', '));
        } else { console.info('[Publish] 原文に変更なし → 手書きの訳を維持しました'); }
      }catch(_te){console.warn('[Publish] カードmeta翻訳スキップ:',_te);} body.meta=m; }
      var r=await fetch('/api/author/works/'+encodeURIComponent(w),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var d=await r.json();
      if(r.ok && d.ok){ try{ if(typeof saveData==='function') saveData(true); }catch(_e){} if(!silent) alert('✅ 保存完了\nv:'+(d.versionCount||0)); else showToast('✅ 公開保存完了'); return true; }
      else if(r.status===401){
        // Cloudflare Access の有効期限切れ。fetch の中ではログイン画面へ
        // 進めないので、別タブで開いてもらう。
        if(!silent && confirm(_t('ログインの有効期限が切れました。ログイン画面を開きますか。\nログイン後、もう一度保存してください。',
          'Your login has expired. Open the login page?\nSave again after signing in.'))){
          window.open('/api/author/works/'+encodeURIComponent(w), '_blank');
        }
        return false;
      }
      else if(r.status===403){
        if(!silent) alert(_t('この作品を編集する権限がありません。',
          'You do not have permission to edit this work.'));
        return false;
      }
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
      var pr=await fetch('/api/author/works/'+encodeURIComponent(w),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d.data,note:'v'+ver+'復元'})});
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
  // viewer.html がすでに「📤 公開保存 / 📢 上書き公開」を出しているので、
  // ここで同じボタンをもう1つ足さない。作品の版履歴(📜)だけを添える。
  function setupAuthorButtons(){
    if(!isAuthorMode()) return;
    if(document.querySelector('[data-srv-hist]')) return;
    var sb=findNativeSaveButton(); if(!sb||!sb.parentNode) return;
    var hb=document.createElement('button'); hb.setAttribute('data-srv-hist','1'); hb.textContent='📜';
    hb.className=sb.className||'btn';
    hb.title=_t('この作品の保存履歴（前の版に戻せます）','Version history for this work');
    hb.style.cssText='background:#fff;color:#6366f1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid #6366f1;cursor:pointer;margin-left:4px';
    hb.onclick=function(e){ e.preventDefault(); showWorkHistory(); return false; };
    sb.parentNode.insertBefore(hb, sb.nextSibling);
  }
  
  // ========================================
  // 読者クラウド保存 … v1.17.0 で撤去
  //   読者の設定(吹き出しの色・アイコン・音声)の保存と読み込みは
  //   viewer.html の「🎨 読み方の設定」に一本化した。
  //   ここにあった ☁設定保存 / ☁読込 / 📜設定の履歴 の3ボタンは
  //   同じことを別の保存先(/api/users/:id/settings)で行う二重実装で、
  //   ツールバーに並んで利用者を混乱させていたため削除する。
  //   起動時の自動読込(autoLoadOnStart)も、保存しておいた
  //   localStorage をまるごと書き戻す作りで、ログイン情報
  //   (aninovel_user)まで古い内容に戻してしまうため削除する。
  // ========================================
  function _removedReaderCloud(){
    alert(_t('読者の設定は、ビューアの「🎨 読み方の設定」から保存・読み込みしてください。',
             'Reader settings moved to "🎨 Reading style" in the viewer.'));
    return false;
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
  
  // hookResetButton / forceResetReaderCustom … v1.17.0 で撤去。
  //   「…推奨…戻す」という文字を含むボタンを片端から乗っ取って、
  //   作品まるごとのリセットに差し替えていた。そのため
  //   「このキャラだけ…に戻す」を押しても全キャラが消えていた。
  //   リセットは viewer.html 側の処理にまかせる。
  function forceResetReaderCustom(){ return _removedReaderCloud(); }

  // hideCharacterListButtonInReader / restoreCharacterListButton … v1.18.0 で撤去。
  //   ボタンの文字(👥)や title を手当たり次第に探して隠す作りだったため、
  //   作者モードの登場人物ボタンまで巻き添えで消えることがあった。
  //   だれに 👥 を見せるかは viewer.html が役割で判断する
  //   (作者本人の作品とオーナーだけ)。
  function hideCharacterListButtonInReader(){}
  function restoreCharacterListButton(){
    // 旧版に隠されたままのボタンがあれば元に戻す
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
      restoreCharacterListButton();
    }
    setupGalleryButtons();
    setupCopyrightWarning();
    // 念のため、古い版が残した読者用ボタンがあれば消す
    var _old=document.getElementById('srvReaderInline'); if(_old) _old.remove();
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
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  
  window.AniNovelServerSave={
    save:function(){ return saveToServer(false); }, showHistory:showWorkHistory,
    saveCloud:_removedReaderCloud, loadCloud:_removedReaderCloud, showCloudHistory:_removedReaderCloud,
    forceReset:forceResetReaderCustom,
    openGallery:openReaderGallery,
    getWorkId:getCurrentWorkId, getUserId:getCurrentUserId, isAuthor:isAuthorMode,
    forceRender:function(){ if(window.render){ try{ window.render(); console.log('rendered'); }catch(e){ console.log(e); } } }
  };
  log('Loaded v1.18.0 (reader cloud buttons + DOM hijacks removed)');
})();

// deploy: 20260530195429