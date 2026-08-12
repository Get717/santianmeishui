// ===== cbyd21_FavoriteStore — 收藏数据公共层 =====
// 只负责收藏数据，不负责搜索页面，也不负责暮屿藏笺页面。

var cbyd21_FavoriteStore = {
  KEY:'stm_favorites',

  // load() → 读取本地收藏列表。
  // 数据存在 localStorage 的 stm_favorites 中。
  // 如果数据损坏或不是数组，返回空数组，避免收藏 App 启动失败。
  load:function(){
    try{
      var arr = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    }catch(e){
      return [];
    }
  },

  // save(arr) → 保存收藏列表。
  // 所有模块的收藏都统一存在同一个数组里，方便暮屿藏笺按模块分层展示。
  save:function(arr){
    localStorage.setItem(this.KEY, JSON.stringify(arr || []));
  },

  // esc(s) → HTML 转义。
  // 收藏内容和搜索内容可能来自用户/AI消息，展示前必须转义，避免 HTML 被当成页面结构执行。
  esc:function(s){
    if(typeof escHtml === 'function')return escHtml(String(s == null ? '' : s));
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  },

  // nowId(prefix) → 生成带时间戳和随机串的本地唯一 ID。
  // 用于收藏记录 id、旧消息补 _mid 等场景。
  nowId:function(prefix){
    return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  },

  // text(s) → 把内部消息格式转换成用户可读文本。
  // 会清理心声、双语标记、thinking 泄露等内容。
  // 收藏快照和搜索结果都用这个函数生成展示文本。
  text:function(s){
    s = String(s || '');

    var self = this;

    function cleanText(v){
      v = String(v || '');

      if(typeof _cbyd21MessageContentForUserAction === 'function'){
        v = _cbyd21MessageContentForUserAction(v);
      }

      if(typeof _stripLeakedThinking === 'function'){
        v = _stripLeakedThinking(v);
      }

      return v
        .replace(/__inner_voice__[\s\S]*/,'')
        .replace(/__bilingual_split__/g,'\n')
        .replace(/__bl_sep__/g,'')
        .trim();
    }

    function locText(v, fallback){
      v = String(v || fallback || '').trim();

      if(v.indexOf('__bilingual_split__') >= 0){
        var parts = v.split('__bilingual_split__');
        var main = (parts[0] || '').trim();
        var trans = parts.slice(1).join('').trim();
        return main && trans ? main + '（' + trans + '）' : (main || trans);
      }

      return v;
    }

    if(typeof _stripLeakedThinking === 'function'){
      s = _stripLeakedThinking(s);
    }

    if(s.startsWith('__quote__')){
      var qParsed = typeof _cbyd21ParseQuotePrefix === 'function'
        ? _cbyd21ParseQuotePrefix(s)
        : null;

      if(qParsed && qParsed.data){
        return '引用 ' + (qParsed.data.name || '某人') + '：' + (qParsed.data.preview || '') + '\n' + cleanText(qParsed.rest || '');
      }

      var qEnd = s.indexOf('\n');

      if(qEnd > 0){
        try{
          var qData = JSON.parse(s.slice(9, qEnd));
          return '引用 ' + (qData.name || '某人') + '：' + (qData.preview || '') + '\n' + cleanText(s.slice(qEnd + 1));
        }catch(e){
          return cleanText(s.slice(qEnd + 1));
        }
      }
    }

    if(s.startsWith('__user_recall__')){
      return '[撤回消息]\n' + cleanText(s.slice('__user_recall__'.length));
    }

    if(s.startsWith('__recall__')){
      return '[撤回消息]\n' + cleanText(s.slice('__recall__'.length));
    }

    if(s.startsWith('__voice__')){
      return '[语音]\n' + cleanText(s.slice('__voice__'.length));
    }

    if(s.startsWith('__fakeimg__')){
      return '[图片描述]\n' + cleanText(s.slice('__fakeimg__'.length));
    }

    if(s.startsWith('__realimg__')){
      return '[图片]';
    }

    if(s.startsWith('__sticker__')){
      return '[表情包]';
    }

    if(s.startsWith('__call__')){
      try{
        var call = JSON.parse(s.slice('__call__'.length));
        var dur = call.duration || 0;
        var min = Math.floor(dur / 60).toString().padStart(2,'0');
        var sec = (dur % 60).toString().padStart(2,'0');
        var count = call.messages ? call.messages.length : 0;
        return '[通话记录] ' + min + ':' + sec + ' · ' + count + '条通话消息';
      }catch(e){
        return '[通话记录]';
      }
    }

    if(s.startsWith('__offline_record__')){
      try{
        var rec = JSON.parse(s.slice('__offline_record__'.length));
        return '[线下见面记录] ' + (rec.msgCount || 0) + '条消息';
      }catch(e){
        return '[线下见面记录]';
      }
    }

    if(s.startsWith('__inline_offline_end__')){
      try{
        var ioe = JSON.parse(s.slice('__inline_offline_end__'.length));
        return '[线上内嵌线下] 第' + (ioe.sessionNo || 1) + '次见面已结束';
      }catch(e){
        return '[线上内嵌线下] 本次见面已结束';
      }
    }

    if(s.startsWith('__inline_offline_record__')){
      try{
        var ior = JSON.parse(s.slice('__inline_offline_record__'.length));
        return '[线上内嵌线下记录] 第' + (ior.sessionNo || 1) + '次见面 · ' + (ior.msgCount || 0) + '条消息';
      }catch(e){
        return '[线上内嵌线下记录]';
      }
    }

    if(s.startsWith('__transfer__')){
      try{
        var tf = JSON.parse(s.slice('__transfer__'.length));
        var amount = Number(tf.amount || 0);
        var status = tf.status === 'accepted' ? '已收款' : (tf.status === 'rejected' ? '已退回' : '待处理');
        var note = tf.note ? '，备注：' + locText(tf.note,'') : '';

        if(tf.from === 'user' && tf.to === 'char'){
          return '[转账] 用户转给' + (tf.toName || '角色') + ' ¥' + amount.toFixed(2) + note + '，' + status;
        }

        if(tf.from === 'char' && tf.to === 'char'){
          return '[转账] ' + (tf.fromName || '角色') + '转给' + (tf.toName || '角色') + ' ¥' + amount.toFixed(2) + note + '，' + status;
        }

        if(tf.from === 'char'){
          return '[转账] 角色转给用户 ¥' + amount.toFixed(2) + note + '，' + status;
        }

        if(tf.from === 'result'){
          return '[转账结果] ¥' + amount.toFixed(2) + ' · ' + status;
        }

        return '[转账] ¥' + amount.toFixed(2) + note + '，' + status;
      }catch(e){
        return '[转账]';
      }
    }

    if(s.startsWith('__location__')){
      try{
        var loc = JSON.parse(s.slice('__location__'.length));
        return '[定位] ' + locText(loc.name,'未知地点') + (loc.addr ? ' · ' + locText(loc.addr,'') : '');
      }catch(e){
        return '[定位]';
      }
    }

    if(s.startsWith('__share_location__')){
      try{
        var sl = JSON.parse(s.slice('__share_location__'.length));
        return '[共享位置] ' + locText(sl.name,'未知位置') + (sl.addr ? ' · ' + locText(sl.addr,'') : '');
      }catch(e){
        return '[共享位置]';
      }
    }

    if(s.startsWith('__share_response__')){
      try{
        var sr = JSON.parse(s.slice('__share_response__'.length));
        var srLoc = sr.charLoc || sr;
        return '[共享位置回应] ' + locText(srLoc.name,'未知位置') + (srLoc.addr ? ' · ' + locText(srLoc.addr,'') : '');
      }catch(e){
        return '[共享位置回应]';
      }
    }

    if(s.startsWith('__share_invite__')){
      try{
        var si = JSON.parse(s.slice('__share_invite__'.length));
        return '[共享位置邀请] ' + locText(si.name,'未知位置') + (si.addr ? ' · ' + locText(si.addr,'') : '');
      }catch(e){
        return '[共享位置邀请]';
      }
    }

    if(s.startsWith('__share_ignore__'))return '[未回应共享位置邀请]';
    if(s.startsWith('__share_reject__'))return '[拒绝共享位置邀请]';
    if(s.startsWith('__share_end__'))return '[共享位置已结束]';

    if(s.startsWith('__offline_invite__')){
      try{
        var oi = JSON.parse(s.slice('__offline_invite__'.length));
        return '[线下邀请] ' + locText(oi.msg || oi.scene || '线下见面邀请','线下见面邀请');
      }catch(e){
        return '[线下邀请]';
      }
    }

    return cleanText(s);
  },

  // dateKey(ts) → 把时间戳转换成 YYYY-MM-DD。
  // 用于搜索页按日期筛选，也用于收藏卡片显示日期。
  // 没有有效时间戳时归入“无日期”。
  dateKey:function(ts){
    if(!ts)return '无日期';

    var d = new Date(ts);
    if(isNaN(d.getTime()))return '无日期';

    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  },

  // ensureMid(msg, saveFn) → 确保某条消息拥有稳定唯一 ID：_mid。
  // 旧消息可能没有 _mid，第一次搜索/收藏时会自动补一个。
  // saveFn 用于把补好的 _mid 写回原数据源。
  ensureMid:function(msg, saveFn){
    if(!msg)return '';

    if(!msg._mid){
      msg._mid = this.nowId('msg');

      if(saveFn){
        try{ saveFn(); }catch(e){}
      }
    }

    return msg._mid;
  },

  // key(meta) → 根据来源信息生成收藏唯一键。
  // 优先使用稳定 messageId / _mid 定位消息。
  // 只有没有 messageId 的极旧数据，才退回使用 messageIndex / callMsgIndex。
  // 这样删除前文或插入前文导致数组 index 变化时，同一条消息仍能识别为同一条收藏。
  key:function(meta){
    meta = meta || {};

    var base = [
      meta.module || '',
      meta.subModule || '',
      meta.sourceType || '',
      meta.sourceId || '',
      meta.branchId || '',
      meta.sessionId || '',
      meta.saveId || '',
      meta.callId || '',
      meta.gameId || '',
      meta.mode || ''
    ];

    if(meta.messageId){
      return base.concat([
        'mid',
        meta.messageId
      ]).join('|');
    }

    return base.concat([
      'idx',
      meta.messageIndex !== undefined ? meta.messageIndex : '',
      meta.callMsgIndex !== undefined ? meta.callMsgIndex : ''
    ]).join('|');
  },

  // sameRecord(meta, fav) → 判断 meta 和已有收藏 fav 是否指向同一条来源消息。
  // 新逻辑优先比较稳定 messageId，不依赖数组 index。
  // 也兼容旧版 _key，避免旧收藏因为 key 规则升级而失效。
  sameRecord:function(meta, fav){
    meta = meta || {};
    fav = fav || {};

    var key = this.key(meta);

    if(fav._key && fav._key === key)return true;

    if(!meta.messageId || !fav.messageId)return false;

    return (
      String(meta.module || '') === String(fav.module || '') &&
      String(meta.subModule || '') === String(fav.subModule || '') &&
      String(meta.sourceType || '') === String(fav.sourceType || '') &&
      String(meta.sourceId || '') === String(fav.sourceId || '') &&
      String(meta.branchId || '') === String(fav.branchId || '') &&
      String(meta.sessionId || '') === String(fav.sessionId || '') &&
      String(meta.saveId || '') === String(fav.saveId || '') &&
      String(meta.callId || '') === String(fav.callId || '') &&
      String(meta.gameId || '') === String(fav.gameId || '') &&
      String(meta.mode || '') === String(fav.mode || '') &&
      String(meta.messageId || '') === String(fav.messageId || '')
    );
  },

  // isFavorite(meta) → 判断某个来源消息是否已收藏。
  // 搜索结果按钮、右键菜单文字都会用它来动态显示状态。
  isFavorite:function(meta){
    var self = this;

    return this.load().some(function(f){
      return self.sameRecord(meta, f);
    });
  },

  // toggleRecord(record) → 收藏 / 取消收藏一条搜索结果或消息记录。
  // 如果同 key 收藏已存在，则删除收藏。
  // 如果不存在，则保存一条收藏快照到 stm_favorites。
  toggleRecord:function(record){
    if(!record || !record.meta)return false;

    var arr = this.load();
    var key = this.key(record.meta);
    var self = this;
    var idx = arr.findIndex(function(f){
      return self.sameRecord(record.meta, f);
    });

    if(idx >= 0){
      arr.splice(idx,1);
      this.save(arr);
      showToast('已取消收藏');

      if(typeof cbyd21_Search !== 'undefined' && cbyd21_Search.renderResultList){
        cbyd21_Search.renderResultList();
      }

      if(typeof cbyd21_Favorites !== 'undefined' && cbyd21_Favorites.refreshIfOpen){
        cbyd21_Favorites.refreshIfOpen();
      }

      return false;
    }

    var fav = Object.assign({}, record.meta, {
      id:this.nowId('fav'),
      _key:key,
      speakerName:record.speakerName || record.meta.speakerName || '',
      role:record.role || record.meta.role || '',
      contentSnapshot:this.text(record.content || ''),
      time:record.time || '',
      ts:record.ts || Date.now(),
      createdAt:Date.now()
    });

    arr.unshift(fav);
    this.save(arr);
    showToast('已收藏');

    if(typeof cbyd21_Search !== 'undefined' && cbyd21_Search.renderResultList){
      cbyd21_Search.renderResultList();
    }

    if(typeof cbyd21_Favorites !== 'undefined' && cbyd21_Favorites.refreshIfOpen){
      cbyd21_Favorites.refreshIfOpen();
    }

    return true;
  },

  // remove(id) → 根据收藏记录 id 删除收藏。
  // 暮屿藏笺详情页点击“取消收藏”时调用。
  remove:function(id){
    var arr = this.load().filter(function(f){
      return f.id !== id;
    });

    this.save(arr);
    showToast('已取消收藏');

    if(typeof cbyd21_Favorites !== 'undefined' && cbyd21_Favorites.refreshIfOpen){
      cbyd21_Favorites.refreshIfOpen();
    }
  },

  // copy(id) → 复制某条收藏的快照文本。
  // 即使原消息已经被删除，只要收藏快照还在，也可以复制。
  copy:function(id){
    var f = this.load().find(function(x){
      return x.id === id;
    });

    if(!f)return;

    var txt = f.contentSnapshot || '';

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

  // _groupBranchName(group, branchId) → 根据群聊分支 ID 生成“分支N”显示名。
  // 收藏和搜索里展示群聊来源时使用。
  _groupBranchName:function(group, branchId){
    if(!group || !group.branches)return '分支';

    var idx = group.branches.findIndex(function(b){
      return b.id === branchId;
    });

    if(idx < 0)return '分支';

    return '分支' + (group.branches.length - idx);
  },

  // _fateBranchName(charId, branchId, mode) → 生成浮生逆笔时间线名称。
  // 根据角色、模式、分支 ID 找到对应“时间线N”。
  _fateBranchName:function(charId, branchId, mode){
    if(typeof cbyd21_Fate === 'undefined')return '时间线';

    var arr = ((cbyd21_Fate._data && cbyd21_Fate._data[charId]) || []).filter(function(b){
      return b.mode === mode;
    });

    var idx = arr.findIndex(function(b){
      return b.id === branchId;
    });

    if(idx < 0)return '时间线';

    return '时间线' + (idx + 1);
  },

  // _callName(data) → 生成通话记录显示名。
  // 格式类似：YYYY-MM-DD · 通话 03:24。
  _callName:function(data){
    data = data || {};

    var ts = data._sourceTs || data.created || Date.now();
    var dur = data.duration || 0;
    var min = Math.floor(dur / 60).toString().padStart(2,'0');
    var sec = (dur % 60).toString().padStart(2,'0');

    return this.dateKey(ts) + ' · 通话 ' + min + ':' + sec;
  },

  // _buildSingleChatFavoriteRecord(chat,msg,idx)
  // → 单聊消息收藏元数据构建。
  // 普通线上消息归入 module:'online'；
  // 线上内嵌线下消息归入 module:'offline'，并绑定 _inlineSessionId。
  // 这样单聊内嵌线下收藏会出现在「咫尺朝夕」层级，而不是混进普通线上消息。
  _buildSingleChatFavoriteRecord:function(chat,msg,idx){
    if(!chat || !msg)return null;

    if(msg.content === '__system_init__' || msg.content === '__system_continue__')return null;
    if(String(msg.content || '').startsWith('__call__'))return null;

    var ch = getCharById(chat.charId);
    var mid = this.ensureMid(msg, function(){
      cbyd21_Data.saveChats();
    });

    var branchName = _getBranchDisplayName(chat.charId, chat.id);
    var speakerName = msg.role === 'user'
      ? (getCurrentProfile().name || '我')
      : (ch ? ch.name : '角色');

    var isInlineOffline = msg._mode === 'inline_offline' || !!msg._inlineSessionId;

    if(isInlineOffline){
      var st = chat._inlineOffline || {};
      var sessions = Array.isArray(st.sessions) ? st.sessions : [];
      var sessionId = msg._inlineSessionId || st.activeSessionId || '';
      var session = sessions.find(function(s){
        return s && s.id === sessionId;
      }) || null;

      var sessionName = '线上内嵌线下';

      if(session){
        if(window.cbyd21_InlineOffline && cbyd21_InlineOffline.getSessionNumber){
          sessionName = '第' + cbyd21_InlineOffline.getSessionNumber(chat, session) + '次见面';
        }else if(session.label){
          sessionName = session.label;
        }
      }else if(sessionId){
        sessionName = '内嵌线下记录';
      }

      return {
        content:msg.content,
        speakerName:speakerName,
        role:msg.role,
        time:msg.time || '',
        ts:msg._ts || Date.now(),
        meta:{
          module:'offline',
          subModule:'inline_single',
          sourceType:'char',
          sourceId:chat.charId,
          sourceName:ch ? getCharOnlineName(ch) : '角色',
          branchId:chat.id,
          branchName:branchName,
          sessionId:sessionId,
          sessionName:sessionName,
          saveId:'current',
          saveName:'当前进度',
          messageId:mid,
          messageIndex:idx,
          role:msg.role,
          speakerName:speakerName,
          inlineOffline:true
        }
      };
    }

    return {
      content:msg.content,
      speakerName:speakerName,
      role:msg.role,
      time:msg.time || '',
      ts:msg._ts || Date.now(),
      meta:{
        module:'online',
        subModule:'single',
        sourceType:'char',
        sourceId:chat.charId,
        sourceName:ch ? getCharOnlineName(ch) : '角色',
        branchId:chat.id,
        branchName:branchName,
        messageId:mid,
        messageIndex:idx,
        role:msg.role,
        speakerName:speakerName
      }
    };
  },

  // updateOnlineContextText(idx) → 更新线上消息右键菜单里的“收藏 / 取消收藏”文字。
  // 单聊和群聊都会根据当前消息是否已收藏来切换显示。
  updateOnlineContextText:function(idx){
    var txt = document.getElementById('favContextText');

    if(!txt)return;

    var meta = null;
    var isGroup = document.getElementById('chatView') && document.getElementById('chatView').dataset.groupMode === 'true';

    if(isGroup && typeof cbyd21_Group !== 'undefined'){
      var group = cbyd21_Group._getCurrentGroup && cbyd21_Group._getCurrentGroup();
      var branch = cbyd21_Group._getCurrentBranch && cbyd21_Group._getCurrentBranch();
      var msg = cbyd21_Group._messages && cbyd21_Group._messages[idx];

      if(group && branch && msg){
        var mid = this.ensureMid(msg, function(){ cbyd21_Group._save(); });

        meta = {
          module:'online',
          subModule:'group',
          sourceType:'group',
          sourceId:group.id,
          branchId:branch.id,
          messageId:mid,
          messageIndex:idx
        };
      }
    }else{
      var chat = typeof getCurrentChat === 'function' ? getCurrentChat() : null;
      var msg2 = chat && chat.messages && chat.messages[idx];

      if(chat && msg2){
        if(String(msg2.content || '').startsWith('__call__')){
          txt.textContent = '进通话详情收藏';
          return;
        }

        var rec = this._buildSingleChatFavoriteRecord(chat, msg2, idx);

        if(rec && rec.meta){
          meta = rec.meta;
        }
      }
    }

    txt.textContent = meta && this.isFavorite(meta) ? '取消收藏' : '收藏';
  },

  // toggleSelectedChatFavorite() → 右键/长按菜单里的收藏入口。
  // 根据当前是否是群聊，分别调用单聊或群聊收藏逻辑。
  toggleSelectedChatFavorite:function(){
    if(typeof contextMsgIdx === 'undefined' || contextMsgIdx === null)return;

    var isGroup = document.getElementById('chatView') && document.getElementById('chatView').dataset.groupMode === 'true';

    if(isGroup){
      this._toggleGroupChat(contextMsgIdx);
    }else{
      this._toggleSingleChat(contextMsgIdx);
    }

    var cm = document.getElementById('contextMenu');
    if(cm)cm.classList.remove('active');
  },

  // _toggleSingleChat(idx) → 收藏 / 取消收藏当前单聊分支中的某条消息。
  // 会记录：角色、分支、消息 ID、消息位置、发送者和快照内容。
  _toggleSingleChat:function(idx){
    var chat = typeof getCurrentChat === 'function' ? getCurrentChat() : null;

    if(!chat || !chat.messages || !chat.messages[idx])return;

    var msg = chat.messages[idx];

    if(String(msg.content || '').startsWith('__call__')){
      showToast('请进入通话记录详情收藏具体通话消息');
      return;
    }

    var rec = this._buildSingleChatFavoriteRecord(chat, msg, idx);

    if(!rec || !rec.meta)return;

    this.toggleRecord(rec);
  },

  // _toggleGroupChat(idx) → 收藏 / 取消收藏当前群聊分支中的某条消息。
  // 群聊 AI 消息会额外记录 _charId，用于显示具体是哪位群成员发言。
  _toggleGroupChat:function(idx){
    if(typeof cbyd21_Group === 'undefined')return;

    var group = cbyd21_Group._getCurrentGroup && cbyd21_Group._getCurrentGroup();
    var branch = cbyd21_Group._getCurrentBranch && cbyd21_Group._getCurrentBranch();
    var msg = cbyd21_Group._messages && cbyd21_Group._messages[idx];

    if(!group || !branch || !msg)return;

    var mid = this.ensureMid(msg, function(){ cbyd21_Group._save(); });
    var ch = msg._charId ? getCharById(msg._charId) : null;

    var meta = {
      module:'online',
      subModule:'group',
      sourceType:'group',
      sourceId:group.id,
      sourceName:group.name,
      branchId:branch.id,
      branchName:this._groupBranchName(group, branch.id),
      messageId:mid,
      messageIndex:idx,
      role:msg.role,
      speakerName:msg.role === 'user' ? (getCurrentProfile().name || '我') : (ch ? ch.name : '群成员'),
      extraCharId:msg._charId || ''
    };

    this.toggleRecord({
      content:msg.content,
      speakerName:meta.speakerName,
      role:msg.role,
      time:msg.time || '',
      ts:msg._ts || Date.now(),
      meta:meta
    });
  },

  // toggleOfflineMessage(idx) → 收藏 / 取消收藏咫尺朝夕中的某条线下消息。
  // 会先确保当前进度写入活动存档，再记录分支、线下 session 和存档名。
  toggleOfflineMessage:function(idx){
    if(typeof cbyd21_Offline === 'undefined')return;

    var msg = cbyd21_Offline._messages && cbyd21_Offline._messages[idx];

    if(!msg)return;

    var session = cbyd21_Offline._getSession && cbyd21_Offline._getSession();

    if(!session)return;

    // 先给当前消息补稳定 _mid，再把当前进度写入活动存档。
    // 否则存档快照里可能没有这个 _mid，后续从搜索页收藏同一条线下消息时会被当成另一条。
    var mid = this.ensureMid(msg, function(){});

    cbyd21_Offline._autoUpdateActiveSave(session);

    if(cbyd21_Offline._isGroupMode)cbyd21_Offline._saveGroupSessions();
    else cbyd21_Offline._saveSessions();

    var save = null;

    if(session._activeSaveId && session._saves){
      save = session._saves.find(function(s){
        return s.id === session._activeSaveId;
      }) || null;
    }

    var sourceType = cbyd21_Offline._isGroupMode ? 'group' : 'char';
    var sourceId = '';
    var sourceName = '';
    var branchId = '';
    var branchName = '';

    if(sourceType === 'group'){
      var g = (cbyd21_Group._groups || []).find(function(x){
        return x.id === cbyd21_Offline._groupId;
      });

      sourceId = cbyd21_Offline._groupId;
      sourceName = g ? g.name : '群聊';
      branchId = session._branchId || '';
      branchName = this._groupBranchName(g, branchId);
    }else{
      var ch = getCharById(cbyd21_Offline._charId);
      sourceId = cbyd21_Offline._charId;
      sourceName = ch ? ch.name : '角色';
      branchId = session._onlineBranchId || '';
      branchName = _getBranchDisplayName(sourceId, branchId);
    }

    var meta = {
      module:'offline',
      subModule:sourceType,
      sourceType:sourceType,
      sourceId:sourceId,
      sourceName:sourceName,
      branchId:branchId,
      branchName:branchName,
      sessionId:session.id,
      sessionName:session._sfName || '线下记录',
      saveId:save ? save.id : '',
      saveName:save ? save.label : '未命名存档',
      messageId:mid,
      messageIndex:idx,
      role:msg.role,
      speakerName:msg.role === 'user' ? (getCurrentProfile().name || '我') : sourceName
    };

    this.toggleRecord({
      content:msg.content,
      speakerName:meta.speakerName,
      role:msg.role,
      time:msg.time || '',
      ts:msg._ts || (save && (save.updated || save.created)) || Date.now(),
      meta:meta
    });
  },

  // toggleFateMessage(idx) → 收藏 / 取消收藏浮生逆笔中的某段剧情。
  // 会记录绘言戏局、浮生逆笔、角色、模式和时间线来源。
  toggleFateMessage:function(idx){
    if(typeof cbyd21_Fate === 'undefined')return;

    var msg = cbyd21_Fate._messages && cbyd21_Fate._messages[idx];

    if(!msg)return;

    var ch = getCharById(cbyd21_Fate._charId);
    var branch = cbyd21_Fate._getCurrentBranch && cbyd21_Fate._getCurrentBranch();
    var mid = this.ensureMid(msg, function(){ cbyd21_Fate._save(); });

    var mode = cbyd21_Fate._mode || 'appear';

    var meta = {
      module:'games',
      subModule:'fate',
      gameId:'fate',
      gameName:'浮生逆笔',
      sourceType:'char',
      sourceId:cbyd21_Fate._charId,
      sourceName:ch ? ch.name : '角色',
      mode:mode,
      modeName:mode === 'shadow' ? '暗中守护' : '现身陪伴',
      branchId:branch ? branch.id : '',
      branchName:this._fateBranchName(cbyd21_Fate._charId, branch ? branch.id : '', mode),
      messageId:mid,
      messageIndex:idx,
      role:msg.role,
      speakerName:msg.role === 'user' ? (getCurrentProfile().name || '我') : '剧情'
    };

    this.toggleRecord({
      content:msg.content,
      speakerName:meta.speakerName,
      role:msg.role,
      time:msg.time || '',
      ts:msg._ts || (branch && branch.created) || Date.now(),
      meta:meta
    });
  },

  // toggleLiveCallMessage(idx) → 收藏 / 取消收藏当前正在进行的通话消息。
  // 用 live_通话开始时间 作为当前通话来源 ID。
  toggleLiveCallMessage:function(idx){
    if(typeof _callMessages === 'undefined' || !_callMessages[idx])return;

    var msg = _callMessages[idx];
    var ch = getCharById(typeof _callCharId !== 'undefined' ? _callCharId : null);

    var mid = this.ensureMid(msg, function(){});

    var meta = {
      module:'call',
      subModule:'live',
      sourceType:'char',
      sourceId:ch ? ch.id : '',
      sourceName:ch ? ch.name : '角色',
      branchId:typeof _callBranchId !== 'undefined' ? (_callBranchId || '') : '',
      branchName:ch && typeof _callBranchId !== 'undefined' && _callBranchId ? _getBranchDisplayName(ch.id, _callBranchId) : '通话分支',
      callId:'live_' + (typeof _callStartTime !== 'undefined' ? _callStartTime : Date.now()),
      callName:'当前通话',
      messageId:mid,
      messageIndex:idx,
      callMsgIndex:idx,
      role:msg.role,
      speakerName:msg.role === 'user' ? (getCurrentProfile().name || '我') : (ch ? ch.name : '角色')
    };

    this.toggleRecord({
      content:msg.content,
      speakerName:meta.speakerName,
      role:msg.role,
      time:'',
      ts:msg._ts || Date.now(),
      meta:meta
    });
  },

  // toggleCallLogMessage(idx) → 收藏 / 取消收藏历史通话记录里的某一句。
  // 来源会记录通话卡片、通话消息索引和所属聊天分支。
  toggleCallLogMessage:function(idx){
    if(
      typeof _currentCallLogData === 'undefined' ||
      !_currentCallLogData ||
      !_currentCallLogData.messages ||
      !_currentCallLogData.messages[idx]
    )return;

    var msg = _currentCallLogData.messages[idx];
    var chat = typeof getCurrentChat === 'function' ? getCurrentChat() : null;
    var ch = chat ? getCharById(chat.charId) : getChatChar();

    var sourceMsg = null;

    if(
      chat &&
      chat.messages &&
      _currentCallLogMsgIdx !== null &&
      _currentCallLogMsgIdx !== undefined &&
      chat.messages[_currentCallLogMsgIdx]
    ){
      sourceMsg = chat.messages[_currentCallLogMsgIdx];
    }

    if(!_currentCallLogData._sourceTs && sourceMsg && sourceMsg._ts){
      _currentCallLogData._sourceTs = sourceMsg._ts;
    }

    if(!_currentCallLogData._branchId && chat && chat.id){
      _currentCallLogData._branchId = chat.id;
    }

    var callId = String(
      _currentCallLogData._sourceTs ||
      _currentCallLogData.created ||
      (sourceMsg && sourceMsg._ts) ||
      _currentCallLogMsgIdx ||
      Date.now()
    );

    var mid = this.ensureMid(msg, function(){
      if(typeof _saveCurrentCallLogData === 'function')_saveCurrentCallLogData();
    });

    if(typeof _saveCurrentCallLogData === 'function'){
      _saveCurrentCallLogData();
    }

    var meta = {
      module:'call',
      subModule:'record',
      sourceType:'char',
      sourceId:ch ? ch.id : '',
      sourceName:ch ? ch.name : '角色',
      branchId:chat ? chat.id : '',
      branchName:chat && ch ? _getBranchDisplayName(ch.id, chat.id) : '通话分支',
      callId:callId,
      callName:this._callName(_currentCallLogData),
      messageId:mid,
      messageIndex:typeof _currentCallLogMsgIdx !== 'undefined' ? _currentCallLogMsgIdx : '',
      callMsgIndex:idx,
      role:msg.role,
      speakerName:msg.role === 'user' ? (getCurrentProfile().name || '我') : (ch ? ch.name : '角色')
    };

    this.toggleRecord({
      content:msg.content,
      speakerName:meta.speakerName,
      role:msg.role,
      time:'',
      ts:msg._ts || _currentCallLogData._sourceTs || Date.now(),
      meta:meta
    });
  },

  // _makeMenuItem(label, handler, danger) → 创建一个复用菜单项 DOM。
  // 收藏系统给线下、浮生、通话等菜单插入按钮时使用。
  _makeMenuItem:function(label, handler, danger){
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.style.fontSize = '14px';
    div.style.color = danger ? 'var(--danger)' : 'var(--text-primary)';
    div.textContent = label;
    div.onclick = handler;
    return div;
  },

  // _insertAction(container, label, handler) → 给现有操作菜单插入收藏按钮。
  // 优先插在“删除”按钮前面，避免破坏原有菜单顺序。
  _insertAction:function(container, label, handler){
    if(!container || container.querySelector('[data-fav-action="1"]'))return;

    var del = Array.from(container.children).find(function(el){
      return /删除/.test(el.textContent || '');
    });

    var div = this._makeMenuItem(label, handler, false);
    div.dataset.favAction = '1';

    if(del)container.insertBefore(div, del);
    else container.appendChild(div);
  },

  // patchMenus() → 给现有模块菜单打补丁，注入收藏功能。
  // 包括：线上/群聊、咫尺朝夕、浮生逆笔、当前通话、历史通话。
  patchMenus:function(){
    var self = this;

    if(typeof cbyd21_Chat !== 'undefined' && cbyd21_Chat.showContextMenu && !cbyd21_Chat.showContextMenu._favPatched){
      var oldChatMenu = cbyd21_Chat.showContextMenu;

      cbyd21_Chat.showContextMenu = function(e,i){
        oldChatMenu.call(cbyd21_Chat, e, i);
        self.updateOnlineContextText(i);
      };

      cbyd21_Chat.showContextMenu._favPatched = true;
    }

    if(typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline.openMsgMenu && !cbyd21_Offline.openMsgMenu._favPatched){
      var oldOff = cbyd21_Offline.openMsgMenu;

      cbyd21_Offline.openMsgMenu = function(idx,event){
        oldOff.call(cbyd21_Offline, idx, event);

        setTimeout(function(){
          var container = document.getElementById('addCharList');
          var msg = cbyd21_Offline._messages && cbyd21_Offline._messages[idx];
          var label = '收藏';

          if(msg && msg._mid && self.load().some(function(f){ return f.module === 'offline' && f.messageId === msg._mid; })){
            label = '取消收藏';
          }

          self._insertAction(container, label, function(){
            closeModal('addCharModal');
            self.toggleOfflineMessage(idx);
          });
        },20);
      };

      cbyd21_Offline.openMsgMenu._favPatched = true;
    }

    if(typeof cbyd21_Fate !== 'undefined' && cbyd21_Fate.openStoryMenu && !cbyd21_Fate.openStoryMenu._favPatched){
      var oldFate = cbyd21_Fate.openStoryMenu;

      cbyd21_Fate.openStoryMenu = function(idx){
        oldFate.call(cbyd21_Fate, idx);

        setTimeout(function(){
          var container = document.getElementById('addCharList');
          var msg = cbyd21_Fate._messages && cbyd21_Fate._messages[idx];
          var label = '收藏';

          if(msg && msg._mid && self.load().some(function(f){ return f.module === 'games' && f.messageId === msg._mid; })){
            label = '取消收藏';
          }

          self._insertAction(container, label, function(){
            closeModal('addCharModal');
            self.toggleFateMessage(idx);
          });
        },20);
      };

      cbyd21_Fate.openStoryMenu._favPatched = true;
    }

    if(typeof cbyd21_Call !== 'undefined' && cbyd21_Call.openCallMsgMenu && !cbyd21_Call.openCallMsgMenu._favPatched){
      var oldCall = cbyd21_Call.openCallMsgMenu;

      cbyd21_Call.openCallMsgMenu = function(idx, el){
        oldCall.call(cbyd21_Call, idx, el);

        setTimeout(function(){
          var container = document.getElementById('addCharList');

          var msg = typeof _callMessages !== 'undefined' && _callMessages[idx] ? _callMessages[idx] : null;
          var label = '收藏';

          if(msg && msg._mid && self.load().some(function(f){
            return f.module === 'call' && f.subModule === 'live' && f.messageId === msg._mid;
          })){
            label = '取消收藏';
          }

          self._insertAction(container, label, function(){
            closeModal('addCharModal');
            self.toggleLiveCallMessage(idx);
          });
        },20);
      };

      cbyd21_Call.openCallMsgMenu._favPatched = true;
    }

    if(typeof window.openCallLogMsgMenu === 'function' && !window.openCallLogMsgMenu._favPatched){
      var oldLog = window.openCallLogMsgMenu;

      window.openCallLogMsgMenu = function(el, idx){
        oldLog.call(window, el, idx);

        setTimeout(function(){
          var container = document.getElementById('addCharList');

          var msg = typeof _currentCallLogData !== 'undefined' &&
            _currentCallLogData &&
            _currentCallLogData.messages &&
            _currentCallLogData.messages[idx]
              ? _currentCallLogData.messages[idx]
              : null;

          var label = '收藏';

          if(msg && msg._mid && self.load().some(function(f){
            return f.module === 'call' && f.subModule === 'record' && f.messageId === msg._mid;
          })){
            label = '取消收藏';
          }

          self._insertAction(container, label, function(){
            closeModal('addCharModal');
            self.toggleCallLogMessage(idx);
          });
        },20);
      };

      window.openCallLogMsgMenu._favPatched = true;
    }
  }
};

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    cbyd21_FavoriteStore.patchMenus();
  }, 500);
});

setTimeout(function(){
  if(typeof cbyd21_FavoriteStore !== 'undefined'){
    cbyd21_FavoriteStore.patchMenus();
  }
}, 1500);
