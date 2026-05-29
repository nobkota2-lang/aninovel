/* ====================================================
 * AniNovel Server Save (v1.8.0)
 * 
 * v1.8 修正:
 * - 独自ギャラリーモーダル（viewer.htmlのopenGallery依存解消）
 * - 読者モードで👥(登場人物リスト)ボタンを非表示
 * - 「作者推奨に戻す」ボタンを強制リセットに置き換え
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
    try { var r=await fetch('/api/works/'+encodeURIComponent(w)+'?version='+ver); var d=await r.json(); if(!d.data){ alert('失敗'); return; }
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
  // 読者設定 PC/クラウド保存
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
  function saveReaderSettingsLocal(){
    var s=collectReaderSettings(); var blob=new Blob([JSON.stringify(s,null,2)],{type:'application/json'});
    var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url;
    a.download='aninovel-settings-'+(getCurrentWorkId()||'all')+'-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'.json';
    document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(url); a.remove();},100);
    showToast('💾 PCにダウンロード');
  }
  function loadReaderSettingsLocal(){
    var inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json'; inp.style.display='none';
    inp.onchange=function(e){ var f=e.target.files&&e.target.files[0]; if(!f){inp.remove(); return;}
      var r=new FileReader(); r.onload=function(ev){ try { var s=JSON.parse(ev.target.result); if(!s._appVersion && !confirm('AniNovelファイルでない可能性。続行?')) return; var ok=applyReaderSettings(s); showToast(ok?'✅ 設定読込':'✅ localStorage更新'); } catch(err){ alert('❌ '+err.message); } };
      r.readAsText(f); setTimeout(function(){inp.remove();},1000);
    };
    document.body.appendChild(inp); inp.click();
  }
  async function saveReaderSettingsCloud(silent){
    var uid=getCurrentUserId(); if(!uid){ if(!silent) alert('ログイン要'); return false; }
    var s=collectReaderSettings(); var note=silent?'':prompt('保存メモ:',''); if(!silent && note===null) return false;
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:s,note:note||'読者設定'})});
      var d=await r.json(); if(r.ok && d.ok){ if(!silent) alert('☁ クラウド保存\nv:'+(d.versionCount||0)); else showToast('☁ 保存完了','#0ea5e9'); return true; }
      else { if(!silent) alert('❌ '+(d.error||r.status)); return false; }
    } catch(e){ if(!silent) alert('❌ '+e.message); return false; }
  }
  async function loadReaderSettingsCloud(){
    var uid=getCurrentUserId(); if(!uid){ alert('ログイン要'); return false; }
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings');
      if(r.status===404){ alert('クラウドに設定なし'); return false; }
      var s=await r.json(); var ok=applyReaderSettings(s); showToast(ok?'☁ 設定読込':'☁ localStorage更新','#0ea5e9'); return true;
    } catch(e){ alert('❌ '+e.message); return false; }
  }
  async function showReaderHistory(){
    var uid=getCurrentUserId(); if(!uid){ alert('ログイン要'); return; }
    try { var r=await fetch('/api/users/'+encodeURIComponent(uid)+'/settings?versions=1'); var d=await r.json();
      showHistoryModal('📜 設定履歴', (d.versions||[]).slice().reverse(), async function(v){
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
      if(r.status===404) return; var s=await r.json(); applyReaderSettings(s); showToast('☁ クラウドから設定を読込','#0ea5e9');
    } catch(e){ log('AutoLoad err:',e); }
  }
  
  function setupReaderButtons(){
    if(isAuthorMode()) return;
    if(document.getElementById('srvReaderInline')) return;
    var tb=document.querySelector('.toolbar'); if(!tb) return;
    var c=document.createElement('div'); c.id='srvReaderInline';
    c.style.cssText='display:inline-flex;gap:4px;align-items:center;margin-left:8px;flex-wrap:wrap';
    function mk(t,ti,cb,co){ var b=document.createElement('button'); b.textContent=t; b.title=ti; b.className='btn';
      b.style.cssText='background:#fff;color:'+(co||'#6366f1')+';border:1px solid '+(co||'#6366f1')+';padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600';
      b.onclick=cb; return b; }
    c.appendChild(mk('💾 PC保存','個人設定をPCに',saveReaderSettingsLocal));
    c.appendChild(mk('📁 PC読込','PCから設定',loadReaderSettingsLocal));
    var uid=getCurrentUserId();
    if(uid){
      c.appendChild(mk('☁ クラウド保存','サーバー保存',function(){ saveReaderSettingsCloud(false); },'#0ea5e9'));
      c.appendChild(mk('☁ 読込','クラウドから',loadReaderSettingsCloud,'#0ea5e9'));
      c.appendChild(mk('📜','設定履歴',showReaderHistory,'#0ea5e9'));
    }
    tb.appendChild(c);
  }
  
  // ========================================
  // ★ NEW: 独自ギャラリーモーダル
  // ========================================
  var _galleryManifest = null;
  
  async function loadGalleryManifest(){
    if(_galleryManifest) return _galleryManifest;
    if(window.state && window.state.galleryManifest){ _galleryManifest=window.state.galleryManifest; return _galleryManifest; }
    try {
      var r=await fetch('/data/gallery-manifest.json');
      _galleryManifest = await r.json();
      if(window.state) window.state.galleryManifest = _galleryManifest;
      return _galleryManifest;
    } catch(e){ alert('manifest取得失敗: '+e.message); return null; }
  }
  
  async function openCustomGallery(charId, onSelect){
    var manifest = await loadGalleryManifest();
    if(!manifest) return;
    
    // 性別フィルタ
    var ch = window.state && window.state.characters && window.state.characters.find(function(c){ return c.id === charId; });
    var gender = ch ? ch.gender : null;
    var groups = manifest.groups.slice();
    if(gender === 'male' || gender === 'female'){
      groups = groups.filter(function(g){ return g.gender === gender || !g.gender; });
    }
    
    renderGalleryCategoryView(groups, charId, onSelect);
  }
  
  function renderGalleryCategoryView(groups, charId, onSelect){
    var old=document.getElementById('srvCustGallery'); if(old) old.remove();
    var ov=document.createElement('div'); ov.id='srvCustGallery';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick=function(e){ if(e.target===ov) ov.remove(); };
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;padding:20px';
    var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0;font-size:16px;font-weight:700">🎨 ギャラリーから選ぶ</h3><button id="srvGCClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666">✕</button></div>';
    html+='<p style="font-size:12px;color:#666;margin:0 0 12px 0">カテゴリーを選んでください</p>';
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">';
    groups.forEach(function(g, i){
      var sample = (g.items && g.items[0]) ? g.items[0].p : '';
      html+='<div data-idx="'+i+'" class="srvGCBtn" style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;cursor:pointer;text-align:center;background:#fafafa">';
      if(sample) html+='<img src="'+sample+'" style="width:64px;height:64px;object-fit:cover;border-radius:50%;background:#eee">';
      html+='<div style="font-size:11px;margin-top:4px;font-weight:600">'+escapeHtml(g.label||'')+'</div>';
      html+='<div style="font-size:10px;color:#666">'+((g.items||[]).length)+'件</div>';
      html+='</div>';
    });
    html+='</div>';
    box.innerHTML=html; ov.appendChild(box); document.body.appendChild(ov);
    document.getElementById('srvGCClose').onclick=function(){ ov.remove(); };
    box.querySelectorAll('.srvGCBtn').forEach(function(el){
      el.onclick=function(){
        var idx=parseInt(el.getAttribute('data-idx'),10);
        renderGalleryImageView(groups, idx, charId, onSelect);
      };
    });
  }
  
  function renderGalleryImageView(groups, idx, charId, onSelect){
    var old=document.getElementById('srvCustGallery'); if(old) old.remove();
    var grp=groups[idx]; if(!grp || !grp.items) return;
    var ov=document.createElement('div'); ov.id='srvCustGallery';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick=function(e){ if(e.target===ov) ov.remove(); };
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;padding:20px';
    var perPage=30; var page=0; var total=grp.items.length; var pages=Math.ceil(total/perPage);
    
    function renderPage(){
      var start=page*perPage, end=Math.min(start+perPage, total);
      var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><button id="srvGCBack" style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px">← カテゴリ</button> <span style="margin-left:8px;font-weight:600">'+escapeHtml(grp.label||'')+'</span></div><button id="srvGCClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666">✕</button></div>';
      html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;margin-bottom:12px">';
      for(var i=start; i<end; i++){
        var it=grp.items[i];
        html+='<img class="srvGCImg" data-src="'+escapeHtml(it.p)+'" src="'+escapeHtml(it.p)+'" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;background:#eee" loading="lazy">';
      }
      html+='</div>';
      if(pages>1){
        html+='<div style="display:flex;justify-content:center;gap:8px;align-items:center"><button id="srvGCPrev" '+(page<=0?'disabled':'')+' style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px'+(page<=0?';opacity:0.5':'')+'">← 前</button><span style="font-size:12px">'+(page+1)+' / '+pages+'</span><button id="srvGCNext" '+(page>=pages-1?'disabled':'')+' style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px'+(page>=pages-1?';opacity:0.5':'')+'">次 →</button></div>';
      }
      box.innerHTML=html;
      document.getElementById('srvGCClose').onclick=function(){ ov.remove(); };
      document.getElementById('srvGCBack').onclick=function(){ ov.remove(); renderGalleryCategoryView(groups, charId, onSelect); };
      var prev=document.getElementById('srvGCPrev'); if(prev) prev.onclick=function(){ if(page>0){ page--; renderPage(); } };
      var next=document.getElementById('srvGCNext'); if(next) next.onclick=function(){ if(page<pages-1){ page++; renderPage(); } };
      box.querySelectorAll('.srvGCImg').forEach(function(img){
        img.onclick=function(){
          var src=img.getAttribute('data-src');
          ov.remove();
          onSelect(src);
        };
      });
    }
    renderPage();
    ov.appendChild(box); document.body.appendChild(ov);
  }
  
  // ========================================
  // ギャラリーボタン挿入（独自モーダルを開く）
  // ========================================
  function setupGalleryButtons(){
    document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(input){
      var label=input.closest('label'); if(!label) return;
      if(label.parentNode.querySelector('[data-srv-gal="1"]')) return;
      var onchange=input.getAttribute('onchange')||'';
      var isReader=onchange.indexOf('readerCustom')!==-1;
      var isAuthor=onchange.indexOf('state.editingItem')!==-1;
      if(!isReader && !isAuthor) return;
      
      var btn=document.createElement('button');
      btn.setAttribute('data-srv-gal','1');
      btn.type='button';
      btn.className='btn';
      btn.style.cssText='background:#10b981;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-left:6px';
      btn.textContent='🎨 ギャラリーから選ぶ';
      btn.onclick=function(e){
        e.preventDefault();
        var charId, onSelect;
        if(isReader){
          charId=window.state.readerCustomCharId;
          if(!charId){ alert('キャラ未選択'); return false; }
          onSelect=function(src){
            if(!window.state.readerCustom) window.state.readerCustom={};
            if(!window.state.readerCustom[charId]) window.state.readerCustom[charId]={};
            window.state.readerCustom[charId].iconImage=src;
            if(typeof window.saveReaderCustom==='function') window.saveReaderCustom(window._workParam||getCurrentWorkId());
            if(typeof window.render==='function') window.render();
            showToast('✅ アイコン設定');
          };
        } else {
          if(!window.state.editingItem || !window.state.editingItem.data){ alert('編集対象なし'); return false; }
          charId=window.state.editingItem.data.id;
          onSelect=function(src){
            window.state.editingItem.data.iconImage=src;
            if(typeof window.render==='function') window.render();
            showToast('✅ アイコン設定');
          };
        }
        openCustomGallery(charId, onSelect);
        return false;
      };
      label.parentNode.insertBefore(btn, label.nextSibling);
    });
  }
  
  // ========================================
  // 著作権警告（作者モードのみ）
  // ========================================
  function setupCopyrightWarning(){
    document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(input){
      if(input.dataset.srvCopy) return;
      var oc=input.getAttribute('onchange')||'';
      if(oc.indexOf('state.editingItem')===-1) return; // 作者用のみ
      input.dataset.srvCopy='1';
      input.addEventListener('change', function(e){
        if(!isAuthorMode()) return;
        if(window._srvCopyOk) return;
        var ok=confirm('⚠️ 著作権に関する注意\n\nこの画像は作品の一部として公開されます。\n\n以下は使用しないでください:\n・著名人・芸能人の写真\n・アニメ/漫画/ゲームのキャラクター\n・他者の写真（無許可）\n・ロゴ・商標\n\n違反は法的措置の対象になり得ます。\n続行しますか？');
        if(!ok){ input.value=''; e.preventDefault(); e.stopPropagation(); return false; }
        window._srvCopyOk=true;
      }, true);
    });
  }
  
  // ========================================
  // ★ NEW: 「作者推奨に戻す」ボタンをフック
  // ========================================
  function hookResetButton(){
    document.querySelectorAll('button').forEach(function(btn){
      if(btn.dataset.srvResetHooked) return;
      var oc=btn.getAttribute('onclick')||'';
      var t=(btn.textContent||'').trim();
      if(oc.indexOf('resetToAuthorDefaults')!==-1 || t.indexOf('作者推奨に戻す')!==-1 || t.indexOf('作者推奨')!==-1){
        btn.dataset.srvResetHooked='1';
        btn.removeAttribute('onclick');
        btn.onclick=function(e){
          e.preventDefault();
          forceResetReaderCustom();
          return false;
        };
        log('Reset button hooked');
      }
    });
  }
  
  function forceResetReaderCustom(){
    var workId=window._workParam||getCurrentWorkId();
    if(!confirm('この作品の読者カスタマイズを完全にクリアし、作者推奨の設定に戻しますか？\n（現在のプロファイルに影響）')) return;
    try {
      if(window.state){
        window.state.readerCustom=null;
        window.state.readerCustomOpen=false;
      }
      // localStorage の reader_profiles 内の該当作品をクリア
      try {
        var profiles=JSON.parse(localStorage.getItem('aninovel_reader_profiles')||'{}');
        if(profiles[workId]){
          Object.keys(profiles[workId]).forEach(function(pn){
            if(profiles[workId][pn] && profiles[workId][pn].readerCustom){
              profiles[workId][pn].readerCustom=null;
            }
          });
          localStorage.setItem('aninovel_reader_profiles', JSON.stringify(profiles));
        }
      } catch(e){ log('LS reset:',e); }
      // viewer.html の関数も呼ぶ（あれば）
      if(typeof window.saveReaderCustom==='function'){
        try { window.saveReaderCustom(workId); } catch(e){}
      }
      if(typeof window.render==='function') window.render();
      showToast('✅ 作者推奨の設定に戻しました');
    } catch(e){ alert('❌ '+e.message); }
  }
  
  // ========================================
  // ★ NEW: 読者モードで「登場人物リスト」ボタンを非表示
  // ========================================
  function hideCharacterListButtonInReader(){
    if(isAuthorMode()) return;
    document.querySelectorAll('button').forEach(function(btn){
      if(btn.dataset.srvHiddenChar) return;
      var t=(btn.textContent||'').trim();
      var title=btn.getAttribute('title')||'';
      // 👥 アイコン or 「登場人物」 ボタン
      if(t==='👥' || t.indexOf('👥')!==-1 || title.indexOf('登場人物')!==-1){
        btn.dataset.srvHiddenChar='1';
        btn.dataset.srvOrigDisplay=btn.style.display||'';
        btn.style.display='none';
        log('Hidden char list button in reader');
      }
    });
  }
  // 作者モードに戻った時、表示を復元
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
    ['srvSaveContainer','srvReaderContainer','srvAuthorFloating'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
  }
  function setupAll(){
    removeOldFloating();
    if(isAuthorMode()){
      var r=document.getElementById('srvReaderInline'); if(r) r.remove();
      restoreCharacterListButton(); // 作者は登場人物リスト見れる
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
    saveLocal:saveReaderSettingsLocal, loadLocal:loadReaderSettingsLocal,
    saveCloud:function(){ return saveReaderSettingsCloud(false); }, loadCloud:loadReaderSettingsCloud, showCloudHistory:showReaderHistory,
    forceReset:forceResetReaderCustom,
    openGallery:function(charId, onSelect){ openCustomGallery(charId||window.state.readerCustomCharId, onSelect||function(s){ console.log('selected:',s); }); },
    getWorkId:getCurrentWorkId, getUserId:getCurrentUserId, isAuthor:isAuthorMode,
    forceRender:function(){ if(window.render){ try{ window.render(); console.log('rendered'); }catch(e){ console.log(e); } } }
  };
  log('Loaded v1.8.0');
})();

// deploy: 20260529220057