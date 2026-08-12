// ===== 【模块】cbyd21_Location — 定位/共享位置 =====
// 从 index.html 主文件拆出
// 包含：发送定位、共享位置、定位卡片渲染、共享位置横幅
// 依赖主文件：cbyd21_Location对象声明(var cbyd21_Location={})、
//getCurrentChat、getCurrentProfile、getChatChar、escHtml、
//   showToast、formatTime、openModal、closeModal、openTextInputModal、
//   cbyd21_Data、cbyd21_Chat、cbyd21_UI、currentChatCharId、
//   isGenerating、apiConfig、scrollToBottom、processContent

// ============================================================
// 共享位置实时状态
// ============================================================
// _sharing→ 是否正在共享位置（bool）
// _shareData  → 用户自己的位置数据 {name, addr}
// _shareCharId → 共享位置对应的角色ID（切角色时判断）

cbyd21_Location._sharing = false;
cbyd21_Location._shareStatus = 'none'; // none / pending_char / pending_user / active
cbyd21_Location._shareData = null;
cbyd21_Location._shareCharLoc = null;
cbyd21_Location._shareCharId = null;
cbyd21_Location._shareChangeText = '';

// ============================================================
// startShareInviteBar(charLocData) → 角色发起共享位置邀请时显示横幅
// _isInlineOfflineActive()
// → 当前单聊分支是否处于线上内嵌线下。
// 线上内嵌线下期间，普通线上定位 / 共享位置功能不允许触发。
cbyd21_Location._isInlineOfflineActive = function(){
  try{
    var chatView = document.getElementById('chatView');

    // 群聊不走单聊线上内嵌线下判断。
    // 避免在群聊里调用 getCurrentChat()，误读或误创建单聊分支。
    if(chatView && chatView.dataset.groupMode === 'true'){
      return false;
    }

    if(
      window.cbyd21_InlineOffline &&
      cbyd21_InlineOffline.isEnabledForCurrentChat &&
      cbyd21_InlineOffline.isEnabledForCurrentChat()
    ){
      return true;
    }

    if(typeof getCurrentChat === 'function'){
      var chat = getCurrentChat();

      return !!(chat && chat._inlineOffline && chat._inlineOffline.enabled);
    }
  }catch(e){}

  return false;
};

// · 用户位置等待填写
// · 角色位置已知
// ============================================================
cbyd21_Location.startShareInviteBar = function(charLocData, silent) {
  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    this.stopShareLocation(true);
    if(!silent)showToast('线上内嵌线下中，不能发起共享位置');
    return;
  }

  if(this._sharing&&this._shareCharId===currentChatCharId&&(this._shareStatus==='active'||this._shareStatus==='pending_char')){
    this.updateShareBarCharLoc(charLocData);
    if(!silent)showToast('对方更新了共享位置');
    return;
  }
  this._sharing = true;
  this._shareStatus = 'pending_user';
  this._shareData = null;
  this._shareCharLoc = charLocData;
  this._shareCharId = currentChatCharId;
  this._shareChangeText = '';

  var bar = document.getElementById('shareLocationBar');
  if (!bar) return;
  bar.style.display = 'flex';

  var userLocEl = document.getElementById('shareLocationBarUserLoc');
  if (userLocEl) {
    userLocEl.textContent = '等待中…';
    userLocEl.title = '';
    userLocEl.style.whiteSpace = 'nowrap';
    userLocEl.style.maxWidth = '90px';
    userLocEl.onclick = function(){ showToast('请点击聊天里的共享位置卡片接受或拒绝'); };
  }

  var charLocEl = document.getElementById('shareLocationBarCharLoc');
  if (charLocEl) {
    charLocEl.textContent = cbyd21_Location._locMainText(charLocData.name, '角色位置');
    charLocEl.title = cbyd21_Location._locDisplayText(charLocData.name, '') + (charLocData.addr ? ' · ' + cbyd21_Location._locDisplayText(charLocData.addr, '') : '');
    charLocEl.style.whiteSpace = 'nowrap';
    charLocEl.style.maxWidth = '90px';
  }

  var userAvEl = document.getElementById('shareLocationBarUserAv');
  if (userAvEl) {
    var _chat0 = getCurrentChat();
    var _branchUa0 = _chat0 && _chat0._userAvatar;
    var up0 = getCurrentProfile();
    if (_branchUa0) {
      userAvEl.innerHTML = '<img src="' + _branchUa0 + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else if (up0.avatar) {
      userAvEl.innerHTML = '<img src="' + up0.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      userAvEl.innerHTML = '<span class="avatar-text">' + escHtml((up0.name || '我').charAt(0)) + '</span>';
    }
  }

  var charAvEl = document.getElementById('shareLocationBarCharAv');
  if (charAvEl) {
    var ch0 = getChatChar();
    if (ch0 && ch0.avatar) {
      charAvEl.innerHTML = '<img src="' + ch0.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      charAvEl.innerHTML = '<span class="avatar-text">' + escHtml(ch0 ? ch0.name.charAt(0) : '角') + '</span>';
    }
  }

  if(!silent)showToast('对方发来了共享位置邀请，可点击卡片接受或拒绝');
};

// ============================================================
// startShareBar(data) → 启动共享位置横幅条
// ·用户发送共享位置消息后调用
// · 在聊天顶栏下方显示一条实时共享位置横幅
// · 横幅里有：用户头像+位置名、角色头像+位置名、停止按钮
// · data = { name: '位置名', addr: '地址' }
// ============================================================
cbyd21_Location.startShareBar = function(data) {
  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    this.stopShareLocation(true);
    showToast('线上内嵌线下中，不能开启共享位置');
    return;
  }

  this._sharing = true;
  this._shareData = data;
  this._shareCharId = currentChatCharId;
  if(!this._shareCharLoc)this._shareCharLoc = null;
  this._shareStatus = this._shareCharLoc ? 'active' : 'pending_char';
  var bar = document.getElementById('shareLocationBar');
  if (!bar) return;
  bar.style.display = 'flex';

  // 用户位置名
  var userLocEl = document.getElementById('shareLocationBarUserLoc');
  if (userLocEl) {
    userLocEl.textContent = cbyd21_Location._locMainText(data.name, '我的位置');
    userLocEl.title = cbyd21_Location._locDisplayText(data.name, '') + (data.addr ? ' · ' + cbyd21_Location._locDisplayText(data.addr, '') : '');
    userLocEl.style.whiteSpace = 'nowrap';
    userLocEl.style.maxWidth = '90px';
    userLocEl.onclick = function(){ cbyd21_Location.openUpdateUserShareLocation(); };
  }

  // 角色位置名（等AI回发定位后更新）
  var charLocEl = document.getElementById('shareLocationBarCharLoc');
  if (charLocEl) {
    if(this._shareCharLoc){
      charLocEl.textContent = cbyd21_Location._locMainText(this._shareCharLoc.name, '角色位置');
      charLocEl.title = cbyd21_Location._locDisplayText(this._shareCharLoc.name, '') + (this._shareCharLoc.addr ? ' · ' + cbyd21_Location._locDisplayText(this._shareCharLoc.addr, '') : '');
    }else{
      charLocEl.textContent = '等待中…';
      charLocEl.title = '';
    }
    charLocEl.style.whiteSpace = 'nowrap';
    charLocEl.style.maxWidth = '90px';
  }

  // 用户头像
  var userAvEl = document.getElementById('shareLocationBarUserAv');
  if (userAvEl) {
    var _chat3 = getCurrentChat();
    var _branchUa3 = _chat3 && _chat3._userAvatar;
    var up3 = getCurrentProfile();
    if (_branchUa3) {
      userAvEl.innerHTML = '<img src="' + _branchUa3 + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else if (up3.avatar) {
      userAvEl.innerHTML = '<img src="' + up3.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      userAvEl.innerHTML = '<span class="avatar-text">' + escHtml((up3.name || '我').charAt(0)) + '</span>';
    }
  }

  // 角色头像
  var charAvEl = document.getElementById('shareLocationBarCharAv');
  if (charAvEl) {
    var ch3 = getChatChar();
    if (ch3 && ch3.avatar) {
      charAvEl.innerHTML = '<img src="' + ch3.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      charAvEl.innerHTML = '<span class="avatar-text">' + escHtml(ch3 ? ch3.name.charAt(0) : '角') + '</span>';
    }
  }
};

// ============================================================
// updateShareBarCharLoc(locData) → 更新共享位置横幅里的角色位置
// · AI回发定位消息后由splitAndAppendAiReply 调用
// · locData = { name: '角色位置名', addr: '地址' }
// ============================================================
cbyd21_Location.updateShareBarCharLoc = function(locData) {
  if (!this._sharing) return;
  if(this._shareCharLoc && (this._shareCharLoc.name !== locData.name || this._shareCharLoc.addr !== locData.addr)){
    this._shareChangeText = '角色共享位置已更新';
  }
  this._shareCharLoc = locData;
  this._shareStatus = this._shareData ? 'active' : 'pending_user';
  var charLocEl = document.getElementById('shareLocationBarCharLoc');
  if (charLocEl) {
    charLocEl.textContent = cbyd21_Location._locMainText(locData.name, '角色位置');
    charLocEl.title = cbyd21_Location._locDisplayText(locData.name, '') + (locData.addr ? ' · ' + cbyd21_Location._locDisplayText(locData.addr, '') : '');
    charLocEl.style.whiteSpace = 'nowrap';
    charLocEl.style.maxWidth = '90px';
  }
};

// ============================================================
// _splitLocBilingualText(text) → 拆分定位里的双语文本
// · 支持：原文__bilingual_split__中文翻译
// · 兼容：原文（中文翻译）
// · 返回 { main, trans, full }
// ============================================================
cbyd21_Location._splitLocBilingualText = function(text) {
  text = String(text || '').trim();

  if (!text) {
    return { main: '', trans: '', full: '' };
  }

  if (text.indexOf('__bilingual_split__') >= 0) {
    var parts = text.split('__bilingual_split__');
    var main = (parts[0] || '').trim();
    var trans = parts.slice(1).join('').trim();

    return {
      main: main,
      trans: trans,
      full: main && trans ? main + '（' + trans + '）' : (main || trans)
    };
  }

  var parenMatch = text.match(/^(.+?)（(.+?)）$/);
  if (parenMatch) {
    return {
      main: parenMatch[1].trim(),
      trans: parenMatch[2].trim(),
      full: text
    };
  }

  return {
    main: text,
    trans: '',
    full: text
  };
};

// _locDisplayText(text,fallback) → 定位卡片显示用文本
// · 有翻译时显示：原文（中文翻译）
// · 没翻译时显示原文
cbyd21_Location._locDisplayText = function(text, fallback) {
  var d = this._splitLocBilingualText(text);
  return d.full || fallback || '';
};

// _locMainText(text,fallback) → 顶部共享位置条显示用短文本
// · 顶部条空间小，只显示主文本，完整双语放 title
cbyd21_Location._locMainText = function(text, fallback) {
  var d = this._splitLocBilingualText(text);
  return d.main || d.full || fallback || '';
};

// ============================================================
// _toggleLocExpand(el) → 定位文字横向查看辅助
// · 定位/共享位置文字现在使用横向滚动查看完整内容
// · 点击时只在“滚到末尾 / 回到开头”之间切换
// · 不再展开成多行，避免撑坏顶部共享位置条布局
// ============================================================
cbyd21_Location._toggleLocExpand = function(el) {
  if(!el)return;

  el.style.whiteSpace = 'nowrap';
  el.style.overflowX = 'auto';
  el.style.overflowY = 'hidden';
  el.style.textOverflow = 'clip';
  el.style.webkitOverflowScrolling = 'touch';

  if(el.scrollWidth <= el.clientWidth){
    return;
  }

  if(el.scrollLeft > 2){
    el.scrollLeft = 0;
  }else{
    el.scrollLeft = el.scrollWidth;
  }
};

// ============================================================
// openUpdateUserShareLocation() → 用户点击顶部栏自己的位置后修改共享位置
// ============================================================
cbyd21_Location.openUpdateUserShareLocation = function() {
  if (!this._sharing || !this._shareData) {
    showToast('当前没有可修改的共享位置');
    return;
  }

  var container = document.getElementById('addCharList');
  container.innerHTML = '<div style="padding:16px"><div class="form-group"><label class="form-label">当前位置</label><input class="form-input" id="updateShareLocName" value="' + escHtml(this._shareData.name || '') + '" placeholder="位置名称"></div><div class="form-group"><label class="form-label">详细地址（选填）</label><input class="form-input" id="updateShareLocAddr" value="' + escHtml(this._shareData.addr || '') + '" placeholder="地址或描述"></div><button class="btn primary" onclick="cbyd21_Location._doUpdateUserShareLocation()" style="width:100%;margin-top:8px">更新位置</button></div>';
  document.getElementById('addCharModal').querySelector('h3').textContent = '更新共享位置';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
  setTimeout(function(){var inp=document.getElementById('updateShareLocName');if(inp)inp.focus()},150);
};

// _doUpdateUserShareLocation() → 保存用户修改后的共享位置
cbyd21_Location._doUpdateUserShareLocation = function() {
  var name = (document.getElementById('updateShareLocName').value || '').trim();
  var addr = (document.getElementById('updateShareLocAddr').value || '').trim();
  if (!name) { showToast('请输入位置名称'); return; }
  closeModal('addCharModal');

  var oldName = this._shareData && this._shareData.name || '';
  var oldAddr = this._shareData && this._shareData.addr || '';
  this._shareData = { name: name, addr: addr || '' };
  if(oldName !== name || oldAddr !== addr){
    this._shareChangeText = '用户共享位置已更新';
  }
  this._shareStatus = this._shareCharLoc ? 'active' : 'pending_char';

  var userLocEl = document.getElementById('shareLocationBarUserLoc');
  if (userLocEl) {
    userLocEl.textContent = cbyd21_Location._locMainText(name, '我的位置');
    userLocEl.title = cbyd21_Location._locDisplayText(name, '') + (addr ? ' · ' + cbyd21_Location._locDisplayText(addr, '') : '');
    userLocEl.style.whiteSpace = 'nowrap';
    userLocEl.style.maxWidth = '90px';
  }

  var chat = getCurrentChat();
  if(chat){
    var time = formatTime(Date.now());
    var content = '__share_location__' + JSON.stringify(this._shareData);
    chat.messages.push({ role: 'user', content: content, time: time, _ts: Date.now() });
    cbyd21_Chat.appendMessageDOM('user', content, time, true, chat.messages.length - 1);
    cbyd21_Data.saveChats();
    cbyd21_UI.renderBranchList();
    scrollToBottom();
  }

  showToast('共享位置已更新');
};

// ============================================================
// stopShareLocation() → 停止共享位置
// ·隐藏共享位置横幅条
// · 清空共享状态（_sharing/_shareData/_shareCharId/_shareCharLoc）
// · 用户点击横幅上的✕按钮 或 退出聊天/切换分支时调用
// ============================================================
cbyd21_Location.stopShareLocation = function(silent) {
  var _wasSharing=this._sharing;
  var _shareChatCharId=this._shareCharId;

  this._sharing = false;
  this._shareStatus = 'none';
  this._shareData = null;
  this._shareCharId = null;
  this._shareCharLoc = null;
  this._shareChangeText = '';
  this._pendingCharLoc = null;

  var bar = document.getElementById('shareLocationBar');
  if (bar) bar.style.display = 'none';

  if(!silent&&_wasSharing&&_shareChatCharId===currentChatCharId){
    var chat=getCurrentChat();
    if(chat){
      var time=formatTime(Date.now());
      var content='__share_end__';
      chat.messages.push({role:'user',content:content,time:time,_ts:Date.now()});
      cbyd21_Chat.appendMessageDOM('user',content,time,true,chat.messages.length-1);
      cbyd21_Data.saveChats();
      cbyd21_UI.renderBranchList();
      scrollToBottom();
    }
  }

  if(!silent)showToast('共享位置已结束');
};

// ============================================================
// _checkPendingShareBeforeUserAction(reason) → 用户未处理角色共享邀请时自动视为未回应
// · reason='message' 用户继续发普通消息
// · reason='trigger' 用户直接点触发键
// ============================================================
cbyd21_Location._checkPendingShareBeforeUserAction = function(reason) {
  if (this._shareStatus !== 'pending_user' && this._shareStatus === 'none' && this.restoreShareStateFromHistory) {
    this.restoreShareStateFromHistory(true);
  }
  if (this._shareStatus !== 'pending_user') return false;

  var chat = getCurrentChat();
  var charLoc = this._shareCharLoc;
  this.stopShareLocation(true);

  if (chat) {
    var time = formatTime(Date.now());
    var content = '__share_ignore__' + JSON.stringify({ name: charLoc && charLoc.name || '', reason: reason || '' });
    document.getElementById('welcomeBlock').style.display = 'none';
    chat.messages.push({ role: 'user', content: content, time: time, _ts: Date.now() });
    cbyd21_Chat.appendMessageDOM('user', content, time, true, chat.messages.length - 1);
    cbyd21_Data.saveChats();
    cbyd21_UI.renderBranchList();
    scrollToBottom();
  }

  return true;
};

// ============================================================
// restoreShareStateFromHistory(silent) → 从当前聊天历史恢复共享位置状态
// · 用于进入聊天/切分支/刷新重渲染后恢复顶部共享位置栏
// · 根据最后一段共享位置相关消息判断当前状态
// ============================================================
cbyd21_Location.restoreShareStateFromHistory = function(silent) {
  if(document.getElementById('chatView').dataset.groupMode==='true'){
    this.stopShareLocation(true);
    return false;
  }

  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    this.stopShareLocation(true);
    return false;
  }

  var chat = getCurrentChat();
  if(!chat || !chat.messages){
    this.stopShareLocation(true);
    return false;
  }

  var userLoc = null;
  var charLoc = null;
  var status = 'none';

  chat.messages.forEach(function(m){
    var c = m && m.content || '';

    if(c.startsWith('__share_end__') || c.startsWith('__share_ignore__') || c.startsWith('__share_reject__')){
      userLoc = null;
      charLoc = null;
      status = 'none';
      return;
    }

    if(c.startsWith('__share_invite__')){
      try{
        charLoc = JSON.parse(c.slice(16));
        userLoc = null;
        status = 'pending_user';
      }catch(e){}
      return;
    }

    if(c.startsWith('__share_location__')){
      try{
        userLoc = JSON.parse(c.slice(18));
        status = charLoc ? 'active' : 'pending_char';
      }catch(e){}
      return;
    }

    if(c.startsWith('__share_response__')){
      try{
        var d = JSON.parse(c.slice(18));
        charLoc = d.charLoc || d;
        if(d.userLoc)userLoc = d.userLoc;
        status = userLoc ? 'active' : 'pending_user';
      }catch(e){}
      return;
    }
  });

  if(status === 'none'){
    this.stopShareLocation(true);
    return false;
  }

  this._shareData = userLoc;
  this._shareCharLoc = charLoc;
  this._shareCharId = currentChatCharId;
  this._shareChangeText = '';

  if(status === 'pending_user' && charLoc){
    this.startShareInviteBar(charLoc, true);
    return true;
  }

  if(userLoc){
    this.startShareBar(userLoc);
    this._shareStatus = status;
    return true;
  }

  if(charLoc){
    this.startShareInviteBar(charLoc, true);
    return true;
  }

  this.stopShareLocation(true);
  return false;
};

// ============================================================
// renderShareResponseCard(charLocData) → 渲染共享位置响应卡片
// · 当共享位置进行中，AI回发定位时渲染此卡片
// · 卡片显示：角色位置名+地址 + 用户和角色双头像 + 连线
// · 返回HTML字符串，由 processContent 调用
// ============================================================
cbyd21_Location.renderShareResponseCard = function(charLocData) {
  charLocData = charLocData || {};
  var realCharLoc = charLocData.charLoc || charLocData || {};
  var userData = charLocData.userLoc || this._shareData || {};
  var userName = escHtml(this._locDisplayText(userData.name, '用户位置'));
  var charName = escHtml(this._locDisplayText(realCharLoc.name, '角色位置'));
  var charAddr = escHtml(this._locDisplayText(realCharLoc.addr, ''));

  // 获取用户头像
  var _slUp2 = getCurrentProfile();
  var _slChat2 = getCurrentChat();
  var _slBranchUa2 = _slChat2 && _slChat2._userAvatar;
  var _slAvUser2 = '';
  if (_slBranchUa2) { _slAvUser2 = '<img src="' + _slBranchUa2 + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
  else if (_slUp2.avatar) { _slAvUser2 = '<img src="' + _slUp2.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
  else { _slAvUser2 = '<span style="font-size:9px;color:var(--text-secondary)">' + escHtml((_slUp2.name || '我').charAt(0)) + '</span>'; }

  // 获取角色头像
  var _slCh2 = getChatChar();
  var _slAvChar2 = '';
  if (_slCh2 && _slCh2.avatar) { _slAvChar2 = '<img src="' + _slCh2.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
  else { _slAvChar2 = '<span style="font-size:9px;color:var(--accent)">' + (_slCh2 ? escHtml(_slCh2.name.charAt(0)) : '角') + '</span>'; }

  var _srcUid ='slr_u_' + Math.random().toString(36).slice(2, 8);
  var _srcCid = 'slr_c_' + Math.random().toString(36).slice(2, 8);

  return '<div style="background:rgba(124,111,155,0.1);border:1px solid rgba(124,111,155,0.18);border-radius:12px;padding:12px 14px;min-width:200px;max-width:260px">'+ '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>'
    + '<span style="font-size:13px;font-weight:500;color:var(--text-secondary)">共享位置</span></div>'
    + '<div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:2px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;cursor:grab;-webkit-overflow-scrolling:touch;scrollbar-width:none" onclick="event.stopPropagation()" title="' + charName + (charAddr ? ' · ' + charAddr : '') + '">' + charName + '</div>'
    + (charAddr ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;cursor:grab;-webkit-overflow-scrolling:touch;scrollbar-width:none" onclick="event.stopPropagation()" title="' + charAddr + '">' + charAddr + '</div>' : '')
    + '<div style="display:flex;align-items:flex-end;gap:6px;padding:8px 0;border-top:1px solid var(--border-soft)">'
    + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">'
    + '<div id="' + _srcUid + '" style="font-size:9px;color:var(--text-muted);max-width:70px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;cursor:grab;text-align:center;-webkit-overflow-scrolling:touch;scrollbar-width:none" onclick="event.stopPropagation()" title="' + userName + '">' + userName + '</div>'
    + '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg-tertiary);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;overflow:hidden">' + _slAvUser2 + '</div></div>'
    + '<div style="flex:1;height:2px;background:var(--border-soft);position:relative;align-self:center">'
    + '<div style="position:absolute;top:-3px;left:40%;width:8px;height:8px;border-radius:50%;background:var(--accent);opacity:0.5"></div></div>'
    + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">'
    + '<div id="' + _srcCid + '" style="font-size:9px;color:var(--accent);max-width:70px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;cursor:grab;text-align:center;-webkit-overflow-scrolling:touch;scrollbar-width:none" onclick="event.stopPropagation()" title="' + charName + '">' + charName + '</div>'
    + '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg-tertiary);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;overflow:hidden">' + _slAvChar2 + '</div></div>'
    + '</div></div>';
};

// ============================================================
// renderShareInviteCard(charLocData) → 渲染共享位置邀请卡片
// · 当未在共享状态时，AI主动发定位 → 显示为邀请卡片
// · 用户点击卡片可接受邀请并输入自己的位置
// · 接受后双方进入共享位置状态
// · 返回HTML字符串，由 processContent 调用
// ============================================================
cbyd21_Location.renderShareInviteCard = function(charLocData) {
  var charName = escHtml(this._locDisplayText(charLocData.name, '角色位置'));
  var charAddr = escHtml(this._locDisplayText(charLocData.addr, ''));

  // 角色头像
  var _siCh = getChatChar();
  var _siAvChar = '';
  if (_siCh && _siCh.avatar) { _siAvChar = '<img src="' + _siCh.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
  else { _siAvChar = '<span style="font-size:9px;color:var(--accent)">' + (_siCh ? escHtml(_siCh.name.charAt(0)) : '角') + '</span>'; }

  // 用户头像
  var _siUp = getCurrentProfile();
  var _siChat = getCurrentChat();
  var _siBranchUa = _siChat && _siChat._userAvatar;
  var _siAvUser = '';
  if (_siBranchUa) { _siAvUser = '<img src="' + _siBranchUa + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
  else if (_siUp.avatar) { _siAvUser = '<img src="' + _siUp.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
  else { _siAvUser = '<span style="font-size:9px;color:var(--text-secondary)">' + escHtml((_siUp.name || '我').charAt(0)) + '</span>'; }

  var _siCharLocEncoded = encodeURIComponent(JSON.stringify(charLocData));

  return '<div data-charloc="' + _siCharLocEncoded + '" style="background:rgba(124,111,155,0.1);border:1px solid rgba(124,111,155,0.18);border-radius:12px;padding:12px 14px;min-width:200px;max-width:260px;cursor:pointer">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>'
    + '<span style="font-size:13px;font-weight:500;color:var(--text-secondary)">共享位置</span></div>'
    + '<div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:2px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;cursor:grab;-webkit-overflow-scrolling:touch;scrollbar-width:none" onclick="event.stopPropagation()" title="' + charName + (charAddr ? ' · ' + charAddr : '') + '">' + charName + '</div>'
    + (charAddr ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;cursor:grab;-webkit-overflow-scrolling:touch;scrollbar-width:none" onclick="event.stopPropagation()" title="' + charAddr + '">' + charAddr + '</div>' : '')
    + '<div style="display:flex;align-items:flex-end;gap:6px;padding:8px 0;border-top:1px solid var(--border-soft)">'
    + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">'
    + '<div style="font-size:9px;color:var(--text-muted);text-align:center">点击共享</div>'
    + '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg-tertiary);border:2px dashed var(--text-muted);display:flex;align-items:center;justify-content:center;overflow:hidden;opacity:0.5">' + _siAvUser + '</div></div>'
    + '<div style="flex:1;height:2px;background:var(--border-soft);position:relative;align-self:center">'
    + '<div style="position:absolute;top:-3px;left:40%;width:8px;height:8px;border-radius:50%;background:var(--accent);opacity:0.3"></div></div>'
    + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">'
    + '<div style="font-size:9px;color:var(--accent);max-width:70px;overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;text-align:center;-webkit-overflow-scrolling:touch;scrollbar-width:none;cursor:grab" title="' + charName + '">' + charName + '</div>'
    + '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg-tertiary);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;overflow:hidden">' + _siAvChar + '</div></div>'
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<div onclick="event.stopPropagation();cbyd21_Location.acceptShareInvite(this.closest(\'[data-charloc]\'))" style="flex:1;text-align:center;font-size:11px;color:#fff;background:var(--accent);border-radius:10px;padding:8px 0">共享我的位置</div>'
    + '<div onclick="event.stopPropagation();cbyd21_Location.rejectShareInvite(this.closest(\'[data-charloc]\'))" style="flex-shrink:0;text-align:center;font-size:11px;color:var(--text-muted);border:1px solid var(--border-soft);border-radius:10px;padding:8px 12px">拒绝</div>'
    + '</div>'
    + '</div>';
};

// ============================================================
// _restorePendingInviteFromCard(el,charLocData) → 从未处理的邀请卡片恢复等待状态
// · 用于页面刷新/重新渲染后，最新共享邀请卡片仍可接受或拒绝
// · 如果这张邀请后面已经有接受/拒绝/忽略/结束记录，则视为失效
// ============================================================
cbyd21_Location._restorePendingInviteFromCard = function(el,charLocData) {
  if(!el||!charLocData)return false;
  if(this._shareStatus==='pending_user')return true;
  if(this._shareStatus&&this._shareStatus!=='none')return false;

  var msgEl = el.closest('.message');
  if(!msgEl||msgEl.dataset.idx===undefined)return false;

  var idx = parseInt(msgEl.dataset.idx);
  var chat = getCurrentChat();
  if(!chat||!chat.messages||!chat.messages[idx])return false;

  var msg = chat.messages[idx];
  if(!msg.content||!msg.content.startsWith('__share_invite__'))return false;

  try{
    var data = JSON.parse(msg.content.slice(16));
    if(!data||data.name!==charLocData.name||(data.addr||'')!==(charLocData.addr||''))return false;
  }catch(e){
    return false;
  }

  for(var i=idx+1;i<chat.messages.length;i++){
    var c = chat.messages[i]&&chat.messages[i].content||'';
    if(
      c.startsWith('__share_invite__')||
      c.startsWith('__share_location__')||
      c.startsWith('__share_response__')||
      c.startsWith('__share_ignore__')||
      c.startsWith('__share_reject__')||
      c.startsWith('__share_end__')
    ){
      return false;
    }
  }

  this.startShareInviteBar(charLocData, true);
  return this._shareStatus==='pending_user';
};

// ============================================================
// rejectShareInvite(el) → 用户拒绝角色发起的共享位置邀请
// · 写入一条用户侧记录，让AI知道用户拒绝了共享
// · 自动触发一次AI回应
// ============================================================
cbyd21_Location.rejectShareInvite = function(el) {
  if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
    return;
  }

  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    showToast('线上内嵌线下中，不能处理共享位置邀请');
    return;
  }

  var charLocData = null;
  try { charLocData = JSON.parse(decodeURIComponent(el.dataset.charloc || '')); } catch(e) {}
  if(this._shareStatus!=='pending_user'){
    if(!this._restorePendingInviteFromCard(el,charLocData)){
      showToast('共享位置邀请已失效');
      return;
    }
  }
  var _curInvite=this._shareCharLoc;
  if(!_curInvite||!charLocData||_curInvite.name!==charLocData.name||(_curInvite.addr||'')!==(charLocData.addr||'')){
    showToast('共享位置邀请已失效');
    return;
  }
  this.stopShareLocation(true);

  var chat = getCurrentChat();
  if (!chat) return;
  var time = formatTime(Date.now());
  document.getElementById('welcomeBlock').style.display = 'none';
  var content = '__share_reject__' + JSON.stringify({ name: charLocData && charLocData.name || '' });
  chat.messages.push({ role: 'user', content: content, time: time, _ts: Date.now() });
  cbyd21_Chat.appendMessageDOM('user', content, time, true, chat.messages.length - 1);
  cbyd21_Data.saveChats();
  cbyd21_UI.renderBranchList();
  scrollToBottom();

  if (!isGenerating && apiConfig.url && apiConfig.key && apiConfig.model) {
    setTimeout(function() {
      if (!isGenerating) cbyd21_Chat.triggerAI();
    }, 500);
  }
};

// ============================================================
// acceptShareInvite(el) → 用户点击共享位置邀请卡片后的处理
// · 弹出输入框让用户填写自己的当前位置
// · 确认后发送共享位置消息并启动共享横幅
// · el =被点击的卡片DOM元素，data-charloc 属性包含角色位置JSON
// ============================================================
cbyd21_Location.acceptShareInvite = function(el) {
  if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
    return;
  }

  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    showToast('线上内嵌线下中，不能接受共享位置邀请');
    return;
  }

  var charLocData;
  try { charLocData = JSON.parse(decodeURIComponent(el.dataset.charloc || '')); } catch (e) { showToast('数据异常'); return; }
  if(this._shareStatus!=='pending_user'){
    if(!this._restorePendingInviteFromCard(el,charLocData)){
      showToast('共享位置邀请已失效');
      return;
    }
  }
  var _curInvite=this._shareCharLoc;
  if(!_curInvite||_curInvite.name!==charLocData.name||(_curInvite.addr||'')!==(charLocData.addr||'')){
    showToast('共享位置邀请已失效');
    return;
  }

  var container = document.getElementById('addCharList');
  container.innerHTML = '<div style="padding:16px"><div style="text-align:center;margin-bottom:12px"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg></div><div style="font-size:14px;font-weight:600;color:var(--text-primary);text-align:center;margin-bottom:4px">对方邀请你共享位置</div><div style="font-size:11px;color:var(--text-muted);text-align:center;margin-bottom:16px">对方在：' + escHtml(charLocData.name || '') + '</div><div class="form-group"><label class="form-label">你的当前位置</label><input class="form-input" id="acceptShareLocName" placeholder="例：公司楼下"></div><div class="form-group"><label class="form-label">详细地址（选填）</label><input class="form-input" id="acceptShareLocAddr" placeholder="例：北京市朝阳区xxx路"></div><button class="btn primary" onclick="cbyd21_Location._doAcceptShareInvite()" style="width:100%;margin-top:8px">开始共享</button></div>';

  cbyd21_Location._pendingCharLoc = charLocData;
  document.getElementById('addCharModal').querySelector('h3').textContent = '共享位置';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
  setTimeout(function() { var inp = document.getElementById('acceptShareLocName'); if (inp) inp.focus(); }, 200);
};

// _pendingCharLoc → 临时存储待接受的角色位置数据（acceptShareInvite和_doAcceptShareInvite之间传递）
cbyd21_Location._pendingCharLoc = null;

// ============================================================
// _doAcceptShareInvite() → 执行接受共享位置邀请
// · 从输入框读取用户填写的位置信息
// · 发送共享位置消息到聊天
// · 启动共享位置横幅并更新角色位置
// ============================================================
cbyd21_Location._doAcceptShareInvite = function() {
  if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
    return;
  }

  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    this._pendingCharLoc = null;
    closeModal('addCharModal');
    showToast('线上内嵌线下中，不能开始共享位置');
    return;
  }

  var name = (document.getElementById('acceptShareLocName').value || '').trim();
  var addr = (document.getElementById('acceptShareLocAddr').value || '').trim();
  if (!name) { showToast('请输入位置名称'); return; }

  var charLocData = this._pendingCharLoc;
  var curInvite = this._shareCharLoc;
  if(
    !charLocData ||
    this._shareStatus !== 'pending_user' ||
    !curInvite ||
    curInvite.name !== charLocData.name ||
    (curInvite.addr || '') !== (charLocData.addr || '')
  ){
    this._pendingCharLoc = null;
    closeModal('addCharModal');
    showToast('共享位置邀请已失效');
    return;
  }

  closeModal('addCharModal');
  this._pendingCharLoc = null;
  var chat = getCurrentChat();
  if (!chat) return;
  var time = formatTime(Date.now());
  document.getElementById('welcomeBlock').style.display = 'none';
  var userData = { name: name, addr: addr || '' };
  var content = '__share_location__' + JSON.stringify(userData);
  chat.messages.push({ role: 'user', content: content, time: time, _ts: Date.now() });
  cbyd21_Chat.appendMessageDOM('user', content, time, true, chat.messages.length - 1);
  cbyd21_Data.saveChats();
  cbyd21_UI.renderBranchList();
  scrollToBottom();
  this.startShareBar(userData);
  if (charLocData) { this.updateShareBarCharLoc(charLocData); }

  // 用户接受角色发起的共享位置邀请后，自动触发一次AI回应
  if (!isGenerating && apiConfig.url && apiConfig.key && apiConfig.model) {
    setTimeout(function() {
      if (!isGenerating) cbyd21_Chat.triggerAI();
    }, 500);
  }
};

// ============================================================
// openLocationMenu() → 点击加号面板的"定位"按钮后弹出选择菜单
// · 两个选项：发送定位 / 共享位置
// · 选择后关闭菜单，打开对应的输入弹窗
// ============================================================
cbyd21_Location.openLocationMenu = function() {
  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    showToast('线上内嵌线下中，定位和共享位置暂不可用');
    return;
  }

  if(document.getElementById('chatView').dataset.groupMode==='true'){
    showToast('群聊暂不支持定位和共享位置');
    return;
  }
  document.getElementById('plusPanel').classList.remove('active');
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '发送定位', desc: '发送一个地点给对方', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>' },
    { label: '共享位置', desc: '与对方实时共享位置（模拟）', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="6" opacity="0.4"/><line x1="12" y1="18" x2="12" y2="21" opacity="0.4"/><line x1="3" y1="12" x2="6" y2="12" opacity="0.4"/><line x1="18" y1="12" x2="21" y2="12" opacity="0.4"/></svg>' }
  ];
  items.forEach(function(item, i) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML = '<div style="display:flex;align-items:center;gap:12px;width:100%">' + item.svg + '<div style="flex:1"><div style="font-size:14px;color:var(--text-primary)">' + item.label + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + item.desc + '</div></div></div>';
    div.onclick = function() { closeModal('addCharModal'); if (i === 0) { cbyd21_Location.openLocationSend(); } else { cbyd21_Location.openShareLocation(); } };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '定位';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
};

// ============================================================
// openShareLocation() → 打开共享位置输入弹窗
// · 用户填写自己的位置名称和地址
// · 确认后调用 submitShareLocation() 发送
// ============================================================
cbyd21_Location.openShareLocation = function() {
  var container = document.getElementById('addCharList');
  container.innerHTML = '<div style="padding:16px"><div class="form-group"><label class="form-label">你的当前位置</label><input class="form-input" id="shareLocNameInput" placeholder="例：公司楼下"></div><div class="form-group"><label class="form-label">详细地址（选填）</label><input class="form-input" id="shareLocAddrInput" placeholder="例：北京市朝阳区xxx路"></div><button class="btn primary" onclick="cbyd21_Location.submitShareLocation()" style="width:100%;margin-top:8px">开始共享</button></div>';
  document.getElementById('addCharModal').querySelector('h3').textContent = '共享位置';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
  setTimeout(function() { var el = document.getElementById('shareLocNameInput'); if (el) el.focus(); }, 200);
};

// ============================================================
// submitShareLocation() → 发送共享位置消息到聊天
// · 读取输入框内容，构建__share_location__ 格式消息
// · 启动共享位置横幅条
// · 用户主动发起共享位置后不自动触发AI，等用户手动触发
// ============================================================
cbyd21_Location.submitShareLocation = function() {
  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    showToast('线上内嵌线下中，不能发送共享位置');
    return;
  }

  var name = (document.getElementById('shareLocNameInput').value || '').trim();
  var addr = (document.getElementById('shareLocAddrInput').value || '').trim();
  if (!name) { showToast('请输入位置名称'); return; }
  closeModal('addCharModal');
  var chat = getCurrentChat();
  if (!chat) return;
  var time = formatTime(Date.now());
  document.getElementById('welcomeBlock').style.display = 'none';
  var data = { name: name, addr: addr || '' };
  var content = '__share_location__' + JSON.stringify(data);
  chat.messages.push({ role: 'user', content: content, time: time, _ts: Date.now() });
  cbyd21_Chat.appendMessageDOM('user', content, time, true, chat.messages.length - 1);
  cbyd21_Data.saveChats();
  cbyd21_UI.renderBranchList();
  scrollToBottom();
  // 启动实时共享位置条
  cbyd21_Location.startShareBar(data);

  // 用户主动发起共享位置后不自动触发AI。
  // 保留手动触发设计：用户可以继续补充消息，最后统一点触发键让角色回应。
  showToast('共享位置已发送，可继续补充消息，完成后点触发键让角色回应');
};

// ============================================================
// openLocationSend() → 打开发送定位输入弹窗
// · 用户填写地点名称和地址描述
// · 确认后调用 submitLocationSend() 发送
// ============================================================
cbyd21_Location.openLocationSend = function() {
  document.getElementById('plusPanel').classList.remove('active');
  var container = document.getElementById('addCharList');
  container.innerHTML = '<div style="padding:16px"><div class="form-group"><label class="form-label">地点名称</label><input class="form-input" id="locationNameInput" placeholder="例：星巴克中关村店"></div><div class="form-group"><label class="form-label">地址/ 描述（选填）</label><input class="form-input" id="locationAddrInput" placeholder="例：北京市海淀区中关村大街1号"></div><button class="btn primary" onclick="cbyd21_Location.submitLocationSend()" style="width:100%;margin-top:8px">发送定位</button></div>';
  document.getElementById('addCharModal').querySelector('h3').textContent = '发送定位';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
  setTimeout(function() { var el = document.getElementById('locationNameInput'); if (el) el.focus(); }, 200);
};

// ============================================================
// submitLocationSend() → 从输入框读取内容并发送定位消息
// · 验证地点名称不为空
// · 调用 sendLocationMsg() 实际发送
// ============================================================
cbyd21_Location.submitLocationSend = function() {
  var nameEl = document.getElementById('locationNameInput');
  var addrEl = document.getElementById('locationAddrInput');
  var name = (nameEl ? nameEl.value.trim() : '');
  var addr = (addrEl ? addrEl.value.trim() : '');
  if (!name) { showToast('请输入地点名称'); return; }
  closeModal('addCharModal');
  cbyd21_Location.sendLocationMsg(name, addr);
};

// ============================================================
// sendLocationMsg(name, addr) → 发送定位消息到当前聊天
// · 消息格式：__location__{"name":"地点名","addr":"地址"}
// · 追加到聊天记录并渲染到界面
// · 不触发AI回复（用户可手动触发）
// ============================================================
cbyd21_Location.sendLocationMsg = function(name, addr) {
  if(this._isInlineOfflineActive && this._isInlineOfflineActive()){
    showToast('线上内嵌线下中，不能发送定位');
    return;
  }

  var chat = getCurrentChat();
  if (!chat) return;
  var time = formatTime(Date.now());
  document.getElementById('welcomeBlock').style.display = 'none';
  var data = { name: name, addr: addr || '' };
  var content = '__location__' + JSON.stringify(data);
  chat.messages.push({ role: 'user', content: content, time: time, _ts: Date.now() });
  cbyd21_Chat.appendMessageDOM('user', content, time, true, chat.messages.length - 1);
  cbyd21_Data.saveChats();
  cbyd21_UI.renderBranchList();
  scrollToBottom();

  showToast('定位已发送，可继续补充消息，完成后点触发键让角色回应');
};

// ============================================================
// renderLocationCard(data, role) → 渲染普通定位消息卡片
// · 显示：地图纹理背景 + 定位pin图标 + 地点名 + 地址 + 发送者头像
// · data = { name: '地点名', addr: '地址' }
// · role = 'user' 或 'ai'，决定左下角头像用谁的
// · 返回HTML字符串，由 processContent 调用
// ============================================================
cbyd21_Location.renderLocationCard = function(data, role) {
  var name = escHtml(this._locDisplayText(data.name, '未知地点'));
  var addr = escHtml(this._locDisplayText(data.addr, ''));

  // 根据消息发送者决定头像
  var avatarHtml = '';
  if (role === 'user') {
    var _chat_u = getCurrentChat();
    var _branch_ua2 = _chat_u && _chat_u._userAvatar;
    var up2 = getCurrentProfile();
    if (_branch_ua2) { avatarHtml = '<img src="' + _branch_ua2 + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }else if (up2.avatar) { avatarHtml = '<img src="' + up2.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
    else { avatarHtml = '<span class="avatar-text" style="font-size:10px;color:var(--text-secondary)">' + escHtml((up2.name || '我').charAt(0)) + '</span>'; }
  } else {
    var ch2 = getChatChar();
    if (ch2 && ch2.avatar) { avatarHtml = '<img src="' + ch2.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; }
    else { avatarHtml = '<span class="avatar-text" style="font-size:10px;color:var(--accent)">' + (ch2 ? escHtml(ch2.name.charAt(0)) : '角') + '</span>'; }
  }

  return '<div class="location-card"><div class="location-card-header"><div class="location-card-icon"><!--定位pin图标 --><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg></div><div class="location-card-info"><div class="location-card-name">' + name + '</div>' + (addr ? '<div class="location-card-addr">' + addr + '</div>' : '') + '</div></div><div class="location-card-map" style="position:relative"><!-- 地图纹理SVG --><svg class="location-card-map-pattern" width="100%" height="100%" viewBox="0 0 200 100"><line x1="0" y1="20" x2="200" y2="20" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="40" x2="200" y2="40" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="60" x2="200" y2="60" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="80" x2="200" y2="80" stroke="currentColor" stroke-width="0.5"/><line x1="40" y1="0" x2="40" y2="100" stroke="currentColor" stroke-width="0.5"/><line x1="80" y1="0" x2="80" y2="100" stroke="currentColor" stroke-width="0.5"/><line x1="120" y1="0" x2="120" y2="100" stroke="currentColor" stroke-width="0.5"/><line x1="160" y1="0" x2="160" y2="100" stroke="currentColor" stroke-width="0.5"/><path d="M60 30 Q100 10 140 50Q160 70 180 60" stroke="currentColor" stroke-width="1" fill="none" opacity="0.5"/><path d="M20 70 Q50 50 90 80" stroke="currentColor" stroke-width="1" fill="none" opacity="0.5"/></svg><!-- 中心定位标记 --><svg width="24" height="24" viewBox="0 0 24 24" fill="var(--accent)" stroke="none" style="position:relative;z-index:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="3" fill="#fff"/></svg><!-- 发送者头像 --><div style="position:absolute;bottom:6px;left:6px;width:24px;height:24px;border-radius:50%;background:var(--bg-tertiary);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;overflow:hidden;z-index:2">' + avatarHtml + '</div></div></div>';
};
