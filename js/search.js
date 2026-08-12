// ===== cbyd21_Search — 分层搜索系统 =====
// 搜索的是全部历史，不是只搜收藏。

// cbyd21_Search
// → 分层搜索系统。
// → 搜索的是各应用自己的全部历史记录，不是只搜索收藏。
// → 搜索结果可以顺手收藏，但搜索功能本身和暮屿藏笺收藏 App 是独立的。
var cbyd21_Search = {
  _navStack:[],
  _records:[],
  _activeDate:'all',
  _lastOptions:null,

  icon:function(name){
    var icons = {
      search:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5"/><path d="M12 12l3.5 3.5"/></svg>',
      chat:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h10a1 1 0 011 1v6a1 1 0 01-1 1h-4l-3 3v-3H4a1 1 0 01-1-1V6a1 1 0 011-1z"/><path d="M6.5 8.5h5"/><path d="M6.5 10.8h3"/></svg>',
      group:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="3"/><path d="M2.5 15q.5-4 4.5-4t4.5 4"/><circle cx="12.5" cy="6.5" r="2.3" opacity=".45"/><path d="M11.5 12q3 .4 3.8 3" opacity=".45"/></svg>',
      call:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h3l1.4 3.4-2 1.3a8.5 8.5 0 003.9 3.9l1.3-2L16 11v3a1.5 1.5 0 01-1.5 1.5A12 12 0 012.5 3.5 1.5 1.5 0 014 2z"/></svg>',
      offline:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="6" r="3.5"/><path d="M3 16q0-5 6-5t6 5"/><circle cx="13.5" cy="5" r="2" opacity=".45"/></svg>',
      pin:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5a5 5 0 00-5 5c0 4 5 8 5 8s5-4 5-8a5 5 0 00-5-5z"/><circle cx="9" cy="7.5" r="1.7"/></svg>',
      save:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h10l2 2v10H3z"/><path d="M6 3v4h6V3"/><path d="M5.5 11h7"/></svg>',
      game:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="12" height="10" rx="1.5"/><path d="M3 4l1.2-2h9.6L15 4"/><path d="M5.5 14l-1 2"/><path d="M12.5 14l1 2"/><path d="M6 10l2-2 1.5 1 2.5-3" opacity=".55"/></svg>',
      appear:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="7" r="3"/><circle cx="11.5" cy="7" r="3" opacity=".55"/><path d="M4 15q1-4 5-4t5 4"/></svg>',
      shadow:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3c-3.5 0-6 3.5-6 6s2.5 6 6 6 6-3.5 6-6-2.5-6-6-6z" opacity=".55"/><path d="M9 6v5"/><path d="M6.5 8.5h5"/></svg>',
      timeline:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M9 5.5V9l2.5 2"/><circle cx="9" cy="9" r="1" fill="currentColor" stroke="none"/></svg>',
      branch:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4h10"/><path d="M4 9h10"/><path d="M4 14h7"/><circle cx="3" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="9" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="14" r=".8" fill="currentColor" stroke="none"/></svg>'
    };

    return icons[name] || icons.search;
  },

  // esc(s) → 搜索页专用 HTML 转义。
  // 搜索结果里会展示用户消息、AI消息、剧情文本等内容，渲染前必须转义，避免原始 HTML 影响页面结构。
  esc:function(s){
    if(typeof cbyd21_FavoriteStore !== 'undefined' && cbyd21_FavoriteStore.esc){
      return cbyd21_FavoriteStore.esc(s);
    }

    if(typeof escHtml === 'function'){
      return escHtml(String(s == null ? '' : s));
    }

    return String(s == null ? '' : s);
  },

  // text(s) → 把内部消息格式转换成可搜索、可展示的纯文本。
  // 会复用 FavoriteStore.text，清理双语标记、心声标记、thinking 泄露等内部内容。
  text:function(s){
    if(typeof cbyd21_FavoriteStore !== 'undefined' && cbyd21_FavoriteStore.text){
      return cbyd21_FavoriteStore.text(s);
    }

    return String(s || '')
      .replace(/__inner_voice__[\s\S]*/,'')
      .replace(/__bilingual_split__/g,'\n')
      .replace(/__bl_sep__/g,'')
      .trim();
  },

  // dateKey(ts) → 把消息时间戳转换成日期分组 key。
  // 搜索结果页顶部的日期筛选条会用它按现实日期查看历史记录。
  dateKey:function(ts){
    if(typeof cbyd21_FavoriteStore !== 'undefined' && cbyd21_FavoriteStore.dateKey){
      return cbyd21_FavoriteStore.dateKey(ts);
    }

    if(!ts)return '无日期';

    var d = new Date(ts);
    if(isNaN(d.getTime()))return '无日期';

    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  },

  // openNav(title, subtitle, items, opts) → 打开搜索分层导航页。
  // 用于显示分支列表、线下次数列表、存档列表、时间线列表等中间层。
  openNav:function(title, subtitle, items, opts){
    opts = opts || {};

    var page = document.getElementById('searchNavPage');

    // 打开一个新的搜索入口时，如果搜索导航页当前并不处于激活状态，
    // 说明这是一次新的搜索流程，先清空旧页面栈，避免 iOS/PWA 恢复后返回层级错乱。
    if(!opts.noPush && page && !page.classList.contains('active')){
      this._navStack = [];

      var resultPage = document.getElementById('searchResultPage');
      if(resultPage)resultPage.classList.remove('active');
    }

    if(!opts.noPush){
      this._navStack.push({
        title:title,
        subtitle:subtitle,
        items:items,
        opts:opts
      });
      history.pushState({searchNav:true},'');
    }

    var content = document.getElementById('searchNavContent');

    document.getElementById('searchNavTitle').textContent = title || '搜索';
    document.getElementById('searchNavSubtitle').textContent = subtitle || '选择范围';

    content.innerHTML = '';
    content.scrollTop = 0;

    if(opts.breadcrumb){
      var bc = document.createElement('div');
      bc.className = 'sf-breadcrumb';
      bc.textContent = opts.breadcrumb;
      content.appendChild(bc);
    }

    if(!items || items.length === 0){
      content.innerHTML += '<div class="sf-empty"><div class="sf-empty-icon">' + this.icon('search') + '</div>这里是空的</div>';
    }else{
      var list = document.createElement('div');
      list.className = 'sf-nav-list';

      items.forEach(function(item){
        var div = document.createElement('div');
        div.className = 'sf-nav-item';
        div.innerHTML =
          '<div class="sf-nav-icon">' + (item.icon || cbyd21_Search.icon('search')) + '</div>' +
          '<div class="sf-nav-main">' +
            '<div class="sf-nav-title">' + cbyd21_Search.esc(item.title) + '</div>' +
            '<div class="sf-nav-sub">' + cbyd21_Search.esc(item.sub || '') + '</div>' +
          '</div>' +
          '<div class="sf-nav-count">' + cbyd21_Search.esc(item.count || '') + '</div>';

        div.onclick = item.onclick || function(){};
        list.appendChild(div);
      });

      content.appendChild(list);
    }

    page.classList.add('active');
  },

  // _closeTopNav() → 关闭当前搜索导航层。
  // 如果还有上一层，就重新渲染上一层；否则关闭 searchNavPage。
  _closeTopNav:function(){
    this._navStack.pop();

    if(this._navStack.length > 0){
      var prev = this._navStack[this._navStack.length - 1];
      this.openNav(prev.title, prev.subtitle, prev.items, Object.assign({}, prev.opts, {noPush:true}));
    }else{
      document.getElementById('searchNavPage').classList.remove('active');
    }
  },

  // backNav(fromPopstate) → 搜索导航页返回。
  // fromPopstate=true 表示由系统返回键触发，不再主动 history.back()。
  backNav:function(fromPopstate){
    if(!fromPopstate){
      this._closeTopNav();
      _ignorePopstate = true;
      history.back();
      return;
    }

    this._closeTopNav();
  },

  // openResult(options) → 打开最终搜索结果页。
  // 这里才显示搜索框、日期筛选和结果卡片。
  // records 是当前范围内全部可搜索历史，不是收藏列表。
  openResult:function(options){
    options = options || {};

    this._lastOptions = options;
    this._records = options.records || [];
    this._activeDate = 'all';

    document.getElementById('searchResultTitle').textContent = options.title || '搜索记录';
    document.getElementById('searchResultSubtitle').textContent = options.subtitle || '输入关键词或按日期查看';
    document.getElementById('searchInput').value = '';

    this.renderDateStrip();
    this.renderResultList();

    document.getElementById('searchResultPage').classList.add('active');

    var resultList = document.getElementById('searchResultList');
    if(resultList)resultList.scrollTop = 0;

    var resultShell = document.querySelector('#searchResultPage .sf-result-shell');
    if(resultShell)resultShell.scrollTop = 0;

    history.pushState({searchResult:true},'');
  },

  // backResult(fromPopstate) → 关闭最终搜索结果页。
  // 返回后会露出上一层 searchNavPage。
  backResult:function(fromPopstate){
    document.getElementById('searchResultPage').classList.remove('active');

    if(!fromPopstate){
      _ignorePopstate = true;
      history.back();
    }
  },

  // clearInput() → 清空搜索框并重置日期筛选为“全部”。
  clearInput:function(){
    document.getElementById('searchInput').value = '';
    this._activeDate = 'all';
    this.renderDateStrip();
    this.renderResultList();
  },

  // renderDateStrip() → 渲染日期筛选条。
  // 根据当前 records 的 _ts / ts 分组，支持按现实日期查看历史记录。
  renderDateStrip:function(){
    var el = document.getElementById('searchDateStrip');

    if(!el)return;

    var map = {
      all:this._records.length
    };

    this._records.forEach(function(r){
      var k = cbyd21_Search.dateKey(r.ts);
      map[k] = (map[k] || 0) + 1;
    });

    var keys = Object.keys(map).sort(function(a,b){
      if(a === 'all')return -1;
      if(b === 'all')return 1;
      if(a === '无日期')return 1;
      if(b === '无日期')return -1;
      return a < b ? 1 : -1;
    });

    el.innerHTML = '';

    keys.forEach(function(k){
      var pill = document.createElement('div');
      pill.className = 'sf-date-pill' + (cbyd21_Search._activeDate === k ? ' active' : '');
      pill.textContent = (k === 'all' ? '全部' : k) + ' · ' + map[k];

      pill.onclick = function(){
        cbyd21_Search._activeDate = k;
        cbyd21_Search.renderDateStrip();
        cbyd21_Search.renderResultList();
      };

      el.appendChild(pill);
    });
  },

  // renderResultList() → 渲染搜索结果列表。
  // 同时应用关键词过滤和日期过滤，并高亮命中的关键词。
  renderResultList:function(){
    var list = document.getElementById('searchResultList');

    if(!list)return;

    var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    var activeDate = this._activeDate || 'all';

    var arr = this._records.filter(function(r){
      var text = cbyd21_Search.text(r.content || '').toLowerCase();

      if(q && text.indexOf(q) < 0)return false;
      if(activeDate !== 'all' && cbyd21_Search.dateKey(r.ts) !== activeDate)return false;

      return true;
    });

    list.innerHTML = '';

    if(arr.length === 0){
      list.innerHTML = '<div class="sf-empty"><div class="sf-empty-icon">' + this.icon('search') + '</div>没有找到记录</div>';
      return;
    }

    arr.forEach(function(r){
      var realIdx = cbyd21_Search._records.indexOf(r);
      var content = cbyd21_Search.text(r.content || '');
      var html = cbyd21_Search.esc(content);

      if(q){
        var reg = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig');
        html = html.replace(reg, function(m){
          return '<span class="sf-highlight">' + cbyd21_Search.esc(m) + '</span>';
        });
      }

      var isFav = typeof cbyd21_FavoriteStore !== 'undefined' &&
        cbyd21_FavoriteStore.isFavorite &&
        cbyd21_FavoriteStore.isFavorite(r.meta || {});

      var card = document.createElement('div');
      card.className = 'sf-result-card';
      card.innerHTML =
        '<div class="sf-result-head">' +
          '<div class="sf-speaker">' + cbyd21_Search.esc(r.speakerName || '消息') + '</div>' +
          '<div class="sf-source">' + cbyd21_Search.esc(r.sourceLabel || cbyd21_Search.dateKey(r.ts)) + '</div>' +
        '</div>' +
        '<div class="sf-content">' + html + '</div>' +
        '<div class="sf-actions">' +
          '<button class="sf-action primary" onclick="cbyd21_Search.toggleFavorite(' + realIdx + ')">' + (isFav ? '取消收藏' : '收藏') + '</button>' +
          '<button class="sf-action" onclick="cbyd21_Search.copyRecord(' + realIdx + ')">复制</button>' +
          '<button class="sf-action" onclick="cbyd21_Search.showSource(' + realIdx + ')">来源</button>' +
        '</div>';

      list.appendChild(card);
    });
  },

  // toggleFavorite(idx) → 收藏 / 取消收藏某条搜索结果。
  // 搜索结果本身来自全部历史记录，收藏只是附加操作。
  toggleFavorite:function(idx){
    var r = this._records[idx];
    if(!r)return;

    if(typeof cbyd21_FavoriteStore === 'undefined' || !cbyd21_FavoriteStore.toggleRecord){
      showToast('收藏模块还没有加载完成');
      return;
    }

    cbyd21_FavoriteStore.toggleRecord(r);
  },

  // copyRecord(idx) → 复制某条搜索结果的可读文本。
  copyRecord:function(idx){
    var r = this._records[idx];
    if(!r)return;

    var txt = this.text(r.content || '');

    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){
        showToast('已复制');
      }).catch(function(){
        if(typeof _fallbackCopy === 'function')_fallbackCopy(txt);
      });
    }else if(typeof _fallbackCopy === 'function'){
      _fallbackCopy(txt);
    }
  },

  // showSource(idx) → 显示搜索结果来源信息。
  // 当前版本先用 Toast 展示来源路径，后续可扩展成跳转定位。
  showSource:function(idx){
    var r = this._records[idx];
    if(!r)return;

    var m = r.meta || {};

    var parts = [
      m.gameName,
      m.sourceName,
      m.modeName,
      m.branchName,
      m.sessionName,
      m.saveName,
      m.callName
    ].filter(Boolean);

    showToast(parts.join(' / ') || '没有来源信息');
  },

  // _record(data) → 搜索记录标准化入口。
  // 目前直接返回 data，保留给后续统一字段校验或格式转换。
  _record:function(data){
    return data;
  },

  // _speaker(msg, sourceType, sourceId) → 根据消息和来源判断显示的发送者名字。
  // 单聊显示用户/角色；群聊 AI 消息会根据 _charId 显示具体群成员。
  _speaker:function(msg, sourceType, sourceId){
    if(msg.role === 'user')return getCurrentProfile().name || '我';

    if(sourceType === 'group' && msg._charId){
      var ch = getCharById(msg._charId);
      return ch ? ch.name : '群成员';
    }

    if(sourceType === 'char'){
      var ch2 = getCharById(sourceId);
      return ch2 ? ch2.name : '角色';
    }

    return '角色';
  },

  // _inlineSessionName(chat,session)
  // → 线上内嵌线下 session 显示名。
  // 优先复用 inlineOffline.js 的编号逻辑，保证和收藏层级显示一致。
  _inlineSessionName:function(chat, session){
    if(!chat || !session)return '线上内嵌线下';

    try{
      if(window.cbyd21_InlineOffline && cbyd21_InlineOffline.getSessionNumber){
        return '第' + cbyd21_InlineOffline.getSessionNumber(chat, session) + '次见面';
      }

      var st = chat._inlineOffline || {};
      var sessions = Array.isArray(st.sessions) ? st.sessions : [];
      var ordered = sessions.slice().sort(function(a,b){
        return (a.created || 0) - (b.created || 0);
      });

      var idx = ordered.findIndex(function(s){
        return s && s.id === session.id;
      });

      return idx >= 0 ? ('第' + (idx + 1) + '次见面') : (session.label || '线上内嵌线下');
    }catch(e){
      return session.label || '线上内嵌线下';
    }
  },

  // recordsInlineOfflineCurrent(chat,ch,branchName,session)
  // → 搜索线上内嵌线下“当前进度”。
  // 这些消息实际存在 chat.messages 里，但属于线下叙事，不属于普通线上聊天。
  recordsInlineOfflineCurrent:function(chat, ch, branchName, session){
    var arr = [];

    if(!chat || !chat.messages || !session)return arr;

    var sourceName = ch ? getCharOnlineName(ch) : '角色';
    var sessionName = this._inlineSessionName(chat, session);

    chat.messages.forEach(function(m, idx){
      if(!m || !m.content)return;
      if(m._mode !== 'inline_offline')return;
      if(m._inlineSessionId !== session.id)return;
      if(m.content === '__system_init__' || m.content === '__system_continue__')return;

      var mid = cbyd21_FavoriteStore.ensureMid(m, function(){
        cbyd21_Data.saveChats();
      });

      var speaker = m.role === 'user'
        ? (getCurrentProfile().name || '我')
        : (ch ? ch.name : '角色');

      arr.push({
        content:m.content,
        speakerName:speaker,
        role:m.role,
        time:m.time || '',
        ts:m._ts || session.updatedAt || session.created || 0,
        sourceLabel:sessionName + ' · 当前进度',
        meta:{
          module:'offline',
          subModule:'inline_single',
          sourceType:'char',
          sourceId:chat.charId,
          sourceName:sourceName,
          branchId:chat.id,
          branchName:branchName,
          sessionId:session.id,
          sessionName:sessionName,
          saveId:'current',
          saveName:'当前进度',
          messageId:mid,
          messageIndex:idx,
          role:m.role,
          speakerName:speaker,
          inlineOffline:true
        }
      });
    });

    return arr;
  },

  // recordsInlineOfflineSave(chat,ch,branchName,session,save)
  // → 搜索线上内嵌线下某个手动存档。
  // 存档消息是 chat._inlineOffline.sessions[i]._saves[j].messages 的快照。
  recordsInlineOfflineSave:function(chat, ch, branchName, session, save){
    var arr = [];
    var msgs = save && save.messages || [];

    if(!chat || !session || !save)return arr;

    var sourceName = ch ? getCharOnlineName(ch) : '角色';
    var sessionName = this._inlineSessionName(chat, session);
    var saveName = save.label || '未命名存档';

    msgs.forEach(function(m, idx){
      if(!m || !m.content)return;
      if(m.content === '__system_init__' || m.content === '__system_continue__')return;

      var mid = cbyd21_FavoriteStore.ensureMid(m, function(){
        cbyd21_Data.saveChats();
      });

      var speaker = m.role === 'user'
        ? (getCurrentProfile().name || '我')
        : (ch ? ch.name : '角色');

      arr.push({
        content:m.content,
        speakerName:speaker,
        role:m.role,
        time:m.time || '',
        ts:m._ts || save.updated || save.created || session.created || 0,
        sourceLabel:saveName,
        meta:{
          module:'offline',
          subModule:'inline_single',
          sourceType:'char',
          sourceId:chat.charId,
          sourceName:sourceName,
          branchId:chat.id,
          branchName:branchName,
          sessionId:session.id,
          sessionName:sessionName,
          saveId:save.id,
          saveName:saveName,
          messageId:mid,
          messageIndex:idx,
          role:m.role,
          speakerName:speaker,
          inlineOffline:true
        }
      });
    });

    return arr;
  },

  // recordsOnlineBranch(chat, sourceType, sourceName, sourceId, branchName)
  // → 扫描某个线上分支内的全部普通聊天消息。
  // 会跳过系统触发标记和通话卡片，通话有单独搜索入口。
  recordsOnlineBranch:function(chat, sourceType, sourceName, sourceId, branchName){
    var out = [];

    if(!chat || !chat.messages)return out;

    chat.messages.forEach(function(m, idx){
      if(!m || !m.content)return;
      if(m._inlineCollapsed)return;
      if(m.content === '__system_init__' || m.content === '__system_continue__')return;

      // 线上内嵌线下显示在聊天页里，所以用户从“搜索聊天记录”入口也应该能搜到。
      // 但它的数据归属仍然是线下叙事，不能按普通线上 meta 收藏。
      // 因此单聊 inline_offline 消息复用 FavoriteStore 的统一构建逻辑：
      // 搜索结果会出现在这里，收藏时仍进入「咫尺朝夕 / 线上内嵌线下」层级。
      if(
        sourceType === 'char' &&
        m._mode === 'inline_offline' &&
        typeof cbyd21_FavoriteStore !== 'undefined' &&
        cbyd21_FavoriteStore._buildSingleChatFavoriteRecord
      ){
        var inlineRec = cbyd21_FavoriteStore._buildSingleChatFavoriteRecord(chat, m, idx);

        if(inlineRec && inlineRec.meta){
          out.push({
            content:inlineRec.content,
            speakerName:inlineRec.speakerName,
            role:inlineRec.role,
            time:inlineRec.time || '',
            ts:inlineRec.ts || m._ts || 0,
            sourceLabel:(inlineRec.meta.sessionName || '线上内嵌线下') + ' · ' + (inlineRec.meta.saveName || '当前进度'),
            meta:inlineRec.meta
          });
        }

        return;
      }

      if(String(m.content).startsWith('__call__'))return;

      var mid = cbyd21_FavoriteStore.ensureMid(m, function(){
        if(sourceType === 'group')cbyd21_Group._save();
        else cbyd21_Data.saveChats();
      });

      var speaker = cbyd21_Search._speaker(m, sourceType, sourceId);

      out.push({
        content:m.content,
        speakerName:speaker,
        role:m.role,
        time:m.time || '',
        ts:m._ts || 0,
        sourceLabel:branchName,
        meta:{
          module:'online',
          subModule:sourceType === 'group' ? 'group' : 'single',
          sourceType:sourceType,
          sourceId:sourceId,
          sourceName:sourceName,
          branchId:chat.id,
          branchName:branchName,
          messageId:mid,
          messageIndex:idx,
          role:m.role,
          speakerName:speaker,
          extraCharId:m._charId || ''
        }
      });
    });

    return out;
  },

  // openOnlineCurrent() → 从当前聊天角色打开线上聊天搜索。
  openOnlineCurrent:function(){
    var ch = getChatChar && getChatChar();
    if(ch)this.openOnlineChar(ch.id);
  },

  // openOnlineChar(charId) → 打开某个角色的线上聊天搜索。
  // 第一层先列出这个角色的所有线上分支。
  openOnlineChar:function(charId){
    var ch = getCharById(charId);
    var branches = chats.filter(function(c){
      return c.charId === charId;
    });

    var items = branches.map(function(chat){
      var name = _getBranchDisplayName(charId, chat.id);

      return {
        icon:cbyd21_Search.icon('chat'),
        title:name,
        sub:(chat.messages || []).length + ' 条消息',
        count:'进入',
        onclick:function(){
          cbyd21_Search.openResult({
            title:name + ' · 搜索',
            subtitle:'搜索 ' + (ch ? getCharOnlineName(ch) : '角色') + ' 的线上消息',
            records:cbyd21_Search.recordsOnlineBranch(chat, 'char', ch ? getCharOnlineName(ch) : '角色', charId, name)
          });
        }
      };
    });

    this.openNav((ch ? getCharOnlineName(ch) : '角色') + ' · 搜索聊天记录', '选择分支', items, {
      breadcrumb:'消息 / ' + (ch ? getCharOnlineName(ch) : '角色')
    });
  },

  // openGroupOnline() → 打开当前群聊的线上聊天搜索。
  // 第一层列出群聊所有分支。
  openGroupOnline:function(){
    if(typeof cbyd21_Group === 'undefined')return;

    var g = cbyd21_Group._getCurrentGroup && cbyd21_Group._getCurrentGroup();

    if(!g)return;

    var items = (g.branches || []).map(function(b, i){
      var branchName = '分支' + (g.branches.length - i);

      return {
        icon:cbyd21_Search.icon('group'),
        title:branchName,
        sub:(b.messages || []).length + ' 条消息',
        count:'进入',
        onclick:function(){
          cbyd21_Search.openResult({
            title:branchName + ' · 搜索',
            subtitle:'搜索 ' + g.name + ' 的群聊记录',
            records:cbyd21_Search.recordsOnlineBranch(b, 'group', g.name, g.id, branchName)
          });
        }
      };
    });

    this.openNav(g.name + ' · 搜索群聊记录', '选择分支', items, {
      breadcrumb:'消息 / ' + g.name
    });
  },

  // openCallCurrent() → 从当前聊天角色打开通话记录搜索。
  openCallCurrent:function(){
    var ch = getChatChar && getChatChar();
    if(ch)this.openCallChar(ch.id);
  },

  // openCallChar(charId) → 打开某个角色的通话搜索。
  // 第一层按线上分支列出每个分支下有多少通电话。
  openCallChar:function(charId){
    var ch = getCharById(charId);
    var branches = chats.filter(function(c){
      return c.charId === charId;
    });

    var items = branches.map(function(chat){
      var calls = (chat.messages || []).map(function(m, idx){
        return {m:m, idx:idx};
      }).filter(function(x){
        return x.m.content && x.m.content.startsWith('__call__');
      });

      var branchName = _getBranchDisplayName(charId, chat.id);

      return {
        icon:cbyd21_Search.icon('call'),
        title:branchName,
        sub:calls.length + ' 通电话',
        count:'进入',
        onclick:function(){
          cbyd21_Search._openCallList(ch, chat, branchName, calls);
        }
      };
    });

    this.openNav((ch ? ch.name : '角色') + ' · 搜索通话记录', '选择分支', items, {
      breadcrumb:'通话 / ' + (ch ? ch.name : '角色')
    });
  },

  // _openCallList(ch, chat, branchName, calls) → 打开某个分支下的通话记录列表。
  // 点进某通电话后，才进入最终搜索页。
  _openCallList:function(ch, chat, branchName, calls){
    var items = calls.map(function(x){
      var data = {};

      try{
        data = JSON.parse(x.m.content.slice(8));
      }catch(e){
        data = {messages:[]};
      }

      var callSourceChanged = false;

      if(data && !data._sourceTs && x.m && x.m._ts){
        data._sourceTs = x.m._ts;
        callSourceChanged = true;
      }

      if(data && !data._branchId && chat && chat.id){
        data._branchId = chat.id;
        callSourceChanged = true;
      }

      if(callSourceChanged && x.m){
        try{
          x.m.content = '__call__' + JSON.stringify(data);
          cbyd21_Data.saveChats();
        }catch(e){}
      }

      var callName = cbyd21_FavoriteStore._callName(data);

      return {
        icon:cbyd21_Search.icon('call'),
        title:callName,
        sub:(data.messages || []).length + ' 条通话消息',
        count:'搜索',
        onclick:function(){
          cbyd21_Search.openResult({
            title:callName,
            subtitle:'搜索这通电话',
            records:cbyd21_Search.recordsCall(chat, x.m, x.idx, data, callName, ch, branchName)
          });
        }
      };
    });

    this.openNav(branchName + ' · 通话记录', '选择通话', items, {
      breadcrumb:'通话 / ' + (ch ? ch.name : '角色') + ' / ' + branchName
    });
  },

  // recordsCall(chat, msg, msgIdx, data, callName, ch, branchName)
  // → 把某张通话卡里的每一句通话消息转换成搜索记录。
  recordsCall:function(chat, msg, msgIdx, data, callName, ch, branchName){
    var arr = [];

    // 旧通话卡片可能没有 _sourceTs / _branchId。
    // 搜索时顺手补齐，保证通话收藏、搜索和后续来源识别用同一套稳定来源。
    var sourceChanged = false;

    if(data && !data._sourceTs && msg && msg._ts){
      data._sourceTs = msg._ts;
      sourceChanged = true;
    }

    if(data && !data._branchId && chat && chat.id){
      data._branchId = chat.id;
      sourceChanged = true;
    }

    if(sourceChanged && msg){
      try{
        msg.content = '__call__' + JSON.stringify(data);
        cbyd21_Data.saveChats();
      }catch(e){}
    }

    var callId = String(data._sourceTs || data.created || msg._ts || msgIdx);

    (data.messages || []).forEach(function(cm, ci){
      var mid = cbyd21_FavoriteStore.ensureMid(cm, function(){
        try{
          if(msg){
            msg.content = '__call__' + JSON.stringify(data);
          }
          cbyd21_Data.saveChats();
        }catch(e){
          cbyd21_Data.saveChats();
        }
      });

      var speaker = cm.role === 'user' ? (getCurrentProfile().name || '我') : (ch ? ch.name : '角色');

      arr.push({
        content:cm.content,
        speakerName:speaker,
        role:cm.role,
        time:'',
        ts:cm._ts || data._sourceTs || msg._ts || 0,
        sourceLabel:callName,
        meta:{
          module:'call',
          subModule:'record',
          sourceType:'char',
          sourceId:ch ? ch.id : chat.charId,
          sourceName:ch ? ch.name : '角色',
          branchId:chat.id,
          branchName:branchName,
          callId:callId,
          callName:callName,
          messageId:mid,
          messageIndex:msgIdx,
          callMsgIndex:ci,
          role:cm.role,
          speakerName:speaker
        }
      });
    });

    return arr;
  },

  // openOfflineCurrent() → 从当前咫尺朝夕会话打开线下搜索。
  // 会自动判断当前是单人线下还是群聊线下。
  openOfflineCurrent:function(){
    if(typeof cbyd21_Offline === 'undefined')return;

    if(cbyd21_Offline._isGroupMode){
      this.openOfflineGroup(cbyd21_Offline._groupId);
    }else{
      this.openOfflineChar(cbyd21_Offline._charId);
    }
  },

  // openOfflineChar(charId) → 打开某个角色的咫尺朝夕搜索。
  // 层级：分支 → 第几次线下 → 存档 → 搜索页。
  openOfflineChar:function(charId){
    var ch = getCharById(charId);
    var sessions = (cbyd21_Offline._sessions && cbyd21_Offline._sessions[charId]) || [];
    var branches = chats.filter(function(c){ return c.charId === charId; });

    var items = branches.map(function(chat){
      var list = sessions.filter(function(s){
        return s._onlineBranchId === chat.id;
      });

      var inlineList = [];

      if(chat && chat._inlineOffline && Array.isArray(chat._inlineOffline.sessions)){
        inlineList = chat._inlineOffline.sessions.filter(function(s){
          return s && s.id;
        });
      }

      var name = _getBranchDisplayName(charId, chat.id);
      var totalCount = list.length + inlineList.length;

      return {
        icon:cbyd21_Search.icon('offline'),
        title:name,
        sub:totalCount + ' 次线下' + (inlineList.length ? (' · 含 ' + inlineList.length + ' 次线上内嵌线下') : ''),
        count:'进入',
        onclick:function(){
          if(inlineList.length > 0){
            cbyd21_Search._openOfflineMixedSessions(
              charId,
              ch ? getCharOnlineName(ch) : '角色',
              chat.id,
              name,
              list,
              inlineList,
              chat,
              ch
            );
          }else{
            cbyd21_Search._openOfflineSessions('char', charId, ch ? ch.name : '角色', chat.id, name, list);
          }
        }
      };
    });

    this.openNav((ch ? ch.name : '角色') + ' · 咫尺朝夕搜索', '选择分支', items, {
      breadcrumb:'咫尺朝夕 / ' + (ch ? ch.name : '角色')
    });
  },

  // openOfflineGroup(groupId) → 打开某个群聊的咫尺朝夕搜索。
  // 层级：群聊分支 → 第几次群聊线下 → 存档 → 搜索页。
  openOfflineGroup:function(groupId){
    var g = (cbyd21_Group._groups || []).find(function(x){
      return x.id === groupId;
    });

    if(!g)return;

    var sessions = g._offlineSessions || [];

    var items = (g.branches || []).map(function(b, i){
      var list = sessions.filter(function(s){
        return s._branchId === b.id;
      });

      var name = '分支' + (g.branches.length - i);

      return {
        icon:cbyd21_Search.icon('group'),
        title:name,
        sub:list.length + ' 次群聊线下',
        count:'进入',
        onclick:function(){
          cbyd21_Search._openOfflineSessions('group', groupId, g.name, b.id, name, list);
        }
      };
    });

    this.openNav(g.name + ' · 咫尺朝夕搜索', '选择分支', items, {
      breadcrumb:'咫尺朝夕 / ' + g.name
    });
  },

  // _openInlineOfflineSaves(chat,ch,branchName,session)
  // → 打开某次线上内嵌线下记录的“当前进度 / 存档”列表。
  _openInlineOfflineSaves:function(chat, ch, branchName, session){
    var saves = session && session._saves || [];
    var sessionName = this._inlineSessionName(chat, session);
    var items = [];

    items.push({
      icon:cbyd21_Search.icon('save'),
      title:'当前进度',
      sub:this.recordsInlineOfflineCurrent(chat, ch, branchName, session).length + ' 条消息',
      count:'搜索',
      onclick:function(){
        cbyd21_Search.openResult({
          title:'当前进度 · 搜索',
          subtitle:'搜索 ' + sessionName + ' 的当前进度',
          records:cbyd21_Search.recordsInlineOfflineCurrent(chat, ch, branchName, session)
        });
      }
    });

    saves.forEach(function(sv){
      items.push({
        icon:cbyd21_Search.icon('save'),
        title:sv.label || '未命名存档',
        sub:(sv.messages || []).length + ' 条消息',
        count:'搜索',
        onclick:function(){
          cbyd21_Search.openResult({
            title:(sv.label || '未命名存档') + ' · 搜索',
            subtitle:'搜索这个线上内嵌线下存档',
            records:cbyd21_Search.recordsInlineOfflineSave(chat, ch, branchName, session, sv)
          });
        }
      });
    });

    this.openNav(sessionName + ' · 线上内嵌线下', '选择当前进度或存档', items, {
      breadcrumb:'咫尺朝夕 / ' + (ch ? getCharOnlineName(ch) : '角色') + ' / ' + branchName + ' / ' + sessionName
    });
  },

  // _openOfflineMixedSessions(...)
  // → 单聊咫尺朝夕搜索的分支层级。
  // 同时展示：
  // · 咫尺朝夕 App 里的普通线下记录；
  // · 聊天页里的线上内嵌线下记录。
  _openOfflineMixedSessions:function(sourceId, sourceName, branchId, branchName, offlineSessions, inlineSessions, chat, ch){
    offlineSessions = offlineSessions || [];
    inlineSessions = inlineSessions || [];

    offlineSessions.forEach(function(s, i){
      var unifiedNo =
        typeof cbyd21_Offline !== 'undefined' &&
        cbyd21_Offline._getUnifiedSingleSessionNumber
          ? cbyd21_Offline._getUnifiedSingleSessionNumber(sourceId, branchId, s)
          : (offlineSessions.length - i);

      s._sfName = '第' + unifiedNo + '次线下';
    });

    var items = [];

    offlineSessions.forEach(function(s){
      var saveCount = s._saves ? s._saves.length : 0;

      items.push({
        icon:cbyd21_Search.icon('pin'),
        title:s._sfName,
        sub:(s.status === 'active' ? '进行中' : '已结束') + ' · 咫尺朝夕 App · ' + saveCount + ' 个存档',
        count:'进入',
        onclick:function(){
          cbyd21_Search._openOfflineSaves('char', sourceId, sourceName, branchId, branchName, s);
        }
      });
    });

    inlineSessions.forEach(function(s){
      var sessionName = cbyd21_Search._inlineSessionName(chat, s);
      var msgCount = cbyd21_Search.recordsInlineOfflineCurrent(chat, ch, branchName, s).length;
      var saveCount = s._saves ? s._saves.length : 0;

      items.push({
        icon:cbyd21_Search.icon('pin'),
        title:sessionName,
        sub:(s.status === 'ended' ? '已结束' : '进行中') + ' · 线上内嵌线下 · ' + msgCount + ' 条当前消息 · ' + saveCount + ' 个存档',
        count:'进入',
        onclick:function(){
          cbyd21_Search._openInlineOfflineSaves(chat, ch, branchName, s);
        }
      });
    });

    this.openNav(branchName + ' · 线下记录', '选择线下记录', items, {
      breadcrumb:'咫尺朝夕 / ' + sourceName + ' / ' + branchName
    });
  },

  // _openOfflineSessions(...) → 显示某个分支下的第几次线下记录。
  // 单人线下和群聊线下共用这一层。
  _openOfflineSessions:function(sourceType, sourceId, sourceName, branchId, branchName, sessions){
    sessions = sessions || [];

    sessions.forEach(function(s, i){
      s._sfName = '第' + (sessions.length - i) + '次线下';
    });

    var items = sessions.map(function(s){
      var saveCount = s._saves ? s._saves.length : 0;

      return {
        icon:cbyd21_Search.icon('pin'),
        title:s._sfName,
        sub:(s.status === 'active' ? '进行中' : '已结束') + ' · ' + saveCount + ' 个存档',
        count:'进入',
        onclick:function(){
          cbyd21_Search._openOfflineSaves(sourceType, sourceId, sourceName, branchId, branchName, s);
        }
      };
    });

    this.openNav(branchName + ' · 线下记录', '选择第几次线下', items, {
      breadcrumb:'咫尺朝夕 / ' + sourceName + ' / ' + branchName
    });
  },

  // _openOfflineSaves(...) → 显示某次线下记录里的存档列表。
  // 点击某个存档后进入最终搜索页。
  _openOfflineSaves:function(sourceType, sourceId, sourceName, branchId, branchName, session){
    var saves = session._saves || [];

    var items = saves.map(function(sv){
      return {
        icon:cbyd21_Search.icon('save'),
        title:sv.label || '未命名存档',
        sub:(sv.messages || []).length + ' 条消息',
        count:'搜索',
        onclick:function(){
          cbyd21_Search.openResult({
            title:(sv.label || '未命名存档') + ' · 搜索',
            subtitle:'搜索这个线下存档',
            records:cbyd21_Search.recordsOfflineSave(sourceType, sourceId, sourceName, branchId, branchName, session, sv)
          });
        }
      };
    });

    this.openNav((session._sfName || '线下记录') + ' · 存档', '选择存档', items, {
      breadcrumb:'咫尺朝夕 / ' + sourceName + ' / ' + branchName + ' / ' + (session._sfName || '线下记录')
    });
  },

  // recordsOfflineSave(...) → 把某个线下存档里的全部消息转换成搜索记录。
  // 收藏时也会记录这个 session 和 save 来源。
  recordsOfflineSave:function(sourceType, sourceId, sourceName, branchId, branchName, session, save){
    var arr = [];
    var msgs = save && save.messages || [];

    msgs.forEach(function(m, idx){
      var mid = cbyd21_FavoriteStore.ensureMid(m, function(){
        if(sourceType === 'group'){
          // 群聊线下记录属于 groupChats 大数据。
          // 补 _mid 后必须走 cbyd21_Group._save()，避免绕过 IndexedDB 主存。
          if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
            cbyd21_Group._save();
          }
        }else{
          cbyd21_Offline._saveSessions();
        }
      });

      var speaker = m.role === 'user' ? (getCurrentProfile().name || '我') : sourceName;

      arr.push({
        content:m.content,
        speakerName:speaker,
        role:m.role,
        time:m.time || '',
        ts:m._ts || save.updated || save.created || 0,
        sourceLabel:save.label || '存档',
        meta:{
          module:'offline',
          subModule:sourceType,
          sourceType:sourceType,
          sourceId:sourceId,
          sourceName:sourceName,
          branchId:branchId,
          branchName:branchName,
          sessionId:session.id,
          sessionName:session._sfName || '线下记录',
          saveId:save.id,
          saveName:save.label || '未命名存档',
          messageId:mid,
          messageIndex:idx,
          role:m.role,
          speakerName:speaker
        }
      });
    });

    return arr;
  },

  // openFateCurrent() → 从当前浮生逆笔角色打开剧情搜索。
  openFateCurrent:function(){
    if(typeof cbyd21_Fate === 'undefined' || !cbyd21_Fate._charId)return;
    this.openFateChar(cbyd21_Fate._charId);
  },

  // openFateChar(charId) → 打开某个角色的浮生逆笔搜索。
  // 层级：模式 → 时间线 → 搜索页。
  openFateChar:function(charId){
    var ch = getCharById(charId);

    var modes = [
      {id:'appear', name:'现身陪伴', icon:this.icon('appear')},
      {id:'shadow', name:'暗中守护', icon:this.icon('shadow')}
    ];

    var items = modes.map(function(mode){
      var branches = ((cbyd21_Fate._data && cbyd21_Fate._data[charId]) || []).filter(function(b){
        return b.mode === mode.id;
      });

      return {
        icon:mode.icon,
        title:mode.name,
        sub:branches.length + ' 条时间线',
        count:'进入',
        onclick:function(){
          cbyd21_Search._openFateBranches(charId, ch ? ch.name : '角色', mode, branches);
        }
      };
    });

    this.openNav((ch ? ch.name : '角色') + ' · 浮生逆笔搜索', '选择模式', items, {
      breadcrumb:'绘言戏局 / 浮生逆笔 / ' + (ch ? ch.name : '角色')
    });
  },

  // _openFateBranches(charId, sourceName, mode, branches)
  // → 显示某个模式下的浮生逆笔时间线列表。
  _openFateBranches:function(charId, sourceName, mode, branches){
    var items = branches.map(function(b, i){
      var name = '时间线' + (i + 1);

      return {
        icon:cbyd21_Search.icon('timeline'),
        title:name,
        sub:(b.messages || []).length + ' 段剧情',
        count:'搜索',
        onclick:function(){
          cbyd21_Search.openResult({
            title:name + ' · 搜索',
            subtitle:'搜索浮生逆笔剧情',
            records:cbyd21_Search.recordsFateBranch(charId, sourceName, mode, b, name)
          });
        }
      };
    });

    this.openNav(mode.name + ' · 时间线', '选择时间线', items, {
      breadcrumb:'绘言戏局 / 浮生逆笔 / ' + sourceName + ' / ' + mode.name
    });
  },

  // recordsFateBranch(...) → 把浮生逆笔某条时间线的剧情块转换成搜索记录。
  recordsFateBranch:function(charId, sourceName, mode, branch, branchName){
    var arr = [];

    (branch.messages || []).forEach(function(m, idx){
      var mid = cbyd21_FavoriteStore.ensureMid(m, function(){
        cbyd21_Fate._save();
      });

      var speaker = m.role === 'user' ? (getCurrentProfile().name || '我') : '剧情';

      arr.push({
        content:m.content,
        speakerName:speaker,
        role:m.role,
        time:m.time || '',
        ts:m._ts || branch.created || 0,
        sourceLabel:branchName,
        meta:{
          module:'games',
          subModule:'fate',
          gameId:'fate',
          gameName:'浮生逆笔',
          sourceType:'char',
          sourceId:charId,
          sourceName:sourceName,
          mode:mode.id,
          modeName:mode.name,
          branchId:branch.id,
          branchName:branchName,
          messageId:mid,
          messageIndex:idx,
          role:m.role,
          speakerName:speaker
        }
      });
    });

    return arr;
  },

  // _makeSearchItem(label, value, handler) → 生成搜索入口条目 HTML。
  // 当前主要作为预留工具函数，方便后续统一入口样式。
  _makeSearchItem:function(label, value, handler){
    return '<div class="char-info-item" onclick="' + handler + '">' +
      '<span class="char-info-item-icon">' + this.icon('search') + '</span>' +
      '<span class="char-info-item-label">' + label + '</span>' +
      (value ? '<span class="char-info-item-value">' + value + '</span>' : '') +
      '<span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>' +
    '</div>';
  },

  // injectCharInfo() → 给角色信息面板注入搜索入口。
  // 包括：搜索聊天记录、搜索通话记录。
  injectCharInfo:function(){
    var panel = document.getElementById('charInfoPanel');

    if(!panel || !panel.classList.contains('active'))return;
    if(document.getElementById('searchOnlineEntry'))return;

    var firstSection = panel.querySelector('.char-info-section');
    if(!firstSection)return;

    var title = firstSection.querySelector('.char-info-section-title');

    if(!title || title.textContent.trim() !== '聊天设置')return;

    var online = document.createElement('div');
    online.id = 'searchOnlineEntry';
    online.className = 'char-info-item';
    online.onclick = function(){ cbyd21_Search.openOnlineCurrent(); };
    online.innerHTML =
      '<span class="char-info-item-icon">' + this.icon('search') + '</span><span class="char-info-item-label">搜索聊天记录</span><span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';

    var call = document.createElement('div');
    call.id = 'searchCallEntry';
    call.className = 'char-info-item';
    call.onclick = function(){ cbyd21_Search.openCallCurrent(); };
    call.innerHTML =
      '<span class="char-info-item-icon">' + this.icon('call') + '</span><span class="char-info-item-label">搜索通话记录</span><span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';

    title.insertAdjacentElement('afterend', call);
    title.insertAdjacentElement('afterend', online);
  },

  // injectGroupSettings() → 给群聊设置页注入“搜索群聊记录”入口。
  injectGroupSettings:function(){
    var content = document.getElementById('groupSettingsContent');

    if(!content || document.getElementById('searchGroupEntry'))return;

    var wrap = document.createElement('div');
    wrap.id = 'searchGroupEntry';
    wrap.style.cssText = 'padding:16px 16px 0';
    wrap.innerHTML =
      '<div class="char-info-item" onclick="cbyd21_Search.openGroupOnline()" style="border-radius:10px;background:var(--bg-card);border:1px solid var(--border-soft);margin-bottom:8px">' +
        '<span class="char-info-item-icon">' + this.icon('search') + '</span><span class="char-info-item-label">搜索群聊记录</span><span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>' +
      '</div>';

    content.insertBefore(wrap, content.firstChild);
  },

  // injectOfflinePreset() → 给咫尺朝夕的编辑预设页顶部注入“搜索聊天记录”入口。
  injectOfflinePreset:function(){
    var page = document.getElementById('offlinePresetPage');

    if(!page || !page.classList.contains('active') || document.getElementById('searchOfflineEntry'))return;

    var scroll = page.querySelector('.app-scroll');

    if(!scroll)return;

    var div = document.createElement('div');
    div.id = 'searchOfflineEntry';
    div.className = 'char-info-item';
    div.style.cssText = 'border-radius:12px;background:var(--bg-card);border:1px solid var(--border-soft);margin-bottom:16px';
    div.onclick = function(){ cbyd21_Search.openOfflineCurrent(); };
    div.innerHTML =
      '<span class="char-info-item-icon">' + this.icon('search') + '</span>' +
      '<span class="char-info-item-label">搜索聊天记录</span>' +
      '<span class="char-info-item-value">按分支/存档</span>' +
      '<span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';

    scroll.insertBefore(div, scroll.firstChild);
  },

  // injectFatePreset() → 给浮生逆笔的编辑预设页顶部注入“搜索剧情记录”入口。
  injectFatePreset:function(){
    var page = document.getElementById('fatePresetPage');

    if(!page || !page.classList.contains('active') || document.getElementById('searchFateEntry'))return;

    var scroll = page.querySelector('.app-scroll');

    if(!scroll)return;

    var div = document.createElement('div');
    div.id = 'searchFateEntry';
    div.className = 'char-info-item';
    div.style.cssText = 'border-radius:12px;background:var(--bg-card);border:1px solid var(--border-soft);margin-bottom:16px';
    div.onclick = function(){ cbyd21_Search.openFateCurrent(); };
    div.innerHTML =
      '<span class="char-info-item-icon">' + this.icon('search') + '</span>' +
      '<span class="char-info-item-label">搜索剧情记录</span>' +
      '<span class="char-info-item-value">按模式/时间线</span>' +
      '<span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';

    scroll.insertBefore(div, scroll.firstChild);
  },

  // patchEntries() → 给现有页面打开函数打补丁，自动注入搜索入口。
  // 包括角色信息页、群聊设置页、线下预设页和浮生预设页。
  patchEntries:function(){
    var self = this;

    if(typeof openCharInfoPanel === 'function' && !openCharInfoPanel._searchPatched){
      var oldInfo = openCharInfoPanel;

      window.openCharInfoPanel = function(){
        oldInfo.apply(this, arguments);
        setTimeout(function(){ self.injectCharInfo(); }, 40);
      };

      window.openCharInfoPanel._searchPatched = true;
    }

    if(typeof openWriteCardInfoPanel === 'function' && !openWriteCardInfoPanel._searchPatched){
      var oldWrite = openWriteCardInfoPanel;

      window.openWriteCardInfoPanel = function(){
        oldWrite.apply(this, arguments);
        setTimeout(function(){ self.injectCharInfo(); }, 40);
      };

      window.openWriteCardInfoPanel._searchPatched = true;
    }

    if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group.openGroupSettings && !cbyd21_Group.openGroupSettings._searchPatched){
      var oldGroup = cbyd21_Group.openGroupSettings;

      cbyd21_Group.openGroupSettings = function(){
        oldGroup.apply(cbyd21_Group, arguments);
        setTimeout(function(){ self.injectGroupSettings(); }, 40);
      };

      cbyd21_Group.openGroupSettings._searchPatched = true;
    }

    if(typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline.openPresetEditor && !cbyd21_Offline.openPresetEditor._searchPatched){
      var oldOff = cbyd21_Offline.openPresetEditor;

      cbyd21_Offline.openPresetEditor = function(){
        oldOff.apply(cbyd21_Offline, arguments);
        setTimeout(function(){ self.injectOfflinePreset(); }, 40);
      };

      cbyd21_Offline.openPresetEditor._searchPatched = true;
    }

    if(typeof cbyd21_Fate !== 'undefined' && cbyd21_Fate.openPresetEditor && !cbyd21_Fate.openPresetEditor._searchPatched){
      var oldFate = cbyd21_Fate.openPresetEditor;

      cbyd21_Fate.openPresetEditor = function(){
        oldFate.apply(cbyd21_Fate, arguments);
        setTimeout(function(){ self.injectFatePreset(); }, 40);
      };

      cbyd21_Fate.openPresetEditor._searchPatched = true;
    }
  }
};

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    cbyd21_Search.patchEntries();
  }, 600);
});

setTimeout(function(){
  if(typeof cbyd21_Search !== 'undefined'){
    cbyd21_Search.patchEntries();
  }
}, 1600);
