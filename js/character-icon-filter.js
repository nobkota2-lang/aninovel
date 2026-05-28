/* ====================================================
 * AniNovel Character Icon Filter (v3.0.0)
 * 
 * 修正点 v3.0.0:
 *  - state.characterId に依存しない設計
 *  - DOM ベースで編集中キャラクターを特定
 *  - キャラカスタマイズモーダル内の性別ラジオを読み取り
 *  - 複数のフォールバック手法
 * 
 * 配置先: /js/character-icon-filter.js
 * 読み込み: viewer.html の </body> 直前に
 *   <script src="js/character-icon-filter.js"></script>
 * ==================================================== */

(function(){
  'use strict';
  
  var DEBUG = true;
  function log(){
    if(DEBUG && console && console.log){
      console.log.apply(console, ['[IconFilter v3]'].concat([].slice.call(arguments)));
    }
  }
  
  // ========================================
  // キャラカスタマイズモーダルを取得
  // ========================================
  function findCharCustomizeModal(){
    var modals = document.querySelectorAll('.modal-overlay');
    for(var i = 0; i < modals.length; i++){
      var content = modals[i].textContent || '';
      // キャラカスタマイズ または キャラクター + 性別 を含むモーダル
      if(content.indexOf('キャラカスタマイズ') !== -1){
        return modals[i];
      }
      if(content.indexOf('キャラクター') !== -1 && content.indexOf('性別') !== -1){
        return modals[i];
      }
    }
    return null;
  }
  
  // ========================================
  // 性別を取得（複数手法でフォールバック）
  // ========================================
  function getCurrentCharGender(){
    if(typeof window.state === 'undefined' || !window.state) return null;
    var st = window.state;
    
    // ==== 方法1: state の各種候補変数 ====
    var stateKeys = ['characterId', 'readerCustomCharId', 'editingCharacterId',
                     'editCharId', 'selectedCharId', 'currentCharId'];
    var cid = null;
    var matchedKey = null;
    for(var i = 0; i < stateKeys.length; i++){
      if(st[stateKeys[i]]){
        cid = st[stateKeys[i]];
        matchedKey = stateKeys[i];
        break;
      }
    }
    
    if(cid && st.characters && Array.isArray(st.characters)){
      var ch = st.characters.find(function(c){return c && c.id === cid;});
      if(ch){
        log('Method 1 (state.' + matchedKey + '): ', ch.name, '/', ch.gender);
        if(ch.gender === 'neutral' || ch.gender === '中性') return null;
        return ch.gender;
      }
    }
    
    // ==== 方法2: キャラクターカスタマイズモーダルから判定 ====
    var charModal = findCharCustomizeModal();
    if(charModal){
      log('Char modal found, trying DOM methods');
      
      // 2A. 性別ラジオボタン（checked）
      var radios = charModal.querySelectorAll('input[type="radio"]:checked');
      for(var i = 0; i < radios.length; i++){
        var r = radios[i];
        var v = String(r.value || '').toLowerCase().trim();
        log('Radio found:', r.name, '=', r.value);
        if(v === 'male' || v === 'm') return 'male';
        if(v === 'female' || v === 'f') return 'female';
        if(v === '男性' || v === '男' || v === '男子') return 'male';
        if(v === '女性' || v === '女' || v === '女子') return 'female';
      }
      
      // 2B. select 要素
      var selects = charModal.querySelectorAll('select');
      for(var i = 0; i < selects.length; i++){
        var s = selects[i];
        var v = String(s.value || '').toLowerCase().trim();
        log('Select found:', s.name, '=', s.value);
        if(v === 'male' || v === 'female') return v;
        if(v === '男性' || v === '男') return 'male';
        if(v === '女性' || v === '女') return 'female';
      }
      
      // 2C. モーダル内のキャラクター名から逆引き
      if(st.characters && Array.isArray(st.characters)){
        var modalText = charModal.textContent || '';
        for(var i = 0; i < st.characters.length; i++){
          var ch = st.characters[i];
          if(ch && ch.name && modalText.indexOf(ch.name) !== -1){
            log('Method 2C (name lookup):', ch.name, '/', ch.gender);
            if(ch.gender === 'neutral' || ch.gender === '中性') return null;
            return ch.gender;
          }
        }
      }
    }
    
    // ==== 方法3: ボタンのテキスト解析 (フォールバック) ====
    // モーダル内に "男性" "女性" のテキストがあれば、それで判定
    if(charModal){
      var text = charModal.textContent || '';
      // 「性別 男性」「性別 女性」「男性 ✓」「女性 ✓」などのパターン
      if(/性別[^性]{0,30}男性/.test(text) || /男性[\s]*●/.test(text) || /■\s*男性/.test(text)){
        return 'male';
      }
      if(/性別[^性]{0,30}女性/.test(text) || /女性[\s]*●/.test(text) || /■\s*女性/.test(text)){
        return 'female';
      }
    }
    
    log('Could not detect gender from any method');
    return null;
  }
  
  // ========================================
  // ボタンのグループ性別を判定
  // ========================================
  function getButtonGroupGender(btn){
    // 1. ボタンの onclick から推測
    var onclick = btn.getAttribute('onclick') || '';
    if(/male_/.test(onclick) && !/female_/.test(onclick)) return 'male';
    if(/female_/.test(onclick)) return 'female';
    
    // 2. ボタンのテキストから判定
    var text = (btn.textContent || '').toLowerCase();
    var hasFemale = text.indexOf('女性') !== -1 || text.indexOf('女子') !== -1;
    var hasMale = text.indexOf('男性') !== -1 || text.indexOf('男子') !== -1;
    if(hasFemale && !hasMale) return 'female';
    if(hasMale && !hasFemale) return 'male';
    
    return null;
  }
  
  // ========================================
  // フィルター適用
  // ========================================
  function applyGenderFilter(){
    var targetGender = getCurrentCharGender();
    if(!targetGender){
      log('No target gender - no filter applied (showing all)');
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
      } else if(btnGender === targetGender){
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
  // MutationObserver でモーダル監視
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
      log('v3.0.0 loaded - DOM-based gender detection');
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
      console.log('=== AniNovel Icon Filter Debug v3 ===');
      console.log('state.characters:', (window.state && window.state.characters) ? window.state.characters.map(function(c){return {id:c.id, name:c.name, gender:c.gender};}) : 'N/A');
      var modal = findCharCustomizeModal();
      console.log('Char modal found:', !!modal);
      if(modal){
        var radios = modal.querySelectorAll('input[type="radio"]:checked');
        console.log('Checked radios:', Array.from(radios).map(function(r){return {name:r.name, value:r.value};}));
        var selects = modal.querySelectorAll('select');
        console.log('Selects:', Array.from(selects).map(function(s){return {name:s.name, value:s.value};}));
      }
      console.log('Detected gender:', getCurrentCharGender());
    },
    setDebug: function(v){DEBUG = !!v; log('Debug:', DEBUG);}
  };
  
  if(console && console.log) console.log('[IconFilter] Loaded v3.0.0');
})();
