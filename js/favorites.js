// ===== cbyd21_Favorites — 暮屿藏笺 App =====
// 独立收藏 App，只展示已收藏内容，不负责外部历史搜索。

// cbyd21_Favorites
// → 独立收藏 App：暮屿藏笺。
// → 这里只展示已经收藏过的内容。
// → 外部历史搜索由 cbyd21_Search 负责，二者功能边界分开。
var cbyd21_Favorites = {
  _stack:[],

  icon:function(name){
    var icons = {
      chat:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h10a1 1 0 011 1v6a1 1 0 01-1 1h-4l-3 3v-3H4a1 1 0 01-1-1V6a1 1 0 011-1z"/><path d="M6.5 8.5h5"/><path d="M6.5 10.8h3"/></svg>',
      group:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="3"/><path d="M2.5 15q.5-4 4.5-4t4.5 4"/><circle cx="12.5" cy="6.5" r="2.3" opacity=".45"/><path d="M11.5 12q3 .4 3.8 3" opacity=".45"/></svg>',
      call:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h3l1.4 3.4-2 1.3a8.5 8.5 0 003.9 3.9l1.3-2L16 11v3a1.5 1.5 0 01-1.5 1.5A12 12 0 012.5 3.5 1.5 1.5 0 014 2z"/></svg>',
      offline:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="6" r="3.5"/><path d="M3 16q0-5 6-5t6 5"/><circle cx="13.5" cy="5" r="2" opacity=".45"/></svg>',
      games:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="12" height="10" rx="1.5"/><path d="M3 4l1.2-2h9.6L15 4"/><path d="M5.5 14l-1 2"/><path d="M12.5 14l1 2"/><path d="M6 10l2-2 1.5 1 2.5-3" opacity=".55"/></svg>',
      fate:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M9 5.5V9l2.5 2"/><circle cx="9" cy="9" r="1" fill="currentColor" stroke="none"/></svg>',
      appear:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="7" r="3"/><circle cx="11.5" cy="7" r="3" opacity=".55"/><path d="M4 15q1-4 5-4t5 4"/></svg>',
      shadow:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3c-3.5 0-6 3.5-6 6s2.5 6 6 6 6-3.5 6-6-2.5-6-6-6z" opacity=".55"/><path d="M9 6v5"/><path d="M6.5 8.5h5"/></svg>',
      branch:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4h10"/><path d="M4 9h10"/><path d="M4 14h7"/><circle cx="3" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="9" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="14" r=".8" fill="currentColor" stroke="none"/></svg>',
      pin:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5a5 5 0 00-5 5c0 4 5 8 5 8s5-4 5-8a5 5 0 00-5-5z"/><circle cx="9" cy="7.5" r="1.7"/></svg>',
      save:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h10l2 2v10H3z"/><path d="M6 3v4h6V3"/><path d="M5.5 11h7"/></svg>',
      empty:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h6a1 1 0 011 1v11l-4-2-4 2V4a1 1 0 011-1z"/><path d="M7.5 7h3"/><path d="M7.5 9.5h2"/></svg>'
    };

    return icons[name] || icons.empty;
  },

  // openApp() → 打开暮屿藏笺收藏 App。
  // 会隐藏桌面、激活 favoritesApp，并渲染收藏首页。
  openApp:function(){
    document.getElementById('desktop').classList.add('hidden');
    document.getElementById('favoritesApp').classList.add('active');
    currentAppId = 'favoritesApp';
    this._stack = [];
    this.renderHome();
    history.pushState({app:'favoritesApp'},'');

    if(typeof updateSnowVisibility === 'function')updateSnowVisibility();
  },

  // closeApp(fromPopstate) → 关闭暮屿藏笺。
  // 如果当前还在收藏子页面，会先执行页面内回退；首页时才真正关闭 App。
  closeApp:function(fromPopstate){
    if(this._stack.length > 0){
      this.back(fromPopstate);
      return;
    }

    document.getElementById('favoritesApp').classList.remove('active');
    document.getElementById('desktop').classList.remove('hidden');

    currentAppId = null;
    this._stack = [];

    if(!fromPopstate){
      _ignorePopstate = true;
      history.back();
    }

    if(typeof updateSnowVisibility === 'function')updateSnowVisibility();
  },

  // back(fromPopstate) → 暮屿藏笺内部返回。
  // fromPopstate=true 表示由系统返回键触发，不主动 history.back()。
  back:function(fromPopstate){
    if(!fromPopstate){
      this._popPage();
      _ignorePopstate = true;
      history.back();
      return;
    }

    this._popPage();
  },

  // _popPage() → 弹出暮屿藏笺内部页面栈。
  // 没有上一层时回到桌面，有上一层时重新渲染上一层。
  _popPage:function(){
    if(this._stack.length === 0){
      document.getElementById('favoritesApp').classList.remove('active');
      document.getElementById('desktop').classList.remove('hidden');
      currentAppId = null;
      return;
    }

    this._stack.pop();

    if(this._stack.length === 0){
      this.renderHome(true);
    }else{
      var top = this._stack[this._stack.length - 1];
      if(top && top.fn)top.fn(true);
    }
  },

  // refreshIfOpen() → 如果暮屿藏笺当前打开，则刷新当前页面。
  // 收藏/取消收藏后会调用它，让收藏 App 尽量同步更新。
  refreshIfOpen:function(){
    var app = document.getElementById('favoritesApp');

    if(!app || !app.classList.contains('active'))return;

    if(this._stack.length === 0){
      this.renderHome(true);
      return;
    }

    var top = this._stack[this._stack.length - 1];

    if(top && top.fn)top.fn(true);
  },

  // favs() → 从 FavoriteStore 读取收藏列表。
  // 暮屿藏笺只消费收藏数据，不负责收藏数据的底层读写。
  favs:function(){
    return cbyd21_FavoriteStore.load();
  },

  // esc(s) → 暮屿藏笺专用 HTML 转义。
  // 收藏快照来自不同模块的用户/AI内容，展示前必须转义，避免原文里的标签影响收藏页面。
  esc:function(s){
    return cbyd21_FavoriteStore.esc(s);
  },

  // setTitle(title, sub) → 更新暮屿藏笺顶部标题和副标题。
  setTitle:function(title, sub){
    document.querySelector('#favoritesApp .app-header-info h1').textContent = title || '暮屿藏笺';
    document.getElementById('favoritesSubtitle').textContent = sub || '收藏消息、通话、线下记录与文游剧情';
  },

  // content() → 获取暮屿藏笺内容滚动容器。
  // 所有收藏层级页面都会渲染到 favoritesContent。
  content:function(){
    return document.getElementById('favoritesContent');
  },

  // entry(icon, title, sub, count, onclick) → 创建一个竖向列表条目。
  // 暮屿藏笺不用 tab，所有层级入口都用这种条目进入新页面。
  entry:function(icon, title, sub, count, onclick){
    var div = document.createElement('div');
    div.className = 'fav-entry';
    div.innerHTML =
      '<div class="fav-icon">' + icon + '</div>' +
      '<div class="fav-main">' +
        '<div class="fav-title">' + this.esc(title) + '</div>' +
        '<div class="fav-sub">' + this.esc(sub || '') + '</div>' +
      '</div>' +
      '<div class="fav-count">' + this.esc(count || '') + '</div>';

    div.onclick = onclick || function(){};

    return div;
  },

  // empty(text) → 收藏层级为空时的空状态。
  // 即使没有收藏，也显示“这里还没有收藏”，不直接隐藏页面。
  empty:function(text){
    return '<div class="fav-empty"><div class="fav-empty-icon">' + this.icon('empty') + '</div>' + this.esc(text || '这里还没有收藏') + '</div>';
  },

  // push(fn) → 进入暮屿藏笺内部子页面。
  // 会把当前渲染函数压入内部栈，并 pushState 支持系统返回键。
  push:function(fn){
    this._stack.push({fn:fn});
    history.pushState({favPage:true},'');
  },

  // groupBy(arr, fn) → 按指定 key 对收藏数组分组。
  // 用于按角色、群聊、分支、通话、线下记录、存档、模式等层级聚合收藏。
  groupBy:function(arr, fn){
    var map = {};

    arr.forEach(function(f){
      var k = fn(f) || '未分组';

      if(!map[k])map[k] = [];
      map[k].push(f);
    });

    return map;
  },

  // refreshSubset(favs) → 根据最新收藏列表刷新当前层级传入的收藏子集。
  // 解决：在收藏详情页取消收藏后，页面栈闭包里的旧 favs 数组仍包含已删除收藏，导致卡片或数量不立刻消失的问题。
  // 所有接收 favs 参数的层级页，在渲染前都应先调用这个函数。
  refreshSubset:function(favs){
    var alive = {};
    this.favs().forEach(function(f){
      if(f && f.id)alive[f.id] = f;
    });

    return (favs || []).map(function(f){
      return f && f.id ? alive[f.id] : null;
    }).filter(Boolean);
  },

  // renderHome(noStack) → 渲染暮屿藏笺首页。
  // 首页入口：消息、通话、咫尺朝夕、绘言戏局。
  renderHome:function(noStack){
    this.setTitle('暮屿藏笺', '收藏消息、通话、线下记录与文游剧情');

    var c = this.content();
    var favs = this.favs();

    c.scrollTop = 0;

    c.innerHTML =
      '<div class="fav-home-title">暮屿藏笺</div>' +
      '<div class="fav-home-sub">按应用和功能分层查看你收藏过的内容。</div>';

    var counts = {
      online:favs.filter(function(f){ return f.module === 'online'; }).length,
      call:favs.filter(function(f){ return f.module === 'call'; }).length,
      offline:favs.filter(function(f){ return f.module === 'offline'; }).length,
      games:favs.filter(function(f){ return f.module === 'games'; }).length
    };

    var list = document.createElement('div');
    list.className = 'fav-list';

    list.appendChild(this.entry(cbyd21_Favorites.icon('chat'),'消息','线上聊天与群聊收藏',counts.online + ' 条',function(){
      cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderOnlineSources(true); });
      cbyd21_Favorites.renderOnlineSources(true);
    }));

    list.appendChild(this.entry(cbyd21_Favorites.icon('call'),'通话','语音 / 视频通话收藏',counts.call + ' 条',function(){
      cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderCallSources(true); });
      cbyd21_Favorites.renderCallSources(true);
    }));

    list.appendChild(this.entry(cbyd21_Favorites.icon('offline'),'咫尺朝夕','线下见面收藏',counts.offline + ' 条',function(){
      cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderOfflineSources(true); });
      cbyd21_Favorites.renderOfflineSources(true);
    }));

    list.appendChild(this.entry(cbyd21_Favorites.icon('games'),'绘言戏局','文游剧情收藏',counts.games + ' 条',function(){
      cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderGameList(true); });
      cbyd21_Favorites.renderGameList(true);
    }));

    c.appendChild(list);
  },

  // renderList(title, sub, items, emptyText) → 渲染通用收藏层级列表。
  // 所有“选择角色 / 分支 / 存档 / 时间线”等页面都可以复用。
  renderList:function(title, sub, items, emptyText){
    this.setTitle(title, sub);

    var c = this.content();
    c.innerHTML = '';
    c.scrollTop = 0;

    if(!items || items.length === 0){
      c.innerHTML = this.empty(emptyText);
      return;
    }

    var list = document.createElement('div');
    list.className = 'fav-list';

    items.forEach(function(item){
      list.appendChild(item);
    });

    c.appendChild(list);
  },

  // renderOnlineSources() → 渲染“消息收藏”的角色 / 群聊列表。
  renderOnlineSources:function(){
    var favs = this.favs().filter(function(f){ return f.module === 'online'; });
    var map = this.groupBy(favs, function(f){ return f.sourceType + '|' + f.sourceId; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(first.sourceType === 'group' ? cbyd21_Favorites.icon('group') : cbyd21_Favorites.icon('chat'), first.sourceName || '未命名', first.sourceType === 'group' ? '群聊收藏' : '角色聊天收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderBranches(arr, 'online'); });
        cbyd21_Favorites.renderBranches(arr, 'online');
      }));
    });

    this.renderList('消息收藏', '按角色 / 群聊查看收藏', items, '还没有消息收藏');
  },

  // renderCallSources() → 渲染“通话收藏”的角色列表。
  renderCallSources:function(){
    var favs = this.favs().filter(function(f){ return f.module === 'call'; });
    var map = this.groupBy(favs, function(f){ return f.sourceId; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(cbyd21_Favorites.icon('call'), first.sourceName || '角色', '通话收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderBranches(arr, 'call'); });
        cbyd21_Favorites.renderBranches(arr, 'call');
      }));
    });

    this.renderList('通话收藏', '按角色查看收藏', items, '还没有通话收藏');
  },

  // renderOfflineSources() → 渲染“咫尺朝夕收藏”的角色 / 群聊列表。
  renderOfflineSources:function(){
    var favs = this.favs().filter(function(f){ return f.module === 'offline'; });
    var map = this.groupBy(favs, function(f){ return f.sourceType + '|' + f.sourceId; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(first.sourceType === 'group' ? cbyd21_Favorites.icon('group') : cbyd21_Favorites.icon('offline'), first.sourceName || '未命名', '咫尺朝夕收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderBranches(arr, 'offline'); });
        cbyd21_Favorites.renderBranches(arr, 'offline');
      }));
    });

    this.renderList('咫尺朝夕收藏', '按角色 / 群聊查看收藏', items, '还没有线下收藏');
  },

  // renderGameList() → 渲染绘言戏局下的文游列表。
  // 当前只有浮生逆笔，后续新增文游也从这里扩展。
  renderGameList:function(){
    var favs = this.favs().filter(function(f){ return f.module === 'games'; });
    var fate = favs.filter(function(f){ return f.subModule === 'fate'; });

    var items = [
      this.entry(this.icon('fate'),'浮生逆笔','命运干预剧情收藏',fate.length + ' 条',function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderFateSources(); });
        cbyd21_Favorites.renderFateSources();
      })
    ];

    this.renderList('绘言戏局收藏', '选择文游', items, '还没有文游收藏');
  },

  // renderFateSources() → 渲染浮生逆笔收藏的角色列表。
  renderFateSources:function(){
    var favs = this.favs().filter(function(f){ return f.module === 'games' && f.subModule === 'fate'; });
    var map = this.groupBy(favs, function(f){ return f.sourceId; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(cbyd21_Favorites.icon('games'), first.sourceName || '角色', '浮生逆笔收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderModes(arr); });
        cbyd21_Favorites.renderModes(arr);
      }));
    });

    this.renderList('浮生逆笔收藏', '按角色查看', items, '还没有浮生逆笔收藏');
  },

  // renderModes(favs) → 渲染浮生逆笔的模式层级。
  // 例如：现身陪伴、暗中守护。
  renderModes:function(favs){
    favs = this.refreshSubset(favs);

    var map = this.groupBy(favs, function(f){ return f.mode || 'appear'; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(k === 'shadow' ? cbyd21_Favorites.icon('shadow') : cbyd21_Favorites.icon('appear'), first.modeName || k, '模式收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderBranches(arr, 'games'); });
        cbyd21_Favorites.renderBranches(arr, 'games');
      }));
    });

    this.renderList('模式', '按模式查看收藏', items, '这里是空的');
  },

  // renderBranches(favs, type) → 渲染分支层级。
  // 消息、通话、咫尺朝夕、浮生逆笔都会进入这一层。
  renderBranches:function(favs, type){
    favs = this.refreshSubset(favs);

    var map = this.groupBy(favs, function(f){ return f.branchId || 'none'; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(cbyd21_Favorites.icon('branch'), first.branchName || '分支', '收藏内容', arr.length + ' 条', function(){
        if(type === 'offline'){
          cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderOfflineSessions(arr); });
          cbyd21_Favorites.renderOfflineSessions(arr);
        }else if(type === 'call'){
          cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderCalls(arr); });
          cbyd21_Favorites.renderCalls(arr);
        }else{
          cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderCards(arr); });
          cbyd21_Favorites.renderCards(arr);
        }
      }));
    });

    this.renderList('分支', '选择分支', items, '这个层级没有收藏');
  },

  // renderCalls(favs) → 渲染某个分支下的通话记录列表。
  renderCalls:function(favs){
    favs = this.refreshSubset(favs);

    var map = this.groupBy(favs, function(f){ return f.callId || 'call'; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(cbyd21_Favorites.icon('call'), first.callName || '通话记录', '通话消息收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderCards(arr); });
        cbyd21_Favorites.renderCards(arr);
      }));
    });

    this.renderList('通话记录', '选择通话', items, '这个分支没有通话收藏');
  },

  // renderOfflineSessions(favs) → 渲染某个分支下的第几次线下记录。
  renderOfflineSessions:function(favs){
    favs = this.refreshSubset(favs);

    var map = this.groupBy(favs, function(f){ return f.sessionId || 'session'; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(cbyd21_Favorites.icon('pin'), first.sessionName || '线下记录', '按存档查看', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderSaves(arr); });
        cbyd21_Favorites.renderSaves(arr);
      }));
    });

    this.renderList('线下记录', '选择第几次线下', items, '这里是空的');
  },

  // renderSaves(favs) → 渲染某次线下记录里的存档列表。
  // 收藏里不强调“当前进度”，只按存档名展示。
  renderSaves:function(favs){
    favs = this.refreshSubset(favs);

    var map = this.groupBy(favs, function(f){ return f.saveId || 'nosave'; });
    var items = [];

    Object.keys(map).forEach(function(k){
      var arr = map[k];
      var first = arr[0];

      items.push(cbyd21_Favorites.entry(cbyd21_Favorites.icon('save'), first.saveName || '未命名存档', '存档收藏', arr.length + ' 条', function(){
        cbyd21_Favorites.push(function(){ cbyd21_Favorites.renderCards(arr); });
        cbyd21_Favorites.renderCards(arr);
      }));
    });

    this.renderList('存档', '选择存档', items, '这个线下记录里还没有收藏');
  },

  // renderCards(favs) → 渲染最终收藏内容列表。
  // 这里会显示收藏卡片，并提供“筛选当前收藏”的输入框。
  renderCards:function(favs){
    favs = this.refreshSubset(favs);

    this.setTitle('收藏内容', '共 ' + (favs ? favs.length : 0) + ' 条');

    var c = this.content();
    c.innerHTML = '';
    c.scrollTop = 0;

    if(!favs || favs.length === 0){
      c.innerHTML = this.empty('这里还没有收藏');
      return;
    }

    var input = document.createElement('div');
    input.className = 'fav-search-box';
    input.innerHTML = '<input class="fav-search-input" id="favoriteFilterInput" placeholder="筛选当前收藏…" oninput="cbyd21_Favorites.filterCards()">';

    c.appendChild(input);

    var wrap = document.createElement('div');
    wrap.id = 'favoriteCardsWrap';
    c.appendChild(wrap);

    this._currentCards = favs.slice();
    this.filterCards();
  },

  // filterCards() → 在当前收藏详情页内筛选收藏内容。
  // 这只是暮屿藏笺内部筛选收藏，不是外部历史搜索功能。
  filterCards:function(){
    var wrap = document.getElementById('favoriteCardsWrap');

    if(!wrap)return;

    var q = (document.getElementById('favoriteFilterInput') && document.getElementById('favoriteFilterInput').value || '').trim().toLowerCase();

    this._currentCards = this.refreshSubset(this._currentCards || []);

    var arr = (this._currentCards || []).filter(function(f){
      if(!q)return true;

      var haystack = [
        f.contentSnapshot,
        f.speakerName,
        f.sourceName,
        f.branchName,
        f.sessionName,
        f.saveName,
        f.callName,
        f.gameName,
        f.modeName,
        f.module,
        f.subModule,
        cbyd21_FavoriteStore.dateKey(f.ts)
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.indexOf(q) >= 0;
    });

    wrap.innerHTML = '';

    if(arr.length === 0){
      wrap.innerHTML = this.empty('没有匹配的收藏');
      return;
    }

    arr.sort(function(a,b){
      return (b.ts || b.createdAt || 0) - (a.ts || a.createdAt || 0);
    }).forEach(function(f){
      var tags = [
        f.gameName,
        f.sourceName,
        f.modeName,
        f.branchName,
        f.sessionName,
        f.saveName,
        f.callName
      ].filter(Boolean).map(function(t){
        return '<span class="fav-tag">' + cbyd21_Favorites.esc(t) + '</span>';
      }).join('');

      var card = document.createElement('div');
      card.className = 'fav-card';
      card.innerHTML =
        '<div class="fav-card-head">' +
          '<div class="fav-speaker">' + cbyd21_Favorites.esc(f.speakerName || '收藏') + '</div>' +
          '<div class="fav-date">' + cbyd21_FavoriteStore.dateKey(f.ts) + '</div>' +
        '</div>' +
        '<div class="fav-content">' + cbyd21_Favorites.esc(f.contentSnapshot || '') + '</div>' +
        '<div class="fav-tags">' + tags + '</div>' +
        '<div class="fav-actions">' +
          '<button class="fav-action" onclick="cbyd21_FavoriteStore.copy(\'' + f.id + '\')">复制</button>' +
          '<button class="fav-action danger" onclick="cbyd21_FavoriteStore.remove(\'' + f.id + '\')">取消收藏</button>' +
        '</div>';

      wrap.appendChild(card);
    });
  }
};
