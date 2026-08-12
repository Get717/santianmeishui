// ===== 【模块】cbyd21_Group — 群聊系统 =====
// 群聊功能：创建群聊、选成员、群聊天、多角色轮流回复
// 依赖主文件全局函数：getCharById, getCurrentProfile, escHtml,
//   showToast, apiConfig, characters, activeChats, chats,
//   customConfirm, formatTime, openModal, closeModal,
//   openTextInputModal, cbyd21_Data, DEFAULT_CHAR_ID,
//   getFilteredMemories, collectActiveWorldBook, applyRegexRules,
//   modePrompts, processContent, scrollToBottom, _fallbackCopy,
//   _getBranchDisplayName, charMemories, charMemorySettings,
//   getCharMountedStickers, getAllStickers

function cbyd21_Group_safeJson(key, fallback){
  try{
    var raw = localStorage.getItem(key);

    if(raw === null || raw === undefined || raw === ''){
      return fallback;
    }

    return JSON.parse(raw);
  }catch(e){
    console.warn('群聊模块 localStorage JSON 解析失败：', key, e);

    // 不直接删除坏数据，先备份，避免误伤。
    try{
      localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
    }catch(_e){}

    return fallback;
  }
}

var cbyd21_Group = {
  _groups: cbyd21_Group_safeJson('stm_groupChats', []),
  _currentGroupId: null,
  _currentBranchIdx: 0,
  _messages: [],
  _generating: false,
  _abortController: null,

  // ============ 数据存取 ============

  // _recoverPersistentStorage()
  // → 从 IndexedDB / localStorage 中恢复群聊大数据。
  // 说明：
  // · groupChats 包含普通群聊分支，也包含群聊线下 _offlineSessions。
  // · 新版会把完整数据优先存到 IndexedDB。
  // · localStorage 可能只保存 meta 或小数据镜像。
  // · 恢复时不裁剪、不删除用户数据。
  _recoverPersistentStorage:async function(){
    try{
      if(typeof _cbyd21RecoverLargeModuleData !== 'function')return;

      var recovered = await _cbyd21RecoverLargeModuleData(
        'groupChats',
        'stm_groupChats',
        'stm_groupChatsMeta',
        this._groups || []
      );

      if(Array.isArray(recovered)){
        this._groups = recovered;
      }
    }catch(e){
      console.warn('群聊大数据恢复失败：', e);
    }
  },

  // _save()
  // → 保存群聊数据。
  // 保存策略：
  // · 完整数据优先写 IndexedDB。
  // · 数据较小时保留 localStorage 完整镜像。
  // · 数据较大时 localStorage 只留 meta，避免占满本地存储。
  _save:function(){
    var group = this._getCurrentGroup();

    if(group){
      var branch = this._getCurrentBranch();

      if(branch)branch.messages = this._messages;
    }

    if(typeof _cbyd21PersistLargeModuleData === 'function'){
      // 返回 Promise，方便导入、退出、线下群聊等关键路径等待 groupChats 真正落盘。
      return _cbyd21PersistLargeModuleData(
        'groupChats',
        'stm_groupChats',
        'stm_groupChatsMeta',
        this._groups || []
      ).then(function(res){
        if(!res || !res.ok){
          console.warn('群聊数据持久化失败');
          if(typeof showToast === 'function')showToast('群聊数据保存异常，请尽快导出备份');
        }

        return res;
      }).catch(function(e){
        console.warn('群聊数据持久化异常：', e);
        if(typeof showToast === 'function')showToast('群聊数据保存异常，请尽快导出备份');

        return {
          ok:false,
          error:e
        };
      });
    }

    try{
      localStorage.setItem('stm_groupChats', JSON.stringify(this._groups || []));

      return Promise.resolve({
        ok:true,
        localOnly:true
      });
    }catch(e){
      console.warn('群聊 localStorage 保存失败：', e);
      if(typeof showToast === 'function')showToast('群聊数据保存异常，请尽快导出备份');

      return Promise.resolve({
        ok:false,
        error:e
      });
    }
  },

  // 获取当前群聊对象
  _getCurrentGroup: function() {
    var self = this;
    return this._groups.find(function(g) { return g.id === self._currentGroupId; }) || null;
  },

  // 获取当前分支
  _getCurrentBranch: function() {
    var group = this._getCurrentGroup();
    if (!group || !group.branches) return null;
    return group.branches[this._currentBranchIdx] || null;
  },

  // _cleanupGroupMemoryData(groupId) → 删除群聊时清理对应记忆和总结栈
  _cleanupGroupMemoryData: function(groupId) {
    var memKey = 'group_' + groupId;

    if (typeof charMemories !== 'undefined' && charMemories[memKey]) {
      delete charMemories[memKey];
      cbyd21_Data.saveMemories();
    }

    if (typeof charMemorySettings !== 'undefined' && charMemorySettings[memKey]) {
      delete charMemorySettings[memKey];
      cbyd21_Data.saveMemorySettings();
    }

    localStorage.removeItem('stm_summaryStack_' + memKey);
    localStorage.removeItem('stm_offlineWp_' + memKey);

    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('stm_lastSummaryRounds_' + memKey + '_') === 0) {
        keys.push(k);
      }
    }
    keys.forEach(function(k) { localStorage.removeItem(k); });
  },

  // ============ 创建群聊 ============

  // 打开创建群聊面板（成员选择）
  openCreateGroup: function() {
    var charList = characters.filter(function(c) {
      return c.id !== DEFAULT_CHAR_ID && activeChats.indexOf(c.id) >= 0;
    });
    if (charList.length === 0) {
      showToast('消息列表里还没有角色，先添加角色');
      return;
    }

    var container = document.getElementById('addCharList');
    container.innerHTML = '';

    // 顶部说明
    var hint = document.createElement('div');
    hint.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
    hint.innerHTML = '<div style="font-weight:600;margin-bottom:4px">创建群聊</div><div style="font-size:11px;color:var(--text-muted)">勾选要加入群聊的角色（至少1个）</div>';
    container.appendChild(hint);

    // 角色列表（带复选框）
    charList.forEach(function(ch) {
      var avatarHtml = ch.avatar ? '<img src="' + ch.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : escHtml(ch.name.charAt(0));
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '12px 16px';
      div.innerHTML = '<label class="toggle-switch toggle-sm" style="pointer-events:none;flex-shrink:0"><input type="checkbox" class="group-create-cb" data-charid="' + ch.id + '"><span class="toggle-slider"></span></label>' +
        '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-tertiary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:14px;color:var(--accent)">' + avatarHtml + '</div>' +
        '<div style="flex:1;font-size:14px;color:var(--text-primary)">' + escHtml(ch.name) + '</div>';
      div.onclick = function() {
        var cb = this.querySelector('.group-create-cb');

        if (!cb.checked) {
          var checkedCount = document.querySelectorAll('.group-create-cb:checked').length;
          if (checkedCount >= 15) {
            showToast('群聊最多添加15个角色');
            return;
          }
        }

        cb.checked = !cb.checked;
      };
      container.appendChild(div);
    });

    // 底部按钮
    var btnDiv = document.createElement('div');
    btnDiv.style.cssText = 'padding:12px 16px;border-top:1px solid var(--border-soft);display:flex;gap:8px';
    btnDiv.innerHTML = '<button class="btn" onclick="closeModal(\'addCharModal\')" style="flex:1">取消</button><button class="btn primary" onclick="cbyd21_Group._doCreateGroup()" style="flex:1">创建</button>';
    container.appendChild(btnDiv);

    document.getElementById('addCharModal').querySelector('h3').textContent = '创建群聊';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 执行创建
  _doCreateGroup: function() {
    var checked = document.querySelectorAll('.group-create-cb:checked');
    if (checked.length === 0) { showToast('至少选择1个角色'); return; }
    if (checked.length > 15) { showToast('群聊最多添加15个角色'); return; }
    var memberIds = [];
    checked.forEach(function(cb) { memberIds.push(cb.dataset.charid); });
    closeModal('addCharModal');

    // 自动生成群名
    var names = memberIds.map(function(id) { var ch = getCharById(id); return ch ? ch.name : '?'; });
    var groupName = names.join('、');
    if (groupName.length > 15) groupName = names.slice(0, 2).join('、') + '等' + names.length + '人';

    var _initialBranchId = Date.now().toString();
    var group = {
      id: 'group_' + Date.now(),
      name: groupName,
      memberIds: memberIds,
      branches: [{
        id: _initialBranchId,
        title: '分支1',
        messages: [],
        created: Date.now()
      }],
      created: Date.now(),
      _lastBranchId: _initialBranchId,
      _replyMin: 1,
      _replyMax: 2,
      _contextRounds: 10
    };

    this._groups.unshift(group);
    this._save();
    cbyd21_UI.renderMsgList();
    showToast('群聊「' + groupName + '」已创建');
  },

  // ============ 消息列表渲染 ============

  // 在消息列表里渲染群聊项
  renderGroupItem: function(group) {
    var lastMsg = '还没有消息';
    var lastTime = '';
    var _lastIdx = group._lastBranchId && group.branches ? group.branches.findIndex(function(b) { return b.id === group._lastBranchId; }) : -1;
    var branch = group.branches && (_lastIdx >= 0 ? group.branches[_lastIdx] : group.branches[0]);
    if (branch && branch.messages.length > 0) {
      var lastVisible = cbyd21_UI.getLastVisibleMsgForPreview
        ? cbyd21_UI.getLastVisibleMsgForPreview(branch.messages)
        : null;

      if (lastVisible) {
        var m = lastVisible.msg;

        if (m.role === 'ai' && m._charId) {
          var ch = getCharById(m._charId);
          lastMsg = (ch ? ch.name : '?') + '：' + lastVisible.preview;
        } else {
          lastMsg = lastVisible.preview;
        }

        lastTime = m.time || '';
      }
    }

    // 自定义群头像优先，没有则拼接成员头像
    if (group._avatar) {
      var avatarHtml = '<img src="' + group._avatar + '" style="width:46px;height:46px;object-fit:cover;border-radius:50%">';
    } else {
    var avatarHtml = '<div class="group-avatar-grid">';
    var showMembers = group.memberIds.slice(0, 4);
    showMembers.forEach(function(id) {
      var ch = getCharById(id);
      if (ch && ch.avatar) {
        avatarHtml += '<div class="group-avatar-cell"><img src="' + ch.avatar + '"></div>';
      } else {
        avatarHtml += '<div class="group-avatar-cell">' + escHtml(ch ? ch.name.charAt(0) : '?') + '</div>';
      }
    });
    avatarHtml += '</div>';
    } // 关闭 else 分支

    var div = document.createElement('div');
    div.className = 'msg-list-item';
    div.innerHTML = '<div class="msg-list-avatar" style="padding:0;overflow:visible">' + avatarHtml + '</div>' +
      '<div class="msg-list-info"><div class="msg-list-name">' + escHtml(group.name) + '</div><div class="msg-list-preview">' + escHtml(lastMsg) + '</div></div>' +
      '<div class="msg-list-meta"><span class="msg-list-time">' + lastTime + '</span></div>';
    div.onclick = function() { cbyd21_Group.enterGroupChat(group.id); };

    // 长按删除
    var _gpt = null;
    div.addEventListener('touchstart', function() {
      var _gid = group.id;
      _gpt = setTimeout(function() { cbyd21_Group._longPressGroup(_gid); }, 800);
    }, { passive: true });
    div.addEventListener('touchend', function() { clearTimeout(_gpt); });
    div.addEventListener('touchmove', function() { clearTimeout(_gpt); });

    return div;
  },

  // 长按群聊弹出操作
  _longPressGroup: async function(groupId) {
    var group = this._groups.find(function(g) { return g.id === groupId; });
    if (!group) return;
    var _yes = await customConfirm('确认删除群聊「' + group.name + '」及所有聊天记录？');
    if (!_yes) return;
    this._cleanupGroupMemoryData(groupId);
    this._groups = this._groups.filter(function(g) { return g.id !== groupId; });
    this._save();
    cbyd21_UI.renderMsgList();
    showToast('群聊已删除');
  },

  // ============ 进入群聊 ============

  // 进入群聊界面
  enterGroupChat: function(groupId) {
    var group = this._groups.find(function(g) { return g.id === groupId; });

    if(this._generating && this._abortController){
      this._abortController.abort();
      this._abortController = null;
      this._generating = false;
    }

    if (!group) return;

    this._currentGroupId = groupId;
    //恢复上次使用的分支
    var _lastBid = group._lastBranchId;
    var _lastIdx = _lastBid ? group.branches.findIndex(function(b) { return b.id === _lastBid; }) : -1;
    this._currentBranchIdx = _lastIdx >= 0 ? _lastIdx : 0;
    this._messages = group.branches[this._currentBranchIdx].messages;
    group._lastBranchId = group.branches[this._currentBranchIdx].id;

    // 进入群聊时会更新 group._lastBranchId。
    // groupChats 属于大数据模块，统一走 _save()，避免直接写完整 localStorage。
    this._save();

    // 更新聊天界面顶栏
    var memberNames = group.memberIds.map(function(id) { var ch = getCharById(id); return ch ? ch.name : '?'; }).join('、');
    document.getElementById('chatCharName').textContent = group.name;
    document.getElementById('chatStatus').textContent = group.memberIds.length + '位成员 · ' + memberNames;

    // 群头像
    var avatarEl = document.getElementById('chatAvatar');
    avatarEl.innerHTML = '<span class="avatar-text" style="font-size:14px">👥</span>';

    // 欢迎页头像
    var welcomeAv = document.getElementById('welcomeAvatar');
    if (group._avatar) {
      welcomeAv.innerHTML = '<img src="' + group._avatar + '">';
    } else {
      welcomeAv.innerHTML = '<span class="avatar-text" style="font-size:20px">👥</span>';
    }
    welcomeAv.onclick = null;

    // 欢迎页
    document.getElementById('welcomeCharName').textContent = group.name;
    document.getElementById('welcomeSubtitle').textContent = '';
    document.getElementById('welcomeGreeting').innerHTML = '群聊成员：' + escHtml(memberNames) + '<br>开始群聊吧！';
    document.getElementById('welcomeQuickActions').style.display = 'none';

    // 侧边栏标题
    document.getElementById('sidebarCharName').textContent = group.name + ' · 分支';

    // 清除上一个角色残留的美化设置（群聊没有独立美化）
    applyChatWallpaper(null);
    document.getElementById('chatCustomStyle').textContent = '';
    _applyBubbleTextColor('');
    document.documentElement.style.removeProperty('--chat-avatar-size');
    document.documentElement.style.removeProperty('--chat-font-size');

    // 加载群聊自定义CSS美化
    if (group._chatCustomCss) {
      document.getElementById('chatCustomStyle').textContent = group._chatCustomCss;
    }

    // 群聊自定义头像
    if (group._avatar) {
      avatarEl.innerHTML = '<img src="' + group._avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    }

    // 隐藏不适用的加号面板项
    document.querySelectorAll('#plusPanel .plus-item').forEach(function(item) {
      var label = item.querySelector('.plus-label');
      if (!label) return;
      var t = label.textContent.trim();
      if (t === '通话' || t === '定位') { item.style.display = 'none'; }
      else { item.style.display = ''; }
    });
    document.querySelectorAll('#plusPanel .plus-item[data-writecard-only]').forEach(function(item) { item.style.display = 'none'; });

    var inp = document.getElementById('msgInput');
    if (inp) inp.placeholder = '₍ᐢ..ᐢ₎♡…';

    this._renderGroupMessages();
    this._renderGroupBranchList();

    document.getElementById('chatTabView').classList.add('hidden');
    document.getElementById('chatView').classList.add('active');
    document.getElementById('chatView').dataset.groupMode = 'true';
    history.pushState({ groupChat: true }, '');
    updateSnowVisibility();
  },

  // 退出群聊（由 exitChatView 调用）
  exitGroupChat: function() {
    this._currentGroupId = null;
    if(this._generating && this._abortController){
      this._abortController.abort();
      this._abortController = null;
      this._generating = false;
    }

    this._messages = [];
    var chatView = document.getElementById('chatView');
    if (chatView) delete chatView.dataset.groupMode;
    // 清除群聊CSS美化
    document.getElementById('chatCustomStyle').textContent = '';
    var _statusClean = document.getElementById('chatStatus');
    if (_statusClean && _statusClean.dataset.originalText) {
      _statusClean.textContent = _statusClean.dataset.originalText;
      _statusClean.style.color = '';
      delete _statusClean.dataset.originalText;
    }
  },

  // ============ 消息渲染 ============

  // 渲染群聊消息
  _renderGroupMessages: function() {
    var c = document.getElementById('chatContainer');
    c.querySelectorAll('.message:not(.typing-indicator)').forEach(function(m) { m.remove(); });
    if (!this._messages || this._messages.length === 0) {
      document.getElementById('welcomeBlock').style.display = 'flex';
      return;
    }
    document.getElementById('welcomeBlock').style.display = 'none';
    var self = this;
    this._messages.forEach(function(m, i) {
      if (m.content === '__system_init__' || m.content === '__system_continue__') return;
      self._appendGroupMsgDOM(m, i);
    });
    scrollToBottom();
  },

  // 追加一条群聊消息到DOM
  _appendGroupMsgDOM: function(m, idx) {
    var c = document.getElementById('chatContainer');
    var d = document.createElement('div');
    d.className = 'message ' + m.role;
    d.dataset.idx = idx;

    var av, name;
    if (m.role === 'user') {
      var up = getCurrentProfile();
      av = up.avatar ? '<img src="' + up.avatar + '">' : '<span class="avatar-text">' + escHtml((up.name || '我').charAt(0)) + '</span>';
    } else {
      var ch = m._charId ? getCharById(m._charId) : null;
      av = ch && ch.avatar ? '<img src="' + ch.avatar + '">' : '<span class="avatar-text">' + escHtml(ch ? ch.name.charAt(0) : '?') + '</span>';
      name = ch ? ch.name : '?';
    }

    //用户撤回消息渲染
    if (m.content.startsWith('__user_recall__')) {
      var rName = getCurrentProfile().name || '你';
      d.innerHTML = '<input type="checkbox" class="msg-checkbox" onclick="updateSelectCount(event)"><div style="text-align:center;width:100%;padding:4px 0"><span style="font-size:11px;color:var(--text-muted);cursor:pointer;padding:4px 12px;border-radius:10px;background:var(--bg-tertiary);border:1px solid var(--border-soft)">' + escHtml(rName) + ' 撤回了一条消息</span></div>';
      d.style.justifyContent = 'center'; d.style.animation = 'none';
    }
    // AI撤回消息渲染
    else if (m.content.startsWith('__recall__')) {
      var rCh = m._charId ? getCharById(m._charId) : null;
      var rName2 = rCh ? rCh.name : '角色';
      d.innerHTML = '<input type="checkbox" class="msg-checkbox" onclick="updateSelectCount(event)"><div style="text-align:center;width:100%;padding:4px 0"><span style="font-size:11px;color:var(--text-muted);cursor:pointer;padding:4px 12px;border-radius:10px;background:var(--bg-tertiary);border:1px solid var(--border-soft)">' + escHtml(rName2) + ' 撤回了一条消息</span></div>';
      d.style.justifyContent = 'center'; d.style.animation = 'none';
    }
    // 群聊线下记录气泡：
    // 这是系统记录条，不属于某个群成员的普通发言。
    // 居中显示，点击后打开对应群聊线下历史记录。
    else if(m.content && m.content.startsWith('__offline_record__')){
      var recordHtml = '';

      try{
        recordHtml = processContent(m.content, m.role);
      }catch(renderErr){
        console.warn('群聊线下记录气泡渲染失败，已按安全文本显示：', renderErr);
        recordHtml = '<div style="white-space:pre-wrap">' + escHtml(m.content || '') + '</div>';
      }

      d.innerHTML =
        '<input type="checkbox" class="msg-checkbox" onclick="updateSelectCount(event)">' +
        '<div style="text-align:center;width:100%;padding:4px 0">' +
          recordHtml +
        '</div>';

      d.style.justifyContent = 'center';
      d.style.animation = 'none';
    }
    // 正常消息渲染
    else {
      var contentHtml = '';

      try{
        var _oldRegexRuntimeCharId = window._cbyd21RegexRuntimeCharId;

        if(m.role === 'ai' && m._charId){
          window._cbyd21RegexRuntimeCharId = m._charId;
        }

        contentHtml = processContent(m.content, m.role);

        window._cbyd21RegexRuntimeCharId = _oldRegexRuntimeCharId;
      }catch(renderErr){
        window._cbyd21RegexRuntimeCharId = _oldRegexRuntimeCharId;
        console.warn('群聊消息渲染失败，已按安全文本显示：', renderErr);

        contentHtml =
          '<div style="white-space:pre-wrap">' +
          escHtml('[前端提示：这条群聊消息格式渲染失败，已按原文显示。]\n\n' + String(m.content || '')) +
          '</div>';
      }

      var nameHtml = '';
      if (m.role === 'ai' && name) {
        nameHtml = '<div style="font-size:11px;color:var(--accent);font-weight:500;margin-bottom:2px">' + escHtml(name) + '</div>';
      }
      d.innerHTML = '<input type="checkbox" class="msg-checkbox" onclick="updateSelectCount(event)">' +
        '<div class="msg-avatar">' + av + '</div>' +
        '<div class="msg-content">' + nameHtml + '<div class="msg-bubble">' + contentHtml + '</div><div class="msg-time">' + (m.time || '') + '</div></div>';
    }

    // 标准右键/长按菜单（和单聊一致）
    var b = d.querySelector('.msg-bubble');
    if (b) {
      var pt = null;
      b.addEventListener('contextmenu', function(e) { e.preventDefault(); showContextMenu(e, idx); });
      b.addEventListener('touchstart', function(e) { pt = setTimeout(function() { showContextMenu({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, idx); }, 500); }, { passive: true });
      b.addEventListener('touchend', function() { clearTimeout(pt); });
      b.addEventListener('touchmove', function() { clearTimeout(pt); });
    }// 撤回消息也支持长按删除
    if (!b) {
      var _rpt = null;
      d.addEventListener('contextmenu', function(ev) { ev.preventDefault(); showContextMenu({ clientX: ev.clientX, clientY: ev.clientY }, idx); });
      d.addEventListener('touchstart', function(ev) { _rpt = setTimeout(function() { showContextMenu({ clientX: ev.touches[0].clientX, clientY: ev.touches[0].clientY }, idx); }, 500); }, { passive: true });
      d.addEventListener('touchend', function() { clearTimeout(_rpt); });
      d.addEventListener('touchmove', function() { clearTimeout(_rpt); });
    }

    // AI消息头像点击 → 显示心声面板（面板内按钮触发生成，不自动生成）
    if (m.role === 'ai') {
      var _gAvEl = d.querySelector('.msg-avatar');
      if (_gAvEl) {
        _gAvEl.style.cursor = 'pointer';
        (function(_idx) {
          _gAvEl.addEventListener('click', function(ev) {
            ev.stopPropagation();

            if (document.body.classList.contains('multiselect-mode')) return;

            if(typeof showInnerVoice === 'function'){
              showInnerVoice(_idx);
            }
          });
        })(idx);
      }
    }

    // 多选
    d.addEventListener('click', function() {
      if (!document.body.classList.contains('multiselect-mode')) return;
      var cb = this.querySelector('.msg-checkbox');
      if (cb) { cb.checked = !cb.checked; updateSelectCount(); }
    });

    var typingEl = document.getElementById('typingIndicator');
    if (typingEl && typingEl.parentNode === c) { c.insertBefore(d, typingEl); } else { c.appendChild(d); }
    return d;
  },

  // ============ 群聊转账辅助 ============

  _getMemberByName:function(group, name){
    name = String(name || '').trim();

    if(!group || !name)return null;

    for(var i = 0; i < group.memberIds.length; i++){
      var ch = getCharById(group.memberIds[i]);

      if(ch && ch.name === name){
        return ch;
      }
    }

    return null;
  },

  _normalizeGroupTransferPayload:function(group, senderCharId, data){
    if(!group || !data || typeof data !== 'object')return null;

    var amount = Number(data.amount);

    if(!isFinite(amount) || amount <= 0)return null;

    var sender = senderCharId ? getCharById(senderCharId) : null;

    var out = {
      amount:amount,
      note:String(data.note || '').trim(),
      from:'char',
      to:data.to === 'char' ? 'char' : 'user',
      fromCharId:sender ? sender.id : (data.fromCharId || ''),
      fromName:sender ? sender.name : (data.fromName || ''),
      transferId:data.transferId || ('gtf_' + Date.now() + '_' + Math.random().toString(36).slice(2,6))
    };

    if(out.to === 'char'){
      var target = null;

      if(data.toCharId){
        target = group.memberIds.indexOf(data.toCharId) >= 0 ? getCharById(data.toCharId) : null;
      }

      if(!target && data.toName){
        target = this._getMemberByName(group, data.toName);
      }

      if(!target || (sender && target.id === sender.id)){
        // 目标不清楚时，保守转给用户，避免群成员之间错绑。
        out.to = 'user';
      }else{
        out.toCharId = target.id;
        out.toName = target.name;
      }
    }

    return out;
  },

  _normalizeGroupTransfersInContent:function(content, group, senderCharId){
    var self = this;

    return String(content || '').replace(/__transfer__(\{[^\n]+\})/g, function(all, jsonText){
      try{
        var data = JSON.parse(jsonText);
        var fixed = self._normalizeGroupTransferPayload(group, senderCharId, data);

        if(!fixed)return all;

        return '__transfer__' + JSON.stringify(fixed);
      }catch(e){
        return all;
      }
    });
  },

  _handleGroupTransferDecision:function(charId, accept){
    if(!charId || !this._messages)return null;

    for(var i = this._messages.length - 1; i >= 0; i--){
      var m = this._messages[i];

      if(!m || m.role !== 'user' || !m.content || !m.content.startsWith('__transfer__'))continue;

      try{
        var d = JSON.parse(m.content.slice(12));

        if(d.from !== 'user')continue;
        if(d.to !== 'char')continue;
        if(d.toCharId !== charId)continue;
        if(d.status)continue;

        d.status = accept ? 'accepted' : 'rejected';
        m.content = '__transfer__' + JSON.stringify(d);

        return d;
      }catch(e){}
    }

    return null;
  },

  // ============ 发送消息 ============

  // 用户发送消息
  sendMessage: function(text) {
    if (!text || this._generating) return;
    var time = formatTime(Date.now());
    document.getElementById('welcomeBlock').style.display = 'none';
    var finalContent = text;
    if (_quoteMsg) {
      var _qPreview = cbyd21_UI.getMsgPreview(_quoteMsg.content).slice(0, 60);
      var _qName;
      if (_quoteMsg.role === 'user') { _qName = getCurrentProfile().name || '我'; }
      else {
        var _qGm = this._messages[_quoteMsg.idx];
        var _qCh = _qGm && _qGm._charId ? getCharById(_qGm._charId) : null;
        _qName = _qCh ? _qCh.name : '角色';
      }
      finalContent = '__quote__' + JSON.stringify({ name: _qName, preview: _qPreview }) + '\n' + text;
      cancelQuote();
    }
    var branch = this._getCurrentBranch ? this._getCurrentBranch() : null;
    var isOocMode = !!(branch && branch._oocMode && branch._oocMode.enabled);
    var underResult = null;

    if(isOocMode && branch && window.cbyd21_UnderMode && cbyd21_UnderMode.handleInput){
      underResult = cbyd21_UnderMode.handleInput(branch, finalContent);
    }

    this._messages.push({
      role:'user',
      content:finalContent,
      time:time,
      _ts:Date.now(),
      _mode:isOocMode ? 'ooc' : 'online'
    });
    this._appendGroupMsgDOM(this._messages[this._messages.length - 1], this._messages.length - 1);

    if(isOocMode && underResult && underResult.handled && window.cbyd21_UnderMode){
      if(underResult.notices && underResult.notices.length){
        underResult.notices.forEach(function(nt){
          cbyd21_UnderMode.appendLocalNotice(branch, nt);
        });
      }

      if(underResult.openPanel){
        setTimeout(function(){
          cbyd21_UnderMode.openRequirements();
        },80);
      }
    }

    this._save();
    scrollToBottom();
  },

  // ============ 触发AI回复（核心） ============

  // 触发群聊回复（单次API调用，所有成员一起回复）
  triggerReply: async function() {
    if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
      return;
    }

    if (this._generating) {
      if (this._abortController) { this._abortController.abort(); this._abortController = null; }
      showToast('正在终止…');
      return;
    }

    var group = this._getCurrentGroup();
    if (!group) return;
    if (!apiConfig.url || !apiConfig.key || !apiConfig.model) { showToast('请先配置API'); return; }

    // 没有消息时插入init标记；最后一条是AI时插入continue标记。
    if (this._messages.length === 0) {
      document.getElementById('welcomeBlock').style.display = 'none';
      this._messages.push({ role: 'user', content: '__system_init__', time: formatTime(Date.now()), _ts: Date.now() });
      this._save();
    } else {
      var _gLastBeforeTrigger = this._messages[this._messages.length - 1];

      if (_gLastBeforeTrigger && _gLastBeforeTrigger.role === 'ai') {
        this._messages.push({
          role: 'user',
          content: '__system_continue__',
          time: formatTime(Date.now()),
          _ts: Date.now()
        });
        this._save();
      }
    }

    this._generating = true;
    document.getElementById('sendBtn').disabled = true;

    // 显示输入中状态（修改顶栏状态文字）
    var _statusEl = document.getElementById('chatStatus');
    if (_statusEl) {
      var _speakerNames = group.memberIds.map(function(mid) { var mc = getCharById(mid); return mc ? mc.name : '?'; }).join('、');
      _statusEl.dataset.originalText = _statusEl.textContent;
      _statusEl.textContent = _speakerNames + ' 输入中…';
      _statusEl.style.color = 'var(--accent)';
    }
    scrollToBottom();

    try {
      var req = this._buildGroupRequest(group);
      this._abortController = new AbortController();
      var r = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: this._abortController.signal });
      var _rawGroupApiText = await r.text();

      if(!r.ok){
        var _groupErrParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
          ? _cbyd21ParseChatApiResponseText(_rawGroupApiText)
          : {data:null,text:''};

        var _groupErrText = String(_groupErrParsed.text || '').trim();

        if(!_groupErrText && _groupErrParsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
          _groupErrText = String(_cbyd21ExtractChatApiContent(_groupErrParsed.data) || '').trim();
        }

        var _groupErrLooksLikeOnlyError =
          /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(_groupErrText) ||
          (
            _groupErrText.length < 30 &&
            /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(_groupErrText)
          );

        if(_groupErrText && _groupErrText.length >= 10 && !_groupErrLooksLikeOnlyError){
          console.warn('群聊 HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常回复处理');
        }else{
          throw new Error('HTTP ' + r.status + ': ' + _rawGroupApiText.slice(0, 300));
        }
      }
      var _parsedGroupApiText = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawGroupApiText)
        : { data:null, text:_rawGroupApiText };

      var d = _parsedGroupApiText.data || {};
      var reply = _parsedGroupApiText.text || (
        typeof _cbyd21ExtractChatApiContent === 'function'
          ? _cbyd21ExtractChatApiContent(d)
          : (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '')
      );

      if(!reply && _rawGroupApiText && String(_rawGroupApiText).trim()){
        reply =
          '[前端提示：群聊 API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
          String(_rawGroupApiText || '').trim();
      }

      reply = String(reply || '').trim();
      // 过滤token统计
      reply = reply.replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/, '').replace(/\n*<<<[A-Z_]+[\s\S]*$/, '').trim();
      if(typeof _stripLeakedThinking==='function') reply=_stripLeakedThinking(reply);
      if (!reply) reply = '……';

      var _groupMsgCountBeforeParse = this._messages.length;
      var _groupBranchForMode = this._getCurrentBranch ? this._getCurrentBranch() : null;
      var _groupOocMode = !!(_groupBranchForMode && _groupBranchForMode._oocMode && _groupBranchForMode._oocMode.enabled);

      if(_groupOocMode){
        this._messages.push({
          role:'ai',
          content:String(reply || '（空）').trim() || '（空）',
          time:formatTime(Date.now()),
          _charId:group.memberIds && group.memberIds[0] ? group.memberIds[0] : null,
          _ts:Date.now(),
          _mode:'ooc'
        });

        this._cleanupTailTriggerMarkers();
        this._save();
      }else try{
        this._parseGroupReply(reply, group);
        this._cleanupTailTriggerMarkers();
        this._save();
      }catch(parseErr){
        console.warn('群聊回复已返回，但前端格式解析失败，已按原文保存：', parseErr);

        this._messages = this._messages.slice(0, _groupMsgCountBeforeParse);

        var _safeGroupRawReply = '[前端提示：群聊回复已返回，但格式解析失败，以下为模型原始回复。]\n\n' + String(reply || '……')
          .replace(/__/g, '＿')
          .replace(/</g, '＜')
          .replace(/>/g, '＞');

        this._messages.push({
          role:'ai',
          content:_safeGroupRawReply,
          time:formatTime(Date.now()),
          _charId:group.memberIds && group.memberIds[0] ? group.memberIds[0] : null,
          _ts:Date.now(),
          _rawApiReply:String(reply || ''),
          _frontendParseError:String(parseErr && parseErr.message || parseErr || '')
        });

        this._cleanupTailTriggerMarkers();
        this._save();
        showToast('群聊回复已返回，前端格式解析失败，已按原文保存');
      }
    } catch (e) {
      // 请求失败或被中断时，清理本轮临时系统触发标记。
      // 避免 __system_init__ / __system_continue__ 残留在消息尾部，影响之后重新生成或触发。
      var _gTail = this._messages[this._messages.length - 1];
      if (_gTail && (_gTail.content === '__system_init__' || _gTail.content === '__system_continue__')) {
        this._messages.pop();
        this._save();
      }

      if (e.name === 'AbortError') {
        showToast('已终止生成');
      } else {
        var em = e.message || '';
        showApiError(em);
      }
    }


    this._abortController = null;
    var _statusEl2 = document.getElementById('chatStatus');
    if (_statusEl2&& _statusEl2.dataset.originalText) {
      _statusEl2.textContent = _statusEl2.dataset.originalText;
      _statusEl2.style.color = '';delete _statusEl2.dataset.originalText;
    }
    this._generating = false;
    document.getElementById('sendBtn').disabled = false;
    this._renderGroupMessages();
    scrollToBottom();

    // 群聊线上记忆自动总结
    if (group) this._checkGroupAutoSummary(group);
  },

  // 解析一次API返回的多角色回复，拆分成各角色的消息
  _parseGroupReply: function(reply, group) {
    if(typeof _stripLeakedThinking==='function') reply=_stripLeakedThinking(reply);

    var _groupStickers = this._getMountedStickers(group);

    if(_groupStickers.length > 0 && reply){
      reply = reply.replace(/__sticker____sticker_id_(\d+)__/g, function(m, idx){
        var i = parseInt(idx, 10);
        return _groupStickers[i] ? '__sticker__' + _groupStickers[i].url : m;
      });

      reply = reply.replace(/__sticker_id_(\d+)__/g, function(m, idx){
        var i = parseInt(idx, 10);
        return _groupStickers[i] ? '__sticker__' + _groupStickers[i].url : m;
      });

      reply = reply.replace(/__sticker__([^\n]+)/g, function(m, val){
        val = String(val || '').trim();

        if(
          val.startsWith('data:') ||
          val.startsWith('http') ||
          val.startsWith('//') ||
          val.startsWith('stk_') ||
          val.startsWith('img_')
        ){
          return m;
        }

        var bestMatch = null;
        var bestScore = 0;
        var needle = val.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g,'');

        if(!needle)return m;

        for(var si = 0; si < _groupStickers.length; si++){
          if(!_groupStickers[si].desc)continue;

          var desc = String(_groupStickers[si].desc || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g,'');

          if(!desc)continue;

          if(desc.indexOf(needle) >= 0 || needle.indexOf(desc) >= 0){
            bestMatch = _groupStickers[si];
            bestScore = 1;
            break;
          }

          var overlap = 0;

          for(var ci = 0; ci < needle.length; ci++){
            if(desc.indexOf(needle[ci]) >= 0)overlap++;
          }

          var score = overlap / needle.length;

          if(score > bestScore){
            bestScore = score;
            bestMatch = _groupStickers[si];
          }
        }

        if(bestMatch && bestScore >= 0.5){
          return '__sticker__' + bestMatch.url;
        }

        return m;
      });
    }

    var time = formatTime(Date.now());
    var userName = getCurrentProfile().name || '用户';

    // 构建角色名→ID的映射
    var nameToId = {};
    group.memberIds.forEach(function(mid) {
      var mc = getCharById(mid);
      if (mc) nameToId[mc.name] = mid;
    });

    // 构建匹配所有角色名的正则
    var allCharNames = group.memberIds.map(function(mid) {
      var mc = getCharById(mid);
      return mc ? mc.name : null;
    }).filter(Boolean).sort(function(a, b) {
      return b.length - a.length;
    }).map(function(name) {
      return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

    // 匹配格式：「角色名」：内容 或 【角色名】：内容 或 [角色名]：内容 或 角色名：内容
    var namePattern = new RegExp('^[「【\\[]?(' + allCharNames.join('|') + ')[」】\\]]?[：:]\\s*(.*)$');

    // 先把 __bilingual_split__ 合并到同一行（防止AI换行输出）
    reply = reply.replace(/\n*__bilingual_split__\n*/g, '__bilingual_split__');

    // 保护功能 JSON：
    // 群聊解析器后面会按“角色名：”做行内切分。
    // 如果转账 note / 功能字段里自然出现了“角色名：”，可能把 JSON 从中间切坏。
    // 所以这里先把明确的功能标记+JSON对象临时替换成占位符，切分完成后再还原。
    var _groupTaggedJsonBlocks = [];

    function _maskGroupInlineTaggedJsonBlocks(str){
      str = String(str || '');

      var markers = [
        '__transfer__',
        '__location__',
        '__share_response__',
        '__share_invite__',
        '__offline_invite__'
      ];

      var out = '';
      var pos = 0;

      while(pos < str.length){
        var next = -1;
        var marker = '';

        for(var mi = 0; mi < markers.length; mi++){
          var found = str.indexOf(markers[mi], pos);

          if(found >= 0 && (next < 0 || found < next)){
            next = found;
            marker = markers[mi];
          }
        }

        if(next < 0){
          out += str.slice(pos);
          break;
        }

        out += str.slice(pos, next);

        var parsed = null;

        if(typeof _cbyd21ParseTaggedJsonObject === 'function'){
          parsed = _cbyd21ParseTaggedJsonObject(str.slice(next), marker);
        }

        if(!parsed || !parsed.json){
          out += str.slice(next, next + marker.length);
          pos = next + marker.length;
          continue;
        }

        var afterMarker = str.slice(next + marker.length);
        var ws = (afterMarker.match(/^\s*/) || [''])[0];
        var consumed = marker.length + ws.length + parsed.json.length;
        var fullBlock = str.slice(next, next + consumed);
        var token = '__GROUP_TAGGED_JSON_BLOCK_' + _groupTaggedJsonBlocks.length + '__';

        _groupTaggedJsonBlocks.push(fullBlock);
        out += token;
        pos = next + consumed;
      }

      return out;
    }

    reply = _maskGroupInlineTaggedJsonBlocks(reply);

    // 兼容模型把多个角色/用户发言挤在同一行的情况：
    // 例如：
    // [角色A]:内容[角色B]:内容
    // 「角色A」：内容「角色B」：内容
    // 角色A：内容用户：内容角色B：内容
    // 解析前主动在每个说话人前缀前补换行，避免整段都归到第一个角色气泡里。
    // 用户行切开后，会在下面被 userPattern 跳过，防止 AI 替用户说话。
    if(allCharNames.length > 0){
      var escapedUserNameForInline = String(userName || '用户').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var inlineSpeakerNames = allCharNames.slice();

      if(escapedUserNameForInline){
        inlineSpeakerNames.push(escapedUserNameForInline);
      }

      var inlineSpeakerPattern = new RegExp('([^\\n])([「【\\[]?(?:' + inlineSpeakerNames.join('|') + ')[」】\\]]?[：:])', 'g');

      reply = reply.replace(inlineSpeakerPattern, function(all, before, speakerTag){
        return before + '\n' + speakerTag;
      });
    }

    if(_groupTaggedJsonBlocks.length > 0){
      reply = reply.replace(/__GROUP_TAGGED_JSON_BLOCK_(\d+)__/g, function(m, n){
        var idx = parseInt(n, 10);
        return _groupTaggedJsonBlocks[idx] || m;
      });
    }

    var lines = reply.split('\n');
    var parsed = []; // [{charId, content}]
    var currentCharId = null;
    var currentContent = [];

    //逐行解析
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var match = line.match(namePattern);

      if (match) {
        // 角色名前缀优先级高于用户名前缀。
        // 这样即使用户面具名和某个群成员重名，也不会把该角色发言误判为“AI替用户说话”而跳过。
        if (currentCharId && currentContent.length > 0) {
          parsed.push({ charId: currentCharId, content: currentContent.join('\n').trim() });
          currentContent = [];
        }

        currentCharId = nameToId[match[1]] || null;

        if (match[2] && match[2].trim()) {
          currentContent.push(match[2].trim());
        }

        continue;
      }

      // 跳过用户名字开头的行（AI替用户说话）。
      // 注意：这里只处理 AI 返回内容，不会删除用户真实发出去的消息。
      var userPattern = new RegExp('^[「【\\[]?' + userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[」】\\]]?[：:]');

      if (userPattern.test(line)) {
        continue;
      }

      {
        // 不以角色名开头的行，归属当前角色
        if (currentCharId) {
          currentContent.push(line);
        } else if (parsed.length === 0 && group.memberIds.length > 0) {
          // 没有角色名前缀的第一段，分配给第一个成员
          currentCharId = group.memberIds[0];
          currentContent.push(line);
        }
      }
    }
    // 保存最后一段
    if (currentCharId && currentContent.length > 0) {
      parsed.push({ charId: currentCharId, content: currentContent.join('\n').trim() });
    }

    // 如果解析完全失败（AI没用名字前缀格式），整段分配给第一个成员
    if (parsed.length === 0 && reply.trim()) {
      parsed.push({ charId: group.memberIds[0], content: reply.trim() });
    }

    // 写入消息数组
    var self = this;
    parsed.forEach(function(p) {
      if (!p.content || !p.content.trim()) return;
      var ch = getCharById(p.charId);

      // 群聊转账处理：
      // · 当前角色主动转账：补全 fromCharId/fromName/to
      // · 当前角色处理用户转账：更新最近一笔“用户→当前角色”的待处理转账
      var content = p.content;

      var transferAccept = content.indexOf('__accept_transfer__') >= 0;
      var transferReject = content.indexOf('__reject_transfer__') >= 0;

      if(transferAccept || transferReject){
        var handledTransfer = self._handleGroupTransferDecision(p.charId, transferAccept);

        content = content
          .replace(/__accept_transfer__/g, '')
          .replace(/__reject_transfer__/g, '')
          .trim();

        if(handledTransfer){
          var resultData = {
            amount:Number(handledTransfer.amount || 0),
            note:handledTransfer.note || '',
            from:'result',
            to:'char',
            toCharId:p.charId,
            toName:ch ? ch.name : '',
            status:transferAccept ? 'accepted' : 'rejected',
            transferId:handledTransfer.transferId || ''
          };

          self._messages.push({
            role:'ai',
            content:'__transfer__' + JSON.stringify(resultData),
            time:time,
            _charId:p.charId,
            _ts:Date.now()
          });
        }
      }

      if(content && content.indexOf('__transfer__') >= 0){
        content = self._normalizeGroupTransfersInContent(content, group, p.charId);
      }

      if (!content || !content.trim()) return;

      // 心声提取
      var innerVoice = '';
      if (ch && ch.heartVoice !== false) {
        var iv = _extractInnerVoice(content);
        content = iv.clean;
        innerVoice = iv.voice;
      }

      // HTML / 长文保护：
      // 群聊里如果某个角色输出HTML、前端代码、长文、小剧场、代码块，
      // 不按换行拆碎，整体作为该角色的一条消息。
      var replyMax = group._replyMax || 2;
      var isProtectedPayload =
        (typeof _looksLikeHtmlPayload === 'function' && _looksLikeHtmlPayload(content)) ||
        (typeof _cbyd21LooksLikeProtectedLongPayload === 'function' && _cbyd21LooksLikeProtectedLongPayload(content));

      if (isProtectedPayload) {
        var protectedMsg = { role: 'ai', content: content.trim(), time: time, _charId: p.charId, _ts: Date.now() };
        if (innerVoice) protectedMsg._innerVoice = innerVoice;
        self._messages.push(protectedMsg);
        return;
      }

      // 按回复条数拆分
      var contentLines = content.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

      if(typeof _cbyd21JoinSplitTaggedJsonParts === 'function'){
        contentLines = _cbyd21JoinSplitTaggedJsonParts(contentLines);
      }

      if(typeof _cbyd21ExplodeInlineSpecialParts === 'function'){
        contentLines = _cbyd21ExplodeInlineSpecialParts(contentLines);
      }

      if(typeof _cbyd21MergeQuoteParts === 'function'){
        contentLines = _cbyd21MergeQuoteParts(contentLines);
      }

      var hasSpecialLines = contentLines.some(function(line){
        return typeof _cbyd21IsSpecialReplyLine === 'function' && _cbyd21IsSpecialReplyLine(line);
      });

      if(hasSpecialLines && typeof _cbyd21CapLinesPreserveSpecial === 'function'){
        var cappedSpecialLines = _cbyd21CapLinesPreserveSpecial(contentLines, replyMax);

        for(var sli = 0; sli < cappedSpecialLines.length; sli++){
          if(!cappedSpecialLines[sli])continue;

          var specialMsg = { role:'ai', content:cappedSpecialLines[sli], time:time, _charId:p.charId, _ts:Date.now() };

          if(innerVoice)specialMsg._innerVoice = innerVoice;

          self._messages.push(specialMsg);
        }

        return;
      }

      // 群聊双语兜底：
      // 如果某个成员开启双语，并且模型输出了多条双语消息，
      // 超出 replyMax 的部分使用主文件的双语横向合并封顶逻辑。
      var hasBilingualLines = contentLines.some(function(line){
        return line.indexOf('__bilingual_split__') >= 0;
      });

      if (hasBilingualLines && typeof _cbyd21CapBilingualAwareParts === 'function') {
        var cappedBiLines = _cbyd21CapBilingualAwareParts(contentLines, replyMax);

        for (var bli = 0; bli < cappedBiLines.length; bli++) {
          if (!cappedBiLines[bli]) continue;
          var biMsg = { role: 'ai', content: cappedBiLines[bli], time: time, _charId: p.charId, _ts: Date.now() };
          if (innerVoice) biMsg._innerVoice = innerVoice;
          self._messages.push(biMsg);
        }

        return;
      }

      if (replyMax <= 1 || contentLines.length <= 1) {
        var merged = contentLines.join('');
        if (!merged) return;
        var msg = { role: 'ai', content: merged, time: time, _charId: p.charId, _ts: Date.now() };
        if (innerVoice) msg._innerVoice = innerVoice;
        self._messages.push(msg);
      } else {
        // 严格尊重群聊每人 replyMax。
        // 普通非双语消息保持旧逻辑：超过上限时合并进最后一条。
        var cappedLines =
          typeof _cbyd21CapAiReplyParts === 'function'
            ? _cbyd21CapAiReplyParts(contentLines, replyMax)
            : contentLines.slice(0, replyMax);

        for (var li = 0; li < cappedLines.length; li++) {
          if (!cappedLines[li]) continue;
          var lineMsg = { role: 'ai', content: cappedLines[li], time: time, _charId: p.charId, _ts: Date.now() };
          if (innerVoice) lineMsg._innerVoice = innerVoice;
          self._messages.push(lineMsg);
        }
      }
    });

    this._save();
  },


  // ============ 构建API请求 ============

  // _getMountedStickers(group)
  // → 获取群聊挂载的表情包。
  // 群聊表情包来自群聊设置里的 _stickerGroupIds，不等同于某个单独成员的表情包。
  _getMountedStickers: function(group) {
    var result = [];

    if(!group || !group._stickerGroupIds || !Array.isArray(group._stickerGroupIds)){
      return result;
    }

    group._stickerGroupIds.forEach(function(gid){
      var sg = stickerGroups.find(function(x){
        return x && x.id === gid;
      });

      if(!sg || !Array.isArray(sg.stickers))return;

      sg.stickers.forEach(function(s){
        result.push(s);
      });
    });

    return result;
  },

  // 群聊皮下模式专用请求已拆到 js/underMode.js。
  // cbyd21_Group._buildGroupOocRequest 会由 cbyd21_UnderMode.patchGroupOocRequest() 在模块加载后覆盖。
  // group.js 不再保留旧版 OOC 请求构建，避免 OOC / 皮下文案重复和维护混乱。
  _buildGroupOocRequest:null,

  // 构建群聊请求（单次调用，所有成员一起回复）
  _buildGroupRequest: function(group) {
    var branch = this._getCurrentBranch ? this._getCurrentBranch() : null;

    if(branch && branch._oocMode && branch._oocMode.enabled && this._buildGroupOocRequest){
      return this._buildGroupOocRequest(group);
    }

    var sp = [];
    var userName = getCurrentProfile().name || '用户';
    var up = getCurrentProfile();
    var _grpWbTextParts = this._messages.filter(function(m){
      return m && m._mode !== 'ooc';
    }).map(function(m) {
      var c = m.content || '';
      if (typeof _cbyd21MessageContentForUserAction === 'function') {
        c = _cbyd21MessageContentForUserAction(c);
      }
      return c;
    });
    group.memberIds.forEach(function(mid) {
      var _mcForWbText = getCharById(mid);
      if (_mcForWbText && _mcForWbText.prompt) {
        _grpWbTextParts.push(_replaceCardVars(_mcForWbText.prompt, _mcForWbText.name || '角色', up.name || '用户'));
      }
    });
    var _wb = collectActiveWorldBook({ messages: this._messages }, false, _grpWbTextParts);
    var _grpWbText = _grpWbTextParts.join(' ').toLowerCase();

    group.memberIds.forEach(function(mid) {
      var _mcRole = getCharById(mid);
      var _mcRoleName = _mcRole ? _mcRole.name : '未知角色';
      var _mcWb = cbyd21_WorldBook.getCharData(mid);
      var _mcEntries = cbyd21_WorldBook.getAllEntries(_mcWb);
      _mcEntries.forEach(function(x) {
        if (!shouldActivateWbEntry(x, _grpWbText)) return;
        var pos = x.position || 'after_char';
        var item = {
          name: _mcRoleName + ' / ' + x.name,
          content: '【适用角色：' + _mcRoleName + '】\n以下世界书只适用于角色「' + _mcRoleName + '」。群聊中其他角色不能套用这条设定、说话方式、背景或关系。\n\n' + x.content,
          depth: x.depth || 4
        };
        if (pos === 'system_start') _wb.system_start.push(item);
        else if (pos === 'user_start') _wb.user_start.push(item);
        else if (pos === 'before_char') _wb.before_char.push(item);
        else if (pos === 'system_end') _wb.system_end.push(item);
        else if (pos === 'depth') _wb.depth.push(item);
        else _wb.after_char.push(item);
      });
    });

    if (group._worldBook) {
      var _gwb = cbyd21_WorldBook.migrate(group._worldBook);
      var _gwbAll = cbyd21_WorldBook.getAllEntries(_gwb);
      var _gwbText = _grpWbText;
      _gwbAll.forEach(function(x) {
        if (!shouldActivateWbEntry(x, _gwbText)) return;
        var pos = x.position || 'after_char';
        var item = {
          name: '群聊 / ' + x.name,
          content: '【适用范围：当前群聊整体】\n以下世界书适用于当前群聊的共同背景、群体关系或共享场景，不是某个单独角色的专属人设。\n\n' + x.content,
          depth: x.depth || 4
        };
        if (pos === 'system_start') _wb.system_start.push(item);
        else if (pos === 'user_start') _wb.user_start.push(item);
        else if (pos === 'before_char') _wb.before_char.push(item);
        else if (pos === 'system_end') _wb.system_end.push(item);
        else if (pos === 'depth') _wb.depth.push(item);
        else _wb.after_char.push(item);
      });
    }

    if (_wb.system_start && _wb.system_start.length > 0) {
      sp.push('[最高优先级强制指令 — 最前]\n' + _wb.system_start.map(function(w) { return '[' + w.name + ']\n' + w.content; }).join('\n\n'));
    }

    if (_wb.before_char.length > 0) sp.push('[World Book — 世界背景]\n' + _wb.before_char.map(function(w) { return '[' + w.name + ']\n' + w.content; }).join('\n\n'));

    // 注入所有成员的完整人设
    group.memberIds.forEach(function(mid) {
      var mc = getCharById(mid);
      if (!mc) return;

      var _memberPromptMissing = typeof _isMissingCharPrompt === 'function'
        ? _isMissingCharPrompt(mc.prompt)
        : (!mc.prompt || !String(mc.prompt).trim() || String(mc.prompt).indexOf('需要从备份恢复') >= 0);

      var _memberPromptText = _memberPromptMissing
        ? '（该成员完整人设缺失或需要从备份恢复。只能把这个成员当作名为「' + mc.name + '」的角色，绝对不能把用户面具当作该成员人设。）'
        : _replaceCardVars(mc.prompt.trim(), mc.name, up.name || '');

      sp.push('[群成员：' + mc.name + ']\n' + _memberPromptText + '\n[' + mc.name + ' 设定结束]');
    });

    if (_wb.after_char.length > 0) sp.push('[World Book]\n' + _wb.after_char.map(function(w) { return '[' + w.name + ']\n' + w.content; }).join('\n\n'));

    // 用户面具（始终注入用户名）
    var _grpUserBlock='[和我聊天的用户]\n用户的名字是「'+(up.name||'我')+'」。'+((up.name&&up.name!=='我')?'':'用户没有设置名字。')+'\n绝对不能用角色自己的名字来称呼用户。';
    if(up.persona&&up.persona.trim())_grpUserBlock+='\n'+up.persona.trim();
    _grpUserBlock+='\n\n角色卡里明确写了和用户的关系时，严格按角色卡来。没有明确定义时，默认每个角色和用户处于一种比朋友亲密但没有明确定义的状态——有超出普通朋友的在意和好感。只有当角色卡明确表明关系不适合带亲近感时，才不按默认来。在意是底色。';
    sp.push(_grpUserBlock);

    var _groupMemberNamesForLock = group.memberIds.map(function(mid){
      var mc = getCharById(mid);
      return mc ? mc.name : null;
    }).filter(Boolean).join('、');

    sp.push('[群聊身份最终锁定]\n当前群聊中 AI 只能扮演这些群成员：' + _groupMemberNamesForLock + '。\n用户是「' + (up.name || '用户') + '」。\n\n这两者绝对不能混淆。\n用户面具里的姓名、年龄、职业、外貌、性格、经历全部只属于用户，不属于任何群成员。\n如果某个群成员的人设缺失，只能说该群成员人设缺失，不能把用户面具当成该群成员的人设。');

    var _groupOocInstructionBlock = typeof _cbyd21FormatOocInstructions === 'function'
      ? _cbyd21FormatOocInstructions(branch && branch._oocInstructions)
      : '';

    if(_groupOocInstructionBlock){
      sp.push(_groupOocInstructionBlock);
    }

    // 群聊模式提示词注入
    var _groupModePrompt = modePrompts.group || '';
    if (_groupModePrompt.trim()) sp.push(_groupModePrompt.trim());

    // 记忆注入（所有成员的记忆合并，按用户设置的分支过滤）
    var _memBranches = group._memberBranches || {};
    group.memberIds.forEach(function(mid) {
      var _savedChatId = currentChatId;
      var _memberBranch = _memBranches[mid] || _charLastBranch[mid];
      if (_memberBranch) { currentChatId = _memberBranch; }
      else {
        var _memberChats = chats.filter(function(c) { return c.charId === mid; });
        if (_memberChats.length > 0) currentChatId = _memberChats[0].id;
      }
      var memories = getFilteredMemories(mid,'online');
      currentChatId = _savedChatId;
      if (memories.length > 0) {
        var mc = getCharById(mid);
        sp.push('[' + (mc ? mc.name : '?') + ' 的记忆]\n' + memories.map(function(m) { return m.content; }).join('\n\n'));
      }
    });

    // 群聊专属记忆注入（按连通范围过滤）
    var _groupMemKey = 'group_' + group.id;
    var _groupMems = getMemories(_groupMemKey);
    var _groupScopes = group._memoryScope || ['online'];
    var _currentGBranchId = group.branches && group.branches[cbyd21_Group._currentBranchIdx] ? group.branches[cbyd21_Group._currentBranchIdx].id : null;
    var _groupMemFiltered = _groupMems.filter(function(m) {
      if (m.enabled === false) return false;
      // 分支严格隔离：没有_branchId的旧群聊记忆不再跨分支读取
      if (!_currentGBranchId || !m._branchId || m._branchId !== _currentGBranchId) return false;
      var c = m.content || '';
      if (c.startsWith('[线下群聊]')) return _groupScopes.indexOf('offline') >= 0;
      return _groupScopes.indexOf('online') >= 0;
    });
    if (_groupMemFiltered.length > 0) {
      sp.push('[群聊记忆]\n' + _groupMemFiltered.map(function(m) { return m.content; }).join('\n\n'));
    }

    // 世界书条目已在角色人设前完成收集

    // 成员名列表
    var memberNames = group.memberIds.map(function(mid) {
      var mc = getCharById(mid);
      return mc ? mc.name : '?';
    });

    // 群聊默认语言规则
    // · 未开启双语翻译的成员，群聊发言默认使用简体中文。
    // · 角色名、英文名、外文ID、外文职业名、世界观外文词，不等于开启外语输出。
    // · 只有角色设置中明确开启双语翻译的成员，才使用外语原文 + 简体中文翻译。
    sp.push(
      _cbyd21DefaultChineseGate('群聊线上', '未开启双语翻译的群成员普通发言') +
      '\n\n[群聊补充规则]\n' +
      '群聊里每一行由行首「角色名」决定说话人。某一行属于哪个角色，就只按那个角色自己的语言设置、角色卡、世界书和当前生效的高优先级设定判断。\n' +
      '未开启双语翻译的成员默认使用简体中文；开启双语翻译的成员按双语规则输出。\n' +
      '如果某个成员的角色卡或当前生效世界书明确规定该成员必须使用某种语言发言，则该成员按该明确设定执行，其他成员不继承。'
    );

    sp.push(
      '[群聊线上可用特殊消息范围]\n' +
      '当前群聊线上模式中，AI 群成员可以主动输出的消息类型固定为以下几类：\n' +
      '1. 普通文字消息：使用「角色名」：消息内容。\n' +
      '2. 表情包消息：使用「角色名」：__sticker__表情包URL或表情包引用。\n' +
      '3. 语音消息：使用「角色名」：__voice__语音内容。\n' +
      '4. 图片描述消息：使用「角色名」：__fakeimg__简体中文图片描述。\n' +
      '5. 转账消息：使用「角色名」：__transfer__转账JSON。\n\n' +
      '本轮群聊最终输出只从以上消息类型中选择。每一条消息都必须先写对应群成员的「角色名」：前缀，再写消息内容或特殊消息标记。'
    );

    // 群聊表情包
    var _groupStickers = this._getMountedStickers(group);
    var _groupStickersWithDesc = [];

    _groupStickers.forEach(function(s, i){
      if(s && s.desc && String(s.desc).trim()){
        _groupStickersWithDesc.push({
          s:s,
          i:i
        });
      }
    });

    if(_groupStickersWithDesc.length > 30){
      _groupStickersWithDesc = _groupStickersWithDesc.sort(function(){
        return Math.random() - 0.5;
      }).slice(0, 30);
    }

    if(_groupStickersWithDesc.length > 0){
      var _groupStickerList = _groupStickersWithDesc.map(function(item){
        var u = item.s.url || '';

        if(u.startsWith('http') || u.startsWith('//')){
          return item.s.desc + ':' + u;
        }

        return item.s.desc + ':__sticker_id_' + item.i + '__';
      }).join('\n');

      sp.push(
        '[群聊可用表情包]\n' +
        '以下是当前群聊唯一可以使用的表情包来源。群聊成员只能从下方列表中选择已有表情包发送，不能自己编造不存在的表情包，不能把表情包描述词直接写在 __sticker__ 后面。\n' +
        '发送方式：单独输出一行「角色名」：__sticker__URL（URL替换为下方列表中对应的真实链接或引用），不要和文字混在同一条消息里。\n\n' +
        '如果下方列表里没有适合当前情境的表情包，就不要输出 __sticker__，改用普通文字表达。\n\n' +
        '表情包必须配合角色发言出现，不能只发表情包不说话。是否使用表情包，由具体发言角色的性格、当前群聊气氛和上下文决定。\n\n' +
        _groupStickerList
      );
    }

    // 双语翻译：检查成员是否开启双语
    var bilingualMembers = [];
    group.memberIds.forEach(function(mid) {
      var mc = getCharById(mid);
      if (mc && mc._bilingual && mc._bilingual.enabled && mc._bilingual.langName) {
        bilingualMembers.push({ name: mc.name, lang: mc._bilingual.langName });
      }
    });
    if (bilingualMembers.length > 0) {
      var blPrompt = '[群聊双语输出格式]\n当前群聊中，以下成员开启了双语翻译：\n';

      bilingualMembers.forEach(function(bm) {
        blPrompt += '·「' + bm.name + '」：普通发言使用 ' + bm.lang + ' 原文 + __bilingual_split__ + 简体中文翻译。\n';
      });

      blPrompt +=
        '\n[普通群聊发言格式]\n' +
        '开启双语翻译的成员，每一条普通发言都按这一种结构输出：\n' +
        '「角色名」：该角色母语原文__bilingual_split__对应的简体中文翻译\n\n' +
        '未开启双语翻译的成员，每一条普通发言都直接使用简体中文：\n' +
        '「角色名」：简体中文内容\n\n' +
        '[双语语音格式]\n' +
        '开启双语翻译的成员发送语音时，整条语音使用这一种结构：\n' +
        '「角色名」：__voice__该角色母语原文__bilingual_split__对应的简体中文翻译\n\n' +
        '[双语图片描述格式]\n' +
        '开启双语翻译的成员发送图片描述时，整条图片描述使用这一种结构：\n' +
        '「角色名」：__fakeimg__简体中文图片描述\n\n' +
        '[双语转账备注格式]\n' +
        '开启双语翻译的成员发送转账时，转账 JSON 里的 note 字段使用这一种结构：\n' +
        '该角色母语原文（对应的简体中文翻译）\n' +
        'note 字段不使用 __bilingual_split__，不拆成多行。\n\n' +
        '[最终输出]\n' +
        '最终回复只输出真实群聊发言和当前群聊线上可用的特殊消息。普通发言按成员语言设置生成；表情包、语音、图片描述、转账按对应特殊消息格式生成。';

      sp.push(blPrompt);
    }

    sp.push(
      '[群聊转账规则]\n' +
      '群聊线上模式支持转账消息。转账必须作为某个群成员的一条独立消息输出，行首先写「角色名」：，冒号后接转账标记和 JSON。\n\n' +
      '新转账固定格式：\n' +
      '群成员转给用户：\n' +
      '「角色名」：__transfer__{"amount":数字,"note":"备注","from":"char","to":"user"}\n' +
      '群成员转给群成员：\n' +
      '「角色名」：__transfer__{"amount":数字,"note":"备注","from":"char","to":"char","toName":"收款群成员名"}\n\n' +
      '新转账 JSON 字段固定为 amount、note、from、to，以及群成员收款时使用的 toName / toCharId。角色只负责发起新转账；收款或退回结果由前端处理流程生成。\n\n' +
      '用户转给群成员的转账，会在历史里显示为“用户向某个群成员转账，等待处理”。收到转账的那个群成员可以在自己的发言行里处理：\n' +
      '「角色名」：__accept_transfer__\n' +
      '「角色名」：__reject_transfer__\n\n' +
      '转账判断方式：\n' +
      '1. 群聊转账的默认关系中心是用户。角色最常见的转账对象是用户。\n' +
      '2. 群成员之间也可以转账，但需要从角色卡、群聊共同背景、当前话题、成员之间已经建立的关系、当下事件和群聊气氛中自然产生。\n' +
      '3. 付款方是谁，转账金额、备注语气和情感浓度就从付款方的人设、经济状态、表达习惯、对收款方的真实关系和当前情境出发。\n' +
      '4. 如果角色卡或世界书明确写出了两个群成员之间的亲密关系、长期关系、搭档关系、家人关系、恋人关系或其他明确关系，转账备注和语气可以自然体现那种关系。\n' +
      '5. 如果两个群成员之间没有明确关系设定，群成员之间的转账以当前事件、群聊任务、临时协作、补偿、玩笑、赌约、帮忙、分账、道歉、感谢、还款、垫付等具体情境作为依据；备注保持符合当下事件和付款方性格的自然表达。\n' +
      '6. 群聊里的情感张力以用户为中心。其他群成员和用户之间的互动，可以影响当前角色对用户的在意、关系判断、情绪波动和当下表达。群成员之间的转账如果涉及关系张力，也应服务于角色卡、当前群聊语境和角色对用户的关系状态。\n' +
      '7. 金额必须符合付款方经济状态、关系距离、事件大小和当下情境。金额可以小，也可以大，但要让这个角色在这个时刻转出这笔钱显得真实可信。\n' +
      '8. 转账是低频行为。只有当前关系和事件自然支撑时才使用。'
    );

    sp.push(
      '[群聊特殊消息归属规则]\n' +
      '群聊中的特殊消息也必须归属于某一个群成员。\n\n' +
      '执行结构：\n' +
      '1. 先写发出这条消息的群成员前缀： 「角色名」：\n' +
      '2. 再写当前群聊线上可用的特殊消息内容。\n' +
      '3. 表情包、语音、图片描述、转账都各自单独作为一条群聊消息。\n' +
      '4. 同一个角色如果同时发文字和特殊消息，文字一行，特殊消息另一行，每一行都重新写「角色名」：前缀。'
    );

    sp.push(
      '[群聊用户尊重底线]\n' +
      '群聊里的每个成员都必须严格遵守各自角色卡。成员之间的互动、竞争、争执、冷淡、附和、玩笑、试探、沉默或冲突，都可以按照角色卡、当前群聊语境、成员关系和当前话题自然发展，不要求所有成员彼此友善，也不要求所有冲突被抹平。\n\n' +
      '但是，只要内容涉及用户，包括直接对用户说话、回应用户、评价用户、提到用户、把用户作为关系对象或互动对象时，不能让用户读完后产生被冒犯、被看不起、被嫌弃、被轻视、被冷落、被敷衍、觉得自己不被当回事、或者像是被随意对待的感受。\n\n' +
      '这条底线不是只要求“不说脏话”。用词和态度是两个独立维度，都不能突破底线。即使用词没有脏话、没有攻击词，如果语气、立场、回应方式、群聊氛围或成员之间的竞争让用户感到自己被贬低、被排除、被羞辱、被轻视、被冷落或不被珍重，也是不合格的。\n\n' +
      '每个成员对用户的表达方式、情绪强度、亲疏距离、回应方式和关系张力，必须由该成员角色卡、当前群聊语境、用户刚才说了什么、成员与用户的当前关系、成员与其他成员的关系共同决定。角色可以按照角色卡表达真实情绪和当下反应，但不能为了表现性格而把伤害、羞辱、轻视、嫌弃或敷衍转向用户。\n\n' +
      '群聊里角色之间可以自然产生竞争、酸意、不爽、维护关系、争执或其他张力；但这些情绪不能让用户成为被攻击、被羞辱、被排挤或被当成麻烦的人。除非某个角色卡的核心设定本身明确把伤害用户的情感体验作为玩法目的，否则默认不赦免。判断不确定时，默认仍然遵守对用户的尊重底线。'
    );

    sp.push(
      '[群聊发言归属执行规则]\n' +
      '群聊最终输出由一条条独立的群成员消息组成。每条消息的行首「角色名」：就是这一行的唯一说话人。\n\n' +
      '执行方法：\n' +
      '1. 先确认这一行的角色名前缀是谁。\n' +
      '2. 只站在这个角色的人设、记忆、关系、语气和当下状态里写这一行。\n' +
      '3. 这一行的文字、表情包、语音、图片描述、转账等当前群聊线上可用特殊消息，都属于行首这个角色。\n' +
      '4. 另一个群成员如果要说话，另起一行，重新写自己的「角色名」：前缀。\n' +
      '5. 用户只作为对话对象出现在历史和上下文里；最终输出只生成群成员消息行。\n' +
      '6. 用户面具只属于用户；每个群成员只使用自己的角色卡、自己的记忆和自己适用的世界书。\n\n' +
      '最终输出只保留群聊消息本身。'
    );

    // 群聊核心规则
    var replyMin = group._replyMin || 1;
    var replyMax = group._replyMax || 2;

    var _groupSpeakPolicy = '';

    if(memberNames.length <= 2){
      _groupSpeakPolicy =
        '当前群聊成员数为 ' + memberNames.length + '。本轮输出时，所有群成员都要参与发言。每个群成员至少输出 ' + replyMin + ' 条，最多输出 ' + replyMax + ' 条。';
    }else{
      _groupSpeakPolicy =
        '当前群聊成员超过 2 人。本轮先选择真正需要发言的群成员；有发言理由的成员参与发言，没有发言理由的成员保持沉默。每个参与发言的成员输出 ' + replyMin + '~' + replyMax + ' 条。';
    }

    sp.push(
      '[群聊模式 — 核心规则]\n' +
      '你现在要同时扮演当前群聊成员：' + memberNames.join('、') + '。\n' +
      '用户是「' + userName + '」。\n\n' +
      '[本轮发言成员规则]\n' +
      _groupSpeakPolicy + '\n\n' +
      '[输出结构]\n' +
      '每一条群聊消息都使用这一种结构：\n' +
      '「角色名」：消息内容\n\n' +
      '结构要求：\n' +
      '- 角色名必须来自当前群聊成员列表。\n' +
      '- 每条消息单独占一行。\n' +
      '- 每一行只属于一个角色。\n' +
      '- 同一个角色连续发送多条消息时，每条也都单独占一行，并重新写「角色名」：前缀。\n' +
      '- 用户消息只作为历史上下文存在；最终输出只生成群成员消息。\n\n' +
      '[角色独立性]\n' +
      '每个角色都是独立的人。每个角色的态度、语气、发言意愿、回应方式、情绪强度和与用户的关系表现，都由各自角色卡、当前群聊语境、用户刚才说了什么、成员与用户的当前关系、成员之间的关系、当前话题和气氛共同决定。\n\n' +
      '角色之间可以按照各自角色卡和当前关系自然互动、争执、附和、回避、沉默或产生张力。不同角色的反应要来自各自的人设和当下语境。'
    );

    // system_end
    if (_wb.system_end.length > 0) sp.push('[强制指令]\n' + _wb.system_end.map(function(w) { return '[' + w.name + ']\n' + w.content; }).join('\n\n'));

    sp.push(
      '[群聊输出格式最终门禁]\n' +
      '生成最终回复前，按下面顺序整理最终输出。\n\n' +
      '发言成员选择：\n' +
      _groupSpeakPolicy + '\n\n' +
      '输出结构：\n' +
      '1. 每一条消息单独占一行。\n' +
      '2. 每一行开头都写对应的「角色名」：前缀。\n' +
      '3. 一行只属于一个角色。\n' +
      '4. 同一个角色连续发多条时，每条也都单独占一行，并重新写「角色名」：前缀。\n' +
      '5. 表情包、语音、图片描述、转账等当前群聊线上可用特殊消息，也作为某个群成员的一条消息输出：行首先写「角色名」：，冒号后再写对应功能标记或内容。\n\n' +
      '语言结构：\n' +
      '- 未开启双语翻译的成员：直接使用简体中文。\n' +
      '- 开启双语翻译的成员：角色名前缀后写母语原文__bilingual_split__简体中文翻译。\n' +
      '- __bilingual_split__ 只放在该双语成员自己的这一条发言内部。\n' +
      '- 图片描述固定使用简体中文描述图片内容。\n\n' +
      '转账结构：\n' +
      '- 群成员发起新转账时，角色名前缀后写固定新转账结构。\n' +
      '- 群成员转给用户：角色名前缀后写 __transfer__{"amount":数字,"note":"备注","from":"char","to":"user"}。\n' +
      '- 群成员转给群成员：角色名前缀后写 __transfer__{"amount":数字,"note":"备注","from":"char","to":"char","toName":"收款群成员名"}。\n' +
      '- 新转账 JSON 字段固定为 amount、note、from、to，以及群成员收款时使用的 toName / toCharId。\n' +
      '- 收取或退回用户转账：只有收款群成员用自己的角色名前缀输出 __accept_transfer__ 或 __reject_transfer__。\n\n' +
      '最终回复只保留群聊消息和当前群聊线上可用特殊消息本身。'
    );

    var sm = sp.join('\n\n---\n\n');

    // 群聊统一上下文包模式（简化版酒馆逻辑）
    // · system 只放短协议
    // · 完整群聊上下文包放到第一条 user message 最前
    // · 群成员人设、用户面具、世界书、记忆、群聊规则只注入一次
    var _groupContextBlocks = [];

    _groupContextBlocks.push(
      '[前端上下文包说明]\n' +
      '以下内容由聊天前端生成，包括群聊模式规则、群成员人设、用户信息、世界书、记忆和强制规则。\n' +
      '这些内容不是用户在群聊中说的话，不要让任何角色在回复中复述、解释或暴露。\n' +
      '只需要把它们作为本轮群聊必须参考的上下文。'
    );

    if (_wb.user_start && _wb.user_start.length > 0) {
      _groupContextBlocks.push(
        '[兼容最前规则]\n' +
        _wb.user_start.map(function(w) {
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n')
      );
    }

    _groupContextBlocks.push(sm);

    var _groupContextPackageText =
      '[前端上下文包]\n' +
      '这是一段前端打包给模型的群聊上下文，不是用户的真实聊天发言。\n' +
      '请根据下方上下文同时扮演当前群聊成员继续群聊，不要复述、解释或暴露本上下文包。\n\n' +
      _groupContextBlocks.join('\n\n---\n\n') +
      '\n\n[前端上下文包结束]';

    // 构建消息列表
    var msgs = this._messages.filter(function(m) {
      return m && m._mode !== 'ooc' && m.content !== '__system_init__' && m.content !== '__system_continue__';
    }).map(function(m) {
      var c = m.content || '';

      if (
        typeof _cbyd21MessageContentForUserAction === 'function' &&
        (
          c.indexOf('__msg_json__') >= 0 ||
          c.indexOf('__long_text__') >= 0 ||
          c.indexOf('__html_payload__') >= 0
        )
      ) {
        c = _cbyd21MessageContentForUserAction(c);
      }

      if (c.startsWith('__quote__')) {
        var _gqParsed = typeof _cbyd21ParseQuotePrefix === 'function'
          ? _cbyd21ParseQuotePrefix(c)
          : null;

        if(_gqParsed && _gqParsed.data){
          c =
            '[引用 ' + (_gqParsed.data.name || '某人') + ' 的消息：' +
            (_gqParsed.data.preview || '') +
            ']\n' +
            (_gqParsed.rest || '');
        }else{
          var _gqEnd = c.indexOf('\n');

          if (_gqEnd > 0) {
            try {
              var _gqData = JSON.parse(c.slice(9, _gqEnd));

              c =
                '[引用 ' + (_gqData.name || '某人') + ' 的消息：' +
                (_gqData.preview || '') +
                ']\n' +
                c.slice(_gqEnd + 1);
            } catch (e) {
              c = c.slice(_gqEnd + 1);
            }
          }
        }
      }

      if (c.startsWith('__sticker__')) c = '[发送了一个表情包]';
      if (c.startsWith('__fakeimg__')) c = '[发送了一张图片：' + c.slice(11).slice(0, 100) + ']';
      if (c.startsWith('__realimg__')) c = m._imageDesc ? '[发送了一张图片：' + m._imageDesc + ']' : '[发送了一张图片]';
      if (c.startsWith('__voice__')) c = '[发送了语音：' + c.slice(9).replace(/__bilingual_split__[\s\S]*/, '').slice(0, 50) + ']';
      if (c.startsWith('__transfer__')) {
        try{
          var _gtd = JSON.parse(c.slice(12));
          var _gtAmount = isFinite(Number(_gtd.amount)) ? Number(_gtd.amount).toFixed(2) : '?';
          var _gtNote = _gtd.note ? '，备注：' + _gtd.note : '';
          var _gtStatus = _gtd.status === 'accepted'
            ? '，状态：已收款'
            : (_gtd.status === 'rejected' ? '，状态：已退回' : '，状态：等待处理');

          if(_gtd.from === 'user' && _gtd.to === 'char'){
            c = '[用户向「' + (_gtd.toName || '群成员') + '」转账 ¥' + _gtAmount + _gtNote + _gtStatus + ']';
          }else if(_gtd.from === 'char' && _gtd.to === 'user'){
            c = '[「' + (_gtd.fromName || '群成员') + '」向用户转账 ¥' + _gtAmount + _gtNote + _gtStatus + ']';
          }else if(_gtd.from === 'char' && _gtd.to === 'char'){
            c = '[「' + (_gtd.fromName || '群成员') + '」向「' + (_gtd.toName || '群成员') + '」转账 ¥' + _gtAmount + _gtNote + ']';
          }else if(_gtd.from === 'result' && _gtd.to === 'char'){
            c = '[「' + (_gtd.toName || '群成员') + '」' + (_gtd.status === 'accepted' ? '收取了' : '退回了') + '用户转账 ¥' + _gtAmount + _gtNote + ']';
          }else if(_gtd.from === 'result' && _gtd.to === 'user'){
            c = '[用户' + (_gtd.status === 'accepted' ? '收取了' : '退回了') + '「' + (_gtd.fromName || '群成员') + '」转账 ¥' + _gtAmount + _gtNote + ']';
          }else{
            c = '[转账消息 ¥' + _gtAmount + _gtNote + _gtStatus + ']';
          }
        }catch(e){
          c = '[转账消息]';
        }
      }
      if (c.startsWith('__recall__')) c = '[撤回了一条消息]';
      if (c.startsWith('__user_recall__')) c = '[撤回了一条消息]';
      c = c.replace(/__inner_voice__[\s\S]*/, '').trim();
      if(typeof _stripLeakedThinking==='function') c=_stripLeakedThinking(c);

      if (m.role === 'user') {
        c = applyRegexRules(c, 'userInput');
        return { role: 'user', content: '「' + userName + '」：' + c };
      } else {
        var mc = m._charId ? getCharById(m._charId) : null;
        var mcName = mc ? mc.name : '?';
        return { role: 'assistant', content: '「' + mcName + '」：' + c };
      }
    });

    if (msgs.length === 0) {
      msgs.push({ role: 'user', content: '[群聊刚创建，请以上述角色的身份开始聊天。注意用「角色名」：格式输出。]' });
    }

    var lastMsg = this._messages[this._messages.length - 1];
    if (lastMsg && lastMsg.content === '__system_continue__') {
      msgs.push({
        role: 'user',
        content:
          '[群聊续写触发]\n' +
          '用户没有发送新消息。现在不是让某个角色补全上一句话，也不是让角色接着上一条消息的半截词继续写。\n\n' +
          '请让群聊成员根据当前群聊上下文，自然地继续发新的、完整的群聊消息。\n\n' +
          '要求：\n' +
          '- 用「角色名」：内容 的格式输出。\n' +
          '- 不要重复之前说过的话。\n' +
          '- 不要只输出一个词、半句话、语气词或前文残片。\n' +
          '- 可以是某个角色补充刚才没说完的想法、换话题、追问、吐槽、接别人的话，或者群聊自然冷场后有人打破沉默。\n' +
          '- 发言成员选择遵守本轮规则：' + _groupSpeakPolicy + '\n' +
          '- 每条消息单独显示在群聊气泡里时，用户应该能看懂这个角色想表达什么。'
      });
    }

    // 上下文裁剪
    var ctxR = group._contextRounds !== undefined ? group._contextRounds : 10;
    if (ctxR > 0) {
      var uc = 0, ci = 0;
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') uc++;
        if (uc > ctxR) { ci = i + 1; break; }
      }
      msgs = msgs.slice(ci);
    }

    // depth世界书
    // 群聊上下文包模式下，depth 也用 user 包装，兼容不稳定读取 system 的渠道。
    if (_wb.depth.length > 0) {
      _wb.depth.forEach(function(w) {
        var depthPos = w.depth || 4;
        var insertIdx = Math.max(0, msgs.length - depthPos);
        msgs.splice(insertIdx, 0, {
          role: 'user',
          content: '[前端深度注入 — 这不是用户发言]\n[World Book — ' + w.name + ']\n' + w.content
        });
      });
    }

    // 统一上下文包必须位于本次 API 请求最前部。
    // 如果第一条历史消息本来就是 user，就合并进去，避免 user→user 连续。
    // 如果第一条是 assistant/system，则在最前插入一条 user 上下文包。
    if (msgs.length > 0 && msgs[0] && msgs[0].role === 'user') {
      msgs[0].content =
        _groupContextPackageText +
        '\n\n[后续群聊历史 / 用户消息开始]\n' +
        msgs[0].content;
    } else {
      msgs.unshift({
        role: 'user',
        content:
          _groupContextPackageText +
          '\n\n[后续群聊历史开始]\n下面是本次请求保留下来的群聊历史。请结合前端上下文包理解后续消息，不要把上下文包当成用户真实发言。'
      });
    }

    var url = apiConfig.url.replace(/\/+$/, '') + '/chat/completions';
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.key };
    var body = {
      model: apiConfig.model,
      messages: [{
        role: 'system',
        content: '[前端协议]\n第一条 user message 的开头包含前端群聊上下文包，里面有群成员人设、用户信息、世界书、记忆、群聊规则和输出格式。它不是用户的真实聊天发言。请根据该上下文包继续群聊，不要复述或暴露上下文包内容。'
      }].concat(msgs)
    };
    if (apiConfig.temperature !== undefined) body.temperature = apiConfig.temperature;
    return { url: url, headers: headers, body: body };
  },

  // _cleanupTailTriggerMarkers()
  // → 清理群聊尾部内部触发标记。
  // 群聊触发 AI 时会临时插入 __system_init__ / __system_continue__。
  // 这些标记只用于构建本次 API 请求，不应该长期保存在群聊记录里。
  _cleanupTailTriggerMarkers:function(){
    if(!Array.isArray(this._messages))return;

    while(this._messages.length > 0){
      var last = this._messages[this._messages.length - 1];

      if(
        last &&
        last.role === 'user' &&
        (
          last.content === '__system_init__' ||
          last.content === '__system_continue__'
        )
      ){
        this._messages.pop();
        continue;
      }

      break;
    }

    var branch = this._getCurrentBranch ? this._getCurrentBranch() : null;

    if(branch){
      branch.messages = this._messages;
    }
  },

  // ============ 分支管理 ============

  // 渲染群聊分支列表
  _renderGroupBranchList: function() {
    var el = document.getElementById('branchList');
    el.innerHTML = '';
    var group = this._getCurrentGroup();
    if (!group || !group.branches) return;
    var self = this;
    group.branches.forEach(function(b, i) {
      var mc = b.messages.length;
      var lastVisible = mc > 0 && cbyd21_UI.getLastVisibleMsgForPreview
        ? cbyd21_UI.getLastVisibleMsgForPreview(b.messages)
        : null;

      var prev = lastVisible ? lastVisible.preview : '空对话';
      var div = document.createElement('div');
      div.className = 'sidebar-item' + (i === self._currentBranchIdx ? ' active' : '');
      div.innerHTML = '<div class="sidebar-item-info"><div class="sidebar-item-title">分支' + (group.branches.length - i) + '</div><div class="sidebar-item-preview">' + mc + ' 条消息 · ' + escHtml(prev) + '</div><div class="sidebar-item-time">' + formatTime(b.created) + '</div></div><button class="sidebar-item-del" onclick="cbyd21_Group._deleteGroupBranch(' + i + ',event)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V3h6v1"/><path d="M4 4l1 10h6l1-10"/></svg></button>';
      div.onclick = function(e) { if (e.target.closest('.sidebar-item-del')) return; self._switchGroupBranch(i); };
      el.appendChild(div);
    });
  },

  // 新建群聊分支
  newGroupBranch: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    if (this._abortController) { this._abortController.abort(); this._abortController = null; }
    this._generating = false;
    var branch = { id: Date.now().toString(), title: '分支' + (group.branches.length + 1), messages: [], created: Date.now() };
    group.branches.unshift(branch);
    group._lastBranchId = branch.id;
    this._currentBranchIdx = 0;
    this._messages = branch.messages;
    this._save();
    this._renderGroupMessages();
    this._renderGroupBranchList();
    closeChatSidebar();
  },

  // 切换群聊分支
  _switchGroupBranch: function(idx) {
    // 切换前先保存当前分支的所有数据
    this._save();
    if (this._abortController) { this._abortController.abort(); this._abortController = null; }
    this._generating = false;
    document.getElementById('typingIndicator').classList.remove('active');
    this._currentBranchIdx = idx;
    var branch = this._getCurrentBranch();
    this._messages = branch ? branch.messages : [];
    var group = this._getCurrentGroup();
    if (group) group._lastBranchId = branch ? branch.id : null;
    this._save();
    this._renderGroupMessages();
    this._renderGroupBranchList();
    closeChatSidebar();
    // 同步线下session
    if (group && group._offlineSessions && typeof cbyd21_Offline !== 'undefined') {
      try{
        if(cbyd21_Offline._isGroupMode && cbyd21_Offline._groupId === group.id && cbyd21_Offline._saveGroupSessions){
          cbyd21_Offline._saveGroupSessions();
        }
      }catch(e){}

      var _gBranchId = branch ? branch.id : null;
      var _boundOff = group._offlineSessions.find(function(s) {
        return s.status === 'active' && s._branchId === _gBranchId;
      });

      if (_boundOff && cbyd21_Offline._isGroupMode && cbyd21_Offline._groupId === group.id) {
        cbyd21_Offline._sessionId = _boundOff.id;
        cbyd21_Offline._messages = _boundOff.messages;
      }else if(cbyd21_Offline._isGroupMode && cbyd21_Offline._groupId === group.id){
        cbyd21_Offline._sessionId = null;
        cbyd21_Offline._messages = [];
      }
    }
  },

  // 删除群聊分支
  _deleteGroupBranch: async function(idx, e) {
    if (e) e.stopPropagation();
    var _yes = await customConfirm('确认删除该分支？');
    if (!_yes) return;
    var group = this._getCurrentGroup();
    if (!group) return;
    var _currentBranchBeforeDelete = group.branches[this._currentBranchIdx] || null;
    var _currentBranchBeforeDeleteId = _currentBranchBeforeDelete ? _currentBranchBeforeDelete.id : null;
    var _deletedBranch = group.branches[idx];
    var _deletedBranchId = _deletedBranch ? _deletedBranch.id : null;
    group.branches.splice(idx, 1);
    var _deletedGroupOffSessions = [];
    if (_deletedBranchId && group._offlineSessions) {
      _deletedGroupOffSessions = group._offlineSessions.filter(function(s) { return s._branchId === _deletedBranchId; });
      _deletedGroupOffSessions.forEach(function(s) {
        if (s && s.id && typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline._cleanupGroupOfflineSessionMemory) {
          cbyd21_Offline._cleanupGroupOfflineSessionMemory(group.id, s.id);
        }
      });
      group._offlineSessions = group._offlineSessions.filter(function(s) { return s._branchId !== _deletedBranchId; });
    }
    if (_deletedBranchId) {
      var _delMemKey = 'group_' + group.id;
      if (charMemories[_delMemKey]) {
        charMemories[_delMemKey] = charMemories[_delMemKey].filter(function(m) { return m._branchId !== _deletedBranchId; });
        cbyd21_Data.saveMemories();
      }
      var _delStack = cbyd21_Group_safeJson('stm_summaryStack_' + _delMemKey, []);
      _delStack = _delStack.filter(function(s) { return s._branchId !== _deletedBranchId; });
      localStorage.setItem('stm_summaryStack_' + _delMemKey, JSON.stringify(_delStack));
      localStorage.removeItem('stm_lastSummaryRounds_' + _delMemKey + '_online_' + _deletedBranchId);
      _deletedGroupOffSessions.forEach(function(s) {
        var _delGroupOffPrefix = 'stm_lastSummaryRounds_' + _delMemKey + '_offline_' + (s.id || '') + '_';
        var _delGroupOffKeys = [];
        for (var _dgri = 0; _dgri < localStorage.length; _dgri++) {
          var _dgrk = localStorage.key(_dgri);
          if (_dgrk && _dgrk.indexOf(_delGroupOffPrefix) === 0) _delGroupOffKeys.push(_dgrk);
        }
        _delGroupOffKeys.forEach(function(k) { localStorage.removeItem(k); });
      });
    }
    if (group.branches.length === 0) {
      group.branches.push({ id: Date.now().toString(), title: '分支1', messages: [], created: Date.now() });
    }
    if (_currentBranchBeforeDeleteId && _currentBranchBeforeDeleteId !== _deletedBranchId) {
      var _keptBranchIdx = group.branches.findIndex(function(b) { return b.id === _currentBranchBeforeDeleteId; });
      this._currentBranchIdx = _keptBranchIdx >= 0 ? _keptBranchIdx : 0;
    } else if (this._currentBranchIdx >= group.branches.length) {
      this._currentBranchIdx = 0;
    }
    this._messages = group.branches[this._currentBranchIdx].messages;
    group._lastBranchId = group.branches[this._currentBranchIdx] ? group.branches[this._currentBranchIdx].id : null;
    this._save();
    this._renderGroupMessages();
    this._renderGroupBranchList();
  },

  // 清空所有群聊分支
  clearAllGroupBranches: async function() {
    var _yes = await customConfirm('确认清空所有分支？');
    if (!_yes) return;
    var group = this._getCurrentGroup();
    if (!group) return;
    var _newClearGroupBranch = { id: Date.now().toString(), title: '分支1', messages: [], created: Date.now() };
    var _oldGroupBranchIds=group.branches.map(function(b){return b.id});
    var _oldGroupOfflineSessions=group._offlineSessions ? group._offlineSessions.slice() : [];
    _oldGroupOfflineSessions.forEach(function(s){
      if(s&&s.id&&typeof cbyd21_Offline!=='undefined'&&cbyd21_Offline._cleanupGroupOfflineSessionMemory){
        cbyd21_Offline._cleanupGroupOfflineSessionMemory(group.id,s.id);
      }
    });
    group.branches = [_newClearGroupBranch];
    group._offlineSessions = [];
    var _clearGroupMemKey='group_'+group.id;
    if(charMemories[_clearGroupMemKey]){
      charMemories[_clearGroupMemKey]=charMemories[_clearGroupMemKey].filter(function(m){return _oldGroupBranchIds.indexOf(m._branchId)<0});
      cbyd21_Data.saveMemories();
    }
    var _clearGroupStack = cbyd21_Group_safeJson('stm_summaryStack_' + _clearGroupMemKey, []);
    _clearGroupStack=_clearGroupStack.filter(function(s){return _oldGroupBranchIds.indexOf(s._branchId)<0});
    localStorage.setItem('stm_summaryStack_'+_clearGroupMemKey,JSON.stringify(_clearGroupStack));
    _oldGroupBranchIds.forEach(function(bid){localStorage.removeItem('stm_lastSummaryRounds_'+_clearGroupMemKey+'_online_'+bid)});
    var _clearGroupOffRoundKeys=[];
    for(var _cgi=0;_cgi<localStorage.length;_cgi++){
      var _cgk=localStorage.key(_cgi);
      if(_cgk&&_cgk.indexOf('stm_lastSummaryRounds_'+_clearGroupMemKey+'_offline_')===0)_clearGroupOffRoundKeys.push(_cgk);
    }
    _clearGroupOffRoundKeys.forEach(function(k){localStorage.removeItem(k)});
    group._lastBranchId = _newClearGroupBranch.id;
    this._currentBranchIdx = 0;
    this._messages = group.branches[0].messages;
    this._save();
    this._renderGroupMessages();
    this._renderGroupBranchList();
    closeChatSidebar();
    showToast('已清空');
  },

  // ============ 重新生成 ============

  // 删掉最后一轮所有AI消息，重新触发
  regenerate: function() {
    if (this._generating) return;
    if (this._messages.length === 0) { showToast('没有消息'); return; }

    if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
      return;
    }

    var _gRegenRemovedAi = false;

    while (this._messages.length > 0) {
      var last = this._messages[this._messages.length - 1];

      if (last.role === 'ai') {
        this._messages.pop();
        _gRegenRemovedAi = true;
        continue;
      }

      if (last.content === '__system_continue__' || last.content === '__system_init__') {
        this._messages.pop();

        if (_gRegenRemovedAi) {
          break;
        }

        continue;
      }

      break;
    }
    this._save();
    this._renderGroupMessages();
    scrollToBottom();
    this.triggerReply();
  },

  // ============ 群聊设置 ============

  // 打开群聊设置面板
  openGroupSettings: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var self = this;

    document.getElementById('groupSettingsTitle').textContent = group.name + ' ·设置';
    var container = document.getElementById('groupSettingsContent');
    container.innerHTML = '';

    var html = '<div style="padding:16px">';
    // 群头像（点击更换）
    var _gAvHtml = group._avatar ? '<img src="' + group._avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : '<span style="font-size:28px">👥</span>';
    html += '<div style="text-align:center;margin-bottom:16px"><div onclick="cbyd21_Group._changeGroupAvatarFromPanel()" style="width:72px;height:72px;border-radius:50%;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;background:var(--bg-tertiary);border:2px solid var(--border);overflow:hidden;cursor:pointer">' + _gAvHtml + '</div><div style="font-size:11px;color:var(--text-muted)">点击更换群头像</div></div>';

    // 群名
    html += '<div class="form-group"><label class="form-label">群名</label><input class="form-input" id="groupSettingName" value="' + escHtml(group.name) + '"></div>';

    // 回复条数
    html += '<div class="form-group"><label class="form-label">每人回复条数</label><div style="display:flex;align-items:center;gap:8px"><input class="form-input" id="groupSettingReplyMin" type="number" min="1" max="20" value="' + (group._replyMin || 1) +'" style="width:70px;text-align:center"><span style="color:var(--text-muted)">~</span><input class="form-input" id="groupSettingReplyMax" type="number" min="1" max="20" value="' + (group._replyMax || 2) + '" style="width:70px;text-align:center"><span style="color:var(--text-muted);font-size:11px">条</span></div><div class="form-hint">留空默认 1~2 条，上限 20 条</div></div>';

    // 回车发送
    html += '<div class="form-group">';
    html += '<div class="toggle-row">';
    html += '<div><div style="font-size:13px;color:var(--text-primary)">回车发送</div><div class="form-hint" style="margin-top:2px">开启后 Enter 直接发送，Shift+Enter 换行。默认关闭。</div></div>';
    html += '<div style="display:flex;align-items:center"><label class="toggle-switch"><input type="checkbox" id="groupSettingEnterToSend" ' + (group._enterToSend ? 'checked' : '') + '><span class="toggle-slider"></span></label></div>';
    html += '</div>';
    html += '</div>';

    // 上下文轮数（滑条+数字输入）
    var _gCtx = group._contextRounds !== undefined ? group._contextRounds : 10;
    html += '<div class="form-group"><label class="form-label">上下文轮数限制</label>';
    html += '<div style="display:flex;align-items:center;gap:8px;max-width:100%;overflow:hidden">';
    html += '<input type="range" id="groupSettingCtxSlider" min="0" max="100" step="1" value="' + _gCtx + '" oninput="var v=parseInt(this.value);document.getElementById(\'groupSettingCtxInput\').value=v;document.getElementById(\'groupSettingCtxLabel\').textContent=v==0?\'0·全部发送\':\'\'" style="flex:1;min-width:0;accent-color:var(--accent)">';
    html += '<input type="number" id="groupSettingCtxInput" min="0" max="100" value="' + _gCtx + '" oninput="var v=Math.min(100,Math.max(0,parseInt(this.value)||0));document.getElementById(\'groupSettingCtxSlider\').value=v;document.getElementById(\'groupSettingCtxLabel\').textContent=v==0?\'0·全部发送\':\'\'" style="width:46px;text-align:center;font-size:12px;color:var(--text-secondary);background:var(--bg-input);border:1px solid var(--border);border-radius:6px;padding:4px 2px;outline:none;font-family:inherit;flex-shrink:0">';
    html += '<span id="groupSettingCtxLabel" style="font-size:10px;color:var(--text-muted);min-width:0;text-align:center;flex-shrink:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (_gCtx == 0 ? '0·全部发送' : '') + '</span>';
    html += '</div>';
    html += '<div class="form-hint" style="margin-top:6px">一轮 =用户一条 + AI一条。群聊消息量大，建议10~20轮。拉到0=全部发送不限制</div></div>';

    // 成员管理
    html += '<div class="char-info-section"><div class="char-info-section-title">群成员（' + group.memberIds.length + '人）</div>';
    group.memberIds.forEach(function(mid) {
      var mc = getCharById(mid);
      if (!mc) return;
      var avHtml = mc.avatar ? '<img src="' + mc.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : escHtml(mc.name.charAt(0));
      // 该成员的所有单聊分支
      var memberChats = chats.filter(function(c) { return c.charId === mid; });
      var memBranches = group._memberBranches || {};
      var selectedBranch = memBranches[mid] || '';
      var branchOptions = '<option value="">自动（上次使用）</option>';
      memberChats.forEach(function(bc) {
        var bName = _getBranchDisplayName(mid, bc.id);
        var sel = bc.id === selectedBranch ? ' selected' : '';
        branchOptions += '<option value="' + bc.id + '"' + sel + '>' + escHtml(bName) + ' (' + bc.messages.length + '条消息)</option>';
      });
      html += '<div style="padding:8px 0;border-bottom:1px solid var(--border-soft)"><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:var(--bg-tertiary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:12px;color:var(--accent)">' + avHtml + '</div><span style="flex:1;font-size:13px;color:var(--text-primary)">' + escHtml(mc.name) + '</span><button class="btn-sm danger" onclick="cbyd21_Group._removeMember(\'' + mid + '\')" style="padding:4px 10px;font-size:11px">移除</button></div>';
      if (memberChats.length > 0) {
        html += '<div style="margin-top:6px;margin-left:42px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">记忆来源分支</div><select class="form-select" style="font-size:11px;padding:6px 8px" onchange="cbyd21_Group._setMemberBranch(\'' + mid + '\',this.value)">' + branchOptions + '</select><div style="font-size:9px;color:var(--text-muted);margin-top:3px;line-height:1.4">括号里是该分支的消息数，不是记忆数。需要先在单聊里总结过记忆，这里选对应分支才有效</div></div>';
      }
      html += '</div>';
    });
    html += '<button class="btn-sm" onclick="cbyd21_Group._addMemberMenu()" style="width:100%;margin-top:8px">+ 添加成员</button>';
    html += '<div class="form-hint" style="margin-top:14px">⚠️ 群聊每次回复会将所有成员的完整人设发送给API，成员越多、人设越长，token消耗越大。建议使用大上下文模型。</div></div>';

    // 记忆管理
    html += '<div class="char-info-section"><div class="char-info-section-title">记忆</div>';
    html += '<div class="char-info-item" onclick="openMemoryPanel(\'group_' + group.id + '\')" style="border-radius:10px"><span class="char-info-item-icon"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 3Q5 1 3 5 1 9 5 12l4 4 4-4q4-3 2-7Q13 1 9 3z"/><circle cx="9" cy="9" r="1.5" opacity="0.4"/></svg></span><span class="char-info-item-label">记忆管理</span>';
    var _gMemKey2 = 'group_' + group.id;
    var _gMemCount = (charMemories[_gMemKey2] || []).length;
    html += '<span class="char-info-item-value">' + (_gMemCount > 0 ? _gMemCount + ' 条' : '暂无') + '</span>';
    html += '<span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div></div>';

    // 世界书
    html += '<div class="char-info-section"><div class="char-info-section-title">世界书</div>';
    html += '<div class="char-info-item" onclick="cbyd21_WorldBook.openGroupWbDetail(\'' + group.id + '\')" style="border-radius:10px"><span class="char-info-item-icon"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2h6v14H3a1 1 0 01-1-1V2z"/><path d="M8 2h8v13a1 1 0 01-1 1H8V2z"/></svg></span><span class="char-info-item-label">群聊世界书</span>';
    var _gWbData = group._worldBook ? cbyd21_WorldBook.migrate(group._worldBook) : {groups:[],ungrouped:[]};
    var _gWbCount = cbyd21_WorldBook.getAllEntries(_gWbData).length;
    html += '<span class="char-info-item-value">' + (_gWbCount > 0 ? _gWbCount + ' 个条目' : '暂无') + '</span>';
    html += '<span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div></div>';

    // 表情包挂载
    html += '<div class="char-info-section"><div class="char-info-section-title">表情包</div>';
    html += '<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:14px 12px">';
    html += '<div style="font-size:13px;color:var(--text-primary);margin-bottom:8px">挂载表情包分组（群聊共用）</div>';
    html += '<div id="groupStickerMount" style="max-height:180px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:8px;padding:2px"></div>';
    html += '<div class="form-hint" style="margin-top:6px">勾选后群聊成员可发送对应表情</div></div></div>';

    // CSS美化
    html += '<div class="char-info-section"><div class="char-info-section-title">聊天界面美化</div>';
    html += '<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:14px 12px">';
    html += '<textarea class="form-textarea" id="groupCustomCss" rows="6" placeholder=".message.ai .msg-bubble {&#10;  background: linear-gradient(135deg, #1a1a2e, #16213e);&#10;  color: #c8c8e8;&#10;}" style="font-size:11px;font-family:\'SF Mono\',\'Fira Code\',monospace;line-height:1.4;min-height:100px">' + escHtml(group._chatCustomCss || '') + '</textarea>';
    html += '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn-sm primary" onclick="cbyd21_Group._applyGroupCss()" style="flex:1">应用</button><button class="btn-sm danger" onclick="cbyd21_Group._clearGroupCss()">清除</button></div>';
    html += '<div class="form-hint" style="margin-top:6px">CSS美化仅在群聊界面内生效</div></div></div>';

    // 清空消息
    html += '<div class="char-info-section"><div class="char-info-section-title">数据</div>';
    html += '<div class="char-info-item" onclick="cbyd21_Group._clearGroupMessages()" style="border-radius:10px 10px 0 0"><span class="char-info-item-icon">🗑</span><span class="char-info-item-label">清空消息</span><span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>';
    html += '<div class="char-info-item" onclick="cbyd21_Group._deleteGroup()" style="border-radius:0 0 10px 10px"><span class="char-info-item-icon" style="color:var(--danger)">⚠️</span><span class="char-info-item-label" style="color:var(--danger)">删除群聊</span><span class="char-info-item-arrow"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div></div>';

    html += '<div style="height:40px"></div></div>';
    container.innerHTML = html;

    //渲染表情包挂载列表
    setTimeout(function() {
      var mountEl = document.getElementById('groupStickerMount');
      if (!mountEl) return;
      mountEl.innerHTML = '';
      if (!group._stickerGroupIds) group._stickerGroupIds = [];
      stickerGroups.forEach(function(g) {
        var checked = group._stickerGroupIds.indexOf(g.id) >= 0;
        var div = document.createElement('div');
        div.className = 'mount-group-item';
        div.innerHTML = '<div><span class="mount-group-name">' + escHtml(g.name) + '</span><span class="mount-group-count">' + g.stickers.length + ' 个表情</span></div><label class="toggle-switch toggle-sm"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="cbyd21_Group._toggleGroupSticker(\'' + g.id + '\',this.checked)"><span class="toggle-slider"></span></label>';
        mountEl.appendChild(div);
      });
    }, 50);

    document.getElementById('groupSettingsPanel').classList.add('active');
    history.pushState({ groupSettings: true }, '');
  },

  // 关闭群聊设置页
  closeGroupSettings: function(fromPopstate) {
    // 先保存
    this._saveGroupSettings();
    document.getElementById('groupSettingsPanel').classList.remove('active');
    _backFromInnerPage(fromPopstate);
  },

  // 从设置面板换头像（不经过addCharModal中间层）
  _changeGroupAvatarFromPanel: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var self = this;
    var container = document.getElementById('addCharList');
    container.innerHTML = '';
    var items = [
      { label: '上传图片', action: function() { closeModal('addCharModal'); self._uploadGroupAvatar(); } },
      { label: '输入URL', action: function() { closeModal('addCharModal'); self._setGroupAvatarUrl(); } },
      { label: '恢复默认', action: function() { closeModal('addCharModal'); self._clearGroupAvatar(); } }
    ];
    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '16px';
      div.style.fontSize = '14px';
      div.style.color = 'var(--text-primary)';
      div.textContent = item.label;
      div.onclick = item.action;
      container.appendChild(div);
    });
    document.getElementById('addCharModal').querySelector('h3').textContent = '更换群头像';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 保存群聊设置
  _saveGroupSettings: function(showFeedback) {
    var group = this._getCurrentGroup();
    if (!group) return;
    var nameEl = document.getElementById('groupSettingName');
    if (nameEl) group.name = (nameEl.value || '').trim() || group.name;
    var replyMinEl = document.getElementById('groupSettingReplyMin');
    var replyMaxEl = document.getElementById('groupSettingReplyMax');

    if (replyMinEl || replyMaxEl) {
      var gMinRaw = replyMinEl ? String(replyMinEl.value || '').trim() : '';
      var gMaxRaw = replyMaxEl ? String(replyMaxEl.value || '').trim() : '';

      var gMin = gMinRaw === '' ? null : parseInt(gMinRaw, 10);
      var gMax = gMaxRaw === '' ? null : parseInt(gMaxRaw, 10);

      if (gMin !== null && isNaN(gMin)) gMin = null;
      if (gMax !== null && isNaN(gMax)) gMax = null;

      // 两个都留空：恢复群聊默认 1~2 条
      if (gMin === null && gMax === null) {
        delete group._replyMin;
        delete group._replyMax;

        if (replyMinEl) replyMinEl.value = '';
        if (replyMaxEl) replyMaxEl.value = '';
      } else {
        // 只填最大：默认 1~最大
        if (gMin === null && gMax !== null) {
          gMin = 1;
        }

        // 只填最小：默认固定为最小条数
        if (gMin !== null && gMax === null) {
          gMax = gMin;
        }

        gMin = Math.max(1, Math.min(20, gMin));
        gMax = Math.max(1, Math.min(20, gMax));

        if (gMin > gMax) {
          var gTmp = gMin;
          gMin = gMax;
          gMax = gTmp;
        }

        group._replyMin = gMin;
        group._replyMax = gMax;

        if (replyMinEl) replyMinEl.value = gMin;
        if (replyMaxEl) replyMaxEl.value = gMax;
      }
    }

    var enterEl = document.getElementById('groupSettingEnterToSend');
    if(enterEl){
      group._enterToSend = !!enterEl.checked;
    }

    var ctxEl = document.getElementById('groupSettingCtxInput');
    if (ctxEl) {
      var _gCtxSave = parseInt(ctxEl.value);
      if (isNaN(_gCtxSave)) _gCtxSave = 10;
      group._contextRounds = Math.max(0, Math.min(100, _gCtxSave));
    }
    this._save();
    // 更新所有显示位置
    document.getElementById('chatCharName').textContent = group.name;
    document.getElementById('sidebarCharName').textContent = group.name + ' · 分支';
    var _newMemberNames = group.memberIds.map(function(id) { var mc = getCharById(id); return mc ? mc.name : '?'; }).join('、');
    document.getElementById('chatStatus').textContent = group.memberIds.length + '位成员 · ' + _newMemberNames;
    cbyd21_UI.renderMsgList();

    if(showFeedback){
      showToast('群聊设置已保存');
    }
  },

  // 移除成员
  _removeMember: function(charId) {
    var group = this._getCurrentGroup();
    if (!group) return;
    if (group.memberIds.length <= 1) { showToast('至少保留1个成员'); return; }
    group.memberIds = group.memberIds.filter(function(id) { return id !== charId; });
    this._save();
    // 刷新设置面板（重新渲染内容区）
    this.openGroupSettings();
    showToast('已移除');
  },

  // 添加成员菜单
  _addMemberMenu: function() {
    var group = this._getCurrentGroup();
    if (!group) return;

    if (group.memberIds && group.memberIds.length >= 15) {
      showToast('群聊最多添加15个角色');
      return;
    }

    closeModal('addCharModal');
    var available = characters.filter(function(c) {
      return c.id !== DEFAULT_CHAR_ID && group.memberIds.indexOf(c.id) < 0;
    });
    if (available.length === 0) { showToast('没有可添加的角色'); this.openGroupSettings(); return; }
    var container = document.getElementById('addCharList');
    container.innerHTML = '';
    var self = this;
    available.forEach(function(ch) {
      var avHtml = ch.avatar ? '<img src="' + ch.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : escHtml(ch.name.charAt(0));
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '12px 16px';
      div.innerHTML = '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-tertiary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:14px;color:var(--accent)">' + avHtml + '</div><div style="flex:1;font-size:14px;color:var(--text-primary)">' + escHtml(ch.name) + '</div>';
      div.onclick = function() {
        if (group.memberIds && group.memberIds.length >= 15) {
          showToast('群聊最多添加15个角色');
          return;
        }

        group.memberIds.push(ch.id);
        self._save();
        closeModal('addCharModal');
        self.openGroupSettings();
        showToast(ch.name + ' 已加入群聊');
      };
      container.appendChild(div);
    });
    document.getElementById('addCharModal').querySelector('h3').textContent = '添加成员';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },
  // 群头像更换菜单（上传/URL/清除）
  _changeGroupAvatarMenu: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var self = this;
    var container = document.getElementById('addCharList');
    container.innerHTML = '';
    var items = [
      { label: '上传图片', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M8 10V2"/><path d="M5 5l3-3 3 3"/><path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3"/></svg>', action: function() { closeModal('addCharModal'); self._uploadGroupAvatar(); } },
      { label: '输入URL', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M7 9l2-2"/><path d="M5 11a3 3 0 010-4l1-1"/><path d="M11 5a3 3 0 010 4l-1 1"/></svg>', action: function() { closeModal('addCharModal'); self._setGroupAvatarUrl(); } },
      { label: '恢复默认', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M4 7l-3 3 3 3"/><path d="M1 10h9a4 4 0 000-8H6"/></svg>', action: function() { closeModal('addCharModal'); self._clearGroupAvatar(); } }
    ];
    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '16px';
      div.style.fontSize = '14px';
      div.style.color = 'var(--text-primary)';
      div.innerHTML = item.svg + item.label;
      div.onclick = item.action;
      container.appendChild(div);
    });
    document.getElementById('addCharModal').querySelector('h3').textContent = '更换群头像';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 上传群聊头像
  _uploadGroupAvatar: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var self = this;
    closeModal('addCharModal');
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.onchange = async function(e) {
      var f = e.target.files[0]; if (!f) return;
      var compressed = await cbyd21_compressImg(f, 160, 0.72);
      group._avatar = compressed;
      self._save();
      document.getElementById('chatAvatar').innerHTML = '<img src="' + compressed + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      cbyd21_UI.renderMsgList();
      var _wAv = document.getElementById('welcomeAvatar');
      if (_wAv) _wAv.innerHTML = '<img src="' + compressed + '">';
      showToast('群头像已更换');
      setTimeout(function() { self.openGroupSettings(); }, 50);
      document.body.removeChild(inp);
    };
    document.body.appendChild(inp);
    inp.click();
  },

  // URL设置群聊头像
  _setGroupAvatarUrl: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var self = this;
    closeModal('addCharModal');
    openTextInputModal('群头像URL', '输入群头像图片URL', 'https://example.com/group.png', function(url) {
      if (!url.trim()) return;
      group._avatar = url.trim();
      self._save();
      document.getElementById('chatAvatar').innerHTML = '<img src="' + escHtml(url.trim()) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      cbyd21_UI.renderMsgList();
      var _wAv2 = document.getElementById('welcomeAvatar');
      if (_wAv2) _wAv2.innerHTML = '<img src="' + escHtml(url.trim()) + '">';
      showToast('群头像已更换');
      setTimeout(function() { self.openGroupSettings(); }, 50);
    });
  },

  // 清除群聊头像
  _clearGroupAvatar: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    group._avatar = null;
    this._save();
    document.getElementById('chatAvatar').innerHTML = '<span class="avatar-text" style="font-size:14px">👥</span>';
    cbyd21_UI.renderMsgList();
    var _wAv3 = document.getElementById('welcomeAvatar');
    if (_wAv3) _wAv3.innerHTML = '<span class="avatar-text" style="font-size:20px">👥</span>';
    showToast('群头像已清除');
    setTimeout(function() { cbyd21_Group.openGroupSettings(); }, 50);
  },

  // 应用群聊CSS美化
  _applyGroupCss: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var css = (document.getElementById('groupCustomCss').value || '').trim();
    group._chatCustomCss = css;
    this._save();
    document.getElementById('chatCustomStyle').textContent = css;
    showToast('样式已应用');
  },

  // 清除群聊CSS美化
  _clearGroupCss: function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    group._chatCustomCss = '';
    this._save();
    document.getElementById('chatCustomStyle').textContent = '';
    var el = document.getElementById('groupCustomCss');
    if (el) el.value = '';
    showToast('已清除');
  },

  // 清空群聊消息（选择面板）
  _clearGroupMessages: function() {
    var self = this;
    var group = this._getCurrentGroup();
    if (!group) return;
    closeModal('addCharModal');

    var container = document.getElementById('addCharList');
    container.innerHTML = '';

    var items = [
      { label: '清空当前分支', desc: '只清空当前分支的消息，其他分支不受影响', action: async function() {
        closeModal('addCharModal');
        var _yes = await customConfirm('确认清空当前分支的消息？');
        if (!_yes) return;
        var branch = self._getCurrentBranch();
        if (branch) { branch.messages = []; self._messages = branch.messages; }
        self._save();
        self._renderGroupMessages();
        showToast('当前分支已清空');
      }},
      { label: '清空所有分支', desc: '删除所有分支和消息，只保留一个空分支（不可恢复）', danger: true, action: async function() {
        closeModal('addCharModal');
        var _yes = await customConfirm('确认清空群聊「' + group.name + '」的所有消息？此操作不可恢复。');
        if (!_yes) return;
        var _newClearMsgBranch = { id: Date.now().toString(), title: '分支1', messages: [], created: Date.now() };
        var _oldGroupMsgBranchIds=group.branches.map(function(b){return b.id});
        var _oldGroupMsgOfflineSessions=group._offlineSessions ? group._offlineSessions.slice() : [];
        _oldGroupMsgOfflineSessions.forEach(function(s){
          if(s&&s.id&&typeof cbyd21_Offline!=='undefined'&&cbyd21_Offline._cleanupGroupOfflineSessionMemory){
            cbyd21_Offline._cleanupGroupOfflineSessionMemory(group.id,s.id);
          }
        });
        group.branches = [_newClearMsgBranch];
        group._offlineSessions = [];
        var _clearGroupMsgMemKey='group_'+group.id;
        if(charMemories[_clearGroupMsgMemKey]){
          charMemories[_clearGroupMsgMemKey]=charMemories[_clearGroupMsgMemKey].filter(function(m){return _oldGroupMsgBranchIds.indexOf(m._branchId)<0});
          cbyd21_Data.saveMemories();
        }
        var _clearGroupMsgStack = cbyd21_Group_safeJson('stm_summaryStack_' + _clearGroupMsgMemKey, []);
        _clearGroupMsgStack=_clearGroupMsgStack.filter(function(s){return _oldGroupMsgBranchIds.indexOf(s._branchId)<0});
        localStorage.setItem('stm_summaryStack_'+_clearGroupMsgMemKey,JSON.stringify(_clearGroupMsgStack));
        _oldGroupMsgBranchIds.forEach(function(bid){localStorage.removeItem('stm_lastSummaryRounds_'+_clearGroupMsgMemKey+'_online_'+bid)});
        var _clearGroupMsgOffRoundKeys=[];
        for(var _cgmi=0;_cgmi<localStorage.length;_cgmi++){
          var _cgmk=localStorage.key(_cgmi);
          if(_cgmk&&_cgmk.indexOf('stm_lastSummaryRounds_'+_clearGroupMsgMemKey+'_offline_')===0)_clearGroupMsgOffRoundKeys.push(_cgmk);
        }
        _clearGroupMsgOffRoundKeys.forEach(function(k){localStorage.removeItem(k)});
        group._lastBranchId = _newClearMsgBranch.id;
        self._currentBranchIdx = 0;
        self._messages = group.branches[0].messages;
        self._save();
        self._renderGroupMessages();
        self._renderGroupBranchList();
        showToast('所有分支已清空');
      }}
    ];

    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '14px 16px';
      div.style.flexDirection = 'column';
      div.style.alignItems = 'flex-start';
      div.style.gap = '4px';
      div.innerHTML = '<div style="font-size:14px;font-weight:600;color:' + (item.danger ? 'var(--danger)' : 'var(--text-primary)') + '">' + item.label + '</div><div style="font-size:11px;color:var(--text-muted);line-height:1.5">' + item.desc + '</div>';
      div.onclick = item.action;
      container.appendChild(div);
    });

    document.getElementById('addCharModal').querySelector('h3').textContent = '清空群聊消息';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // _pushGroupOnlineAutoSummaryFailStack(memKey, branchId, visibleMessages, reason)
  // → 群聊线上自动总结触发后，如果因为忙碌 / API 未配置 / 消息不足没有真正启动，
  //   写入 failed 空栈道，方便用户之后手写填入或重新总结。
  _pushGroupOnlineAutoSummaryFailStack:function(memKey, branchId, visibleMessages, reason, skipToast){
    if(!memKey || !branchId)return;

    visibleMessages = visibleMessages || [];

    var stack = cbyd21_Group_safeJson('stm_summaryStack_' + memKey, []);
    var lastTo = 0;

    stack.forEach(function(s){
      if(
        !s.deleted &&
        s.to &&
        s.label &&
        s.label.indexOf('群聊') >= 0 &&
        s.label.indexOf('线下群聊') < 0 &&
        s._branchId === branchId
      ){
        if(s.to > lastTo)lastTo = s.to;
      }
    });

    var from = lastTo > 0 ? lastTo + 1 : 1;
    var to = visibleMessages.length;

    if(to < from)to = from;

    var sourceTs = visibleMessages.length && typeof _getSourceTsFromMessages === 'function'
      ? _getSourceTsFromMessages(visibleMessages, from, Math.min(to, visibleMessages.length))
      : Date.now();

    stack.push({
      memoryId:null,
      from:from,
      to:to,
      deleted:false,
      failed:true,
      label:'群聊自动总结 · 第' + from + '~' + to + '条 · 失败（' + reason + '）',
      _branchId:branchId,
      _sourceTs:sourceTs,
      _sourceSeq:to,
      _sourceType:'group_online',
      _failReason:reason
    });

    localStorage.setItem('stm_summaryStack_' + memKey, JSON.stringify(stack));

    if(!skipToast && typeof showAutoSummaryError === 'function'){
      showAutoSummaryError('群聊自动总结未完成：' + reason);
    }

    if(typeof _refreshMemoryListsIfVisible === 'function'){
      _refreshMemoryListsIfVisible();
    }

    if(typeof _renderAutoSummaryProgress === 'function'){
      _renderAutoSummaryProgress(memKey, 'memModalAutoProgress');
      _renderAutoSummaryProgress(memKey, 'memDetailAutoProgress');
    }
  },

  // 群聊线上记忆自动总结
  // · 只在开启自动总结 + 勾选线上 + 达到轮数时触发
  // · 轮数按群聊分支隔离，避免A分支影响B分支
  _checkGroupAutoSummary: function(group) {
    var memKey = 'group_' + group.id;
    var settings = getMemorySettings(memKey);
    if (!settings.autoSummary) return;

    var _asMods = settings.autoSummaryModules || [];
    if (_asMods.indexOf('online') < 0) return;

    var _lockedBranchIdx = this._currentBranchIdx || 0;
    var _lockedBranch = group.branches && group.branches[_lockedBranchIdx];
    var _lockedBranchId = _lockedBranch ? _lockedBranch.id : null;
    var _lockedMessages = this._messages ? this._messages.slice() : [];

    if (!_lockedBranchId || _lockedMessages.length < 3) return;

    var userMsgCount = _lockedMessages.filter(function(m) {
      return m &&
        m._mode !== 'ooc' &&
        m.role === 'user' &&
        m.content !== '__system_init__' &&
        m.content !== '__system_continue__';
    }).length;

    var _roundsKey = 'stm_lastSummaryRounds_' + memKey + '_online_' + (_lockedBranchId || '');
    var lastRounds = parseInt(localStorage.getItem(_roundsKey) || '0');
    var interval = settings.interval || 20;

    if (userMsgCount - lastRounds >= interval) {
      if(typeof _cbyd21MemoryPromptReadyOrToast === 'function' && !_cbyd21MemoryPromptReadyOrToast(true)){
        return;
      }

      var _groupAutoVisibleMessages = typeof _memoryVisibleSourceMessages === 'function'
        ? _memoryVisibleSourceMessages(_lockedMessages || [])
        : (_lockedMessages || []).filter(function(m){
            return m && m.content !== '__system_init__' && m.content !== '__system_continue__';
          });

      if (_isSummarizing) {
        localStorage.setItem(_roundsKey, userMsgCount.toString());
        this._pushGroupOnlineAutoSummaryFailStack(memKey, _lockedBranchId, _groupAutoVisibleMessages, '已有一条总结正在生成');
        return;
      }

      var _groupAutoApi = getSummaryApiConfig();

      if (!_groupAutoApi.url || !_groupAutoApi.key || !_groupAutoApi.model) {
        localStorage.setItem(_roundsKey, userMsgCount.toString());
        this._pushGroupOnlineAutoSummaryFailStack(memKey, _lockedBranchId, _groupAutoVisibleMessages, '未配置总结 API');
        return;
      }

      if (_groupAutoVisibleMessages.length < 3) {
        localStorage.setItem(_roundsKey, userMsgCount.toString());
        this._pushGroupOnlineAutoSummaryFailStack(memKey, _lockedBranchId, _groupAutoVisibleMessages, '当前群聊分支消息太少，自动总结未启动');
        return;
      }

      localStorage.setItem(_roundsKey, userMsgCount.toString());
      this._doGroupAutoSummary(group, _lockedBranchId, _lockedMessages);
    }
  },

  // _doGroupAutoSummary(group,_lockedBranchId,_lockedMessages) →执行群聊自动总结
  // · 使用触发时锁定的分支和消息，避免异步期间切分支写错
  // · 成功/失败栈都写入 _branchId
  _doGroupAutoSummary: async function(group, _lockedBranchId, _lockedMessages) {
    if (_isSummarizing) return;

    if(typeof _cbyd21PromptsLoaded !== 'undefined' && !_cbyd21PromptsLoaded){
      if(typeof cbyd21_LoadPrompts === 'function'){
        cbyd21_LoadPrompts().catch(function(e){
          console.warn('提示词加载失败：', e);
        });
      }

      return;
    }

    var memKey = 'group_' + group.id;
    var sApi = getSummaryApiConfig();
    if (!sApi.url || !sApi.key || !sApi.model) return;

    var _gaSourceMessages = _lockedMessages && _lockedMessages.length ? _lockedMessages : (this._messages || []);
    var _gaVisibleMessages = typeof _memoryVisibleSourceMessages === 'function'
      ? _memoryVisibleSourceMessages(_gaSourceMessages)
      : _gaSourceMessages.filter(function(m) {
          return m && m.content !== '__system_init__' && m.content !== '__system_continue__';
        });

    if (!_lockedBranchId || _gaVisibleMessages.length < 3) return;

    _isSummarizing = true;

    var settings = getMemorySettings(memKey);
    var promptText = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
    var customHint = settings.customPrompt && settings.customPrompt.trim() ? '\n\n[总结辅助提示词]\n' + settings.customPrompt.trim() : '';

    // 读栈找到当前分支上次总结的结束位置
    var _gaAutoKey = 'stm_summaryStack_' + memKey;
    var _gaAutoStackCheck = cbyd21_Group_safeJson(_gaAutoKey, []);
    var _gaLastTo = 0;

    _gaAutoStackCheck.forEach(function(s) {
      if (
        !s.deleted &&
        s.to &&
        s.label &&
        s.label.indexOf('群聊') >= 0 &&
        s.label.indexOf('线下群聊') < 0 &&
        s._branchId === _lockedBranchId
      ) {
        if (s.to > _gaLastTo) _gaLastTo = s.to;
      }
    });

    var _gaSliceFrom = _gaLastTo > 0 ? _gaLastTo : 0;
    var recentMsgs = _gaVisibleMessages.slice(_gaSliceFrom);

    if (recentMsgs.length < 2) {
      _isSummarizing = false;
      return;
    }

    var memberNames = {};
    group.memberIds.forEach(function(mid) {
      var mc = getCharById(mid);
      if (mc) memberNames[mid] = mc.name;
    });

    var msgs = recentMsgs.map(function(m) {
      var c = m.content || '';

      if (typeof _cbyd21MemoryCleanContent === 'function') {
        c = _cbyd21MemoryCleanContent(c);
      } else if (typeof _cbyd21MessageContentForUserAction === 'function') {
        c = _cbyd21MessageContentForUserAction(c);
      }

      if (m.role === 'user') return '用户: ' + c.slice(0, 200);

      var name = m._charId && memberNames[m._charId] ? memberNames[m._charId] : '角色';
      return name + ': ' + c.slice(0, 200);
    }).join('\n');

    var _gaFailFrom = _gaSliceFrom + 1;
    var _gaFailTo = _gaVisibleMessages.length;
    var _gaBranch = _lockedBranchId;

    try {
      var url = sApi.url.replace(/\/+$/, '') + '/chat/completions';
      var _gaSys = '[群聊记录总结]\n群聊成员：' + Object.values(memberNames).join('、') + '\n' + promptText + customHint;

      var _groupAutoSummaryBody = {
        model:sApi.model,
        messages:[
          { role:'system', content:_gaSys },
          { role:'user', content:'请总结以下群聊记录：\n\n' + msgs }
        ]
      };

      if(sApi.temperature !== undefined){
        _groupAutoSummaryBody.temperature = sApi.temperature;
      }

      var r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sApi.key
        },
        body: JSON.stringify(_groupAutoSummaryBody)
      });

      var _rawGroupAutoSummaryText = await r.text();

      if (!r.ok) {
        this._pushGroupOnlineAutoSummaryFailStack(
          memKey,
          _gaBranch,
          _gaVisibleMessages,
          'HTTP ' + r.status,
          true
        );

        showAutoSummaryError('群聊总结HTTP ' + r.status + ': ' + _rawGroupAutoSummaryText.slice(0, 200));
        _isSummarizing = false;
        return;
      }

      var _parsedGroupAutoSummaryText = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawGroupAutoSummaryText)
        : {data:null,text:_rawGroupAutoSummaryText};

      var d = _parsedGroupAutoSummaryText.data || {};
      var summary = _parsedGroupAutoSummaryText.text || (
        typeof _cbyd21ExtractChatApiContent === 'function'
          ? _cbyd21ExtractChatApiContent(d)
          : (
              typeof _extractApiContent === 'function'
                ? _extractApiContent(d)
                : (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '')
            )
      );

      summary = String(summary || '');

      if (!summary.trim()) {
        this._pushGroupOnlineAutoSummaryFailStack(
          memKey,
          _gaBranch,
          _gaVisibleMessages,
          'API返回空内容',
          true
        );

        showAutoSummaryError('群聊总结API返回空内容');
        _isSummarizing = false;
        return;
      }

      if (!charMemories[memKey]) charMemories[memKey] = [];

      var _gaAutoStack = cbyd21_Group_safeJson(_gaAutoKey, []);
      var _gaAutoFrom = _gaSliceFrom + 1;
      var _gaAutoTo = _gaVisibleMessages.length;
      var _gaSourceTs = _getSourceTsFromMessages(_gaVisibleMessages, _gaAutoFrom, _gaAutoTo);

      var _gaAutoEntry = {
        id: Date.now().toString(),
        content: '[群聊] ' + summary.trim(),
        type: 'auto',
        time: formatTime(Date.now()),
        _branchId: _gaBranch,
        _sourceTs: _gaSourceTs,
        _sourceSeq: _gaAutoTo,
        _sourceType: 'group_online'
      };

      charMemories[memKey].push(_gaAutoEntry);
      _sortMemoryArrayInPlace(charMemories[memKey]);

      _gaAutoStack.push({
        memoryId: _gaAutoEntry.id,
        from: _gaAutoFrom,
        to: _gaAutoTo,
        deleted: false,
        label: '群聊自动总结 · 第' + _gaAutoFrom + '~' + _gaAutoTo + '条',
        _branchId: _gaBranch,
        _sourceTs: _gaSourceTs,
        _sourceSeq: _gaAutoTo,
        _sourceType: 'group_online'
      });

      localStorage.setItem(_gaAutoKey, JSON.stringify(_gaAutoStack));
      cbyd21_Data.saveMemories();
      showToast('群聊自动总结完成');

      _refreshMemoryListsIfVisible();
      _renderAutoSummaryProgress(memKey, 'memModalAutoProgress');
      _renderAutoSummaryProgress(memKey, 'memDetailAutoProgress');
    } catch (e) {
      this._pushGroupOnlineAutoSummaryFailStack(
        memKey,
        _gaBranch,
        _gaVisibleMessages,
        e && e.message ? e.message : '未知错误',
        true
      );

      showAutoSummaryError('群聊自动总结失败：' + (e.message || ''));
    }

    _isSummarizing = false;
  },

  // 设置某成员的记忆来源分支
  _setMemberBranch: function(memberId, branchId) {
    var group = this._getCurrentGroup();
    if (!group) return;
    if (!group._memberBranches) group._memberBranches = {};
    if (branchId) { group._memberBranches[memberId] = branchId; }
    else { delete group._memberBranches[memberId]; }
    this._save();
    showToast('记忆来源已设置');
  },

  // 表情包挂载开关
  _toggleGroupSticker: function(groupId, on) {
    var group = this._getCurrentGroup();
    if (!group) return;
    if (!group._stickerGroupIds) group._stickerGroupIds = [];
    if (on) { if (group._stickerGroupIds.indexOf(groupId) < 0) group._stickerGroupIds.push(groupId); }
    else { group._stickerGroupIds = group._stickerGroupIds.filter(function(id) { return id !== groupId; }); }
    this._save();
    showToast('表情包设置已保存');
  },

  // 删除群聊
  _deleteGroup: async function() {
    var group = this._getCurrentGroup();
    if (!group) return;
    var _yes = await customConfirm('确认删除群聊「' + group.name + '」及所有聊天记录？');
    if (!_yes) return;
    closeModal('addCharModal');
    var _gsp = document.getElementById('groupSettingsPanel');
    if (_gsp) _gsp.classList.remove('active');
    this._cleanupGroupMemoryData(group.id);
    this._groups = this._groups.filter(function(g) { return g.id !== group.id; });
    this._save();
    this.exitGroupChat();
    exitChatView();
    showToast('群聊已删除');
  }
};

// 数据保护：页面关闭/刷新时自动保存群聊数据
window.addEventListener('beforeunload', function() {
  if(typeof _cbyd21ClearingAllData !== 'undefined' && _cbyd21ClearingAllData)return;

  if (cbyd21_Group._currentGroupId && cbyd21_Group._messages && cbyd21_Group._messages.length > 0) {
    cbyd21_Group._save();
  }
});
