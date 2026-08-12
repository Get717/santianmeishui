// ============================================================
// cbyd21_Call — 通话功能模块
// ============================================================
// 从主文件拆分出来的所有通话相关逻辑
// 包含：
// · 通话类型选择（语音/视频）
// · 视频通话立绘管理（角色立绘+用户形象）
// · 通话核心流程（发起→接听判断→通话中→挂断）
// · 通话消息发送与AI回复
// · 通话缩小悬浮（气泡模式+卡片模式）
// · 来电模式
// · 通话消息菜单（编辑/复制/删除）
// · 通话后追加消息 + 拒接反应
// · 双语通话渲染
// · 通话输入框回车 + 缩小气泡拖动 + 迷你卡片拖动

// ============================================================
// 通话类型选择
// ============================================================
// _callIsVideo → 当前通话是否为视频模式
// · 语音通话：纯文字模拟，无立绘
// · 视频通话：全屏角色立绘 + 右上角用户画中画
var _callIsVideo = false;
var _callCameraOn = true;
var _callContinueRequested = false;
// _callBranchId → 当前通话绑定的聊天分支
var _callBranchId = null;

// _callDirection → 当前通话方向。
// outgoing = 用户主动拨给角色；incoming = 角色主动拨给用户。
var _callDirection = 'outgoing';

// _promptReadyOrToast()
// → 通话模块调用 API 前的提示词就绪检查。
// 提示词未加载完成时，直接阻止本次通话相关生成，不进入假 loading，不排队，不自动重试，不消耗 API。
cbyd21_Call._promptReadyOrToast = function(){
  if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
    return false;
  }

  return true;
};

// _setOnlineInputLocked(locked, toastText, placeholderText)
// → 通话相关线上补发消息期间，临时锁定普通聊天输入区。
// 用于：
// 1. 电话未接通后的线上回应；
// 2. 通话结束后 40% 概率追加消息。
// 只禁用用户输入/发送/触发/加号，不自动重试，不额外调用 API。
cbyd21_Call._setOnlineInputLocked = function(locked, toastText, placeholderText){
  try{
    var inp = document.getElementById('msgInput');
    var sendBtn = document.getElementById('sendBtn');
    var triggerBtn = document.getElementById('triggerBtn');
    var plusBtn = document.getElementById('plusBtn');
    var plusPanel = document.getElementById('plusPanel');
    var stickerPanel = document.getElementById('stickerPanel');

    if(plusPanel)plusPanel.classList.remove('active');
    if(stickerPanel)stickerPanel.classList.remove('active');

    if(inp){
      if(locked){
        if(!inp.dataset.callPrevPlaceholder){
          inp.dataset.callPrevPlaceholder = inp.placeholder || '₍ᐢ..ᐢ₎♡';
        }

        inp.disabled = true;
        inp.placeholder = placeholderText || '等待对方回应…';
      }else{
        inp.disabled = false;
        inp.placeholder = inp.dataset.callPrevPlaceholder || '₍ᐢ..ᐢ₎♡';
        delete inp.dataset.callPrevPlaceholder;
      }
    }

    if(sendBtn)sendBtn.disabled = !!locked;
    if(triggerBtn)triggerBtn.disabled = !!locked;
    if(plusBtn)plusBtn.disabled = !!locked;

    if(toastText){
      showToast(toastText);
    }
  }catch(e){}
};

// _withRegexRuntimeChar(charId, fn)
// → 通话模块执行正则时，临时指定“当前角色”为通话角色。
// 避免通话缩小后用户切到其他聊天，导致通话消息误用当前聊天角色的角色正则。
cbyd21_Call._withRegexRuntimeChar = function(charId, fn){
  var hadOld = Object.prototype.hasOwnProperty.call(window, '_cbyd21RegexRuntimeCharId');
  var oldVal = window._cbyd21RegexRuntimeCharId;

  try{
    if(charId){
      window._cbyd21RegexRuntimeCharId = charId;
    }

    return fn();
  }finally{
    if(hadOld){
      window._cbyd21RegexRuntimeCharId = oldVal;
    }else{
      try{
        delete window._cbyd21RegexRuntimeCharId;
      }catch(e){
        window._cbyd21RegexRuntimeCharId = null;
      }
    }
  }
};

// _applyRegexForCallChar(text, scope, charId)
// → 通话专用正则入口。
// 只包一层运行时角色 ID，不改全局 applyRegexRules 逻辑。
cbyd21_Call._applyRegexForCallChar = function(text, scope, charId){
  if(typeof applyRegexRules !== 'function'){
    return text;
  }

  return cbyd21_Call._withRegexRuntimeChar(charId || _callCharId || null, function(){
    return applyRegexRules(text, scope);
  });
};

// triggerCallContinue() →通话中不说话直接让AI继续说
// · 类似聊天的触发按钮，让角色根据上下文继续说话
// · 不添加用户消息到_callMessages，只在API请求中临时注入
cbyd21_Call.triggerCallContinue = function(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  if(_callState !== 'connected') return;
  if(_callGenerating){ showToast('对方正在说话…'); return; }
  _callContinueRequested = true;
  cbyd21_Call.triggerCallReply();
};

// openCallTypeMenu() → 点击加号面板里的「通话」后弹出选择菜单
// · 语音通话 / 视频通话 二选一
// · 底部有使用说明提示
cbyd21_Call.openCallTypeMenu = function(){
  document.getElementById('plusPanel').classList.remove('active');

  if(!cbyd21_Call._promptReadyOrToast())return;

  if(
    window.cbyd21_InlineOffline &&
    cbyd21_InlineOffline.isEnabledForCurrentChat &&
    cbyd21_InlineOffline.isEnabledForCurrentChat()
  ){
    showToast('线上内嵌线下中，通话暂不可用');
    return;
  }

  // 当前通话系统是单实例：同一时间只能存在一通电话。
  // 如果通话已接通并缩小成卡片，不能再从其他角色处发起新通话，
  // 否则会覆盖 _callCharId / _callMessages，导致当前通话丢失。
  if(_callState && _callState !== 'idle'){
    showToast('当前已有通话进行中');
    if(_callState === 'connected'){
      cbyd21_Call.restoreCallScreen();
    }
    return;
  }

  if(document.getElementById('chatView')&&document.getElementById('chatView').dataset.groupMode==='true'){
    showToast('群聊不支持通话');
    return;
  }
  var ch = getChatChar();
  if(!ch || ch.id === DEFAULT_CHAR_ID){ showToast('写卡助手不支持通话'); return; }
  if(!apiConfig.url || !apiConfig.key || !apiConfig.model){ showToast('请先配置API'); return; }
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '语音通话', desc: '文字模拟语音通话', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>' },
    { label: '视频通话', desc: '带角色立绘的视频通话界面', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="2" y="4" width="15" height="14" rx="2"/><path d="M17 9l5-3v12l-5-3"/></svg>' }
  ];
  items.forEach(function(item, i){
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '16px';
    div.innerHTML = '<div style="display:flex;align-items:center;gap:12px;width:100%">' + item.svg + '<div style="flex:1"><div style="font-size:14px;color:var(--text-primary)">' + item.label + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + item.desc + '</div></div></div>';
    div.onclick = function(){
      closeModal('addCharModal');
      if(i === 0){ _callIsVideo = false; cbyd21_Call.startCall(); }
      else { _callIsVideo = true; cbyd21_Call.startCall(); }
    };
    container.appendChild(div);
  });
  var hintDiv = document.createElement('div');
  hintDiv.style.cssText = 'padding:10px 16px;font-size:11px;color:var(--text-muted);line-height:1.6;border-top:1px solid var(--border-soft)';
  hintDiv.textContent = '💡 点击通话后会调用API让角色自主判断是否接听，接通或挂断速度取决于API响应速度。角色也可能根据性格和情境拒接电话。';
  container.appendChild(hintDiv);
  document.getElementById('addCharModal').querySelector('h3').textContent = '选择通话方式';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
};

// ============================================================
// 视频通话立绘管理
// ============================================================
// · 角色立绘 → ch._videoCharImage（URL或IndexedDB引用）
// · 用户形象 → ch._videoUserImage
// · 在角色信息面板「视频通话」区块设置

// uploadVideoCharImage() → 上传角色立绘图片（压缩到960px）
function uploadVideoCharImage(){
  var charId = _charInfoCharId;
  if(!charId) return;
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
  inp.onchange = async function(e){
    var f = e.target.files[0]; if(!f) return;
    var _compVci = await cbyd21_compressImg(f, 960, 0.72);
    cbyd21_Data.storeImage(_compVci).then(function(ref){
      var ch = getCharById(charId);
      if(ch){ ch._videoCharImage = ref; cbyd21_Data.saveCharacters(); }
      showToast('角色立绘已设置');
      if(typeof refreshVideoCallPreview==='function')refreshVideoCallPreview();
    });
    document.body.removeChild(inp);
  };
  document.body.appendChild(inp);
  inp.click();
}

// setVideoCharImageUrl() → 通过URL设置角色立绘
function setVideoCharImageUrl(){
  var charId = _charInfoCharId; if(!charId) return;
  openTextInputModal('角色立绘URL', '输入角色立绘图片URL', 'https://example.com/char.png', function(url){
    if(!url.trim()) return;
    var ch = getCharById(charId); if(ch){ ch._videoCharImage = url.trim(); cbyd21_Data.saveCharacters(); }
    showToast('角色立绘已设置');
    if(typeof refreshVideoCallPreview==='function')refreshVideoCallPreview();
  });
}

// clearVideoCharImage() → 清除角色立绘
function clearVideoCharImage(){
  var charId = _charInfoCharId; if(!charId) return;
  var ch = getCharById(charId); if(ch){ ch._videoCharImage = null; cbyd21_Data.saveCharacters(); }
  showToast('已清除角色立绘');
  if(typeof refreshVideoCallPreview==='function')refreshVideoCallPreview();
}

// uploadVideoUserImage() → 上传用户形象图片（压缩到320px，画中画小窗用）
function uploadVideoUserImage(){
  var charId = _charInfoCharId;
  if(!charId) return;
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
  inp.onchange = async function(e){
    var f = e.target.files[0]; if(!f) return;
    var _compVui = await cbyd21_compressImg(f, 320, 0.72);
    cbyd21_Data.storeImage(_compVui).then(function(ref){
      var ch = getCharById(charId);
      if(ch){ ch._videoUserImage = ref; cbyd21_Data.saveCharacters(); }
      showToast('用户形象已设置');
      if(typeof refreshVideoCallPreview==='function')refreshVideoCallPreview();
    });
    document.body.removeChild(inp);
  };
  document.body.appendChild(inp);
  inp.click();
}

// setVideoUserImageUrl() → 通过URL设置用户形象
function setVideoUserImageUrl(){
  var charId = _charInfoCharId; if(!charId) return;
  openTextInputModal('用户形象URL', '输入你的形象图片URL', 'https://example.com/user.png', function(url){
    if(!url.trim()) return;
    var ch = getCharById(charId); if(ch){ ch._videoUserImage = url.trim(); cbyd21_Data.saveCharacters(); }
    showToast('用户形象已设置');
    if(typeof refreshVideoCallPreview==='function')refreshVideoCallPreview();
  });
}

// clearVideoUserImage() → 清除用户形象
function clearVideoUserImage(){
  var charId = _charInfoCharId; if(!charId) return;
  var ch = getCharById(charId); if(ch){ ch._videoUserImage = null; cbyd21_Data.saveCharacters(); }
  showToast('已清除用户形象');
  if(typeof refreshVideoCallPreview==='function')refreshVideoCallPreview();
}

// loadVideoCallImages(ch) → 加载视频通话的背景立绘和画中画
// · 背景层(callVideoBg) 显示角色立绘
// · 画中画(callVideoPip) 显示用户形象，没设置时用面具头像
function loadVideoCallImages(ch){
  var bgEl = document.getElementById('callVideoBg');
  var pipEl = document.getElementById('callVideoPip');
  bgEl.innerHTML = '';
  if(ch && ch._videoCharImage){
    var ref = ch._videoCharImage;
    if(typeof _cbyd21IsDirectImageRef === 'function' && _cbyd21IsDirectImageRef(ref)){ bgEl.innerHTML = '<img src="' + ref + '">'; }
    else { cbyd21_Data.loadImage(ref).then(function(d){ if(d) bgEl.innerHTML = '<img src="' + d + '">'; }); }
  }
  pipEl.innerHTML = '';
  if(ch && ch._videoUserImage){
    var ref2 = ch._videoUserImage;
    if(typeof _cbyd21IsDirectImageRef === 'function' && _cbyd21IsDirectImageRef(ref2)){ pipEl.innerHTML = '<img src="' + ref2 + '">'; }
    else { cbyd21_Data.loadImage(ref2).then(function(d){ if(d) pipEl.innerHTML = '<img src="' + d + '">'; }); }
  } else {
    var up = getCurrentProfile();
    if(up.avatar){ pipEl.innerHTML = '<img src="' + up.avatar + '">'; }
    else { pipEl.innerHTML = '<span style="font-size:14px;color:var(--text-muted)">' + escHtml((up.name || '我').charAt(0)) + '</span>'; }
  }
}

// _buildTimeAwareBlock(ch, scopeName)
/// → 通话模块专用真实时间感知。
/// 通话请求不走线上 buildRequest，所以需要在 call.js 内单独注入当前时间。
cbyd21_Call._buildTimeAwareBlock = function(ch, scopeName){
  if(!ch || !ch._timeAware || ch.id === DEFAULT_CHAR_ID)return '';

  var now = new Date();
  var weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  var hour = now.getHours();
  var minute = String(now.getMinutes()).padStart(2,'0');
  var period = '';

  if(hour >= 0 && hour < 5)period = '深夜';
  else if(hour >= 5 && hour < 7)period = '凌晨';
  else if(hour >= 7 && hour < 9)period = '早上';
  else if(hour >= 9 && hour < 11)period = '上午';
  else if(hour >= 11 && hour < 13)period = '中午';
  else if(hour >= 13 && hour < 17)period = '下午';
  else if(hour >= 17 && hour < 19)period = '傍晚';
  else if(hour >= 19 && hour < 23)period = '晚上';
  else period = '深夜';

  var isWeekend = now.getDay() === 0 || now.getDay() === 6;

  return (
    '[当前真实时间]\n' +
    '现在是' +
    now.getFullYear() + '年' +
    (now.getMonth() + 1) + '月' +
    now.getDate() + '日 ' +
    weekdays[now.getDay()] + ' ' +
    hour + ':' + minute +
    '（' + period + '）' +
    (isWeekend ? ' · 周末' : ' · 工作日') +
    '\n\n' +
    '当前真实时间来自用户设备显示的本地时间。前端只提供这个时间，不提供定位、国家、城市或可靠时区换算结果。\n' +
    '在' + (scopeName || '通话') + '中，涉及用户作息、吃饭、睡觉、上班上学、休息或日常安排时，优先按照上方当前真实时间的小时和时段理解用户此刻的生活时间。\n' +
    '如果用户面具、聊天记录或上下文能可靠体现用户所在地、时区、国家、地区或稳定作息，可以结合这些信息理解用户生活习惯和语境；没有可靠信息时，按当前设备时间和中文语境常见作息判断。\n' +
    '如果角色卡或世界书明确写出角色本人所在国家、地区、时区、城市、工作地点或稳定生活作息，也要理解角色自己的当地时间和生活节奏。涉及角色自己正在做什么、角色那边是白天还是夜晚、角色自己的吃饭和休息时，按角色自己的所在地和作息判断。\n' +
    '如果角色所在地、时区或作息没有可靠信息，默认角色和用户处在同一当前时间背景下。\n' +
    '餐点名称有相对稳定的常见时间窗口：早餐通常属于 6:00-9:30；午饭通常属于 11:30-13:30；晚饭通常属于 17:30-20:00；夜宵通常属于 22:00-2:00。\n' +
    '当前时间落在餐点窗口之外时，餐点相关内容可理解为提前、延后、特殊作息、临时安排或话题提及，具体含义由用户面具、角色卡、世界书、聊天记录和当前通话上下文共同决定。\n' +
    '除餐点名称外，工作、学习、睡眠、外出、休息、通勤、娱乐等生活安排，都以用户面具、角色卡、世界书、聊天记录和当前上下文为准。\n' +
    '时间是背景，不是固定话题；在该影响语气、关心点、情绪、餐点、睡眠和通话节奏的地方自然体现。'
  );
};

// _pushOocInstructionBlock(sp, chat, scopeName)
// → 通话模块注入“皮下模式”中明确保存的后续要求。
// 说明：
// · 内部函数名暂时沿用 OOC，兼容旧调用；用户侧功能名已经改为“皮下模式”。
// · 只注入用户明确写成“后续要求：...”或“具体要求：...”的内容。
// · 不注入全部皮下闲聊历史，避免通话把皮下调试聊天当作剧情或关系事实。
cbyd21_Call._pushOocInstructionBlock = function(sp, chat, scopeName){
  if(!sp || !chat)return;

  if(typeof _cbyd21FormatOocInstructions !== 'function')return;

  var block = _cbyd21FormatOocInstructions(chat._oocInstructions);

  if(!block)return;

  sp.push(
    block +
    '\n\n[适用范围]\n' +
    '以上后续要求同样适用于当前' + (scopeName || '通话相关请求') + '。执行时仍必须遵守角色卡、通话模式边界、用户尊重底线和通话功能格式。'
  );
};

// 收集通话模块可用的世界书条目
cbyd21_Call._collectWorldBook = function(charId, callMessages, extraTexts){
  return collectActiveWorldBook({ messages: callMessages || [] }, charId, extraTexts || []);
};

// 把通话模块里的角色前世界书注入到提示词
cbyd21_Call._pushWorldBookBefore = function(sp, wb){
  if(wb&&wb.before_char&&wb.before_char.length>0)sp.push('[World Book — 世界背景]\n'+wb.before_char.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
};

// 把通话模块里的角色后世界书注入到提示词
cbyd21_Call._pushWorldBookAfter = function(sp, wb){
  if(wb&&wb.after_char&&wb.after_char.length>0)sp.push('[World Book]\n'+wb.after_char.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
};

// 把通话模块里的系统末尾世界书注入到提示词尾部
cbyd21_Call._pushWorldBookSystemEnd = function(sp, wb){
  if(wb&&wb.system_end&&wb.system_end.length>0)sp.push('[强制指令]\n'+wb.system_end.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
};

// _buildContextPackMessages(sm,msgs,wb,taskName)
// → 通话模块统一上下文包模式。
// · system 只放短协议
// · 完整角色卡/用户面具/世界书/通话规则作为第一条 user message 的前置上下文包
// · 避免 system 一份 + user 一份的双注入
cbyd21_Call._buildContextPackMessages = function(sm, msgs, wb, taskName){
  msgs = (msgs || []).map(function(m){
    return { role: m.role, content: m.content };
  });

  var blocks = [];

  blocks.push(
    '[前端上下文包说明]\n' +
    '以下内容由聊天前端生成，包括角色卡、用户信息、世界书、记忆、通话规则和输出格式。\n' +
    '这些内容不是用户在通话或聊天中说的话，不要在回复中复述、解释或暴露。\n' +
    '只需要把它们作为本轮必须参考的上下文。'
  );

  if(wb && wb.user_start && wb.user_start.length > 0){
    blocks.push(
      '[兼容最前规则]\n' +
      wb.user_start.map(function(w){
        return '[' + w.name + ']\n' + w.content;
      }).join('\n\n')
    );
  }

  blocks.push(String(sm || ''));

  var pack =
    '[前端上下文包]\n' +
    '这是一段前端打包给模型的通话/线上上下文，不是用户的真实发言。\n' +
    '请根据下方上下文执行当前任务：' + (taskName || '通话相关任务') + '。\n' +
    '不要复述、解释或暴露本上下文包。\n\n' +
    blocks.join('\n\n---\n\n') +
    '\n\n[前端上下文包结束]';

  if(msgs.length > 0 && msgs[0] && msgs[0].role === 'user'){
    msgs[0].content = pack + '\n\n[用户真实消息 / 当前任务开始]\n' + msgs[0].content;
  }else{
    msgs.unshift({
      role: 'user',
      content:
        pack +
        '\n\n[当前任务开始]\n请根据前端上下文包和当前通话状态继续。'
    });
  }

  return [{
    role: 'system',
    content: '[前端协议]\n第一条 user message 的开头包含前端上下文包，里面有角色卡、用户信息、世界书、记忆、通话规则和输出格式。它不是用户的真实发言。请根据该上下文包执行当前通话/线上任务，不要复述或暴露上下文包内容。'
  }].concat(msgs);
};

// 判断当前角色是否开启通话API报错面板
cbyd21_Call._shouldShowApiError = function(){
  var ch=getCharById(_callCharId||currentChatCharId);
  return !!(ch&&ch._callShowApiError);
};

// 根据角色设置显示通话API报错面板
cbyd21_Call._showCallApiError = function(title, err){
  if(!cbyd21_Call._shouldShowApiError())return;
  showApiError(title+'：'+((err&&err.message)||err||'未知错误'));
};

// _extractReplyContent(data)
// → 通话模块读取 API 正文。
// 优先使用主文件的 _cbyd21ExtractChatApiContent，兼容不同中转站返回结构。
cbyd21_Call._extractReplyContent = function(data){
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
      var keys = [
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

      for(var i = 0; i < keys.length; i++){
        if(v[keys[i]] !== undefined && v[keys[i]] !== null){
          var direct = contentToText(v[keys[i]], depth + 1);

          if(direct)return direct;
        }
      }

      var objKeys = Object.keys(v);

      for(var j = 0; j < objKeys.length; j++){
        var key = objKeys[j];

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
      contentToText(choice.result);

    if(choiceText)return choiceText;
  }

  return contentToText(data && (data.output_text || data.output || data.content || data));
};

// _appendOnlineReplySafely(chat, reply, time, label)
// → 通话相关线上补发消息的安全写入。
// API 已经成功返回时，优先走线上聊天正常解析；如果解析失败，保存模型原文。
cbyd21_Call._appendOnlineReplySafely = function(chat, reply, time, label){
  if(!chat)return;

  var beforeCount = chat.messages ? chat.messages.length : 0;

  try{
    var _regexCharIdForAppend = (chat && chat.charId) || _callCharId || currentChatCharId || null;

    if(typeof cbyd21_Call._withRegexRuntimeChar === 'function'){
      cbyd21_Call._withRegexRuntimeChar(_regexCharIdForAppend, function(){
        cbyd21_Chat.splitAndAppendAiReply(chat, reply, time, { forceSplit:true });
      });
    }else{
      cbyd21_Chat.splitAndAppendAiReply(chat, reply, time, { forceSplit:true });
    }
  }catch(parseErr){
    console.warn((label || '通话相关回复') + ' 已返回，但前端解析失败，已按原文保存：', parseErr);

    chat.messages = chat.messages.slice(0, beforeCount);

    var safeText = '[前端提示：' + (label || '通话相关回复') + '已返回，但格式解析失败，以下为模型原始回复。]\n\n' + String(reply || '……')
      .replace(/__/g, '＿')
      .replace(/</g, '＜')
      .replace(/>/g, '＞');

    chat.messages.push({
      role:'ai',
      content:safeText,
      time:time || formatTime(Date.now()),
      _ts:Date.now(),
      _rawApiReply:String(reply || ''),
      _frontendParseError:String(parseErr && parseErr.message || parseErr || '')
    });

    if(currentChatId === chat.id && typeof cbyd21_Chat !== 'undefined' && cbyd21_Chat.appendMessageDOM){
      try{
        cbyd21_Chat.appendMessageDOM('ai', safeText, time || formatTime(Date.now()), true, chat.messages.length - 1);
      }catch(e){
        cbyd21_Chat.renderMessages && cbyd21_Chat.renderMessages();
      }
    }

    showToast((label || '回复') + '已返回，前端解析失败，已按原文保存');
  }
};

// _extractBilingualJsonArray(text)
// → 稳定提取 __bl_json__ 后面的 JSON 数组。
// 不用简单正则截取，避免原文/翻译里出现 ] 时误截断。
cbyd21_Call._extractBilingualJsonArray = function(text){
  text = String(text || '');

  var marker = '__bl_json__';
  var markerIdx = text.indexOf(marker);

  if(markerIdx < 0)return null;

  var arrStart = text.indexOf('[', markerIdx + marker.length);

  if(arrStart < 0)return null;

  var src = text.slice(arrStart);
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

  var before = text.slice(0, markerIdx).trim();
  var after = src.slice(end).trim();

  before = before.replace(/^```(?:json|js|javascript)?\s*/i, '').trim();
  after = after.replace(/```$/i, '').trim();

  return {
    json: src.slice(0, end).trim(),
    rest: [before, after].filter(function(x){
      return String(x || '').trim().length > 0;
    }).join('\n').trim()
  };
};

// _normalizeBilingualJsonReply(text)
// → 通话双语 JSON 解析。
// · 支持 __bl_json__[{"t":"原文","c":"中文翻译"}]
// · 多个对象会拆成多条通话消息
// · 非 JSON 双语保持原样
cbyd21_Call._normalizeBilingualJsonReply = function(text){
  text = String(text || '').trim();

  if(typeof _stripLeakedThinking === 'function'){
    text = _stripLeakedThinking(text);
  }

  if(!text)return [];

  if(text.indexOf('__bl_json__') >= 0){
    var match = cbyd21_Call._extractBilingualJsonArray(text);

    if(match){
      try{
        var arr = JSON.parse(match.json);
        var rest = match.rest;
        var lines = [];

        if(Array.isArray(arr)){
          arr.forEach(function(item){
            if(!item)return;

            if(item.t && item.c){
              lines.push(String(item.t).trim() + '__bilingual_split__' + String(item.c).trim());
            }else if(item.t){
              lines.push(String(item.t).trim());
            }else if(item.c){
              lines.push(String(item.c).trim());
            }
          });
        }

        if(rest)lines.push(rest);

        return lines.filter(function(line){
          return String(line || '').trim().length > 0;
        });
      }catch(e){
        text = text.replace(/__bl_json__/g,'').trim();
      }
    }
  }

  if(text.indexOf('__bl_sep__') >= 0){
    text = text.replace(/__bl_sep__\s*/g, '__bl_sep__\n').replace(/__bl_sep__/g, '');
  }

  if(text.indexOf('__bilingual_split__') >= 0){
    text = text.replace(/\n*__bilingual_split__\n*/g, '__bilingual_split__');
  }

  return text.split('\n').map(function(line){
    return line.trim();
  }).filter(function(line){
    return line.length > 0;
  });
};

// _appendAiCallMessage(text)
// → 统一追加一条 AI 通话消息。
// 用于接听后的首句、多条双语首句等场景，避免复制粘贴遗漏事件绑定。
cbyd21_Call._appendAiCallMessage = function(text){
  text = String(text || '').trim();
  if(!text)return;

  if(typeof _stripLeakedThinking === 'function'){
    text = _stripLeakedThinking(text);
  }

  if(typeof cbyd21_Call._applyRegexForCallChar === 'function'){
    text = cbyd21_Call._applyRegexForCallChar(text, 'aiOutput', _callCharId);
  }else if(typeof applyRegexRules === 'function'){
    text = applyRegexRules(text, 'aiOutput');
  }

  if(!text)return;

  _callMessages.push({
    role:'ai',
    content:text,
    _ts:Date.now()
  });

  var msgDiv = document.createElement('div');
  msgDiv.className = 'call-msg ai';

  if(text.indexOf('__bilingual_split__') >= 0){
    msgDiv.innerHTML = _renderCallBilingual(text);
  }else{
    msgDiv.textContent = text;
  }

  msgDiv.dataset.cidx = _callMessages.length - 1;

  msgDiv.addEventListener('contextmenu', function(e){
    e.preventDefault();
    cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this);
  });

  var _callMsgPressTimer = null;

  msgDiv.addEventListener('touchstart', function(){
    var _el = this;
    _callMsgPressTimer = setTimeout(function(){
      cbyd21_Call.openCallMsgMenu(parseInt(_el.dataset.cidx), _el);
    }, 600);
  }, { passive:true });

  msgDiv.addEventListener('touchend', function(){
    clearTimeout(_callMsgPressTimer);
  });

  msgDiv.addEventListener('touchmove', function(){
    clearTimeout(_callMsgPressTimer);
  });

  var container = document.getElementById('callMessages');
  if(container){
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  var miniCard = document.getElementById('callMiniCard');
  if(miniCard && miniCard.style.display !== 'none'){
    cbyd21_Call._renderMiniCardMsgs();
  }
};

// _connectWithSignalFallback(reason)
// → 通话接听判断 API 失败时的沉浸式兜底接通。
// · 保留“电话接通”的真实感。
// · 写入一条自然的“信号不稳”通话消息，让用户知道电话接上了但状态不稳定。
// · 不出现“点按钮 / 触发回复 / 继续说两句”这种 UI 操作提示，避免破坏真实感。
// · 先写入消息再 connectCall()，让 _callMessages.length > 0，防止 connectCall 自动触发第二次 API。
// · 后续由用户自己说话，或自己点击通话里的继续按钮，手动触发下一次回复。
cbyd21_Call._connectWithSignalFallback = function(reason){
  if(_callState !== 'ringing')return;

  var fallbackText = '……喂？听得到吗？这边信号好像不太好。';

  _callMessages.push({
    role: 'ai',
    content: fallbackText,
    _ts: Date.now(),
    _signalFallback: true
  });

  cbyd21_Call.connectCall();

  // connectCall() 内部会把状态写成“通话中”，所以这里要在它之后再覆盖成信号不稳。
  document.getElementById('callStatus').textContent = '通话中 · 信号不稳';

  var container = document.getElementById('callMessages');
  if(container){
    var msgDiv = document.createElement('div');
    msgDiv.className = 'call-msg ai';
    msgDiv.style.cssText = 'opacity:0.82;font-style:italic';
    msgDiv.textContent = fallbackText;
    msgDiv.dataset.cidx = _callMessages.length - 1;

    msgDiv.addEventListener('contextmenu', function(e){
      e.preventDefault();
      cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this);
    });

    var _fallbackPt = null;
    msgDiv.addEventListener('touchstart', function(e){
      var _el = this;
      _fallbackPt = setTimeout(function(){
        cbyd21_Call.openCallMsgMenu(parseInt(_el.dataset.cidx), _el);
      }, 600);
    }, { passive: true });

    msgDiv.addEventListener('touchend', function(){
      clearTimeout(_fallbackPt);
    });

    msgDiv.addEventListener('touchmove', function(){
      clearTimeout(_fallbackPt);
    });

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  showToast('通话已接通，信号不稳');
};

// ============================================================
// 通话核心流程
// ============================================================

// startCall() → 发起通话
// · 初始化通话界面（头像/名字/状态）
// · 进入 ringing 状态
// · 视频模式时加载立绘
// · 1.2秒后调用 askCallAcceptOrReject 让AI判断是否接听
cbyd21_Call.startCall = function(){
  document.getElementById('plusPanel').classList.remove('active');

  if(!cbyd21_Call._promptReadyOrToast())return;

  if(
    window.cbyd21_InlineOffline &&
    cbyd21_InlineOffline.isEnabledForCurrentChat &&
    cbyd21_InlineOffline.isEnabledForCurrentChat()
  ){
    showToast('线上内嵌线下中，通话暂不可用');
    return;
  }

  // 双重保护：即使绕过 openCallTypeMenu 直接调用 startCall，
  // 也不能在已有通话未结束时开启第二通电话。
  if(_callState && _callState !== 'idle'){
    showToast('当前已有通话进行中');
    if(_callState === 'connected'){
      cbyd21_Call.restoreCallScreen();
    }
    return;
  }

  var ch = getChatChar();
  if(!ch || ch.id === DEFAULT_CHAR_ID){ showToast('写卡助手不支持通话'); return; }
  if(!apiConfig.url || !apiConfig.key || !apiConfig.model){ showToast('请先配置API'); return; }
  _callCharId = ch.id;
  _callBranchId = currentChatId;
  _callDirection = 'outgoing';
  _callState = 'ringing';
  _callMessages = [];
  var avatarEl = document.getElementById('callAvatar');
  avatarEl.innerHTML = ch.avatar ? '<img src="' + ch.avatar + '">' : escHtml(ch.name.charAt(0));
  document.getElementById('callName').textContent = ch.name;
  document.getElementById('callStatus').textContent = '正在呼叫…';
  document.getElementById('callTimer').style.display = 'none';
  document.getElementById('callMessages').innerHTML = '';
  document.getElementById('callInput').value = '';
  document.getElementById('callAcceptBtnWrap').style.display = 'none';
  document.getElementById('callTyping').classList.remove('active');
  var overlay = document.getElementById('callOverlay');
  overlay.classList.remove('call-connected', 'call-ended');
  var _resetEndBtn = document.querySelector('.call-btn-end');
  if(_resetEndBtn){ _resetEndBtn.onclick = function(){ cbyd21_Call.endCall(); }; }
  var _resetEndLabel = _resetEndBtn.parentNode.querySelector('.call-btn-label');
  if(_resetEndLabel) _resetEndLabel.textContent = '挂断';
  if(_callIsVideo){
    overlay.classList.add('video-mode');
    loadVideoCallImages(ch);
  } else {
    overlay.classList.remove('video-mode');
  }
  overlay.classList.add('active');
  setTimeout(function(){
    if(_callState !== 'ringing') return;
    cbyd21_Call.askCallAcceptOrReject();
  }, 1200);
};

// askCallAcceptOrReject() → 调用API让角色判断是否接听
// · 注入角色人设+用户面具+最近聊天上下文
// · AI回复包含 __accept_call__ 则接听
// · AI回复包含 __reject_call__ 则拒接
// · API失败时兜底接通并显示自然的“信号不稳”通话消息，但不自动触发第二次API
// · 拒接后2秒关闭通话界面，可能在聊天里发一条文字消息
cbyd21_Call.askCallAcceptOrReject = async function(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  if(_callState !== 'ringing') return;
  var ch = getCharById(_callCharId);
  if(!ch || !apiConfig.url || !apiConfig.key || !apiConfig.model){
    document.getElementById('callStatus').textContent = '对方已接听';
    setTimeout(function(){ cbyd21_Call.connectCall(); }, 500);
    return;
  }
  var sp = [];
  var up = getCurrentProfile();
  var chat = null;
  if(_callBranchId){
    chat = chats.find(function(c){ return c.id === _callBranchId; }) || null;
  }else{
    chat = getCurrentChat();
  }
  var recentContext = '';
  if(chat && chat.messages.length > 0){
    recentContext = chat.messages.filter(function(m){
      return m &&
        m._mode !== 'ooc' &&
        m._mode !== 'inline_offline' &&
        m.content &&
        !m.content.startsWith('__system_') &&
        !m.content.startsWith('__call__');
    }).slice(-8).map(function(m){
      var c = m.content || '';

      if (typeof _cbyd21MessageContentForUserAction === 'function') {
        c = _cbyd21MessageContentForUserAction(c);
      }

      return (m.role === 'user' ? '用户' : '角色') + ': ' + c.slice(0, 80);
    }).join('\n');
  }
  var _wbCallAccept = cbyd21_Call._collectWorldBook(ch.id, [], recentContext ? [recentContext] : []);
  if(_wbCallAccept.system_start&&_wbCallAccept.system_start.length>0)sp.push('[最高优先级强制指令 — 系统最前]\n'+_wbCallAccept.system_start.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
  cbyd21_Call._pushWorldBookBefore(sp,_wbCallAccept);
  if(ch.prompt && ch.prompt.trim() && !(typeof _isMissingCharPrompt==='function' && _isMissingCharPrompt(ch.prompt))) sp.push(_replaceCardVars(ch.prompt.trim(),ch.name,up.name||''));
  else sp.push('[角色设定]\n当前通话对象是「'+ch.name+'」。该角色完整人设缺失或需要从备份恢复。即使缺少详细人设，也不能把用户面具当成角色人设。');
  cbyd21_Call._pushWorldBookAfter(sp,_wbCallAccept);
  var _callUserBlock='[和我通话的用户]\n用户的名字是「'+(up.name||'我')+'」。'+((up.name&&up.name!=='我')?'':'用户没有设置名字。')+'\n绝对不能用角色自己的名字来称呼用户。';
  if(up.persona&&up.persona.trim())_callUserBlock+='\n'+up.persona.trim();
  sp.push(_callUserBlock);
  sp.push('[通话身份最终锁定]\n当前我扮演的角色是「'+ch.name+'」。\n用户是「'+(up.name||'用户')+'」。\n\n用户面具里的姓名、年龄、职业、外貌、性格、经历全部只属于用户，不属于我。不能把用户面具当成角色人设。');
  // 双语通话：接听 / 拒接后的第一句文字都要保持双语格式
  if(typeof cbyd21_Call._pushOocInstructionBlock === 'function'){
    cbyd21_Call._pushOocInstructionBlock(sp, chat, '通话接听 / 拒接判断');
  }

  var _callAcceptTimeBlock = cbyd21_Call._buildTimeAwareBlock(ch, '通话接听 / 拒接判断');
  if(_callAcceptTimeBlock)sp.push(_callAcceptTimeBlock);

  if(ch && ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName){
    sp.push('[双语通话格式]\n角色的母语是'+ch._bilingual.langName+'。\n\n格式规则：\n- 如果角色选择接听电话，回复必须以 __accept_call____bl_json__ 开头，后面紧跟前端可识别的双语消息数组。\n- 如果角色选择不接电话，回复必须以 __reject_call____bl_json__ 开头，后面紧跟前端可识别的双语消息数组。\n- __accept_call__ / __reject_call__ 必须和 __bl_json__ 紧挨着写在同一行。\n- 双语消息数组里的每个对象代表一条线上聊天气泡。\n- 每个对象必须包含 t 和 c 两个字段。\n- t 字段写'+ch._bilingual.langName+'原文，c 字段写对应的简体中文翻译。\n- c 字段必须是简体中文，不能是英文或其他语言。\n- 这个格式只决定通话接听/拒接后的消息和翻译怎么显示，不代表你在执行代码任务。\n- 字符串用双引号，内容里的双引号要写成 \\\", 换行要写成 \\n。\n- 不要把消息数组包进代码块，不要美化成多行。\n\n内容规则：\n- 接听或拒接都必须严格符合角色卡设定、角色当前情绪、说话习惯和你们的关系状态。\n- 拒接电话不等于沉默。角色可以不接电话，但挂断后的文字必须是角色本人真实会发给用户的回应。\n- 文字里要能体现角色对这通电话的反应，而不是系统通知、格式占位或敷衍回复。\n- 不要写分析过程，不要写旁白，不要替用户补充未发生的行为。');
  }

  else {
    var _acceptRejectMin = ch.replyMin || 1;
    var _acceptRejectMax = ch.replyMax || 1;
    sp.push('[拒接后的线上文字发送格式]\n如果角色决定不接电话，挂断后仍然需要通过线上文字回应用户。拒接不是沉默，也不是系统失败；它是角色在当前关系、当前情境和当前情绪下做出的反应。\n\n格式规则：\n- 拒接电话后的回复必须以 __reject_call____msg_json__ 开头，后面紧跟前端可识别的消息数组。\n- __reject_call__ 和 __msg_json__ 必须紧挨着写在同一行。\n- 消息数组里的每个对象代表一条聊天气泡，只需要 c 字段。\n- 数组长度控制在 ' + _acceptRejectMin + ' 到 ' + _acceptRejectMax + ' 条之间。\n- 每个 c 字段都必须是角色真实会发给用户的文字，不能空白，不能像系统提示，不能敷衍。\n- 不要把消息数组包进代码块，不要美化成多行。\n\n内容规则：\n- 接听或拒接都必须严格符合角色卡设定、角色当前情绪、说话习惯和你们的关系状态。\n- 这个格式只决定聊天气泡怎么分条，不代表你在执行代码任务，也不改变你正在扮演角色这件事。\n- 角色卡是最高依据，不能套用固定模板，不能为了完成格式而牺牲角色本人的语气和关系质感。\n- 角色对用户的态度必须让用户感觉到自己被认真对待。尊重不只是避免脏话或攻击性词汇，也包括不能轻视用户、不能把用户当作可以随意处理的人、不能让用户感觉自己的来电和情绪被敷衍。\n- 如果角色卡里写了角色对用户有在意、亲近、矛盾、克制、依赖、逃避或其他复杂关系，这些关系质感必须自然体现在拒接后的文字里。\n- 不要写分析过程，不要写旁白，不要替用户补充未发生的行为。');
  }

  if(ch && !(ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName)){
    sp.push(_cbyd21DefaultChineseGate('通话接听 / 拒接', '接听电话后的第一句话、拒接电话后的线上文字回应', {
      includeStrictOocProtocol:true
    }));
  }

  sp.push('[来电判断]\n用户正在给你打电话。你现在不是在执行一个功能判断，而是作为这个角色，在真实关系里面对一次来电。\n\n你需要根据角色卡和最近聊天，自然判断：这个角色此刻会不会接。\n\n判断依据：\n- 角色设定中的性格、习惯、表达方式和对用户的关系\n- 你和用户当前的关系状态、亲密程度、矛盾状态、情绪距离和近期互动\n- 最近聊天里的情绪氛围，以及用户这次来电在当前关系里意味着什么\n- 当前时间背景和角色此刻可能处在的状态\n- 角色卡中关于面对用户时的专属态度，不能用角色面对其他人的方式覆盖\n\n' + (recentContext ? '最近的聊天记录：\n' + recentContext + '\n\n' : '') + '请只输出最终结果，不要写分析过程。\n\n如果你决定接听：\n- 回复必须以 __accept_call__ 开头。\n- 后面紧跟接起电话后的第一句话。\n- 如果上方另有双语格式规则，必须让 __accept_call__ 和对应双语格式紧挨着输出。\n- 第一句话必须像角色本人在电话那头真实说出来的内容，不能像客服，不能像系统提示。\n- 内容可以简短，但必须保留角色的语气、关系质感和对用户的态度。\n\n如果你决定不接：\n- 回复必须以 __reject_call__ 开头。\n- 如果上方另有JSON或双语格式规则，必须让 __reject_call__ 和对应格式紧挨着输出。\n- 拒接后的文字不是交差，而是角色对这通电话的真实回应。\n- 不能空白，不能像系统提示，不能敷衍用户。\n- 尊重用户不只是避免脏话或攻击性词汇，也包括不能轻视用户、不能把用户的来电视为无关紧要、不能让用户感觉自己被随意对待。\n\n判断必须贴合角色卡。角色卡决定角色接不接、怎么接、怎么拒接、拒接后怎么回应。不要把所有角色写成同一种礼貌模板，也不要为了格式牺牲角色的真实感。');

  if(_wbCallAccept.system_end.length > 0) sp.push('[强制指令]\n' + _wbCallAccept.system_end.map(function(w){ return '[' + w.name + ']\n' + w.content; }).join('\n\n'));

  var sm = sp.join('\n\n---\n\n');
  try {
    var url = apiConfig.url.replace(/\/+$/, '') + '/chat/completions';
    var _acceptMsgs = [{role:'user',content:'[用户正在拨打电话]'}];

    var _acceptBody = {
      model:apiConfig.model,
      messages:null
    };

    if(apiConfig.temperature !== undefined){
      _acceptBody.temperature = apiConfig.temperature;
    }

    if(_wbCallAccept.depth.length > 0){
      _wbCallAccept.depth.forEach(function(w){
        var depthPos = w.depth || 4;
        var insertIdx = Math.max(0, _acceptMsgs.length - depthPos);
        _acceptMsgs.splice(insertIdx, 0, { role:'user', content:'[前端深度注入 — 这不是用户发言]\n[World Book — ' + w.name + ']\n' + w.content });
      });
    }

    _acceptBody.messages = cbyd21_Call._buildContextPackMessages(sm,_acceptMsgs,_wbCallAccept,'通话接听/拒接判断');

    var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiConfig.key},body:JSON.stringify(_acceptBody)});
    var _rawAcceptText = await r.text();

    if(!r.ok){
      var _acceptErrParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawAcceptText)
        : {data:null,text:''};

      var _acceptErrText = String(_acceptErrParsed.text || '').trim();

      if(!_acceptErrText && _acceptErrParsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
        _acceptErrText = String(_cbyd21ExtractChatApiContent(_acceptErrParsed.data) || '').trim();
      }

      var _acceptErrLooksLikeOnlyError =
        /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(_acceptErrText) ||
        (
          _acceptErrText.length < 30 &&
          /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(_acceptErrText)
        );

      if(_acceptErrText && _acceptErrText.length >= 10 && !_acceptErrLooksLikeOnlyError){
        console.warn('通话接听判断 HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常接听判断处理');
      }else{
        cbyd21_Call._showCallApiError('通话接听判断失败', new Error('HTTP '+r.status+': '+_rawAcceptText.slice(0,300)));

        // 接听判断失败时仍然兜底接通，保留通话真实感。
        // 但只显示“信号不稳”的自然通话内容，不自动触发第二次 API。
        cbyd21_Call._connectWithSignalFallback('HTTP '+r.status);
        return;
      }
    }

    var _parsedAcceptText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawAcceptText)
      : {data:null,text:_rawAcceptText};

    var d = _parsedAcceptText.data || {};
    var reply = _parsedAcceptText.text || cbyd21_Call._extractReplyContent(d);

    if(!reply && _rawAcceptText && String(_rawAcceptText).trim()){
      reply = String(_rawAcceptText || '').trim();
    }

    reply = String(reply || '').trim();

    if(typeof _stripLeakedThinking === 'function') reply = _stripLeakedThinking(reply);
    if(_callState !== 'ringing') return;
    if(reply.includes('__reject_call__')){
      var rejectMsg = reply.replace(/__reject_call__/g, '').trim();

      // 拒接判断和拒接后文字应由同一次 API 完成。
      // 如果模型只返回拒接标记却没有文字，这里用本地兜底消息，
      // 保证拒接后不会静默，同时不额外调用 API。
      if(!rejectMsg){
        rejectMsg = '刚才不方便接电话，看到你的来电了。';
      }

      document.getElementById('callStatus').textContent = '对方已挂断';
      _callState = 'ended';
      var overlay = document.getElementById('callOverlay');
      overlay.classList.add('call-ended');
      document.getElementById('callAcceptBtnWrap').style.display = 'none';
      var _rejEndBtn = document.querySelector('.call-btn-end');
      if(_rejEndBtn){ _rejEndBtn.onclick = function(){ cbyd21_Call.closeCallScreen(); }; }
      var _rejLabel = _rejEndBtn.parentNode.querySelector('.call-btn-label');
      if(_rejLabel) _rejLabel.textContent = '关闭';
      var _rejCharId2 = _callCharId;
      var _rejBranchId2 = _callBranchId || currentChatId;
      setTimeout(function(){
        cbyd21_Call.closeCallScreen();
        if(rejectMsg && rejectMsg.length > 0){
          var chat2 = _rejBranchId2 ? chats.find(function(c){ return c.id === _rejBranchId2; }) : getCurrentChat();
          if(chat2){
          var time2 = formatTime(Date.now());
          var _oldMode2 = currentMode;

          currentMode = 'online';

          try{
            cbyd21_Call._appendOnlineReplySafely(chat2, rejectMsg, time2, '拒接后文字回复');
          }finally{
            currentMode = _oldMode2;
          }

          cbyd21_Data.saveChats();
          scrollToBottom();
          }
        }
      }, 2000);
    } else {
      var acceptMsg = reply.replace(/__accept_call__/g, '').trim();
      document.getElementById('callStatus').textContent = '对方已接听';
      setTimeout(function(){
        var _acceptLineCount = 0;

        if(acceptMsg && acceptMsg.length > 0){
          var _acceptLines = cbyd21_Call._normalizeBilingualJsonReply(acceptMsg);

          _acceptLines.forEach(function(line){
            if(line && String(line).trim()){
              cbyd21_Call._appendAiCallMessage(line);
              _acceptLineCount++;
            }
          });
        }

        // 接听判断和第一句话应尽量由同一次 API 完成。
        // 如果模型只返回了接听标记却没有第一句话，这里用本地极短开场兜底，
        // 避免 connectCall() 因 _callMessages.length === 0 再额外调用一次 API。
        if(_acceptLineCount === 0){
          cbyd21_Call._appendAiCallMessage('喂。');
        }

        cbyd21_Call.connectCall();
      }, 500);
    }
  } catch(e){
    // 接听判断请求异常时，也按“信号不稳”兜底接通。
    // 不显示失败式系统通知，不自动触发第二次 API。
    // 后续由用户自然继续通话，或手动点通话里的继续按钮。
    if(_callState === 'ringing'){
      cbyd21_Call._showCallApiError('通话接听判断失败', e);
      cbyd21_Call._connectWithSignalFallback(e && e.message ? e.message : 'API响应失败');
    }
  }
};

// acceptCall() → 来电时手动点击接听按钮
cbyd21_Call.acceptCall = function(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  if(_callState !== 'ringing') return;
  cbyd21_Call.connectCall();
};

// connectCall() → 进入通话中状态
// · 启动计时器（每秒更新 MM:SS）
// · 显示消息区+输入框+缩小/静音按钮
// · 如果还没有AI消息（刚接通），800ms后触发AI先开口
// · 临时禁用聊天界面的语音按钮（通话中不能发语音消息）
cbyd21_Call.connectCall = function(){
  _callState = 'connected';
  _callStartTime = Date.now();
  var overlay = document.getElementById('callOverlay');
  overlay.classList.add('call-connected');
  document.getElementById('callStatus').textContent = '通话中';
  document.getElementById('callTimer').style.display = 'block';
  document.getElementById('callTimer').textContent = '00:00';
  document.getElementById('callAcceptBtnWrap').style.display = 'none';
  var _muteWrap=document.getElementById('callMuteBtnWrap');
  _muteWrap.style.display='block';
  if(_callIsVideo){
    _callCameraOn=true;
    _muteWrap.innerHTML='<div class="call-btn call-btn-func" id="callCameraBtn" onclick="cbyd21_Call.toggleCamera()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="15" height="14" rx="2"/><path d="M17 9l5-3v12l-5-3"/></svg></div><div class="call-btn-label" style="text-align:center;color:var(--text-muted)">摄像头</div>';
  }else{
    _muteWrap.innerHTML='<div class="call-btn call-btn-func" onclick="showToast(\'静音功能开发中\')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="12" height="12" rx="6"/><line x1="12" y1="16" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="3" y1="3" x2="21" y2="21" stroke-opacity="0.5"/></svg></div><div class="call-btn-label" style="text-align:center;color:var(--text-muted)">静音</div>';
  }
  document.getElementById('callMinimizeBtnWrap').style.display = 'block';
  _callTimerInterval = setInterval(cbyd21_Call.updateCallTimer, 1000);
  if(_callMessages.length === 0){ setTimeout(function(){ cbyd21_Call.triggerCallReply(); }, 800); }
  // 应用通话文字颜色
  var _ccCh=getCharById(_callCharId);if(_ccCh&&typeof _applyCallCardColors==='function')_applyCallCardColors(_ccCh);
  setTimeout(function(){ document.getElementById('callInput').focus(); }, 300);
  var _voiceBtn = document.querySelector('#inputArea .input-side-btn[onclick*="openVoiceInput"]');
  if(_voiceBtn){ _voiceBtn.dataset.prevOnclick = _voiceBtn.getAttribute('onclick'); _voiceBtn.setAttribute('onclick', 'showToast("通话中不能发语音")'); _voiceBtn.style.opacity = '0.3'; }
};

// updateCallTimer() → 每秒更新通话计时器显示 MM:SS
cbyd21_Call.updateCallTimer = function(){
  if(!_callStartTime) return;
  var elapsed = Math.floor((Date.now() - _callStartTime) / 1000);
  var min = Math.floor(elapsed / 60).toString().padStart(2, '0');
  var sec = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('callTimer').textContent = min + ':' + sec;
};

// sendCallMessage() → 用户在通话中发送文字消息
// · 添加到通话消息列表和界面
// · 绑定长按菜单事件
// · 触发AI回复
cbyd21_Call.sendCallMessage = function(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  if(_callState !== 'connected') return;
  var input = document.getElementById('callInput');
  var text = input.value.trim();
  if(!text || _callGenerating) return;
  input.value = '';
  _callMessages.push({ role: 'user', content: text, _ts:Date.now() });
  var msgDiv = document.createElement('div');
  msgDiv.className = 'call-msg user';
  msgDiv.textContent = text;
  msgDiv.dataset.cidx = _callMessages.length - 1;
  msgDiv.addEventListener('contextmenu', function(e){ e.preventDefault(); cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this); });
  var _cmpt3 = null;
  msgDiv.addEventListener('touchstart', function(e){ var _el3 = this; _cmpt3 = setTimeout(function(){ cbyd21_Call.openCallMsgMenu(parseInt(_el3.dataset.cidx), _el3); }, 600); }, { passive: true });
  msgDiv.addEventListener('touchend', function(){ clearTimeout(_cmpt3); });
  msgDiv.addEventListener('touchmove', function(){ clearTimeout(_cmpt3); });
  var container = document.getElementById('callMessages');
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
  cbyd21_Call.triggerCallReply();
};

// triggerCallReply() → 触发AI通话回复
// · 显示打字指示器（三个跳动圆点）
// · 调用 buildCallRequest 构建请求
// · 处理多行回复（逐条延迟显示）
// · 处理双语回复（__bilingual_split__）
// · 检测 __end_call__ 标记（角色主动挂断）
// · API错误时显示友好的错误提示（伪装成通话问题）
cbyd21_Call.triggerCallReply = async function(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  if(_callGenerating && document.getElementById('callTyping').classList.contains('active')) return;
  if(_callState !== 'connected') return;
  _callGenerating = true;
  document.getElementById('callTyping').classList.add('active');
  var _miniCard0 = document.getElementById('callMiniCard');
  if(_miniCard0 && _miniCard0.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); }
  var container = document.getElementById('callMessages');
  container.scrollTop = container.scrollHeight;
  try {
    var req = cbyd21_Call.buildCallRequest();
    _callAbortController=new AbortController();
    var r = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal:_callAbortController.signal });
    var _rawCallReplyText = await r.text();

    if(!r.ok){
      var _callReplyErrParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawCallReplyText)
        : {data:null,text:''};

      var _callReplyErrText = String(_callReplyErrParsed.text || '').trim();

      if(!_callReplyErrText && _callReplyErrParsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
        _callReplyErrText = String(_cbyd21ExtractChatApiContent(_callReplyErrParsed.data) || '').trim();
      }

      var _callReplyErrLooksLikeOnlyError =
        /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(_callReplyErrText) ||
        (
          _callReplyErrText.length < 30 &&
          /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(_callReplyErrText)
        );

      if(_callReplyErrText && _callReplyErrText.length >= 10 && !_callReplyErrLooksLikeOnlyError){
        console.warn('通话 HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常回复处理');
      }else{
        throw new Error('HTTP ' + r.status + ': ' + _rawCallReplyText.slice(0, 200));
      }
    }
    var _parsedCallReplyText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawCallReplyText)
      : {data:null,text:_rawCallReplyText};

    var d = _parsedCallReplyText.data || {};
    var reply = _parsedCallReplyText.text || cbyd21_Call._extractReplyContent(d);

    if(!reply && _rawCallReplyText && String(_rawCallReplyText).trim()){
      reply =
        '[前端提示：通话 API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
        String(_rawCallReplyText || '').trim();
    }

    reply = String(reply || '')
      .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/, '')
      .replace(/\n*<<<[A-Z_]+[\s\S]*$/, '')
      .trim();

    if(typeof _stripLeakedThinking === 'function') reply = _stripLeakedThinking(reply);
    if(!reply) reply = '……';
    var _charHangUp = false;
    if(reply.includes('__end_call__')){ _charHangUp = true; reply = reply.replace(/__end_call__/g, '').trim(); if(!reply) reply = '……'; }
    document.getElementById('callTyping').classList.remove('active');
    if(_callState !== 'connected'){ _callGenerating = false; var _miniCard1 = document.getElementById('callMiniCard'); if(_miniCard1 && _miniCard1.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); } return; }

    // 记录多行延迟显示的总耗时。
    // 如果角色主动挂断，需要等延迟消息基本显示完再挂断，避免最后几句话被截断。
    var _callDisplayDelayMax = 0;

    // JSON双语格式解析
    if(reply && reply.includes('__bl_json__')){
      var _bjCallLines = cbyd21_Call._normalizeBilingualJsonReply(reply);

      if(_bjCallLines.length > 0){
        reply = _bjCallLines.join('\n');
      }else{
        reply = reply.replace(/__bl_json__/g,'').trim();
      }
    }
    // 兼容旧版 __bl_sep__
    if(reply && reply.includes('__bl_sep__')){
      reply = reply.replace(/__bl_sep__\s*/g, '__bl_sep__\n').replace(/__bl_sep__/g, '');
    }
    if(typeof cbyd21_Call._applyRegexForCallChar === 'function'){
      reply = cbyd21_Call._applyRegexForCallChar(reply, 'aiOutput', _callCharId);
    }else if(typeof applyRegexRules === 'function'){
      reply = applyRegexRules(reply, 'aiOutput');
    }
    // 双语回复处理（兼容旧格式+JSON转换后的格式）
    if(reply && reply.includes('__bilingual_split__')){
      reply = reply.replace(/\n*__bilingual_split__\n*/g, '__bilingual_split__');
      var _rawBiLines = reply.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 0; });
      // 合并被错误分开的原文和翻译：
      // 如果某行以__bilingual_split__开头（原文为空），和上一行合并
      // 如果某行没有__bilingual_split__且下一行以__bilingual_split__开头，也合并
      var biLines = [];
      for(var _bmi = 0; _bmi < _rawBiLines.length; _bmi++){
        var _bmLine = _rawBiLines[_bmi];
        if(_bmLine.startsWith('__bilingual_split__') && biLines.length > 0 && !biLines[biLines.length-1].includes('__bilingual_split__')){
          biLines[biLines.length-1] += _bmLine;
        } else if(!_bmLine.includes('__bilingual_split__') && _bmi + 1 < _rawBiLines.length && _rawBiLines[_bmi+1].startsWith('__bilingual_split__')){
          biLines.push(_bmLine + _rawBiLines[_bmi+1]);
          _bmi++;
        } else {
          biLines.push(_bmLine);
        }
      }
      if(biLines.length <= 1){
        _callMessages.push({ role: 'ai', content: reply, _ts:Date.now() });
        var bilingualDiv = document.createElement('div');
        bilingualDiv.className = 'call-msg ai';
        bilingualDiv.innerHTML = _renderCallBilingual(reply);
        bilingualDiv.dataset.cidx = _callMessages.length - 1;
        bilingualDiv.addEventListener('contextmenu', function(e){ e.preventDefault(); cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this); });
        var _cmptB = null;
        bilingualDiv.addEventListener('touchstart', function(e){ var _elB = this; _cmptB = setTimeout(function(){ cbyd21_Call.openCallMsgMenu(parseInt(_elB.dataset.cidx), _elB); }, 600); }, { passive: true });
        bilingualDiv.addEventListener('touchend', function(){ clearTimeout(_cmptB); });
        bilingualDiv.addEventListener('touchmove', function(){ clearTimeout(_cmptB); });
        container.appendChild(bilingualDiv);
        container.scrollTop = container.scrollHeight;
        var _miniCardSingleBi = document.getElementById('callMiniCard');
        if(_miniCardSingleBi && _miniCardSingleBi.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); }
      } else {
        // 多行双语：逐条延迟显示
        var biDelay = 0;
        biLines.forEach(function(line){
          biDelay += 300 + Math.min(line.length * 20, 800);
          _callDisplayDelayMax = Math.max(_callDisplayDelayMax, biDelay);

          setTimeout(function(){
            if(_callState !== 'connected') return;
            _callMessages.push({ role: 'ai', content: line, _ts:Date.now() });
            var md = document.createElement('div');
            md.className = 'call-msg ai';
            if(line.includes('__bilingual_split__')){ md.innerHTML = _renderCallBilingual(line); }
            else { md.textContent = line; }
            md.dataset.cidx = _callMessages.length - 1;
            md.addEventListener('contextmenu', function(e){ e.preventDefault(); cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this); });
            var _cmptBm = null;
            md.addEventListener('touchstart', function(e){ var _elBm = this; _cmptBm = setTimeout(function(){ cbyd21_Call.openCallMsgMenu(parseInt(_elBm.dataset.cidx), _elBm); }, 600); }, { passive: true });
            md.addEventListener('touchend', function(){ clearTimeout(_cmptBm); });
            md.addEventListener('touchmove', function(){ clearTimeout(_cmptBm); });
            container.appendChild(md);
            container.scrollTop = container.scrollHeight;
            var _miniCardLive1 = document.getElementById('callMiniCard');
            if(_miniCardLive1 && _miniCardLive1.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); }
          }, biDelay);
        });
      }
    } else {
      // 普通回复处理
      // 通话里不再按标点强拆。
      // 如果模型自然换行，就按换行显示；如果模型输出一整段，就保留一整段。
      // 这样避免把角色电话里的完整表达切得很碎。
      var lines = reply.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 0; });

      if(lines.length <= 1){
        // 单行回复：直接显示
        _callMessages.push({ role: 'ai', content: reply, _ts:Date.now() });
        var msgDiv = document.createElement('div');
        msgDiv.className = 'call-msg ai';
        msgDiv.textContent = reply;
        msgDiv.dataset.cidx = _callMessages.length - 1;
        msgDiv.addEventListener('contextmenu', function(e){ e.preventDefault(); cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this); });
        var _cmpt = null;
        msgDiv.addEventListener('touchstart', function(e){ var _el = this; _cmpt = setTimeout(function(){ cbyd21_Call.openCallMsgMenu(parseInt(_el.dataset.cidx), _el); }, 600); }, { passive: true });
        msgDiv.addEventListener('touchend', function(){ clearTimeout(_cmpt); });
        msgDiv.addEventListener('touchmove', function(){ clearTimeout(_cmpt); });
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        var _miniCardSingle = document.getElementById('callMiniCard');
        if(_miniCardSingle && _miniCardSingle.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); }
      } else {
        // 多行回复：逐条延迟显示（模拟真人说话节奏）
        var delay = 0;
        lines.forEach(function(line){
          delay += 300 + Math.min(line.length * 20, 800);
          _callDisplayDelayMax = Math.max(_callDisplayDelayMax, delay);

          setTimeout(function(){
            if(_callState !== 'connected') return;
            _callMessages.push({ role: 'ai', content: line, _ts:Date.now() });
            var md = document.createElement('div');
            md.className = 'call-msg ai';
            md.textContent = line;
            md.dataset.cidx = _callMessages.length - 1;
            md.addEventListener('contextmenu', function(e){ e.preventDefault(); cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this); });
            var _cmpt2 = null;
            md.addEventListener('touchstart', function(e){ var _el2 = this; _cmpt2 = setTimeout(function(){ cbyd21_Call.openCallMsgMenu(parseInt(_el2.dataset.cidx), _el2); }, 600); }, { passive: true });
            md.addEventListener('touchend', function(){ clearTimeout(_cmpt2); });
            md.addEventListener('touchmove', function(){ clearTimeout(_cmpt2); });
            container.appendChild(md);
            container.scrollTop = container.scrollHeight;
            var _miniCardLive2 = document.getElementById('callMiniCard');
            if(_miniCardLive2 && _miniCardLive2.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); }
          }, delay);
        });
      }
    }
    // 角色主动挂断：
    // 如果本轮回复是多行逐条显示，要等最后一条基本显示完再挂断，
    // 避免 __end_call__ 导致后续延迟消息被 _callState 判断拦掉。
    if(_charHangUp && _callState === 'connected'){
      var _hangDelay = Math.max(1500, _callDisplayDelayMax + 800);

      setTimeout(function(){
        _callGenerating = false;

        var _miniBeforeEnd = document.getElementById('callMiniCard');
        if(_miniBeforeEnd && _miniBeforeEnd.style.display !== 'none'){
          cbyd21_Call._renderMiniCardMsgs();
        }

        cbyd21_Call.endCall();
      }, _hangDelay);
    }
  } catch(e){
    if(e && (e.name === 'PromptLoadingBlocked' || e._cbyd21PromptLoadingBlocked || String(e.message || '').indexOf('PromptLoadingBlocked') >= 0)){
      _callAbortController = null;
      _callGenerating = false;
      document.getElementById('callTyping').classList.remove('active');

      var _miniPromptBlocked = document.getElementById('callMiniCard');
      if(_miniPromptBlocked && _miniPromptBlocked.style.display !== 'none'){
        cbyd21_Call._renderMiniCardMsgs();
      }

      showToast('提示词正在加载，请稍等…');
      return;
    }

    if(e.name==='AbortError'){_callAbortController=null;_callGenerating=false;document.getElementById('callTyping').classList.remove('active');showToast('已终止');return}
    // API错误伪装成通话问题，保持沉浸感
    document.getElementById('callTyping').classList.remove('active');
    var _callErrMsg = e.message || '';
    var _miniCardErr = document.getElementById('callMiniCard');
    if(_miniCardErr && _miniCardErr.style.display !== 'none'){ cbyd21_Call._renderMiniCardMsgs(); }
    var _callErrHint = '通话信号不好';
    if(_callErrMsg.includes('Failed to fetch') || _callErrMsg.includes('network')){ _callErrHint = '网络断开了'; }
    else if(_callErrMsg.includes('401') || _callErrMsg.includes('Unauthorized')){ _callErrHint = 'API连接失效'; }
    else if(_callErrMsg.includes('402') || _callErrMsg.includes('insufficient')){ _callErrHint = 'API余额不足'; }
    else if(_callErrMsg.includes('429')){ _callErrHint = '说太快了，等一下'; }
    else if(_callErrMsg.includes('500') || _callErrMsg.includes('502') || _callErrMsg.includes('503')){ _callErrHint = '对方信号不好'; }
    var errDiv = document.createElement('div');
    errDiv.className = 'call-msg ai';
    errDiv.style.cssText = 'opacity:0.6;font-style:italic';
    errDiv.textContent = '（' + _callErrHint + '……）';
    var _errContainer = document.getElementById('callMessages');
    if(_errContainer){
      _errContainer.appendChild(errDiv);
      _errContainer.scrollTop = _errContainer.scrollHeight;
    }
    cbyd21_Call._showCallApiError('通话回复失败', e);
  }
  _callAbortController=null;

  // 如果角色本轮主动挂断，并且多行消息还在延迟显示，
  // 不要立刻把 _callGenerating 设为 false。
  // 否则用户可能在挂断倒计时期间继续发送/触发，插入到即将结束的通话流程里。
  // 真正挂断时，上面的 _hangDelay 定时器里会把 _callGenerating 设回 false。
  if(!(_charHangUp && _callState === 'connected')){
    _callGenerating = false;
  }

  var _miniCard=document.getElementById('callMiniCard');
  if(_miniCard&&_miniCard.style.display!=='none'){cbyd21_Call._renderMiniCardMsgs()}
};

// buildCallRequest() → 构建通话模式的API请求
// · 注入角色人设 + 用户面具 + 记忆（call范围）
// · 注入通话专用提示词（口语化/挂断标记/双语）
// · 注入世界书的 system_end 位置条目
// · 注入最近聊天记录作为背景参考
// · 注入通话期间的文字消息（用户边打电话边发消息的场景）
//摄像头开关（仅视频通话）
cbyd21_Call.toggleCamera = function(){
  _callCameraOn = !_callCameraOn;
  var btn = document.getElementById('callCameraBtn');
  if(btn){
    if(_callCameraOn){
      btn.style.opacity = '1';
      btn.parentNode.querySelector('.call-btn-label').textContent = '摄像头';
    }else{
      btn.style.opacity = '0.4';
      btn.parentNode.querySelector('.call-btn-label').textContent = '已关闭';
    }
  }
  var pip = document.getElementById('callVideoPip');
  if(pip) pip.style.display = _callCameraOn ? '' : 'none';
  showToast(_callCameraOn ? '摄像头已开启' : '摄像头已关闭');
};

cbyd21_Call.buildCallRequest = function(){
  var ch = getCharById(_callCharId);
  var sp = [];
  var up = getCurrentProfile();
  var _callWbExtra = [];
  var _callCtxChatForWb = null;
  if(_callBranchId){
    _callCtxChatForWb = chats.find(function(c){ return c.id === _callBranchId; }) || null;
  }else{
    _callCtxChatForWb = getCurrentChat();
  }
  if(_callCtxChatForWb && _callCtxChatForWb.messages){
    _callCtxChatForWb.messages.filter(function(m){
      return m && m._mode !== 'ooc' && m._mode !== 'inline_offline';
    }).slice(-20).forEach(function(m){
      if(m && m.content){
        var c = m.content;
        if(typeof _cbyd21MessageContentForUserAction === 'function'){
          c = _cbyd21MessageContentForUserAction(c);
        }
        _callWbExtra.push(c);
      }
    });
  }
  var _wbCall = cbyd21_Call._collectWorldBook(_callCharId, _callMessages, _callWbExtra);
  if(_wbCall.system_start&&_wbCall.system_start.length>0)sp.push('[最高优先级强制指令 — 系统最前]\n'+_wbCall.system_start.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
  cbyd21_Call._pushWorldBookBefore(sp,_wbCall);
  if(ch && ch.prompt && ch.prompt.trim() && !(typeof _isMissingCharPrompt==='function' && _isMissingCharPrompt(ch.prompt))) sp.push(_replaceCardVars(ch.prompt.trim(),ch?ch.name:'',up.name||''));
  else if(ch) sp.push('[角色设定]\n当前通话对象是「'+ch.name+'」。该角色完整人设缺失或需要从备份恢复。即使缺少详细人设，也不能把用户面具当成角色人设。');
  cbyd21_Call._pushWorldBookAfter(sp,_wbCall);
  var _callBuildUserBlock='[和我通话的用户]\n用户的名字是「'+(up.name||'我')+'」。'+((up.name&&up.name!=='我')?'':'用户没有设置名字。')+'\n绝对不能用角色自己的名字来称呼用户。';
  if(up.persona&&up.persona.trim())_callBuildUserBlock+='\n'+up.persona.trim();
  _callBuildUserBlock+='\n\n角色卡里明确写了和用户的关系时，严格按角色卡来。没有明确定义时，默认你和用户处于一种比朋友亲密但没有明确定义的状态——有超出普通朋友的在意和好感。只有当角色卡明确表明关系不适合带亲近感时，才不按默认来。在意是底色。';
  sp.push(_callBuildUserBlock);
  if(ch)sp.push('[通话身份最终锁定]\n当前我扮演的角色是「'+ch.name+'」。\n用户是「'+(up.name||'用户')+'」。\n\n用户面具里的姓名、年龄、职业、外貌、性格、经历全部只属于用户，不属于我。不能把用户面具当成角色人设。');

  var _callDirectionText = _callDirection === 'incoming'
    ? '这通电话由你主动拨出，用户刚刚接听。你在这通电话里是主动联系用户的一方。'
    : '这通电话由用户主动拨出，你刚刚接听。你在这通电话里是接到用户来电的一方。';

  sp.push(
    '[本次通话方向]\n' +
    _callDirectionText + '\n\n' +
    '后续所有通话发言都必须以这个通话方向为事实基础。电话是谁主动拨出的，会影响角色的第一句话、情绪反应、解释方式和关系质感。'
  );

  if(typeof cbyd21_Call._pushOocInstructionBlock === 'function'){
    cbyd21_Call._pushOocInstructionBlock(sp, _callCtxChatForWb, '通话中');
  }

  var _callLiveTimeBlock = cbyd21_Call._buildTimeAwareBlock(ch, '通话中');
  if(_callLiveTimeBlock)sp.push(_callLiveTimeBlock);

  var _callMemOldChatId = currentChatId;
  if(_callBranchId){
    currentChatId = _callBranchId;
  }

  var memories = getFilteredMemories(_callCharId, 'call');

  currentChatId = _callMemOldChatId;

  if(memories.length > 0){ sp.push('[Character Memory]\n' + memories.map(function(m){ return m.content; }).join('\n\n')); }
  var _callTypeLabel=_callIsVideo?'视频通话':'语音通话';
  var _cameraHint='';
  if(_callIsVideo){
    if(_callCameraOn){
      _cameraHint='\n\n[视频画面]\n这是视频通话，双方都能看到对方。用户的摄像头是开着的，你能看到用户那边的画面——可以看到用户的背景环境和大致状态，但不知道用户具体在哪个城市或地点。你可以自然地提到看到的内容（比如"你那边好像挺暗的""你背后那个是什么"），但不要每句话都提。';
    }else{
      _cameraHint='\n\n[视频画面]\n这是视频通话，但用户关闭了摄像头。你只能听到用户的声音，看不到用户那边的画面。你的画面用户是能看到的。';
    }
  }
  sp.push('[通话模式]\n你现在正在和{{user}}打'+_callTypeLabel+'。'+_cameraHint+'\n\n通话模式的规则：\n- 严格按照上方角色设定的性格、说话方式、语气习惯来说话。\n- 你说的每一句话都是在电话里说出来的，是即时的、口语化的、正在发生的交流。\n- 通话里的语气可以比打字更接近真实说话，但仍然必须由角色卡决定，不能套用统一口吻。\n- 可以用文字呈现电话里自然存在的语气变化，但不要使用星号动作格式，不要写旁白，不要写心理活动。\n- 回复保持通话节奏，不要把电话说成大段文章，也不要因为追求简短而变得空洞。\n- 如果是通话刚接通，第一句话必须从角色卡、当前关系、最近上下文和来电情境自然生成。\n- 你就是电话那头正在说话的那个人，不是旁白，不是系统，不是AI。\n\n[通话用语底线]\n不管角色是什么性格、什么说话方式、和用户是什么关系，在电话里说的每一句话，用户听完之后都不应该产生被冒犯、被看不起、被嫌弃、被轻视的感受。\n\n尊重用户不只是用词层面不说脏话、不使用攻击性词汇。说话的态度同样必须尊重用户。不能把用户的时间、情绪、来电、回应或陪伴视为理所当然，不能让用户感觉自己被随便对待。\n\n态度层面的判断标准：这句话说出去，对面那个人听完会觉得自己是被认真对待、被珍重的，还是被轻视、被支配、被敷衍的。前者合格，后者不合格。\n\n角色的性格决定说话方式、能量、节奏和表达外壳，不决定对用户的尊重程度。面对用户时，不能因为角色卡写了某种强烈性格，就让角色获得轻视用户的许可。\n\n判断态度是否合格时，把角色的性格标签暂时拿掉，只看这句话本身在向用户传达什么。如果裸内容会让用户觉得自己不被当回事、被擅自定义、被放在不对等的位置，或者自己的感受被轻慢处理，那么这句话不合格。\n\n角色卡没有明确说明的情况下，禁止对用户使用粗鄙、不礼貌或带有冒犯性的语言。角色卡明确支持某种说话风格的，上面的底线仍然生效。唯一的赦免情况：角色卡的核心设定本身就把伤害用户的情感体验作为这个角色存在的目的和玩法。判断不确定时，默认不赦免。\n\n[挂断电话]\n如果角色觉得这通电话该结束了，可以在回复的最末尾加上 __end_call__ 标记来主动挂断。\n挂断必须由角色卡、当前情境、当前关系和通话内容共同支撑。\n挂断前说的最后一句话要自然，像这个角色本人会结束通话的方式。\n不要频繁挂断，只在情境确实需要结束通话时才挂。');
  // 双语通话
  if(ch && ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName){
    var _blLang3 = ch._bilingual.langName;
    sp.push('[通话双语]\n角色在电话里说' + _blLang3 + '。\n\n严格格式：用前端可识别的双语消息数组输出，标记为 __bl_json__：\n__bl_json__[{"t":"' + _blLang3 + '原文","c":"简体中文翻译"}]\n\n多句话时数组放多个对象：\n__bl_json__[{"t":"第一句' + _blLang3 + '","c":"第一句的简体中文翻译"},{"t":"第二句' + _blLang3 + '","c":"第二句的简体中文翻译"}]\n\n规则：\n- 整个回复以 __bl_json__ 开头，后面紧跟可解析的双语消息数组\n- 这个格式只决定通话消息和翻译怎么显示，不代表你在执行代码任务\n- 每个对象 t 和 c 严格一对一\n- c 字段必须是简体中文翻译，绝对不能是英文或其他语言\n- 字符串用双引号\n- 绝对禁止把多句原文堆在一个 t 里');
  }

  if(ch && !(ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName)){
    sp.push(_cbyd21DefaultChineseGate('通话中', '电话里的普通发言', {
      includeStrictOocProtocol:true
    }));
  }

  // 完整聊天上下文注入（和线上聊天共享同一份上下文）
  var _callChatTimelineMsgs = [];
  var chat = _callBranchId ? chats.find(function(c){ return c.id === _callBranchId; }) : getCurrentChat();
  if(!chat) chat = getCurrentChat();
  if(chat && chat.messages.length > 0){
    var _bch = getCharById(_callCharId);
    var _ctxR = _bch && _bch.contextRounds !== undefined ? _bch.contextRounds : 20;
    var _callChatOrder = 0;
    var _lastCallChatTs = 0;
    var _callHistoryExpandedTimeline = [];
    var _chatMsgsForCall = chat.messages.filter(function(m){
      if(!m || m._mode === 'ooc' || m._mode === 'inline_offline')return false;

      var c = m.content || '';
      return c !== '__system_init__' && c !== '__system_continue__';
    }).map(function(m){
      var c = m.content || '';

      if(
        typeof _cbyd21MessageContentForUserAction === 'function' &&
        (
          c.indexOf('__msg_json__') >= 0 ||
          c.indexOf('__long_text__') >= 0 ||
          c.indexOf('__html_payload__') >= 0
        )
      ){
        c = _cbyd21MessageContentForUserAction(c);
      }

      // 预处理特殊消息格式（和线上buildRequest一致）
      if(c.startsWith('__realimg__')) c = m._imageDesc ? '[图片：' + m._imageDesc + ']' : '[图片]';
      if(c.startsWith('__sticker__')) c = '[表情包]';
      if(c.startsWith('__user_recall__')) c = '[用户撤回了一条消息]';
      if(c.startsWith('__recall__')) c = '[角色撤回了一条消息]';
      if(c.startsWith('__transfer__')){ try { var _td = JSON.parse(c.slice(12)); c = '[转账 ¥' + _td.amount + (_td.note ? ' ' + _td.note : '') + ']'; } catch(e){ c = '[转账]'; } }
      if(c.startsWith('__call__')){
        try {
          var _cd2 = JSON.parse(c.slice(8));
          var _cdMsgs = _cd2.messages || [];
          var _cdDur = _cd2.duration || 0;
          var _cdMin = Math.floor(_cdDur / 60);

          if(_cdMsgs.length > 0){
            _cdMsgs.forEach(function(cm, cmi){
              var _cmText = cm.content || '';

              if(typeof _cbyd21MessageContentForUserAction === 'function'){
                _cmText = _cbyd21MessageContentForUserAction(_cmText);
              }

              _cmText = _cmText
                .replace(/__bilingual_split__[\s\S]*/, '')
                .replace(/__bl_sep__/g, '')
                .replace(/__inner_voice__[\s\S]*/, '')
                .trim();

              if(typeof _stripLeakedThinking === 'function') _cmText = _stripLeakedThinking(_cmText);

              if(!_cmText)_cmText = '（无文字内容）';

              var _cmSortTs = cm._ts || ((m._ts || 0) + cmi + 1);
              var _cmLabel = '[通话中';

              if(_cmSortTs){
                _cmLabel += ' · ' + formatTime(_cmSortTs);
              }

              _cmLabel += '] ';

              _callHistoryExpandedTimeline.push({
                role: cm.role === 'user' ? 'user' : 'assistant',
                content: _cmLabel + _cmText.slice(0, 200),
                _ts: _cmSortTs,
                _order: 50000 + cmi
              });
            });

            c = '[通话记录卡片：之前进行过一次' + _cdMin + '分钟的通话。通话内每句话已按真实发生时间展开到上下文时间线中。]';
          } else {
            c = '[之前通了一次电话，但没有可展开的通话文字内容]';
          }
        } catch(e){
          c = '[之前通了一次电话，但通话内容解析失败]';
        }
      }
      if(c.startsWith('__location__')){ try { var _ld = JSON.parse(c.slice(12)); c = '[定位：' + (_ld.name || '') + ']'; } catch(e){ c = '[定位]'; } }
      if(c.startsWith('__share_location__')){ try { var _sld = JSON.parse(c.slice(18)); c = '[用户发起或更新了共享位置：' + (_sld.name || '') + ']'; } catch(e){ c = '[用户发起或更新了共享位置]'; } }
      if(c.startsWith('__share_response__')){ try { var _srd = JSON.parse(c.slice(18)); var _srLoc = _srd.charLoc || _srd; c = '[角色共享或更新了自己的位置：' + (_srLoc.name || '') + ']'; } catch(e){ c = '[角色共享或更新了自己的位置]'; } }
      if(c.startsWith('__share_invite__')){ try { var _sid = JSON.parse(c.slice(16)); c = '[角色发起了共享位置邀请：' + (_sid.name || '') + ']'; } catch(e){ c = '[角色发起了共享位置邀请]'; } }
      if(c.startsWith('__share_ignore__')) c = '[用户没有回应共享位置邀请]';
      if(c.startsWith('__share_reject__')) c = '[用户拒绝了共享位置邀请]';
      if(c.startsWith('__share_end__')) c = '[共享位置已结束]';
      if(c.startsWith('__offline_record__')) c = '[线下见面记录]';
      if(c.startsWith('__voice__')) c = '[语音：' + c.slice(9).replace(/__bilingual_split__[\s\S]*/, '').slice(0, 50) + ']';
      if(c.startsWith('__fakeimg__')) c = '[图片：' + c.slice(11).slice(0, 50) + ']';
      c = c.replace(/__inner_voice__[\s\S]*/, '').trim();
      if(typeof _stripLeakedThinking === 'function') c = _stripLeakedThinking(c);
      // 清理双语标记，防止AI从聊天历史中学到旧格式
      if(c.includes('__bl_json__')){var _bjCtx2=c.match(/__bl_json__(\[[\s\S]*?\])/);if(_bjCtx2){try{var _bja2=JSON.parse(_bjCtx2[1]);c=_bja2.map(function(item){return item.t||item.c||''}).join(' ')}catch(e){c=c.replace(/__bl_json__/g,'')}}}
      if(c.includes('__bilingual_split__')){c=c.replace(/\n*__bilingual_split__\n*/g,'__bilingual_split__').split('__bilingual_split__')[0].trim()}
      if(c.includes('__bl_sep__')){c=c.replace(/__bl_sep__/g,'')}
      if(c.startsWith('__quote__')){
        var _callQParsed = typeof _cbyd21ParseQuotePrefix === 'function'
          ? _cbyd21ParseQuotePrefix(c)
          : null;

        if(_callQParsed && _callQParsed.data){
          c = '[引用 ' + (_callQParsed.data.name || '某人') + '：' + (_callQParsed.data.preview || '') + ']\n' + (_callQParsed.rest || '');
        }else{
          var _qe = c.indexOf('\n');

          if(_qe > 0){
            try {
              var _qd = JSON.parse(c.slice(9, _qe));
              c = '[引用 ' + _qd.name + '：' + _qd.preview + ']\n' + c.slice(_qe + 1);
            } catch(e){
              c = c.slice(_qe + 1);
            }
          }
        }
      }
      var _rawCallChatTs = m._ts || 0;
      if(_rawCallChatTs)_lastCallChatTs = _rawCallChatTs;
      var _sortCallChatTs = _rawCallChatTs || (_lastCallChatTs ? _lastCallChatTs + _callChatOrder : 0);
      var _callChatLabel = '[文字聊天';

      if(_sortCallChatTs){
        _callChatLabel += ' · ' + formatTime(_sortCallChatTs);
      }

      _callChatLabel += '] ';

      return {
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: _callChatLabel + c,
        _ts:_sortCallChatTs,
        _order:_callChatOrder++
      };
    });

    if(_callHistoryExpandedTimeline.length > 0){
      _chatMsgsForCall = _chatMsgsForCall.concat(_callHistoryExpandedTimeline).sort(function(a,b){
        var at = a._ts || 0;
        var bt = b._ts || 0;
        if(at && bt && at !== bt)return at - bt;
        if(at && !bt)return 1;
        if(!at && bt)return -1;
        return (a._order || 0) - (b._order || 0);
      });
    }

    // 按上下文轮数限制（和线上一致）
    if(_ctxR > 0){
      var _uc = 0, _ci = 0;
      for(var _i = _chatMsgsForCall.length - 1; _i >= 0; _i--){
        if(_chatMsgsForCall[_i].role === 'user') _uc++;
        if(_uc > _ctxR){ _ci = _i + 1; break; }
      }
      _chatMsgsForCall = _chatMsgsForCall.slice(_ci);
    }
    if(_chatMsgsForCall.length > 0){
      _callChatTimelineMsgs = _chatMsgsForCall;
      sp.push('[通话与文字聊天同一时间线]\n文字聊天消息和电话里的话会按真实时间顺序一起发送给你。没有[通话中]标记的是文字聊天消息，带[通话中]标记的是电话里说的话。它们属于同一段连续互动，你必须按顺序理解，不要把后发生的事当成先发生。');
    }
  }
  cbyd21_Call._pushWorldBookSystemEnd(sp,_wbCall);
  var sm = sp.join('\n\n---\n\n');
  var _callLineMsgs = _callMessages.map(function(m,idx){
    var _mc = m.content || '';
    if(typeof _stripLeakedThinking === 'function') _mc = _stripLeakedThinking(_mc);
    if(_mc.includes('__bilingual_split__')){_mc=_mc.replace(/\n*__bilingual_split__\n*/g,'__bilingual_split__').split('__bilingual_split__')[0].trim()}
    if(_mc.includes('__bl_sep__')){_mc=_mc.replace(/__bl_sep__/g,'')}
    var _callLineTs = m._ts || ((_callStartTime || Date.now()) + idx + 1);
    var _callLineLabel = '[通话中';

    if(_callLineTs){
      _callLineLabel += ' · ' + formatTime(_callLineTs);
    }

    _callLineLabel += '] ';

    return {
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: _callLineLabel + _mc,
      _ts: _callLineTs,
      _order: 100000 + idx
    };
  });

  var msgs = _callChatTimelineMsgs.concat(_callLineMsgs);

  if(_callLineMsgs.length === 0){
    msgs.push({
      role: 'user',
      content: _callDirection === 'incoming'
        ? '[通话已接通。这通电话由你主动拨出，用户刚刚接听。请作为主动联系用户的一方先开口，说出你此刻打来这通电话最自然想说的话。]'
        : '[通话已接通。这通电话由用户主动拨出，你刚刚接听。请作为接到用户来电的一方开口回应这通电话。]',
      _ts: Date.now(),
      _order: 200000
    });
  }

  msgs.sort(function(a,b){
    var at = a._ts || 0;
    var bt = b._ts || 0;
    if(at && bt && at !== bt)return at - bt;
    if(at && !bt)return 1;
    if(!at && bt)return -1;
    return (a._order || 0) - (b._order || 0);
  });

  msgs = msgs.map(function(m){
    return { role: m.role, content: m.content };
  });
    // 处理继续说话请求（用户点了触发按钮没说话）
  if(_callContinueRequested){
    _callContinueRequested = false;

    // 如果最后一条是AI消息，追加一条虚拟用户消息让AI继续。
    // 这条消息是在排序完成后追加的，所以会稳定位于本次通话请求最后。
    if(msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant'){
      msgs.push({
        role: 'user',
        content:
          '[通话续写触发]\n' +
          '用户没有说话，也没有发送新的文字消息。现在不是让你补全上一句话，也不是让你接着上一句的半截词继续写。\n\n' +
          '请你作为正在通话中的角色，根据当前通话上下文和聊天关系，主动继续说一段新的、完整的电话发言。\n\n' +
          '要求：\n' +
          '- 不要重复刚才已经说过的内容。\n' +
          '- 不要只输出一个词、一个短语、半句话或前文残片。\n' +
          '- 不要假装用户刚刚问了你什么，也不要回答一个不存在的问题。\n' +
          '- 可以补充刚才没说完的想法、换个话题、追问、关心用户、缓和沉默、开玩笑、撒娇、自言自语，具体由角色卡、当前关系和通话情境决定。\n' +
          '- 输出必须像电话里真实说出来的一段完整话，用户单独听到这段也能明白你想表达什么。'
      });
    }
  }

  // depth位置世界书插入到消息数组中
  if(_wbCall.depth.length > 0){
    _wbCall.depth.forEach(function(w){
      var depthPos = w.depth || 4;
      var insertIdx = Math.max(0, msgs.length - depthPos);
      msgs.splice(insertIdx, 0, { role: 'user', content: '[前端深度注入 — 这不是用户发言]\n[World Book — ' + w.name + ']\n' + w.content });
    });
  }

  var url = apiConfig.url.replace(/\/+$/, '') + '/chat/completions';
  var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.key };
  var body = { model: apiConfig.model, messages: cbyd21_Call._buildContextPackMessages(sm, msgs, _wbCall, '通话中回复') };
  if(apiConfig.temperature !== undefined) body.temperature = apiConfig.temperature;
  return { url: url, headers: headers, body: body };
};

// endCall() → 挂断通话
// · 停止计时器，切换到 ended 状态
// · 隐藏缩小悬浮球/卡片
// · 2秒后关闭通话界面
// · 将通话记录存入聊天消息（格式：__call__JSON）
// · 通话≥4条消息时触发自动记忆总结
// · 用户在ringing时挂断 → 触发角色拒接反应
// · 通话>2条且40%概率 → 触发通话后追加消息
cbyd21_Call.endCall = function(){
  if(_callState === 'idle' || _callState === 'ended') return;
  var wasConnected = _callState === 'connected';
  var wasRinging = _callState === 'ringing';
  _callState = 'ended';
  if(_callTimerInterval){ clearInterval(_callTimerInterval); _callTimerInterval = null; }
  var overlay = document.getElementById('callOverlay');
  overlay.classList.remove('call-connected');
  overlay.classList.add('call-ended');
  var duration = 0;
  if(_callStartTime){ duration = Math.floor((Date.now() - _callStartTime) / 1000); }
  var min = Math.floor(duration / 60).toString().padStart(2, '0');
  var sec = (duration % 60).toString().padStart(2, '0');
  document.getElementById('callStatus').textContent = wasConnected ? '通话已结束 · ' + min + ':' + sec : '未接通';
  document.getElementById('callTimer').style.display = 'none';
  document.getElementById('callAcceptBtnWrap').style.display = 'none';
  document.getElementById('callMuteBtnWrap').style.display = 'none';
  document.getElementById('callMinimizeBtnWrap').style.display = 'none';
  document.getElementById('callMini').classList.remove('active');
  if(_callMiniTimerInterval){ clearInterval(_callMiniTimerInterval); _callMiniTimerInterval = null; }
  var _endBtn = document.querySelector('.call-btn-end');
  if(_endBtn){ _endBtn.onclick = function(){ cbyd21_Call.closeCallScreen(); }; }
  var _endLabel = document.querySelector('.call-btn-end').parentNode.querySelector('.call-btn-label');
  if(_endLabel) _endLabel.textContent = '关闭';
  var _savedCallLog = null;
  if(wasConnected && _callMessages.length > 0){
    _savedCallLog = { duration: duration, messages: _callMessages.slice() };
  }
  var _savedCallCharId = _callCharId;
  var _savedCallBranchId = _callBranchId || currentChatId;
  var _savedCallDirection = _callDirection;
  setTimeout(function(){
    cbyd21_Call.closeCallScreen();
    // 通话记录存入聊天
    if(_savedCallLog){
      var chat = _savedCallBranchId ? chats.find(function(c){ return c.id === _savedCallBranchId; }) : getCurrentChat();
      if(chat){
        var callCardTs = Date.now();
        _savedCallLog._sourceTs = callCardTs;
        _savedCallLog._branchId = chat.id || _savedCallBranchId || null;

        var time = formatTime(callCardTs);
        var content = '__call__' + JSON.stringify(_savedCallLog);
        chat.messages.push({ role: 'ai', content: content, time: time, _ts: callCardTs });
        cbyd21_Data.saveChats();
        if(currentChatId === chat.id){
          cbyd21_Chat.renderMessages();
          scrollToBottom();
        }
      }
    }
    // 自动记忆总结（≥4条通话消息）
    if(_savedCallLog && _savedCallLog.messages && _savedCallLog.messages.length >= 4){
      _autoSummarizeCall(_savedCallCharId, _savedCallLog, _savedCallBranchId);
    }
    // 用户在ringing时挂断 → 角色可能发文字消息
    if(wasRinging){
      _callCharId = _savedCallCharId;
      _callBranchId = _savedCallBranchId;
      _callDirection = _savedCallDirection || 'outgoing';
      triggerCallRejectionReply();
    }
    // 40%概率通话后追加消息
    if(wasConnected && _savedCallLog && _savedCallLog.messages.length > 2 && Math.random() < 0.4){
      var _pcCharId = _savedCallCharId;
      var _pcLog = _savedCallLog;
      var _pcChar = getCharById(_pcCharId);
      var _pcName = _pcChar ? _pcChar.name : '对方';

      // 立即禁用输入区，防止用户在追加回复期间干扰上下文。
      // 这里同时禁用输入框、发送键、触发键和加号键。
      var _postCallDisableInput = function(){
        if(cbyd21_Call._setOnlineInputLocked){
          cbyd21_Call._setOnlineInputLocked(
            true,
            _pcName + '挂断电话后还有话想说…',
            '通话结束，等待追加消息…'
          );
        }
      };

      var _postCallEnableInput = function(){
        if(cbyd21_Call._setOnlineInputLocked){
          cbyd21_Call._setOnlineInputLocked(false);
        }
      };

      // 立即禁用输入
      _postCallDisableInput();

      // 显示打字指示器，说明这是挂断后的追加回复
      var _postCallTypingEl = document.getElementById('typingIndicator');
      var _postCallTypingText = _postCallTypingEl ? _postCallTypingEl.querySelector('.typing-text') : null;
      if(_postCallTypingEl){
        _postCallTypingEl.classList.add('active');
        if(_postCallTypingText) _postCallTypingText.textContent = '挂断电话后想说…';else{
          var _postCallLabel = document.createElement('span');
          _postCallLabel.className = 'typing-text';
          _postCallLabel.textContent = '挂断电话后想说…';
          _postCallTypingEl.querySelector('.msg-content').appendChild(_postCallLabel);
        }
      }
      setTimeout(function(){
        _callCharId = _pcCharId;
        _callBranchId = _savedCallBranchId;
        triggerPostCallMessage(_pcLog, _postCallEnableInput);
      }, 3000);
    }
  }, 2000);
};

// closeCallScreen() → 关闭通话界面，重置所有状态
// · 清除所有CSS类和定时器
// · 重置通话状态变量
// · 恢复聊天界面的语音按钮
cbyd21_Call.closeCallScreen = function(){
  var overlay = document.getElementById('callOverlay');
  overlay.classList.remove('active', 'call-connected', 'call-ended', 'video-mode');
    var _closeCard=document.getElementById('callMiniCard');
  _closeCard.style.display='none';
  _closeCard.style.backgroundImage='';
  _closeCard.style.left='';
  _closeCard.style.top='';
  _closeCard.style.right='';
  _closeCard.style.bottom='';
  var _closeHeader=document.getElementById('callMiniCardHeader');
  if(_closeHeader){_closeHeader.style.background='';_closeHeader.style.webkitBackdropFilter='';_closeHeader.style.backdropFilter=''}
  var _closeMsgs=document.getElementById('callMiniCardMsgs');
  if(_closeMsgs)_closeMsgs.style.background='';
  var _closePip=document.getElementById('callMiniCardPip');
  if(_closePip)_closePip.style.display='none';if(_callMiniCardTimerInterval){ clearInterval(_callMiniCardTimerInterval); _callMiniCardTimerInterval = null; }
  localStorage.removeItem('stm_callTemp');
  _callState = 'idle';
  _callCharId = null;
  _callBranchId = null;
  _callDirection = 'outgoing';
  _callStartTime = null;
  _callMessages = [];
  _callCameraOn = true;
  var _ccStyleEl=document.getElementById('callCardColorStyle');if(_ccStyleEl)_ccStyleEl.textContent='';
  var _miniElClose=document.getElementById('callMini');
  _miniElClose.classList.remove('active');
  if(_callMiniCardHomeParent && _miniElClose.parentNode !== _callMiniCardHomeParent){
    _callMiniCardHomeParent.appendChild(_miniElClose);
  }
  if(_callMiniTimerInterval){ clearInterval(_callMiniTimerInterval); _callMiniTimerInterval = null; }
  _restoreCallMiniCardParent();
  var _voiceBtn2 = document.querySelector('#inputArea .input-side-btn[onclick*="showToast"]');
  if(_voiceBtn2 && _voiceBtn2.dataset.prevOnclick){ _voiceBtn2.setAttribute('onclick', _voiceBtn2.dataset.prevOnclick); delete _voiceBtn2.dataset.prevOnclick; _voiceBtn2.style.opacity = ''; }
};

// ============================================================
// 来电模式
// ============================================================
// incomingCall(charId) → 角色主动来电（外部调用）
// · 显示来电界面，接听按钮可见
// · 用户可选择接听或挂断
function incomingCall(charId){
  if(typeof cbyd21_Call !== 'undefined' && cbyd21_Call._promptReadyOrToast && !cbyd21_Call._promptReadyOrToast())return;

  var ch = getCharById(charId);
  if(!ch || ch.id === DEFAULT_CHAR_ID) return;
  if(_callState !== 'idle') return;
  if(!apiConfig.url || !apiConfig.key || !apiConfig.model) return;
  _callCharId = charId;
  _callBranchId = currentChatCharId === charId ? currentChatId : (_charLastBranch[charId] || null);
  _callDirection = 'incoming';
  if(!_callBranchId){
    var _incomingBranches = chats.filter(function(c){ return c.charId === charId; });
    _callBranchId = _incomingBranches.length > 0 ? _incomingBranches[0].id : null;
  }
  _callState = 'ringing';
  _callMessages = [];
  var avatarEl = document.getElementById('callAvatar');
  avatarEl.innerHTML = ch.avatar ? '<img src="' + ch.avatar + '">' : escHtml(ch.name.charAt(0));
  document.getElementById('callName').textContent = ch.name;
  document.getElementById('callStatus').textContent = '来电…';
  document.getElementById('callTimer').style.display = 'none';
  document.getElementById('callMessages').innerHTML = '';
  document.getElementById('callInput').value = '';
  document.getElementById('callAcceptBtnWrap').style.display = 'block';
  document.getElementById('callTyping').classList.remove('active');
  var overlay = document.getElementById('callOverlay');
  overlay.classList.remove('call-connected', 'call-ended');
  overlay.classList.add('active');
}

// ============================================================
// 通话缩小悬浮
// ============================================================
// · 通话中点缩小按钮 → 弹出选择：气泡模式 / 卡片模式
// · 气泡模式：56px圆球，显示计时，点击恢复全屏
// · 卡片模式：可拖动的迷你窗口，显示最近消息，可继续输入
var _callMiniTimerInterval = null;
var _callMiniCardTimerInterval = null;

var _callMiniCardHomeParent = null;

// 挂到手机框内部的独立浮层里，既不被聊天界面压住，也不会跑出手机框
function _mountCallMiniCardToTop(){
  var card = document.getElementById('callMiniCard');
  if(!card) return;
  if(!_callMiniCardHomeParent) _callMiniCardHomeParent = document.getElementById('cbyd21PhoneFrame') || document.body;
  var layer = document.getElementById('globalFloatLayer') || _callMiniCardHomeParent;
  if(card.parentNode !== layer){
    layer.appendChild(card);
  }
  card.style.position = 'absolute';
  card.style.zIndex = '2';
}

// 恢复挂回原始父层
function _restoreCallMiniCardParent(){
  var card = document.getElementById('callMiniCard');
  if(!card || !_callMiniCardHomeParent) return;
  if(card.parentNode !== _callMiniCardHomeParent){
    _callMiniCardHomeParent.appendChild(card);
  }
  card.style.position = 'absolute';
  card.style.zIndex = '2';
}

// minimizeCall() → 弹出缩小方式选择菜单
cbyd21_Call.minimizeCall = function(){
  if(_callState !== 'connected') return;
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '缩小为气泡', desc: '悬浮圆球，点击恢复全屏', action: function(){ closeModal('addCharModal'); cbyd21_Call._doMinimizeBubble(); } },
    { label: '缩小为卡片', desc: '可拖动的迷你通话窗口，可继续输入', action: function(){ closeModal('addCharModal'); cbyd21_Call._doMinimizeCard(); } }
  ];
  items.forEach(function(item){
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML = '<div style="flex:1"><div style="font-size:14px;color:var(--text-primary)">' + item.label + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + item.desc + '</div></div>';
    div.onclick = item.action;
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '缩小方式';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
};

// _doMinimizeBubble() → 缩小为悬浮气泡
// · 隐藏全屏通话界面，显示悬浮球
// · 悬浮球上实时显示通话计时
// · 自动吸附到屏幕右侧
cbyd21_Call._doMinimizeBubble = function(){
  if(_callState !== 'connected') return;
  document.getElementById('callOverlay').classList.remove('active');
  if(currentChatCharId){
    document.getElementById('chatView').classList.add('active');
    document.getElementById('chatTabView').classList.add('hidden');
  }
  var mini = document.getElementById('callMini');
  var layer = document.getElementById('globalFloatLayer');
  if(layer && mini.parentNode !== layer) layer.appendChild(mini);
  var _frameMiniInit = document.getElementById('cbyd21PhoneFrame');
  var _miniInitW = _frameMiniInit ? _frameMiniInit.clientWidth : window.innerWidth;
  var _miniInitH = _frameMiniInit ? _frameMiniInit.clientHeight : window.innerHeight;
  mini.style.right = 'auto'; 
  mini.style.bottom = 'auto';
  mini.style.left = Math.max(16, _miniInitW - 72) + 'px';
  mini.style.top = Math.max(80, _miniInitH - 160) + 'px';
  mini.classList.add('active');
  if(_callStartTime){
    var elapsed0 = Math.floor((Date.now() - _callStartTime) / 1000);
    document.getElementById('callMiniTimer').textContent = Math.floor(elapsed0 / 60).toString().padStart(2, '0') + ':' + (elapsed0 % 60).toString().padStart(2, '0');
  } else { document.getElementById('callMiniTimer').textContent = '00:00'; }
  if(_callMiniTimerInterval) clearInterval(_callMiniTimerInterval);
  _callMiniTimerInterval = setInterval(function(){
    if(!_callStartTime || _callState !== 'connected'){ clearInterval(_callMiniTimerInterval); document.getElementById('callMini').classList.remove('active'); return; }
    var elapsed = Math.floor((Date.now() - _callStartTime) / 1000);
    document.getElementById('callMiniTimer').textContent = Math.floor(elapsed / 60).toString().padStart(2, '0') + ':' + (elapsed % 60).toString().padStart(2, '0');
  }, 1000);
};

// restoreCallScreen() → 从缩小状态恢复全屏通话界面
// · 隐藏悬浮球和迷你卡片
// · 重新显示全屏通话界面
// · 重新渲染通话消息列表
cbyd21_Call.restoreCallScreen = function(){
  if(_callState !== 'connected') return;
  var _miniElRestore=document.getElementById('callMini');
  _miniElRestore.classList.remove('active');
  if(_callMiniCardHomeParent && _miniElRestore.parentNode !== _callMiniCardHomeParent){
    _callMiniCardHomeParent.appendChild(_miniElRestore);
  }
  var _restoreCard=document.getElementById('callMiniCard');
  _restoreCard.style.display='none';
  _restoreCard.style.backgroundImage='';
  _restoreCard.style.left='';
  _restoreCard.style.top='';
  _restoreCard.style.right='';
  _restoreCard.style.bottom='';
  var _restoreHeader=document.getElementById('callMiniCardHeader');
  if(_restoreHeader){_restoreHeader.style.background='';_restoreHeader.style.webkitBackdropFilter='';_restoreHeader.style.backdropFilter=''}var _restoreMsgs=document.getElementById('callMiniCardMsgs');
  if(_restoreMsgs)_restoreMsgs.style.background='';
  var _restorePip=document.getElementById('callMiniCardPip');
  if(_restorePip)_restorePip.style.display='none';
  if(_callMiniTimerInterval){ clearInterval(_callMiniTimerInterval); _callMiniTimerInterval = null; }
  if(_callMiniCardTimerInterval){ clearInterval(_callMiniCardTimerInterval); _callMiniCardTimerInterval = null; }
  _restoreCallMiniCardParent();
  var overlay = document.getElementById('callOverlay');
  overlay.classList.add('active', 'call-connected');
  cbyd21_Call._rerenderCallMessages();
};

// _doMinimizeCard() → 缩小为可拖动的迷你卡片
// · 显示角色名+计时+最近6条消息+输入框
// · 可继续在卡片内发送消息
// · 卡片头部可拖动
cbyd21_Call._doMinimizeCard = function(){
  if(_callState !== 'connected') return;
  document.getElementById('callOverlay').classList.remove('active');
  // 确保聊天界面保持显示（防止隐藏overlay后chatView丢失active状态）
  if(currentChatCharId){
    document.getElementById('chatView').classList.add('active');
    document.getElementById('chatTabView').classList.add('hidden');
  }
  _mountCallMiniCardToTop();
  var card = document.getElementById('callMiniCard');
  var _frameEl = document.getElementById('cbyd21PhoneFrame');
  var _fw = _frameEl ? _frameEl.offsetWidth : window.innerWidth;
  var _fh = _frameEl ? _frameEl.offsetHeight : window.innerHeight;
  card.style.right = 'auto';
  card.style.bottom = 'auto';
  card.style.display = 'block';
  requestAnimationFrame(function(){
    var _realW = card.offsetWidth || 260;
    var _realH = card.offsetHeight || 180;
    card.style.left = Math.max(12, _fw - _realW - 12) + 'px';
    card.style.top = Math.max(90, _fh - _realH - 20) + 'px';
  });
  var ch = getCharById(_callCharId);
    document.getElementById('callMiniCardName').textContent = ch ? ch.name : '通话中';
  // 视频通话：卡片加角色立绘背景+用户画中画
  if(_callIsVideo && ch && ch._videoCharImage){
    var _mcRef=ch._videoCharImage;
    var _applyMcBg=function(url){
      card.style.backgroundImage='url('+url+')';
      card.style.backgroundSize='cover';
      card.style.backgroundPosition='center';
      var _mcHeader=document.getElementById('callMiniCardHeader');
      if(_mcHeader){_mcHeader.style.background='rgba(0,0,0,0.55)';_mcHeader.style.webkitBackdropFilter='blur(12px)';_mcHeader.style.backdropFilter='blur(12px)'}
      var _mcMsgs=document.getElementById('callMiniCardMsgs');
      if(_mcMsgs){_mcMsgs.style.background='rgba(0,0,0,0.3)'}};
    if(typeof _cbyd21IsDirectImageRef === 'function' && _cbyd21IsDirectImageRef(_mcRef)){_applyMcBg(_mcRef)}
    else{cbyd21_Data.loadImage(_mcRef).then(function(d){if(d)_applyMcBg(d)})}
    // 用户画中画小窗
    var _mcPipWrap=document.getElementById('callMiniCardPip');
    if(!_mcPipWrap){
      _mcPipWrap=document.createElement('div');
      _mcPipWrap.id='callMiniCardPip';
      _mcPipWrap.style.cssText='position:absolute;top:8px;right:8px;width:40px;height:54px;border-radius:6px;background:var(--bg-tertiary);border:1px solid rgba(255,255,255,0.15);overflow:hidden;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
      card.style.position='relative';
      card.appendChild(_mcPipWrap);
    }
    _mcPipWrap.style.display='block';
    _mcPipWrap.innerHTML='';
    if(ch._videoUserImage){
      var _mcPipRef=ch._videoUserImage;
      if(typeof _cbyd21IsDirectImageRef === 'function' && _cbyd21IsDirectImageRef(_mcPipRef)){_mcPipWrap.innerHTML='<img src="'+_mcPipRef+'" style="width:100%;height:100%;object-fit:cover">'}
      else{cbyd21_Data.loadImage(_mcPipRef).then(function(d){if(d)_mcPipWrap.innerHTML='<img src="'+d+'" style="width:100%;height:100%;object-fit:cover">'})}
    }else{
      var _mcUp=getCurrentProfile();
      if(_mcUp.avatar){_mcPipWrap.innerHTML='<img src="'+_mcUp.avatar+'" style="width:100%;height:100%;object-fit:cover">'}
      else{_mcPipWrap.innerHTML='<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)">'+escHtml((_mcUp.name||'我').charAt(0))+'</span>'}
    }
  }else{
    card.style.backgroundImage='';
    var _mcHeader2=document.getElementById('callMiniCardHeader');
    if(_mcHeader2){_mcHeader2.style.background='';_mcHeader2.style.webkitBackdropFilter='';_mcHeader2.style.backdropFilter=''}
    var _mcMsgs2=document.getElementById('callMiniCardMsgs');
    if(_mcMsgs2){_mcMsgs2.style.background=''}var _mcPip2=document.getElementById('callMiniCardPip');
    if(_mcPip2)_mcPip2.style.display='none';
  }

  requestAnimationFrame(function(){
    var _finalW = card.offsetWidth || 260;
    var _finalH = card.offsetHeight || 180;
    card.style.left = Math.max(12, _fw - _finalW - 12) + 'px';
    card.style.top = Math.max(90, _fh - _finalH - 20) + 'px';
  });

  cbyd21_Call._renderMiniCardMsgs();
  if(_callStartTime){
    var _elapsedInit = Math.floor((Date.now() - _callStartTime) / 1000);
    document.getElementById('callMiniCardTimer').textContent =
      Math.floor(_elapsedInit / 60).toString().padStart(2, '0') + ':' +
      (_elapsedInit % 60).toString().padStart(2, '0');
  }else{
    document.getElementById('callMiniCardTimer').textContent = '00:00';
  }
  if(_callMiniCardTimerInterval) clearInterval(_callMiniCardTimerInterval);
  _callMiniCardTimerInterval = setInterval(function(){
    if(!_callStartTime || _callState !== 'connected'){ clearInterval(_callMiniCardTimerInterval); card.style.display = 'none'; return; }
    var elapsed = Math.floor((Date.now() - _callStartTime) / 1000);
    document.getElementById('callMiniCardTimer').textContent = Math.floor(elapsed / 60).toString().padStart(2, '0') + ':' + (elapsed % 60).toString().padStart(2, '0');
  }, 1000);
  var inp = document.getElementById('callMiniCardInput');
  inp.value = '';
  if(_callIsVideo){
    inp.style.color='#ffffff';
    inp.style.background='rgba(255,255,255,0.12)';
    inp.style.borderColor='rgba(255,255,255,0.18)';
  }else{
    inp.style.color='';
    inp.style.background='';
    inp.style.borderColor='';
  }
  inp.onkeydown = function(e){
    if(e.isComposing || e.keyCode === 229)return;

    if(e.key === 'Enter'){
      e.preventDefault();
      cbyd21_Call._sendFromMiniCard();
    }
  };
};

// _renderMiniCardMsgs() → 渲染迷你卡片里的最近6条消息
cbyd21_Call._renderMiniCardMsgs = function(){
  var container = document.getElementById('callMiniCardMsgs');
  container.innerHTML = '';
  var recent = _callMessages.slice(-6);
  recent.forEach(function(m){
    var div = document.createElement('div');
    div.style.cssText = 'padding:4px 8px;border-radius:8px;font-size:11px;line-height:1.5;max-width:85%;white-space:pre-wrap;word-break:break-word';
    if(m.role === 'user'){ div.style.cssText += 'align-self:flex-end;background:var(--msg-user-bg);border:1px solid var(--border-soft);color:var(--text-primary)'; }
    else { div.style.cssText += 'align-self:flex-start;background:var(--msg-ai-bg);border:1px solid var(--border-soft);color:var(--text-primary)'; }
    var _miniCallContent = m.content || '';
    if(typeof _stripLeakedThinking === 'function') _miniCallContent = _stripLeakedThinking(_miniCallContent);
    if(m.role === 'ai' && _miniCallContent.includes('__bilingual_split__')){ div.innerHTML = _renderCallBilingual(_miniCallContent); }
    else { div.textContent = _miniCallContent; }
    container.appendChild(div);
  });
  // 卡片里的加载中状态
  if(_callGenerating && _callState === 'connected'){
    var typingDiv = document.createElement('div');
    typingDiv.id = 'callMiniCardTyping';
    typingDiv.style.cssText = 'align-self:flex-start;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;display:flex;gap:4px;align-items:center';
    typingDiv.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:var(--text-muted);animation:typing 1.2s infinite"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--text-muted);animation:typing 1.2s infinite 0.2s"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--text-muted);animation:typing 1.2s infinite 0.4s"></span>';
    container.appendChild(typingDiv);
  }

  container.scrollTop = container.scrollHeight;
};

// _sendFromMiniCard() → 从迷你卡片发送消息
// · 发送后触发AI回复，AI回复完成后刷新迷你卡片消息
cbyd21_Call._sendFromMiniCard = function(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  if(_callState !== 'connected') return;
  var inp = document.getElementById('callMiniCardInput');
  var text = inp.value.trim();
  if(!text || _callGenerating) return;
  inp.value = '';
  _callMessages.push({ role: 'user', content: text, _ts:Date.now() });
  cbyd21_Call._renderMiniCardMsgs();
  cbyd21_Call.triggerCallReply();
};

// ============================================================
// 通话消息菜单（编辑/复制/删除）
// ============================================================
// openCallMsgMenu(idx, el) → 长按/右键通话消息弹出操作菜单
cbyd21_Call.openCallMsgMenu = function(idx, el){
  var m = _callMessages[idx];
  if(!m) return;
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '编辑', action: function(){
      closeModal('addCharModal');

      openTextInputModal('编辑通话消息', '', '', function(text){
        if(!text.trim()) return;

        _callMessages[idx].content = text.trim();

        cbyd21_Call._rerenderCallMessages();

        var miniCard = document.getElementById('callMiniCard');
        if(miniCard && miniCard.style.display !== 'none'){
          cbyd21_Call._renderMiniCardMsgs();
        }

        showToast('已编辑');
      });

      setTimeout(function(){
        var area = document.getElementById('textInputArea');
        if(area){
          area.dataset.enterNewline = '1';
          area.value = typeof _cbyd21MessageContentForUserAction === 'function' ? _cbyd21MessageContentForUserAction(m.content) : m.content;
          autoResizeModal(area);
        }
      }, 50);
    } },
    { label: '复制', action: function(){ closeModal('addCharModal'); var txt = typeof _cbyd21MessageContentForUserAction === 'function' ? _cbyd21MessageContentForUserAction(m.content) : m.content; if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(function(){ showToast('已复制'); }).catch(function(){ _fallbackCopy(txt); }); } else { _fallbackCopy(txt); } } },
    { label: '删除', danger: true, action: function(){ closeModal('addCharModal'); customConfirm('确认删除这条通话消息？').then(function(yes){ if(!yes) return; _callMessages.splice(idx, 1); cbyd21_Call._rerenderCallMessages(); showToast('已删除'); }); } }
  ];
  items.forEach(function(item){
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.style.fontSize = '14px';
    div.style.color = item.danger ? 'var(--danger)' : 'var(--text-primary)';
    div.textContent = item.label;
    div.onclick = item.action;
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '通话消息';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
};

// _rerenderCallMessages() → 清空并重新渲染所有通话消息
// · 恢复全屏时调用，确保消息索引正确
cbyd21_Call._rerenderCallMessages = function(){
  var container = document.getElementById('callMessages');
  container.innerHTML = '';
  _callMessages.forEach(function(m, i){
    var div = document.createElement('div');
    div.className = 'call-msg ' + (m.role === 'user' ? 'user' : 'ai');
    var _miniCallContent = m.content || '';
    if(typeof _stripLeakedThinking === 'function') _miniCallContent = _stripLeakedThinking(_miniCallContent);
    if(m.role === 'ai' && _miniCallContent.includes('__bilingual_split__')){ div.innerHTML = _renderCallBilingual(_miniCallContent); }
    else { div.textContent = _miniCallContent; }
    div.dataset.cidx = i;
    div.addEventListener('contextmenu', function(e){ e.preventDefault(); cbyd21_Call.openCallMsgMenu(parseInt(this.dataset.cidx), this); });
    var _pt = null;
    div.addEventListener('touchstart', function(e){ var _el = this; _pt = setTimeout(function(){ cbyd21_Call.openCallMsgMenu(parseInt(_el.dataset.cidx), _el); }, 600); }, { passive: true });
    div.addEventListener('touchend', function(){ clearTimeout(_pt); });
    div.addEventListener('touchmove', function(){ clearTimeout(_pt); });
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
};

// ============================================================
// 通话后追加消息 + 拒接反应
// ============================================================

// triggerCallRejectionReply() → 用户挂断未接通的电话后，角色可能发文字消息
// · 调用API让角色以文字消息回应被挂断的事
// · 回复存入普通聊天消息
async function triggerCallRejectionReply(){
  if(!cbyd21_Call._promptReadyOrToast())return;

  var ch = getCharById(_callCharId || currentChatCharId);
  if(!ch || ch.id === DEFAULT_CHAR_ID) return;
  if(!apiConfig.url || !apiConfig.key || !apiConfig.model) return;
  var chat = _callBranchId ? chats.find(function(c){ return c.id === _callBranchId; }) : getCurrentChat();
  if(!chat) chat = getCurrentChat();
  if(!chat) return;

  var _unlockRejectionInput = function(){
    if(cbyd21_Call._setOnlineInputLocked){
      cbyd21_Call._setOnlineInputLocked(false);
    }
  };

  if(cbyd21_Call._setOnlineInputLocked){
    var _rejToastText = _callDirection === 'incoming'
      ? ((ch.name || '对方') + '的电话没接通，TA可能还想补一句…')
      : ((ch.name || '对方') + '看到未接通来电，打算说点什么…');

    cbyd21_Call._setOnlineInputLocked(
      true,
      _rejToastText,
      '电话未接通，等待对方回应…'
    );
  }

  var sp = [];
  var up = getCurrentProfile();
  var _rejWbMsgs = [];
  if(chat && chat.messages){
    _rejWbMsgs = _rejWbMsgs.concat(chat.messages.filter(function(m){
      return m && m._mode !== 'ooc' && m._mode !== 'inline_offline';
    }));
  }
  var _wbCallRej = cbyd21_Call._collectWorldBook(ch.id, _rejWbMsgs, []);
  if(_wbCallRej.system_start&&_wbCallRej.system_start.length>0)sp.push('[最高优先级强制指令 — 系统最前]\n'+_wbCallRej.system_start.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
  cbyd21_Call._pushWorldBookBefore(sp,_wbCallRej);
  if(ch.prompt && ch.prompt.trim() && !(typeof _isMissingCharPrompt==='function' && _isMissingCharPrompt(ch.prompt))) sp.push(_replaceCardVars(ch.prompt.trim(),ch.name,up.name||''));
  else sp.push('[角色设定]\n当前通话对象是「'+ch.name+'」。该角色完整人设缺失或需要从备份恢复。即使缺少详细人设，也不能把用户面具当成角色人设。');
  cbyd21_Call._pushWorldBookAfter(sp,_wbCallRej);
  var _rejCallUserBlock='[和我聊天的用户]\n用户的名字是「'+(up.name||'我')+'」。'+((up.name&&up.name!=='我')?'':'用户没有设置名字。')+'\n绝对不能用角色自己的名字来称呼用户。';
  if(up.persona&&up.persona.trim())_rejCallUserBlock+='\n'+up.persona.trim();
  sp.push(_rejCallUserBlock);
  sp.push('[身份最终锁定]\n当前我扮演的角色是「'+ch.name+'」。\n用户是「'+(up.name||'用户')+'」。\n\n用户面具里的姓名、年龄、职业、外貌、性格、经历全部只属于用户，不属于我。不能把用户面具当成角色人设。');

  if(typeof cbyd21_Call._pushOocInstructionBlock === 'function'){
    cbyd21_Call._pushOocInstructionBlock(sp, chat, '通话未接通后的线上回应');
  }

  var _callRejectTimeBlock = cbyd21_Call._buildTimeAwareBlock(ch, '通话未接通后的线上回应');
  if(_callRejectTimeBlock)sp.push(_callRejectTimeBlock);

  var _rejCallContextText = _callDirection === 'incoming'
    ? '你刚才主动给用户打电话，但这通电话在接通前结束了，用户没有接听或中途挂断。对你来说，这不是系统失败，而是你主动触碰用户后没有接通。现在要根据角色卡、当前关系、最近上下文和这通电话的未接通状态，生成一条你在线上补发给用户的文字回应。回应应体现你作为主动拨出电话的一方，对这次未接通最自然的反应。'
    : '用户刚才尝试给你打电话，但这通电话在接通前结束了。这个场景不固定等于你当场主动拒接，也不固定等于你完全没有注意到。请根据角色卡、当前关系、最近上下文和这通未接通电话在你们关系里的意义，判断角色更像是事后才注意到、当时不方便接、当时选择没有接，或其他符合角色卡的情况，并生成一条线上文字回应。';

  if(ch && !(ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName)){
    sp.push(_cbyd21DefaultChineseGate('通话未接通后的线上回应', '电话未接通后补发给用户的线上文字消息', {
      includeStrictOocProtocol:true
    }));
  }

  sp.push('[通话相关情境]\n' + _rejCallContextText + '\n\n现在请严格按照上方角色设定的性格、说话方式和你们当前的关系，通过线上文字消息回应这件事。\n\n这条回复的目标不是解释功能状态，而是让用户感觉到角色确实注意到了这通电话，并且以符合角色卡的方式回应了用户。\n\n要求：\n- 角色卡是最高依据。回复内容、语气、亲密度、距离感和表达方式都必须从角色卡和最近上下文推导。\n- 不能套用固定模板，不能把任何角色统一写成同一种反应。\n- 这条消息必须是角色本人在电话没接通后真实会发给用户的线上文字。\n- 用户读完后应该感觉到自己被认真对待，而不是被系统通知、敷衍或随便打发。\n- 尊重用户不只是避免脏话或攻击性词汇，也包括态度上不能轻视用户、不能把这通电话当作无关紧要、不能让用户感觉自己不被当回事。\n- 如果角色卡里定义了角色对用户的情感或关系质感，这种关系质感必须自然存在于回复里。\n\n严格禁止：\n- 空回复。\n- 只有语气词或极短敷衍内容。\n- 像系统通知一样解释功能状态。\n- 写旁白、动作描写或心理描写。\n- 替用户补充未发生的行为、想法或反应。\n\n用线上聊天的方式回复。');

  if(ch && ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName){
    var _blRejCall = ch._bilingual.langName;
    sp.push('[双语回复模式]\n你的母语是'+_blRejCall+'。发文字消息时用前端可识别的双语消息数组格式输出，标记为 __bl_json__：\n__bl_json__[{"t":"'+_blRejCall+'原文","c":"简体中文翻译"}]\n\n多句话时数组放多个对象：\n__bl_json__[{"t":"第一句'+_blRejCall+'","c":"第一句的简体中文翻译"},{"t":"第二句'+_blRejCall+'","c":"第二句的简体中文翻译"}]\n\n规则：整个回复以 __bl_json__ 开头，后面紧跟可解析的双语消息数组。这个格式只决定消息和翻译怎么显示，不代表你在执行代码任务。每个对象 t 和 c 严格一对一，c 必须是简体中文，不能是英文。');
  } else {
    var _rejMin = ch.replyMin || 1;
    var _rejMax = ch.replyMax || 1;
    sp.push('[线上聊天消息发送格式]\n这次是通话未接通后的线上文字消息。请使用前端可识别的消息数组格式。这个格式只决定聊天气泡怎么分条，不代表你在执行代码任务，也不改变你正在扮演角色这件事。\n\n__msg_json__[{\"c\":\"消息内容\"}]\n\n规则：\n- __msg_json__ 必须放在第一行，后面紧跟可解析的消息数组。\n- 数组里的每个对象代表一个聊天气泡，只需要 c 字段。\n- 数组长度控制在 '+_rejMin+' 到 '+_rejMax+' 条之间。\n- 每个 c 字段都必须是角色真实会发给用户的消息，不能空白，不能像系统提示，不能敷衍。\n- 不要把消息数组包进代码块，不要美化成多行。\n\n质量要求：\n这条消息要延续角色卡里的关系和语气，让用户感觉角色是在认真回应这通没有接通的电话。格式只负责分条，不能覆盖角色本人的表达方式。');
  }
  cbyd21_Call._pushWorldBookSystemEnd(sp,_wbCallRej);
  var sm = sp.join('\n\n---\n\n');
  try {
    var url = apiConfig.url.replace(/\/+$/, '') + '/chat/completions';
    var _rejTaskText = _callDirection === 'incoming'
      ? '[你刚才主动拨给用户的电话没有接通。请根据当前角色卡、关系和最近上下文，生成一条未接通后的线上文字回应。]'
      : '[用户刚才拨给你的电话没有接通。请根据当前角色卡、关系和最近上下文，判断这次未接通对角色意味着什么，并生成一条线上文字回应。]';

    var _rejMsgs = [{ role: 'user', content: _rejTaskText }];
    if(_wbCallRej.depth.length > 0){
      _wbCallRej.depth.forEach(function(w){
        var depthPos = w.depth || 4;
        var insertIdx = Math.max(0, _rejMsgs.length - depthPos);
        _rejMsgs.splice(insertIdx, 0, { role:'user', content:'[前端深度注入 — 这不是用户发言]\n[World Book — ' + w.name + ']\n' + w.content });
      });
    }
    var _rejectBody = {
      model:apiConfig.model,
      messages:cbyd21_Call._buildContextPackMessages(sm, _rejMsgs, _wbCallRej, '通话未接通后的线上文字回复')
    };

    if(apiConfig.temperature !== undefined){
      _rejectBody.temperature = apiConfig.temperature;
    }

    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.key }, body: JSON.stringify(_rejectBody) });
    var _rawRejectText = await r.text();

    if(!r.ok){
      var _rejectErrParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawRejectText)
        : {data:null,text:''};

      var _rejectErrText = String(_rejectErrParsed.text || '').trim();

      if(!_rejectErrText && _rejectErrParsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
        _rejectErrText = String(_cbyd21ExtractChatApiContent(_rejectErrParsed.data) || '').trim();
      }

      var _rejectErrLooksLikeOnlyError =
        /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(_rejectErrText) ||
        (
          _rejectErrText.length < 30 &&
          /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(_rejectErrText)
        );

      if(_rejectErrText && _rejectErrText.length >= 10 && !_rejectErrLooksLikeOnlyError){
        console.warn('拒接后文字回复 HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常回复处理');
      }else{
        cbyd21_Call._showCallApiError('拒接后文字回复失败', new Error('HTTP '+r.status+': '+_rawRejectText.slice(0,300)));
        _unlockRejectionInput();
        return;
      }
    }
    var _parsedRejectText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawRejectText)
      : {data:null,text:_rawRejectText};

    var d = _parsedRejectText.data || {};
    var reply = _parsedRejectText.text || cbyd21_Call._extractReplyContent(d);

    if(!reply && _rawRejectText && String(_rawRejectText).trim()){
      reply =
        '[前端提示：拒接后文字回复 API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
        String(_rawRejectText || '').trim();
    }

    if(typeof _stripLeakedThinking === 'function') reply = _stripLeakedThinking(reply);

    reply = String(reply || '').trim();

    if(!reply) reply = '……';

    var time = formatTime(Date.now());
    var _oldMode = currentMode;

    currentMode = 'online';

    try{
      cbyd21_Call._appendOnlineReplySafely(chat, reply, time, '拒接后文字回复');
    }finally{
      currentMode = _oldMode;
    }

    cbyd21_Data.saveChats();
    scrollToBottom();
    _unlockRejectionInput();
  } catch(e){
    cbyd21_Call._showCallApiError('拒接后文字回复失败', e);
    _unlockRejectionInput();
  }
}

// triggerPostCallMessage(callLog) → 通话结束后角色可能追加一条文字消息
// · 40%概率触发（在endCall里判断）
// · 可以是忘说的事、补充的话、撒娇、叮嘱等
// · 空回复或太短则不发
async function triggerPostCallMessage(callLog, _onDone){
  var _cleanupOnDone = function(){
    var _postTypingEl2 = document.getElementById('typingIndicator');
    if(_postTypingEl2){ _postTypingEl2.classList.remove('active'); var _ptl2=_postTypingEl2.querySelector('.typing-text');if(_ptl2)_ptl2.textContent=''; }
    if(typeof _onDone === 'function') _onDone();
  };

  if(!cbyd21_Call._promptReadyOrToast()){
    _cleanupOnDone();
    return;
  }

  var ch = getCharById(_callCharId || currentChatCharId);
  if(!ch || ch.id === DEFAULT_CHAR_ID){ _cleanupOnDone(); return; }
  if(!apiConfig.url || !apiConfig.key || !apiConfig.model){ _cleanupOnDone(); return; }
  var chat = _callBranchId ? chats.find(function(c){ return c.id === _callBranchId; }) : getCurrentChat();
  if(!chat) chat = getCurrentChat();
  if(!chat){ _cleanupOnDone(); return; }
  var sp = [];
  var up = getCurrentProfile();
  var callSummary = callLog.messages.slice(-6).map(function(m){
    var c = m.content || '';

    if (typeof _cbyd21MessageContentForUserAction === 'function') {
      c = _cbyd21MessageContentForUserAction(c);
    }

    if (c.includes('__bilingual_split__')) {
      c = c.replace(/\n*__bilingual_split__\n*/g, '__bilingual_split__').split('__bilingual_split__')[0].trim();
    }

    if (c.includes('__bl_sep__')) {
      c = c.replace(/__bl_sep__/g, '');
    }

    return (m.role === 'user' ? '用户' : '角色') + ': ' + c.slice(0, 80);
  }).join('\n');
  var _postWbMsgs = [];
  if(chat && chat.messages){
    _postWbMsgs = _postWbMsgs.concat(chat.messages.filter(function(m){
      return m && m._mode !== 'ooc' && m._mode !== 'inline_offline';
    }));
  }
  if(callLog && callLog.messages) _postWbMsgs = _postWbMsgs.concat(callLog.messages);
  var _wbCallPost = cbyd21_Call._collectWorldBook(ch.id, _postWbMsgs, []);
  if(_wbCallPost.system_start&&_wbCallPost.system_start.length>0)sp.push('[最高优先级强制指令 — 系统最前]\n'+_wbCallPost.system_start.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
  cbyd21_Call._pushWorldBookBefore(sp,_wbCallPost);
  if(ch.prompt && ch.prompt.trim() && !(typeof _isMissingCharPrompt==='function' && _isMissingCharPrompt(ch.prompt))) sp.push(_replaceCardVars(ch.prompt.trim(),ch.name,up.name||''));
  else sp.push('[角色设定]\n当前通话对象是「'+ch.name+'」。该角色完整人设缺失或需要从备份恢复。即使缺少详细人设，也不能把用户面具当成角色人设。');
  cbyd21_Call._pushWorldBookAfter(sp,_wbCallPost);
  var _postCallUserBlock='[和我聊天的用户]\n用户的名字是「'+(up.name||'我')+'」。'+((up.name&&up.name!=='我')?'':'用户没有设置名字。')+'\n绝对不能用角色自己的名字来称呼用户。';
  if(up.persona&&up.persona.trim())_postCallUserBlock+='\n'+up.persona.trim();
  sp.push(_postCallUserBlock);
  sp.push('[身份最终锁定]\n当前我扮演的角色是「'+ch.name+'」。\n用户是「'+(up.name||'用户')+'」。\n\n用户面具里的姓名、年龄、职业、外貌、性格、经历全部只属于用户，不属于我。不能把用户面具当成角色人设。');

  if(typeof cbyd21_Call._pushOocInstructionBlock === 'function'){
    cbyd21_Call._pushOocInstructionBlock(sp, chat, '通话结束后的追加消息');
  }

  var _postCallTimeBlock = cbyd21_Call._buildTimeAwareBlock(ch, '通话结束后的追加消息');
  if(_postCallTimeBlock)sp.push(_postCallTimeBlock);

  if(ch && !(ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName)){
    sp.push(_cbyd21DefaultChineseGate('通话结束后的追加消息', '通话结束后补发给用户的线上文字消息', {
      includeStrictOocProtocol:true
    }));
  }

  sp.push('[通话后追加消息]\n你刚才和用户通了一个电话，通话已经结束了。以下是通话的最后几句话：\n' + callSummary + '\n\n现在请严格按照上方角色设定的性格、说话方式和你们的关系，通过线上文字消息发一段通话后的后续。\n\n这条消息不是功能性补丁，而是电话结束后，角色在当前关系和当前情绪里自然产生的后续表达。\n\n要求：\n- 角色卡是最高依据。要从角色本人的性格、关系状态、通话内容和刚刚结束通话后的情绪延续出发。\n- 不能套用固定模板，不能把任何角色统一写成同一种通话后反应。\n- 这条消息必须像角色本人挂断后真实会补发给用户的线上文字。\n- 内容可以简短，但不能空洞。用户读完后应该感觉到通话刚刚发生过，角色的情绪和关系没有被切断。\n- 尊重用户不只是避免脏话或攻击性词汇，也包括态度上不能轻视用户、不能让用户感觉自己被随便处理、不能让通话后的回应像系统通知。\n- 如果角色卡里定义了角色对用户的情感或关系质感，这种关系质感必须自然存在于回复里。\n\n严格禁止：\n- 空回复。\n- 像系统通知一样说明通话状态。\n- 只有语气词或极短敷衍内容。\n- 写旁白、动作描写或心理描写。\n- 替用户补充未发生的行为、想法或反应。\n\n用线上聊天的方式回复。');

  if(ch && ch._bilingual && ch._bilingual.enabled && ch._bilingual.langName){
    var _blPostCall = ch._bilingual.langName;
    sp.push('[双语回复模式]\n你的母语是'+_blPostCall+'。发文字消息时用前端可识别的双语消息数组格式输出，标记为 __bl_json__：\n__bl_json__[{"t":"'+_blPostCall+'原文","c":"简体中文翻译"}]\n\n多句话时数组放多个对象：\n__bl_json__[{"t":"第一句'+_blPostCall+'","c":"第一句的简体中文翻译"},{"t":"第二句'+_blPostCall+'","c":"第二句的简体中文翻译"}]\n\n规则：整个回复以 __bl_json__ 开头，后面紧跟可解析的双语消息数组。这个格式只决定消息和翻译怎么显示，不代表你在执行代码任务。每个对象 t 和 c 严格一对一，c 必须是简体中文，不能是英文。');
  } else {
    var _postMin = ch.replyMin || 1;
    var _postMax = ch.replyMax || 1;
    sp.push('[线上聊天消息发送格式]\n这次是通话结束后的线上追加文字消息。请使用前端可识别的消息数组格式。这个格式只决定聊天气泡怎么分条，不代表你在执行代码任务，也不改变你正在扮演角色这件事。\n\n__msg_json__[{\"c\":\"消息内容\"}]\n\n规则：\n- __msg_json__ 必须放在第一行，后面紧跟可解析的消息数组。\n- 数组里的每个对象代表一个聊天气泡，只需要 c 字段。\n- 数组长度控制在 '+_postMin+' 到 '+_postMax+' 条之间。\n- 每个 c 字段都必须是角色真实会发给用户的后续消息，不能空白，不能像系统提示，不能敷衍。\n- 不要把消息数组包进代码块，不要美化成多行。\n\n质量要求：\n格式只负责分条，不能覆盖角色本人的表达方式。消息内容必须延续刚才通话里的关系、语气和情绪，让用户感觉这是角色挂断后自然补发的文字。');
  }
  cbyd21_Call._pushWorldBookSystemEnd(sp,_wbCallPost);
  var sm = sp.join('\n\n---\n\n');
  try {
    var url = apiConfig.url.replace(/\/+$/, '') + '/chat/completions';
    var _postMsgs = [{ role: 'user', content: '[通话刚结束]' }];
    if(_wbCallPost.depth.length > 0){
      _wbCallPost.depth.forEach(function(w){
        var depthPos = w.depth || 4;
        var insertIdx = Math.max(0, _postMsgs.length - depthPos);
        _postMsgs.splice(insertIdx, 0, { role:'user', content:'[前端深度注入 — 这不是用户发言]\n[World Book — ' + w.name + ']\n' + w.content });
      });
    }
    var _postCallBody = {
      model:apiConfig.model,
      messages:cbyd21_Call._buildContextPackMessages(sm, _postMsgs, _wbCallPost, '通话结束后的线上追加文字消息')
    };

    if(apiConfig.temperature !== undefined){
      _postCallBody.temperature = apiConfig.temperature;
    }

    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.key }, body: JSON.stringify(_postCallBody) });
    var _rawPostCallText = await r.text();

    if(!r.ok){
      var _postCallErrParsed = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(_rawPostCallText)
        : {data:null,text:''};

      var _postCallErrText = String(_postCallErrParsed.text || '').trim();

      if(!_postCallErrText && _postCallErrParsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
        _postCallErrText = String(_cbyd21ExtractChatApiContent(_postCallErrParsed.data) || '').trim();
      }

      var _postCallErrLooksLikeOnlyError =
        /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(_postCallErrText) ||
        (
          _postCallErrText.length < 30 &&
          /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(_postCallErrText)
        );

      if(_postCallErrText && _postCallErrText.length >= 10 && !_postCallErrLooksLikeOnlyError){
        console.warn('通话后追加消息 HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常回复处理');
      }else{
        cbyd21_Call._showCallApiError('通话后追加消息失败', new Error('HTTP '+r.status+': '+_rawPostCallText.slice(0,300)));
        _cleanupOnDone();
        return;
      }
    }

    var _parsedPostCallText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawPostCallText)
      : {data:null,text:_rawPostCallText};

    var d = _parsedPostCallText.data || {};
    var reply = _parsedPostCallText.text || cbyd21_Call._extractReplyContent(d);

    if(!reply && _rawPostCallText && String(_rawPostCallText).trim()){
      reply =
        '[前端提示：通话后追加消息 API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
        String(_rawPostCallText || '').trim();
    }

    reply = String(reply || '').trim();

    if(typeof _stripLeakedThinking === 'function') reply = _stripLeakedThinking(reply);

    reply = String(reply || '').trim();

    if(!reply) reply = '……';

    var time = formatTime(Date.now());
    var _oldMode = currentMode;

    currentMode = 'online';

    try{
      cbyd21_Call._appendOnlineReplySafely(chat, reply, time, '通话后追加消息');
    }finally{
      currentMode = _oldMode;
    }

    cbyd21_Data.saveChats();
    scrollToBottom();
  } catch(e){ cbyd21_Call._showCallApiError('通话后追加消息失败', e); _cleanupOnDone(); return; }
  // 恢复输入区
  var _postTypingEl = document.getElementById('typingIndicator');
  if(_postTypingEl){
    _postTypingEl.classList.remove('active');
    var _ptLabel = _postTypingEl.querySelector('.typing-text');
    if(_ptLabel) _ptLabel.textContent = '';
  }
  if(typeof _onDone === 'function') _onDone();
}

// ============================================================
// 双语通话渲染
// ============================================================
// _renderCallBilingual(text) → 将含 __bilingual_split__ 的通话消息渲染为可折叠翻译
// · 原文直接显示
// · 翻译默认显示，点击可折叠/展开
function _renderCallBilingual(text){
  text = String(text || '').replace(/\n*__bilingual_split__\n*/g, '__bilingual_split__').trim();

  var sepCount = (text.match(/__bilingual_split__/g) || []).length;

  // 通话双语显示兜底：
  // 如果同一条通话消息里挤进多组双语，优先横向合并成一个正常双语块。
  if(sepCount > 1){
    var lines = text.split(/\n+/).map(function(line){
      return line.trim();
    }).filter(function(line){
      return line.length > 0;
    });

    var originals = [];
    var translations = [];
    var canMerge = lines.length > 0;

    lines.forEach(function(line){
      if(line.indexOf('__bilingual_split__') < 0){
        canMerge = false;
        return;
      }

      var p = line.split('__bilingual_split__');
      var o = (p[0] || '').trim();
      var tr = p.slice(1).join('').trim();

      if(o)originals.push(o);
      if(tr)translations.push(tr);
    });

    if(canMerge && (originals.length > 0 || translations.length > 0)){
      var joinFn = typeof _cbyd21JoinBilingualTextPieces === 'function'
        ? _cbyd21JoinBilingualTextPieces
        : function(arr){ return (arr || []).join(''); };

      text = joinFn(originals) + '__bilingual_split__' + joinFn(translations);
    }
  }

  var parts = text.split('__bilingual_split__');
  var original = escHtml((parts[0] || '').trim());
  var translation = escHtml(parts.slice(1).join('').trim());

  // 防护：原文为空时把翻译当作完整内容直接显示
  if(!original && translation) return '<div>' + translation + '</div>';
  if(!translation) return original || escHtml(text);

  var id = 'cb_' + Math.random().toString(36).slice(2, 8);
  return '<div>' + original + '</div><div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:5px;padding-top:4px;cursor:pointer" onclick="var e=document.getElementById(\'' + id + '\');e.style.display=e.style.display===\'none\'?\'block\':\'none\'"><div style="font-size:9px;color:var(--text-muted)">翻译 ▾</div><div id="' + id + '" style="font-size:11px;color:var(--text-muted);line-height:1.5;margin-top:2px">' + translation + '</div></div>';
}

// ============================================================
// 通话输入框回车 + 缩小气泡拖动 + 迷你卡片拖动
// ============================================================
// DOMContentLoaded 时注册以下事件：
// · 通话输入框回车键 → 发送消息
// · 通话缩小气泡 → 触摸/鼠标拖动 + 吸附 + 点击恢复
// · 迷你卡片头部 → 触摸/鼠标拖动
document.addEventListener('DOMContentLoaded', function(){
  // 通话输入框回车发送
  var ci = document.getElementById('callInput');
  if(ci){
    ci.addEventListener('keydown', function(e){
      if(e.isComposing || e.keyCode === 229)return;

      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        cbyd21_Call.sendCallMessage();
      }
    });
  }

  // 通话缩小气泡拖动（触摸+鼠标）
  var mini = document.getElementById('callMini');
  if(mini){
    var startX = 0, startY = 0, curX = 0, curY = 0, dragging = false, moved = false;
    // 触摸拖动
    mini.addEventListener('touchstart', function(e){
      dragging = true; moved = false;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      curX = mini.offsetLeft; curY = mini.offsetTop;
      mini.style.right = 'auto'; mini.style.bottom = 'auto';
      mini.style.left = curX + 'px'; mini.style.top = curY + 'px';
    }, { passive: true });
    mini.addEventListener('touchmove', function(e){
      if(!dragging) return;
      var dx = e.touches[0].clientX - startX; var dy = e.touches[0].clientY - startY;
      if(Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      var _frameMini = document.getElementById('cbyd21PhoneFrame');
      var _miniMaxW = _frameMini ? _frameMini.clientWidth : window.innerWidth;
      var _miniMaxH = _frameMini ? _frameMini.clientHeight : window.innerHeight;
      var nx = Math.max(0, Math.min(_miniMaxW - 56, curX + dx));
      var ny = Math.max(0, Math.min(_miniMaxH - 56, curY + dy));
      mini.style.left = nx + 'px'; mini.style.top = ny + 'px';
    }, { passive: true });
    mini.addEventListener('touchend', function(e){
      if(!dragging) return; dragging = false;
      // 自动吸附到最近的屏幕边缘
      var bl = mini.offsetLeft;
      var _frameMiniSnap = document.getElementById('cbyd21PhoneFrame');
      var _miniSnapW = _frameMiniSnap ? _frameMiniSnap.clientWidth : window.innerWidth;
      var snapLeft = bl < _miniSnapW / 2 ? 16 : _miniSnapW - 72;
      mini.style.transition = 'left 0.25s ease'; mini.style.left = snapLeft + 'px';
      setTimeout(function(){ mini.style.transition = ''; }, 300);
      // 移动距离<6px视为点击 → 恢复全屏
      if(!moved){ e.preventDefault(); cbyd21_Call.restoreCallScreen(); }
    });
    // 鼠标拖动（PC端）
    mini.addEventListener('mousedown', function(e){
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      curX = mini.offsetLeft; curY = mini.offsetTop;
      mini.style.right = 'auto'; mini.style.bottom = 'auto';
      mini.style.left = curX + 'px'; mini.style.top = curY + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e){
      if(!dragging) return;
      var dx = e.clientX - startX; var dy = e.clientY - startY;
      if(Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      var _frameMini = document.getElementById('cbyd21PhoneFrame');
      var _miniMaxW = _frameMini ? _frameMini.clientWidth : window.innerWidth;
      var _miniMaxH = _frameMini ? _frameMini.clientHeight : window.innerHeight;
      var nx = Math.max(0, Math.min(_miniMaxW - 56, curX + dx));
      var ny = Math.max(0, Math.min(_miniMaxH - 56, curY + dy));
      mini.style.left = nx + 'px'; mini.style.top = ny + 'px';
    });
    document.addEventListener('mouseup', function(){
      if(!dragging) return; dragging = false;
      var bl = mini.offsetLeft;
      var _frameMiniSnap = document.getElementById('cbyd21PhoneFrame');
      var _miniSnapW = _frameMiniSnap ? _frameMiniSnap.clientWidth : window.innerWidth;
      var snapLeft = bl < _miniSnapW / 2 ? 16 : _miniSnapW - 72;
      mini.style.transition = 'left 0.25s ease'; mini.style.left = snapLeft + 'px';
      setTimeout(function(){ mini.style.transition = ''; }, 300);
      if(!moved){ cbyd21_Call.restoreCallScreen(); }
    });
  }

  // 迷你卡片拖动（通过卡片头部拖动整个卡片）
  var card = document.getElementById('callMiniCard');
  var header = document.getElementById('callMiniCardHeader');
  if(card && header){
    var cDragging = false, cStartX = 0, cStartY = 0, cCurX = 0, cCurY = 0;
    // 触摸拖动
    header.addEventListener('touchstart', function(e){
      cDragging = true; cStartX = e.touches[0].clientX; cStartY = e.touches[0].clientY;
      cCurX = card.offsetLeft; cCurY = card.offsetTop;
    }, { passive: true });
    document.addEventListener('touchmove', function(e){
      if(!cDragging) return;
      var dx = e.touches[0].clientX - cStartX; var dy = e.touches[0].clientY - cStartY;
      var _frame = document.getElementById('cbyd21PhoneFrame');
      var _maxW = _frame ? _frame.clientWidth : window.innerWidth;
      var _maxH = _frame ? _frame.clientHeight : window.innerHeight;
      var nx = Math.max(0, Math.min(_maxW - card.offsetWidth, cCurX + dx));
      var ny = Math.max(0, Math.min(_maxH - card.offsetHeight, cCurY + dy));
      card.style.left = nx + 'px'; card.style.top = ny + 'px';
      card.style.right = 'auto'; card.style.bottom = 'auto';
    }, { passive: true });
    document.addEventListener('touchend', function(){ cDragging = false; });
    // 鼠标拖动
    header.addEventListener('mousedown', function(e){
      cDragging = true; cStartX = e.clientX; cStartY = e.clientY;
      cCurX = card.offsetLeft; cCurY = card.offsetTop; e.preventDefault();
    });
    document.addEventListener('mousemove', function(e){
      if(!cDragging) return;
      var dx = e.clientX - cStartX; var dy = e.clientY - cStartY;
      var _frame = document.getElementById('cbyd21PhoneFrame');
      var _maxW = _frame ? _frame.clientWidth : window.innerWidth;
      var _maxH = _frame ? _frame.clientHeight : window.innerHeight;
      var nx = Math.max(0, Math.min(_maxW - card.offsetWidth, cCurX + dx));
      var ny = Math.max(0, Math.min(_maxH - card.offsetHeight, cCurY + dy));
      card.style.left = nx + 'px'; card.style.top = ny + 'px';
      card.style.right = 'auto'; card.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function(){ cDragging = false; });
  }
});
