// ===== 【模块】cbyd21_Fate — 浮生逆笔 =====
// 浮生逆笔，拆分自主文件
// HTML结构在主文件 index.html 里（搜索 fateApp）
// CSS样式在 css/fate.css
//
// 功能：去往角色人生中的关键时刻，进行命运干预
// 两种模式：现身陪伴（角色能看见用户）/ 暗中守护（用户透明，只能做微小干预）
// 支持多时间线分支、预设系统、双语翻译
//
// 依赖主文件的全局函数：getCharById, getCurrentProfile, escHtml,
//   showToast, apiConfig, characters, customConfirm, formatTime,
//   collectActiveWorldBook, cbyd21_Data, openModal, closeModal,
//   openTextInputModal, DEFAULT_CHAR_ID, userProfiles, currentUserProfileId

function cbyd21_Fate_safeJson(key, fallback){
  try{
    var raw = localStorage.getItem(key);

    if(raw === null || raw === undefined || raw === ''){
      return fallback;
    }

    return JSON.parse(raw);
  }catch(e){
    console.warn('浮生逆笔 localStorage JSON 解析失败：', key, e);

    try{
      localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
    }catch(_e){}

    return fallback;
  }
}

var cbyd21_Fate={
  _mode:null,       // 当前模式：'appear'（现身）或 'shadow'（暗中）
  _charId:null,     // 当前干预的角色ID
  _branchId:null,   // 当前时间线分支ID
  _messages:[],     // 当前分支的消息数组
  _generating:false,
  _abortController:null,
  _streamTempIdx:null,
  _streamLastSaveAt:0,
  _streamSuspendAbort:false,

  // _streamAutoScrollLocked
  // → 浮生逆笔流式输出期间，用户主动上滑后锁定自动滚动。
  // false = 仍跟随到底部；true = 用户在看前文，不再强制拉到底。
  _streamAutoScrollLocked:false,

  // _scrollTimers
  // → 记录 _scrollToBottom() 的延迟滚动定时器。
  // 流式生成中用户上滑后，需要取消旧定时器，避免被旧 timeout 强制拉回底部。
  _scrollTimers:[],

  // _cleanupStreamRuntime()
  // → 清理浮生逆笔流式生成运行态。
  // 用于关闭 App、暂时离开、结束干预、用户中断生成等收尾路径。
  // 防止旧 timeout、滚动锁或 typing 状态残留到下一次进入。
  _cleanupStreamRuntime:function(){
    this._abortController = null;
    this._generating = false;
    this._streamTempIdx = null;
    this._streamLastSaveAt = 0;
    this._streamSuspendAbort = false;
    this._streamAutoScrollLocked = false;

    if(Array.isArray(this._scrollTimers)){
      this._scrollTimers.forEach(function(t){
        clearTimeout(t);
      });
      this._scrollTimers = [];
    }

    var typing = document.getElementById('fateTyping');
    if(typing)typing.classList.remove('active');
  },

  _multiselect:false,
  _data:cbyd21_Fate_safeJson('stm_fateData', {}),      // 所有角色的分支数据
  _presets:cbyd21_Fate_safeJson('stm_fatePresets', []), // 预设列表

  // ============ 模式选择（现身陪伴 / 暗中守护） ============
  // _promptReadyOrToast()
  // → 浮生逆笔生成前的提示词就绪检查。
  // 未就绪时只提示并阻止本次操作，不排队、不自动重试、不消耗 API。
  _promptReadyOrToast:function(){
    if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
      return false;
    }

    return true;
  },

  // _extractReplyContent(data)
  // → 浮生逆笔读取 API 正文。
  // 优先使用主文件的 _cbyd21ExtractChatApiContent，兼容不同中转站返回结构。
  _extractReplyContent:function(data){
    if(typeof _cbyd21ExtractChatApiContent === 'function'){
      return _cbyd21ExtractChatApiContent(data);
    }

    function contentToText(v, depth){
      depth = depth || 0;

      if(depth > 8)return '';

      if(v === null || v === undefined)return '';

      if(typeof v === 'string')return v;

      if(typeof v === 'number' || typeof v === 'boolean'){
        return String(v);
      }

      if(Array.isArray(v)){
        return v.map(function(item){
          return contentToText(item, depth + 1);
        }).join('');
      }

      if(typeof v === 'object'){
        var priorityKeys = [
          'content',
          'text',
          'output_text',
          'reply',
          'answer',
          'response',
          'result',
          'final',
          'final_answer',
          'message',
          'delta',
          'data',
          'output',
          'completion',
          'generated_text',
          'html',
          'markdown',
          'code',
          'body',
          'value'
        ];

        for(var i = 0; i < priorityKeys.length; i++){
          var k = priorityKeys[i];

          if(v[k] !== undefined && v[k] !== null){
            var direct = contentToText(v[k], depth + 1);

            if(direct)return direct;
          }
        }

        var keys = Object.keys(v);

        for(var j = 0; j < keys.length; j++){
          var key = keys[j];

          if(/^(id|object|model|created|usage|prompt_tokens|completion_tokens|total_tokens|finish_reason|index)$/i.test(key))continue;
          if(/reasoning|thinking|analysis|thought/i.test(key))continue;

          if(/content|text|reply|answer|response|result|final|message|output|completion|generated|html|markdown|code|body/i.test(key)){
            var nested = contentToText(v[key], depth + 1);

            if(nested)return nested;
          }
        }

        return '';
      }

      return String(v || '');
    }

    if(typeof data === 'string' || Array.isArray(data)){
      return contentToText(data);
    }

    var choice = data && data.choices && data.choices[0] ? data.choices[0] : null;

    if(choice){
      var choiceText =
        contentToText(choice.message) ||
        contentToText(choice.text) ||
        contentToText(choice.delta) ||
        contentToText(choice.output_text) ||
        contentToText(choice.answer) ||
        contentToText(choice.response) ||
        contentToText(choice.result) ||
        contentToText(choice);

      if(choiceText)return choiceText;
    }

    return contentToText(data && data.output_text) ||
      contentToText(data && data.output) ||
      contentToText(data && data.content) ||
      contentToText(data);
  },

  // _safeParseReply(reply,label)
  // → API 已经成功返回后，安全解析浮生剧情正文和选项。
  // 如果前端解析失败，不误弹 API 错误，改为把模型原文作为剧情保存。
  _safeParseReply:function(reply,label){
    var raw = String(reply || '').trim() || '（命运沉默了……）';

    try{
      var parsed = this._parseReply(raw);

      if(!parsed || typeof parsed !== 'object'){
        throw new Error('parseReply returned invalid result');
      }

      parsed.story = String(parsed.story || raw).trim() || raw;
      parsed.choices = Array.isArray(parsed.choices) ? parsed.choices : [];

      return parsed;
    }catch(parseErr){
      console.warn((label || '浮生逆笔回复') + ' 已返回，但前端解析失败，已按原文保存：', parseErr);

      return {
        story:'[前端提示：AI回复已返回，但浮生逆笔格式解析失败，以下为模型原始回复。]\n\n' + raw,
        choices:[]
      };
    }
  },

  selectMode:function(mode){
    this._mode=mode;
    document.getElementById('fateHome').style.display='none';
    document.getElementById('fateCharSelect').style.display='flex';
    document.getElementById('fateModeName').textContent=mode==='appear'?'🤝 现身陪伴':'👻 暗中守护';
    this.renderCharList();
  },

  // 返回模式选择页
  backToHome:function(){
    document.getElementById('fateCharSelect').style.display='none';
    document.getElementById('fateHome').style.display='flex';
  },

  // ============ 角色列表（显示可干预的角色） ============
  renderCharList:function(){
    var container=document.getElementById('fateCharList');
    container.innerHTML='';
    var charList=characters.filter(function(c){return c.id!==DEFAULT_CHAR_ID});
    if(charList.length===0){
      container.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--text-muted);font-size:13px;line-height:1.8">还没有角色<br>先去「💬 消息 → 通讯录」创建角色</div>';
      return;
    }
    var self=this;
    charList.forEach(function(ch){
      var avatarHtml=ch.avatar?'<img src="'+ch.avatar+'">':escHtml(ch.name.charAt(0));
      var branches=self._getBranches(ch.id);
      var currentMode=self._mode;
      var modeBranches=branches.filter(function(b){return b.mode===currentMode});
      var activeBranch=modeBranches.find(function(b){return b.status==='active'});
      var statusText=activeBranch?'干预中 · '+activeBranch.messages.length+'段剧情':(modeBranches.length>0?modeBranches.length+'条时间线':'尚未干预');
      var div=document.createElement('div');
      div.className='contact-list-item';
      div.innerHTML='<div class="contact-list-avatar">'+avatarHtml+'</div><div class="contact-list-info"><div class="contact-list-name">'+escHtml(ch.name)+'</div><div class="contact-list-desc">'+statusText+'</div></div><span style="font-size:12px;color:var(--text-muted)">→</span>';
      div.onclick=function(){self.enterGame(ch.id)};
      container.appendChild(div);
    });
  },

  // ============ 进入游戏（弹确认窗：继续/新时间线/开始） ============
  enterGame:function(charId){
    var ch=getCharById(charId);
    if(!ch)return;
    if(!apiConfig.url||!apiConfig.key||!apiConfig.model){showToast('请先配置API');return}
    var self=this;
    var branches=self._getBranches(charId);
    var currentMode=self._mode;
    var activeBranch=branches.find(function(b){return b.status==='active'&&b.mode===currentMode});
    var modeLabel=currentMode==='appear'?'现身陪伴':'暗中守护';
    var modeIcon=self._mode==='appear'?'🤝':'👻';
    var container=document.getElementById('addCharList');
    container.innerHTML='';
    if(activeBranch){
      var msgCount=activeBranch.messages.length;
      container.innerHTML='<div style="padding:20px;text-align:center"><div style="font-size:36px;margin-bottom:12px">'+modeIcon+'</div><div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px">继续干预</div><div style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:16px">上次对 '+escHtml(ch.name)+' 的命运干预还在进行中<br>'+modeLabel+' · '+msgCount+' 段剧情</div><div style="display:flex;gap:8px"><button class="btn primary" onclick="closeModal(\'addCharModal\');cbyd21_Fate._confirmEnter(\''+charId+'\')" style="flex:1">继续</button><button class="btn" onclick="closeModal(\'addCharModal\')" style="flex:1">取消</button></div><div style="margin-top:12px"><button class="btn" onclick="closeModal(\'addCharModal\');cbyd21_Fate._confirmNewBranch(\''+charId+'\')" style="width:100%;font-size:12px">开启新时间线</button></div></div>';
    }else{
      container.innerHTML='<div style="padding:20px;text-align:center"><div style="font-size:36px;margin-bottom:12px">'+modeIcon+'</div><div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px">开始命运干预</div><div style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:16px">即将以「'+modeLabel+'」方式<br>去往 '+escHtml(ch.name)+' 的命运节点</div><div style="display:flex;gap:8px"><button class="btn primary" onclick="closeModal(\'addCharModal\');cbyd21_Fate._confirmEnter(\''+charId+'\')" style="flex:1">开始</button><button class="btn" onclick="closeModal(\'addCharModal\')" style="flex:1">取消</button></div></div>';
    }
    document.getElementById('addCharModal').querySelector('h3').textContent='浮生逆笔';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 确认进入 → 先选面具再进游戏
  _confirmEnter:function(charId){
    var self=this;
    this._selectMask(function(){
      self._doEnterGame(charId);
    });
  },

  // 确认开启新时间线 → 先选面具再进游戏并新建分支
  // 开启新时间线：先结束旧的active分支，再进入游戏
  // · _doEnterGame 会自动创建新空分支并触发首场景生成
  // · 不再额外调 newBranch，避免重复触发 _generateScene
  _confirmNewBranch:function(charId){
    var self=this;
    this._selectMask(function(){
      // 先把旧的active分支标记为ended
      var branches=self._getBranches(charId);
      var currentMode=self._mode;
      var activeBranch=branches.find(function(b){return b.status==='active'&&b.mode===currentMode});
      if(activeBranch){
        activeBranch.status='ended';
        self._save();
      }
      // 进入游戏时会发现没有active分支，自动创建新的并生成首场景
      self._doEnterGame(charId);
    });
  },

  // 面具选择弹窗（多面具时让用户选一个身份进入）
  _selectMask:function(callback){
    if(userProfiles.length<=1){callback();return}
    var container=document.getElementById('addCharList');
    container.innerHTML='';
    userProfiles.forEach(function(p){
      var isCurrent=p.id===currentUserProfileId;
      var avHtml=p.avatar?'<img src="'+p.avatar+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':escHtml((p.name||'我').charAt(0));
      var div=document.createElement('div');
      div.className='add-char-item';
      div.style.padding='14px 16px';
      div.innerHTML='<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-tertiary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:14px;color:var(--accent)">'+avHtml+'</div><div style="flex:1;margin-left:12px"><div style="font-size:14px;color:var(--text-primary);font-weight:'+(isCurrent?'600':'400')+'">'+escHtml(p.name||'我')+'</div></div>'+(isCurrent?'<span style="color:var(--accent);font-size:12px">当前</span>':'');
      div.onclick=function(){
        currentUserProfileId=p.id;
        localStorage.setItem('stm_currentUserProfileId',p.id);
        closeModal('addCharModal');
        callback();
      };
      container.appendChild(div);
    });
    document.getElementById('addCharModal').querySelector('h3').textContent='选择面具';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 正式进入游戏界面（初始化状态、渲染、自动生成首场景）
  _doEnterGame:function(charId){
    var ch=getCharById(charId);
    if(!ch)return;
    // 终止可能正在进行的旧请求
    if(this._abortController){this._abortController.abort();this._abortController=null}
    this._generating=false;
    this._charId=charId;
    this._mode=this._mode||'appear';
    var branches=this._getBranches(charId);
    var currentMode=this._mode;
    var activeBranch=branches.find(function(b){return b.status==='active'&&b.mode===currentMode});
    if(!activeBranch){
      activeBranch=this._createBranch(charId);
    }
    this._branchId=activeBranch.id;
    this._messages=activeBranch.messages;
    this._loadActivePreset();
    document.getElementById('fateGameTitle').textContent=ch.name;
    document.getElementById('fateGameSubtitle').textContent=this._mode==='appear'?'现身陪伴':'暗中守护';
    document.getElementById('fateSidebarTitle').textContent=ch.name+' · 时间线';
    document.getElementById('fateCharSelect').style.display='none';
    document.getElementById('fateGameView').style.display='flex';
    this.renderStory();
    this.renderBranchList();
    this._scrollToBottom();
    if(this._messages.length===0){
      var self=this;
      setTimeout(function(){self._generateScene()},300);
    }
  },

  // ============ 分支（时间线）管理 ============

  // 获取某角色的所有分支
  _getBranches:function(charId){
    if(!this._data[charId])this._data[charId]=[];
    return this._data[charId];
  },

  // 新建分支
  _createBranch:function(charId){
    var ch=getCharById(charId);
    var branches=this._getBranches(charId);
    var branch={
      id:Date.now().toString(),
      title:(ch?ch.name:'角色')+' · 时间线'+(branches.length+1),
      status:'active',
      mode:this._mode,
      messages:[],
      created:Date.now()
    };
    branches.unshift(branch);
    this._save();
    return branch;
  },

  // 获取当前分支对象
  _getCurrentBranch:function(){
    if(!this._charId||!this._branchId)return null;
    var branches=this._getBranches(this._charId);
    return branches.find(function(b){return b.id===cbyd21_Fate._branchId})||null;
  },

  // 开启新时间线
  newBranch:function(){
    // 新建前先保存当前分支的所有数据
    this._save();
    // 终止可能正在进行的旧请求，防止结果写入新分支
    if(this._abortController){this._abortController.abort();this._abortController=null}
    this._generating=false;
    var branch=this._createBranch(this._charId);
    this._branchId=branch.id;
    this._messages=branch.messages;
    this.renderStory();
    this.renderBranchList();
    this.closeBranchSidebar();
    var self=this;
    setTimeout(function(){self._generateScene()},300);
  },

  // 切换到指定分支
  switchBranch:function(id){
    // 切换前先保存当前分支的所有数据
    this._save();
    var branches=this._getBranches(this._charId);
    var branch=branches.find(function(b){return b.id===id});
    if(!branch)return;
    this._branchId=id;
    this._messages=branch.messages;
    this._mode=branch.mode||'appear';
    document.getElementById('fateGameSubtitle').textContent=this._mode==='appear'?'现身陪伴':'暗中守护';
    this.renderStory();
    this.renderBranchList();
    this.closeBranchSidebar();
    this._scrollToBottom();
  },

  // 删除指定分支
  deleteBranch:async function(id,e){
    if(e)e.stopPropagation();
    var _yes=await customConfirm('确认删除该时间线？');
    if(!_yes)return;
    var branches=this._getBranches(this._charId);
    this._data[this._charId]=branches.filter(function(b){return b.id!==id});
    if(this._branchId===id){
      var currentMode=this._mode;
      var remaining=this._getBranches(this._charId).filter(function(b){return b.mode===currentMode});
      if(remaining.length>0){
        this._branchId=remaining[0].id;
        this._messages=remaining[0].messages;
      }else{
        var nb=this._createBranch(this._charId);
        this._branchId=nb.id;
        this._messages=nb.messages;
        var self=this;
        setTimeout(function(){self._generateScene()},300);
      }
    }
    this._save();
    this.renderStory();
    this.renderBranchList();
  },

  // 清空所有时间线
  clearAllBranches:async function(){
    var _yes=await customConfirm('确认清空所有时间线？');
    if(!_yes)return;
    var currentMode=this._mode;
    this._data[this._charId]=this._getBranches(this._charId).filter(function(b){return b.mode!==currentMode});
    var nb=this._createBranch(this._charId);
    this._branchId=nb.id;
    this._messages=nb.messages;
    this._save();
    this.renderStory();
    this.renderBranchList();
    this.closeBranchSidebar();
    var self=this;
    setTimeout(function(){self._generateScene()},300);
    showToast('已清空');
  },

  // 渲染侧边栏的分支列表
  renderBranchList:function(){
    var el=document.getElementById('fateBranchList');
    el.innerHTML='';
    var branches=this._getBranches(this._charId);
    var currentMode=this._mode;
    var self=this;
    branches.filter(function(b){return b.mode===currentMode}).forEach(function(b){
      var preview=b.messages.length>0?b.messages[b.messages.length-1].content.slice(0,40)+'…':'空';
      var statusLabel=b.status==='active'?'':'（已结束）';
      var _modeFiltered=branches.filter(function(x){return x.mode===currentMode});
      var _branchNum='时间线'+(_modeFiltered.indexOf(b)+1);
      var div=document.createElement('div');
      div.className='fate-branch-item'+(b.id===self._branchId?' active':'');
      div.innerHTML='<div class="fate-branch-info"><div class="fate-branch-title">'+escHtml(_branchNum)+statusLabel+'</div><div class="fate-branch-preview">'+escHtml(preview)+'</div></div><button class="sidebar-item-del" onclick="cbyd21_Fate.deleteBranch(\''+b.id+'\',event)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V3h6v1"/><path d="M4 4l1 10h6l1-10"/></svg></button>';
      div.onclick=function(ev){if(ev.target.closest('.sidebar-item-del'))return;self.switchBranch(b.id)};
      el.appendChild(div);
    });
  },

  // 打开/关闭时间线侧边栏
  toggleBranchSidebar:function(){
    document.getElementById('fateSidebar').classList.toggle('active');
    document.getElementById('fateSidebarOverlay').classList.toggle('active');
  },

  closeBranchSidebar:function(){
    document.getElementById('fateSidebar').classList.remove('active');
    document.getElementById('fateSidebarOverlay').classList.remove('active');
  },

  // ============ 故事渲染（把消息数组渲染到页面） ============
  renderStory:function(){
    var container=document.getElementById('fateStoryContainer');
    container.innerHTML='';
    var choiceArea=document.getElementById('fateChoiceArea');
    var choicesEl=document.getElementById('fateChoices');
    var choiceHint=document.getElementById('fateChoiceHint');

    if(choicesEl)choicesEl.innerHTML='';
    if(choiceHint)choiceHint.textContent='输入你的行动，或等待命运生成首段剧情';
    if(choiceArea)choiceArea.style.display='block';

    if(this._messages.length===0){
      container.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;line-height:1.8"><div style="font-size:36px;margin-bottom:12px">'+(this._mode==='appear'?'🤝':'👻')+'</div>时空通道正在打开…</div>';
      return;
    }
    var self=this;
    this._messages.forEach(function(m,i){
      var div=document.createElement('div');
      if(m.role==='system'){
        div.className='fate-story-block fate-story-system';
        div.innerHTML=escHtml(m.content);
      }else if(m.role==='user'){
        div.className='fate-story-block fate-story-user';
        div.innerHTML='▸ '+escHtml(m.content);
      }else{
        div.className='fate-story-block';
        var storyText=m.content||'';
        if(typeof _stripLeakedThinking==='function') storyText=_stripLeakedThinking(storyText);
        if(typeof applyRegexRules==='function'){
          storyText=applyRegexRules(storyText,'aiOutput');
        }
        var html=escHtml(storyText);
        html=html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        html=html.replace(/\*([^*]+)\*/g,'<em>$1</em>');
        html=html.replace(/"([^"]+)"/g,'"<strong>$1</strong>"');
        div.innerHTML=html;
      }
      div.dataset.idx=i;
      // 复选框（多选模式下显示）
      var cb=document.createElement('input');
      cb.type='checkbox';
      cb.className='fate-story-cb';
      cb.style.cssText='display:none;width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;cursor:pointer;position:absolute;top:8px;left:8px;z-index:2';
      cb.onclick=function(e){e.stopPropagation();cbyd21_Fate._updateSelectCount()};
      div.style.position='relative';
      div.insertBefore(cb,div.firstChild);
      // 多选模式下点击切换
      div.addEventListener('click',function(e){
        if(!cbyd21_Fate._multiselect)return;
        var _cb=this.querySelector('.fate-story-cb');
        if(_cb&&e.target!==_cb){_cb.checked=!_cb.checked;cbyd21_Fate._updateSelectCount()}
      });
      // 长按弹操作菜单
      var _fpt=null;
      div.addEventListener('touchstart',function(e){
        var _idx=parseInt(this.dataset.idx);
        _fpt=setTimeout(function(){cbyd21_Fate.openStoryMenu(_idx)},600);
      },{passive:true});
      div.addEventListener('touchend',function(){clearTimeout(_fpt)});
      div.addEventListener('touchmove',function(){clearTimeout(_fpt)});
      div.addEventListener('contextmenu',function(e){
        e.preventDefault();
        cbyd21_Fate.openStoryMenu(parseInt(this.dataset.idx));
      });
      container.appendChild(div);
    });
    // 如果最后一条AI消息带选项，渲染选项按钮
    var lastMsg=this._messages[this._messages.length-1];
    if(lastMsg&&lastMsg.role==='ai'&&lastMsg._choices&&lastMsg._choices.length>0){
      this._renderChoices(lastMsg._choices);
    }
  },

  // 渲染干预选项按钮
  _renderChoices:function(choices){
    var choiceArea=document.getElementById('fateChoiceArea');
    var choicesEl=document.getElementById('fateChoices');
    choicesEl.innerHTML='';
    var self=this;
    choices.forEach(function(c,i){
      var btn=document.createElement('button');
      btn.className='fate-choice-btn';
      btn.textContent=c;
      btn.onclick=function(){self.selectChoice(c)};
      choicesEl.appendChild(btn);
    });
    choiceArea.style.display='block';
    document.getElementById('fateChoiceHint').textContent='选择你的行动，或输入别的做法';
    document.getElementById('fateCustomInput').value='';
    this._scrollToBottom();
  },

  // 用户点击预设选项
  selectChoice:function(choiceText){
    if(this._generating){
      var self=this;
      var _choice=choiceText;
      customConfirm('AI正在生成剧情，确认终止并执行此选项？').then(function(yes){
        if(!yes)return;
        if(self._abortController){self._abortController.abort();self._abortController=null}
        self._generating=false;
        document.getElementById('fateTyping').classList.remove('active');
        document.getElementById('fateChoiceArea').style.display='none';
        self._messages.push({role:'user',content:_choice,time:formatTime(Date.now())});
        self._save();
        self.renderStory();
        self._scrollToBottom();
        self._generateScene();
      });
      return;
    }
    if(!this._promptReadyOrToast()){
      return;
    }

    document.getElementById('fateChoiceArea').style.display='none';
    this._messages.push({role:'user',content:choiceText,time:formatTime(Date.now())});
    this._save();
    this.renderStory();
    this._scrollToBottom();
    this._generateScene();
  },

  // 用户手写自定义行动
  sendCustomAction:function(){
    var inp=document.getElementById('fateCustomInput');
    var text=inp.value.trim();
    if(!text)return;
    if(this._generating){
      var self=this;
      customConfirm('AI正在生成剧情，确认终止当前生成？').then(function(yes){
        if(!yes)return;
        if(self._abortController){self._abortController.abort();self._abortController=null}
        self._generating=false;
        document.getElementById('fateTyping').classList.remove('active');
        showToast('已终止生成');
      });
      return;
    }
    if(!this._promptReadyOrToast()){
      return;
    }

    inp.value='';
    document.getElementById('fateChoiceArea').style.display='none';
    this._messages.push({role:'user',content:text,time:formatTime(Date.now())});
    this._save();
    this.renderStory();
    this._scrollToBottom();
    this._generateScene();
  },

  // ============ AI生成场景（调用API） ============
  _generateScene:async function(){
    if(this._generating)return;

    if(!this._promptReadyOrToast()){
      return;
    }

    var branch=this._getCurrentBranch();
    if(branch&&branch._streamMode){this._generateSceneStream();return}
    this._generating=true;
    document.getElementById('fateTyping').classList.add('active');
    this._scrollToBottom();
    try{
      await this._ensureBuiltinPresets();
      this._applyBuiltinPresetDefaultToBranch();

      var req=this._buildRequest();
      this._abortController=new AbortController();
      var r=await fetch(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:this._abortController.signal});
      if(!r.ok){var t=await r.text();throw new Error('HTTP '+r.status+': '+t.slice(0,300))}
      var _rawFateApiText = await r.text();
      var _parsedFateApiText = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawFateApiText)
        : { data:null, text:_rawFateApiText };

      var d = _parsedFateApiText.data || {};
      var reply = _parsedFateApiText.text || this._extractReplyContent(d);

      if(!reply && _rawFateApiText && String(_rawFateApiText).trim()){
        reply =
          '[前端提示：浮生逆笔 API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
          String(_rawFateApiText || '').trim();
      }

      reply=String(reply||'').trim();

      if(typeof _stripLeakedThinking==='function') reply=_stripLeakedThinking(reply);
      if(!reply)reply='（命运沉默了……）';
      var parsed=this._safeParseReply(reply,'浮生逆笔非流式回复');
      var time=formatTime(Date.now());
      var _fatePromptT=d.usage&&d.usage.prompt_tokens||0;
      var _fateCompT=d.usage&&d.usage.completion_tokens||Math.ceil(reply.length/2);
      var _fateOutputChars=_countTextChars(parsed.story);
      var _fateInputChars=_countTextChars(req.body.messages.map(function(m){return m.content||''}).join(''));
      var msg={role:'ai',content:parsed.story,time:time,_promptTokens:_fatePromptT,_completionTokens:_fateCompT,_inputChars:_fateInputChars,_outputChars:_fateOutputChars};
      if(parsed.choices.length>0)msg._choices=parsed.choices;
      this._messages.push(msg);

      // 非流式剧情生成成功后立刻保存，并等待一次 IndexedDB 主存落地。
      // 目标：只要内容已经进入用户页面，就尽最大可能持久化。
      // 这里等待 _save()，而不是绕过它直接调用 _persistDataNow()。
      // 原因：
      // · _save() 会先把当前 _messages 写回当前时间线 branch.messages；
      // · _save() 内部再调用 IndexedDB 主存持久化；
      // · 这样不会漏掉当前时间线分支同步。
      var _fatePersistRes = this._save
        ? await this._save()
        : null;

      if(!_fatePersistRes || !_fatePersistRes.ok){
        showToast('浮生剧情已生成，但保存异常，请尽快导出备份');
      }
    }catch(e){
      if(e.name==='AbortError'){
        if(!this._abortController){
          document.getElementById('fateTyping').classList.remove('active');
          this._generating=false;
        }
        showToast('已终止生成');
        return;
      }
      showApiError(e.message||'');
    }
    this._abortController=null;
    document.getElementById('fateTyping').classList.remove('active');
    this._generating=false;
    this.renderStory();
    this._scrollToBottomIfNear();
  },

  // _persistStreamTemp(content, force)
  // → 浮生逆笔流式生成中，把半截内容写回当前时间线。
  // 防止小窗 / 后台 / 页面重绘时只更新 DOM，导致内容消失。
  _persistStreamTemp:function(content, force){
    var idx = this._streamTempIdx;

    if(idx === null || idx === undefined || idx < 0)return;

    var msg = this._messages && this._messages[idx];

    if(!msg)return;

    msg.content = String(content || '');
    msg._streaming = true;
    msg._streamUpdatedAt = Date.now();

    var now = Date.now();

    if(force || !this._streamLastSaveAt || now - this._streamLastSaveAt > 1200){
      this._streamLastSaveAt = now;
      this._save();
    }
  },

  // _abortStreamForPageSuspend()
  // → 旧版页面挂起兜底入口。
  // 当前产品逻辑已经改为：小窗 / 切后台 / pagehide 不主动终止浮生逆笔生成。
  // 保留函数只是为了兼容旧调用路径；即使被旧逻辑误调用，也只保存半截内容，不 abort。
  _abortStreamForPageSuspend:function(){
    try{
      if(
        this._streamTempIdx !== null &&
        this._streamTempIdx !== undefined &&
        this._streamTempIdx >= 0
      ){
        this._persistStreamTemp(
          this._messages[this._streamTempIdx] ? this._messages[this._streamTempIdx].content : '',
          true
        );
      }else if(this._charId && typeof this._save === 'function'){
        this._save();
      }
    }catch(e){}
  },


  _generateSceneStream:async function(){
    if(this._generating)return;

    if(!this._promptReadyOrToast()){
      return;
    }

    this._generating=true;
    document.getElementById('fateTyping').classList.add('active');
    this._scrollToBottom();

    var full='';
    var _fateStreamErrorHandled = false;
    // rawStreamText 用于兼容“开启 stream=true 但接口返回非 SSE 的完整 JSON/文本”的中转站。
    // 如果正常 SSE 解析没有拿到内容，结束后会尝试从 rawStreamText 里按普通返回解析一次。
    var rawStreamText='';
    var tempIdx=-1;
    var tempTime=formatTime(Date.now());

    this._streamTempIdx=null;
    this._streamLastSaveAt=0;
    this._streamSuspendAbort=false;
    this._streamAutoScrollLocked=false;
    try{
      await this._ensureBuiltinPresets();
      this._applyBuiltinPresetDefaultToBranch();

      var req=this._buildRequest();
      req.body.stream=true;
      this._abortController=new AbortController();
      var r=await fetch(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:this._abortController.signal});
      if(!r.ok){var t=await r.text();throw new Error('HTTP '+r.status+': '+t.slice(0,300))}
      var container=document.getElementById('fateStoryContainer');
      var tempDiv=null;
      var firstChunk=true;
      var rd=r.body.getReader();
      var dc=new TextDecoder();
      var buf='';
      while(true){
        var result=await rd.read();
        if(result.done)break;
        var chunkText=dc.decode(result.value,{stream:true});
        rawStreamText+=chunkText;
        buf+=chunkText;
        var ls=buf.split('\n');
        buf=ls.pop()||'';
        for(var li=0;li<ls.length;li++){
          var tr=ls[li].trim();
          if(!tr||tr==='data: [DONE]')continue;
          if(tr.startsWith('event:'))continue;
          if(!tr.startsWith('data:'))continue;
          var js=tr.startsWith('data: ')?tr.slice(6):tr.slice(5);
          try{
            var j=JSON.parse(js);
            var dd=this._extractReplyContent(j);

            dd=String(dd||'');

            if(dd){
              if(firstChunk){
                document.getElementById('fateTyping').classList.remove('active');
                firstChunk=false;

                tempDiv=document.createElement('div');
                tempDiv.className='fate-story-block';
                container.appendChild(tempDiv);

                this._messages.push({
                  role:'ai',
                  content:'',
                  time:tempTime,
                  _ts:Date.now(),
                  _streaming:true
                });

                tempIdx=this._messages.length-1;
                this._streamTempIdx=tempIdx;
                this._persistStreamTemp('', true);
              }
              full+=dd;
              var streamText=full;
              if(typeof _stripLeakedThinking==='function') streamText=_stripLeakedThinking(streamText);
              if(typeof applyRegexRules==='function'){
                streamText=applyRegexRules(streamText,'aiOutput');
              }
              var html='';
              if(typeof _cbyd21RenderStreamingSafeContent === 'function'){
                html = _cbyd21RenderStreamingSafeContent(streamText);
              }else{
                html=escHtml(streamText);
                html=html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
                html=html.replace(/\*([^*]+)\*/g,'<em>$1</em>');
              }
              if(tempIdx >= 0){
                this._persistStreamTemp(streamText, false);
              }

              if(!tempDiv || !tempDiv.isConnected){
                this.renderStory();
                var blocks=document.querySelectorAll('#fateStoryContainer .fate-story-block');
                tempDiv=blocks && blocks.length ? blocks[blocks.length-1] : null;
              }

              if(tempDiv){tempDiv.innerHTML=html}
              this._scrollToBottomIfNear();
            }
          }catch(e2){}
        }
      }
      // 某些中转站在 stream=true 时仍返回普通 JSON / 普通文本。
      // 如果 SSE 解析没有拿到任何内容，就尝试按非流式响应解析一次。
      // 不重试 API，只解析本次已经返回的 rawStreamText。
      if(!full && rawStreamText && rawStreamText.trim()){
        var _fateStreamParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
          ? _cbyd21ParseChatApiResponseText(rawStreamText)
          : {data:null,text:rawStreamText};

        var _fateStreamFallbackText = _fateStreamParsed.text || (
          cbyd21_Fate._extractReplyContent
            ? cbyd21_Fate._extractReplyContent(_fateStreamParsed.data || {})
            : ''
        );

        if(_fateStreamFallbackText){
          full = String(_fateStreamFallbackText || '').trim();
        }
      }

      if(!full)full='（命运沉默了……）';
      full=full.replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'').replace(/\n*<<<[A-Z_]+[\s\S]*$/,'').trim();
      if(typeof _stripLeakedThinking==='function') full=_stripLeakedThinking(full);
      if(!full)full='（命运沉默了……）';
      var parsed=this._safeParseReply(full,'浮生逆笔流式回复');
      var time=formatTime(Date.now());
      var _fateCompT=Math.ceil(full.length/2);
      var _fateOutputChars=_countTextChars(parsed.story);
      var _fateInputChars=_countTextChars(req.body.messages.map(function(m){return m.content||''}).join(''));
      var msg={role:'ai',content:parsed.story,time:time,_completionTokens:_fateCompT,_inputChars:_fateInputChars,_outputChars:_fateOutputChars};
      if(parsed.choices.length>0)msg._choices=parsed.choices;

      if(tempIdx >= 0 && this._messages[tempIdx]){
        this._messages[tempIdx]=msg;
      }else{
        this._messages.push(msg);
      }

      this._streamTempIdx=null;
      this._streamLastSaveAt=0;
      this._streamSuspendAbort=false;

      this._save();
    }catch(e){
      if(e.name==='AbortError'){
        full=String(full||'')
          .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'')
          .replace(/\n*<<<[A-Z_]+[\s\S]*$/,'')
          .trim();

        if(typeof _stripLeakedThinking==='function') full=_stripLeakedThinking(full);

        if(typeof _cbyd21CleanStreamingHiddenMarkers === 'function'){
          full = _cbyd21CleanStreamingHiddenMarkers(full);
        }

        if(full && full.length > 0){
          var reason=this._streamSuspendAbort
            ? '页面切换或小窗模式导致生成中断'
            : '生成被中断';

          var _fateAbortWasScrollLocked = !!this._streamAutoScrollLocked;

          var keepMsg={
            role:'ai',
            content:full+'\n\n[⚠️ '+reason+'，已保留当前生成内容。需要继续可再次点击重roll或输入行动。]',
            time:tempTime || formatTime(Date.now()),
            _ts:Date.now()
          };

          if(tempIdx >= 0 && this._messages[tempIdx]){
            this._messages[tempIdx]=keepMsg;
          }else{
            this._messages.push(keepMsg);
          }

          this._save();
          this.renderStory();

          if(!_fateAbortWasScrollLocked){
            this._scrollToBottom();
          }

          showToast('已中断，部分内容已保留');
        }else{
          if(tempIdx >= 0 && this._messages[tempIdx] && this._messages[tempIdx]._streaming){
            this._messages.splice(tempIdx,1);
            this._save();
            this.renderStory();
          }

          showToast('已终止生成');
        }

        this._streamTempIdx=null;
        this._streamLastSaveAt=0;
        this._streamSuspendAbort=false;
        this._streamAutoScrollLocked=false;

        if(Array.isArray(this._scrollTimers)){
          this._scrollTimers.forEach(function(t){
            clearTimeout(t);
          });
          this._scrollTimers=[];
        }

        this._abortController=null;
        document.getElementById('fateTyping').classList.remove('active');
        this._generating=false;
        return;
      }

      full = String(full || '')
        .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'')
        .replace(/\n*<<<[A-Z_]+[\s\S]*$/,'')
        .trim();

      if(typeof _stripLeakedThinking === 'function'){
        full = _stripLeakedThinking(full);
      }

      if(typeof _cbyd21CleanStreamingHiddenMarkers === 'function'){
        full = _cbyd21CleanStreamingHiddenMarkers(full);
      }

      var _fateStreamHadPartial = !!(full && full.length > 0);

      if(_fateStreamHadPartial){
        var errorKeepMsg = {
          role:'ai',
          content:full + '\n\n[⚠️ 生成异常中断，已保留当前生成内容。需要继续可再次点击重roll或输入行动。]',
          time:tempTime || formatTime(Date.now()),
          _ts:Date.now()
        };

        if(tempIdx >= 0 && this._messages[tempIdx]){
          this._messages[tempIdx] = errorKeepMsg;
        }else{
          this._messages.push(errorKeepMsg);
        }

        this._save();
        this.renderStory();
      }else if(tempIdx >= 0 && this._messages[tempIdx] && this._messages[tempIdx]._streaming){
        this._messages.splice(tempIdx, 1);
        this._save();
        this.renderStory();
      }

      var _fateErrorWasScrollLocked = !!this._streamAutoScrollLocked;
      _fateStreamErrorHandled = true;

      this._streamTempIdx=null;
      this._streamLastSaveAt=0;
      this._streamSuspendAbort=false;
      this._streamAutoScrollLocked=false;
      this._abortController=null;

      if(Array.isArray(this._scrollTimers)){
        this._scrollTimers.forEach(function(t){
          clearTimeout(t);
        });
        this._scrollTimers=[];
      }

      if(_fateStreamHadPartial && !_fateErrorWasScrollLocked){
        this._scrollToBottom();
      }

      // 如果已经拿到部分剧情，不弹 API 错误面板。
      // 这类情况通常是中转站断流/非标准流式，用户需要的是保留内容和继续入口。
      if(_fateStreamHadPartial){
        showToast('生成异常中断，已保留当前内容');
      }else{
        showApiError(e.message||'');
      }
    }

    var _fateWasScrollLocked = !!this._streamAutoScrollLocked;

    this._streamTempIdx=null;
    this._streamLastSaveAt=0;
    this._streamSuspendAbort=false;
    this._abortController=null;
    document.getElementById('fateTyping').classList.remove('active');
    this._generating=false;
    this._streamAutoScrollLocked=false;
    this.renderStory();

    if(!_fateStreamErrorHandled && !_fateWasScrollLocked){
      this._scrollToBottom();
    }
  },

  // 解析AI回复：分离故事正文和选项
  _parseReply:function(text){
    var choices=[];
    var story=text;
    // 先尝试 [选项1: xxx] 格式
    var bracketMatch=text.match(/\[选项\d*[:：]?\s*([^\]]+)\]/g);
    if(bracketMatch&&bracketMatch.length>=2){
      bracketMatch.forEach(function(m){
        var inner=m.replace(/^\[选项\d*[:：]?\s*/,'').replace(/\]$/,'').trim();
        if(inner)choices.push(inner);
      });
      story=text.replace(/\[选项\d*[:：]?\s*[^\]]+\]/g,'').trim();
    }
    // 再尝试 1. xxx 2. xxx 数字编号格式
    if(choices.length===0){
      var lines=text.split('\n');
      var choiceLines=[];
      var inChoices=false;
      for(var i=lines.length-1;i>=0;i--){
        var line=lines[i].trim();
        if(/^[1-4][.、)）]\s*.+/.test(line)){
          choiceLines.unshift(line.replace(/^[1-4][.、)）]\s*/,''));
          inChoices=true;
        }else if(inChoices&&line===''){
          continue;
        }else{
          break;
        }
      }
      if(choiceLines.length>=2){
        choices=choiceLines;
        story=lines.slice(0,lines.length-choiceLines.length).join('\n').replace(/\n+$/,'').trim();
      }
    }
    // 清理正文末尾的多余引导语
    story=story.replace(/\n*你(可以|会|想要|决定)?[:：]?\s*$/,'').trim();
    story=story.replace(/\n*接下来(你|，你)?[:：]?\s*$/,'').trim();
    return{story:story,choices:choices};
  },

  // _buildContextPackMessages(sm,msgs,wb,taskName)
  // → 浮生逆笔统一上下文包模式。
  // · system 只放短协议
  // · 完整角色卡/干预者信息/世界书/玩法规则/预设放进第一条 user message
  // · 避免某些渠道读不到 system 里的角色卡
  // · 避免 system 一份 + user 一份的双注入
  _buildContextPackMessages:function(sm,msgs,wb,taskName){
    msgs=(msgs||[]).map(function(m){
      return {role:m.role,content:m.content};
    });

    var blocks=[];

    blocks.push(
      '[前端上下文包说明]\n' +
      '以下内容由前端生成，包括浮生逆笔玩法规则、角色卡、干预者信息、世界书、文风预设和输出格式。\n' +
      '这些内容不是干预者在剧情里说的话，不要在回复中复述、解释或暴露。\n' +
      '只需要把它们作为本轮命运干预叙事必须参考的上下文。'
    );

    if(wb&&wb.user_start&&wb.user_start.length>0){
      blocks.push(
        '[兼容最前规则]\n' +
        wb.user_start.map(function(w){
          return '['+w.name+']\n'+w.content;
        }).join('\n\n')
      );
    }

    blocks.push(String(sm||''));

    var pack =
      '[前端上下文包]\n' +
      '这是一段前端打包给模型的浮生逆笔上下文，不是干预者的真实剧情发言。\n' +
      '请根据下方上下文执行当前任务：'+(taskName||'生成命运干预剧情')+'。\n' +
      '不要复述、解释或暴露本上下文包。\n\n' +
      blocks.join('\n\n---\n\n') +
      '\n\n[前端上下文包结束]';

    if(msgs.length>0&&msgs[0]&&msgs[0].role==='user'){
      msgs[0].content=pack+'\n\n[后续剧情历史 / 干预行动开始]\n'+msgs[0].content;
    }else{
      msgs.unshift({
        role:'user',
        content:
          pack+
          '\n\n[后续剧情历史开始]\n下面是本次请求保留下来的剧情历史。请结合前端上下文包理解后续消息，不要把上下文包当成干预者真实发言。'
      });
    }

    return [{
      role:'system',
      content:'[前端协议]\n第一条 user message 的开头包含前端浮生逆笔上下文包，里面有角色卡、干预者信息、世界书、玩法规则、文风预设和输出格式。它不是干预者的真实剧情发言。请根据该上下文包生成命运干预剧情，不要复述或暴露上下文包内容。'
    }].concat(msgs);
  },

  // ============ 构建API请求（系统提示词+历史消息） ============
  _buildRequest:function(){
    var ch=getCharById(this._charId);
    var sp=[];
    var up=getCurrentProfile();
    var chatMock={messages:this._messages};
    var _wb3=collectActiveWorldBook(chatMock,this._charId);

    if(_wb3.system_start&&_wb3.system_start.length>0)sp.push('[最高优先级强制指令 — 最前]\n'+_wb3.system_start.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));

    if(_wb3.before_char.length>0)sp.push('[World Book — 世界背景]\n'+_wb3.before_char.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));

    // 注入角色设定
    if(ch&&ch.prompt&&ch.prompt.trim()&&!(typeof _isMissingCharPrompt==='function'&&_isMissingCharPrompt(ch.prompt))){
      sp.push('[角色设定]\n'+_replaceCardVars(ch.prompt.trim(),ch.name,up.name||''));
    }else if(ch){
      sp.push('[角色设定]\n当前干预对象是「'+ch.name+'」。该角色完整人设缺失或需要从备份恢复。即使缺少详细人设，也不能把干预者信息当成角色人设。');
    }

    if(_wb3.after_char.length>0)sp.push('[World Book]\n'+_wb3.after_char.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));

    // 注入用户面具信息（始终注入用户名）
    var _fateUserBlock='[干预者信息]\n干预者的名字是「'+(up.name||'我')+'」。'+((up.name&&up.name!=='我')?'':'干预者没有设置名字。')+'\n绝对不能用角色自己的名字来称呼干预者。';
    if(up.persona&&up.persona.trim())_fateUserBlock+='\n'+up.persona.trim();
    sp.push(_fateUserBlock);

    if(ch){
      sp.push('[身份最终锁定]\n当前命运干预对象是「'+ch.name+'」。\n干预者是「'+(up.name||'我')+'」。\n\n干预者信息只属于用户，不属于角色。不能把干预者面具当成角色人设。');
    }

    // 注入模式提示词（现身陪伴 / 暗中守护）
    var modePrompt='';
    if(this._mode==='appear'){
      modePrompt='# 浮生逆笔 · 现身陪伴模式\n\n## 你的任务\n你是一个交互式叙事引擎。根据上方角色设定，生成角色人生中某个关键时刻的场景。\n\n## 场景生成规则\n- 如果角色卡里有明确的过去经历、危难时刻、转折点或未来走向，优先使用角色卡的设定\n- 如果角色卡没有详细描述，根据角色的性格、身份、世界观，合理推演一个足以影响命运走向的关键时刻\n- 场景可以发生在过去，也可以发生在某个未来可能性里；由角色卡和当前命运主题决定，不要固定写成“回到过去”\n- 场景必须是角色人生中的重要节点，可以是危难、抉择、失去、孤独、冲突、错过、重逢、崩坏前夜，或任何足以影响命运走向的瞬间\n- 【时间线】这是角色命运支流中的一个关键节点，不要求一定发生在角色遇见用户之前。若场景发生在角色认识用户之前，角色此刻不认识用户；若场景发生在未来可能性里，角色对用户的认知应符合那条时间线的状态\n- 角色可能对这次遭遇保留模糊的记忆、预感或既视感，但这种痕迹不需要每次都强调，也不要写得过于抒情或悬浮\n\n## 干预者（用户）的存在\n- 用户出现在这个场景中，但角色不理解用户为何能来到这个命运节点\n- 角色会根据当前时间线状态判断用户是陌生人、熟人、重要的人，或一个说不清来源的存在\n- 角色能看见用户、能和用户交流\n- 角色会对用户的出现做出符合自己性格和当下处境的反应\n- 用户的行为可以影响事件走向\n- 场景结束后，角色可能留下模糊印象、情绪痕迹或命运偏移，但不会理解系统层面的真相\n\n## 输出格式\n- 使用第三人称上帝视角叙述\n- 包含环境描写、角色动作/表情/心理、对话\n- 每段回复300-600字\n- 对话用引号包裹\n- **回复末尾必须生成2-4个选项**，格式如下：\n\n1. 第一个选项\n2. 第二个选项\n3. 第三个选项\n\n## 选项生成规则（重点）\n- 选项必须符合当前情境逻辑，必须是这个时刻真的做得出来的行为或回应\n- 选项必须是可执行动作，不能写成抒情句子、文艺句子、命运感文案、旁白式概括\n- 选项不能跳步骤，不能突然做出当前场景里不合理的大动作\n- 选项之间要有区分度，但都必须合理，例如更直接、更克制、更试探、更观察，而不是单纯换个说法\n- 如果当前场景紧张，选项就要贴合紧张局势；如果当前场景克制，选项就不要强行激烈\n- 不要为了“有画面感”把选项写得油腻或悬浮\n- 选项长度尽量简洁明确，让用户一眼就知道自己要做什么\n- 判断标准只有一个：这些选项看起来像是当前这个人，在这个局面下，真的可能会做出的选择\n\n## 叙事原则\n- 角色的行为必须严格遵循角色卡设定的性格\n- 用户的干预可以改变结局，但不能让角色做出完全违反性格的事\n- 保持情感张力，但不要用过度煽情、过度文艺、过度“命运感”的表达去硬抬气氛\n- 禁止替用户做决定或描写用户的内心\n- 描写用户的动作时，只写用户选择的那个行动本身';
    }else{
      modePrompt='# 浮生逆笔 · 暗中守护模式\n\n## 你的任务\n你是一个交互式叙事引擎。根据上方角色设定，生成角色人生中某个关键时刻的场景。\n\n## 场景生成规则\n- 如果角色卡里有明确的过去经历、危难时刻、转折点或未来走向，优先使用角色卡的设定\n- 如果角色卡没有详细描述，根据角色的性格、身份、世界观，合理推演一个足以影响命运走向的关键时刻\n- 场景可以发生在过去，也可以发生在某个未来可能性里；由角色卡和当前命运主题决定，不要固定写成“回到过去”\n- 场景必须是角色人生中的重要节点，是一个轻微改变就可能让命运偏移的地方\n- 【时间线】这是角色命运支流中的一个关键节点。若场景发生在角色认识用户之前，角色此刻不认识用户；若场景发生在未来可能性里，角色对用户的认知应符合那条时间线的状态\n\n## 干预者（用户）的存在\n- 用户是透明的，角色完全看不见用户\n- 用户只能做非常微小、且符合当前环境的干预，例如改变一个物体的位置、制造一点声响、挡住一个小意外、让某件事偏离原本的轨迹\n- 角色可能会察觉到不对劲、产生既视感或被命运轻轻推了一下的错觉，但不会知道有人在帮忙\n- 用户的干预应该以“小动作带来后续变化”为主，而不是直接改写结果\n\n## 输出格式\n- 使用第三人称上帝视角叙述\n- 包含环境描写、角色动作/表情/心理\n- 每段回复300-600字\n- 对话用引号包裹\n- **回复末尾必须生成2-4个选项**，格式如下：\n\n1. 第一个选项\n2. 第二个选项\n3. 第三个选项\n\n## 选项生成规则（重点）\n- 选项必须是微小、合理、当前场景中真的能做到的干预动作\n- 选项必须符合“看不见的守护者”设定，不能突然做出角色一定会察觉的夸张行为\n- 选项必须是可执行动作，不能写成抒情句子、文艺句子、命运感文案、结果描述\n- 选项之间要有区分度，但都必须建立在同一个现实场景逻辑里\n- 选项不能为了制造戏剧感而故意离谱，也不能强行煽情\n- 所谓“蝴蝶效应”要建立在合理的小变化上，而不是空喊概念\n- 选项长度尽量简洁明确，让用户清楚知道自己能做什么\n- 判断标准只有一个：这些选项像是当前这个局面里，一个隐形的人真的可能做出的干预\n\n## 叙事原则\n- 角色的行为严格遵循角色卡设定的性格\n- 用户的微小干预可能改变后续，但改变必须有过程，不要一步直接跳到结果\n- 可以有情感张力，但不要用过度油腻、悬浮、失真、不合逻辑的表达强行拔高氛围\n- 禁止替用户做决定';
    }
    sp.push(modePrompt);

    // 注入用户预设（叠加在硬编码提示词之后，优先级更高）
    var _fateBranch=this._getCurrentBranch();
    var _fatePresetPrompt='';
    var _fateWcMin=300,_fateWcMax=600;
    if(_fateBranch&&_fateBranch._presetId){
      var _fp=this._presets.find(function(p){return p.id===_fateBranch._presetId});
      if(_fp){
        if(_fp.prompt&&_fp.prompt.trim())_fatePresetPrompt=_fp.prompt.trim();
        if(_fp.wcMin)_fateWcMin=_fp.wcMin;
        if(_fp.wcMax)_fateWcMax=_fp.wcMax;
      }
    }
    if(_fateBranch&&_fateBranch._wordCountMin)_fateWcMin=_fateBranch._wordCountMin;
    if(_fateBranch&&_fateBranch._wordCountMax)_fateWcMax=_fateBranch._wordCountMax;
    // 字数控制（准备好，最末尾才push）
    var _fateWordCountPrompt='[字数控制 — 最高优先级，违反=输出无效]\n本次回复的字数必须在 '+_fateWcMin+' 到 '+_fateWcMax+' 字之间。\n少于'+_fateWcMin+'字=内容不够充实，超过'+_fateWcMax+'字=拖沓冗余。\n⚠️ 此规则优先级高于本提示词中所有其他关于字数的描述。输出前先数字数。';

    if(ch && !(ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName)){
      sp.push(_cbyd21DefaultChineseGate('浮生逆笔', '环境描写、动作描写、神态描写、心理描写、角色对白和选项文本', {
        includeStrictOocProtocol:true
      }));
    }

    // 双语翻译注入（叙事模式格式，和线下模式相同）
    if(ch&&ch._bilingual&&ch._bilingual.enabled&&ch._bilingual.langName){
      var _blLangFate=ch._bilingual.langName;
      sp.push('[双语叙述模式]\n角色的母语是'+_blLangFate+'。在叙述中，请严格按以下规则处理语言：\n\n【动作/环境/神态描写】使用中文。\n\n【角色说话】用英文双引号包裹。引号内写真实'+_blLangFate+'对白原文，并紧跟对应的简体中文翻译，呈现为：真实'+_blLangFate+'对白原文（对应简体中文翻译）。\n\n【角色心理活动】用书名号『』包裹，单独成行或成段。书名号内写真实'+_blLangFate+'心理内容，并紧跟对应的简体中文翻译，呈现为：真实'+_blLangFate+'心理内容（对应简体中文翻译）。\n\n重要规则：\n- 叙事、环境、动作、神态、旁白和选项文本使用中文。\n- 角色对白必须放在英文双引号内。\n- 角色心理活动必须放在书名号『』内，并单独成行或成段。\n- 所有双语内容都必须是剧情里的真实话语、真实心理和对应真实翻译。');
    }

    // 文风预设放在system_end之后（模型最后读到的优先级最高）
    if(_fatePresetPrompt){
      sp.push('[用户文风预设 — 文风以此为准，叙事逻辑结合提示词]\n'+_fatePresetPrompt+'\n[/用户文风预设]');
    }

    // 字数控制放在系统末尾前
    sp.push(_fateWordCountPrompt);

    // 世界书system_end位置注入（强制指令）
    if(_wb3.system_end.length>0)sp.push('[强制指令]\n'+_wb3.system_end.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));

    // 用户文风预设执行锁
    if(_fatePresetPrompt&&_fatePresetPrompt.trim()){
      sp.push('[用户文风预设执行锁 — 最高优先级]\n如果上文存在[用户文风预设]，最终输出的文风、笔触、语感、节奏、修辞偏好和禁用写法必须严格以用户文风预设为准。\n世界书、角色设定和剧情逻辑可以决定写什么，但不能覆盖用户文风预设要求的写法。\n如果任何提示与用户文风预设的表达方式冲突，优先保持用户文风预设。');
    }

    // 拼接系统消息
    var sm=sp.join('\n\n---\n\n');

    // 构建历史消息数组
    var msgs=this._messages.map(function(m){
      var _fc=m.content||'';
      if(typeof _stripLeakedThinking==='function') _fc=_stripLeakedThinking(_fc);
      if(m.role==='user')return{role:'user',content:'[干预者的行动] '+_fc};
      if(m.role==='system')return{role:'assistant',content:_fc};
      return{role:'assistant',content:_fc};
    });

    // 首次进入时自动发起场景生成
    if(msgs.length===0){
      msgs.push({role:'user',content:'[命运节点已打开。请生成角色人生中的一个关键场景，描述环境、角色的状态，以及正在发生什么。这个节点可以来自过去，也可以来自未来可能性，由角色卡和命运主题自然决定。末尾给出2-4个干预选项。]'});
    }

    // 按角色设置的上下文轮数裁剪历史消息
    var _fateCh=getCharById(this._charId);
    var _fateCtxR=_fateCh&&_fateCh.contextRounds!==undefined?_fateCh.contextRounds:20;
    if(_fateCtxR>0&&msgs.length>_fateCtxR*2){msgs=msgs.slice(-(_fateCtxR*2))}

    // 世界书depth位置注入（插入历史消息中）
    if(_wb3.depth.length>0){
      _wb3.depth.forEach(function(w){
        var depthPos=w.depth||4;
        var insertIdx=Math.max(0,msgs.length-depthPos);
        msgs.splice(insertIdx,0,{role:'user',content:'[前端深度注入 — 这不是干预者发言]\n[World Book — '+w.name+']\n'+w.content});
      });
    }

    // 组装请求
    var url=apiConfig.url.replace(/\/+$/,'')+'/chat/completions';
    var headers={'Content-Type':'application/json','Authorization':'Bearer '+apiConfig.key};
    var body={
      model:apiConfig.model,
      messages:this._buildContextPackMessages(sm,msgs,_wb3,'生成命运干预剧情')
    };
    if(apiConfig.temperature!==undefined)body.temperature=apiConfig.temperature;
    return{url:url,headers:headers,body:body};
  },

  // ============ 退出控制 ============

  // 生成中先确认是否终止，再弹退出选项
  requestExit:async function(){
    // 退出优先级高于错误面板。
    // 如果刚才流式断流弹出了 API 错误，先关掉错误层，避免用户以为退不出去。
    try{
      var apiErr = document.getElementById('apiErrorOverlay');
      if(apiErr)apiErr.classList.remove('active');
    }catch(e){}

    if(this._generating){
      var _yes=await customConfirm('AI正在生成剧情，确定要中断吗？\n\n如果已经生成出部分内容，系统会尽量保留；如果还没有返回内容，则不会保存。');
      if(!_yes)return;
      if(this._abortController){this._abortController.abort();this._abortController=null}
      this._generating=false;
      document.getElementById('fateTyping').classList.remove('active');
      this._save();
    }
    document.getElementById('fateExitOverlay').classList.add('active');
  },

  // 取消退出
  cancelExit:function(){
    document.getElementById('fateExitOverlay').classList.remove('active');
  },

  // 暂时离开（保存进度，下次可继续）
  exitTemporary:function(){
    document.getElementById('fateExitOverlay').classList.remove('active');

    if(this._abortController){
      this._abortController.abort();
    }

    this._cleanupStreamRuntime();

    this._save();
    document.getElementById('fateGameView').style.display='none';
    document.getElementById('fateCharSelect').style.display='flex';
    this.renderCharList();
    this._charId=null;
    this._branchId=null;
    this._messages=[];
    showToast('已暂时离开，下次可继续');
  },

  // 结束干预（标记当前时间线为已结束）
  exitEnd:function(){
    document.getElementById('fateExitOverlay').classList.remove('active');

    if(this._abortController){
      this._abortController.abort();
    }

    this._cleanupStreamRuntime();

    var branch=this._getCurrentBranch();
    if(branch)branch.status='ended';
    this._save();
    document.getElementById('fateGameView').style.display='none';
    document.getElementById('fateCharSelect').style.display='flex';
    this.renderCharList();
    this._charId=null;
    this._branchId=null;
    this._messages=[];
    showToast('本次命运干预已结束');
  },

  // _persistDataNow()
  // → 立刻持久化浮生逆笔数据。
  // 说明：
  // · 完整数据优先写 IndexedDB。
  // · 数据较小时保留 localStorage 镜像。
  // · 数据较大时 localStorage 只留 meta。
  // · 不裁剪任何时间线剧情。
  _persistDataNow:function(){
    if(typeof _cbyd21PersistLargeModuleData === 'function'){
      return _cbyd21PersistLargeModuleData(
        'fateData',
        'stm_fateData',
        'stm_fateDataMeta',
        this._data || {}
      );
    }

    try{
      localStorage.setItem('stm_fateData', JSON.stringify(this._data || {}));
      return Promise.resolve({ok:true});
    }catch(e){
      console.warn('浮生逆笔 localStorage 保存失败：', e);
      if(typeof showToast === 'function')showToast('浮生数据保存异常，请尽快导出备份');
      return Promise.resolve({ok:false,error:e});
    }
  },

  // _recoverPersistentStorage()
  // → 从 IndexedDB / localStorage 中恢复浮生逆笔数据。
  // 旧用户首次打开新版时，会自动把 localStorage 旧数据迁移到 IndexedDB。
  _recoverPersistentStorage:async function(){
    try{
      if(typeof _cbyd21RecoverLargeModuleData !== 'function')return;

      var recovered = await _cbyd21RecoverLargeModuleData(
        'fateData',
        'stm_fateData',
        'stm_fateDataMeta',
        this._data || {}
      );

      if(recovered && typeof recovered === 'object' && !Array.isArray(recovered)){
        this._data = recovered;
      }
    }catch(e){
      console.warn('浮生逆笔大数据恢复失败：', e);
    }
  },

  // ============ 数据保存 ============
  // _save()
  // → 保存浮生逆笔数据。
  // 注意：
  // · 不允许保存异常继续向外抛出，否则会被生成流程误判成 API 错误。
  // · 完整数据由 _persistDataNow() 负责写入 IndexedDB 主存。
  _save:function(){
    var branch=this._getCurrentBranch();

    if(branch)branch.messages=this._messages;

    // 返回 Promise，方便关键路径等待 IndexedDB 主存落地。
    // 保存失败不向外抛出，避免被生成流程误判成 API 错误。
    return this._persistDataNow().then(function(res){
      if(!res || !res.ok){
        console.warn('浮生逆笔数据持久化失败');
      }

      return res;
    }).catch(function(e){
      console.warn('浮生逆笔数据持久化异常：', e);

      return {
        ok:false,
        error:e
      };
    });
  },

  // openStoryMenu(idx) → 长按故事块弹出操作菜单
  openStoryMenu:function(idx){
    var m=this._messages[idx];
    if(!m)return;
    var self=this;
    var container=document.getElementById('addCharList');
    container.innerHTML='';
    var items=[
      {label:'编辑',action:function(){closeModal('addCharModal');
        openTextInputModal('编辑剧情','','',function(text){
          if(!text.trim())return;
          self._messages[idx].content=text.trim();
          self._save();
          self.renderStory();
          showToast('已编辑');
        });
        setTimeout(function(){var area=document.getElementById('textInputArea');if(area){area.value=m.content;autoResizeModal(area)}},50);
      }},
      {label:'复制',action:function(){closeModal('addCharModal');
        if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(m.content).then(function(){showToast('已复制')}).catch(function(){_fallbackCopy(m.content)})}else{_fallbackCopy(m.content)}
      }},
      {label:'多选',action:function(){closeModal('addCharModal');self.enterMultiselect()}},
      {label:'删除',danger:true,action:function(){closeModal('addCharModal');
        customConfirm('确认删除这段剧情？').then(function(yes){
          if(!yes)return;
          self._messages.splice(idx,1);
          self._save();
          self.renderStory();
          showToast('已删除');
        });
      }}
    ];
    items.forEach(function(item){
      var div=document.createElement('div');
      div.className='add-char-item';
      div.style.padding='14px 16px';
      div.style.fontSize='14px';
      div.style.color=item.danger?'var(--danger)':'var(--text-primary)';
      div.textContent=item.label;
      div.onclick=item.action;
      container.appendChild(div);
    });
    document.getElementById('addCharModal').querySelector('h3').textContent='剧情操作';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // enterMultiselect() → 进入多选模式
  enterMultiselect:function(){
    this._multiselect=true;
    document.querySelectorAll('#fateStoryContainer .fate-story-cb').forEach(function(cb){cb.style.display='block';cb.checked=false});
    document.getElementById('fateChoiceArea').style.display='none';
    document.getElementById('fateMultiselectBar').style.display='flex';
    this._updateSelectCount();
  },

  // exitMultiselect() → 退出多选模式
  exitMultiselect:function(){
    this._multiselect=false;
    document.querySelectorAll('#fateStoryContainer .fate-story-cb').forEach(function(cb){cb.style.display='none';cb.checked=false});
    document.getElementById('fateMultiselectBar').style.display='none';
    // 恢复底部行动区。
    // 有选项时恢复选项；没有选项时也保留自定义输入栏，避免用户卡在空界面。
    var lastMsg=this._messages[this._messages.length-1];
    if(lastMsg&&lastMsg.role==='ai'&&lastMsg._choices&&lastMsg._choices.length>0){
      this._renderChoices(lastMsg._choices);
    }else{
      var choiceArea=document.getElementById('fateChoiceArea');
      var choicesEl=document.getElementById('fateChoices');
      var choiceHint=document.getElementById('fateChoiceHint');

      if(choicesEl)choicesEl.innerHTML='';
      if(choiceHint)choiceHint.textContent='输入你的行动';
      if(choiceArea)choiceArea.style.display='block';
    }
  },

  // selectAllBlocks() → 全选
  selectAllBlocks:function(){
    document.querySelectorAll('#fateStoryContainer .fate-story-cb').forEach(function(cb){cb.checked=true});
    this._updateSelectCount();
  },

  // _updateSelectCount() → 更新已选计数
  _updateSelectCount:function(){
    var count=document.querySelectorAll('#fateStoryContainer .fate-story-cb:checked').length;
    var el=document.getElementById('fateSelectCount');
    if(el)el.textContent=count;
  },

  // deleteSelectedBlocks() → 删除选中的剧情段
  deleteSelectedBlocks:async function(){
    var checked=document.querySelectorAll('#fateStoryContainer .fate-story-cb:checked');
    if(checked.length===0){showToast('请先选择');return}
    var _yes=await customConfirm('确认删除 '+checked.length+' 段剧情？');
    if(!_yes)return;
    var indices=[];
    checked.forEach(function(cb){var block=cb.closest('.fate-story-block');if(block&&block.dataset.idx!==undefined)indices.push(parseInt(block.dataset.idx))});
    indices.sort(function(a,b){return b-a});
    var self=this;
    indices.forEach(function(i){self._messages.splice(i,1)});
    this._save();
    this.exitMultiselect();
    this.renderStory();
    showToast('已删除 '+indices.length+' 段');
  },

  // regenerate()
  // → 重 roll 当前剧情段。
  // · 空时间线：重新生成开局。
  // · 最后一段是 AI：删除最后一段 AI 后重新生成。
  // · 最后一段是用户行动：直接根据当前用户行动重新生成。
  // · 生成中点击：终止当前生成。
  regenerate:function(){
    if(!this._charId || !this._branchId){
      showToast('还没有进入时间线');
      return;
    }

    if(this._generating){
      if(this._abortController){
        this._abortController.abort();
        this._abortController=null;
      }

      this._generating=false;
      document.getElementById('fateTyping').classList.remove('active');
      showToast('已终止生成');
      return;
    }

    if(!this._promptReadyOrToast()){
      return;
    }

    while(this._messages.length > 0 && this._messages[this._messages.length - 1].role === 'ai'){
      this._messages.pop();
    }

    this._save();
    this.renderStory();
    this._scrollToBottom();
    this._generateScene();
  },


  _saveStreamToggle:function(){
    var branch=this._getCurrentBranch();
    if(!branch)return;
    branch._streamMode=document.getElementById('fateStreamToggle').checked;
    this._save();
    showToast(branch._streamMode?'流式输出已开启':'流式输出已关闭');
  },

  // _updateStreamAutoScrollLock()
  // → 浮生逆笔流式输出时更新“用户是否主动上滑”的锁。
  // · 用户离底部较远：锁定，不再自动滚到底。
  // · 用户重新滚回底部附近：解除锁。
  _updateStreamAutoScrollLock:function(){
    var el = document.getElementById('fateStoryScroll');

    if(!el)return;

    // 只在生成中锁定，非生成状态不保留旧锁。
    if(!this._generating){
      this._streamAutoScrollLocked = false;
      return;
    }

    var distance = el.scrollHeight - el.scrollTop - el.clientHeight;

    // 用户上滑超过 220px，认为用户正在看前文，锁住。
    // 同时取消旧的延迟滚动，避免已经排队的 timeout 再把页面拉到底。
    if(distance > 220){
      this._streamAutoScrollLocked = true;

      if(Array.isArray(this._scrollTimers)){
        this._scrollTimers.forEach(function(t){
          clearTimeout(t);
        });
        this._scrollTimers = [];
      }
    }

    // 用户回到底部附近，解除。
    if(distance < 80){
      this._streamAutoScrollLocked = false;
    }
  },

  // _isNearBottom()
  // → 判断浮生剧情区是否接近底部。
  // 流式生成时用户如果已经上滑查看前文，不再强制滚到底。
  _isNearBottom:function(){
    var el=document.getElementById('fateStoryScroll');

    if(!el)return true;

    return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  },

  // _scrollToBottomIfNear()
  // → 流式生成专用自动滚动。
  _scrollToBottomIfNear:function(){
    this._updateStreamAutoScrollLock();

    if(this._streamAutoScrollLocked){
      return;
    }

    if(this._isNearBottom()){
      this._scrollToBottom();
    }
  },

  // 滚动到故事底部
  // 会记录延迟滚动定时器，方便流式输出中用户上滑后取消旧滚动。
  // 延迟执行时再次检查 _streamAutoScrollLocked，避免用户刚上滑又被旧 timeout 拉到底。
  _scrollToBottom:function(){
    var el=document.getElementById('fateStoryScroll');

    if(!el)return;

    if(Array.isArray(this._scrollTimers)){
      this._scrollTimers.forEach(function(t){
        clearTimeout(t);
      });
    }

    this._scrollTimers = [];

    var self = this;

    this._scrollTimers.push(setTimeout(function(){
      if(self._generating && self._streamAutoScrollLocked)return;
      el.scrollTop = el.scrollHeight;
    },50));

    this._scrollTimers.push(setTimeout(function(){
      if(self._generating && self._streamAutoScrollLocked){
        self._scrollTimers = [];
        return;
      }

      el.scrollTop = el.scrollHeight;
      self._scrollTimers = [];
    },200));
  }
};

// ============ 预设管理方法（挂在 cbyd21_Fate 上） ============

// 进入游戏时加载当前分支绑定的预设
cbyd21_Fate._loadActivePreset=function(){
  var branch=this._getCurrentBranch();
  if(!branch)return;
  if(branch._presetId){
    var preset=this._presets.find(function(p){return p.id===branch._presetId});
    if(preset)this._currentPreset=preset;
  }
};

// 加载内置文风预设
// · 内置预设会写入普通预设列表，所以可编辑、可删除、可另存
// · 用户删除后会记录删除标记，不会下次打开又自动恢复
cbyd21_Fate._ensureBuiltinPresets=function(){
  if(this._builtinPresetLoading){
    return this._builtinPresetPromise || Promise.resolve(null);
  }

  if(localStorage.getItem('stm_fateBuiltinPresetDeleted_humid_tides')==='1'){
    return Promise.resolve(null);
  }

  var existing=(this._presets||[]).find(function(p){
    return p && (
      p.id==='builtin_humid_tides' ||
      p.name==='溽热潮汐'
    );
  });

  if(existing){
    existing.id='builtin_humid_tides';
    existing.name='溽热潮汐';
    localStorage.setItem('stm_fatePresets',JSON.stringify(this._presets));
    return Promise.resolve(existing);
  }

  this._builtinPresetLoading=true;

  var self=this;

  this._builtinPresetPromise=fetch('./presets/humid-tides.txt',{cache:'no-cache'})
    .then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.text();
    })
    .then(function(txt){
      txt=String(txt||'').trim();
      if(!txt)return null;

      var stillExists=(self._presets||[]).find(function(p){
        return p && (
          p.id==='builtin_humid_tides' ||
          p.name==='溽热潮汐'
        );
      });

      if(stillExists){
        stillExists.id='builtin_humid_tides';
        stillExists.name='溽热潮汐';
        localStorage.setItem('stm_fatePresets',JSON.stringify(self._presets));
        return stillExists;
      }

      var preset={
        id:'builtin_humid_tides',
        name:'溽热潮汐',
        prompt:txt,
        wcMin:0,
        wcMax:0
      };

      self._presets.unshift(preset);

      localStorage.setItem('stm_fatePresets',JSON.stringify(self._presets));

      if(typeof self._renderPresetList==='function'){
        self._renderPresetList();
      }

      return preset;
    })
    .catch(function(e){
      console.warn('浮生内置文风预设加载失败：',e);
      return null;
    })
    .finally(function(){
      self._builtinPresetLoading=false;
    });

  return this._builtinPresetPromise;
};

// _applyBuiltinPresetDefaultToBranch() → 新时间线默认使用内置文风
// · 用户手动选择空白默认后，会写入 _presetExplicitDefault=true，之后不再自动绑定
cbyd21_Fate._applyBuiltinPresetDefaultToBranch=function(){
  var branch=this._getCurrentBranch ? this._getCurrentBranch() : null;
  if(!branch)return;

  if(branch._presetId)return;
  if(branch._presetExplicitDefault)return;
  if(localStorage.getItem('stm_fateBuiltinPresetDeleted_humid_tides')==='1')return;

  var preset=(this._presets||[]).find(function(p){
    return p && (
      p.id==='builtin_humid_tides' ||
      p.name==='溽热潮汐'
    );
  });

  if(!preset)return;

  branch._presetId=preset.id;
  branch._presetExplicitDefault=false;
  this._save();
};

// 打开预设编辑页
cbyd21_Fate.openPresetEditor=function(){
  var self=this;

  this._ensureBuiltinPresets().then(function(){
    self._applyBuiltinPresetDefaultToBranch();
    self._renderPresetList();

    var branch=self._getCurrentBranch();
    if(branch&&branch._presetId){
      var preset=self._presets.find(function(p){return p.id===branch._presetId});
      if(preset){
        document.getElementById('fatePresetName').value=preset.name||'';
        document.getElementById('fatePresetPrompt').value=preset.prompt||'';
        document.getElementById('fatePresetWcMin').value=preset.wcMin||'';
        document.getElementById('fatePresetWcMax').value=preset.wcMax||'';

        var sel=document.getElementById('fatePresetSelect');
        if(sel){
          for(var i=0;i<sel.options.length;i++){
            if(sel.options[i].value===preset.id){
              sel.selectedIndex=i;
              break;
            }
          }
        }
      }
    }
  });

  _pushInnerPageState('fatePresetPage');
  var _fateStreamEl=document.getElementById('fateStreamToggle');
  if(_fateStreamEl){var _fb=this._getCurrentBranch();_fateStreamEl.checked=_fb&&_fb._streamMode||false}
  var page=document.getElementById('fatePresetPage');
  page.classList.add('active');
  this._renderPresetList();
  var branch=this._getCurrentBranch();
  if(branch&&branch._presetId){
    var preset=this._presets.find(function(p){return p.id===branch._presetId});
    if(preset){
      document.getElementById('fatePresetName').value=preset.name||'';
      document.getElementById('fatePresetPrompt').value=preset.prompt||'';
      document.getElementById('fatePresetWcMin').value=preset.wcMin||'';
      document.getElementById('fatePresetWcMax').value=preset.wcMax||'';
      var sel=document.getElementById('fatePresetSelect');
      for(var i=0;i<sel.options.length;i++){
        if(sel.options[i].value===preset.id){sel.selectedIndex=i;break}
      }
      return;
    }
  }
  document.getElementById('fatePresetName').value='';
  document.getElementById('fatePresetPrompt').value='';
  document.getElementById('fatePresetWcMin').value='';
  document.getElementById('fatePresetWcMax').value='';
};

// 关闭预设编辑页
cbyd21_Fate.closePresetEditor=function(fromPopstate){
  document.getElementById('fatePresetPage').classList.remove('active');
  document.getElementById('fatePresetName').value='';
  document.getElementById('fatePresetPrompt').value='';
  document.getElementById('fatePresetWcMin').value='';
  document.getElementById('fatePresetWcMax').value='';
  var sel=document.getElementById('fatePresetSelect');
  if(sel)sel.selectedIndex=0;
  _backFromInnerPage(fromPopstate);
};

// 渲染预设下拉列表
cbyd21_Fate._renderPresetList=function(){
  var sel=document.getElementById('fatePresetSelect');
  sel.innerHTML='<option value="">— 选择预设 —</option>';
  this._presets.forEach(function(p){
    var opt=document.createElement('option');
    opt.value=p.id;
    opt.textContent=p.name||'未命名';
    sel.appendChild(opt);
  });
};

// 从下拉列表加载选中的预设到编辑框
cbyd21_Fate.loadPresetFromSelect=function(){
  var sel=document.getElementById('fatePresetSelect');
  var id=sel.value;
  if(!id){
    document.getElementById('fatePresetName').value='';
    document.getElementById('fatePresetPrompt').value='';
    document.getElementById('fatePresetWcMin').value='';
    document.getElementById('fatePresetWcMax').value='';
    var branch=this._getCurrentBranch();
    if(branch){
      branch._presetId=null;
      branch._presetExplicitDefault=true;
      this._save();
    }
    showToast('已恢复默认（不使用预设）');
    return;
  }
  var preset=this._presets.find(function(p){return p.id===id});
  if(!preset)return;
  document.getElementById('fatePresetName').value=preset.name||'';
  document.getElementById('fatePresetPrompt').value=preset.prompt||'';
  document.getElementById('fatePresetWcMin').value=preset.wcMin||'';
  document.getElementById('fatePresetWcMax').value=preset.wcMax||'';
  showToast('预设已加载');
};

// 保存预设（同名覆盖，新名新建）
cbyd21_Fate.savePreset=function(){
  var name=document.getElementById('fatePresetName').value.trim();
  var prompt=document.getElementById('fatePresetPrompt').value;
  var wcMin=parseInt(document.getElementById('fatePresetWcMin').value)||0;
  var wcMax=parseInt(document.getElementById('fatePresetWcMax').value)||0;
  if(!name){showToast('请输入预设名称');return}
  var existing=this._presets.find(function(p){return p.name===name});
  if(existing){
    existing.prompt=prompt;
    existing.wcMin=wcMin;
    existing.wcMax=wcMax;
  }else{
    var preset={id:Date.now().toString(),name:name,prompt:prompt,wcMin:wcMin,wcMax:wcMax};
    this._presets.push(preset);
    existing=preset;
  }
  localStorage.setItem('stm_fatePresets',JSON.stringify(this._presets));
  // 绑定预设到当前分支
  var branch=this._getCurrentBranch();
  if(branch){
    branch._presetId=existing.id;
    branch._presetExplicitDefault=false;
    branch._wordCountMin=wcMin||300;
    branch._wordCountMax=wcMax||600;
    this._save();
  }
  this._renderPresetList();
  this.closePresetEditor();
  showToast('预设已保存');
};

// 另存为新预设
cbyd21_Fate.savePresetAs=function(){
  var name=document.getElementById('fatePresetName').value.trim();
  if(!name){
    name=prompt('输入预设名称：');
    if(!name||!name.trim())return;
    name=name.trim();
    document.getElementById('fatePresetName').value=name;
  }
  this.savePreset();
};

// 删除选中的预设
cbyd21_Fate.deletePreset=async function(){
  var sel=document.getElementById('fatePresetSelect');
  var id=sel.value;
  if(!id){showToast('请先选择预设');return}
  var preset=this._presets.find(function(p){return p.id===id});
  var _yes=await customConfirm('确认删除预设「'+(preset?preset.name:'')+'」？');
  if(!_yes)return;

  if(
    id==='builtin_humid_tides' ||
    (preset && preset.name==='溽热潮汐')
  ){
    localStorage.setItem('stm_fateBuiltinPresetDeleted_humid_tides','1');
  }

  this._presets=this._presets.filter(function(p){return p.id!==id});
  localStorage.setItem('stm_fatePresets',JSON.stringify(this._presets));
  this._renderPresetList();
  document.getElementById('fatePresetName').value='';
  document.getElementById('fatePresetPrompt').value='';
  document.getElementById('fatePresetWcMin').value='';
  document.getElementById('fatePresetWcMax').value='';
  showToast('预设已删除');
};

// ============ 自定义输入回车发送 ============
document.addEventListener('DOMContentLoaded',function(){
  var scrollEl=document.getElementById('fateStoryScroll');

  if(scrollEl && !scrollEl._fateStreamScrollLockBound){
    scrollEl._fateStreamScrollLockBound = true;

    scrollEl.addEventListener('scroll',function(){
      if(cbyd21_Fate._generating && cbyd21_Fate._updateStreamAutoScrollLock){
        cbyd21_Fate._updateStreamAutoScrollLock();
      }
    },{passive:true});
  }

  var inp=document.getElementById('fateCustomInput');
  if(inp){
    inp.addEventListener('keydown',function(e){
      if(e.isComposing || e.keyCode === 229)return;

      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        cbyd21_Fate.sendCustomAction();
      }
    });
  }
});

// 浮生逆笔：小窗 / 切后台 / pagehide 时不再主动终止生成。
// 说明：
// · 安卓小窗或 PWA 后台可运行时，浮生逆笔生成应继续进行。
// · 如果系统自己冻结/中断网络，已有异常分支会尽量保留已生成内容。
// · 前端不主动 abort，也不自动重试。

// _forcePersistFateStreamProgress()
 // → 页面隐藏 / pagehide / 刷新前强制保存浮生逆笔流式半截内容。
 // 说明：
 // · 不主动 abort；
 // · 不自动重试；
 // · 只把当前已经生成到内存里的半截剧情写入当前时间线；
 // · 解决 iOS/PWA/安卓小窗退后台后，DOM 里有内容但分支还没落盘导致回来内容消失的问题。
function _forcePersistFateStreamProgress(){
  try{
    if(
      cbyd21_Fate &&
      cbyd21_Fate._streamTempIdx !== null &&
      cbyd21_Fate._streamTempIdx !== undefined &&
      cbyd21_Fate._streamTempIdx >= 0
    ){
      var msg = cbyd21_Fate._messages && cbyd21_Fate._messages[cbyd21_Fate._streamTempIdx];

      if(msg){
        cbyd21_Fate._persistStreamTemp(msg.content || '', true);
      }
    }

    if(cbyd21_Fate._charId && typeof cbyd21_Fate._save === 'function'){
      cbyd21_Fate._save();
    }
  }catch(e){}
}

window.addEventListener('pagehide', function(){
  _forcePersistFateStreamProgress();
});

document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'hidden'){
    _forcePersistFateStreamProgress();
  }
});

// 数据保护：页面关闭/刷新时自动保存浮生逆笔数据
window.addEventListener('beforeunload', function() {
  if(typeof _cbyd21ClearingAllData !== 'undefined' && _cbyd21ClearingAllData)return;
  if (cbyd21_Fate._charId && cbyd21_Fate._messages && cbyd21_Fate._messages.length > 0) {
    cbyd21_Fate._save();
  }
});
