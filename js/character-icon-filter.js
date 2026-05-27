/* ====================================================
 * AniNovel Character Icon Filter (v2.0.0)
 * 
 * 4グループシンプル構造対応版:
 *  - 男性写真 / 男性イラスト / 女性写真 / 女性イラスト
 *  - キャラの性別で 2 グループに自動絞り込み
 *  - ID と data 属性ベースで確実なフィルタ
 * 
 * 配置先: /js/character-icon-filter.js
 * 読み込み: viewer.html の </body> 直前に
 *   <script src="js/character-icon-filter.js"></script>
 * 
 * 安全設計:
 *  - 既存関数を一切上書きしない
 *  - DOM 表示後にボタンの display を切り替えるだけ
 *  - 問題があれば script タグを削除すれば元通り
 * ==================================================== */

(function(){
  'use strict';
  
  var DEBUG = true;
  function log(){
    if(DEBUG && console && console.log){
      console.log.apply(console, ['[IconFilter v2]'].concat([].slice.call(arguments)));
    }
  }
  
  // ========================================
  // 現在編集中のキャラクター性別を取得
  // ========================================
  function getCurrentCharGender(){
    if(typeof window.state === 'undefined' || !window.state) return null;
    
    var st = window.state;
    var characters = st.characters;
    if(!characters || !Array.isArray(characters)) return null;
    
    // 候補となるキャラクター ID 変数
    var candidates = [
      'characterId',
      'readerCustomCharId',
      'editingCharacterId',
      'editCharId',
      'selectedCharId'
    ];
    
    var cid = null;
    var matchedKey = null;
    for(var i = 0; i < candidates.length; i++){
      if(st[candidates[i]]){
        cid = st[candidates[i]];
        matchedKey = candidates[i];
        break;
      }
    }
    
    if(!cid){
      log('No character ID found in state. Available state keys:', Object.keys(st).filter(function(k){return k.indexOf('har')!==-1||k.indexOf('Char')!==-1;}));
      return null;
    }
    
    log('Character ID source:', matchedKey, '=', cid);
    
    var ch = characters.find(function(c){return c && c.id === cid;});
    if(!ch){
      log('Character not found:', cid);
      return null;
    }
    
    var gender = ch.gender;
    log('Character:', ch.name, '| gender:', gender);
    
    // 'neutral' (語り手等) は フィルタしない
    if(gender === 'neutral' || gender === '中性'){
      log('Neutral - no filter');
      return null;
    }
    
    return gender;  // 'male' or 'female'
  }
  
  // ========================================
  // ボタンに紐付くグループ ID を判定
  // ========================================
  function getButtonGroupGender(btn){
    // 1. ボタンの onclick から推測 (state.galleryGroup = 'male_xxx' などのパターン)
    var onclick = btn.getAttribute('onclick') || '';
    if(onclick.indexOf('male_') !== -1 && onclick.indexOf('female_') === -1) return 'male';
    if(onclick.indexOf('female_') !== -1) return 'female';
    
    // 2. ボタンのテキストから判定 (フォールバック)
    var text = (btn.textContent || '').toLowerCase();
    var hasFemale = text.indexOf('女性') !== -1 || text.indexOf('女子') !== -1;
    var hasMale = text.indexOf('男性') !== -1 || text.indexOf('男子') !== -1;
    if(hasFemale && !hasMale) return 'female';
    if(hasMale && !hasFemale) return 'male';
    
    return null;
  }
  
  // ========================================
  // ギャラリーモーダル内のカテゴリーをフィルタ
  // ========================================
  function applyGenderFilter(){
    var targetGender = getCurrentCharGender();
    if(!targetGender){
      log('No target gender, no filter applied');
      return;
    }
    
    var modals = document.querySelectorAll('.modal-overlay');
    var galleryModal = null;
    for(var i = 0; i < modals.length; i++){
      var content = modals[i].textContent || '';
      if(content.indexOf('キャラクター画像ギャラリー') !== -1){
        galleryModal = modals[i];
        break;
      }
    }
    
    if(!galleryModal){
      log('Gallery modal not found');
      return;
    }
    
    log('Applying filter for:', targetGender);
    
    var buttons = galleryModal.querySelectorAll('button');
    var hiddenCount = 0;
    var shownCount = 0;
    
    buttons.forEach(function(btn){
      var btnText = (btn.textContent || '').trim();
      
      // 制御ボタンは除外
      if(btnText.length < 2) return;
      if(btnText.indexOf('戻る') !== -1) return;
      if(btnText.indexOf('リセット') !== -1) return;
      if(btnText.indexOf('カテゴリーに戻る') !== -1) return;
      if(btnText === 'すべて') return;
      if(btnText.indexOf('前') !== -1 && btnText.length < 5) return;
      if(btnText.indexOf('次') !== -1 && btnText.length < 5) return;
      if(btnText === '✕' || btnText === '×') return;
      
      var btnGender = getButtonGroupGender(btn);
      if(btnGender && btnGender !== targetGender){
        btn.style.display = 'none';
        hiddenCount++;
      } else if(btnGender === targetGender) {
        if(btn.style.display === 'none') btn.style.display = '';
        shownCount++;
      }
    });
    
    log('Filter result: shown=' + shownCount + ', hidden=' + hiddenCount);
    
    // タイトルにバッジ追加
    var titleEl = galleryModal.querySelector('h3');
    if(titleEl && titleEl.getAttribute('data-filter-applied') !== 'true'){
      var genderLabel = targetGender === 'male' ? '👨 男性のみ' : '👩 女性のみ';
      var badge = document.createElement('span');
      badge.style.cssText = 'font-size:11px;color:#6366f1;background:#eef2ff;padding:2px 8px;border-radius:10px;margin-left:8px;font-weight:600';
      badge.textContent = '[' + genderLabel + ']';
      titleEl.appendChild(badge);
      titleEl.setAttribute('data-filter-applied', 'true');
    }
  }
  
  // ========================================
  // MutationObserver で監視
  // ========================================
  function setupObserver(){
    var observer = new MutationObserver(function(mutations){
      var foundGallery = false;
      for(var i = 0; i < mutations.length; i++){
        var m = mutations[i];
        for(var j = 0; j < m.addedNodes.length; j++){
          var node = m.addedNodes[j];
          if(node.nodeType === 1){
            var text = node.textContent || '';
            if(text.indexOf('キャラクター画像ギャラリー') !== -1){
              foundGallery = true;
              break;
            }
          }
        }
        if(foundGallery) break;
      }
      
      if(foundGallery){
        setTimeout(applyGenderFilter, 50);
        setTimeout(applyGenderFilter, 200);
        setTimeout(applyGenderFilter, 500);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    log('Observer installed');
  }
  
  function init(){
    if(document.body){
      setupObserver();
      log('v2.0.0 loaded - 4-group structure');
    } else {
      setTimeout(init, 100);
    }
  }
  
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // 公開（デバッグ用）
  window.AniNovelIconFilter = {
    applyFilter: applyGenderFilter,
    getCurrentGender: getCurrentCharGender,
    showDebugInfo: function(){
      console.log('=== AniNovel Icon Filter Debug v2 ===');
      console.log('state available:', typeof window.state !== 'undefined');
      if(window.state){
        var st = window.state;
        console.log('state.characterId:', st.characterId);
        console.log('state.readerCustomCharId:', st.readerCustomCharId);
        console.log('state.characters:', (st.characters || []).map(function(c){
          return {id:c.id, name:c.name, gender:c.gender};
        }));
      }
      console.log('Detected gender:', getCurrentCharGender());
    },
    setDebug: function(v){DEBUG = !!v; log('Debug:', DEBUG);}
  };
  
  if(console && console.log) console.log('[IconFilter] Loaded v2.0.0');
})();
