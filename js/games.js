// ===== 【模块】cbyd21_Games — 绘言戏局 =====
// 这个文件只负责“绘言戏局”的外壳。
// 你可以把它理解成一个文游总入口：
// · 它显示一组可以左右切换的悬浮画框
// · 每个画框对应一个文游入口
// · 具体文游怎么玩，不写在这里
//
// 以后新增文游时，推荐结构是：
// · js/games.js       → 只加一个画框入口
// · js/xxxGame.js     → 新文游自己的逻辑
// · css/xxxGame.css   → 新文游自己的样式
//
// 这样不会把所有文游都堆进 games.js 里。

var cbyd21_Games = {
  // 当前停在第几个画框
  _index: 0,

  // 手指按下时的位置
  _startX: 0,
  _startY: 0,

  // 本次拖动的横向距离
  _dragX: 0,

  // 是否正在拖动画框
  _dragging: false,

  // 从绘言戏局进入浮生逆笔后，返回时要回到绘言戏局
  _returnToGames: false,

  // 画框列表
  // 以后要新增文游，就按这个格式加一项
  _games: [
    {
      id: 'fate',
      name: '浮生逆笔',
      kicker: 'FATE INTERVENTION',
      desc: '去往角色人生中的关键时刻，以现身陪伴或暗中守护的方式，触碰命运支流。',
      tags: ['命运干预', '文字叙事', '角色关键时刻'],
      coverClass: 'games-cover-fate',
      available: true
    },
    {
      id: 'simulator',
      name: '万象匣',
      kicker: 'FRONTEND SIMULATOR',
      desc: '导入纯前端、AI文字规则或前端驱动的互动模拟器，在独立壳子里运行。',
      tags: ['前端承载器', 'AI文游', '可导入'],
      coverClass: 'games-cover-simulator',
      available: true
    },
    {
      id: 'coming_2',
      name: '未命名画框',
      kicker: 'COMING SOON',
      desc: '给未来的故事留一块空白。这里会成为新的文字游戏入口。',
      tags: ['预留画框', '未开放'],
      coverClass: 'games-cover-coming',
      available: false
    }
  ],

  // openApp() → 打开绘言戏局页面
  openApp: function(){
    openApp('gamesApp');
    this.render();
    this._bindSwipe();
    this._showVersionNotice();
  },

  // _showVersionNotice()
  // → 绘言戏局现版本提醒。
  // 当前文游功能仍在测试完善阶段，进入时提醒一次，避免用户误以为是稳定正式功能。
  _showVersionNotice:function(){
    var key = 'stm_gamesVersionNotice_20260512';

    if(localStorage.getItem(key) === 'off')return;

    var container = document.getElementById('addCharList');
    if(!container)return;

    container.innerHTML =
      '<div style="padding:20px 18px;font-size:13px;color:var(--text-secondary);line-height:1.8">' +
        '<div style="font-size:18px;margin-bottom:10px">🎭</div>' +
        '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:8px">绘言戏局现版本提醒</div>' +
        '<div>该功能当前仍处于测试和完善阶段，尚未进行充分稳定性测试。</div>' +
        '<div style="margin-top:8px">进入后可能遇到剧情生成异常、界面状态不同步、分支逻辑不完整或其他未发现的问题。</div>' +
        '<div style="margin-top:8px;color:var(--danger)">现版本不建议作为稳定功能长期游玩，请先当作测试功能使用。</div>' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:var(--text-muted);cursor:pointer">' +
          '<input type="checkbox" id="gamesVersionNoticeDontShow" style="accent-color:var(--accent)">' +
          '<span>不再提示</span>' +
        '</label>' +
        '<button class="btn primary" id="gamesVersionNoticeOkBtn" style="width:100%;margin-top:12px">我知道了</button>' +
      '</div>';

    document.getElementById('addCharModal').querySelector('h3').textContent = '现版本提醒';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');

    var okBtn = document.getElementById('gamesVersionNoticeOkBtn');

    if(okBtn){
      okBtn.onclick = function(){
        var cb = document.getElementById('gamesVersionNoticeDontShow');

        if(cb && cb.checked){
          localStorage.setItem(key, 'off');
        }

        closeModal('addCharModal');
      };
    }
  },

  // registerGame(game) → 以后给新文游注册一个画框入口
  // game 至少需要有 id/name/desc/tags/coverClass/available
  registerGame: function(game){
    if(!game || !game.id)return;

    var exists = this._games.some(function(g){
      return g.id === game.id;
    });

    if(exists)return;

    this._games.push(game);
    this.render();
  },

  // render() → 刷新整个绘言戏局页面
  render: function(){
    this._renderFrames();
    this._renderDots();
    this._syncEnterButton();
    this._syncCount();
  },

  // _renderFrames() → 把所有文游画框画到页面上
  // 注意：这里会重新创建画框，所以一般只在打开页面或游戏列表变化时调用
  _renderFrames: function(){
    var track = document.getElementById('gamesFrameTrack');
    if(!track)return;

    var self = this;
    track.innerHTML = '';

    this._games.forEach(function(g, i){
      var div = document.createElement('div');
      div.className = 'games-frame-card';
      div.dataset.index = i;

      div.innerHTML =
        '<div class="games-frame-outer">' +
          '<div class="games-frame-mat">' +
            '<div class="games-frame-inner">' +
              '<div class="games-frame-cover ' + g.coverClass + '"></div>' +
              '<div class="games-frame-index">' + String(i + 1).padStart(2, '0') + '</div>' +
              '<div class="games-frame-art">' + self._getCoverSvg(g.id) + '</div>' +
              '<div class="games-frame-info">' +
                '<div class="games-frame-kicker">' + self._esc(g.kicker) + '</div>' +
                '<div class="games-frame-name">' + self._esc(g.name) + '</div>' +
                '<div class="games-frame-desc">' + self._esc(g.desc) + '</div>' +
                '<div class="games-frame-tag-row">' +
                  g.tags.map(function(t){
                    return '<span class="games-frame-tag">' + self._esc(t) + '</span>';
                  }).join('') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      div.onclick = function(){
        // 如果刚刚是在拖动，不把松手误判成点击
        if(self._dragging)return;

        var idx = parseInt(div.dataset.index);

        if(idx === self._index){
          self.enterCurrent();
        }else{
          self.goTo(idx);
        }
      };

      track.appendChild(div);
    });

    this._updateFrameTransforms(0);
  },

  // _renderDots() → 渲染下面的小圆点页码
  _renderDots: function(){
    var dots = document.getElementById('gamesFrameDots');
    if(!dots)return;

    var self = this;
    dots.innerHTML = '';

    this._games.forEach(function(g, i){
      var dot = document.createElement('div');
      dot.className = 'games-frame-dot' + (i === self._index ? ' active' : '');

      dot.onclick = function(){
        self.goTo(i);
      };

      dots.appendChild(dot);
    });
  },

  // _syncEnterButton() → 根据当前画框状态更新“进入”按钮
  _syncEnterButton: function(){
    var btn = document.getElementById('gamesEnterBtn');
    if(!btn)return;

    var g = this._games[this._index];

    if(!g || !g.available){
      btn.textContent = '尚未开放';
      btn.classList.add('disabled');
      return;
    }

    if(typeof _cbyd21PromptsLoaded !== 'undefined' && !_cbyd21PromptsLoaded){
      btn.textContent = '提示词加载中';
      btn.classList.add('disabled');
      return;
    }

    btn.textContent = '进入 ' + g.name;
    btn.classList.remove('disabled');
  },

  // _syncCount() → 更新右上角页码，例如 01 / 03
  _syncCount: function(){
    var el = document.getElementById('gamesNoteCount');
    if(!el)return;

    el.textContent =
      String(this._index + 1).padStart(2, '0') +
      ' / ' +
      String(this._games.length).padStart(2, '0');
  },

  // _getFrameStyle(pos) → 计算画框的位置
  // pos = 0  ：正中间的画框
  // pos = 1  ：右边斜靠的画框
  // pos = -1 ：左边斜靠的画框
  //
  // 这里决定了“右边画框从右下方抬到中间”的动效。
  _getFrameStyle: function(pos){
    var abs = Math.abs(pos);
    var sign = pos < 0 ? -1 : 1;

    var x = pos * 55;
    var y = -18 + abs * 52;
    var rotateY = -pos * 32;
    var rotateZ = pos * 5.5;
    var scale = 1 - Math.min(abs * 0.18, 0.34);
    var opacity = Math.max(0, 1 - abs * 0.46);
    var blur = Math.min(abs * 0.5, 1.2);

    // 离中心太远的画框隐藏
    if(abs > 1.45){
      x = sign * 96;
      y = 58;
      rotateY = -sign * 42;
      rotateZ = sign * 8;
      scale = 0.68;
      opacity = 0;
      blur = 1.2;
    }

    return {
      transform:
        'translateX(' + x + '%) ' +
        'translateY(' + y + 'px) ' +
        'rotateY(' + rotateY + 'deg) ' +
        'rotateZ(' + rotateZ + 'deg) ' +
        'scale(' + scale + ')',
      opacity: opacity,
      filter: 'blur(' + blur + 'px) saturate(' + (1 - Math.min(abs * 0.04, 0.12)) + ')',
      zIndex: String(100 - Math.round(abs * 20))
    };
  },

  // _updateFrameTransforms(progress) → 更新所有画框的位置
  // progress 是拖动过程里的临时偏移。
  // 手指往左滑时，下一张会从右下方滑到中间。
  _updateFrameTransforms: function(progress){
    var cards = document.querySelectorAll('.games-frame-card');
    var self = this;

    cards.forEach(function(card){
      var i = parseInt(card.dataset.index);
      var pos = i - self._index + progress;
      var s = self._getFrameStyle(pos);

      card.style.transform = s.transform;
      card.style.opacity = s.opacity;
      card.style.filter = s.filter;
      card.style.zIndex = s.zIndex;

      if(Math.abs(i - self._index) <= 1){
        card.classList.add('is-clickable');
      }else{
        card.classList.remove('is-clickable');
      }
    });
  },

  // _refreshOnlyState() → 只刷新状态，不重建画框
  // 切换画框时用它，这样动画会更顺。
  _refreshOnlyState: function(){
    this._updateFrameTransforms(0);
    this._renderDots();
    this._syncEnterButton();
    this._syncCount();
  },

  // prev() → 切换到上一幅画框
  prev: function(){
    if(this._index <= 0){
      showToast('已经是第一幅');
      return;
    }

    this._index--;
    this._refreshOnlyState();
  },

  // next() → 切换到下一幅画框
  next: function(){
    if(this._index >= this._games.length - 1){
      showToast('已经是最后一幅');
      return;
    }

    this._index++;
    this._refreshOnlyState();
  },

  // goTo(i) → 直接切换到指定画框
  goTo: function(i){
    if(i < 0 || i >= this._games.length)return;

    this._index = i;
    this._refreshOnlyState();
  },

  // enterCurrent() → 进入当前选中的文游
  enterCurrent: function(){
    var g = this._games[this._index];

    if(!g || !g.available){
      showToast('这个文游还没有开放');
      return;
    }

    if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
      this._syncEnterButton();
      return;
    }

    if(g.id === 'fate'){
      this.enterFate();
      return;
    }

    if(g.id === 'simulator'){
      this.enterSimulator();
      return;
    }

    showToast('功能开发中…');
  },

  // enterSimulator() → 从绘言戏局进入万象匣
  // 万象匣本体使用 simulatorApp / simulatorGame.js。
  enterSimulator:function(){
    var gamesApp = document.getElementById('gamesApp');
    var simApp = document.getElementById('simulatorApp');

    if(!gamesApp || !simApp){
      showToast('万象匣模块未加载');
      return;
    }

    this._returnToGames = true;

    gamesApp.classList.remove('active');
    simApp.classList.add('active');

    currentAppId = 'simulatorApp';
    history.pushState({app:'simulatorApp',fromGames:true},'');

    if(typeof cbyd21_SimulatorGame !== 'undefined' && cbyd21_SimulatorGame.openApp){
      cbyd21_SimulatorGame.openApp(true);
    }

    if(typeof updateSnowVisibility === 'function'){
      updateSnowVisibility();
    }
  },

  // enterFate() → 从绘言戏局进入浮生逆笔
  // 浮生逆笔本体仍然用原来的 fateApp / fate.js。
  enterFate: function(){
    var gamesApp = document.getElementById('gamesApp');
    var fateApp = document.getElementById('fateApp');

    if(!gamesApp || !fateApp)return;

    this._returnToGames = true;

    gamesApp.classList.remove('active');
    fateApp.classList.add('active');

    document.getElementById('fateHome').style.display = 'flex';
    document.getElementById('fateCharSelect').style.display = 'none';
    document.getElementById('fateGameView').style.display = 'none';

    currentAppId = 'fateApp';
    history.pushState({app:'fateApp',fromGames:true},'');

    if(typeof updateSnowVisibility === 'function'){
      updateSnowVisibility();
    }
  },

  // _bindSwipe() → 让画框区域支持左右滑动
  // 拖动时画框会跟着手指移动，不是松手后硬切。
  _bindSwipe: function(){
    var stage = document.getElementById('gamesFrameStage');
    var track = document.getElementById('gamesFrameTrack');

    if(!stage || !track || stage.dataset.bound === 'true')return;

    var self = this;
    stage.dataset.bound = 'true';

    stage.addEventListener('touchstart', function(e){
      if(!e.touches || !e.touches[0])return;

      self._dragging = true;
      self._dragX = 0;
      self._startX = e.touches[0].clientX;
      self._startY = e.touches[0].clientY;

      track.classList.add('dragging');
    }, {passive:true});

    stage.addEventListener('touchmove', function(e){
      if(!self._dragging || !e.touches || !e.touches[0])return;

      var x = e.touches[0].clientX;
      var y = e.touches[0].clientY;

      var dx = x - self._startX;
      var dy = y - self._startY;

      // 如果用户明显是在上下滑，就不处理
      if(Math.abs(dx) < Math.abs(dy))return;

      self._dragX = dx;

      var progress = dx / 240;

      // 第一张再往右拉、最后一张再往左拉时，加阻尼
      if(self._index <= 0 && progress > 0)progress = progress * 0.25;
      if(self._index >= self._games.length - 1 && progress < 0)progress = progress * 0.25;

      progress = Math.max(-1, Math.min(1, progress));

      self._updateFrameTransforms(progress);
    }, {passive:true});

    stage.addEventListener('touchend', function(){
      if(!self._dragging)return;

      track.classList.remove('dragging');

      if(self._dragX < -54 && self._index < self._games.length - 1){
        self._index++;
      }else if(self._dragX > 54 && self._index > 0){
        self._index--;
      }

      self._dragX = 0;
      self._refreshOnlyState();

      // 延迟一下再允许点击，避免松手瞬间误触进入
      setTimeout(function(){
        self._dragging = false;
      }, 40);
    }, {passive:true});

    stage.addEventListener('touchcancel', function(){
      track.classList.remove('dragging');
      self._dragX = 0;
      self._refreshOnlyState();

      setTimeout(function(){
        self._dragging = false;
      }, 40);
    }, {passive:true});
  },

  // _getCoverSvg(id) → 给没有真实封面的文游显示一张内置线稿封面
  _getCoverSvg: function(id){
    if(id === 'fate'){
      return '<svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="70" cy="70" r="42" opacity="0.35"/><path d="M45 34h50M45 106h50"/><path d="M52 34c0 20 36 20 36 36s-36 16-36 36"/><path d="M88 34c0 20-36 20-36 36s36 16 36 36" opacity="0.55"/><path d="M58 64c8 4 16 4 24 0" opacity="0.6"/><path d="M58 78c8-4 16-4 24 0" opacity="0.6"/><path d="M34 72c12-8 23-8 34 0s23 8 38 0" opacity="0.26"/><circle cx="70" cy="70" r="4" fill="currentColor" stroke="none" opacity="0.65"/></svg>';
    }

    if(id === 'simulator'){
      return '<svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="34" width="80" height="58" rx="5" opacity="0.46"/><path d="M38 48h64" opacity="0.35"/><circle cx="43" cy="41" r="2" fill="currentColor" stroke="none" opacity="0.35"/><circle cx="51" cy="41" r="2" fill="currentColor" stroke="none" opacity="0.28"/><circle cx="59" cy="41" r="2" fill="currentColor" stroke="none" opacity="0.22"/><path d="M48 62l-8 8 8 8" opacity="0.52"/><path d="M92 62l8 8-8 8" opacity="0.52"/><path d="M76 58l-12 26" opacity="0.46"/><rect x="44" y="102" width="52" height="10" rx="5" opacity="0.28"/><path d="M56 112h28" opacity="0.34"/><path d="M70 16v14M70 94v8M22 70h8M110 70h8" opacity="0.22"/></svg>';
    }

    return '<svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="36" y="36" width="68" height="68" rx="4" opacity="0.42"/><path d="M48 86l18-18 13 12 15-22" opacity="0.56"/><circle cx="57" cy="55" r="5" fill="currentColor" stroke="none" opacity="0.45"/><path d="M70 22v18M70 100v18M22 70h18M100 70h18" opacity="0.24"/></svg>';
  },

  // _esc(s) → 防止文字里有特殊符号时破坏页面
  _esc: function(s){
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
};
