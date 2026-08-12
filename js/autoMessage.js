// ===== 【模块】cbyd21_AutoMessage — 角色主动消息 =====
// 角色主动消息模块。
// 按角色独立保存开关和固定间隔。
// 只要前端页面仍在运行，就会按倒计时检查是否触发。
// 如果浏览器/系统暂停后台，恢复页面后会从暂停前剩余时间继续倒计时。
// 用户不在对应聊天页时，会后台写入线上聊天记录，并在消息列表显示未读红点。

(function(){
  if(window.cbyd21_AutoMessage)return;

  window.cbyd21_AutoMessage = {
    _timer:null,
    _countdownTimer:null,
    _running:false,
    _nextAtByChar:{},
    _nextStoreKey:'stm_autoMessageNextAt',
    _unreadStoreKey:'stm_autoMessageUnread',
    _remainStoreKey:'stm_autoMessageRemain',
    _resumeBound:false,
    _hiddenAt:0,
    _heartbeatAt:0,
    _promptPausedAt:0,

    // _errorPanelCharId
    // → 当前主动消息错误记录面板正在查看的角色 ID。
    // 复制 / 删除 / 清空错误记录时优先使用它，避免依赖 _charInfoCharId。
    _errorPanelCharId:null,

    // _singleChatActivityWindowMs
    // → 用户在当前角色单聊页面活动后的保护窗口。
    // 在这个时间内，主动消息会跳过本轮并重新计时，避免打断正在进行的聊天。
    _singleChatActivityWindowMs:10000,

    // _lastSingleChatActivityAtByChar
    // → 记录每个角色单聊页面最近一次用户活动时间。
    // 只用于主动消息避让，不写入存储。
    _lastSingleChatActivityAtByChar:{},

    _activityGuardBound:false,

    presets:{
      low:{label:'低频',intervalSec:7200},
      mid:{label:'中频',intervalSec:1800},
      high:{label:'高频',intervalSec:600}
    },

    // init() → 启动主动消息轮询。
    init:function(){
      var self=this;

      if(this._timer){
        clearInterval(this._timer);
        this._timer=null;
      }

      if(this._countdownTimer){
        clearInterval(this._countdownTimer);
        this._countdownTimer=null;
      }

      this._nextAtByChar=this._loadNextAt();
      this._cleanupOrphanUnread();

      this._timer=setInterval(function(){
        self._tick();
      },5000);

      this._countdownTimer=setInterval(function(){
        self._heartbeatAt=Date.now();
        self._updateCountdown();
      },1000);

      this._bindResumeCheck();

      // 绑定单聊页面活动检测。
      // 作用：用户正在某个角色单聊页面操作时，主动消息到点也不硬插入。
      // 只要最近 10 秒内有点击、触摸、滚动、输入、按键，就顺延这一轮主动消息。
      this._bindSingleChatActivityGuard();

      this._resumeTimers();

      setTimeout(function(){
        self._tick();
        self._updateCountdown();
        self._updateMessageTabUnreadBadge();
        self._updateDesktopUnreadBadge();
      },500);
    },

    // _cleanupOrphanUnread()
    // → 清理已删除角色残留的主动消息未读红点。
    // 用于解决：角色被删除时后台主动消息刚好返回，导致 stm_autoMessageUnread 留下不存在角色 ID。
    _cleanupOrphanUnread:function(){
      if(typeof getCharById !== 'function')return;

      var map=this._loadUnread();
      var changed=false;

      Object.keys(map || {}).forEach(function(charId){
        if(!getCharById(charId)){
          delete map[charId];
          changed=true;
        }
      });

      if(changed){
        this._saveUnread(map);
      }

      this._updateMessageTabUnreadBadge();
      this._updateDesktopUnreadBadge();
    },

    // loadPanel(ch) → 打开角色信息面板时，把该角色的主动消息设置填入表单。
    loadPanel:function(ch){
      if(!ch)return;

      var cfg=this._normalizeConfig(ch._autoMessage);
      var toggle=document.getElementById('charInfoAutoMessageToggle');
      var status=document.getElementById('charInfoAutoMessageStatus');
      var intervalEl=document.getElementById('charInfoAutoMessageIntervalSec');

      if(toggle)toggle.checked=!!cfg.enabled;
      if(status)status.textContent=cfg.enabled?'开启':'关闭';
      if(intervalEl)intervalEl.value=cfg.intervalSec;

      this._highlightPreset(cfg.preset);
      this._updateHint(cfg);
      this._updateCountdown();
    },

    // applyPreset(name) → 用户点击低频/中频/高频时，把固定秒数写入输入框。
    applyPreset:function(name){
      var p=this.presets[name]||this.presets.low;
      var intervalEl=document.getElementById('charInfoAutoMessageIntervalSec');

      if(intervalEl)intervalEl.value=p.intervalSec;

      this._highlightPreset(name);
      this._updateHint({
        enabled:document.getElementById('charInfoAutoMessageToggle')&&document.getElementById('charInfoAutoMessageToggle').checked,
        preset:name,
        intervalSec:p.intervalSec
      });
      this._updateCountdown();
    },

    // saveFromPanel() → 从角色信息面板保存主动消息设置。
    saveFromPanel:function(){
      var panelCharId = typeof _charInfoCharId !== 'undefined' ? _charInfoCharId : null;
      var ch=typeof getCharById==='function'?getCharById(panelCharId):null;
      if(!ch)return;

      if(typeof DEFAULT_CHAR_ID !== 'undefined' && ch.id===DEFAULT_CHAR_ID){
        showToast('写卡助手不支持主动消息');
        return;
      }

      var toggle=document.getElementById('charInfoAutoMessageToggle');
      var status=document.getElementById('charInfoAutoMessageStatus');
      var intervalEl=document.getElementById('charInfoAutoMessageIntervalSec');

      var enabled=!!(toggle&&toggle.checked);
      var intervalSec=parseInt(intervalEl&&intervalEl.value,10);

      if(!intervalSec||isNaN(intervalSec))intervalSec=1800;

      intervalSec=Math.max(30,Math.min(604800,intervalSec));

      var preset=this._detectPreset(intervalSec);

      ch._autoMessage={
        enabled:enabled,
        preset:preset,
        intervalSec:intervalSec
      };

      if(status)status.textContent=enabled?'开启':'关闭';
      if(intervalEl)intervalEl.value=intervalSec;

      if(typeof cbyd21_Data!=='undefined'&&cbyd21_Data.saveCharacters){
        cbyd21_Data.saveCharacters();
      }

      this._highlightPreset(preset);
      this._updateHint(ch._autoMessage);

      if(enabled){
        this._scheduleNext(ch.id,ch._autoMessage,true);
      }else{
        delete this._nextAtByChar[ch.id];
        this._saveNextAt(this._nextAtByChar);

        var remainMap=this._loadRemain();
        delete remainMap[ch.id];
        this._saveRemain(remainMap);
      }

      this._updateCountdown();

      showToast(enabled?'主动消息已开启':'主动消息已关闭');
    },

    // _pauseForPromptLoading()
    // → 提示词未加载完成时暂停主动消息计时。
    // 不触发生成，不报错，不消耗 API。
    _pauseForPromptLoading:function(){
      if(this._promptPausedAt)return;

      this._promptPausedAt = Date.now();
      this._updateCountdown();
    },

    // _resumeAfterPromptReady()
    // → 提示词加载完成后恢复主动消息计时。
    // 将所有 nextAt 顺延暂停时长，做到“提示词加载期间不计时”。
    _resumeAfterPromptReady:function(){
      if(!this._promptPausedAt)return;

      var pausedMs = Math.max(0, Date.now() - this._promptPausedAt);
      this._promptPausedAt = 0;

      if(pausedMs > 0){
        var nextMap = this._loadNextAt();
        var changed = false;

        Object.keys(nextMap).forEach(function(charId){
          if(nextMap[charId]){
            nextMap[charId] = Number(nextMap[charId]) + pausedMs;
            changed = true;
          }
        });

        if(changed){
          this._nextAtByChar = nextMap;
          this._saveNextAt(nextMap);
        }
      }

      this._updateCountdown();
      this._tick();
    },


    // _loadNextAt() → 读取主动消息真实触发时间
    _loadNextAt:function(){
      try{
        return JSON.parse(localStorage.getItem(this._nextStoreKey) || '{}');
      }catch(e){
        return {};
      }
    },

    // _saveNextAt(map) → 保存主动消息真实触发时间
    _saveNextAt:function(map){
      localStorage.setItem(this._nextStoreKey, JSON.stringify(map || this._nextAtByChar || {}));
    },

    // _loadRemain() → 读取页面冻结前主动消息剩余时间
    _loadRemain:function(){
      try{
        return JSON.parse(localStorage.getItem(this._remainStoreKey) || '{}');
      }catch(e){
        return {};
      }
    },

    // _saveRemain(map) → 保存页面冻结前主动消息剩余时间
    _saveRemain:function(map){
      localStorage.setItem(this._remainStoreKey, JSON.stringify(map || {}));
    },

    // _formatCountdown(ms) → 倒计时文案
    _formatCountdown:function(ms){
      ms=Math.max(0,parseInt(ms,10)||0);

      var sec=Math.ceil(ms/1000);
      if(sec<60)return sec+'秒';

      var min=Math.ceil(sec/60);
      if(min<60)return min+'分钟';

      var hour=Math.floor(min/60);
      var leftMin=min%60;
      if(hour<24)return hour+'小时'+(leftMin?leftMin+'分钟':'');

      var day=Math.floor(hour/24);
      var leftHour=hour%24;
      return day+'天'+(leftHour?leftHour+'小时':'');
    },

    // _updateCountdown() → 刷新当前角色主动消息倒计时
    _updateCountdown:function(){
      var el=document.getElementById('charInfoAutoMessageCountdown');
      if(!el)return;

      var charId=typeof _charInfoCharId!=='undefined'?_charInfoCharId:null;
      var ch=charId&&typeof getCharById==='function'?getCharById(charId):null;

      if(!ch || !ch._autoMessage || !ch._autoMessage.enabled){
        el.textContent='未开启主动消息';
        return;
      }

      var nextAt=this._nextAtByChar[charId] || this._loadNextAt()[charId];

      if(!nextAt){
        el.textContent='等待下一次计时开始';
        return;
      }

      var remain=nextAt-Date.now();

      if(remain<=0){
        el.textContent='即将主动发消息';
      }else{
        el.textContent='距离下一次主动消息还有 '+this._formatCountdown(remain);
      }
    },

    // _pauseTimers() → 页面隐藏/可能冻结前保存剩余时间
    _pauseTimers:function(){
      var remainMap={};
      var nextMap=this._loadNextAt();
      var now=Date.now();
      var chars=this._eligibleChars();

      this._hiddenAt=now;
      this._heartbeatAt=now;

      chars.forEach(function(ch){
        if(!ch || !ch._autoMessage || !ch._autoMessage.enabled)return;
        var nextAt=nextMap[ch.id];

        if(!nextAt)return;

        remainMap[ch.id]={
          nextAt:nextAt,
          remainingMs:Math.max(0,nextAt-now)
        };
      });

      this._saveRemain(remainMap);
    },

    // _resumeTimers() → 页面恢复时，根据后台是否冻结决定如何继续倒计时
    _resumeTimers:function(){
      var nextMap=this._loadNextAt();
      var remainMap=this._loadRemain();
      var now=Date.now();
      var changed=false;

      // 如果隐藏期间 heartbeat 前进了，说明页面后台仍在运行；
      // 这种情况下不恢复旧剩余时间，保留 nextAt，让后台经过的时间正常生效。
      var backgroundWasRunning =
        this._hiddenAt &&
        this._heartbeatAt &&
        this._heartbeatAt > this._hiddenAt + 2000;

      if(!backgroundWasRunning){
        Object.keys(remainMap).forEach(function(charId){
          var item=remainMap[charId];

          if(!item || !item.nextAt)return;

          if(nextMap[charId]===item.nextAt){
            nextMap[charId]=now+Math.max(0,item.remainingMs||0);
            changed=true;
          }
        });
      }

      if(changed){
        this._nextAtByChar=nextMap;
        this._saveNextAt(nextMap);
      }else{
        this._nextAtByChar=nextMap;
      }

      this._saveRemain({});
      this._hiddenAt=0;
      this._updateCountdown();
    },

    // _loadErrors() → 读取主动消息错误记录
    _loadErrors:function(){
      try{
        return JSON.parse(localStorage.getItem('stm_autoMessageErrors') || '{}');
      }catch(e){
        return {};
      }
    },

    // _saveErrors(map) → 保存主动消息错误记录
    _saveErrors:function(map){
      localStorage.setItem('stm_autoMessageErrors', JSON.stringify(map || {}));
    },

    // _recordError(charId,title,detail)
    // → 主动消息后台生成失败时记录错误，不主动弹出 API 报错面板。
    // 主动消息是后台定时行为，失败频繁弹窗会打断用户当前操作。
    _recordError:function(charId,title,detail){
      if(!charId)return;

      var map=this._loadErrors();
      if(!map[charId])map[charId]=[];

      var ch=typeof getCharById==='function'?getCharById(charId):null;

      map[charId].unshift({
        time:Date.now(),
        charName:ch ? ch.name : '角色',
        title:title || '主动消息生成失败',
        detail:String(detail || '未知错误').slice(0,20000)
      });

      map[charId]=map[charId].slice(0,30);
      this._saveErrors(map);
    },

    // openErrorLogPanel(charId)
    // → 打开主动消息错误记录面板。
    // 复用 addCharModal.centered，沿用主文件里已有的 iOS 安全滚动布局。
    openErrorLogPanel:function(charId){
      charId = charId || (typeof _charInfoCharId !== 'undefined' ? _charInfoCharId : null);
      this._errorPanelCharId = charId || null;

      var container=document.getElementById('addCharList');
      if(!container)return;

      var map=this._loadErrors();
      var list=(charId && map[charId]) ? map[charId] : [];

      var ch=charId && typeof getCharById==='function' ? getCharById(charId) : null;
      var titleName=ch ? ch.name : '当前角色';

      var html='<div style="padding:16px">';

      html+='<div style="font-size:12px;color:var(--text-muted);line-height:1.7;margin-bottom:12px">主动消息是后台定时生成。失败时不会主动弹出 API 报错面板，以免打断当前操作。这里会保留最近 30 条失败记录，最新报错显示在最上方。每条记录会直接显示原始错误详情，可单独复制或删除。</div>';

      if(list.length===0){
        html+='<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px">暂无主动消息错误记录</div>';
      }else{
        list.forEach(function(item,idx){
          var d=new Date(item.time || Date.now());
          var timeText=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');

          html+='<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px">';
          html+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">';
          html+='<div style="min-width:0;flex:1">';
          html+='<div style="font-size:13px;font-weight:600;color:var(--danger);word-break:break-word">'+escHtml(item.title || '主动消息生成失败')+'</div>';
          html+='<div style="font-size:10px;color:var(--text-muted);margin-top:2px">'+escHtml((item.charName ? item.charName + ' · ' : '') + timeText)+'</div>';
          html+='</div>';
          html+='<div style="display:flex;gap:4px;flex-shrink:0">';
          html+='<button class="btn-sm" onclick="cbyd21_AutoMessage.copyErrorLogItemFromPanel('+idx+')" style="padding:4px 8px;font-size:10px">复制</button>';
          html+='<button class="btn-sm danger" onclick="cbyd21_AutoMessage.deleteErrorLogItemFromPanel('+idx+')" style="padding:4px 8px;font-size:10px">删除</button>';
          html+='</div>';
          html+='</div>';
          html+='<pre style="white-space:pre-wrap;word-break:break-word;font-size:10px;line-height:1.55;color:var(--text-muted);font-family:\'SF Mono\',\'Fira Code\',monospace;margin:0">'+escHtml(item.detail || '未知错误')+'</pre>';
          html+='</div>';
        });
      }

      html+='<div style="display:flex;gap:8px;margin-top:12px">';
      html+='<button class="btn" onclick="closeModal(\'addCharModal\')" style="flex:1">关闭</button>';
      html+='<button class="btn danger" onclick="cbyd21_AutoMessage.clearErrorLogFromPanel()" style="flex:1">清空记录</button>';
      html+='</div>';

      html+='</div>';

      container.innerHTML=html;
      document.getElementById('addCharModal').querySelector('h3').textContent=titleName+' · 主动消息错误记录';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    // copyErrorLogItemFromPanel(idx)
    // → 复制当前角色某一条主动消息错误记录
    copyErrorLogItemFromPanel:function(idx){
      var charId = this._errorPanelCharId || (typeof _charInfoCharId !== 'undefined' ? _charInfoCharId : null);
      if(!charId){
        showToast('找不到当前错误记录所属角色');
        return;
      }

      var map=this._loadErrors();
      var list=map[charId] || [];
      var item=list[idx];

      if(!item){
        showToast('找不到这条错误记录');
        return;
      }

      var d=new Date(item.time || Date.now());
      var timeText=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');

      var text='【主动消息错误记录】\n时间：'+timeText+'\n标题：'+(item.title || '主动消息生成失败')+'\n角色：'+(item.charName || '')+'\n\n'+(item.detail || '未知错误');

      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){
          showToast('错误记录已复制');
        }).catch(function(){
          if(typeof _fallbackCopy === 'function'){
            _fallbackCopy(text);
          }else{
            showToast('复制失败，请手动选择错误内容复制');
          }
        });
      }else if(typeof _fallbackCopy === 'function'){
        _fallbackCopy(text);
      }else{
        showToast('复制失败，请手动选择错误内容复制');
      }
    },

    // deleteErrorLogItemFromPanel(idx)
    // → 删除当前角色某一条主动消息错误记录
    deleteErrorLogItemFromPanel:async function(idx){
      var charId = this._errorPanelCharId || (typeof _charInfoCharId !== 'undefined' ? _charInfoCharId : null);
      if(!charId){
        showToast('找不到当前错误记录所属角色');
        return;
      }

      var map=this._loadErrors();
      var list=map[charId] || [];

      if(!list[idx]){
        showToast('找不到这条错误记录');
        return;
      }

      var yes=await customConfirm('确认删除这条主动消息错误记录？');
      if(!yes)return;

      list.splice(idx,1);

      if(list.length>0){
        map[charId]=list;
      }else{
        delete map[charId];
      }

      this._saveErrors(map);
      this.openErrorLogPanel(charId);
      showToast('已删除错误记录');
    },

    // clearErrorLogFromPanel()
    // → 清空当前角色主动消息错误记录
    clearErrorLogFromPanel:async function(){
      var charId = this._errorPanelCharId || (typeof _charInfoCharId !== 'undefined' ? _charInfoCharId : null);
      if(!charId){
        showToast('找不到当前错误记录所属角色');
        return;
      }

      var yes=await customConfirm('确认清空当前角色的主动消息错误记录？');
      if(!yes)return;

      var map=this._loadErrors();
      delete map[charId];
      this._saveErrors(map);

      this.openErrorLogPanel(charId);
      showToast('主动消息错误记录已清空');
    },

    // _updateMessageTabUnreadBadge()
    // → 主动消息未读时，在底部“消息”tab 上显示一个小红点。
    // 消息列表项仍然保留原来的角色红点。
    _updateMessageTabUnreadBadge:function(){
      try{
        var tab = document.querySelector('.tab-bar-item[data-tab="messages"]');
        if(!tab)return;

        var map = this._loadUnread();
        var hasUnread = Object.keys(map || {}).some(function(k){
          return !!map[k];
        });

        var dot = tab.querySelector('.auto-message-tab-dot');

        if(hasUnread){
          if(!dot){
            dot = document.createElement('span');
            dot.className = 'auto-message-tab-dot';
            dot.style.cssText = 'position:absolute;right:28%;top:7px;width:7px;height:7px;border-radius:50%;background:#ff4d5f;box-shadow:0 0 0 2px var(--bg-secondary)';
            tab.style.position = 'relative';
            tab.appendChild(dot);
          }
        }else if(dot){
          dot.remove();
        }
      }catch(e){}
    },

    // _updateDesktopUnreadBadge()
    // → 主动消息未读时，在桌面“消息”图标上显示红点。
    // 底部 tab 只有进入消息 App 后才存在；桌面图标红点可以覆盖用户停留在桌面或安卓小窗时的提示场景。
    _updateDesktopUnreadBadge:function(){
      try{
        var icon = document.querySelector('.desktop-icon[data-slot="0"]');
        if(!icon)return;

        var map = this._loadUnread();
        var hasUnread = Object.keys(map || {}).some(function(k){
          return !!map[k];
        });

        icon.classList.toggle('auto-message-unread', hasUnread);
      }catch(e){}
    },

    // _loadUnread() → 读取主动消息未读状态
    _loadUnread:function(){
      try{
        return JSON.parse(localStorage.getItem(this._unreadStoreKey) || '{}');
      }catch(e){
        return {};
      }
    },

    // _saveUnread(map) → 保存主动消息未读状态
    _saveUnread:function(map){
      localStorage.setItem(this._unreadStoreKey, JSON.stringify(map || {}));
    },

    // hasUnread(charId) → 消息列表红点
    hasUnread:function(charId){
      var map=this._loadUnread();
      return !!map[charId];
    },

    // markUnread(charId) → 标记未读
    markUnread:function(charId){
      if(!charId)return;

      if(typeof getCharById === 'function' && !getCharById(charId)){
        var cleanMap=this._loadUnread();

        if(cleanMap[charId]){
          delete cleanMap[charId];
          this._saveUnread(cleanMap);
        }

        this._updateMessageTabUnreadBadge();
        this._updateDesktopUnreadBadge();
        return;
      }

      var map=this._loadUnread();
      map[charId]=true;
      this._saveUnread(map);
      this._updateMessageTabUnreadBadge();
      this._updateDesktopUnreadBadge();
    },

    // markRead(charId) → 清除未读
    markRead:function(charId){
      if(!charId)return;
      var map=this._loadUnread();
      if(map[charId]){
        delete map[charId];
        this._saveUnread(map);
      }
      this._updateMessageTabUnreadBadge();
      this._updateDesktopUnreadBadge();
    },

    // _bindResumeCheck()
    // → 页面隐藏时保存剩余时间；恢复时接着剩余时间倒计时。
    _bindResumeCheck:function(){
      if(this._resumeBound)return;
      this._resumeBound=true;

      var self=this;

      function resume(){
        setTimeout(function(){
          self._resumeTimers();
          self._tick();
          self._updateCountdown();
        },100);
      }

      function pause(){
        self._pauseTimers();
      }

      window.addEventListener('focus',resume);
      window.addEventListener('pageshow',resume);
      window.addEventListener('pagehide',pause);

      document.addEventListener('visibilitychange',function(){
        if(document.visibilityState === 'hidden'){
          pause();
        }else if(document.visibilityState === 'visible'){
          resume();
        }
      });
    },

    // _isSingleChatOpenForChar(charId)
    // → 判断当前是否正打开某个角色的单聊页面。
    // 群聊、桌面、设置、线下、浮生等页面都不算。
    _isSingleChatOpenForChar:function(charId){
      try{
        var view = document.getElementById('chatView');

        return !!(
          view &&
          view.classList.contains('active') &&
          view.dataset.groupMode !== 'true' &&
          typeof currentChatCharId !== 'undefined' &&
          currentChatCharId === charId
        );
      }catch(e){
        return false;
      }
    },

    // _noteSingleChatActivity()
    // → 记录用户在当前单聊页面的最近活动时间。
    // 活动包括点击、触摸、滚动、输入、按键。
    // 这个记录只用于主动消息避让，不会写入聊天记录，也不会触发 API。
    _noteSingleChatActivity:function(){
      try{
        var view = document.getElementById('chatView');

        if(
          !view ||
          !view.classList.contains('active') ||
          view.dataset.groupMode === 'true' ||
          typeof currentChatCharId === 'undefined' ||
          !currentChatCharId
        ){
          return;
        }

        this._lastSingleChatActivityAtByChar[currentChatCharId] = Date.now();
      }catch(e){}
    },

    // _bindSingleChatActivityGuard()
    // → 绑定当前单聊页面活动检测。
    // 说明：
    // · 用户正在某个角色单聊页面活动时，主动消息会顺延。
    // · 这样不会出现用户正在回复、正在点屏幕、正在看聊天时，定时消息突然插入。
    // · 如果用户什么都不操作，主动消息仍会按计时触发。
    _bindSingleChatActivityGuard:function(){
      if(this._activityGuardBound)return;

      this._activityGuardBound = true;

      var self = this;

      function mark(){
        self._noteSingleChatActivity();
      }

      document.addEventListener('pointerdown', mark, true);
      document.addEventListener('touchstart', mark, true);
      document.addEventListener('keydown', mark, true);
      document.addEventListener('input', mark, true);

      var chatContainer = document.getElementById('chatContainer');

      if(chatContainer){
        chatContainer.addEventListener('scroll', mark, { passive:true });
      }
    },

    // _shouldSkipForRecentSingleChatActivity(ch)
    // → 主动消息触发前的最终避让判断。
    // 如果用户最近 10 秒内正在这个角色的单聊页活动：
    // · 本轮主动消息不生成；
    // · 重新按该角色主动消息间隔计时；
    // · 不调用 API，不写错误记录。
    _shouldSkipForRecentSingleChatActivity:function(ch){
      if(!ch || !ch.id)return false;

      if(!this._isSingleChatOpenForChar(ch.id)){
        return false;
      }

      var lastAt = this._lastSingleChatActivityAtByChar[ch.id] || 0;

      if(!lastAt)return false;

      return Date.now() - lastAt <= this._singleChatActivityWindowMs;
    },

    // _eligibleChars() → 所有开启主动消息的角色
    _eligibleChars:function(){
      if(typeof activeChats === 'undefined' || typeof getCharById !== 'function')return [];

      try{
        var unreadMap=this._loadUnread();
        var changed=false;

        Object.keys(unreadMap || {}).forEach(function(charId){
          if(!getCharById(charId)){
            delete unreadMap[charId];
            changed=true;
          }
        });

        if(changed){
          this._saveUnread(unreadMap);
          this._updateMessageTabUnreadBadge();
          this._updateDesktopUnreadBadge();
        }
      }catch(e){}

      return (activeChats || []).map(function(id){
        return getCharById(id);
      }).filter(function(ch){
        if(!ch)return false;
        if(typeof DEFAULT_CHAR_ID !== 'undefined' && ch.id===DEFAULT_CHAR_ID)return false;
        if(ch.blocked)return false;

        // 线上内嵌线下开启时，主动消息停用。
        // 主动消息是后台线上行为，和当前分支的线下叙事推进会冲突。
        if(ch._inlineOfflineEnabled)return false;

        try{
          var branches = (typeof chats !== 'undefined' ? chats : []).filter(function(c){
            return c && c.charId === ch.id;
          });

          var hasInlineOffline = branches.some(function(c){
            return c && c._inlineOffline && c._inlineOffline.enabled;
          });

          if(hasInlineOffline)return false;
        }catch(e){}

        return true;
      });
    },

    // _ensureChatForChar(charId) → 后台主动消息需要一个线上分支
    _ensureChatForChar:function(charId){
      if(!charId || typeof chats === 'undefined')return null;

      var charChats = chats.filter(function(c){
        return c && c.charId === charId;
      });

      var branchId = null;

      try{
        if(typeof _charLastBranch !== 'undefined' && _charLastBranch[charId]){
          branchId = _charLastBranch[charId];
        }
      }catch(e){}

      var chat = branchId ? charChats.find(function(c){
        return c.id === branchId;
      }) : null;

      if(!chat && charChats.length > 0){
        chat = charChats[0];
      }

      if(!chat){
        chat = {
          id:Date.now().toString() + '_' + Math.random().toString(36).slice(2,6),
          title:'自动消息分支',
          messages:[],
          created:Date.now(),
          charId:charId
        };

        chats.unshift(chat);
      }

      return chat;
    },

    // _persistChatsNow()
    // → 主动消息后台写入后立刻保存。
    // 安卓小窗 / PWA 后台 / 系统挂起时，不能只依赖 finally 统一保存，否则可能出现新消息已进内存但还没落盘就被系统暂停。
    _persistChatsNow:function(){
      try{
        if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.saveChats){
          cbyd21_Data.saveChats();
        }
      }catch(e){}

      try{
        if(typeof _saveActiveChatsState === 'function'){
          _saveActiveChatsState();
        }
      }catch(e){}

      try{
        if(typeof _saveCharLastBranchState === 'function'){
          _saveCharLastBranchState();
        }
      }catch(e){}
    },

    // _lastVisibleMessage(chat) → 找最后一条可见消息
    _lastVisibleMessage:function(chat){
      if(!chat || !Array.isArray(chat.messages))return null;

      for(var i=chat.messages.length-1;i>=0;i--){
        var m=chat.messages[i];
        if(!m || !m.content)continue;
        if(m._mode === 'ooc')continue;
if(m._mode === 'inline_offline')continue;
        if(m.content==='__system_init__'||m.content==='__system_continue__')continue;
        return m;
      }

      return null;
    },

    // _activePromptForChat(chat,ch)
    // → 主动消息临时提示，不写入聊天记录。
    // 这不是普通 zzz 续写，也不是固定“过一段时间找话题”。
    // 模型需要先根据最近上下文判断本轮更接近：
    // · 主动续写：当前互动仍未收束，延续当前状态、节奏、输出形态和关系推进。
    // · 主动联系：当前互动已经自然停住，角色隔了一段时间后主动找用户。
    // 当前版本的主动消息只生成可直接写入聊天记录的内容，不直接触发会弹窗/跳转/等待用户处理的交互功能。
    _activePromptForChat:function(chat,ch){
      var last=this._lastVisibleMessage(chat);
      var now=Date.now();
      var gapText='一段时间';

      if(last && last._ts){
        var gapMin=Math.max(1,Math.floor((now-last._ts)/60000));
        if(gapMin<60)gapText=gapMin+'分钟';
        else if(gapMin<1440)gapText=Math.floor(gapMin/60)+'小时';
        else gapText=Math.floor(gapMin/1440)+'天';
      }

      var isBilingualAuto =
        ch &&
        ch._bilingual &&
        ch._bilingual.enabled &&
        ch._bilingual.langName;

      var activeFormatRule = isBilingualAuto
        ? (
          '\n\n[主动消息输出格式]\n' +
          '当前角色开启双语翻译。主动消息使用 __bl_json__ 双语消息数组格式输出。\n' +
          '格式骨架：__bl_json__[{\"t\":\"\",\"c\":\"\"}]\n' +
          '数组里的每个对象代表一条聊天气泡。t 字段填写角色本轮真实会说的母语原文，c 字段填写与 t 一一对应的简体中文翻译。\n' +
          '消息条数按当前角色回复条数设置决定。最终只输出可直接写入聊天记录的双语消息数组。'
        )
        : (
          '\n\n[主动消息输出格式]\n' +
          '主动消息使用 __msg_json__ 线上聊天消息数组格式输出。\n' +
          '格式骨架：__msg_json__[{\"c\":\"\"}]\n' +
          '数组里的每个对象代表一条聊天气泡。c 字段填写角色本轮真实会发给用户的完整消息。\n' +
          '消息条数按当前角色回复条数设置决定。最终只输出可直接写入聊天记录的消息数组。'
        );

      var commonRule =
        '\n\n[主动消息执行规则]\n' +
        '这段说明是前端给出的任务条件，不是用户真实发言。最终回复只输出角色会发给用户的内容。\n' +
        '本轮必须先读取最近可见聊天历史，再判断角色此刻最自然的延续方式。\n' +
        '如果最近互动仍然有正在推进的内容、情绪、关系张力、互动节奏、场景反馈、状态结构或未收束的表达，本轮按“主动续写”处理。主动续写应沿用当前已经生效的内容、节奏、输出形态和关系推进，让互动顺着当前逻辑自然接下去。\n' +
        '如果最近互动已经自然停住，当前上下文没有需要紧接推进的内容，本轮按“主动联系”处理。主动联系应从角色性格、关系状态、当前时间背景和近期上下文出发，形成角色隔了一段时间后自然发来的新内容。\n' +
        '这两种不是固定模板，而是对当前上下文连续性的判断。选择哪一种，由角色卡、用户面具、世界书、记忆、当前时间背景、当前关系状态和最近聊天内容共同决定。\n' +
        '如果当前上下文已经形成特殊的输出形态、互动结构或叙事结构，并且这些结构来自角色卡、世界书或当前高优先级设定，本轮应在这些已生效结构内继续。\n' +
        '消息的长度、语气、主动程度、亲密感、表达方式和功能使用习惯，全部从角色卡、当前关系和最近上下文出发。\n' +
        '本轮输出仍受当前请求实际注入的模式规则、世界书规则、功能格式和前端可用功能范围约束。\n' +
        '本轮只能生成可以直接显示在聊天记录里的内容。' +
        activeFormatRule;

      if(last && last.role === 'user'){
        return '[主动消息触发]\n距离上一条可见消息已经过去了'+gapText+'。\n上一条可见消息来自用户，之后用户没有再发送新消息。\n\n本轮主动消息的任务：先判断最近上下文更适合主动续写还是主动联系；然后承接用户上一条可见消息、最近聊天历史、当前关系状态和当前已经生效的互动形态，生成角色此刻最自然会发出的内容。'+commonRule;
      }

      return '[主动消息触发]\n距离上一条可见消息已经过去了'+gapText+'。\n上一条可见消息来自角色，之后用户没有发送新消息。\n\n本轮主动消息的任务：先判断最近上下文更适合主动续写还是主动联系；然后承接角色上一条已发消息、最近聊天历史、当前关系状态和当前已经生效的互动形态，生成角色此刻最自然会追加的内容。'+commonRule;
    },

    // _isBlockedInteractivePart(text)
    // → 主动消息交互功能兜底判断。
    // 主动消息只生成可直接显示在聊天记录里的线上消息；
    // 不直接触发需要用户即时处理、会弹窗、会跳转或会切换全局状态的交互功能。
    //
    // 处理原则：
    // · 只判断单条消息是否包含禁用交互触发标记。
    // · 包含禁用交互触发标记的整条消息会被丢弃。
    // · 同一轮里其他正常消息继续保留。
    // · 不提取功能载荷里的 msg / scene / 地点名，因为这些内容属于功能卡片数据，不能可靠当作普通聊天文本。
    // · 不处理普通文字、Markdown、代码块、普通JSON文本、表情包、语音、图片描述、普通定位、转账。
    // · 如果整轮主动消息没有任何可显示内容，则不入库、不标未读红点，只写入错误记录。
    //
    // 未来如果要开放主动消息交互功能，不应该只放开这些标记；
    // 应该做“全局待处理通知队列”：
    // 1. 后台主动消息识别交互标记；
    // 2. 写入聊天记录；
    // 3. 创建全局待处理通知；
    // 4. 用户点击通知后保存当前前台状态；
    // 5. 再跳转到对应聊天 / 通话 / 共享位置 / 线下邀约处理流程。
    _isBlockedInteractivePart:function(text){
      var s = String(text || '');

      if(!s)return false;

      var markers = [
        '__incoming_call__',
        '__offline_jump__',
        '__offline_invite__',
        '__share_invite__',
        '__share_location__',
        '__share_response__',
        '__share_ignore__',
        '__share_reject__',
        '__share_end__',
        '__reject_share_location__'
      ];

      return markers.some(function(marker){
        return s.indexOf(marker) >= 0;
      });
    },

    // _parseBilingualArrayReply(reply,ch)
    // → 解析主动消息里的标准双语 JSON 协议。
    // 只处理明确带 __bl_json__ 标记的内容：
    // __bl_json__[{"t":"外语原文","c":"中文翻译"}]
    //
    // 裸 JSON 数组属于模型掉格式，不在这里额外抢救。
    // 解析失败时返回 null，后续按原始回复处理。
    // 解析成功后转成前端通用双语格式：外语原文__bilingual_split__中文翻译
    _parseBilingualArrayReply:function(reply,ch){
      var s = String(reply || '').trim();

      if(!s)return null;

      var isBilingual = !!(ch && ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName);

      if(typeof _stripLeakedThinking === 'function'){
        s = _stripLeakedThinking(s);
      }

      s = s
        .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'')
        .replace(/\n*<<<[A-Z_]+[\s\S]*$/,'')
        .trim();

      var fence = s.match(/^```(?:json|js|javascript)?\s*([\s\S]*?)```$/i);
      if(fence){
        s = fence[1].trim();
      }

      var marker = '__bl_json__';
      var markerIdx = s.indexOf(marker);
      var hasMarker = markerIdx >= 0;

      if(!hasMarker){
        return null;
      }

      s = s.slice(markerIdx + marker.length).trim();

      var start = s.indexOf('[');
      if(start < 0)return null;

      var src = s.slice(start);
      var depth = 0;
      var inStr = false;
      var esc = false;
      var end = -1;

      for(var i = 0; i < src.length; i++){
        var ch = src[i];

        if(inStr){
          if(esc){
            esc = false;
          }else if(ch === '\\'){
            esc = true;
          }else if(ch === '"'){
            inStr = false;
          }
          continue;
        }

        if(ch === '"'){
          inStr = true;
          continue;
        }

        if(ch === '[')depth++;

        if(ch === ']'){
          depth--;

          if(depth === 0){
            end = i + 1;
            break;
          }
        }
      }

      if(end < 0)return null;

      var arr = null;

      try{
        arr = JSON.parse(src.slice(0,end));
      }catch(e){
        return null;
      }

      if(!Array.isArray(arr))return null;

      var parts = [];

      arr.forEach(function(item){
        if(!item)return;

        var original = '';
        var translation = '';

        if(typeof item === 'string'){
          return;
        }

        original = String(item.t || item.original || item.text || '').trim();
        translation = String(item.c || item.translation || item.cn || '').trim();

        if(original && translation){
          parts.push(original + '__bilingual_split__' + translation);
        }else if(translation){
          parts.push(translation);
        }else if(original){
          parts.push(original);
        }
      });

      return parts.length > 0 ? parts : null;
    },

    // _handleBackgroundTransferDecision(chat,decision)
    // → 主动消息后台处理用户转账的收取 / 退回。
    // 普通聊天里这件事由 splitAndAppendAiReply() 处理；
    // 主动消息后台写入不走那个流程，所以这里单独补齐。
    _handleBackgroundTransferDecision:function(chat,decision){
      if(!chat || !decision)return 0;

      var accept = decision === 'accept';

      for(var i = chat.messages.length - 1; i >= 0; i--){
        var m = chat.messages[i];

        if(!m || m.role !== 'user' || !m.content || !m.content.startsWith('__transfer__')){
          continue;
        }

        try{
          var d = JSON.parse(m.content.slice(12));

          if(d.status || d.from !== 'user'){
            continue;
          }

          d.status = accept ? 'accepted' : 'rejected';
          m.content = '__transfer__' + JSON.stringify(d);

          var time = formatTime(Date.now());
          var resultData = {
            amount:d.amount,
            note:d.note || '',
            from:'result',
            status:accept ? 'accepted' : 'rejected'
          };

          chat.messages.push({
            role:'ai',
            content:'__transfer__' + JSON.stringify(resultData),
            time:time,
            _ts:Date.now()
          });

          if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.saveChats){
            cbyd21_Data.saveChats();
          }

          return 1;
        }catch(e){}
      }

      return 0;
    },

    // _splitLongPlainActiveMessage(text,max)
    // → 主动消息普通长文本二次拆分。
    // 用于模型掉格式，把多条内容塞进一个 c 字段或一整段里时，温和拆回几条气泡。
    // 只处理普通文本，不处理 HTML / 长文 / 代码块 / 特殊功能卡片 / 双语消息。
    _splitLongPlainActiveMessage:function(text,max){
      var s = String(text || '').trim();

      if(!s)return [];

      max = parseInt(max,10) || 1;
      max = Math.max(1, Math.min(20, max));

      if(max <= 1)return [s];

      if(typeof _cbyd21IsSpecialReplyLine === 'function' && _cbyd21IsSpecialReplyLine(s)){
        return [s];
      }

      if(typeof _looksLikeHtmlPayload === 'function' && _looksLikeHtmlPayload(s)){
        return [s];
      }

      if(typeof _cbyd21LooksLikeProtectedLongPayload === 'function' && _cbyd21LooksLikeProtectedLongPayload(s)){
        return [s];
      }

      if(s.indexOf('__bilingual_split__') >= 0){
        return [s];
      }

      if(/```[\s\S]*```/.test(s)){
        return [s];
      }

      var parts = [];

      // 优先按自然换行拆。
      if(/\n/.test(s)){
        parts = s.split(/\n+/).map(function(x){
          return x.trim();
        }).filter(function(x){
          return x.length > 0;
        });
      }

      if(parts.length <= 1){
        return [s];
      }

      // 合并过短碎片，避免拆成“嗯。”“好。”这种太碎的气泡。
      var merged = [];

      parts.forEach(function(p){
        if(!p)return;

        var last = merged[merged.length - 1];

        if(last && last.length < 18 && (last.length + p.length) < 70){
          merged[merged.length - 1] = last + p;
        }else{
          merged.push(p);
        }
      });

      if(merged.length <= max){
        return merged;
      }

      // 超过 max 时，把多余内容合并进最后一条，不丢内容。
      var kept = merged.slice(0,max - 1);
      kept.push(merged.slice(max - 1).join(''));

      return kept;
    },

    // _splitBackgroundReplyParts(reply,ch)
    // → 主动消息后台专用分条。
    // 主动消息不操作当前聊天 DOM，所以不能直接用 splitAndAppendAiReply。
    // 这里只做“回复文本 → 多个可入库气泡”的解析，不渲染、不调用 API。
    _splitBackgroundReplyParts:function(reply,ch){
      var s = String(reply || '').trim();

      if(!s)return [];

      if(typeof _stripLeakedThinking === 'function'){
        s = _stripLeakedThinking(s);
      }

      s = String(s || '')
        .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'')
        .replace(/\n*<<<[A-Z_]+[\s\S]*$/,'')
        .trim();

      if(!s)return [];

      var parts = null;

      // 双语角色优先解析 __bl_json__。
      parts = this._parseBilingualArrayReply(s,ch);

      // 普通线上消息解析 __msg_json__。
      if((!parts || parts.length === 0) && typeof _cbyd21ParseMsgJsonPayload === 'function'){
        parts = _cbyd21ParseMsgJsonPayload(s);
      }

      // __msg_json__ 坏格式兜底。
      if((!parts || parts.length === 0) && typeof _cbyd21FallbackMsgJsonPayload === 'function'){
        parts = _cbyd21FallbackMsgJsonPayload(s);
      }

      // 协议都没命中时，按自然换行拆主动消息。
      // HTML / 长文 / 代码块保持完整，避免被拆坏。
      // 普通多行聊天只按已有换行拆，不按标点正则拆，避免误拆长句。
      if(!parts || parts.length === 0){
        var isProtected =
          (typeof _looksLikeHtmlPayload === 'function' && _looksLikeHtmlPayload(s)) ||
          (typeof _cbyd21LooksLikeProtectedLongPayload === 'function' && _cbyd21LooksLikeProtectedLongPayload(s));

        if(isProtected){
          parts = [s];
        }else{
          parts = s.split(/\n+/).map(function(line){
            return String(line || '').trim();
          }).filter(function(line){
            return line.length > 0;
          });
        }
      }

      if(typeof _cbyd21JoinSplitTaggedJsonParts === 'function'){
        parts = _cbyd21JoinSplitTaggedJsonParts(parts);
      }

      if(typeof _cbyd21ExplodeInlineSpecialParts === 'function'){
        parts = _cbyd21ExplodeInlineSpecialParts(parts);
      }

      if(typeof _cbyd21MergeQuoteParts === 'function'){
        parts = _cbyd21MergeQuoteParts(parts);
      }

      parts = (parts || []).map(function(part){
        return String(part || '').trim();
      }).filter(function(part){
        return part.length > 0;
      });

      if(parts.length === 0)return [];

      var max = ch && ch.replyMax ? ch.replyMax : 1;

      // 模型有时会掉格式，把多条主动消息塞进一个 c 字段里。
      // 如果当前只解析出一条普通长文本，这里温和二次拆分，避免主动消息变成一大坨气泡。
      if(parts.length === 1){
        parts = this._splitLongPlainActiveMessage(parts[0], max);
      }

      var hasSpecial = parts.some(function(part){
        return typeof _cbyd21IsSpecialReplyLine === 'function' && _cbyd21IsSpecialReplyLine(part);
      });

      if(hasSpecial && typeof _cbyd21CapLinesPreserveSpecial === 'function'){
        parts = _cbyd21CapLinesPreserveSpecial(parts,max);
      }else if(typeof _cbyd21CapBilingualAwareParts === 'function'){
        parts = _cbyd21CapBilingualAwareParts(parts,max);
      }else if(typeof _cbyd21CapAiReplyParts === 'function'){
        parts = _cbyd21CapAiReplyParts(parts,max);
      }

      return parts;
    },

    // _appendBackgroundReply(chat,ch,reply)
    // → 后台生成主动消息，不操作当前聊天 DOM，只写入聊天数据。
    // 返回写入的可见消息数量。
    _appendBackgroundReply:function(chat,ch,reply){
      if(!chat)return 0;

      reply = String(reply || '').trim();

      if(typeof _stripLeakedThinking === 'function'){
        reply = _stripLeakedThinking(reply);
      }

      reply = String(reply || '').trim();

      var transferDecision = null;

      if(reply.indexOf('__accept_transfer__') >= 0){
        transferDecision = 'accept';
      }else if(reply.indexOf('__reject_transfer__') >= 0){
        transferDecision = 'reject';
      }

      reply = reply
        .replace(/__accept_transfer__/g,'')
        .replace(/__reject_transfer__/g,'')
        .trim();

      var transferPushedCount = this._handleBackgroundTransferDecision(chat, transferDecision);

      if(!reply){
        return transferPushedCount;
      }

      var time = formatTime(Date.now());
      var parts = this._splitBackgroundReplyParts
        ? this._splitBackgroundReplyParts(reply,ch)
        : null;
      var self = this;
      var blockedCount = 0;
      var pushedCount = transferPushedCount;
      var rawReply = reply;

      function pushPart(part){
        part = String(part || '').trim();

        if(!part)return;

        if(self._isBlockedInteractivePart(part)){
          blockedCount++;
          return;
        }

        chat.messages.push({
          role:'ai',
          content:part,
          time:time,
          _ts:Date.now()
        });

        self._persistChatsNow();

        pushedCount++;
      }

      if(parts && parts.length > 0){
        parts.forEach(function(part){
          pushPart(part);
        });
      }else{
        pushPart(reply);
      }

      if(blockedCount > 0){
        this._recordError(
          ch && ch.id,
          '主动消息已丢弃禁用交互消息',
          '模型在主动消息中输出了当前不允许由后台主动触发的交互功能。前端已丢弃包含该触发标记的消息；同轮其他普通消息会正常保留。\n\n原始返回：\n' + String(rawReply || '').slice(0,20000)
        );
      }

      return pushedCount;
    },

    // _triggerForChar(ch)
    // → 给指定角色触发一次主动消息。
    // 无论当前是否打开该角色聊天页，都使用主动消息临时提示构建请求。
    // 如果用户正在该角色聊天页，则生成后刷新当前聊天界面；
    // 如果用户不在该角色聊天页，则后台写入聊天记录并标记消息列表未读红点。
    _triggerForChar:async function(ch){
      if(!ch || !ch.id)return;

      if(typeof _cbyd21PromptsLoaded !== 'undefined' && !_cbyd21PromptsLoaded){
        this._pauseForPromptLoading();
        return;
      }

      var oldChatCharId = typeof currentChatCharId !== 'undefined' ? currentChatCharId : null;
      var oldChatId = typeof currentChatId !== 'undefined' ? currentChatId : null;

      var chatView=document.getElementById('chatView');
      var isSameChatOpen =
        chatView &&
        chatView.classList.contains('active') &&
        chatView.dataset.groupMode !== 'true' &&
        oldChatCharId === ch.id &&
        !!oldChatId;

      // 记录触发前用户正在看的聊天页。
      // 这只用于“主动消息生成完成后是否刷新当前页面”，不影响触发前的 10 秒活动避让。
      var _autoMsgOpenChatCharId = isSameChatOpen ? oldChatCharId : null;
      var _autoMsgOpenChatId = isSameChatOpen ? oldChatId : null;

      // 即使当前正打开该角色聊天页，也使用主动消息临时提示。
      // 普通 triggerAI() 只知道“续写”，不知道这是隔了一段时间后的主动消息。
      if(!apiConfig || !apiConfig.url || !apiConfig.model || !apiConfig.key){
        this._recordError(ch.id, '主动消息生成失败', 'API 未配置完整');
        return;
      }

      if(typeof cbyd21_Chat === 'undefined' || !cbyd21_Chat.buildRequest){
        this._recordError(
          ch.id,
          '主动消息生成失败',
          '聊天核心请求模块不可用。主动消息需要先把角色卡、用户面具、世界书、记忆和聊天上下文组装成 API 请求，但当前页面没有找到对应的请求构建模块。通常是页面脚本尚未初始化完成、文件加载异常，或浏览器/PWA缓存版本不一致。请刷新页面后重试；如果持续出现，请导出备份后重新加载前端。'
        );
        return;
      }

      var chat = null;

      if(isSameChatOpen){
        chat = chats.find(function(c){
          return c && c.id === oldChatId && c.charId === ch.id;
        }) || null;
      }

      if(!chat){
        chat=this._ensureChatForChar(ch.id);
      }

      if(!chat)return;

      var _autoMsgShouldRefreshOpenChat = false;
      var _autoMsgAppendedCount = 0;

      var _autoMsgDisplayName = typeof getCharOnlineName === 'function'
        ? getCharOnlineName(ch)
        : (ch.name || '角色');

      if(typeof showToast === 'function'){
        showToast(_autoMsgDisplayName + ' 好像在给你发消息…');
      }

      var tempPrompt = this._activePromptForChat(chat,ch);
      var tempMsg = {
        role:'user',
        content:tempPrompt,
        time:formatTime(Date.now()),
        _ts:Date.now(),
        _autoMessagePrompt:true
      };

      try{
        currentChatCharId = ch.id;
        currentChatId = chat.id;

        chat.messages.push(tempMsg);

        var _oldActiveMessageMode = window._cbyd21ActiveMessageMode;

        try{
          window._cbyd21ActiveMessageMode = true;
          var req = await cbyd21_Chat.buildRequest(chat);
        }finally{
          window._cbyd21ActiveMessageMode = _oldActiveMessageMode;
        }

        var _tempPromptIdxAfterBuild = chat.messages.indexOf(tempMsg);

        if(_tempPromptIdxAfterBuild >= 0){
          chat.messages.splice(_tempPromptIdxAfterBuild, 1);
        }

        if(req && req.body && apiConfig && apiConfig.temperature !== undefined && req.body.temperature === undefined){
          req.body.temperature = apiConfig.temperature;
        }

        var r = await fetch(req.url,{
          method:'POST',
          headers:req.headers,
          body:JSON.stringify(req.body)
        });

        var _rawAutoMsgApiText = await r.text();

        if(!r.ok){
          var _autoMsgErrParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
            ? _cbyd21ParseChatApiResponseText(_rawAutoMsgApiText)
            : {data:null,text:''};

          var _autoMsgErrText = String(_autoMsgErrParsed.text || '').trim();

          if(!_autoMsgErrText && _autoMsgErrParsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
            _autoMsgErrText = String(_cbyd21ExtractChatApiContent(_autoMsgErrParsed.data) || '').trim();
          }

          var _autoMsgErrLooksLikeOnlyError =
            /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(_autoMsgErrText) ||
            (
              _autoMsgErrText.length < 30 &&
              /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(_autoMsgErrText)
            );

          if(_autoMsgErrText && _autoMsgErrText.length >= 10 && !_autoMsgErrLooksLikeOnlyError){
            console.warn('主动消息 HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常回复处理');
          }else{
            this._recordError(ch.id, '主动消息 HTTP ' + r.status, _rawAutoMsgApiText || ('HTTP ' + r.status));
            return;
          }
        }
        var _parsedAutoMsgApiText = typeof _cbyd21ParseChatApiResponseText === 'function'
          ? _cbyd21ParseChatApiResponseText(_rawAutoMsgApiText)
          : { data:null, text:_rawAutoMsgApiText };

        var d = _parsedAutoMsgApiText.data || {};
        var reply = _parsedAutoMsgApiText.text || (
          typeof _cbyd21ExtractChatApiContent === 'function'
            ? _cbyd21ExtractChatApiContent(d)
            : (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '')
        );

        if(!reply && _rawAutoMsgApiText && String(_rawAutoMsgApiText).trim()){
          reply =
            '[前端提示：主动消息 API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
            String(_rawAutoMsgApiText || '').trim();
        }

        reply = String(reply || '')
          .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'')
          .replace(/\n*<<<[A-Z_]+[\s\S]*$/,'')
          .trim();

        if(typeof _stripAndStoreVisionDescriptions === 'function'){
          reply = _stripAndStoreVisionDescriptions(reply, chat, req.pendingVisionImages);
        }

        if(typeof _markVisionImagesTried === 'function'){
          _markVisionImagesTried(chat, req.pendingVisionImages);
        }

        var stillChar = typeof getCharById === 'function' ? getCharById(ch.id) : ch;
        var stillCfg = stillChar ? this._normalizeConfig(stillChar._autoMessage) : null;

        var stillHasInlineOffline = false;

        try{
          stillHasInlineOffline = (typeof chats !== 'undefined' ? chats : []).some(function(c){
            return c &&
              c.charId === stillChar.id &&
              c._inlineOffline &&
              c._inlineOffline.enabled;
          });
        }catch(e){}

        var stillAllowed =
          !!stillChar &&
          stillCfg &&
          stillCfg.enabled &&
          !(typeof DEFAULT_CHAR_ID !== 'undefined' && stillChar.id === DEFAULT_CHAR_ID) &&
          !stillChar.blocked &&
          !stillChar._inlineOfflineEnabled &&
          !stillHasInlineOffline;

        if(!stillAllowed){
          return;
        }

        _autoMsgAppendedCount = this._appendBackgroundReply(chat,stillChar,reply);

        if(_autoMsgAppendedCount <= 0){
          this._recordError(
            ch.id,
            '主动消息没有写入可见内容',
            '模型返回了内容，但前端没有写入任何可见主动消息。可能是返回为空，或只包含当前后台主动消息不允许触发的交互功能。\n\n原始返回：\n' + String(reply || '').slice(0,20000)
          );
          return;
        }

        if(typeof showToast === 'function'){
          showToast('你收到了一条来自 ' + _autoMsgDisplayName + ' 的新消息');
        }

        if(isSameChatOpen){
          _autoMsgShouldRefreshOpenChat = true;

          if(this.markRead){
            this.markRead(ch.id);
          }
        }else{
          this.markUnread(ch.id);
        }

        this._updateCountdown();
      }finally{
        var _tmpPromptIdx = chat.messages.indexOf(tempMsg);

        if(_tmpPromptIdx >= 0){
          chat.messages.splice(_tmpPromptIdx, 1);
        }

        // 如果用户没有在主动消息生成期间切到别的聊天，就恢复触发前的当前聊天状态。
        // 如果用户已经切走，不强行覆盖用户的新位置。
        if(currentChatCharId === ch.id && currentChatId === chat.id){
          currentChatCharId = oldChatCharId;
          currentChatId = oldChatId;
        }

        if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.saveChats){
          cbyd21_Data.saveChats();
        }

        if(typeof getCharById === 'function' && ch && ch.id && !getCharById(ch.id)){
          var unreadMap=this._loadUnread();
          if(unreadMap[ch.id]){
            delete unreadMap[ch.id];
            this._saveUnread(unreadMap);
          }

          if(this._updateMessageTabUnreadBadge){
            this._updateMessageTabUnreadBadge();
          }

          if(this._updateDesktopUnreadBadge){
            this._updateDesktopUnreadBadge();
          }
        }

        if(typeof cbyd21_UI !== 'undefined' && cbyd21_UI.renderMsgList){
          cbyd21_UI.renderMsgList();
        }

        if(
          _autoMsgShouldRefreshOpenChat &&
          _autoMsgAppendedCount > 0 &&
          chatView &&
          chatView.classList.contains('active') &&
          chatView.dataset.groupMode !== 'true' &&
          _autoMsgOpenChatCharId === ch.id &&
          (
            _autoMsgOpenChatId === chat.id ||
            (
              typeof currentChatCharId !== 'undefined' &&
              typeof currentChatId !== 'undefined' &&
              currentChatCharId === ch.id &&
              currentChatId === chat.id
            )
          )
        ){
          if(typeof cbyd21_Chat !== 'undefined' && cbyd21_Chat.renderMessages){
            cbyd21_Chat.renderMessages();
          }

          if(typeof cbyd21_Location !== 'undefined' && cbyd21_Location.restoreShareStateFromHistory){
            cbyd21_Location.restoreShareStateFromHistory(true);
          }

          if(typeof cbyd21_UI !== 'undefined' && cbyd21_UI.renderBranchList){
            cbyd21_UI.renderBranchList();
          }

          if(typeof scrollToBottom === 'function'){
            scrollToBottom();
          }
        }
      }
    },

    // _tick() → 定时检查所有开启主动消息的角色。
    // 用户只要在前端页面还活着，无论当前打开哪个应用，都可以后台生成线上消息。
    _tick:async function(){
      if(this._running)return;

      if(typeof _cbyd21PromptsLoaded !== 'undefined' && !_cbyd21PromptsLoaded){
        this._pauseForPromptLoading();
        return;
      }

      if(typeof isGenerating !== 'undefined' && isGenerating)return;
      if(typeof _callGenerating !== 'undefined' && _callGenerating)return;

      if(typeof cbyd21_Moments !== 'undefined'){
        if(cbyd21_Moments._refreshing)return;
        if(cbyd21_Moments._autoMomentRunning)return;
        if(cbyd21_Moments._generateNowLocks && Object.keys(cbyd21_Moments._generateNowLocks).length > 0)return;
      }

      // 通话中先不触发主动消息，避免通话 API 和主动消息 API 抢状态。
      if(typeof _callState !== 'undefined' && _callState !== 'idle')return;

      var input=document.getElementById('msgInput');
      if(input && document.activeElement === input && String(input.value||'').trim())return;

      var chars=this._eligibleChars();
      if(chars.length===0)return;

      var now=Date.now();

      for(var i=0;i<chars.length;i++){
        var ch=chars[i];
        var cfg=this._normalizeConfig(ch._autoMessage);

        if(!cfg.enabled)continue;

        if(!this._nextAtByChar[ch.id]){
          this._scheduleNext(ch.id,cfg,false);
          continue;
        }

        if(now < this._nextAtByChar[ch.id])continue;

        // 单聊活动避让：
        // 如果用户最近 10 秒内正在这个角色的单聊页面点击、滚动、输入或按键，
        // 本轮主动消息不生成，直接重新计时。
        // 这样用户在聊天页里等回复、编辑输入、点屏幕或阅读时，不会被定时主动消息打断。
        if(this._shouldSkipForRecentSingleChatActivity(ch)){
          this._scheduleNext(ch.id,cfg,true);
          this._updateCountdown();

          // 只写控制台说明，不弹 toast。
          // 用户如果正在点屏幕等主动消息，角色信息面板的提示文案会说明“活动会顺延”。
          console.log('主动消息已顺延：用户正在该角色单聊页活动', ch.name || ch.id);
          continue;
        }

        this._running=true;

        try{
          this._scheduleNext(ch.id,cfg,true);
          await this._triggerForChar(ch);
        }catch(e){
          this._recordError(ch.id, '主动消息生成失败', e && e.message ? e.message : String(e || '未知错误'));
          this._scheduleNext(ch.id,cfg,true);
        }finally{
          this._running=false;
        }

        // 一次 tick 只处理一个角色，避免多个角色同时调用 API。
        break;
      }
    },

    // _normalizeConfig(cfg) → 补齐主动消息设置默认值。
    _normalizeConfig:function(cfg){
      cfg=cfg||{};

      var intervalSec=parseInt(cfg.intervalSec,10);

      // 兼容旧版 minSec/maxSec：旧数据是范围，新版改为固定间隔。
      // 如果旧数据存在范围，取中间值迁移为固定间隔。
      if(!intervalSec || isNaN(intervalSec)){
        var oldMin=parseInt(cfg.minSec,10);
        var oldMax=parseInt(cfg.maxSec,10);

        if(oldMin && oldMax && !isNaN(oldMin) && !isNaN(oldMax)){
          intervalSec=Math.round((oldMin+oldMax)/2);
        }else if(oldMin && !isNaN(oldMin)){
          intervalSec=oldMin;
        }else{
          intervalSec=1800;
        }
      }

      intervalSec=Math.max(30,Math.min(604800,intervalSec));

      return {
        enabled:!!cfg.enabled,
        preset:cfg.preset||this._detectPreset(intervalSec),
        intervalSec:intervalSec
      };
    },

    // _detectPreset(intervalSec) → 根据固定秒数判断是否刚好等于某个预设。
    _detectPreset:function(intervalSec){
      var keys=Object.keys(this.presets);

      for(var i=0;i<keys.length;i++){
        var k=keys[i];
        var p=this.presets[k];

        if(p.intervalSec===intervalSec){
          return k;
        }
      }

      return 'custom';
    },

    // _scheduleNext(charId,cfg,fromNow) → 为角色安排下一次主动发消息时间。
    _scheduleNext:function(charId,cfg,fromNow){
      cfg=this._normalizeConfig(cfg);

      if(!cfg.enabled){
        delete this._nextAtByChar[charId];
        this._saveNextAt(this._nextAtByChar);
        return;
      }

      this._nextAtByChar[charId]=Date.now()+cfg.intervalSec*1000;
      this._saveNextAt(this._nextAtByChar);
      this._updateCountdown();
    },

    // _highlightPreset(name) → 高亮当前选中的频率预设按钮。
    _highlightPreset:function(name){
      document.querySelectorAll('.auto-message-preset-btn').forEach(function(btn){
        var on=btn.dataset.autoMsgPreset===name;
        btn.style.background=on?'var(--accent)':'';
        btn.style.color=on?'#fff':'';
        btn.style.borderColor=on?'var(--accent)':'';
      });
    },

    // _formatSec(sec) → 把秒数转成人类可读的时间。
    _formatSec:function(sec){
      sec=parseInt(sec,10)||0;

      if(sec<60)return sec+'秒';

      var min=Math.round(sec/60);
      if(min<60)return min+'分钟';

      var hour=Math.round(min/60);
      return hour+'小时';
    },

    // _updateHint(cfg) → 更新面板里的说明文字。
    _updateHint:function(cfg){
      var el=document.getElementById('charInfoAutoMessageHint');
      if(!el)return;

      cfg=this._normalizeConfig(cfg);

      var label='自定义';
      if(this.presets[cfg.preset]){
        label=this.presets[cfg.preset].label;
      }

      el.textContent=
        '当前频率：'+label+'，每 '+this._formatSec(cfg.intervalSec)+' 主动发一次。页面运行时会正常计时；如果浏览器冻结后台，回到页面后会从冻结前剩余时间继续倒计时。主动消息触发时，如果你最近 10 秒内正在该角色单聊页面点击、触摸、滚动、输入或按键，本轮会自动顺延并重新计时，不会打断正在进行的聊天。你停止触碰或操作该聊天页超过 10 秒后，后续到点才会正常触发。建议频率开低一点，避免频繁自动调用 API 消耗额度。最低间隔为 30 秒。';
    }
  };
})();
