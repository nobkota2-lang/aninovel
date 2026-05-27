/* ====================================================
 * AniNovel Character Icon Filter (v1.0.0)
 * 
 * キャラクター画像ギャラリーを、編集中キャラクターの性別で
 * 自動的に絞り込むスクリプト。
 * 
 * 配置先: /js/character-icon-filter.js
 * 読み込み: viewer.html の </body> 直前に
 *   <script src="js/character-icon-filter.js"></script>
 * を追加するだけ
 * 
 * 安全設計:
 *  - 既存関数を一切上書きしない
 *  - MutationObserver で DOM 監視のみ
 *  - ボタン要素の display を切り替えるだけ
 *  - 問題があれば script タグを削除すれば元通り
 * ==================================================== */

(function(){
  'use strict';
  
  var DEBUG = false;
  function log(){if(DEBUG&&console&&console.log)console.log.apply(console,['[IconFilter]'].concat([].slice.call(arguments)));}
  
  // ========================================
  // 現在編集中のキャラクター性別を取得
  // ========================================
  function getCurrentCharGender(){
    if(typeof window.state === 'undefined' || !window.state) return null;
    
    var st = window.state;
    var cid = null;
    
    // 編集中のキャラクター ID を取得（複数の可能性をチェック）
    cid = st.editingCharacterId || st.readerCustomCharId || st.editCharId || null;
    
    // モーダルから推測（フォールバック）
    if(!cid){
      // キャラクターカスタマイズモーダルが開いているか
      var modal = document.querySelector('.modal-content');
      if(modal){
        // 性別を表示している要素を探す
        var allText = modal.textContent || '';
        if(allText.indexOf('男性') !== -1 && allText.indexOf('女性') === -1) return 'male';
        if(allText.indexOf('女性') !== -1 && allText.indexOf('男性') === -1) return 'female';
      }
    }
    
    if(!cid || !st.characters || !Array.isArray(st.characters)) return null;
    
    var ch = st.characters.find(function(c){return c && c.id === cid;});
    if(!ch) return null;
    
    // 性別属性を取得（複数のフィールド名に対応）
    var gender = ch.gender || ch.sex || null;
    
    // 日本語の場合は英語に変換
    if(gender === '男性' || gender === '男' || gender === '男子') gender = 'male';
    if(gender === '女性' || gender === '女' || gender === '女子') gender = 'female';
    
    log('Detected gender:', gender, 'for character:', cid);
    return gender;
  }
  
  // ========================================
  // ボタンのテキストから性別を判定
  // ========================================
  function getButtonGender(btn){
    var text = (btn.textContent || '').toLowerCase();
    // 日本語の性別表記をチェック
    var hasFemale = text.indexOf('女性') !== -1 || text.indexOf('女子') !== -1;
    var hasMale = text.indexOf('男性') !== -1 || text.indexOf('男子') !== -1;
    if(hasFemale && !hasMale) return 'female';
    if(hasMale && !hasFemale) return 'male';
    return null; // 性別の指定がない（写真 女性、男性、両方含む or 不明）
  }
  
  // ========================================
  // ギャラリーモーダル内のカテゴリーを性別でフィルタ
  // ========================================
  var filterApplied = false;
  
  function applyGenderFilter(){
    var targetGender = getCurrentCharGender();
    if(!targetGender){
      log('No target gender, skipping filter');
      return;
    }
    
    // ギャラリーモーダルを探す
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
    
    // モーダル内のすべてのボタンを取得
    var buttons = galleryModal.querySelectorAll('button');
    var hiddenCount = 0;
    var shownCount = 0;
    
    buttons.forEach(function(btn){
      // 閉じるボタンやページネーション等は無視
      var btnText = (btn.textContent || '').trim();
      if(btnText.length < 3) return; // 小さなボタン (×、‹、› 等)
      if(btnText.indexOf('戻る') !== -1) return;
      if(btnText.indexOf('リセット') !== -1) return;
      if(btnText === 'すべて') return;
      
      var btnGender = getButtonGender(btn);
      if(btnGender && btnGender !== targetGender){
        // 性別不一致 → 非表示
        btn.style.display = 'none';
        hiddenCount++;
      } else {
        // 一致 or 性別非依存 → 表示
        if(btn.style.display === 'none'){
          btn.style.display = '';
        }
        shownCount++;
      }
    });
    
    log('Filter applied:', targetGender, '| shown:', shownCount, 'hidden:', hiddenCount);
    
    // 件数表示を更新（もし存在すれば）
    var statsEl = galleryModal.querySelector('[style*="background:#f9fafb"]');
    if(statsEl && hiddenCount > 0){
      var genderLabel = targetGender === 'male' ? '👨 男性' : '👩 女性';
      var span = statsEl.querySelector('span');
      if(span && span.textContent.indexOf('絞り込み中') === -1){
        var orig = span.textContent;
        span.innerHTML = '<span style="color:#6366f1;font-weight:600">[' + genderLabel + 'のみ絞り込み中]</span> ' + orig;
      }
    }
    
    filterApplied = true;
  }
  
  // ========================================
  // ギャラリーモーダルが閉じられたらリセット
  // ========================================
  function resetFilter(){
    filterApplied = false;
  }
  
  // ========================================
  // MutationObserver でモーダルの出現/消失を監視
  // ========================================
  function setupObserver(){
    var observer = new MutationObserver(function(mutations){
      // ギャラリーモーダルが新規追加されたか
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
        // 少し遅延させて、レンダリング完了を待つ
        setTimeout(applyGenderFilter, 50);
        setTimeout(applyGenderFilter, 200); // 念のため2回目
      }
      
      // モーダルが消えたらフィルタ状態をリセット
      var hasGallery = false;
      var modals = document.querySelectorAll('.modal-overlay');
      for(var k = 0; k < modals.length; k++){
        var c = modals[k].textContent || '';
        if(c.indexOf('キャラクター画像ギャラリー') !== -1){
          hasGallery = true;
          break;
        }
      }
      if(!hasGallery && filterApplied){
        resetFilter();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
    
    log('Observer installed');
  }
  
  // ========================================
  // 初期化
  // ========================================
  function init(){
    if(document.body){
      setupObserver();
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
    enableDebug: function(){DEBUG = true; log('Debug enabled');}
  };
  
  if(console && console.log) console.log('[IconFilter] Loaded v1.0.0');
})();
