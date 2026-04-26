/* アニノベル 通報・モデレーション モジュール
 * 当面: 通報を localStorage にプール (送信成功するまで保持)
 * 将来: Supabase reports テーブルへ POST、運営側 dashboard で確認
 *
 * 公開API:
 *   AninovelModeration.openReportDialog({workId, targetType, targetId, ctx})
 *   AninovelModeration.listPending()
 *   AninovelModeration.flushPending()  // 設定後にエンドポイント送信
 *   AninovelModeration.openModerationPanel()  // 運営者専用UI
 */
(function(){
  'use strict';
  var QUEUE_KEY='aninovel_pending_reports_v1';
  var ENDPOINT=window.ANINOVEL_MODERATION_ENDPOINT||null; // 例: 'https://api.aninovel.com/reports'

  function loadQueue(){try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');}catch(e){return [];}}
  function saveQueue(q){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q));}catch(e){}}
  function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}

  // 通報理由(共通リスト)
  var REASONS=[
    {id:'copyright',label:'著作権侵害',desc:'第三者の著作物の無断転載・盗作・引用範囲を超える複製'},
    {id:'sexual',label:'わいせつ・性的に不適切',desc:'児童ポルノ、過度な性描写、合意なき性表現'},
    {id:'violence',label:'暴力・残虐',desc:'過度な暴力描写、残虐行為の助長'},
    {id:'hate',label:'差別・ヘイト',desc:'人種・民族・性別・宗教・性的指向に基づく差別'},
    {id:'harassment',label:'嫌がらせ・誹謗中傷',desc:'特定個人への攻撃、晒し行為、リベンジ目的'},
    {id:'privacy',label:'プライバシー侵害',desc:'個人情報・住所・連絡先の無断公開'},
    {id:'spam',label:'スパム・宣伝',desc:'広告、勧誘、無関係なリンクの大量投稿'},
    {id:'illegal',label:'違法行為',desc:'犯罪を肯定、薬物使用、詐欺、その他法令違反'},
    {id:'minor',label:'未成年者に有害',desc:'未成年者の保護に支障'},
    {id:'other',label:'その他',desc:'上記に該当しないが問題があると考えるもの'}
  ];

  function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  function getReporter(){
    try{var u=JSON.parse(localStorage.getItem('aninovel_user'));return u&&u.id?{id:u.id,email:u.email||null}:{id:'anon',email:null};}catch(e){return {id:'anon'};}
  }

  function enqueue(report){
    var q=loadQueue();
    q.push(report);
    saveQueue(q);
    console.info('[Moderation] 通報をキューに追加 (合計'+q.length+'件)',report);
    // 即時送信を試みる
    flushPending();
  }

  async function flushPending(){
    if(!ENDPOINT)return;
    var q=loadQueue();if(!q.length)return;
    var remain=[];
    for(var i=0;i<q.length;i++){
      try{
        var r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q[i])});
        if(!r.ok){remain.push(q[i]);console.warn('[Moderation] 送信失敗 status='+r.status);}
        else console.info('[Moderation] 送信成功 id=',q[i].id);
      }catch(e){remain.push(q[i]);}
    }
    saveQueue(remain);
  }

  // ===== 通報ダイアログ =====
  function openReportDialog(opts){
    opts=opts||{};
    var existing=document.getElementById('aninovel-report-modal');if(existing)existing.remove();

    var ov=document.createElement('div');
    ov.id='aninovel-report-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Zen Kaku Gothic New",system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)ov.remove();};

    var bx=document.createElement('div');
    bx.style.cssText='background:#fff;color:#2D2A26;border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.4);font-size:14px;line-height:1.7';
    bx.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:18px;font-weight:700;color:#C0392B">⚠ 通報する</h3><button id="anrep-close" style="border:none;background:transparent;font-size:22px;cursor:pointer;color:#666">&times;</button></div>'
      +'<p style="color:#666;font-size:12px;margin-bottom:18px">通報内容は運営が確認します。虚偽通報は禁止されています(<a href="/aninovel/legal/terms.html" style="color:#C0392B">利用規約</a>)。</p>'
      +'<div style="margin-bottom:14px"><label style="display:block;font-weight:600;margin-bottom:6px">対象</label><div style="background:#F5EFE6;padding:10px 12px;border-radius:6px;font-size:13px;color:#666">'
        +'種別: '+escHtml(opts.targetType||'work')+' / ID: '+escHtml(opts.targetId||opts.workId||'(unknown)')
        +(opts.ctx?'<br>'+escHtml(opts.ctx).slice(0,200):'')
      +'</div></div>'
      +'<div style="margin-bottom:14px"><label style="display:block;font-weight:600;margin-bottom:6px">理由 (必須)</label><div id="anrep-reasons" style="display:flex;flex-direction:column;gap:6px">'
        +REASONS.map(function(r){return '<label style="display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid #E2DCD4;border-radius:6px;cursor:pointer"><input type="radio" name="anrep-reason" value="'+r.id+'" style="margin-top:3px"><div><div style="font-weight:600">'+escHtml(r.label)+'</div><div style="font-size:11px;color:#888">'+escHtml(r.desc)+'</div></div></label>';}).join('')
      +'</div></div>'
      +'<div style="margin-bottom:14px"><label style="display:block;font-weight:600;margin-bottom:6px">詳細 (任意、最大1000文字)</label><textarea id="anrep-detail" rows="4" maxlength="1000" placeholder="該当箇所、具体的な侵害内容など" style="width:100%;padding:8px;border:1px solid #E2DCD4;border-radius:6px;resize:vertical;font-family:inherit;font-size:13px"></textarea></div>'
      +'<div style="margin-bottom:14px"><label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#666"><input type="checkbox" id="anrep-pledge"> 上記が真実であることを宣誓します</label></div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end"><button id="anrep-cancel" style="padding:10px 20px;border:1px solid #E2DCD4;background:#fff;border-radius:6px;cursor:pointer">キャンセル</button><button id="anrep-submit" style="padding:10px 24px;background:#C0392B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">通報する</button></div>'
      +'<div id="anrep-msg" style="margin-top:10px;font-size:12px;color:#C0392B;display:none"></div>';
    ov.appendChild(bx);
    document.body.appendChild(ov);

    function close(){ov.remove();}
    document.getElementById('anrep-close').onclick=close;
    document.getElementById('anrep-cancel').onclick=close;
    document.getElementById('anrep-submit').onclick=function(){
      var reasonEl=ov.querySelector('input[name="anrep-reason"]:checked');
      var detail=document.getElementById('anrep-detail').value.trim();
      var pledge=document.getElementById('anrep-pledge').checked;
      var msg=document.getElementById('anrep-msg');msg.style.display='block';
      if(!reasonEl){msg.textContent='通報理由を選択してください';return;}
      if(!pledge){msg.textContent='宣誓のチェックが必要です';return;}
      var rep={
        id:uid(),
        ts:new Date().toISOString(),
        reporter:getReporter(),
        targetType:opts.targetType||'work',
        targetId:opts.targetId||opts.workId||null,
        workId:opts.workId||null,
        reason:reasonEl.value,
        reasonLabel:(REASONS.find(function(r){return r.id===reasonEl.value;})||{}).label,
        detail:detail,
        ctx:opts.ctx||null,
        pageUrl:location.href,
        userAgent:navigator.userAgent,
        canary:(window.AninovelAntiPiracy&&window.AninovelAntiPiracy.getCanary&&window.AninovelAntiPiracy.getCanary())||null
      };
      enqueue(rep);
      bx.innerHTML='<div style="text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:12px">✓</div><h3 style="color:#10B981;font-weight:700;margin-bottom:8px">通報を受け付けました</h3><p style="color:#666;font-size:13px;line-height:1.7">運営にて確認の上、<br><a href="/aninovel/legal/dmca.html" style="color:#C0392B">著作権侵害通報窓口</a>に定める手続に従い対応します。<br><br>受付ID: <code style="background:#F5EFE6;padding:2px 6px;border-radius:3px">'+rep.id+'</code></p><div style="margin-top:20px"><button id="anrep-done" style="padding:10px 24px;background:#3D3A36;color:#fff;border:none;border-radius:6px;cursor:pointer">閉じる</button></div></div>';
      document.getElementById('anrep-done').onclick=close;
    };
  }

  // ===== 運営者用パネル =====
  function openModerationPanel(){
    var u;try{u=JSON.parse(localStorage.getItem('aninovel_user'));}catch(e){}
    var roles=u&&(u.roles||[u.role||'reader'])||[];
    if(!u||!u.loggedIn||(roles.indexOf('owner')<0&&roles.indexOf('admin')<0)){
      alert('運営者権限が必要です');return;
    }
    var ov=document.createElement('div');
    ov.id='aninovel-mod-panel';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
    var q=loadQueue();
    var inner='<div style="background:#fff;color:#2D2A26;border-radius:12px;max-width:880px;width:100%;max-height:90vh;overflow-y:auto;padding:24px"><div style="display:flex;justify-content:space-between;margin-bottom:16px"><h3 style="font-size:18px;font-weight:700">🛡️ モデレーション (送信待ち '+q.length+'件)</h3><button onclick="this.closest(\'#aninovel-mod-panel\').remove()" style="border:none;background:transparent;font-size:22px;cursor:pointer">&times;</button></div>';
    if(!q.length)inner+='<p style="text-align:center;color:#666;padding:30px">通報なし</p>';
    else{
      inner+='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#F5EFE6"><th style="padding:8px;text-align:left">受付時刻</th><th style="padding:8px;text-align:left">理由</th><th style="padding:8px;text-align:left">対象</th><th style="padding:8px;text-align:left">通報者</th><th style="padding:8px"></th></tr></thead><tbody>';
      q.forEach(function(r){
        inner+='<tr style="border-top:1px solid #E2DCD4"><td style="padding:8px">'+escHtml(r.ts)+'</td><td style="padding:8px"><strong>'+escHtml(r.reasonLabel||r.reason)+'</strong>'+(r.detail?'<br><small style="color:#666">'+escHtml(r.detail.slice(0,100))+'</small>':'')+'</td><td style="padding:8px">'+escHtml(r.targetType)+'<br><code style="font-size:11px">'+escHtml(r.targetId||'')+'</code></td><td style="padding:8px"><code style="font-size:11px">'+escHtml(r.reporter&&r.reporter.id||'?')+'</code></td><td style="padding:8px;text-align:right"><button data-rid="'+r.id+'" class="anmod-del" style="padding:4px 10px;border:1px solid #C0392B;background:#fff;color:#C0392B;border-radius:4px;cursor:pointer;font-size:12px">処理済</button></td></tr>';
      });
      inner+='</tbody></table><div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end"><button id="anmod-flush" style="padding:8px 16px;background:#3D3A36;color:#fff;border:none;border-radius:6px;cursor:pointer">サーバへ送信を再試行</button><button id="anmod-export" style="padding:8px 16px;background:#10B981;color:#fff;border:none;border-radius:6px;cursor:pointer">JSONダウンロード</button></div>';
    }
    inner+='</div>';
    ov.innerHTML=inner;
    document.body.appendChild(ov);

    ov.querySelectorAll('.anmod-del').forEach(function(b){
      b.onclick=function(){
        var id=b.dataset.rid;
        var q2=loadQueue().filter(function(r){return r.id!==id;});
        saveQueue(q2);ov.remove();openModerationPanel();
      };
    });
    var fl=document.getElementById('anmod-flush');if(fl)fl.onclick=function(){flushPending().then(function(){ov.remove();openModerationPanel();});};
    var ex=document.getElementById('anmod-export');if(ex)ex.onclick=function(){
      var blob=new Blob([JSON.stringify(loadQueue(),null,2)],{type:'application/json'});
      var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='aninovel_reports_'+new Date().toISOString().slice(0,10)+'.json';a.click();
    };
  }

  window.AninovelModeration={
    openReportDialog:openReportDialog,
    openModerationPanel:openModerationPanel,
    listPending:loadQueue,
    flushPending:flushPending,
    REASONS:REASONS
  };

  // 起動時に未送信があれば再送試行 (オフライン→オンライン復帰時の救済)
  if(navigator.onLine)flushPending();
  window.addEventListener('online',flushPending);

  console.info('[Moderation] 通報モジュール初期化完了。AninovelModeration.openReportDialog({workId:"..."}) で呼び出し。');
})();
