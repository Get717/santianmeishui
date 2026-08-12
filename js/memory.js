// ============================================================
// cbyd21_Memory — 记忆系统模块
// ============================================================
// 从主文件拆分出来的记忆相关所有逻辑
// 包含：
// · 记忆数据读写（getMemories / getMemorySettings / getFilteredMemories）
// · 记忆连通范围（openMemoryScopeMenu / updateMemoryScopeLabel）
// · 记忆管理弹窗（openMemoryPanel / saveMemorySettings / closeMemoryModal）
// · 记忆条目列表渲染（renderMemoryList）
// · 记忆条目操作（editMemory / deleteMemory / clearAllMemories）
// · 手动总结（openSummaryModal / executeSummary）
// · 自动总结（checkAutoSummary / autoSummarizeInternal）
// · 通话记忆总结（_autoSummarizeCall / manualSummarizeCall）
// · 记忆中心角色列表（renderMemoryAppCharList）
// · 记忆中心详情页（openMemoryDetailPage ~ renderMemoryDetailList）
// · 从详情页打开总结（openSummaryFromDetail）
// · 筛选 + 手写添加（filterMemoryType / addManualMemory）
// · 排序回调（reorderMemoryChars）
// · 记忆栈（总结位置精确回退 + 重新总结）

// ============================================================
// 模块内部状态
// ============================================================
// _memoryCharId → 当前操作的角色ID（弹窗/详情页共用）
// _memoryFilter → 当前筛选类型（'all'/'online'/'call'/'offline'）
var _memoryCharId = null;
var _memoryFilter = 'all';
var _isSummarizing = false;
var _memoryBatchDeleteMode = false;
var _memoryBatchSelectedIds = {};
// _cbyd21MemoryPromptReadyOrToast(silent)
// → 记忆总结调用 API 前的提示词就绪检查。
// silent=true 用于自动总结：只暂停，不弹 toast，不写失败记录。
// silent=false 用于用户手动总结：提示“提示词正在加载”并阻止本次操作。
function _cbyd21MemoryPromptReadyOrToast(silent){
  if(typeof _cbyd21PromptsLoaded !== 'undefined' && _cbyd21PromptsLoaded){
    return true;
  }

  if(silent){
    if(typeof cbyd21_LoadPrompts === 'function'){
      cbyd21_LoadPrompts().catch(function(e){
        console.warn('提示词加载失败：', e);
      });
    }

    return false;
  }

  if(typeof _cbyd21BlockApiIfPromptsLoading === 'function'){
    return !_cbyd21BlockApiIfPromptsLoading();
  }

  if(typeof showToast === 'function'){
    showToast('提示词正在加载，请稍等…');
  }

  return false;
}

var _memoryOfflineSessionId = null;  // 记忆面板里选中的线下session
var _memoryOfflineSaveId = null;     // 记忆面板里选中的线下存档

function cbyd21_Memory_safeJson(key, fallback){
  try{
    var raw = localStorage.getItem(key);

    if(raw === null || raw === undefined || raw === ''){
      return fallback;
    }

    return JSON.parse(raw);
  }catch(e){
    console.warn('记忆模块 localStorage JSON 解析失败：', key, e);

    try{
      localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
    }catch(_e){}

    return fallback;
  }
}

function _memoryContentTypeForBatch(content){
  content = String(content || '');

  if(content.startsWith('[通话]'))return 'call';
  if(content.startsWith('[线下见面]') || content.startsWith('[线下群聊]'))return 'offline';

  return 'online';
}

function _refreshMemoryBatchViews(){
  try{
    cbyd21_UI.renderMemoryList();
  }catch(e){}

  try{
    if(document.getElementById('memoryDetailPage') && document.getElementById('memoryDetailPage').classList.contains('active')){
      renderMemoryDetailList();
    }
  }catch(e){}
}

function _getCurrentVisibleMemoryBatchItems(){
  var memories = _getBranchMemories(_memoryCharId);

  if(!Array.isArray(memories))return [];

  if(!_memoryFilter || _memoryFilter === 'all'){
    return [];
  }

  var filtered = memories.filter(function(m){
    return _memoryContentTypeForBatch(m.content || '') === _memoryFilter;
  });

  if(_memoryFilter === 'offline' && _memoryOfflineSessionId){
    var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);

    filtered = filtered.filter(function(m){
      return _memoryMatchesOfflineSelection(m, stack, _memoryOfflineSessionId, _memoryOfflineSaveId);
    });
  }

  return filtered;
}

function toggleMemoryBatchDeleteMode(){
  if(!_memoryCharId){
    showToast('请先选择记忆对象');
    return;
  }

  if(!_memoryFilter || _memoryFilter === 'all'){
    showToast('请先进入线上 / 通话 / 线下分类，再批量删除记忆');
    return;
  }

  _memoryBatchDeleteMode = !_memoryBatchDeleteMode;
  _memoryBatchSelectedIds = {};

  _refreshMemoryBatchViews();

  showToast(_memoryBatchDeleteMode ? '记忆批量删除已开启' : '记忆批量删除已关闭');
}

function toggleMemoryBatchSelectById(id,on){
  id = String(id || '');

  if(!id)return;

  if(on){
    _memoryBatchSelectedIds[id] = true;
  }else{
    delete _memoryBatchSelectedIds[id];
  }

  var count = Object.keys(_memoryBatchSelectedIds || {}).length;

  document.querySelectorAll('#memoryBatchDeleteCount').forEach(function(el){
    if(el){
      el.textContent = count;
    }
  });
}

function toggleMemoryBatchSelectAll(){
  var items = _getCurrentVisibleMemoryBatchItems();
  var ids = items.map(function(m){
    return String(m && m.id || '');
  }).filter(Boolean);

  if(ids.length === 0){
    showToast('当前分类没有可选择的记忆');
    return;
  }

  var allSelected = ids.every(function(id){
    return !!_memoryBatchSelectedIds[id];
  });

  _memoryBatchSelectedIds = {};

  if(!allSelected){
    ids.forEach(function(id){
      _memoryBatchSelectedIds[id] = true;
    });
  }

  _refreshMemoryBatchViews();
}

function _renderMemoryBatchDeleteBar(){
  var selectedCount = Object.keys(_memoryBatchSelectedIds || {}).length;
  var bar = document.createElement('div');

  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:10px;background:rgba(196,92,92,0.08);border:1px solid rgba(196,92,92,0.18);border-radius:10px;font-size:12px;color:var(--text-secondary)';
  bar.innerHTML =
    '<span style="flex:1">已选 <strong id="memoryBatchDeleteCount">' + selectedCount + '</strong> 条记忆</span>' +
    '<button class="btn-sm" onclick="toggleMemoryBatchSelectAll()">全选 / 取消</button>' +
    '<button class="btn-sm danger" onclick="openSelectedMemoryDeleteMenu()">删除所选</button>' +
    '<button class="btn-sm" onclick="toggleMemoryBatchDeleteMode()">退出</button>';

  return bar;
}

function openSelectedMemoryDeleteMenu(){
  var ids = Object.keys(_memoryBatchSelectedIds || {});

  if(ids.length === 0){
    showToast('请先选择记忆');
    return;
  }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var hint = document.createElement('div');
  hint.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
  hint.textContent = '确认删除选中的 ' + ids.length + ' 条记忆？';
  container.appendChild(hint);

  var items = [
    {
      label:'仅删除内容',
      desc:'删除记忆文字，但保留总结记录。之后仍可在总结记录里重新总结或手写填入。',
      hard:false
    },
    {
      label:'完全删除',
      desc:'删除记忆文字和对应总结记录。这些范围会视为从未总结过。',
      danger:true,
      hard:true
    }
  ];

  items.forEach(function(item){
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML =
      '<div style="flex:1">' +
        '<div style="font-size:14px;color:' + (item.danger ? 'var(--danger)' : 'var(--text-primary)') + ';font-weight:600">' + item.label + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.5">' + item.desc + '</div>' +
      '</div>';

    div.onclick = function(){
      closeModal('addCharModal');
      deleteSelectedMemories(item.hard);
    };

    container.appendChild(div);
  });

  var cancel = document.createElement('div');
  cancel.className = 'add-char-item';
  cancel.style.cssText = 'padding:12px 16px;text-align:center;font-size:13px;color:var(--text-muted);border-top:1px solid var(--border-soft)';
  cancel.textContent = '取消';
  cancel.onclick = function(){
    closeModal('addCharModal');
  };
  container.appendChild(cancel);

  document.getElementById('addCharModal').querySelector('h3').textContent = '批量删除记忆';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

async function deleteSelectedMemories(hardDelete){
  var ids = Object.keys(_memoryBatchSelectedIds || {});

  if(ids.length === 0){
    showToast('请先选择记忆');
    return;
  }

  var yes = await customConfirm(
    hardDelete
      ? '确认完全删除选中的 ' + ids.length + ' 条记忆？\n\n记忆内容和对应总结记录都会删除。'
      : '确认仅删除选中的 ' + ids.length + ' 条记忆内容？\n\n总结记录会保留，之后可重新总结或手写填入。'
  );

  if(!yes)return;

  var idMap = {};
  ids.forEach(function(id){
    idMap[String(id)] = true;
  });

  var memories = charMemories[_memoryCharId] || [];
  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);

  for(var i = memories.length - 1; i >= 0; i--){
    var mem = memories[i];

    if(!mem || !idMap[String(mem.id || '')])continue;

    if(hardDelete){
      stack = stack.filter(function(s){
        return s && s.memoryId !== mem.id;
      });
    }else{
      stack.forEach(function(s){
        if(s && s.memoryId === mem.id){
          s.deleted = true;
          s.memoryId = null;
        }
      });
    }

    memories.splice(i, 1);
  }

  charMemories[_memoryCharId] = memories;
  localStorage.setItem('stm_summaryStack_' + _memoryCharId, JSON.stringify(stack));

  _memoryBatchSelectedIds = {};
  _memoryBatchDeleteMode = false;

  cbyd21_Data.saveMemories();

  try{
    _updateSummaryPosition(_memoryCharId);
  }catch(e){}

  _refreshMemoryBatchViews();

  try{
    _renderAutoSummaryProgress(_memoryCharId, 'memModalAutoProgress');
    _renderAutoSummaryProgress(_memoryCharId, 'memDetailAutoProgress');
  }catch(e){}

  showToast(hardDelete ? '已完全删除所选记忆' : '已删除所选记忆内容');
}

// _extractApiContent(d) → 从 API 返回中提取文本内容
// · 优先复用主文件 _cbyd21ExtractChatApiContent，兼容不同中转站返回结构。
// · 不读取 reasoning_content / thinking 字段，避免把模型内部推理保存进记忆。
// · content/text/output_text 都没有则返回空字符串。
function _extractApiContent(d) {
  var content = '';

  if (typeof _cbyd21ExtractChatApiContent === 'function') {
    content = _cbyd21ExtractChatApiContent(d);
  } else {
    function contentToText(v, depth) {
      depth = depth || 0;

      if (depth > 8) return '';

      if (v === null || v === undefined) return '';

      if (typeof v === 'string') return v;

      if (typeof v === 'number' || typeof v === 'boolean') {
        return String(v);
      }

      if (Array.isArray(v)) {
        return v.map(function(item) {
          return contentToText(item, depth + 1);
        }).join('');
      }

      if (typeof v === 'object') {
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

        for (var i = 0; i < priorityKeys.length; i++) {
          var k = priorityKeys[i];

          if (v[k] !== undefined && v[k] !== null) {
            var direct = contentToText(v[k], depth + 1);

            if (direct) return direct;
          }
        }

        var keys = Object.keys(v);

        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];

          if (/^(id|object|model|created|usage|prompt_tokens|completion_tokens|total_tokens|finish_reason|index)$/i.test(key)) continue;
          if (/reasoning|thinking|analysis|thought/i.test(key)) continue;

          if (/content|text|reply|answer|response|result|final|message|output|completion|generated|html|markdown|code|body/i.test(key)) {
            var nested = contentToText(v[key], depth + 1);

            if (nested) return nested;
          }
        }

        return '';
      }

      return String(v || '');
    }

    if (typeof d === 'string' || Array.isArray(d)) {
      content = contentToText(d);
    }

    var choice = !content && d && d.choices && d.choices[0] ? d.choices[0] : null;

    if (choice) {
      content =
        contentToText(choice.message) ||
        contentToText(choice.text) ||
        contentToText(choice.delta) ||
        contentToText(choice.output_text) ||
        contentToText(choice.answer) ||
        contentToText(choice.response) ||
        contentToText(choice.result) ||
        contentToText(choice);
    }

    if (!content) {
      content =
        contentToText(d && d.output_text) ||
        contentToText(d && d.output) ||
        contentToText(d && d.content) ||
        contentToText(d);
    }
  }

  content = String(content || '').trim();

  if (typeof _stripLeakedThinking === 'function') {
    content = _stripLeakedThinking(content);
  }

  return String(content || '').trim();
}

function _cbyd21MemoryCleanContent(content){
  var c = String(content || '');

  if(typeof _cbyd21MessageContentForUserAction === 'function'){
    c = _cbyd21MessageContentForUserAction(c);
  }

  if(typeof _stripLeakedThinking === 'function'){
    c = _stripLeakedThinking(c);
  }

  return c
    .replace(/__inner_voice__[\s\S]*/g, '')
    .replace(/__bilingual_split__/g, '\n')
    .replace(/__bl_sep__/g, '')
    .trim();
}

// _formatMemoryTs(ts) → 把时间戳格式化为完整年月日时间
function _formatMemoryTs(ts) {
  ts = parseInt(ts);
  if (!ts || isNaN(ts)) return '';
  var d = new Date(ts);
  return d.getFullYear() + '/' +
    (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
    d.getDate().toString().padStart(2, '0') + ' ' +
    d.getHours().toString().padStart(2, '0') + ':' +
    d.getMinutes().toString().padStart(2, '0');
}

// _memoryGeneratedTs(m) → 记忆生成时间
// 生成时间默认来自 id，因为每条记忆的 id 是创建时的 Date.now()
function _memoryGeneratedTs(m) {
  if (!m) return 0;
  var ts = parseInt(m.id);
  if (ts && !isNaN(ts)) return ts;
  return 0;
}

// _memoryFullTime(m)
// → 记忆列表显示用时间。
// 来源时间 = 剧情发生位置 _sourceTs。
// 生成时间 = 这条记忆被创建出来的时间 id。
// 如果两者在同一分钟内，简化显示；否则同时显示。
function _memoryFullTime(m) {
  if (!m) return '';

  var sourceTs = _memorySourceTs(m);
  var generatedTs = _memoryGeneratedTs(m);

  var sourceText = _formatMemoryTs(sourceTs);
  var generatedText = _formatMemoryTs(generatedTs) || m.time || '';

  if (!sourceText && !generatedText) return '';
  if (!sourceText) return '生成 ' + generatedText;
  if (!generatedText) return '来源 ' + sourceText;

  // 同一分钟内视为同一时间，不重复显示
  var sourceMinute = Math.floor(sourceTs / 60000);
  var generatedMinute = Math.floor(generatedTs / 60000);
  if (sourceMinute === generatedMinute) {
    return sourceText;
  }

  return '来源 ' + sourceText + ' · 生成 ' + generatedText;
}

// _memorySourceTs(m) → 记忆排序用时间戳
// 优先使用剧情来源时间 _sourceTs；没有时回退到记忆创建时间 id。
function _memorySourceTs(m) {
  if (!m) return 0;
  var ts = parseInt(m._sourceTs);
  if (ts && !isNaN(ts)) return ts;

  ts = parseInt(m.id);
  if (ts && !isNaN(ts)) return ts;

  return 0;
}

// _memorySourceSeq(m) → 同一时间点内的稳定排序
function _memorySourceSeq(m) {
  if (!m) return 0;
  var seq = parseInt(m._sourceSeq);
  if (isNaN(seq)) seq = 0;
  return seq;
}

// _sortMemoryArrayInPlace(arr)
// → 按剧情发生时间排序：旧的在上，新的在下。
// 如果用户后来才补总结，也会根据 _sourceTs 回到正确剧情位置。
function _sortMemoryArrayInPlace(arr) {
  if (!Array.isArray(arr)) return arr;

  arr.sort(function(a, b) {
    var at = _memorySourceTs(a);
    var bt = _memorySourceTs(b);

    if (at && bt && at !== bt) return at - bt;
    if (at && !bt) return -1;
    if (!at && bt) return 1;

    var as = _memorySourceSeq(a);
    var bs = _memorySourceSeq(b);
    if (as !== bs) return as - bs;

    var ai = parseInt(a && a.id);
    var bi = parseInt(b && b.id);
    if (ai && bi && ai !== bi) return ai - bi;

    return 0;
  });

  return arr;
}

// _getSourceTsFromMessages(messages, from, to)
// → 根据总结范围取剧情来源时间。
// 默认取范围最后一条消息的 _ts，因为这条总结代表“总结到这里为止”。
function _getSourceTsFromMessages(messages, from, to) {
  messages = messages || [];
  if (!messages.length) return Date.now();

  var idx = Math.max(0, Math.min(messages.length - 1, (parseInt(to) || messages.length) - 1));
  var msg = messages[idx] || null;

  if (msg && msg._ts) return msg._ts;
  if (msg && msg.created) return msg.created;

  return Date.now();
}

// _memoryIsVisibleSourceMessage(m)
// → 记忆总结/手写绑定范围里使用的“可见消息”判断。
// __system_init__ / __system_continue__ 不显示给用户，也不应该占用用户选择的条数编号。
function _memoryIsVisibleSourceMessage(m) {
  if (!m) return false;
  if (m._mode === 'ooc') return false;

  // 线上内嵌线下是显示在聊天页里的线下叙事。
  // 它不能混入普通线上自动总结，否则会污染线上记忆。
  // 后续会单独按 inline_offline / offline 逻辑总结。
  if (m._mode === 'inline_offline') return false;

  var c = m.content || '';
  if (c === '__system_init__') return false;
  if (c === '__system_continue__') return false;
  return true;
}

// _memoryVisibleSourceMessages(messages)
// → 把原始消息数组转换成用户可见的消息数组。
// 手动总结、手写绑定、重新总结都应该使用这个数组计算 from/to。
function _memoryVisibleSourceMessages(messages) {
  messages = messages || [];
  return messages.filter(function(m) {
    return _memoryIsVisibleSourceMessage(m);
  });
}

// _findOfflineRecordSourceTs(charId, sessionId)
// → 找到线上聊天里对应的 __offline_record__ 卡片时间戳。
// 线下记录卡片在线上时间线里有自己的位置，线下总结应按这个位置排序。
function _findOfflineRecordSourceTs(charId, sessionId) {
  if (!charId || !sessionId) return 0;

  var charChats = chats.filter(function(c) {
    return c.charId === charId;
  });

  for (var ci = 0; ci < charChats.length; ci++) {
    var chat = charChats[ci];
    var messages = chat.messages || [];

    for (var mi = 0; mi < messages.length; mi++) {
      var m = messages[mi];
      var c = m && m.content || '';

      if (!c.startsWith('__offline_record__')) continue;

      try {
        var data = JSON.parse(c.slice(18));
        if (data && data.sessionId === sessionId) {
          return m._ts || data._sourceTs || data.endTime || data.created || 0;
        }
      } catch (e) {}
    }
  }

  return 0;
}

// _formatMemoryStackInfo(charId, mem) → 生成记忆条目的来源和范围说明
function _formatMemoryStackInfo(charId, mem) {
  if (!charId || !mem) return '';

  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var entry = stack.find(function(s) { return s.memoryId === mem.id; });

  var lines = [];

  var sourceTimeText = _formatMemoryTs(_memorySourceTs(mem));
  var generatedTimeText = _formatMemoryTs(_memoryGeneratedTs(mem));

  if (sourceTimeText) {
    lines.push('来源时间：' + sourceTimeText);
  }

  if (generatedTimeText) {
    lines.push('生成时间：' + generatedTimeText);
  }

  if (entry && entry.label) {
    lines.push(entry.label);
  } else if (entry && entry.from && entry.to) {
    lines.push('第' + entry.from + '~' + entry.to + '条');
  }

  if (entry && entry.from && entry.to) {
    var unit = '条';
    lines.push('范围：第' + entry.from + '~' + entry.to + unit);
  }

  if (charId.startsWith('group_')) {
    var gid = charId.slice(6);
    var group = cbyd21_Group._groups.find(function(g) { return g.id === gid; });
    if (group) {
      lines.push('群聊：' + group.name);
      var gbid = entry && entry._branchId || mem._branchId || null;
      if (gbid && group.branches) {
        var gb = group.branches.find(function(b) { return b.id === gbid; });
        if (gb) {
          var gidx = group.branches.indexOf(gb);
          lines.push('群聊分支：分支' + (group.branches.length - gidx));
        }
      }
      var gsid = entry && entry._sessionId || mem._sessionId || null;
      if (gsid && group._offlineSessions) {
        var gsess = group._offlineSessions.find(function(s) { return s.id === gsid; });
        if (gsess) {
          var sameBranchSessions = group._offlineSessions.filter(function(s) { return s._branchId === gsess._branchId; });
          var gsidx = sameBranchSessions.indexOf(gsess);
          if (gsidx >= 0) lines.push('群聊线下：第' + (sameBranchSessions.length - gsidx) + '次见面');
          var gsaveId = entry && entry._saveId || mem._saveId || null;
          if (gsaveId && gsess._saves) {
            var gsv = gsess._saves.find(function(sv) { return sv.id === gsaveId; });
            if (gsv) lines.push('群聊线下存档：' + gsv.label);
          }
        }
      }
    }
    return lines.join('\n');
  }

  var content = mem.content || '';

  if (content.startsWith('[线下见面]') || content.startsWith('[线下群聊]')) {
    var sid = mem._sessionId || entry && entry._sessionId || null;
    var bid = mem._branchId || entry && entry._branchId || null;
    var sourceType = mem._sourceType || entry && entry._sourceType || '';

    if (bid) {
      var bname = _getBranchDisplayName(charId, bid);
      if (bname) lines.push('绑定线上分支：' + bname);
    }

    // 线上内嵌线下：记忆同样归入 [线下见面]，
    // 但来源不是咫尺朝夕 App，而是聊天页当前分支里的 inline_offline session。
    if (sourceType === 'inline_offline') {
      var inlineChat = bid ? chats.find(function(c){
        return c && c.id === bid && c.charId === charId;
      }) : null;

      if(inlineChat && inlineChat._inlineOffline && Array.isArray(inlineChat._inlineOffline.sessions)){
        var inlineSession = inlineChat._inlineOffline.sessions.find(function(s){
          return s && s.id === sid;
        });

        if(inlineSession){
          if(window.cbyd21_InlineOffline && cbyd21_InlineOffline.getSessionNumber){
            lines.push('线上内嵌线下：第' + cbyd21_InlineOffline.getSessionNumber(inlineChat, inlineSession) + '次见面');
          }else if(inlineSession.label){
            lines.push('线上内嵌线下：' + inlineSession.label);
          }else{
            lines.push('线上内嵌线下记录');
          }

          var inlineSaveId = mem._saveId || entry && entry._saveId || null;

          if(inlineSaveId && inlineSession._saves){
            var inlineSave = inlineSession._saves.find(function(sv){
              return sv && sv.id === inlineSaveId;
            });

            if(inlineSave){
              lines.push('线上内嵌线下存档：' + inlineSave.label);
            }
          }
        }else{
          lines.push('线上内嵌线下记录');
        }
      }else{
        lines.push('线上内嵌线下记录');
      }

      if (!entry) {
        lines.push('手写记忆 / 无总结范围记录');
      }

      return lines.join('\n');
    }

    if (sid && typeof cbyd21_Offline !== 'undefined') {
      var sessions = cbyd21_Offline._sessions[charId] || [];
      var targetSession = sessions.find(function(s) { return s.id === sid; });
      if (targetSession) {
        var sameBranchSessions = sessions.filter(function(s) { return s._onlineBranchId === targetSession._onlineBranchId; });
        var sidx = sameBranchSessions.indexOf(targetSession);
        if (sidx >= 0) {
          var unifiedNo =
            typeof cbyd21_Offline !== 'undefined' &&
            cbyd21_Offline._getUnifiedSingleSessionNumber
              ? cbyd21_Offline._getUnifiedSingleSessionNumber(charId, targetSession._onlineBranchId, targetSession)
              : (sameBranchSessions.length - sidx);

          lines.push('线下记录：第' + unifiedNo + '次见面');
        }
        var saveId = mem._saveId || entry && entry._saveId || null;
        if (saveId && targetSession._saves) {
          var sv = targetSession._saves.find(function(x) { return x.id === saveId; });
          if (sv) lines.push('线下存档：' + sv.label);
        }
      }
    }
  } else {
    var obid = mem._branchId || entry && entry._branchId || null;
    if (obid) {
      var onName = _getBranchDisplayName(charId, obid);
      if (onName) lines.push('线上分支：' + onName);
    }
  }

  if (!entry) {
    lines.push('手写记忆 / 无总结范围记录');
  }

  return lines.join('\n');
}

// _resummarizeMemoryById(charId, memoryId) → 从记忆编辑界面重新总结对应范围
function _resummarizeMemoryById(charId, memoryId) {
  if (!charId || !memoryId) return;
  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var idx = stack.findIndex(function(s) { return s.memoryId === memoryId; });
  if (idx < 0) {
    showToast('找不到这条记忆对应的总结记录');
    return;
  }
  closeModal('textInputModal');
  window._summaryModalCharId = charId;
  _resummarizeFromStack(idx);
}

// _openMemoryFromStack(stackIdx, overrideCharId) → 从总结记录跳转到对应记忆编辑
function _openMemoryFromStack(stackIdx, overrideCharId) {
  var charId = overrideCharId || window._summaryModalCharId || _memoryCharId || currentChatCharId;
  if (!charId) return;

  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var entry = stack[stackIdx];
  if (!entry) {
    showToast('找不到总结记录');
    return;
  }

  if (entry.memoryId) {
    var memories = getMemories(charId);
    var idx = memories.findIndex(function(m) { return m.id === entry.memoryId; });
    if (idx >= 0) {
      _memoryCharId = charId;
      closeModal('summaryModal');
      closeModal('addCharModal');
      setTimeout(function() {
        editMemory(idx);
      }, 80);
      return;
    }
  }

  if (entry.from && entry.to && !entry.memoryId) {
    _manualFillStackMemory(stackIdx, charId);
    return;
  }

  showToast('这条记录没有可编辑的记忆内容');
}

// _manualFillStackMemory(stackIdx, overrideCharId) → 给空栈道创建待填入记忆并打开正常编辑界面
function _manualFillStackMemory(stackIdx, overrideCharId) {
  var charId = overrideCharId || window._summaryModalCharId || _memoryCharId || currentChatCharId;
  if (!charId) return;

  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var entry = stack[stackIdx];
  if (!entry) {
    showToast('找不到总结记录');
    return;
  }

  if (entry.memoryId) {
    _openMemoryFromStack(stackIdx, charId);
    return;
  }

  var source = _getStackSourceMessages(charId, entry) || {};
  var prefix = source.prefix || '';

  if (!prefix && entry.label) {
    if (entry.label.indexOf('线下群聊') >= 0) prefix = '[线下群聊] ';
    else if (entry.label.indexOf('群聊') >= 0) prefix = '[群聊] ';
    else if (entry.label.indexOf('线下') >= 0) prefix = '[线下见面] ';
    else if (entry.label.indexOf('通话') >= 0) prefix = '[通话] ';
  }

  if (!charMemories[charId]) charMemories[charId] = [];

  var _pendingVisibleMessages = _memoryVisibleSourceMessages(source.messages || []);
  var _pendingSourceTs = entry._sourceTs || (_pendingVisibleMessages.length ? _getSourceTsFromMessages(_pendingVisibleMessages, entry.from, entry.to) : Date.now());

  var pendingEntry = {
    id: Date.now().toString(),
    content: prefix + '（待手写填入）',
    type: 'manual',
    time: formatTime(Date.now()),
    enabled: false,
    _pendingFill: true,
    _sourceTs: _pendingSourceTs,
    _sourceSeq: entry.to || 0,
    _sourceType: entry._sourceType || 'manual_fill'
  };

  if (source.branchId) pendingEntry._branchId = source.branchId;
  else if (entry._branchId) pendingEntry._branchId = entry._branchId;

    if (source.sessionId) pendingEntry._sessionId = source.sessionId;
  else if (entry._sessionId) pendingEntry._sessionId = entry._sessionId;

  if (source.saveId) pendingEntry._saveId = source.saveId;
  else if (entry._saveId) pendingEntry._saveId = entry._saveId;

  charMemories[charId].push(pendingEntry);
  _sortMemoryArrayInPlace(charMemories[charId]);

  entry.memoryId = pendingEntry.id;
  entry.deleted = false;
  entry.failed = true;

  if (pendingEntry._branchId) entry._branchId = pendingEntry._branchId;
  if (pendingEntry._sessionId) entry._sessionId = pendingEntry._sessionId;
  if (pendingEntry._saveId) entry._saveId = pendingEntry._saveId;

  entry._sourceTs = pendingEntry._sourceTs;
  entry._sourceSeq = pendingEntry._sourceSeq;
  entry._sourceType = pendingEntry._sourceType;

  localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(stack));
  cbyd21_Data.saveMemories();

  _memoryCharId = charId;
  closeModal('summaryModal');
  closeModal('addCharModal');

  cbyd21_UI.renderMemoryList();
  if (document.getElementById('memoryDetailPage').classList.contains('active')) renderMemoryDetailList();

  var sortedMemories = getMemories(charId);
  var idx = sortedMemories.findIndex(function(m) { return m.id === pendingEntry.id; });
  if (idx >= 0) {
    setTimeout(function() {
      editMemory(idx);
    }, 80);
  }
}

// _getStackSourceMessages(charId, entry) → 根据总结栈记录找到原始消息来源
function _getStackSourceMessages(charId, entry) {
  if (!charId || !entry) return null;

  // 群聊记忆
  if (charId.startsWith('group_')) {
    var gid = charId.slice(6);
    var group = cbyd21_Group._groups.find(function(g) { return g.id === gid; });
    if (!group) return null;

    // 群聊线下
    if (entry.label && entry.label.indexOf('线下群聊') >= 0 && group._offlineSessions) {
      var gs = null;
      if (entry._sessionId) {
        gs = group._offlineSessions.find(function(s) { return s.id === entry._sessionId; });
      }
      if (!gs && entry._branchId) {
        gs = group._offlineSessions.find(function(s) { return s._branchId === entry._branchId && s.messages && s.messages.length >= entry.to; });
      }
      if (!gs) return null;
      var _gsMessages = gs.messages || [];
      if (entry._saveId && entry._saveId !== 'current' && gs._saves) {
        var _gsSave = gs._saves.find(function(sv) { return sv.id === entry._saveId; });
        if (_gsSave && _gsSave.messages) _gsMessages = _gsSave.messages;
      }
      return { messages: _memoryVisibleSourceMessages(_gsMessages), prefix: '[线下群聊] ', branchId: entry._branchId || gs._branchId || null, sessionId: gs.id || null, saveId: entry._saveId || null, userLabel: '用户', aiLabel: '叙事' };
    }

    // 群聊线上
    var gb = null;
    if (entry._branchId && group.branches) {
      gb = group.branches.find(function(b) { return b.id === entry._branchId; });
    }
    if (!gb && group.branches) {
      gb = group.branches[cbyd21_Group._currentBranchIdx || 0] || group.branches[0];
    }
    if (!gb) return null;
    return { messages: _memoryVisibleSourceMessages(gb.messages || []), prefix: '[群聊] ', branchId: gb.id || null, userLabel: '用户', aiLabel: '群聊' };
  }

  // 线上内嵌线下
  // 这类记忆同样以 [线下见面] 存入角色记忆，
  // 但原始消息存在 chats[].messages 里，并通过 _inlineSessionId 绑定。
  if (entry._sourceType === 'inline_offline') {
    var inlineChat = null;

    if(entry._branchId){
      inlineChat = chats.find(function(c){
        return c && c.id === entry._branchId && c.charId === charId;
      }) || null;
    }

    if(!inlineChat){
      inlineChat = chats.find(function(c){
        return c && c.charId === charId && c._inlineOffline && Array.isArray(c._inlineOffline.sessions);
      }) || null;
    }

    if(!inlineChat || !inlineChat._inlineOffline)return null;

    var inlineSessions = Array.isArray(inlineChat._inlineOffline.sessions)
      ? inlineChat._inlineOffline.sessions
      : [];

    var inlineSession = entry._sessionId
      ? inlineSessions.find(function(s){
          return s && s.id === entry._sessionId;
        })
      : null;

    if(!inlineSession)return null;

    var inlineMessages = (inlineChat.messages || []).filter(function(m){
      return m &&
        m._mode === 'inline_offline' &&
        m._inlineSessionId === inlineSession.id &&
        m.content !== '__system_init__' &&
        m.content !== '__system_continue__';
    });

    var inlineSaveId = entry._saveId || null;

    if(inlineSaveId && inlineSaveId !== 'current' && inlineSession._saves){
      var inlineSave = inlineSession._saves.find(function(sv){
        return sv && sv.id === inlineSaveId;
      });

      if(inlineSave && inlineSave.messages){
        inlineMessages = inlineSave.messages;
      }
    }

    // 注意：普通 _memoryVisibleSourceMessages() 会过滤 _mode:'inline_offline'，
    // 但这里本来就是在为线上内嵌线下总结记录找原始消息。
    // 所以这里单独做可见消息过滤，并返回浅拷贝，把 _mode 临时去掉，
    // 避免后续 _resummarizeFromStack / _manualFillStackMemory 再次过滤时把它们清空。
    var inlineVisibleMessages = (inlineMessages || []).filter(function(m){
      if(!m)return false;
      if(m.content === '__system_init__')return false;
      if(m.content === '__system_continue__')return false;
      if(m._mode === 'ooc')return false;
      return true;
    }).map(function(m){
      var copy = Object.assign({}, m);

      if(copy._mode === 'inline_offline'){
        delete copy._mode;
      }

      return copy;
    });

    return {
      messages:inlineVisibleMessages,
      prefix:'[线下见面] ',
      branchId:inlineChat.id || entry._branchId || null,
      sessionId:inlineSession.id || null,
      saveId:inlineSaveId && inlineSaveId !== 'current' ? inlineSaveId : null,
      userLabel:'用户',
      aiLabel:'角色'
    };
  }

  // 线下见面
  if (entry.label && entry.label.indexOf('线下') >= 0) {
    if (typeof cbyd21_Offline === 'undefined') return null;
    var sessions = cbyd21_Offline._sessions[charId] || [];
    var os = null;
    if (entry._sessionId) {
      os = sessions.find(function(s) { return s.id === entry._sessionId; });
    }
    if (!os && entry._branchId) {
      os = sessions.find(function(s) { return s._onlineBranchId === entry._branchId && s.messages && s.messages.length >= entry.to; });
    }
    if (!os && cbyd21_Offline._charId === charId && cbyd21_Offline._messages) {
      var _curOffSourceSession = cbyd21_Offline._getSession ? cbyd21_Offline._getSession() : null;
      if (_curOffSourceSession && (!entry._sessionId || _curOffSourceSession.id === entry._sessionId) && (!entry._branchId || _curOffSourceSession._onlineBranchId === entry._branchId)) {
        return { messages: _memoryVisibleSourceMessages(cbyd21_Offline._messages || []), prefix: '[线下见面] ', branchId: _curOffSourceSession._onlineBranchId || null, sessionId: _curOffSourceSession.id || null, saveId: entry._saveId || null, userLabel: '用户', aiLabel: '角色' };
      }
    }
    if (!os) return null;
    var _osMessages=os.messages||[];
    if(entry._saveId&&entry._saveId!=='current'&&os._saves){
      var _osSave=os._saves.find(function(sv){return sv.id===entry._saveId});
      if(_osSave&&_osSave.messages)_osMessages=_osSave.messages;
    }
    return { messages: _memoryVisibleSourceMessages(_osMessages), prefix: '[线下见面] ', branchId: os._onlineBranchId || entry._branchId || null, sessionId: os.id || null, saveId: entry._saveId || null, userLabel: '用户', aiLabel: '角色' };
  }

  // 线上聊天
  var chat = null;
  if (entry._branchId) {
    chat = chats.find(function(c) { return c.id === entry._branchId && c.charId === charId; });
  }
  if (!chat) {
    chat = chats.find(function(x) { return x.id === currentChatId && x.charId === charId; });
  }
  if (!chat) return null;
  return { messages: _memoryVisibleSourceMessages(chat.messages || []), prefix: '', branchId: chat.id || null, userLabel: 'User', aiLabel: 'Char' };
}

// _refreshMemoryListsIfVisible() →总结完成后刷新正在显示的记忆列表
function _refreshMemoryListsIfVisible() {
  try { cbyd21_UI.renderMemoryList(); } catch(e) {}
  try { if(document.getElementById('memoryDetailPage').classList.contains('active')) renderMemoryDetailList(); } catch(e) {}
}

// ============================================================
// 记忆连通范围选项定义
// ============================================================
// · 每个选项对应一个模块的记忆
// · 勾选后该模块的记忆可被其他模块的AI读取
// · 'shared' 预留，暂未实装
var _memoryScopeOptions=[
  {id:'online',name:'线上聊天',desc:'线上模式产生的记忆'},
  {id:'call',name:'通话记录',desc:'语音/视频通话中的记忆'},
  {id:'offline',name:'线下模式',desc:'线下见面产生的记忆'},
  {id:'shared',name:'共享记忆',desc:'跨角色通用的记忆（开发中）'}
];

// 默认总结提示词（所有模块共用）
const DEFAULT_SUMMARY_PROMPT = '请用中文总结以下对话的关键信息，包括：发生了什么事、角色的情绪变化、重要的承诺或约定、关系的进展。用简洁的条目形式，不超过300字。';

// _renderAutoSummaryProgress(charId, containerId) →渲染自动总结进度提示
// · 显示"下次自动总结将从第X条开始"+ 那条消息的预览
// · 分支敏感：只看当前分支的轮数和消息
function _renderAutoSummaryProgress(charId, containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var settings = getMemorySettings(charId);
  if (!settings.autoSummary) { el.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:8px 0">自动总结未开启</div>'; return; }
  var interval = settings.interval || 20;
  var autoMods = settings.autoSummaryModules || [];
  if (autoMods.length === 0 && settings.autoSummary) autoMods = ['online', 'call', 'offline'];
  var html = '';
  // 群聊进度（单独处理）
  if (charId && charId.startsWith('group_')) {
    var _pgGid = charId.slice(6);
    var _pgGrp = cbyd21_Group._groups.find(function(g) { return g.id === _pgGid; });
    if (_pgGrp && autoMods.indexOf('online') >= 0) {
      var _pgBranch = _getCurrentGroupMemoryBranch(charId);
      if (_pgBranch) {
        var _pgBranchId = _pgBranch ? _pgBranch.id : null;
        var _pgVisibleMessages = _memoryVisibleSourceMessages(_pgBranch.messages || []);
        var _pgUserRounds = _pgVisibleMessages.filter(function(m) { return m.role === 'user'; }).length;
        var _pgRKey = 'stm_lastSummaryRounds_' + charId + '_online_' + (_pgBranchId || '');
        var _pgLastRounds = parseInt(localStorage.getItem(_pgRKey) || '0');
        var _pgRemaining = Math.max(0, interval - (_pgUserRounds - _pgLastRounds));
        var _pgStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
        var _pgLastTo = 0;
        _pgStack.forEach(function(s) { if (!s.deleted && s.to && s.label && s.label.indexOf('群聊') >= 0 && s.label.indexOf('线下群聊') < 0 && s._branchId === _pgBranchId) { if (s.to > _pgLastTo) _pgLastTo = s.to; } });
        var _pgNextFrom = _pgLastTo > 0 ? _pgLastTo + 1 : 1;
        var _pgNextMsg = _pgVisibleMessages[_pgNextFrom - 1];
        var _pgPreview = _pgNextMsg ? cbyd21_UI.getMsgPreview(_pgNextMsg.content).slice(0, 30) : '';
        html += '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px"><span style="flex-shrink:0">💬</span><div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text-secondary)">群聊线上：还差<strong>' + _pgRemaining + '</strong> 轮触发（共' + _pgUserRounds + '轮，间隔' + interval + '）</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">将从第' + _pgNextFrom + '条开始 · ' + escHtml(_pgPreview) + '</div></div></div>';
      }
    }
    if (_pgGrp && autoMods.indexOf('offline') >= 0) {
      var _pgOffBranch = _getCurrentGroupMemoryBranch(charId);
      var _pgOffBranchId = _pgOffBranch ? _pgOffBranch.id : null;
      var _pgOffSessions = _getGroupOfflineSessionsForMemory(charId);
      var _pgOffSession = _pgOffSessions.find(function(s) { return s.status === 'active' && s._branchId === _pgOffBranchId; }) || _pgOffSessions[0];
      if (_pgOffSession) {
        var _pgOffSaveKey = _pgOffSession._activeSaveId || 'current';
        var _pgOffUserRounds = (_pgOffSession.messages || []).filter(function(m) { return m.role === 'user'; }).length;
        var _pgOffRKey = 'stm_lastSummaryRounds_' + charId + '_offline_' + (_pgOffSession.id || '') + '_' + _pgOffSaveKey;
        var _pgOffLastRounds = parseInt(localStorage.getItem(_pgOffRKey) || '0');
        var _pgOffRemaining = Math.max(0, interval - (_pgOffUserRounds - _pgOffLastRounds));
        var _pgOffStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
        var _pgOffLastTo = 0;
        var _pgOffSaveId = _pgOffSession._activeSaveId || null;
        _pgOffStack.forEach(function(s) { if (!s.deleted && s.to && s.label && s.label.indexOf('线下群聊') >= 0 && s._branchId === _pgOffBranchId && s._sessionId === _pgOffSession.id && (_pgOffSaveId ? s._saveId === _pgOffSaveId : !s._saveId)) { if (s.to > _pgOffLastTo) _pgOffLastTo = s.to; } });
        var _pgOffNextFrom = _pgOffLastTo > 0 ? _pgOffLastTo + 1 : 1;
        var _pgOffNextMsg = (_pgOffSession.messages || [])[_pgOffNextFrom - 1];
        var _pgOffPreview = _pgOffNextMsg ? (_pgOffNextMsg.content || '').slice(0, 30) : '';
        html += '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px"><span style="flex-shrink:0">🤝</span><div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text-secondary)">群聊线下：还差<strong>' + _pgOffRemaining + '</strong> 轮触发（共' + _pgOffUserRounds + '轮，间隔' + interval + '）</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">将从第' + _pgOffNextFrom + '条开始 · ' + escHtml(_pgOffPreview) + '</div></div></div>';
      }
    }
    if (!html) { html = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">当前分支暂无活跃的自动总结</div>'; }
    el.innerHTML = '<div style="background:rgba(124,111,155,0.06);border:1px solid rgba(124,111,155,0.12);border-radius:8px;padding:10px 12px;margin-top:8px"><div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">📊 自动总结进度</div>' + html + '</div>';
    return;
  }
  // 线上聊天进度
  if (autoMods.indexOf('online') >= 0) {
    var _branchId = currentChatId;
    var chat = _branchId ? chats.find(function(c) { return c.id === _branchId && c.charId === charId; }) : null;
    if (chat) {
      var _onVisibleMessages = _memoryVisibleSourceMessages(chat.messages || []);
      var userRounds = _onVisibleMessages.filter(function(m) { return m.role === 'user'; }).length;
      var _rKey = 'stm_lastSummaryRounds_' + charId + '_' + (_branchId || '');
      var lastRounds = parseInt(localStorage.getItem(_rKey) || '0');
      var remaining = Math.max(0, interval - (userRounds - lastRounds));
      var totalMsgs = _onVisibleMessages.length;
      var _onProgStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
      var _onLastTo=0;
      _onProgStack.forEach(function(s){if(!s.deleted&&s.to&&s._branchId===_branchId&&s.label&&s.label.indexOf('线上')>=0){if(s.to>_onLastTo)_onLastTo=s.to}});
      var nextFrom = _onLastTo > 0 ? _onLastTo + 1 : 1;
      var nextMsg = _onVisibleMessages[nextFrom - 1];
      var preview = nextMsg ? cbyd21_UI.getMsgPreview(nextMsg.content).slice(0, 30) : '';
      html += '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px"><span style="flex-shrink:0">💬</span><div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text-secondary)">线上：还差 <strong>' + remaining + '</strong> 轮触发（共' + userRounds + '轮，间隔' + interval + '）</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">将从第' + nextFrom + '条开始· ' + escHtml(preview) + '</div></div></div>';
    }
  }
  // 线下进度
  if (autoMods.indexOf('offline') >= 0&& typeof cbyd21_Offline !== 'undefined') {
    var offSessions = cbyd21_Offline._sessions[charId] || [];
    var _savedBranch = currentChatId;
    var activeOff = offSessions.find(function(s) { return s.status === 'active' && s._onlineBranchId === _savedBranch; });
    if (activeOff) {
      var offUserRounds = activeOff.messages.filter(function(m) { return m.role === 'user'; }).length;
      var _offSaveKey = activeOff._activeSaveId || 'current';
      var _offRKey = 'stm_lastSummaryRounds_' + charId + '_offline_' + (activeOff.id || '') + '_' + _offSaveKey;
      var offLastRounds = parseInt(localStorage.getItem(_offRKey) || '0');
      var offRemaining = Math.max(0, interval - (offUserRounds - offLastRounds));
      var offTotal = activeOff.messages.length;
      var _offProgStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
      var _offLastTo=0;
      var _offProgSid=activeOff?activeOff.id:null;
      var _offProgSaveId=activeOff&&activeOff._activeSaveId||null;
      _offProgStack.forEach(function(s){if(!s.deleted&&s.to&&s.label&&s.label.indexOf('线下')>=0&&s._sessionId===_offProgSid&&(_offProgSaveId?s._saveId===_offProgSaveId:!s._saveId)){if(s.to>_offLastTo)_offLastTo=s.to}});
      var offNextFrom = _offLastTo > 0 ? _offLastTo + 1 : 1;
      var offNextMsg = activeOff.messages[offNextFrom - 1];
      var offPreview = offNextMsg ? (offNextMsg.content || '').slice(0, 30) : '';
      html += '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px"><span style="flex-shrink:0">🤝</span><div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text-secondary)">线下：还差 <strong>' + offRemaining + '</strong> 轮触发（共' + offUserRounds + '轮）</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">将从第' + offNextFrom + '条开始 · ' + escHtml(offPreview) + '</div></div></div>';
    }
  }
  if (!html) { html = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">当前分支暂无活跃的自动总结</div>'; }
  el.innerHTML = '<div style="background:rgba(124,111,155,0.06);border:1px solid rgba(124,111,155,0.12);border-radius:8px;padding:10px 12px;margin-top:8px"><div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">📊 自动总结进度</div>' + html + '</div>';
}

// ============================================================
// 数据读取
// ============================================================

// getMemories(charId) → 获取指定角色的所有记忆条目
// · 返回数组，每项 { id, content, type, time, _branchId }
function getMemories(charId) {
  var arr = charMemories[charId] || [];
  return _sortMemoryArrayInPlace(arr);
}

// getMemorySettings(charId) → 获取指定角色的记忆设置
// · 返回 { autoSummary, autoSummaryModules, customPrompt, summaryPrompt, interval }
function getMemorySettings(charId) {
  return charMemorySettings[charId] || { autoSummary: false, customPrompt: '' };
}

// _memoryMatchesOfflineSelection(m, stack, sessionId, saveId) → 判断线下记忆是否属于当前选中的见面/存档
// · sessionId 为空 → 不按见面筛选
// · saveId 为空 → 只按见面筛选，显示该见面下全部记忆
// · saveId === 'current' → 只显示当前进度记忆，也就是没有 _saveId 的记忆
// · saveId 为具体存档ID → 只显示该存档的记忆
function _memoryMatchesOfflineSelection(m, stack, sessionId, saveId) {
  if (!sessionId) return true;

  var stackEntry = stack.find(function(s) { return s.memoryId === m.id; });

  var memSessionId = m._sessionId || stackEntry && stackEntry._sessionId || null;
  if (!memSessionId || memSessionId !== sessionId) return false;

  if (!saveId) return true;

  var memSaveId = m._saveId || stackEntry && stackEntry._saveId || null;

  if (saveId === 'current') {
    return !memSaveId;
  }

  return memSaveId === saveId;
}

// _getGroupMemoryObject(memKey) → 根据 group_记忆key 找到群聊对象
function _getGroupMemoryObject(memKey) {
  if (!memKey || !memKey.startsWith('group_')) return null;
  var gid = memKey.slice(6);
  return cbyd21_Group._groups.find(function(g) { return g.id === gid; }) || null;
}

// _getGroupMemoryScopes(memKey) → 群聊记忆默认只连通线上，不默认连通通话
function _getGroupMemoryScopes(memKey) {
  var group = _getGroupMemoryObject(memKey);
  return group && group._memoryScope || ['online'];
}

// _getCurrentGroupMemoryBranch(memKey) → 获取当前群聊记忆面板选中的分支
function _getCurrentGroupMemoryBranch(memKey) {
  var group = _getGroupMemoryObject(memKey);
  if (!group || !group.branches || group.branches.length === 0) return null;

  if (_currentGroupMemBranchId) {
    var current = group.branches.find(function(b) { return b.id === _currentGroupMemBranchId; });
    if (current) return current;
  }

  if (group._lastBranchId) {
    var last = group.branches.find(function(b) { return b.id === group._lastBranchId; });
    if (last) {
      _currentGroupMemBranchId = last.id;
      return last;
    }
  }

  _currentGroupMemBranchId = group.branches[0].id;
  return group.branches[0];
}

// _getGroupOfflineSessionsForMemory(memKey) → 获取当前群聊记忆分支下的线下见面记录
function _getGroupOfflineSessionsForMemory(memKey) {
  var group = _getGroupMemoryObject(memKey);
  if (!group || !group._offlineSessions) return [];
  var branch = _getCurrentGroupMemoryBranch(memKey);
  var branchId = branch ? branch.id : null;
  return group._offlineSessions.filter(function(s) {
    var hasMessages = s.messages && s.messages.length >= 1;
    var hasSaves = s._saves && s._saves.length > 0;
    return s._branchId === branchId && (hasMessages || hasSaves);
  });
}

// getFilteredMemories(charId, currentScope) → 按连通范围+分支标签过滤记忆
// · 第一步：按连通范围过滤（只返回角色设置里勾选的模块的记忆）
// · 第二步：按分支标签排序
//   - 有 _branchId 的记忆：当前分支优先，其他分支降权（最多2条）
//   - 没有 _branchId 的记忆（旧数据/手写/通话/线下）：视为全局记忆，总是返回
// · 合并顺序：全局 → 其他分支（少量）→ 当前分支（AI最后读到 = 优先级最高）
function getFilteredMemories(charId, currentScope) {
  var all = getMemories(charId);
  if (!all || all.length === 0) return [];
  var ch = getCharById(charId);
  var scopes = ch && ch._memoryScope || ['online', 'call'];

  // 第零步：过滤掉用户手动关闭的条目
  all = all.filter(function(m) { return m.enabled !== false; });

  // 第一步：按连通范围过滤
  var scopeFiltered = all.filter(function(m) {

    var c = m.content || '';
    if (c.startsWith('[线下见面]') || c.startsWith('[线下群聊]')) { return scopes.indexOf('offline') >= 0; }
    if (c.startsWith('[通话]')) { return scopes.indexOf('call') >= 0; }
    return scopes.indexOf('online') >= 0;
  });

  // 第二步：严格按分支隔离
  var activeBranchId = currentChatId || null;
  if (!activeBranchId && charId) {
    var charChats = chats.filter(function(c) { return c.charId === charId; });
    if (charChats.length > 0) activeBranchId = charChats[0].id;
  }

  if (!activeBranchId) return scopeFiltered;

  // 严格隔离：只返回当前分支的记忆
  // 没有 _branchId 的旧记忆只在 shared 连通开启时作为共享记忆读取
  return scopeFiltered.filter(function(m) {
    if (!m._branchId) return scopes.indexOf('shared') >= 0;
    return m._branchId === activeBranchId;
  });
}

// _getBranchMemories(charId) → 获取当前分支可见的记忆
// · 有_branchId 且等于当前分支 → 显示
// · 没有 _branchId（旧数据/通话/线下）→ 全局可见，显示
// · 有 _branchId 但不等于当前分支 → 不显示
function _getBranchMemories(charId) {
  var all = getMemories(charId);
  if (!all || all.length === 0) return [];
  // 群聊记忆：用群聊分支ID
  var branchId = null;
  if (charId && charId.startsWith('group_')) {
    branchId = _currentGroupMemBranchId || null;
    if (!branchId) {
      var _gid = charId.slice(6);
      var _grp = cbyd21_Group._groups.find(function(g) { return g.id === _gid; });
      if (_grp && _grp._lastBranchId) branchId = _grp._lastBranchId;
      else if (_grp && _grp.branches && _grp.branches.length > 0) branchId = _grp.branches[0].id;
    }
  } else {
    branchId = currentChatId || null;
  }
  if (!branchId) return all.filter(function(m) { return !!m._branchId; });
  return all.filter(function(m) {
    if (!m._branchId) return false;
    return m._branchId === branchId;
  });
}

// getSummaryApiConfig() → 获取总结用的API配置
// · 优先使用副API（subUrl/subKey），没配置则跟随主API
function getSummaryApiConfig() {
  if (apiConfig.subUrl && apiConfig.subKey) {
    return {
      url: apiConfig.subUrl,
      key: apiConfig.subKey,
      model: apiConfig.subModel || apiConfig.model,
      temperature: apiConfig.subTemperature !== undefined ? apiConfig.subTemperature : (apiConfig.temperature !== undefined ? apiConfig.temperature : 1)
    };
  }

  return {
    url: apiConfig.url,
    key: apiConfig.key,
    model: apiConfig.model,
    temperature: apiConfig.temperature !== undefined ? apiConfig.temperature : 1
  };
}

// ============================================================
// 记忆连通范围
// ============================================================

// openMemoryScopeMenu() → 打开记忆连通范围选择菜单
// · 复用 addCharModal 弹窗
// · 顶部"全局连通"一键全选/取消
// · 下方逐个模块勾选/取消
// · 勾选后立即保存并刷新界面
function openMemoryScopeMenu() {
  var cid = _memoryCharId || _charInfoCharId || currentChatCharId;
  // 群聊记忆：从群聊对象读写 _memoryScope
  var _isGroupMem = cid && cid.startsWith('group_');
  var ch = null;
  if (_isGroupMem) {
    var _gid = cid.slice(6);
    ch = cbyd21_Group._groups.find(function(g) { return g.id === _gid; });
  } else {
    ch = getCharById(cid);
  }
  if (!ch) return;
  var scopes = ch._memoryScope || (_isGroupMem ? ['online'] : ['online', 'call']);
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var _scopeOpts = _isGroupMem ? _memoryScopeOptions.filter(function(o) { return o.id === 'online' || o.id === 'offline'; }) : _memoryScopeOptions;
  var allIds = _scopeOpts.map(function(o) { return o.id; });
  var isAll = scopes.length === allIds.length;
  var allDiv = document.createElement('div');
  allDiv.className = 'add-char-item';
  allDiv.style.padding = '14px 16px';
  allDiv.innerHTML = '<div style="flex:1"><div style="font-size:14px;color:var(--accent);font-weight:600">全局连通</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">所有模式的记忆互通</div></div><div style="font-size:14px;color:var(--accent)">' + (isAll ? '✓' : '') + '</div>';
  allDiv.onclick = function() {
    if (isAll) { ch._memoryScope = _isGroupMem ? ['online'] : ['online', 'call']; } else { ch._memoryScope = [].concat(allIds); }

    // 群聊数据属于大数据模块。
    // 群聊记忆连通范围变更后，统一走 cbyd21_Group._save()，避免直接写完整 localStorage。
    if (_isGroupMem) {
      if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
        cbyd21_Group._save();
      }
    } else {
      cbyd21_Data.saveCharacters();
    }

    openMemoryScopeMenu();
    updateMemoryScopeLabel(ch);
  };
  container.appendChild(allDiv);
  var sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border-soft);margin:0 16px';
  container.appendChild(sep);
  // 群聊只显示线上和线下两个选项
  _scopeOpts.forEach(function(opt) {
    var checked = scopes.indexOf(opt.id) >= 0;
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML = '<div style="flex:1"><div style="font-size:14px;color:var(--text-primary)">' + opt.name + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + opt.desc + '</div></div><label class="toggle-switch toggle-sm" style="pointer-events:none"><input type="checkbox" ' + (checked ? 'checked' : '') + '><span class="toggle-slider"></span></label>';
    div.onclick = function(e) {
      e.preventDefault();
      var s = (ch._memoryScope || (_isGroupMem ? ['online'] : ['online', 'call'])).slice();
      var idx = s.indexOf(opt.id);
      if (idx >= 0) { s.splice(idx, 1); } else { s.push(opt.id); }
      ch._memoryScope = s;

      // 群聊数据属于大数据模块。
      // 群聊记忆连通范围变更后，统一走 cbyd21_Group._save()，避免直接写完整 localStorage。
      if (_isGroupMem) {
        if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
          cbyd21_Group._save();
        }
      } else {
        cbyd21_Data.saveCharacters();
      }

      openMemoryScopeMenu();
      updateMemoryScopeLabel(ch);
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '记忆连通范围';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// updateMemoryScopeLabel(ch) → 更新弹窗和详情页里的连通范围标签文字
// · 同时更新 #memoryScopeLabel（弹窗）和 #memDetailScopeLabel（详情页）
function updateMemoryScopeLabel(ch) {
  var isGroup = ch && ch.id && String(ch.id).startsWith('group_');
  var scopes = ch._memoryScope || (isGroup ? ['online'] : ['online', 'call']);
  var scopeOptions = isGroup ? _memoryScopeOptions.filter(function(o) { return o.id === 'online' || o.id === 'offline'; }) : _memoryScopeOptions;
  var allIds = scopeOptions.map(function(o) { return o.id; });
  var names = { online: '线上', call: '通话', offline: '线下', shared: '共享' };
  var text;
  if (scopes.length === allIds.length && allIds.every(function(id) { return scopes.indexOf(id) >= 0; })) { text = '全局连通'; }
  else if (scopes.length === 0) { text = '不连通'; }
  else { text = scopes.filter(function(s) { return !isGroup || s === 'online' || s === 'offline'; }).map(function(s) { return names[s] || s; }).join('+'); }
  var el = document.getElementById('memoryScopeLabel');
  if (el) el.textContent = text;
  var el2 = document.getElementById('memDetailScopeLabel');
  if (el2) el2.textContent = text;
}

// ============================================================
// 记忆管理弹窗（角色信息面板入口）
// ============================================================

// openMemoryPanel(charId) → 打开记忆管理弹窗
// · 从角色信息面板点"记忆管理"进入
// · 加载3个自动总结开关 + 总结提示词 + 破限词
// · 兼容旧数据（没有 autoSummaryModules 时按 autoSummary 映射）
// · 渲染记忆条目列表 + 初始化排序功能
function openMemoryPanel(charId) {
  _memoryCharId = charId;
  closeModal('addCharModal');

  var _isGroupMem = charId && charId.startsWith('group_');

  if (!_isGroupMem) {
    // 确保 currentChatId 指向这个角色的分支
    var _mpCharChats = chats.filter(function(c) { return c.charId === charId; });
    if (_mpCharChats.length > 0) {
      var _mpCurrentOk = _mpCharChats.some(function(c) { return c.id === currentChatId; });
      if (!_mpCurrentOk) {
        var _mpLastB = _charLastBranch[charId];
        var _mpFound = _mpLastB ? _mpCharChats.find(function(c) { return c.id === _mpLastB; }) : null;
        currentChatId = _mpFound ? _mpFound.id : _mpCharChats[0].id;
        localStorage.setItem('stm_currentChat', currentChatId);
      }
    }
  }

  var settings = getMemorySettings(charId);
  var autoMods = settings.autoSummaryModules || [];
  if (!settings.autoSummaryModules && settings.autoSummary) { autoMods = ['online', 'call', 'offline']; }
  document.getElementById('memModalAutoOnline').checked = autoMods.indexOf('online') >= 0;
  document.getElementById('memModalAutoCall').checked = autoMods.indexOf('call') >= 0;
  document.getElementById('memModalAutoOffline').checked = autoMods.indexOf('offline') >= 0;
  document.getElementById('memoryCustomPrompt').value = settings.customPrompt || '';
  document.getElementById('memModalSummaryPrompt').value = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  document.getElementById('autoSummaryInterval').value = settings.interval || 20;

  // 群聊：隐藏通话开关和通话筛选Tab
  var _callToggleRow = document.getElementById('memModalAutoCall').closest('.toggle-row');
  if (_callToggleRow) _callToggleRow.style.display = _isGroupMem ? 'none' : '';
  if (_isGroupMem) {
    document.getElementById('memModalAutoCall').checked = false;
  }
  document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) {
    var f = el.dataset.memfilter;
    if (_isGroupMem && f === 'call') { el.style.display = 'none'; }
    else { el.style.display = ''; }
  });

  _memoryFilter = 'all';
  document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === 'all'); });

  // 分支选择器
  if (_isGroupMem) {
    _renderMemoryModalGroupBranchSelector(charId);
  } else {
    _renderMemoryModalBranchSelector(charId);
  }

  // 连通范围标签
  if (_isGroupMem) {
    var _gid2 = charId.slice(6);
    var _grpObj = cbyd21_Group._groups.find(function(g) { return g.id === _gid2; });
    if (_grpObj) updateMemoryScopeLabel(_grpObj);
  } else {
    var _msCh = getCharById(charId);
    if (_msCh) updateMemoryScopeLabel(_msCh);
  }

  cbyd21_UI.renderMemoryList();

  var _memFailToggle=document.getElementById('memModalShowFailToast');
  if(_memFailToggle)_memFailToggle.checked=localStorage.getItem('stm_muteAutoSummaryError')!=='on';

  _renderAutoSummaryProgress(_memoryCharId, 'memModalAutoProgress');

  openModal('memoryModal');
}

// _renderMemoryModalBranchSelector(charId) →在记忆管理弹窗顶部渲染分支选择器
function _renderMemoryModalBranchSelector(charId) {
  var container = document.getElementById('memoryModalBranchSelector');
  if (!container) {
    var modalBody = document.querySelector('#memoryModal .modal-body');
    if (!modalBody) return;
    container = document.createElement('div');
    container.id = 'memoryModalBranchSelector';
    container.style.cssText = 'margin-bottom:12px';
    modalBody.insertBefore(container, modalBody.firstChild);
  }

  var charChats = chats.filter(function(c) { return c.charId === charId; });
  var currentBranch = charChats.find(function(c) { return c.id === currentChatId; });
  var branchName = currentBranch ? _getBranchDisplayName(charId, currentBranch.id) : '未选择分支';
  var branchCount = charChats.length;

  container.innerHTML = '<div onclick="_openMemoryModalBranchMenu()" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background 0.15s"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(branchName) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + branchCount + ' 个分支 ·点击切换</div></div><span style="font-size:12px;color:var(--text-muted)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>';
}

// _openMemoryModalBranchMenu() → 弹窗版分支切换菜单
function _openMemoryModalBranchMenu() {
  var charId = _memoryCharId;
  if (!charId) return;
  var charChats = chats.filter(function(c) { return c.charId === charId; });
  if (charChats.length === 0) { showToast('没有分支'); return; }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  charChats.forEach(function(c) {
        var isCurrent = c.id === currentChatId;
    var msgCount = c.messages.length;
    var lastVisible = msgCount > 0 && cbyd21_UI.getLastVisibleMsgForPreview
      ? cbyd21_UI.getLastVisibleMsgForPreview(c.messages)
      : null;
    var preview = lastVisible ? lastVisible.preview : '空对话';
    var _dn2 = _getBranchDisplayName(charId, c.id);

    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(_dn2) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + msgCount + ' 条消息· ' + escHtml(preview) + '</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');

    div.onclick = function() {
      closeModal('addCharModal');
      // 切换分支（同步线上+线下+记忆）
      currentChatId = c.id;
      localStorage.setItem('stm_currentChat', c.id);
      _charLastBranch[charId] = c.id;

      if(typeof _saveCharLastBranchState === 'function'){
        _saveCharLastBranchState();
      }else{
        localStorage.setItem('stm_charLastBranch', JSON.stringify(_charLastBranch));
      }

      _memoryOfflineSessionId = null;
      _memoryOfflineSaveId = null;

      // 同步线上聊天界面
      if (currentChatCharId === charId) {
        cbyd21_Chat.renderMessages();cbyd21_UI.renderBranchList();
      }

      // 同步线下session
      if (typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline._sessions && cbyd21_Offline._sessions[charId]) {
        var _offSessions = cbyd21_Offline._sessions[charId] || [];
        var _boundOffline = _offSessions.find(function(s) { return s.status === 'active' && s._onlineBranchId === c.id; });
        if (_boundOffline) {
          cbyd21_Offline._sessionId = _boundOffline.id;
          cbyd21_Offline._messages = _boundOffline.messages;}
      }

      // 刷新弹窗里的分支选择器和记忆列表
      _renderMemoryModalBranchSelector(charId);
      cbyd21_UI.renderMemoryList();
      showToast('已切换到：' + _getBranchDisplayName(charId, c.id));
    };

    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '选择分支';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _renderMemoryModalGroupBranchSelector(memKey) → 群聊记忆小面板的分支选择器
function _renderMemoryModalGroupBranchSelector(memKey) {
  var container = document.getElementById('memoryModalBranchSelector');
  if (!container) {
    var modalBody = document.querySelector('#memoryModal .modal-body');
    if (!modalBody) return;
    container = document.createElement('div');
    container.id = 'memoryModalBranchSelector';
    container.style.cssText = 'margin-bottom:12px';
    modalBody.insertBefore(container, modalBody.firstChild);
  }
  var _gid = memKey.slice(6);
  var group = cbyd21_Group._groups.find(function(g) { return g.id === _gid; });
  if (!group || !group.branches || group.branches.length === 0) {
    container.innerHTML = '<div style="padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;font-size:12px;color:var(--text-muted)">群聊暂无分支</div>';
    return;
  }
  // 确定当前分支
  var currentBranch = null;
  if (_currentGroupMemBranchId) {
    currentBranch = group.branches.find(function(b) { return b.id === _currentGroupMemBranchId; });
  }
  if (!currentBranch) {
    var _lastBIdx = group._lastBranchId ? group.branches.findIndex(function(b) { return b.id === group._lastBranchId; }) : -1;
    currentBranch = _lastBIdx >= 0 ? group.branches[_lastBIdx] : group.branches[0];
    _currentGroupMemBranchId = currentBranch ? currentBranch.id : null;
  }
  var branchName = currentBranch ? '分支' + (group.branches.length - group.branches.indexOf(currentBranch)) : '未选择';
  container.innerHTML = '<div onclick="_openMemoryModalGroupBranchMenu(\'' + _gid + '\')" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background0.15s"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(branchName) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + group.branches.length + ' 个分支 ·点击切换</div></div><span style="font-size:12px;color:var(--text-muted)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>';
}

// _openMemoryModalGroupBranchMenu(groupId) → 小面板群聊分支切换菜单
function _openMemoryModalGroupBranchMenu(groupId) {
  var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
  if (!group || !group.branches) return;
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  group.branches.forEach(function(b, i) {
    var isCurrent = b.id === _currentGroupMemBranchId;
    var branchNum = group.branches.length - i;
    var msgCount = b.messages ? b.messages.length : 0;
    var lastVisible = msgCount > 0 && cbyd21_UI.getLastVisibleMsgForPreview
      ? cbyd21_UI.getLastVisibleMsgForPreview(b.messages)
      : null;
    var preview = lastVisible ? lastVisible.preview : '空对话';
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + '">分支' + branchNum + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + msgCount + ' 条消息 · ' + escHtml(preview) + '</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
    div.onclick = function() {
      closeModal('addCharModal');
      _currentGroupMemBranchId = b.id;
      _memoryOfflineSessionId = null;
      _memoryOfflineSaveId = null;
      cbyd21_Group._currentBranchIdx = i;
      cbyd21_Group._messages = b.messages;
      group._lastBranchId = b.id;

      // 群聊分支状态属于 groupChats 大数据。
      // 统一走 cbyd21_Group._save()，避免直接写完整 localStorage。
      if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
        cbyd21_Group._save();
      }

      _renderMemoryModalGroupBranchSelector('group_' + groupId);cbyd21_UI.renderMemoryList();
      showToast('已切换到分支' + branchNum);
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '选择分支';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// saveMemorySettings() → 从弹窗读取3个开关+提示词+破限词，保存到 charMemorySettings
function saveMemorySettings() {
  if (!_memoryCharId) return;
  var autoModules = [];
  var _isGroupMem = _memoryCharId && _memoryCharId.startsWith('group_');
  if (document.getElementById('memModalAutoOnline').checked) autoModules.push('online');
  if (!_isGroupMem && document.getElementById('memModalAutoCall').checked) autoModules.push('call');
  if (document.getElementById('memModalAutoOffline').checked) autoModules.push('offline');
  var _summaryPromptEl = document.getElementById('memModalSummaryPrompt');
  var old = charMemorySettings[_memoryCharId] || {};
  charMemorySettings[_memoryCharId] = {
    autoSummary: autoModules.length > 0,
    autoSummaryModules: autoModules,
    customPrompt: document.getElementById('memoryCustomPrompt').value,
    summaryPrompt: _summaryPromptEl ? _summaryPromptEl.value.trim() || DEFAULT_SUMMARY_PROMPT : old.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
    interval: parseInt(document.getElementById('autoSummaryInterval').value) || 20
  };
  cbyd21_Data.saveMemorySettings();
  showToast('记忆设置已保存');
}

// closeMemoryModal() → 关闭记忆管理弹窗
// · 同时退出排序模式（如果开着的话）
function closeMemoryModal() {
  if (_memoryFilter && _memoryFilter !== 'all') {
    _memoryFilter = 'all';
    _memoryOfflineSessionId = null;
    _memoryOfflineSaveId = null;
    document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) {
      el.classList.toggle('active', el.dataset.memfilter === 'all');
    });
    cbyd21_UI.renderMemoryList();
    return;
  }
  // 恢复群聊模式下隐藏的元素
  var _callToggleRow2 = document.getElementById('memModalAutoCall').closest('.toggle-row');
  if (_callToggleRow2) _callToggleRow2.style.display = '';
  document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) {
    el.style.display = '';
  });
  _currentGroupMemBranchId = null;
  _memoryOfflineSessionId = null;
  _memoryOfflineSaveId = null;
  _memoryBatchDeleteMode = false;
  _memoryBatchSelectedIds = {};

  closeModal('memoryModal');
}

// ============================================================
// 记忆条目列表渲染
// ============================================================

// cbyd21_UI.renderMemoryList() → 渲染弹窗里的记忆条目列表
// · 支持按类型筛选（_memoryFilter）
// · 每项显示：来源图标 + 类型标签 + 时间 + 内容预览（100字）
// · 编辑/删除按钮
cbyd21_UI.renderMemoryList = function() {
  var list = document.getElementById('memoryList');
  var empty = document.getElementById('memoryEmpty');
  var memories = _getBranchMemories(_memoryCharId);
  list.innerHTML = '';

  function _getMemType(c) {
    if (c.startsWith('[通话]')) return'call';
    if (c.startsWith('[线下见面]') || c.startsWith('[线下群聊]')) return 'offline';
    return 'online';
  }

  // "全部"模式：显示分类卡片
  if (!_memoryFilter || _memoryFilter === 'all') {
    if (memories.length === 0) {
      empty.style.display = 'block';
      empty.textContent = '还没有记忆条目';
      return;
    }
    empty.style.display = 'none';
    var counts = { online: 0, call: 0, offline: 0 };
    memories.forEach(function(m) { counts[_getMemType(m.content || '')]++; });
    var _isGroupMemList = _memoryCharId && _memoryCharId.startsWith('group_');
    var ch = _isGroupMemList ? _getGroupMemoryObject(_memoryCharId) : getCharById(_memoryCharId);
    var scopes = ch && ch._memoryScope || (_isGroupMemList ? ['online'] : ['online', 'call']);
    var categories = _isGroupMemList ? [
      { type: 'online', icon: '💬', name: '群聊记忆', desc: '群聊线上产生的记忆' },
      { type: 'offline', icon: '🤝', name: '群聊线下记忆', desc: '群聊线下产生的记忆' }
    ] : [
      { type: 'online', icon: '💬', name: '线上记忆', desc: '线上聊天产生的记忆' },
      { type: 'call', icon: '📞', name: '通话记忆', desc: '语音/视频通话产生的记忆' },
      { type: 'offline', icon: '🤝', name: '线下记忆', desc: '线下见面产生的记忆' }
    ];
    categories.forEach(function(cat) {
      var count = counts[cat.type] || 0;
      var isConnected = scopes.indexOf(cat.type) >= 0;
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background 0.15s;margin-bottom:8px';
      div.innerHTML = '<span style="font-size:22px;flex-shrink:0">' + cat.icon + '</span><div style="flex:1;min-width:0"><div style="font-size:14px;color:var(--text-primary);font-weight:500">' + cat.name + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + (count > 0 ? count + ' 条记忆' : '暂无记忆') + (isConnected ? ' ·<span style="color:var(--accent)">已连通</span>' : ' · <span style="opacity:0.5">未连通</span>') + '</div></div><span style="font-size:12px;color:var(--text-muted);flex-shrink:0"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';
      div.onclick = function() {
        _memoryFilter = cat.type;
        document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === cat.type); });
        cbyd21_UI.renderMemoryList();
      };
      div.addEventListener('touchstart', function() { this.style.background = 'var(--bg-hover)'; }, { passive: true });
      div.addEventListener('touchend', function() { this.style.background = 'var(--bg-card)'; });
      list.appendChild(div);
    });
    return;
  }

  // 筛选模式：显示具体条目
  var filtered = memories.filter(function(m) {
    return _getMemType(m.content || '') === _memoryFilter;
  });
  // 群聊线下筛选：加session+存档选择器
  if (_memoryFilter === 'offline' && _memoryCharId && _memoryCharId.startsWith('group_')) {
    var _gmOffSessions = _getGroupOfflineSessionsForMemory(_memoryCharId);
    if (_gmOffSessions.length > 0) {
      var _gmCurrentOffSid = _memoryOfflineSessionId || null;
      var _gmOffSelLabel = '全部群聊线下记录';
      if (_gmCurrentOffSid) {
        var _gmOffSelIdx = _gmOffSessions.findIndex(function(s) { return s.id === _gmCurrentOffSid; });
        if (_gmOffSelIdx >= 0) _gmOffSelLabel = '第' + (_gmOffSessions.length - _gmOffSelIdx) + '次群聊线下';
      }
      var _gmSaveSelHtml = '';
      if (_memoryOfflineSessionId) {
        var _gmSelSession = _gmOffSessions.find(function(ss) { return ss.id === _memoryOfflineSessionId; });
        if (_gmSelSession && _gmSelSession._saves && _gmSelSession._saves.length > 0) {
          var _gmCurSaveId = _memoryOfflineSaveId || null;
          var _gmSaveLabel = _gmCurSaveId ? '已选存档' : '全部（含存档）';
          if (_gmCurSaveId && _gmCurSaveId !== 'current') {
            var _gmSv = _gmSelSession._saves.find(function(sv) { return sv.id === _gmCurSaveId; });
            if (_gmSv) _gmSaveLabel = '💾 ' + _gmSv.label;
          } else if (_gmCurSaveId === 'current') { _gmSaveLabel = '当前进度'; }
          _gmSaveSelHtml = '<div onclick="_openMemoryGroupOfflineSaveMenu()" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:6px;cursor:pointer;margin-top:6px;font-size:11px"><span style="flex:1;color:var(--text-primary)">' + escHtml(_gmSaveLabel) + '</span><span style="font-size:9px;color:var(--text-muted)">' + _gmSelSession._saves.length + '个存档 ▸</span></div>';
        }
      }
      var _gmOffSelDiv = document.createElement('div');
      _gmOffSelDiv.style.cssText = 'margin-bottom:12px';
      _gmOffSelDiv.innerHTML = '<div onclick="_openMemoryGroupOfflineSessionMenu()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:8px;cursor:pointer;transition:background 0.15s"><span style="font-size:14px;flex-shrink:0">🤝</span><div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text-primary);font-weight:500">' + escHtml(_gmOffSelLabel) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + _gmOffSessions.length + ' 次群聊线下 · 点击筛选</div></div><span style="font-size:10px;color:var(--text-muted)"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>' + _gmSaveSelHtml;
      list.appendChild(_gmOffSelDiv);
      if (_memoryOfflineSessionId) {
        var _gmDetailStack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
        filtered = filtered.filter(function(m) {
          return _memoryMatchesOfflineSelection(m, _gmDetailStack, _memoryOfflineSessionId, _memoryOfflineSaveId);
        });
      }
    }
  }

  // 线下筛选：加session+存档选择器（和大面板一致）
  if (_memoryFilter === 'offline' && _memoryCharId && !_memoryCharId.startsWith('group_')) {
    var _smOffSessions = cbyd21_Offline._sessions[_memoryCharId] || [];
    var _smCurrentBid = currentChatId;
    var _smBranchOffSessions = _smOffSessions.filter(function(s) {
      var hasMessages = s.messages && s.messages.length >= 1;
      var hasSaves = s._saves && s._saves.length > 0;
      return s._onlineBranchId === _smCurrentBid && (hasMessages || hasSaves);
    });
    if (_smBranchOffSessions.length > 0) {
      var _smCurrentOffSid = _memoryOfflineSessionId || null;
      var _smOffSelLabel = '全部线下记录';
      if (_smCurrentOffSid) {
        var _smOffSelIdx = _smBranchOffSessions.findIndex(function(s) { return s.id === _smCurrentOffSid; });
        if (_smOffSelIdx >= 0) _smOffSelLabel = '第' + (_smBranchOffSessions.length - _smOffSelIdx) + '次见面';
      }
      var _smSaveSelHtml = '';
      if (_memoryOfflineSessionId) {
        var _smSelSession = _smBranchOffSessions.find(function(ss) { return ss.id === _memoryOfflineSessionId; });
        if (_smSelSession && _smSelSession._saves && _smSelSession._saves.length > 0) {
          var _smCurSaveId = _memoryOfflineSaveId || null;
          var _smSaveLabel = _smCurSaveId ? '已选存档' : '全部（含存档）';
          if (_smCurSaveId && _smCurSaveId !== 'current') {
            var _smSv = _smSelSession._saves.find(function(sv) { return sv.id === _smCurSaveId; });
            if (_smSv) _smSaveLabel = '💾 ' + _smSv.label;
          } else if (_smCurSaveId === 'current') { _smSaveLabel = '当前进度'; }
          _smSaveSelHtml = '<div onclick="_openMemoryOfflineSaveMenu()" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:6px;cursor:pointer;margin-top:6px;font-size:11px"><span style="flex:1;color:var(--text-primary)">' + escHtml(_smSaveLabel) + '</span><span style="font-size:9px;color:var(--text-muted)">' + _smSelSession._saves.length + '个存档 ▸</span></div>';
        }
      }
      var _smOffSelDiv = document.createElement('div');
      _smOffSelDiv.style.cssText = 'margin-bottom:12px';
      _smOffSelDiv.innerHTML = '<div onclick="_openMemoryOfflineSessionMenu()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:8px;cursor:pointer;transition:background 0.15s"><span style="font-size:14px;flex-shrink:0">🤝</span><div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text-primary);font-weight:500">' + escHtml(_smOffSelLabel) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + _smBranchOffSessions.length + ' 次见面 · 点击筛选</div></div><span style="font-size:10px;color:var(--text-muted)"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>' + _smSaveSelHtml;
      list.appendChild(_smOffSelDiv);
      // 按选中的session / save严格过滤
      if (_memoryOfflineSessionId) {
        var _smDetailStack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
        filtered = filtered.filter(function(m) {
          return _memoryMatchesOfflineSelection(m, _smDetailStack, _memoryOfflineSessionId, _memoryOfflineSaveId);
        });
      }
    }
  }
  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.textContent = '没有该类型的记忆';
    return;
  }

  empty.style.display = 'none';

  if(_memoryBatchDeleteMode){
    list.appendChild(_renderMemoryBatchDeleteBar());
  }

  var allMemories = getMemories(_memoryCharId);
  var _listStack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
  filtered.forEach(function(m) {
    var realIdx = allMemories.indexOf(m);
    var typeLabel = m.type === 'auto' ? '🤖 自动' : m.type === 'manual' ? '✨ AI总结' : '✏️ 手写';
    var c = m.content || '';
    var sourceMap = { online: '💬', call: '📞', offline: '🤝' };
    var sourceLabel = sourceMap[_getMemType(c)] || '💬';
    var _memOn = m.enabled !== false;
    var div = document.createElement('div');
    div.className = 'wb-entry' + (_memOn ? '' : ' wb-disabled');
    var _listEntry = _listStack.find(function(s) { return s.memoryId === m.id; });
    var _listRange = '';
    if (_listEntry && _listEntry.label) { _listRange = ' · ' + _listEntry.label; }
    else if (_listEntry && _listEntry.from && _listEntry.to) { _listRange = ' · 第' + _listEntry.from + '~' + _listEntry.to + '条'; }
    var _moveBtnSm = '';
    var batchChecked = !!_memoryBatchSelectedIds[m.id];

    div.innerHTML =
      (_memoryBatchDeleteMode ? '<input type="checkbox" class="memory-batch-cb" data-memid="' + escHtml(m.id || '') + '" ' + (batchChecked ? 'checked' : '') + ' onclick="event.stopPropagation()" onchange="toggleMemoryBatchSelectById(this.dataset.memid,this.checked)" style="display:block;width:18px;height:18px;accent-color:var(--danger);flex-shrink:0;margin-right:4px">' : '') +
      '<div class="wb-entry-info"><div class="wb-entry-name">' + sourceLabel + ' ' + typeLabel + ' · ' + _memoryFullTime(m) + _listRange + '</div><div class="wb-entry-keys" style="white-space:pre-wrap;margin-top:4px">' + escHtml(c.slice(0, 100)) + (c.length > 100 ? '…' : '') + '</div></div><div class="wb-entry-actions"><label class="toggle-switch toggle-sm"><input type="checkbox" ' + (_memOn ? 'checked' : '') + ' onchange="toggleMemoryEnabled(' + realIdx + ',this.checked)"><span class="toggle-slider"></span></label>' + _moveBtnSm + '<button class="wb-entry-btn" onclick="editMemory(' + realIdx + ')">✏️</button><button class="wb-entry-btn" onclick="deleteMemory(' + realIdx + ')">🗑</button></div>';

    div.onclick = function(ev){
      if(!_memoryBatchDeleteMode)return;
      if(ev.target.closest('.wb-entry-actions') || ev.target.closest('.memory-batch-cb'))return;

      var cb = div.querySelector('.memory-batch-cb');

      if(cb){
        cb.checked = !cb.checked;
        toggleMemoryBatchSelectById(cb.dataset.memid, cb.checked);
      }
    };

    list.appendChild(div);
  });
};

// ============================================================
// 记忆条目操作
// ============================================================

// editMemory(i) → 编辑第i条记忆的内容
// · 打开通用文字输入弹窗
// · 保存后同时刷新弹窗列表和详情页列表
function editMemory(i) {
  var memories = getMemories(_memoryCharId);
  if (!memories[i]) return;
  var _editStack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
  var _editEntry=_editStack.find(function(s){return s.memoryId===memories[i].id});
  var _editInfo = _formatMemoryStackInfo(_memoryCharId, memories[i]);
  var _editHintHtml = _editInfo ? escHtml(_editInfo).replace(/\n/g,'<br>') : '';
  if(_editEntry&&_editEntry.from>0&&_editEntry.to>0){
    _editHintHtml += '<div onclick="_resummarizeMemoryById(\''+_memoryCharId+'\',\''+memories[i].id+'\')" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;padding:5px 10px;border-radius:999px;background:rgba(124,111,155,0.12);border:1px solid rgba(124,111,155,0.2);color:var(--accent);font-size:11px;cursor:pointer">重新总结此范围</div>';
  }
  document.getElementById('textInputTitle').textContent = memories[i]._pendingFill ? '✏️ 手写填入总结' : '✏️ 编辑记忆';
  document.getElementById('textInputHint').innerHTML = _editHintHtml;
  var area = document.getElementById('textInputArea');
  area.placeholder = memories[i]._pendingFill ? '手动写入这段范围的总结内容……' : '记忆内容……';
  area.value = memories[i]._pendingFill ? '' : memories[i].content;
  area.style.height = 'auto';
  _textInputCallback = function(content) {
    if(memories[i]._pendingFill){
      var _pendingPrefix='';
      if((memories[i].content||'').startsWith('[线下群聊] '))_pendingPrefix='[线下群聊] ';
      else if((memories[i].content||'').startsWith('[群聊] '))_pendingPrefix='[群聊] ';
      else if((memories[i].content||'').startsWith('[线下见面] '))_pendingPrefix='[线下见面] ';
      else if((memories[i].content||'').startsWith('[通话] '))_pendingPrefix='[通话] ';
      memories[i].content = _pendingPrefix && content.indexOf(_pendingPrefix)!==0 ? _pendingPrefix + content : content;
      memories[i].enabled = true;
      delete memories[i]._pendingFill;
      if(_editEntry){
        _editEntry.failed = false;
        _editEntry.deleted = false;
        if(_editEntry.label){
          _editEntry.label = _editEntry.label
            .replace(/ · 失败（[^）]*）/g,'')
            .replace(/ · 失败/g,'')
            .replace(/总结失败（[^）]*）/g,'总结')
            .replace(/总结失败/g,'总结');
        }
        localStorage.setItem('stm_summaryStack_'+_memoryCharId,JSON.stringify(_editStack));
      }
    }else{
      memories[i].content = content;
    }
    cbyd21_Data.saveMemories();
    cbyd21_UI.renderMemoryList();
    if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
    _renderAutoSummaryProgress(_memoryCharId, 'memModalAutoProgress');
    _renderAutoSummaryProgress(_memoryCharId, 'memDetailAutoProgress');
    showToast('已更新');
  };
  openModal('textInputModal');
  setTimeout(function() { autoResizeModal(area); area.focus(); }, 100);
}

// deleteMemory(i) → 删除第i条记忆
// · AI总结类记忆：弹出两个选项
//   - "仅删除内容"：记忆条目删除，但栈记录保留（标记deleted=true），用户能看到曾经总结过
//   - "完全删除"：记忆条目+栈记录都删除，视为从未总结过
// · 手写记忆：直接确认删除，不走栈逻辑
// · 底部有注释说明两种方式的区别
async function deleteMemory(i) {
  var memories = charMemories[_memoryCharId];
  if (!memories || !memories[i]) return;
  var mem = memories[i];
  var _stack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
  var _stackEntry = _stack.find(function(s) { return s.memoryId === mem.id; });

  // 只要这条记忆有 summaryStack 栈道，就按“带来源范围的记忆”处理。
  // 包括 AI总结、自动总结、手写绑定范围记忆。
  // 这样删除时不会留下 memoryId 指向不存在记忆的坏栈道。
  var isStackBoundMemory = !!_stackEntry;

  // 带栈道的记忆：弹出选项让用户选择删除方式
  if (isStackBoundMemory) {
    var _rangeText = _stackEntry ? '（第' + _stackEntry.from + '~' + _stackEntry.to + '条）' : '';

    var container = document.getElementById('addCharList');
    container.innerHTML = '';

    // 顶部提示
    var hint = document.createElement('div');
    hint.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
    hint.textContent = '删除这条总结' + _rangeText + '？';
    container.appendChild(hint);

    var items = [
      {
        label: '仅删除内容',
        desc: '记忆内容删掉，但保留总结记录。你能看到这段范围曾经总结过',
        action: function() {
          closeModal('addCharModal');
          memories.splice(i, 1);
          cbyd21_Data.saveMemories();
          // 栈里标记为已删除（保留记录）
          if (_stackEntry) {
            _stackEntry.deleted = true;
            _stackEntry.memoryId = null;
            localStorage.setItem('stm_summaryStack_' + _memoryCharId, JSON.stringify(_stack));
          }
          _updateSummaryPosition(_memoryCharId);
          cbyd21_UI.renderMemoryList();
          if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
          showToast('内容已删除，总结记录已保留');
        }
      },
      {
        label: '完全删除',
        desc: '记忆内容和总结记录都删掉。这段范围视为从未总结过',
        danger: true,
        action: function() {
          closeModal('addCharModal');
          memories.splice(i, 1);
          cbyd21_Data.saveMemories();
          // 从栈里完全移除
          var _newStack = _stack.filter(function(s) { return s.memoryId !== mem.id; });
          localStorage.setItem('stm_summaryStack_' + _memoryCharId, JSON.stringify(_newStack));
          _updateSummaryPosition(_memoryCharId);
          cbyd21_UI.renderMemoryList();
          if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
          showToast('已完全删除');
        }
      }
    ];

    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '14px 16px';
      div.innerHTML = '<div style="flex:1"><div style="font-size:14px;color:' + (item.danger ? 'var(--danger)' : 'var(--text-primary)') + '">' + item.label + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.5">' + item.desc + '</div></div>';
      div.onclick = item.action;
      container.appendChild(div);
    });

    // 取消按钮
    var cancelDiv = document.createElement('div');
    cancelDiv.className = 'add-char-item';
    cancelDiv.style.cssText = 'padding:12px 16px;text-align:center;font-size:13px;color:var(--text-muted);border-top:1px solid var(--border-soft)';
    cancelDiv.textContent = '取消';
    cancelDiv.onclick = function() { closeModal('addCharModal'); };
    container.appendChild(cancelDiv);

    // 底部注释说明两种删除方式的区别
    var noteDiv = document.createElement('div');
    noteDiv.style.cssText = 'padding:10px 16px 14px;font-size:10px;color:var(--text-muted);line-height:1.6;border-top:1px solid var(--border-soft)';
    noteDiv.innerHTML = '💡 <strong>仅删除内容</strong>：记忆文字被删掉，但总结记录保留（在手动总结弹窗里会显示为「已删除」），你能看到这段范围曾经总结过，也可以点击重新总结。<br><strong>完全删除</strong>：记忆文字和总结记录都删掉，这段范围视为从未总结过，手动总结弹窗里不再显示。';
    container.appendChild(noteDiv);

    document.getElementById('addCharModal').querySelector('h3').textContent = '删除总结';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
    return;
  }

  // 非AI总结（手写记忆）：直接确认删除
  var _yes = await customConfirm('确认删除该记忆？');
  if (!_yes) return;
  memories.splice(i, 1);
  cbyd21_Data.saveMemories();
  cbyd21_UI.renderMemoryList();
  if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
  showToast('已删除');
}

// _updateSummaryPosition(charId) → 更新旧版位置key（兼容）
// · 从栈里找到最后一个未删除的条目，用它的 to 值更新旧key
// · 栈空时清除旧key
function _updateSummaryPosition(charId) {
  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var lastActive = null;
  for (var si = stack.length - 1; si >= 0; si--) {
    if (!stack[si].deleted) { lastActive = stack[si]; break; }
  }
  if (lastActive) {
    localStorage.setItem('stm_lastSummaryCount_' + charId, lastActive.to.toString());
  } else {
    localStorage.removeItem('stm_lastSummaryCount_' + charId);
    localStorage.removeItem('stm_lastSummaryRounds_' + charId);
  }
}

// clearAllMemories() → 清空当前角色的所有记忆
// · 同时清空记忆栈和旧版位置key
// · 带确认弹窗
async function clearAllMemories() {
  if (!_memoryCharId) return;
  var branchMemories = _getBranchMemories(_memoryCharId);
  if (branchMemories.length === 0) { showToast('当前分支没有记忆可清空'); return; }
  var _yes = await customConfirm('确认清空当前分支的所有记忆？其他分支的记忆不受影响。');
  if (!_yes) return;
  var branchId = currentChatId || null;
  if (_memoryCharId && _memoryCharId.startsWith('group_')) {
    var _gidClear = _memoryCharId.slice(6);
    var _grpClear = cbyd21_Group._groups.find(function(g) { return g.id === _gidClear; });
    if (_grpClear) {
      branchId = _currentGroupMemBranchId || _grpClear._lastBranchId || (_grpClear.branches && _grpClear.branches[0] ? _grpClear.branches[0].id : null);
    }
  }

  // 只删除当前分支的记忆，保留其他分支和全局记忆
  charMemories[_memoryCharId] = (charMemories[_memoryCharId] || []).filter(function(m) {
    if (!m._branchId) return true;
    return m._branchId !== branchId;
  });
  // 清理当前分支的栈条目
  var _stack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
  _stack = _stack.filter(function(s) {
    if (!s._branchId) return true;
    return s._branchId !== branchId;
  });
  localStorage.setItem('stm_summaryStack_' + _memoryCharId, JSON.stringify(_stack));
  if (branchId) localStorage.removeItem('stm_lastSummaryRounds_' + _memoryCharId + '_' + branchId);
  if (_memoryCharId && _memoryCharId.startsWith('group_')) {
    if (branchId) localStorage.removeItem('stm_lastSummaryRounds_' + _memoryCharId + '_online_' + branchId);
    localStorage.removeItem('stm_lastSummaryRounds_' + _memoryCharId + '_online');
    var _clearGroupRounds = [];
    for (var _gri = 0; _gri < localStorage.length; _gri++) {
      var _grk = localStorage.key(_gri);
      if (_grk && _grk.indexOf('stm_lastSummaryRounds_' + _memoryCharId + '_offline_') === 0) {
        var _gidClearRounds = _memoryCharId.slice(6);
        var _grpClearRounds = cbyd21_Group._groups.find(function(g) { return g.id === _gidClearRounds; });
        if (_grpClearRounds && _grpClearRounds._offlineSessions) {
          var _matchGroupSession = _grpClearRounds._offlineSessions.some(function(s) {
            return s._branchId === branchId && _grk.indexOf('stm_lastSummaryRounds_' + _memoryCharId + '_offline_' + s.id + '_') === 0;
          });
          if (_matchGroupSession) _clearGroupRounds.push(_grk);
        }
      }
    }
    _clearGroupRounds.forEach(function(k) { localStorage.removeItem(k); });
  } else if (_memoryCharId && branchId && typeof cbyd21_Offline !== 'undefined') {
    var _clearOffRounds = [];
    var _clearOffSessions = cbyd21_Offline._sessions[_memoryCharId] || [];
    for (var _ori = 0; _ori < localStorage.length; _ori++) {
      var _ork = localStorage.key(_ori);
      if (_ork && _ork.indexOf('stm_lastSummaryRounds_' + _memoryCharId + '_offline_') === 0) {
        var _matchOffSession = _clearOffSessions.some(function(s) {
          return s._onlineBranchId === branchId && _ork.indexOf('stm_lastSummaryRounds_' + _memoryCharId + '_offline_' + s.id + '_') === 0;
        });
        if (_matchOffSession) _clearOffRounds.push(_ork);
      }
    }
    _clearOffRounds.forEach(function(k) { localStorage.removeItem(k); });

    // 线上内嵌线下自动总结也属于当前分支的线下记忆进度。
    // 清空当前分支记忆时一起重置，避免记忆已清空但自动总结长期不再触发。
    var _clearInlineRounds = [];
    var _inlinePrefix = 'stm_lastSummaryRounds_' + _memoryCharId + '_inline_offline_' + branchId + '_';

    for (var _iori = 0; _iori < localStorage.length; _iori++) {
      var _iork = localStorage.key(_iori);

      if (_iork && _iork.indexOf(_inlinePrefix) === 0) {
        _clearInlineRounds.push(_iork);
      }
    }

    _clearInlineRounds.forEach(function(k) {
      localStorage.removeItem(k);
    });
  }
  cbyd21_Data.saveMemories();
  cbyd21_UI.renderMemoryList();
  if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
  showToast('当前分支记忆已清空');
}


// ============================================================
// 手动总结
// ============================================================
// _openGroupSummaryModal(groupId) →群聊专用手动总结弹窗
// · 读取群聊分支的消息，不走 chats 数组
function _openGroupSummaryModal(groupId) {
  var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
  if (!group) { showToast('找不到群聊'); return; }
  var branch = _getCurrentGroupMemoryBranch('group_' + groupId);
  var visibleGroupMessages = _memoryVisibleSourceMessages(branch && branch.messages ? branch.messages : []);
  if (!branch || !branch.messages || visibleGroupMessages.length < 3) { showToast('当前分支消息太少，至少需要3条'); return; }
  var total = visibleGroupMessages.length;
  var memKey = 'group_' + groupId;
  var settings = getMemorySettings(memKey);

  // 从栈读取上次总结位置
  var _gStackAll = cbyd21_Memory_safeJson('stm_summaryStack_' + memKey, []);
  var _gCurrentBranchId = branch.id || null;
  var _gStack = _gStackAll.filter(function(s) {
    if (!s.label || s.label.indexOf('群聊') < 0) return false;
    if (s.label.indexOf('线下群聊') >= 0) return false;
    return s._branchId === _gCurrentBranchId;
  });
  var lastPos = 0;
  for (var _gsi = _gStack.length - 1; _gsi >= 0; _gsi--) {
    if (!_gStack[_gsi].deleted && _gStack[_gsi].to) { lastPos = _gStack[_gsi].to; break; }
  }

  document.getElementById('summaryTotalMsgs').textContent = total;
  document.getElementById('summaryLastPos').textContent = lastPos || '未总结';
  document.getElementById('summaryFrom').value = lastPos > 0 ? lastPos +1 : 1;
  document.getElementById('summaryTo').value = total;
  document.getElementById('summaryPromptInput').value = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  document.getElementById('summaryCustomPromptInput').value = settings.customPrompt || '';

  // 渲染总结记录
  var recordArea = document.getElementById('summaryRecordArea');
  if (!recordArea) {
    var modalBody = document.querySelector('#summaryModal .modal-body');
    recordArea = document.createElement('div');
    recordArea.id = 'summaryRecordArea';
    recordArea.style.cssText = 'margin-bottom:16px';
    var fromGroup = document.getElementById('summaryFrom').closest('.form-group');
    if (fromGroup) modalBody.insertBefore(recordArea, fromGroup);
    else modalBody.appendChild(recordArea);
  }
  if (_gStack.length > 0) {
    var rHtml = '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">总结记录</div>';
    _gStack.forEach(function(entry) {
      var sc = entry.failed ? 'var(--danger)' : (entry.deleted ? 'var(--danger)' : 'var(--success)');
      var st = entry.failed ? '总结失败' : (entry.deleted ? '已删除' : '有效');
      var bg = entry.failed ? 'rgba(196,92,92,0.1)' : (entry.deleted ? 'rgba(196,92,92,0.06)' : 'rgba(92,160,124,0.06)');
      var rl = entry.label || ('第' + entry.from + '~' + entry.to + '条');
      var _gGlobalIdx = _gStackAll.indexOf(entry);
      var _gCanOpen = entry.memoryId || (entry.from > 0 && entry.to > 0);
      var _gActionLabel = entry.memoryId ? '编辑' : '手写填入';
      var _gRowAction = entry.memoryId ? '_openMemoryFromStack(' + _gGlobalIdx + ',\'' + memKey + '\')' : '_manualFillStackMemory(' + _gGlobalIdx + ',\'' + memKey + '\')';
      rHtml += '<div onclick="' + (_gCanOpen ? _gRowAction : '') + '" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:' + bg +';border:1px solid var(--border-soft);border-radius:8px;margin-bottom:4px;font-size:12px;' + (_gCanOpen ? 'cursor:pointer;transition:background 0.15s' : '') + '"><span style="color:' + (entry.deleted ? 'var(--text-muted)' : 'var(--text-primary)') + ';flex:1">' + rl + '</span><span style="color:' + sc + ';font-size:11px;flex-shrink:0">' + st + '</span>';
      if(_gCanOpen){
        rHtml += '<span style="font-size:10px;color:var(--accent);flex-shrink:0;margin-left:4px">' + _gActionLabel + '</span>';
      }
      if(entry.from > 0 && entry.to > 0){
        rHtml += '<span onclick="event.stopPropagation();_resummarizeFromStack(' + _gGlobalIdx + ')" style="font-size:10px;color:var(--accent);flex-shrink:0;margin-left:4px;cursor:pointer">重新总结</span>';
      }
      rHtml += '</div>';
    });
    recordArea.innerHTML = rHtml;
    recordArea.style.display = 'block';
  } else {
    recordArea.innerHTML = '';recordArea.style.display = 'none';
  }

  // 保存群聊ID供执行总结使用
  window._summaryModalCharId = memKey;
  window._summaryGroupId = groupId;

  openModal('summaryModal');
}

// openSummaryModal() → 打开手动总结配置弹窗
// · 显示总消息数 + 上次总结位置（从栈读取）
// · 自动填入总结范围（上次位置+1 ~ 末尾）
// · 动态渲染"总结记录"区域（绿色=有效，红色=已删除，可点击重新总结）
// · 通话类记录（from=0）不可点击重新总结
function openSummaryModal() {
  var _smCharId = _memoryCharId || currentChatCharId;
  // 确保 currentChatId 指向正确角色的分支
  var chat = chats.find(function(x) { return x.id === currentChatId && x.charId === _smCharId; });
  if (!chat && _smCharId) {
    var _smChats = chats.filter(function(c) { return c.charId === _smCharId; });
    var _smLastB = _charLastBranch[_smCharId];
    chat = (_smLastB ? _smChats.find(function(c) { return c.id === _smLastB; }) : null) || _smChats[0];if (chat) { currentChatId = chat.id; localStorage.setItem('stm_currentChat', currentChatId); }
  }
  var visibleMessages = _memoryVisibleSourceMessages(chat ? chat.messages : []);
  if (!chat || visibleMessages.length < 3) { showToast('当前分支消息太少，至少需要 3 条'); return; }
  var total = visibleMessages.length;
  var charId = _memoryCharId || currentChatCharId;
  var settings = getMemorySettings(charId);

  // 从栈读取最后一个未删除条目的位置（按分支过滤）
  var _stackAll = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var _stack = _stackAll.filter(function(s) {
    if (s._branchId && s._branchId !== currentChatId) return false;
    if (s.label) {
      if (s.label.indexOf('线下') >= 0) return false;
      if (s.label.indexOf('通话') >= 0) return false;
      if (s.label.indexOf('群聊') >= 0) return false;
    }
    return true;
  });
  var lastPos = 0;
  for (var _si = _stack.length - 1; _si >= 0; _si--) {
    if (!_stack[_si].deleted) { lastPos = _stack[_si].to; break; }
  }
  if (!lastPos) lastPos = 0;

  document.getElementById('summaryTotalMsgs').textContent = total;
  document.getElementById('summaryLastPos').textContent = lastPos || '未总结';
  document.getElementById('summaryFrom').value = lastPos > 0 ? lastPos + 1 : 1;
  document.getElementById('summaryTo').value = total;
  document.getElementById('summaryPromptInput').value = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  document.getElementById('summaryCustomPromptInput').value = settings.customPrompt || '';

  // 渲染总结记录区域
  var recordArea = document.getElementById('summaryRecordArea');
  if (!recordArea) {
    var modalBody = document.querySelector('#summaryModal .modal-body');
    recordArea = document.createElement('div');
    recordArea.id = 'summaryRecordArea';
    recordArea.style.cssText = 'margin-bottom:16px';
    var fromGroup = document.getElementById('summaryFrom').closest('.form-group');
    if (fromGroup) modalBody.insertBefore(recordArea, fromGroup);
    else modalBody.appendChild(recordArea);
  }

  if (_stack.length > 0) {
    var recordHtml = '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">总结记录</div>';
    var _stackAllRef = _stackAll;
    _stack.forEach(function(entry, idx) {
      var _globalIdx = _stackAllRef.indexOf(entry);
      var statusColor = entry.failed ? 'var(--danger)' : (entry.deleted ? 'var(--danger)' : 'var(--success)');
      var statusText = entry.failed ? '总结失败' : (entry.deleted ? '已删除' : '有效');
      var bgColor = entry.failed ? 'rgba(196,92,92,0.1)' : (entry.deleted ? 'rgba(196,92,92,0.06)' : 'rgba(92,160,124,0.06)');
      var _rangeLabel = entry.label ? entry.label : ('第' + entry.from + ' ~ ' + entry.to + '条');
      var canOpenStack = (entry.memoryId || (entry.from > 0 && entry.to > 0));
      var actionLabel = entry.memoryId ? '编辑' : '手写填入';
      var rowAction = entry.memoryId ? '_openMemoryFromStack(' + _globalIdx + ',\'' + charId + '\')' : '_manualFillStackMemory(' + _globalIdx + ',\'' + charId + '\')';
      recordHtml += '<div onclick="' + (canOpenStack ? rowAction : '') + '" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:' + bgColor + ';border:1px solid var(--border-soft);border-radius:8px;margin-bottom:4px;font-size:12px;' + (canOpenStack ? 'cursor:pointer;transition:background 0.15s' : '') + '">';
      recordHtml += '<span style="color:' + (entry.deleted ? 'var(--text-muted)' : 'var(--text-primary)') + ';flex:1">' + _rangeLabel + '</span>';
      recordHtml += '<span style="color:' + statusColor + ';font-size:11px;flex-shrink:0">' + statusText + '</span>';
      if (canOpenStack) {
        recordHtml += '<span style="font-size:10px;color:var(--accent);flex-shrink:0;margin-left:4px">' + actionLabel + '</span>';
      }
      if (entry.from > 0 && entry.to > 0) {
        recordHtml += '<span onclick="event.stopPropagation();_resummarizeFromStack(' + _globalIdx + ')" style="font-size:10px;color:var(--accent);flex-shrink:0;margin-left:4px;cursor:pointer">重新总结</span>';
      }
      recordHtml += '</div>';
    });
    recordArea.innerHTML = recordHtml;
    recordArea.style.display = 'block';
  } else {
    recordArea.innerHTML = '';
    recordArea.style.display = 'none';
  }

  // 保存当前charId供重新总结使用
  window._summaryModalCharId = charId;

  openModal('summaryModal');
}

// _deleteFailedStackEntry(idx) →删除总结记录里的失败栈记录
// · 只有failed=true的记录才有✕按钮
// · 删除后这段范围视为从未总结过
// · 不影响自动总结的轮数计数（轮数计数器不回退）
async function _deleteFailedStackEntry(idx, overrideCharId) {
  var charId = overrideCharId || window._summaryModalCharId || _memoryCharId || currentChatCharId;
  if (!charId) return;

  var _stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  if (idx < 0 || idx >= _stack.length) {
    showToast('找不到失败记录');
    return;
  }

  if (!_stack[idx].failed) {
    showToast('只能删除失败记录');
    return;
  }

  var _yes = await customConfirm('删除这条失败记录？\n\n删除后这段范围视为从未总结过。不影响自动总结的轮数计数（不会回退重新总结这段）。');
  if (!_yes) return;

  var _summaryWasOpen = document.getElementById('summaryModal') && document.getElementById('summaryModal').classList.contains('active');
  var _addWasOpen = document.getElementById('addCharModal') && document.getElementById('addCharModal').classList.contains('active');
  var _addTitle = '';
  if (_addWasOpen) {
    var _titleEl = document.getElementById('addCharModal').querySelector('h3');
    _addTitle = _titleEl ? _titleEl.textContent : '';
  }

  _stack.splice(idx, 1);
  localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(_stack));

  if (_summaryWasOpen) {
    closeModal('summaryModal');
    setTimeout(function() {
      if (charId && charId.startsWith('group_')) {
        if (window._summaryGroupId) _openGroupSummaryModal(window._summaryGroupId);
      } else {
        openSummaryModal();
      }
    }, 50);
  }

  if (_addWasOpen) {
    closeModal('addCharModal');
    setTimeout(function() {
      if (_addTitle.indexOf('线下记忆总结') >= 0 && typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline._showManualSummarizePanel) {
        cbyd21_Offline._showManualSummarizePanel();
      }
    }, 50);
  }

  try { cbyd21_UI.renderMemoryList(); } catch(e) {}
  try { if(document.getElementById('memoryDetailPage').classList.contains('active')) renderMemoryDetailList(); } catch(e) {}

  showToast('失败记录已删除');
}

// saveSummaryPromptOnly() →只保存总结提示词和破限词，不执行总结
function saveSummaryPromptOnly() {
  var charId = window._summaryModalCharId || _memoryCharId || currentChatCharId;
  if (!charId) { showToast('找不到角色'); return; }
  var promptText = document.getElementById('summaryPromptInput').value.trim() || DEFAULT_SUMMARY_PROMPT;
  var customPrompt = document.getElementById('summaryCustomPromptInput').value.trim();
  if (!charMemorySettings[charId]) charMemorySettings[charId] = { autoSummary: false, customPrompt: '' };
  charMemorySettings[charId].summaryPrompt = promptText;
  charMemorySettings[charId].customPrompt = customPrompt;
  cbyd21_Data.saveMemorySettings();
  showToast('提示词已保存');
}

// executeSummary() → 执行手动总结
// · 读取范围（from~to）和提示词
// · 调用副API（或主API）生成总结
// · 总结结果存入记忆 + 写入记忆栈
// · 同步更新旧版位置key
async function executeSummary() {
  if (_isSummarizing) { showToast('上一条总结正在生成中，请稍等'); return; }

  if(!_cbyd21MemoryPromptReadyOrToast(false)){
    return;
  }

  var sApi = getSummaryApiConfig();
  if (!sApi.url || !sApi.key || !sApi.model) { showToast('请先配置 API'); return; }
  var charId = window._summaryModalCharId || _memoryCharId || currentChatCharId;
  var _isGroupExec = charId && charId.startsWith('group_');
  var chat = null;
  var _groupExecMsgs = null;
  if (_isGroupExec) {
    var _gid4 = window._summaryGroupId || charId.slice(6);
    var _grp4 = cbyd21_Group._groups.find(function(g) { return g.id === _gid4; });
    var _branch4 = _grp4 ? _getCurrentGroupMemoryBranch('group_' + _gid4) : null;
    if (_branch4) {
      chat = { messages: _branch4.messages, id: _branch4.id };
      _groupExecMsgs = _branch4.messages;
    }
  } else {
    chat = chats.find(function(x) { return x.id === currentChatId; });
  }
  if (!chat) { showToast('找不到对话'); return; }
  var sourceMessages = _memoryVisibleSourceMessages(chat.messages || []);
  var from = parseInt(document.getElementById('summaryFrom').value) || 1;
  var to = parseInt(document.getElementById('summaryTo').value) || sourceMessages.length;
  var promptText = document.getElementById('summaryPromptInput').value.trim() || DEFAULT_SUMMARY_PROMPT;
  if (!charMemorySettings[charId]) charMemorySettings[charId] = { autoSummary: false, customPrompt: '' };
  charMemorySettings[charId].summaryPrompt = promptText;
  var _summaryCustom = document.getElementById('summaryCustomPromptInput').value.trim();
  charMemorySettings[charId].customPrompt = _summaryCustom;
  cbyd21_Data.saveMemorySettings();
  from = Math.max(1, Math.min(sourceMessages.length, from));
  to = Math.max(1, Math.min(sourceMessages.length, to));
  if (from > to) {
    var _sumTmp = from;
    from = to;
    to = _sumTmp;
  }

  var slice = sourceMessages.slice(from - 1, to);
  if (slice.length < 2) { showToast('选中的消息太少'); _isSummarizing = false; return; }
  closeModal('summaryModal');
  _isSummarizing = true;
  showToast('正在总结……');
  try {
    // 过滤掉通话记录和线下记录（它们有独立的总结流程）
    var sourceTextMsgs = slice.filter(function(m) {
      var c = m.content || '';
      return !c.startsWith('__call__') && !c.startsWith('__offline_record__') && c !== '__system_init__' && c !== '__system_continue__';
    });

    if (sourceTextMsgs.length === 0) {
      showToast('这个范围主要是通话/线下记录卡片，请到对应入口总结');
      _isSummarizing = false;
      return;
    }

    var msgs = sourceTextMsgs.map(function(m) {
      var c = _cbyd21MemoryCleanContent(m.content);
      return (m.role === 'user' ? 'User' : 'Char') + ': ' + c.slice(0, 200);
    }).join('\n');

    if (!msgs.trim()) {
      showToast('没有可总结的文字内容');
      _isSummarizing = false;
      return;
    }
    var _execCustom = document.getElementById('summaryCustomPromptInput').value.trim();
    var _sysPrompt = promptText + (_execCustom ? '\n\n' + _execCustom : '');
    var url = sApi.url.replace(/\/+$/, '') + '/chat/completions';
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sApi.key };
    var body = {
      model: sApi.model,
      messages: [{ role: 'system', content: _sysPrompt }, { role: 'user', content: '请总结以下对话记录：\n\n' + msgs }]
    };

    if(sApi.temperature !== undefined){
      body.temperature = sApi.temperature;
    }
    var r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    var _rawSummaryText = await r.text();

    if (!r.ok) {
      throw new Error('HTTP ' + r.status + ': ' + _rawSummaryText.slice(0, 300));
    }

    var _parsedSummaryText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawSummaryText)
      : {data:null,text:_rawSummaryText};

    var d = _parsedSummaryText.data || {};
    var summary = _parsedSummaryText.text || _extractApiContent(d);

    if (!summary) { showToast('总结失败'); _isSummarizing = false; return; }
    if (!charMemories[charId]) charMemories[charId] = [];
    var _execBranchId = _isGroupExec ? (chat.id || null) : (currentChatId || null);
    var _execPrefix = _isGroupExec ? '[群聊] ' : '';
    var _execSourceTs = _getSourceTsFromMessages(sourceMessages, from, to);

    var _newMemEntry = {
      id: Date.now().toString(),
      content: _execPrefix + summary.trim(),
      type: 'manual',
      time: formatTime(Date.now()),
      _branchId: _execBranchId,
      _sourceTs: _execSourceTs,
      _sourceSeq: to,
      _sourceType: _isGroupExec ? 'group_online' : 'online'
    };

    charMemories[charId].push(_newMemEntry);
    _sortMemoryArrayInPlace(charMemories[charId]);
    // 写入记忆栈
    var _fullStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
    var _execLabel = _isGroupExec ? '群聊总结 · 第' + from + '~' + to + '条' : '线上总结 · 第' + from + '~' + to + '条';
    _fullStack.push({
      memoryId: _newMemEntry.id,
      from: from,
      to: to,
      deleted: false,
      label: _execLabel,
      _branchId: _execBranchId,
      _sourceTs: _execSourceTs,
      _sourceSeq: to,
      _sourceType: _isGroupExec ? 'group_online' : 'online'
    });
    localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(_fullStack));
    cbyd21_Data.saveMemories();
    // 手动总结后重置自动总结的轮数计数，从当前轮数重新开始计算
    var _manualChat = _isGroupExec ? chat : chats.find(function(x) { return x.id === currentChatId; });
    if (_manualChat && _manualChat.messages) {
      var _manualUserRounds = _manualChat.messages.filter(function(m) {
        return m &&
          m._mode !== 'ooc' &&
          m._mode !== 'inline_offline' &&
          m.role === 'user' &&
          m.content !== '__system_init__' &&
          m.content !== '__system_continue__';
      }).length;
      var _manualRoundsKey = _isGroupExec ? ('stm_lastSummaryRounds_' + charId + '_online_' + (_execBranchId || '')) : ('stm_lastSummaryRounds_' + charId + '_' + (currentChatId || ''));
      localStorage.setItem(_manualRoundsKey, _manualUserRounds.toString());
    }
    cbyd21_UI.renderMemoryList();
    if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
    _refreshMemoryListsIfVisible();
    showToast('记忆总结完成（第' + from + '~' + to + '条）');
    _renderAutoSummaryProgress(charId, 'memModalAutoProgress');
    _renderAutoSummaryProgress(charId, 'memDetailAutoProgress');
  } catch (e) {
    showApiError('记忆总结失败：' + (e.message || ''));
  }
  _isSummarizing = false;
}

// ============================================================
// 自动总结
// ============================================================
// _pushCallAutoSummaryFailedStack(charId, callLog, branchId, reason)
// → 通话自动总结触发后，如果因为忙碌 / API 未配置 / HTTP失败 / 返回空等原因失败，
//   写入 failed 空栈道，避免用户完全不知道这次通话没有总结成功。
//   通话没有普通 from/to 消息序号，所以仍沿用 from:0 / to:0，并用 _sourceTs 排序。
function _pushCallAutoSummaryFailedStack(charId, callLog, branchId, reason, skipToast) {
  if (!charId) return;

  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var sourceTs = callLog && (callLog._sourceTs || callLog.endTime || callLog.created) || Date.now();

  stack.push({
    memoryId: null,
    from: 0,
    to: 0,
    deleted: false,
    failed: true,
    label: '通话自动总结 · 失败（' + reason + '）',
    _branchId: branchId || callLog && callLog._branchId || currentChatId || null,
    _sourceTs: sourceTs,
    _sourceSeq: 0,
    _sourceType: 'call',
    _failReason: reason
  });

  localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(stack));

  if (!skipToast && typeof showAutoSummaryError === 'function') {
    showAutoSummaryError('通话自动总结未完成：' + reason);
  }

  _refreshMemoryListsIfVisible();
  _renderAutoSummaryProgress(charId, 'memModalAutoProgress');
  _renderAutoSummaryProgress(charId, 'memDetailAutoProgress');
}

// _pushOnlineAutoSummaryFailedStack(charId, branchId, visibleMessages, reason)
// → 线上自动总结触发后，如果因为忙碌 / API 未配置 / 消息不足等原因没有真正启动，
//   也写入一条 failed 空栈道。
//   这样用户之后能在总结记录里看到这段范围，并可手写填入或重新总结。
function _pushOnlineAutoSummaryFailedStack(charId, branchId, visibleMessages, reason, skipToast) {
  if (!charId) return;

  visibleMessages = visibleMessages || [];

  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var lastTo = 0;

  stack.forEach(function(s) {
    if (
      !s.deleted &&
      s.to &&
      (!s._branchId || s._branchId === branchId) &&
      s.label &&
      s.label.indexOf('线上') >= 0
    ) {
      if (s.to > lastTo) lastTo = s.to;
    }
  });

  var from = lastTo > 0 ? lastTo + 1 : 1;
  var to = visibleMessages.length;

  if (to < from) to = from;

  var sourceTs = visibleMessages.length
    ? _getSourceTsFromMessages(visibleMessages, from, Math.min(to, visibleMessages.length))
    : Date.now();

  stack.push({
    memoryId: null,
    from: from,
    to: to,
    deleted: false,
    failed: true,
    label: '线上自动总结 · 第' + from + '~' + to + '条 · 失败（' + reason + '）',
    _branchId: branchId || null,
    _sourceTs: sourceTs,
    _sourceSeq: to,
    _sourceType: 'online',
    _failReason: reason
  });

  localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(stack));

  if (!skipToast && typeof showAutoSummaryError === 'function') {
    showAutoSummaryError('线上自动总结未完成：' + reason);
  }

  _refreshMemoryListsIfVisible();
  _renderAutoSummaryProgress(charId, 'memModalAutoProgress');
  _renderAutoSummaryProgress(charId, 'memDetailAutoProgress');
}

// checkAutoSummary(charId) → 检查是否需要自动总结（每次AI回复后调用）
// · 只在 autoSummaryModules 包含 'online' 时触发
// · 按用户消息轮数计算，达到间隔（默认20轮）时触发
// · 触发后更新轮数记录，调用 autoSummarizeInternal
function checkAutoSummary(charId) {
  var settings = getMemorySettings(charId);
  if (!settings.autoSummary) return;
  var _asMods = settings.autoSummaryModules || [];
  if (!settings.autoSummaryModules && settings.autoSummary) { _asMods = ['online', 'call', 'offline']; }
  if (_asMods.indexOf('online') < 0) return;
  // 锁定当前分支ID，防止异步过程中用户切换分支导致写入错误分支
  var _lockedBranchId = currentChatId;
  var chat = chats.find(function(x) { return x.id === _lockedBranchId; });
  if (!chat) return;
  var userMsgCount = chat.messages.filter(function(m) {
    return m &&
      m._mode !== 'ooc' &&
      m._mode !== 'inline_offline' &&
      m.role === 'user' &&
      m.content !== '__system_init__' &&
      m.content !== '__system_continue__';
  }).length;
  var currentRounds = userMsgCount;
  var _branchRoundsKey = 'stm_lastSummaryRounds_' + charId + '_' + (_lockedBranchId || '');
  var lastSummaryRounds = parseInt(localStorage.getItem(_branchRoundsKey) || '0');
  var interval = settings.interval || 20;
  if (currentRounds - lastSummaryRounds >= interval) {
    if(!_cbyd21MemoryPromptReadyOrToast(true)){
      return;
    }

    var _autoVisibleMessages = _memoryVisibleSourceMessages(chat.messages || []);

    if (_isSummarizing) {
      localStorage.setItem(_branchRoundsKey, currentRounds.toString());
      _pushOnlineAutoSummaryFailedStack(charId, _lockedBranchId, _autoVisibleMessages, '已有一条总结正在生成');
      return;
    }

    var _autoSummaryApi = getSummaryApiConfig();

    if (!_autoSummaryApi.url || !_autoSummaryApi.key || !_autoSummaryApi.model) {
      localStorage.setItem(_branchRoundsKey, currentRounds.toString());
      _pushOnlineAutoSummaryFailedStack(charId, _lockedBranchId, _autoVisibleMessages, '未配置总结 API');
      return;
    }

    if (_autoVisibleMessages.length < 3) {
      localStorage.setItem(_branchRoundsKey, currentRounds.toString());
      _pushOnlineAutoSummaryFailedStack(charId, _lockedBranchId, _autoVisibleMessages, '当前分支消息太少，自动总结未启动');
      return;
    }

    localStorage.setItem(_branchRoundsKey, currentRounds.toString());
    _memoryCharId = charId;
    autoSummarizeInternal(charId, _lockedBranchId).then(function() { _memoryCharId = null; });
  }
}

// autoSummarizeInternal(charId) → 自动总结最近30条消息
// · 使用总结提示词 + 破限词
// · 总结结果标记 type:'auto'
// · 写入记忆栈（from=倒数30条的起始位置, to=末尾）
async function autoSummarizeInternal(charId, _lockedBranchId) {
  if (_isSummarizing) return;

  if(!_cbyd21MemoryPromptReadyOrToast(true)){
    return;
  }

  var sApi = getSummaryApiConfig();
  if (!sApi.url || !sApi.key || !sApi.model) return;
  // 使用锁定的分支ID，不依赖全局 currentChatId
  var _branchId = _lockedBranchId || currentChatId;
  var chat = chats.find(function(x) { return x.id === _branchId; });
  var visibleAutoMessages = _memoryVisibleSourceMessages(chat ? chat.messages : []);
  if (!chat || visibleAutoMessages.length < 3) return;
  var settings = getMemorySettings(charId);
  var promptText = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  // 读栈找到上次总结的结束位置，从那里开始（不重复总结）
  var _onAutoStack2 = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var _onLastTo2=0;
  _onAutoStack2.forEach(function(s){if(!s.deleted&&s.to&&(!s._branchId||s._branchId===_branchId)&&s.label&&s.label.indexOf('线上')>=0){if(s.to>_onLastTo2)_onLastTo2=s.to}});
  var _onSliceFrom=_onLastTo2>0?_onLastTo2:0;
  var msgs = visibleAutoMessages.slice(_onSliceFrom).filter(function(m) {
    var c = m.content || '';
    return !c.startsWith('__call__') && !c.startsWith('__offline_record__');
  }).map(function(m) {
    var c = _cbyd21MemoryCleanContent(m.content);
    return (m.role === 'user' ? 'User' : 'Char') + ': ' + c.slice(0, 200);
  }).join('\n');
  try {
    var url = sApi.url.replace(/\/+$/, '') + '/chat/completions';
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sApi.key };
    var _autoSysPrompt = promptText + (settings.customPrompt && settings.customPrompt.trim() ? '\n\n' + settings.customPrompt.trim() : '');
    _isSummarizing = true;
    var body = {
      model: sApi.model,
      messages: [{ role: 'system', content: _autoSysPrompt }, { role: 'user', content: '请总结以下对话记录：\n\n' + msgs }]
    };

    if(sApi.temperature !== undefined){
      body.temperature = sApi.temperature;
    }

    var r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    var _rawAutoSummaryText = await r.text();

    if (!r.ok) {
      _pushOnlineAutoSummaryFailedStack(
        charId,
        _branchId,
        visibleAutoMessages,
        'HTTP ' + r.status,
        true
      );

      showAutoSummaryError('HTTP '+r.status+': '+_rawAutoSummaryText.slice(0,200));
      _isSummarizing=false;
      return;
    }

    var _parsedAutoSummaryText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawAutoSummaryText)
      : {data:null,text:_rawAutoSummaryText};

    var d = _parsedAutoSummaryText.data || {};
    var summary = _parsedAutoSummaryText.text || _extractApiContent(d);

    if (!summary) {
      _pushOnlineAutoSummaryFailedStack(
        charId,
        _branchId,
        visibleAutoMessages,
        'API返回空内容',
        true
      );

      showAutoSummaryError('总结API返回空内容');
      _isSummarizing = false;
      return;
    }
    if (!charMemories[charId]) charMemories[charId] = [];

    var _autoFrom = _onSliceFrom + 1;
    var _autoTo = visibleAutoMessages.length;
    var _autoSourceTs = _getSourceTsFromMessages(visibleAutoMessages, _autoFrom, _autoTo);

    var _autoMemEntry = {
      id: Date.now().toString(),
      content: summary.trim(),
      type: 'auto',
      time: formatTime(Date.now()),
      _branchId: _branchId || null,
      _sourceTs: _autoSourceTs,
      _sourceSeq: _autoTo,
      _sourceType: 'online'
    };

    charMemories[charId].push(_autoMemEntry);
    _sortMemoryArrayInPlace(charMemories[charId]);
    // 写入记忆栈
    var _autoStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
    _autoStack.push({
      memoryId: _autoMemEntry.id,
      from: _autoFrom,
      to: _autoTo,
      deleted: false,
      label: '线上自动总结 · 第' + _autoFrom + '~' + _autoTo + '条',
      _branchId: _branchId || null,
      _sourceTs: _autoSourceTs,
      _sourceSeq: _autoTo,
      _sourceType: 'online'
    });
    localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(_autoStack));
    cbyd21_Data.saveMemories();
    _refreshMemoryListsIfVisible();
    showToast('自动总结完成');
      _renderAutoSummaryProgress(charId,'memModalAutoProgress');_renderAutoSummaryProgress(charId,'memDetailAutoProgress');

  } catch (e) {
    _pushOnlineAutoSummaryFailedStack(
      charId,
      _branchId,
      visibleAutoMessages || [],
      e && e.message ? e.message : '未知错误',
      true
    );

    showAutoSummaryError(e.message||'');
  }

  _isSummarizing = false;
}

// ============================================================
// 通话记忆总结
// ============================================================

// _autoSummarizeCall(charId, callLog) → 通话结束后自动总结
// · 只在 autoSummaryModules 包含 'call' 时触发
// · 通话消息≥4条才触发
// · 总结结果前缀 [通话]，标记 type:'auto'
// · 写入记忆栈（from:0, to:0, label:'通话总结'）
async function _autoSummarizeCall(charId, callLog, _lockedBranchId) {
  if(!_cbyd21MemoryPromptReadyOrToast(true)){
    return;
  }

  if (!charId || !callLog || !callLog.messages || callLog.messages.length < 4) return;
  var ch = getCharById(charId);
  if (!ch) return;
  var settings = getMemorySettings(charId);
  if (!settings.autoSummary) return;
  var _asMods2 = settings.autoSummaryModules || [];
  if (!settings.autoSummaryModules && settings.autoSummary) { _asMods2 = ['online', 'call', 'offline']; }
  if (_asMods2.indexOf('call') < 0) return;
  var sApi = getSummaryApiConfig();

  if (!sApi.url || !sApi.key || !sApi.model) {
    _pushCallAutoSummaryFailedStack(charId, callLog, _lockedBranchId || callLog._branchId || currentChatId || null, '未配置总结 API');
    return;
  }

  if (_isSummarizing) {
    _pushCallAutoSummaryFailedStack(charId, callLog, _lockedBranchId || callLog._branchId || currentChatId || null, '已有一条总结正在生成');
    return;
  }

  _isSummarizing = true;

  var promptText = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  var msgs = callLog.messages.map(function(m) {
    var c = _cbyd21MemoryCleanContent(m.content);
    return (m.role === 'user' ? '用户' : '角色') + ': ' + c.slice(0, 200);
  }).join('\n');
  var duration = callLog.duration || 0;
  var min = Math.floor(duration / 60);
  var sec = duration % 60;
  var customHint = settings.customPrompt && settings.customPrompt.trim() ? '\n\n[总结辅助提示词]\n' + settings.customPrompt.trim() : '';
  try {
    var url = sApi.url.replace(/\/+$/, '') + '/chat/completions';
    var _callSys = '[通话记录总结]\n这是一段语音通话记录，时长' + min + '分' + sec + '秒。\n' + promptText + customHint;
    var _callSummaryBody = {
      model:sApi.model,
      messages:[
        { role:'system', content:_callSys },
        { role:'user', content:'请总结以下通话记录：\n\n' + msgs }
      ]
    };

    if(sApi.temperature !== undefined){
      _callSummaryBody.temperature = sApi.temperature;
    }

    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sApi.key }, body: JSON.stringify(_callSummaryBody) });
    var _rawCallSummaryText = await r.text();

    if (!r.ok) {
      _pushCallAutoSummaryFailedStack(
        charId,
        callLog,
        _lockedBranchId || callLog._branchId || currentChatId || null,
        'HTTP ' + r.status,
        true
      );

      showAutoSummaryError('通话总结HTTP ' + r.status + ': ' + _rawCallSummaryText.slice(0,200));
      _isSummarizing = false;
      return;
    }

    var _parsedCallSummaryText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawCallSummaryText)
      : {data:null,text:_rawCallSummaryText};

    var d = _parsedCallSummaryText.data || {};
    var summary = _parsedCallSummaryText.text || _extractApiContent(d);

    if (!summary.trim()) {
      _pushCallAutoSummaryFailedStack(
        charId,
        callLog,
        _lockedBranchId || callLog._branchId || currentChatId || null,
        'API返回空内容',
        true
      );

      showAutoSummaryError('通话总结API返回空内容');
      _isSummarizing = false;
      return;
    }

    if (!charMemories[charId]) charMemories[charId] = [];

    var _callSourceTs = callLog._sourceTs || callLog.endTime || callLog.created || Date.now();

    var _callMemEntry = {
      id: Date.now().toString(),
      content: '[通话] ' + summary.trim(),
      type: 'auto',
      time: formatTime(Date.now()),
      _branchId: _lockedBranchId || callLog._branchId || currentChatId || null,
      _sourceTs: _callSourceTs,
      _sourceSeq: 0,
      _sourceType: 'call'
    };

    charMemories[charId].push(_callMemEntry);
    _sortMemoryArrayInPlace(charMemories[charId]);
    // 写入记忆栈（通话没有消息序号，用0标记，加label区分）
    var _callStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
    _callStack.push({
      memoryId: _callMemEntry.id,
      from: 0,
      to: 0,
      deleted: false,
      label: '通话总结',
      _branchId: _lockedBranchId || callLog._branchId || currentChatId || null,
      _sourceTs: _callSourceTs,
      _sourceSeq: 0,
      _sourceType: 'call'
    });
    localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(_callStack));
    cbyd21_Data.saveMemories();
    _refreshMemoryListsIfVisible();
    showToast('通话记忆已总结');
      _renderAutoSummaryProgress(charId,'memModalAutoProgress');_renderAutoSummaryProgress(charId,'memDetailAutoProgress');

  } catch (e) {
    _pushCallAutoSummaryFailedStack(
      charId,
      callLog,
      _lockedBranchId || callLog._branchId || currentChatId || null,
      e && e.message ? e.message : '未知错误',
      true
    );

    showAutoSummaryError('通话自动总结失败：' + (e.message || ''));
  }

  _isSummarizing = false;
}

// manualSummarizeCall(charId) → 手动总结通话记录
// · 先扫描所有分支找出全部通话记录
// · 只有一条→直接总结
// · 多条→弹出列表让用户选
function manualSummarizeCall(charId) {
  if(!_cbyd21MemoryPromptReadyOrToast(false)){
    return;
  }

  if (!charId) return;
  var sApi = getSummaryApiConfig();
  if (!sApi.url || !sApi.key || !sApi.model) { showToast('请先配置API'); return; }

  // 收集所有通话记录
  var charChats = chats.filter(function(c) { return c.charId === charId; });
  var allCalls = [];
  charChats.forEach(function(chat) {
    chat.messages.forEach(function(m, mi) {
      if (m.content && m.content.startsWith('__call__')) {
        try {
          var callData = JSON.parse(m.content.slice(8));
          if (callData.messages && callData.messages.length >= 2) {
            allCalls.push({
              data: callData,
              time: m.time || '',
              branchTitle: chat.title,
              branchId: chat.id,
              msgIdx: mi,
              sourceTs: m._ts || callData._sourceTs || Date.now()
            });
          }
        } catch (e) {}
      }
    });
  });

  if (allCalls.length === 0) { showToast('找不到通话记录'); return; }

  // 弹出列表让用户选
  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var hint = document.createElement('div');
  hint.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
  hint.textContent = '选择要总结的通话记录（共' + allCalls.length + '次）';
  container.appendChild(hint);

  allCalls.forEach(function(call, idx) {
    var duration = call.data.duration || 0;
    var min = Math.floor(duration / 60).toString().padStart(2, '0');
    var sec = (duration % 60).toString().padStart(2, '0');
    var msgCount = call.data.messages.length;
    // 取通话的前两句话作为预览
    var preview = call.data.messages.slice(0, 2).map(function(m) {
      var role = m.role === 'user' ? '我' : '角色';
      var text = (m.content || '').replace(/__bilingual_split__[\s\S]*/, '').slice(0, 30);
      return role + ': ' + text;
    }).join(' → ');

    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>' +
      '<span style="font-size:14px;color:var(--text-primary)">' + min + ':' + sec + '</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' + msgCount + '条对话</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(preview) + '</div>' +
      '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + escHtml(call.branchTitle) + ' · ' + call.time + '</div>' +
      '</div>';
    div.onclick = function() {
      closeModal('addCharModal');
      _doSummarizeCall(charId, call);
    };
    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '📞 选择通话记录';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _doSummarizeCall(charId, callInfo) → 执行通话总结
// · callInfo: { data: 通话数据, time, branchTitle, branchId }
async function _doSummarizeCall(charId, callInfo) {
  if (_isSummarizing) { showToast('上一条总结正在生成中，请稍等'); return; }

  if(!_cbyd21MemoryPromptReadyOrToast(false)){
    return;
  }

  _isSummarizing = true;
  var callLog = callInfo.data;
  var settings = getMemorySettings(charId);
  var promptText = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  var callMsgs = callLog.messages.map(function(m) {
    var c = _cbyd21MemoryCleanContent(m.content);
    return (m.role === 'user' ? '用户' : '角色') + ': ' + c.slice(0, 200);
  }).join('\n');
  var duration = callLog.duration || 0;
  var min = Math.floor(duration / 60);
  var sec = duration % 60;
  var customHint = settings.customPrompt && settings.customPrompt.trim() ? '\n\n[总结辅助提示词]\n' + settings.customPrompt.trim() : '';
  var sApi = getSummaryApiConfig();
  showToast('正在总结通话记忆…');
  try {
    var url = sApi.url.replace(/\/+$/, '') + '/chat/completions';
    var _mcallSys = '[通话记录总结]\n这是一段语音通话记录，时长' + min + '分' + sec + '秒。\n' + promptText + customHint;
    var _manualCallSummaryBody = {
      model:sApi.model,
      messages:[
        { role:'system', content:_mcallSys },
        { role:'user', content:'请总结以下通话记录：\n\n' + callMsgs }
      ]
    };

    if(sApi.temperature !== undefined){
      _manualCallSummaryBody.temperature = sApi.temperature;
    }

    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sApi.key }, body: JSON.stringify(_manualCallSummaryBody) });
    var _rawManualCallSummaryText = await r.text();

    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + _rawManualCallSummaryText.slice(0, 300));

    var _parsedManualCallSummaryText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawManualCallSummaryText)
      : {data:null,text:_rawManualCallSummaryText};

    var d = _parsedManualCallSummaryText.data || {};
    var summary = _parsedManualCallSummaryText.text || _extractApiContent(d);

    if (!summary.trim()) { showToast('总结失败'); _isSummarizing = false; return; }
    if (!charMemories[charId]) charMemories[charId] = [];

    var _mcallSourceTs = callInfo.sourceTs || callLog._sourceTs || Date.now();

    var _mcallMemEntry = {
      id: Date.now().toString(),
      content: '[通话] ' + summary.trim(),
      type: 'manual',
      time: formatTime(Date.now()),
      _branchId: callInfo.branchId || currentChatId || null,
      _sourceTs: _mcallSourceTs,
      _sourceSeq: 0,
      _sourceType: 'call'
    };

    charMemories[charId].push(_mcallMemEntry);
    _sortMemoryArrayInPlace(charMemories[charId]);
    var _mcallStack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
    _mcallStack.push({
      memoryId: _mcallMemEntry.id,
      from: 0,
      to: 0,
      deleted: false,
      label: '通话总结 · ' + min + '分' + sec + '秒',
      _branchId: callInfo.branchId || currentChatId || null,
      _sourceTs: _mcallSourceTs,
      _sourceSeq: 0,
      _sourceType: 'call'
    });
    localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(_mcallStack));
    cbyd21_Data.saveMemories();
    _refreshMemoryListsIfVisible();
      showToast('通话记忆总结完成');
      _renderAutoSummaryProgress(charId, 'memModalAutoProgress');
      _renderAutoSummaryProgress(charId, 'memDetailAutoProgress');
    } catch (e) { showApiError('通话总结失败：' + (e.message || '')); }
    _isSummarizing = false;
}

// ============================================================
// 记忆中心 — 角色列表
// ============================================================

// cbyd21_UI.renderMemoryAppCharList() → 渲染记忆中心的角色列表
// · 每个角色显示：头像、名字、各类型记忆数量
// · 点击进入该角色的记忆详情页
cbyd21_UI.renderMemoryAppCharList = function() {
  var container = document.getElementById('memoryAppCharList');
  var empty = document.getElementById('memoryAppEmpty');
  if (!container) return;
  container.innerHTML = '';
  var charList = characters.filter(function(c) { return c.id !== DEFAULT_CHAR_ID; });
  if (charList.length === 0) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  charList.forEach(function(ch) {
    var memories = getMemories(ch.id);
    var avatarHtml = ch.avatar ? '<img src="' + ch.avatar + '">' : escHtml(ch.name.charAt(0));
    var onlineCount = 0, callCount = 0, offlineCount = 0;
    memories.forEach(function(m) {
      var c = m.content || '';
      if (c.startsWith('[通话]')) callCount++;
      else if (c.startsWith('[线下见面]')) offlineCount++;
      else onlineCount++;
    });
    var total = memories.length;
    var parts = [];
    if (onlineCount > 0) parts.push('💬' + onlineCount);
    if (callCount > 0) parts.push('📞' + callCount);
    if (offlineCount > 0) parts.push('🤝' + offlineCount);
    var countText = total > 0 ? (total + ' 条 · ' + parts.join(' ')) : '暂无记忆';
    var countColor = total > 0 ? '' : 'color:var(--text-muted);opacity:0.6';
    var div = document.createElement('div');
    div.className = 'msg-list-item';
    div.innerHTML = '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div><div class="msg-list-avatar">' + avatarHtml + '</div><div class="msg-list-info"><div class="msg-list-name">' + escHtml(ch.name) + '</div><div class="msg-list-preview" style="' + countColor + '">' + countText + '</div></div><span style="font-size:12px;color:var(--text-muted)">→</span>';
    div.onclick = function() { openMemoryDetailPage(ch.id); };
    container.appendChild(div);
  });
};

// ============================================================
// 记忆中心详情页
// ============================================================

// openMemoryDetailPage(charId) → 打开某角色的记忆管理详情页
// · 加载3个自动总结开关 + 总结提示词 + 破限词 + 连通范围标签
// · 渲染记忆条目列表（分类卡片或筛选列表）
// · 初始化排序功能
function openMemoryDetailPage(charId) {
  _memoryCharId = charId;
  _memoryFilter = 'all';
  _memoryBatchDeleteMode = false;
  _memoryBatchSelectedIds = {};
  document.querySelectorAll('[data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === 'all'); });

  // 自动对准这个角色的分支（确保 currentChatId 指向正确角色）
  var _charChats = chats.filter(function(c) { return c.charId === charId; });
  if (_charChats.length > 0) {
    var _currentOk = _charChats.some(function(c) { return c.id === currentChatId; });
    if (!_currentOk) {
      // 优先用上次使用的分支
      var _lastBId = _charLastBranch[charId];
      var _foundBranch = _lastBId ? _charChats.find(function(c) { return c.id === _lastBId; }) : null;
      currentChatId = _foundBranch ? _foundBranch.id : _charChats[0].id;
      localStorage.setItem('stm_currentChat', currentChatId);
    }
  }

  var ch = getCharById(charId);
  var _currentBranchChat = chats.find(function(c) { return c.id === currentChatId && c.charId === charId; });
  var _branchName = _currentBranchChat ? _currentBranchChat.title : '';
  document.getElementById('memoryDetailTitle').textContent = (ch ? ch.name : '角色') + ' · 记忆管理';
  //渲染分支选择器
  _renderMemoryBranchSelector(charId);

  var settings = getMemorySettings(charId);
  var autoMods = settings.autoSummaryModules || [];
  if (!settings.autoSummaryModules && settings.autoSummary) { autoMods = ['online', 'call', 'offline']; }
  document.getElementById('memDetailAutoOnline').checked = autoMods.indexOf('online') >= 0;
  document.getElementById('memDetailAutoCall').checked = autoMods.indexOf('call') >= 0;
  document.getElementById('memDetailAutoOffline').checked = autoMods.indexOf('offline') >= 0;
  document.getElementById('memDetailInterval').value = settings.interval || 20;
  document.getElementById('memDetailSummaryPrompt').value = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  document.getElementById('memDetailCustomPrompt').value = settings.customPrompt || '';
  if (ch) updateMemoryDetailScopeLabel(ch);
  document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === 'all'); });

  document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el){
    el.style.display = '';
  });

  var _memDetailFailToggle=document.getElementById('memDetailShowFailToast');
  if(_memDetailFailToggle)_memDetailFailToggle.checked=localStorage.getItem('stm_muteAutoSummaryError')!=='on';

  _renderAutoSummaryProgress(_memoryCharId, 'memDetailAutoProgress');

  renderMemoryDetailList();
  document.getElementById('memoryDetailPage').classList.add('active');
  _pushInnerPageState('memoryDetailPage');
}

// _renderMemoryBranchSelector(charId) → 在记忆详情页渲染分支选择器
// · 显示当前分支名，点击弹出分支列表
// · 切换后同步更新 currentChatId（线上线下跟着变）
function _renderMemoryBranchSelector(charId) {
  var container = document.getElementById('memoryBranchSelector');
  if (!container) {
    // 首次调用：在设置区上方插入分支选择器
    var detailScroll = document.querySelector('#memoryDetailPage .app-scroll');
    if (!detailScroll) return;
    container = document.createElement('div');
    container.id = 'memoryBranchSelector';
    container.style.cssText = 'padding:0 16px 8px';
    var firstChild = detailScroll.querySelector('div');
    if (firstChild) detailScroll.insertBefore(container, firstChild);
    else detailScroll.appendChild(container);
  }

  var charChats = chats.filter(function(c) { return c.charId === charId; });
  var currentBranch = charChats.find(function(c) { return c.id === currentChatId; });
  var branchName = currentBranch ? _getBranchDisplayName(charId, currentBranch.id) : '未选择分支';
  var branchCount = charChats.length;

  container.innerHTML = '<div onclick="_openMemoryBranchMenu()" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background 0.15s"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(branchName) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + branchCount + ' 个分支· 点击切换</div></div><span style="font-size:12px;color:var(--text-muted)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>';
}

// _openMemoryBranchMenu() → 弹出分支选择菜单
function _openMemoryBranchMenu() {
  var charId = _memoryCharId;
  if (!charId) return;
  var charChats = chats.filter(function(c) { return c.charId === charId; });
  if (charChats.length === 0) { showToast('没有分支'); return; }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  charChats.forEach(function(c) {
    var isCurrent = c.id === currentChatId;
    var msgCount = c.messages.length;
    var lastVisible = msgCount > 0 && cbyd21_UI.getLastVisibleMsgForPreview
      ? cbyd21_UI.getLastVisibleMsgForPreview(c.messages)
      : null;
    var preview = lastVisible ? lastVisible.preview : '空对话';
    var _dn3 = _getBranchDisplayName(charId, c.id);

    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(_dn3) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + msgCount + ' 条消息 · ' + escHtml(preview) + '</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');

    div.onclick = function() {
      closeModal('addCharModal');
      // 切换分支（同步线上+线下+记忆）
      currentChatId = c.id;
      localStorage.setItem('stm_currentChat', c.id);
      _charLastBranch[charId] = c.id;

      if(typeof _saveCharLastBranchState === 'function'){
        _saveCharLastBranchState();
      }else{
        localStorage.setItem('stm_charLastBranch', JSON.stringify(_charLastBranch));
      }

      _memoryOfflineSessionId = null;
      _memoryOfflineSaveId = null;

      // 同步线上聊天界面（如果正在聊这个角色）
      if (currentChatCharId === charId) {
        cbyd21_Chat.renderMessages();cbyd21_UI.renderBranchList();
      }

      // 同步线下session
      if (typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline._sessions && cbyd21_Offline._sessions[charId]) {
        var _offSessions = cbyd21_Offline._sessions[charId] || [];
        var _boundOffline = _offSessions.find(function(s) { return s.status === 'active' && s._onlineBranchId === c.id; });
        if (_boundOffline) {
          cbyd21_Offline._sessionId = _boundOffline.id;
          cbyd21_Offline._messages = _boundOffline.messages;}
      }

      //刷新记忆详情页
      _renderMemoryBranchSelector(charId);
      renderMemoryDetailList();showToast('已切换到：' + _getBranchDisplayName(charId, c.id));
    };

    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '选择分支';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// closeMemoryDetailPage() → 关闭记忆详情页

// · 如果当前在某个分类的筛选视图里，先返回"全部"（分类卡片视图）
// · 如果已经在"全部"视图，才真正关闭页面回到角色列表
function closeMemoryDetailPage(fromPopstate) {
  if (_memoryFilter && _memoryFilter !== 'all') {
    _memoryFilter = 'all';
    _memoryOfflineSessionId = null;
    _memoryOfflineSaveId = null;
    document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) {
      el.classList.toggle('active', el.dataset.memfilter === 'all');
    });
    renderMemoryDetailList();
    return;
  }
  document.getElementById('memoryDetailPage').classList.remove('active');

  // 恢复可能被群聊记忆隐藏的元素
  document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) {
    el.style.display = '';
  });
  var autoCall = document.getElementById('memDetailAutoCall');
  if (autoCall) autoCall.closest('.toggle-row').style.display = '';
  var branchSel = document.getElementById('memoryBranchSelector');
  if (branchSel) branchSel.style.display = '';
  _currentGroupMemBranchId = null;
  _memoryOfflineSessionId = null;
  _memoryOfflineSaveId = null;
  _memoryBatchDeleteMode = false;
  _memoryBatchSelectedIds = {};


  // 刷新对应Tab的列表
  if (_memoryAppTab === 'group') { renderMemoryGroupList(); }
  else { cbyd21_UI.renderMemoryAppCharList(); }

  // 如果memoryApp是从外部入口临时打开的，关闭详情页时也关闭memoryApp
  var memApp = document.getElementById('memoryApp');
  if (memApp.style.zIndex === '200') {
    memApp.classList.remove('active');
    memApp.style.zIndex = '';
  }
  _backFromInnerPage(fromPopstate);
}

// saveMemoryDetailSettings() → 从详情页读取3个开关+提示词+破限词，保存到 charMemorySettings
function saveMemoryDetailSettings() {
  if (!_memoryCharId) return;
  var autoModules = [];
  var _isGroupMem = _memoryCharId && _memoryCharId.startsWith('group_');

  if (document.getElementById('memDetailAutoOnline').checked) autoModules.push('online');
  if (!_isGroupMem && document.getElementById('memDetailAutoCall').checked) autoModules.push('call');
  if (document.getElementById('memDetailAutoOffline').checked) autoModules.push('offline');

  var _newSummaryPrompt = document.getElementById('memDetailSummaryPrompt').value.trim();
  charMemorySettings[_memoryCharId] = {
    autoSummary: autoModules.length > 0,
    autoSummaryModules: autoModules,
    customPrompt: document.getElementById('memDetailCustomPrompt').value,
    interval: parseInt(document.getElementById('memDetailInterval').value) || 20,
    summaryPrompt: _newSummaryPrompt || DEFAULT_SUMMARY_PROMPT
  };
  cbyd21_Data.saveMemorySettings();
  showToast('记忆设置已保存');
}

// updateMemoryDetailScopeLabel(ch) → 更新详情页的连通范围标签文字
function updateMemoryDetailScopeLabel(ch) {
  var el = document.getElementById('memDetailScopeLabel');
  if (!el) return;
  var isGroup = ch && ch.id && String(ch.id).startsWith('group_');
  var scopes = ch._memoryScope || (isGroup ? ['online'] : ['online', 'call']);
  var scopeOptions = isGroup ? _memoryScopeOptions.filter(function(o) { return o.id === 'online' || o.id === 'offline'; }) : _memoryScopeOptions;
  var allIds = scopeOptions.map(function(o) { return o.id; });
  var names = { online: '线上', call: '通话', offline: '线下', shared: '共享' };
  if (scopes.length === allIds.length && allIds.every(function(id) { return scopes.indexOf(id) >= 0; })) { el.textContent = '全局连通'; }
  else if (scopes.length === 0) { el.textContent = '不连通'; }
  else { el.textContent = scopes.filter(function(s) { return !isGroup || s === 'online' || s === 'offline'; }).map(function(s) { return names[s] || s; }).join('+'); }
}

// renderMemoryDetailList() → 渲染详情页的记忆条目列表
// · "全部"模式：显示分类卡片（线上/通话/线下），点击进入对应筛选
// · 筛选模式：显示该类型的所有记忆条目
// · 每个分类卡片显示：图标、名称、条目数、是否已连通
function renderMemoryDetailList() {
  var list = document.getElementById('memoryDetailList');
  var empty = document.getElementById('memoryDetailEmpty');
  var memories = _getBranchMemories(_memoryCharId);
  list.innerHTML = '';

  // 辅助函数：判断记忆类型
  function _getMemoryType(c) {
    if (c.startsWith('[通话]')) return 'call';
    if (c.startsWith('[线下见面]') || c.startsWith('[线下群聊]')) return 'offline';
    return 'online';
  }

  // 辅助函数：渲染单个记忆条目
  var allMemoriesForIdx = getMemories(_memoryCharId);
  var _detailStack = cbyd21_Memory_safeJson('stm_summaryStack_' + _memoryCharId, []);
  function _renderItem(m) {
    var realIdx = allMemoriesForIdx.indexOf(m);
    var typeLabel = m.type === 'auto' ? '🤖 自动' : m.type === 'manual' ? '✨ AI总结' : '✏️ 手写';
    var c = m.content || '';
    var sourceMap = { online: '💬', call: '📞', offline: '🤝' };
    var sourceLabel = sourceMap[_getMemoryType(c)] || '💬';
    var _memOn2 = m.enabled !== false;
    var div = document.createElement('div');
    div.className = 'wb-entry' + (_memOn2 ? '' : ' wb-disabled');
    var _detailEntry=_detailStack.find(function(s){return s.memoryId===m.id});
    var _detailRange='';
    if(_detailEntry&&_detailEntry.label){_detailRange=' · '+_detailEntry.label}
    else if(_detailEntry&&_detailEntry.from&&_detailEntry.to){_detailRange=' · 第'+_detailEntry.from+'~'+_detailEntry.to+'条'}
    var _moveBtn = '';
    var batchChecked = !!_memoryBatchSelectedIds[m.id];

    div.innerHTML =
      (_memoryBatchDeleteMode ? '<input type="checkbox" class="memory-batch-cb" data-memid="' + escHtml(m.id || '') + '" ' + (batchChecked ? 'checked' : '') + ' onclick="event.stopPropagation()" onchange="toggleMemoryBatchSelectById(this.dataset.memid,this.checked)" style="display:block;width:18px;height:18px;accent-color:var(--danger);flex-shrink:0;margin-right:4px">' : '') +
      '<div class="wb-entry-info"><div class="wb-entry-name">' + sourceLabel + ' ' + typeLabel + ' · ' + _memoryFullTime(m) + _detailRange + '</div><div class="wb-entry-keys" style="white-space:pre-wrap;margin-top:4px">' + escHtml(c.slice(0, 100)) + (c.length > 100 ? '…' : '') + '</div></div><div class="wb-entry-actions"><label class="toggle-switch toggle-sm"><input type="checkbox" ' + (_memOn2 ? 'checked' : '') + ' onchange="toggleMemoryEnabled(' + realIdx + ',this.checked)"><span class="toggle-slider"></span></label>' + _moveBtn + '<button class="wb-entry-btn" onclick="editMemory(' + realIdx + ')">✏️</button><button class="wb-entry-btn" onclick="deleteMemory(' + realIdx + ')">🗑</button></div>';

    div.onclick = function(ev){
      if(!_memoryBatchDeleteMode)return;
      if(ev.target.closest('.wb-entry-actions') || ev.target.closest('.memory-batch-cb'))return;

      var cb = div.querySelector('.memory-batch-cb');

      if(cb){
        cb.checked = !cb.checked;
        toggleMemoryBatchSelectById(cb.dataset.memid, cb.checked);
      }
    };

    return div;
  }

  // 筛选模式：显示指定类型的条目
  if (_memoryFilter && _memoryFilter !== 'all') {
    var filtered = memories.filter(function(m) { return _getMemoryType(m.content || '') === _memoryFilter; });

    // 群聊线下筛选：顶部加session+存档选择器
    if (_memoryFilter === 'offline' && _memoryCharId && _memoryCharId.startsWith('group_')) {
      var _gmdOffSessions = _getGroupOfflineSessionsForMemory(_memoryCharId);
      if (_gmdOffSessions.length > 0) {
        var _gmdOffSelDiv = document.createElement('div');
        _gmdOffSelDiv.style.cssText = 'margin-bottom:12px';
        var _gmdCurrentOffSid = _memoryOfflineSessionId || null;
        var _gmdOffSelLabel = '全部群聊线下记录';
        if (_gmdCurrentOffSid) {
          var _gmdOffSelIdx = _gmdOffSessions.findIndex(function(s) { return s.id === _gmdCurrentOffSid; });
          if (_gmdOffSelIdx >= 0) _gmdOffSelLabel = '第' + (_gmdOffSessions.length - _gmdOffSelIdx) + '次群聊线下';
        }
        var _gmdSaveSelHtml = '';
        if (_memoryOfflineSessionId) {
          var _gmdSelSession = _gmdOffSessions.find(function(ss) { return ss.id === _memoryOfflineSessionId; });
          if (_gmdSelSession && _gmdSelSession._saves && _gmdSelSession._saves.length > 0) {
            var _gmdCurSaveId = _memoryOfflineSaveId || null;
            var _gmdSaveLabel = _gmdCurSaveId ? '已选存档' : '全部（含存档）';
            if (_gmdCurSaveId && _gmdCurSaveId !== 'current') {
              var _gmdSv = _gmdSelSession._saves.find(function(sv) { return sv.id === _gmdCurSaveId; });
              if (_gmdSv) _gmdSaveLabel = '💾 ' + _gmdSv.label;
            } else if (_gmdCurSaveId === 'current') {
              _gmdSaveLabel = '当前进度';
            }
            _gmdSaveSelHtml = '<div onclick="_openMemoryGroupOfflineSaveMenu()" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:6px;cursor:pointer;margin-top:6px;font-size:11px"><span style="flex:1;color:var(--text-primary)">' + escHtml(_gmdSaveLabel) + '</span><span style="font-size:9px;color:var(--text-muted)">' + _gmdSelSession._saves.length + '个存档 ▸</span></div>';
          }
        }
        _gmdOffSelDiv.innerHTML = '<div onclick="_openMemoryGroupOfflineSessionMenu()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:8px;cursor:pointer;transition:background 0.15s"><span style="font-size:14px;flex-shrink:0">🤝</span><div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text-primary);font-weight:500">' + escHtml(_gmdOffSelLabel) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + _gmdOffSessions.length + ' 次群聊线下 ·点击筛选</div></div><span style="font-size:10px;color:var(--text-muted)"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>' + _gmdSaveSelHtml;
        list.appendChild(_gmdOffSelDiv);

        if (_memoryOfflineSessionId) {
          filtered = filtered.filter(function(m) {
            return _memoryMatchesOfflineSelection(m, _detailStack, _memoryOfflineSessionId, _memoryOfflineSaveId);
          });
        }
      }
    }

    // 线下筛选：顶部加session选择器
    if (_memoryFilter === 'offline' && _memoryCharId && !_memoryCharId.startsWith('group_')) {
      var _offSessions = cbyd21_Offline._sessions[_memoryCharId] || [];
      var _currentBid = currentChatId;
      var _branchOffSessions = _offSessions.filter(function(s) {
        var hasMessages = s.messages && s.messages.length >= 1;
        var hasSaves = s._saves && s._saves.length > 0;
        return s._onlineBranchId === _currentBid && (hasMessages || hasSaves);
      });
      {
        var _offSelDiv = document.createElement('div');
        _offSelDiv.style.cssText = 'margin-bottom:12px';
        var _currentOffSid = _memoryOfflineSessionId || null;
        var _offSelLabel = '全部线下记录';
        if (_currentOffSid) {
          var _offSelIdx = _branchOffSessions.findIndex(function(s) { return s.id === _currentOffSid; });
          if (_offSelIdx >= 0) _offSelLabel = '第' + (_branchOffSessions.length - _offSelIdx) + '次见面';
        }
        // 存档选择器（选中session后显示）
        var _saveSelHtml = '';
        if (_memoryOfflineSessionId) {
          var _selSession = _branchOffSessions.find(function(ss) { return ss.id === _memoryOfflineSessionId; });
          if (_selSession && _selSession._saves && _selSession._saves.length > 0) {
            var _curSaveId = _memoryOfflineSaveId || null;
            var _saveLabel = _curSaveId ? '已选存档' : '全部（含存档）';
            if (_curSaveId && _curSaveId !== 'current') {
              var _sv = _selSession._saves.find(function(sv) { return sv.id === _curSaveId; });
              if (_sv) _saveLabel = '💾 ' + _sv.label;
            } else if (_curSaveId === 'current') {
              _saveLabel = '当前进度';
            }
            _saveSelHtml = '<div onclick="_openMemoryOfflineSaveMenu()" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:6px;cursor:pointer;margin-top:6px;font-size:11px"><span style="flex:1;color:var(--text-primary)">' + escHtml(_saveLabel) + '</span><span style="font-size:9px;color:var(--text-muted)">' + _selSession._saves.length + '个存档 ▸</span></div>';
          }
        }
        _offSelDiv.innerHTML = '<div onclick="_openMemoryOfflineSessionMenu()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:8px;cursor:pointer;transition:background 0.15s"><span style="font-size:14px;flex-shrink:0">🤝</span><div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text-primary);font-weight:500">' + escHtml(_offSelLabel) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + _branchOffSessions.length + ' 次见面 ·点击筛选</div></div><span style="font-size:10px;color:var(--text-muted)"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>' + _saveSelHtml;
        list.appendChild(_offSelDiv);

        // 按选中的session / save严格过滤
        if (_memoryOfflineSessionId) {
          filtered = filtered.filter(function(m) {
            return _memoryMatchesOfflineSelection(m, _detailStack, _memoryOfflineSessionId, _memoryOfflineSaveId);
          });
        }
      }
    }

    if (filtered.length === 0) { empty.style.display = 'block'; empty.textContent = '没有该类型的记忆'; return; }

    empty.style.display = 'none';

    if(_memoryBatchDeleteMode){
      list.appendChild(_renderMemoryBatchDeleteBar());
    }

    filtered.forEach(function(m) { list.appendChild(_renderItem(m)); });
    return;
  }

  // "全部"模式：显示分类卡片
  if (memories.length === 0) { empty.style.display = 'block'; empty.textContent = '还没有记忆条目'; return; }
  empty.style.display = 'none';

  // 统计各类型数量
  var counts = { online: 0, call: 0, offline: 0 };
  memories.forEach(function(m) { counts[_getMemoryType(m.content || '')]++; });
  var _isGroupMemDetail = _memoryCharId && _memoryCharId.startsWith('group_');
  var ch = _isGroupMemDetail ? _getGroupMemoryObject(_memoryCharId) : getCharById(_memoryCharId);
  var scopes = ch && ch._memoryScope || (_isGroupMemDetail ? ['online'] : ['online', 'call']);

  var categories = _isGroupMemDetail ? [
    { type: 'online', icon: '💬', name: '群聊记忆', desc: '群聊线上产生的记忆' },
    { type: 'offline', icon: '🤝', name: '群聊线下记忆', desc: '群聊线下产生的记忆' }
  ] : [
    { type: 'online', icon: '💬', name: '线上记忆', desc: '线上聊天产生的记忆' },
    { type: 'call', icon: '📞', name: '通话记忆', desc: '语音/视频通话产生的记忆' },
    { type: 'offline', icon: '🤝', name: '线下记忆', desc: '线下见面产生的记忆' }
  ];

  categories.forEach(function(cat) {
    var count = counts[cat.type] || 0;
    var isConnected = scopes.indexOf(cat.type) >= 0;
    var div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background 0.15s;margin-bottom:8px';
    div.innerHTML = '<span style="font-size:22px;flex-shrink:0">' + cat.icon + '</span><div style="flex:1;min-width:0"><div style="font-size:14px;color:var(--text-primary);font-weight:500">' + cat.name + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + (count > 0 ? count + ' 条记忆' : '暂无记忆') + (isConnected ? ' · <span style="color:var(--accent)">已连通</span>' : ' · <span style="opacity:0.5">未连通</span>') + '</div></div><span style="font-size:12px;color:var(--text-muted);flex-shrink:0"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';
    div.onclick = function() {
      _memoryFilter = cat.type;
      document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === cat.type); });
      renderMemoryDetailList();
    };
    div.addEventListener('touchstart', function() { this.style.background = 'var(--bg-hover)'; }, { passive: true });
    div.addEventListener('touchend', function() { this.style.background = 'var(--bg-card)'; });
    list.appendChild(div);
  });
}

// _ensureOfflineLoaded(charId) → 检查该角色是否有活跃线下session，有则恢复内存状态
function _ensureOfflineLoaded(charId) {
  if (cbyd21_Offline._charId === charId && cbyd21_Offline._messages && cbyd21_Offline._messages.length >= 2) {
    var _loadedSession = cbyd21_Offline._getSession ? cbyd21_Offline._getSession() : null;
    if (_loadedSession && _loadedSession._onlineBranchId === currentChatId) return true;
  }
  var sessions = cbyd21_Offline._sessions[charId] || [];
  var _branchId = currentChatId;
  var activeSession = sessions.find(function(s) { return s.status === 'active' && s._onlineBranchId === _branchId; });
  if (!activeSession || !activeSession.messages || activeSession.messages.length < 2) return false;
  cbyd21_Offline._isGroupMode = false;
  cbyd21_Offline._groupId = null;
  cbyd21_Offline._charId = charId;
  cbyd21_Offline._sessionId = activeSession.id;
  cbyd21_Offline._messages = activeSession.messages;
  return true;
}

// ============================================================
// 从详情页打开总结
// ============================================================

// openSummaryFromDetail() → 根据当前筛选类型决定调哪个总结功能
// · 线上 → openSummaryModal()
// · 通话 → manualSummarizeCall()
// · 线下 → cbyd21_Offline.manualSummarize()
// · 全部 → 弹出选择菜单让用户选
function openSummaryFromDetail() {
  if(!_cbyd21MemoryPromptReadyOrToast(false)){
    return;
  }

  var _isGroupMemSummary = _memoryCharId && _memoryCharId.startsWith('group_');

  if (_memoryFilter && _memoryFilter !== 'all') {
    if (_memoryFilter === 'online') {
      if (_isGroupMemSummary) { _openGroupSummaryModal(_memoryCharId.slice(6)); return; }
      openSummaryModal(); return;
    }
    if (_memoryFilter === 'call') { manualSummarizeCall(_memoryCharId); return; }
    if (_memoryFilter === 'offline') {
      if (_isGroupMemSummary) {
        cbyd21_Offline._isGroupMode = true;
        cbyd21_Offline._groupId = _memoryCharId.slice(6);
        cbyd21_Offline._manualSummarizeGroup();
        return;
      }
      // 临时设置charId让manualSummarize能找到session数据
      cbyd21_Offline._isGroupMode = false;
      cbyd21_Offline._groupId = null;
      cbyd21_Offline._charId = _memoryCharId;
      cbyd21_Offline.manualSummarize();
      return;
    }
    return;
  }

  // "全部"模式：弹出选择菜单
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var cid = _memoryCharId;
  var hasChat;
  if (_isGroupMemSummary) {
    var _gid3 = cid.slice(6);
    var _grp3 = cbyd21_Group._groups.find(function(g) { return g.id === _gid3; });
    var _grpBranch = _grp3 ? _getCurrentGroupMemoryBranch(cid) : null;
    var _grpVisibleForSummary = _memoryVisibleSourceMessages(_grpBranch && _grpBranch.messages ? _grpBranch.messages : []);
    hasChat = _grpBranch && _grpVisibleForSummary.length >= 3;
  } else {
    hasChat = chats.some(function(c) {
      if (c.charId !== cid) return false;
      return _memoryVisibleSourceMessages(c.messages || []).length >= 3;
    });
  }
  var hasCall = chats.some(function(c) { return c.charId === cid && c.messages.some(function(m) { return m.content && m.content.startsWith('__call__'); }); });
  var hasOffline = _ensureOfflineLoaded(cid);
  var items = [
    { label: '💬 总结线上聊天', desc: _isGroupMemSummary ? '总结当前群聊分支的对话内容' : '总结当前聊天分支的对话内容', available: hasChat, action: function() { closeModal('addCharModal'); if (_isGroupMemSummary) { _openGroupSummaryModal(cid.slice(6)); } else { openSummaryModal(); } } },
    { label: '📞 总结最近通话', desc: '总结最近一次通话记录', available: hasCall, action: function() { closeModal('addCharModal'); manualSummarizeCall(cid); } },
    { label: '🤝 总结线下见面', desc: _isGroupMemSummary ? '总结当前群聊线下记录' : '选择一次线下见面来总结', available: true, action: function() { closeModal('addCharModal'); if (_isGroupMemSummary) { cbyd21_Offline._isGroupMode = true; cbyd21_Offline._groupId = cid.slice(6); cbyd21_Offline._manualSummarizeGroup(); } else { cbyd21_Offline._isGroupMode = false; cbyd21_Offline._groupId = null; cbyd21_Offline._charId=cid; cbyd21_Offline.manualSummarize(); } } }
  ];
  // 群聊：过滤掉通话选项
  if (_isGroupMemSummary) {
    items = items.filter(function(item) {
      return item.label.indexOf('通话') < 0;
    });
  }
  items.forEach(function(item) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    if (!item.available) div.style.opacity = '0.4';
    div.innerHTML = '<div style="flex:1"><div style="font-size:14px;color:var(--text-primary)">' + item.label + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + item.desc + '</div></div>';
    div.onclick = function() { if (!item.available) { showToast('没有可总结的数据'); return; } item.action(); };
    container.appendChild(div);
  });
  var hintDiv = document.createElement('div');
  hintDiv.style.cssText = 'padding:10px 16px;font-size:11px;color:var(--text-muted);line-height:1.6;border-top:1px solid var(--border-soft)';
  hintDiv.textContent = '💡 各模块的记忆也会在对应功能结束时自动总结（需开启自动总结开关）。通话和线下的记忆可以在对应入口手动总结。';
  container.appendChild(hintDiv);
  document.getElementById('addCharModal').querySelector('h3').textContent = '总结哪个模块？';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// ============================================================
// 筛选 + 手写添加
// ============================================================

// filterMemoryType(type, btn) → 切换记忆类型筛选
// · 同时更新弹窗和详情页的筛选Tab高亮
// · 刷新对应的列表
function filterMemoryType(type, btn) {
  _memoryFilter = type;
  _memoryOfflineSessionId = null;
  _memoryOfflineSaveId = null;
  _memoryBatchDeleteMode = false;
  _memoryBatchSelectedIds = {};
  document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === type); });
  document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) { el.classList.toggle('active', el.dataset.memfilter === type); });
  cbyd21_UI.renderMemoryList();
  if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
}

var _manualMemoryPendingSource = null;

// _manualMemoryTypeName(type, isGroup) → 手写记忆类型名称
function _manualMemoryTypeName(type, isGroup) {
  if (isGroup) {
    if (type === 'offline') return '群聊线下';
    return '群聊';
  }
  if (type === 'call') return '通话';
  if (type === 'offline') return '线下';
  return '线上';
}

// _getManualMemorySource(prefix, hint)
// → 根据当前筛选类型，取得手写记忆要绑定的原始消息来源。
// 返回 source 对象，后续会要求用户选择 from~to，再填写记忆内容。
function _getManualMemorySource(prefix, hint) {
  var charId = _memoryCharId;
  var isGroup = charId && charId.startsWith('group_');
  var type = _memoryFilter || 'online';

  if (!charId) return { error: '找不到记忆对象' };

  // 线上 / 群聊线上
  if (type === 'online') {
    if (isGroup) {
      var branch = _getCurrentGroupMemoryBranch(charId);
      if (!branch || !branch.messages || branch.messages.length < 1) {
        return { error: '当前群聊分支没有可绑定的消息' };
      }

      return {
        prefix: prefix || '[群聊] ',
        hint: hint || '手写群聊记忆',
        messages: _memoryVisibleSourceMessages(branch.messages || []),
        branchId: branch.id || null,
        sessionId: null,
        saveId: null,
        sourceType: 'group_online',
        labelBase: '群聊手写'
      };
    }

    var chat = chats.find(function(c) {
      return c.id === currentChatId && c.charId === charId;
    });

    if (!chat || !chat.messages || chat.messages.length < 1) {
      return { error: '当前分支没有可绑定的消息' };
    }

    return {
      prefix: prefix || '',
      hint: hint || '手写线上记忆',
      messages: _memoryVisibleSourceMessages(chat.messages || []),
      branchId: chat.id || currentChatId || null,
      sessionId: null,
      saveId: null,
      sourceType: 'online',
      labelBase: '线上手写'
    };
  }

  // 通话：先选择通话记录。通话没有普通 from~to 范围，用 from=0/to=0 记录栈道。
  if (type === 'call') {
    if (isGroup) return { error: '群聊没有通话记忆' };
    return { needCallSelect: true, prefix: prefix || '[通话] ', hint: hint || '手写通话记忆' };
  }

  // 线下 / 群聊线下
  if (type === 'offline') {
    if (isGroup) {
      if (!_memoryOfflineSessionId) {
        return { needGroupSessionSelect: true, prefix: prefix || '[线下群聊] ', hint: hint || '手写群聊线下记忆' };
      }

      var groupSessions = _getGroupOfflineSessionsForMemory(charId);
      var groupSession = groupSessions.find(function(s) {
        return s.id === _memoryOfflineSessionId;
      });

      if (!groupSession) {
        return { error: '找不到选中的群聊线下记录' };
      }

      var groupMsgs = groupSession.messages || [];
      var groupSaveId = null;

      if (_memoryOfflineSaveId && _memoryOfflineSaveId !== 'current' && groupSession._saves) {
        var groupSave = groupSession._saves.find(function(sv) {
          return sv.id === _memoryOfflineSaveId;
        });
        if (!groupSave || !groupSave.messages) {
          return { error: '找不到选中的群聊线下存档' };
        }
        groupMsgs = groupSave.messages;
        groupSaveId = _memoryOfflineSaveId;
      } else if (_memoryOfflineSaveId === 'current') {
        groupMsgs = groupSession.messages || [];
        groupSaveId = null;
      }

      if (!groupMsgs || groupMsgs.length < 1) {
        return { error: '选中的群聊线下记录没有可绑定的消息' };
      }

      return {
        prefix: prefix || '[线下群聊] ',
        hint: hint || '手写群聊线下记忆',
        messages: _memoryVisibleSourceMessages(groupMsgs),
        branchId: groupSession._branchId || null,
        sessionId: groupSession.id || null,
        saveId: groupSaveId,
        sourceType: 'group_offline',
        labelBase: '线下群聊手写'
      };
    }

    if (!_memoryOfflineSessionId) {
      return { needSessionSelect: true, prefix: prefix || '[线下见面] ', hint: hint || '手写线下记忆' };
    }

    var sessions = cbyd21_Offline._sessions[charId] || [];
    var session = sessions.find(function(s) {
      return s.id === _memoryOfflineSessionId;
    });

    if (!session) {
      return { error: '找不到选中的线下记录' };
    }

    var msgs = session.messages || [];
    var saveId = null;

    if (_memoryOfflineSaveId && _memoryOfflineSaveId !== 'current' && session._saves) {
      var save = session._saves.find(function(sv) {
        return sv.id === _memoryOfflineSaveId;
      });
      if (!save || !save.messages) {
        return { error: '找不到选中的线下存档' };
      }
      msgs = save.messages;
      saveId = _memoryOfflineSaveId;
    } else if (_memoryOfflineSaveId === 'current') {
      msgs = session.messages || [];
      saveId = null;
    }

    if (!msgs || msgs.length < 1) {
      return { error: '选中的线下记录没有可绑定的消息' };
    }

    return {
      prefix: prefix || '[线下见面] ',
      hint: hint || '手写线下记忆',
      messages: _memoryVisibleSourceMessages(msgs),
      branchId: session._onlineBranchId || null,
      sessionId: session.id || null,
      saveId: saveId,
      sourceType: 'offline',
      labelBase: '线下手写'
    };
  }

  return { error: '未知的记忆类型' };
}

// _openManualMemoryCallSelector(prefix, hint)
// → 手写通话记忆时，先选择一条通话卡片作为来源栈道。
function _openManualMemoryCallSelector(prefix, hint) {
  var charId = _memoryCharId;
  if (!charId) return;

  var charChats = chats.filter(function(c) {
    return c.charId === charId;
  });

  var allCalls = [];

  charChats.forEach(function(chat) {
    (chat.messages || []).forEach(function(m, mi) {
      if (!m.content || !m.content.startsWith('__call__')) return;

      try {
        var callData = JSON.parse(m.content.slice(8));
        if (callData.messages && callData.messages.length >= 1) {
          allCalls.push({
            data: callData,
            time: m.time || '',
            branchTitle: chat.title,
            branchId: chat.id,
            msgIdx: mi,
            sourceTs: m._ts || callData._sourceTs || Date.now()
          });
        }
      } catch (e) {}
    });
  });

  if (allCalls.length === 0) {
    showToast('找不到通话记录');
    return;
  }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var hintDiv = document.createElement('div');
  hintDiv.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
  hintDiv.innerHTML = '<div style="font-weight:600;margin-bottom:4px">选择这条手写记忆属于哪次通话</div><div style="font-size:11px;color:var(--text-muted)">手写通话记忆会绑定到选中的通话卡片位置</div>';
  container.appendChild(hintDiv);

  allCalls.forEach(function(call) {
    var duration = call.data.duration || 0;
    var min = Math.floor(duration / 60).toString().padStart(2, '0');
    var sec = (duration % 60).toString().padStart(2, '0');
    var msgCount = call.data.messages.length;
    var preview = call.data.messages.slice(0, 2).map(function(m) {
      var role = m.role === 'user' ? '我' : '角色';
      var text = (m.content || '').replace(/__bilingual_split__[\s\S]*/, '').slice(0, 30);
      return role + ': ' + text;
    }).join(' → ');

    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML =
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>' +
          '<span style="font-size:14px;color:var(--text-primary)">' + min + ':' + sec + '</span>' +
          '<span style="font-size:11px;color:var(--text-muted)">' + msgCount + '条对话</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(preview) + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + escHtml(call.branchTitle) + ' · ' + call.time + '</div>' +
      '</div>';

    div.onclick = function() {
      closeModal('addCharModal');

      var source = {
        prefix: prefix || '[通话] ',
        hint: hint || '手写通话记忆',
        messages: call.data.messages || [],
        branchId: call.branchId || null,
        sessionId: null,
        saveId: null,
        sourceType: 'call',
        labelBase: '通话手写',
        sourceTs: call.sourceTs || call.data._sourceTs || Date.now(),
        from: 0,
        to: 0
      };

      _openManualMemoryTextInput(source, 0, 0);
    };

    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '📞 选择通话记录';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _openManualMemoryRangePanel(source)
// → 普通手写记忆先选择来源范围，再填写内容。
function _openManualMemoryRangePanel(source) {
  if (!source || !source.messages || source.messages.length < 1) {
    showToast('没有可绑定的来源消息');
    return;
  }

  _manualMemoryPendingSource = source;

  var total = source.messages.length;
  var defaultFrom = source.from || 1;
  var defaultTo = source.to || total;
  if (defaultFrom < 1) defaultFrom = 1;
  if (defaultTo > total) defaultTo = total;
  if (defaultFrom > defaultTo) defaultFrom = defaultTo;

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var previewMsg = source.messages[defaultTo - 1];
  var preview = previewMsg ? (previewMsg.content || '').slice(0, 60) : '';

  container.innerHTML =
    '<div style="padding:16px">' +
      '<div style="font-size:13px;color:var(--text-primary);line-height:1.7;margin-bottom:12px">' +
        '这条手写记忆需要绑定到一段具体记录。绑定后，它会按这段记录的剧情时间自动排序。' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<div style="flex:1;padding:10px;background:var(--bg-tertiary);border-radius:8px;text-align:center">' +
          '<div style="font-size:11px;color:var(--text-muted)">总消息数</div>' +
          '<div style="font-size:18px;font-weight:600;color:var(--text-primary);margin-top:4px">' + total + '</div>' +
        '</div>' +
        '<div style="flex:1;padding:10px;background:var(--bg-tertiary);border-radius:8px;text-align:center">' +
          '<div style="font-size:11px;color:var(--text-muted)">类型</div>' +
          '<div style="font-size:14px;font-weight:600;color:var(--accent);margin-top:8px">' + escHtml(source.labelBase || '手写') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">绑定范围</label>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:12px;color:var(--text-muted)">从第</span>' +
          '<input class="form-input" id="manualMemoryFrom" type="number" min="1" max="' + total + '" value="' + defaultFrom + '" style="width:70px;text-align:center">' +
          '<span style="font-size:12px;color:var(--text-muted)">到第</span>' +
          '<input class="form-input" id="manualMemoryTo" type="number" min="1" max="' + total + '" value="' + defaultTo + '" style="width:70px;text-align:center">' +
          '<span style="font-size:12px;color:var(--text-muted)">条</span>' +
        '</div>' +
        '<div class="form-hint">建议选择这条记忆实际来源的那段消息，不要随便选太大的范围。</div>' +
      '</div>' +
      '<div style="background:rgba(124,111,155,0.08);border:1px solid rgba(124,111,155,0.15);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:11px;color:var(--text-muted);line-height:1.6">' +
        '当前末尾预览：' + escHtml(preview || '（空）') +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn" onclick="closeModal(\'addCharModal\')" style="flex:1">取消</button>' +
        '<button class="btn primary" onclick="_confirmManualMemoryRange()" style="flex:1">下一步</button>' +
      '</div>' +
    '</div>';

  document.getElementById('addCharModal').querySelector('h3').textContent = '绑定记忆来源';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _confirmManualMemoryRange() → 确认手写记忆绑定范围
function _confirmManualMemoryRange() {
  var source = _manualMemoryPendingSource;
  if (!source || !source.messages) {
    showToast('来源数据异常');
    return;
  }

  var total = source.messages.length;
  var from = parseInt(document.getElementById('manualMemoryFrom').value) || 1;
  var to = parseInt(document.getElementById('manualMemoryTo').value) || total;

  from = Math.max(1, Math.min(total, from));
  to = Math.max(1, Math.min(total, to));

  if (from > to) {
    var tmp = from;
    from = to;
    to = tmp;
  }

  closeModal('addCharModal');
  _openManualMemoryTextInput(source, from, to);
}

// _openManualMemoryTextInput(source, from, to)
// → 打开正文输入框。保存后写入记忆条目和 summaryStack。
function _openManualMemoryTextInput(source, from, to) {
  var rangeText = from > 0 && to > 0 ? '第' + from + '~' + to + '条' : '整段通话';
  var hint = (source.hint || '手写记忆') + ' · ' + rangeText;

  openTextInputModal('✏️ 手写记忆', hint, '写下这段范围应该留下的记忆……', function(content) {
    _commitManualMemoryWithSource(source, from, to, content);
  });
}

// _commitManualMemoryWithSource(source, from, to, content)
// → 真正保存手写记忆：同时创建记忆条目和栈道记录。
function _commitManualMemoryWithSource(source, from, to, content) {
  var charId = _memoryCharId;
  if (!charId) {
    showToast('找不到记忆对象');
    return;
  }

  if (!content || !content.trim()) {
    showToast('请输入记忆内容');
    return;
  }

  if (!charMemories[charId]) charMemories[charId] = [];

  var sourceTs = source.sourceTs || 0;

  if (!sourceTs) {
    if (source.sourceType === 'offline') {
      sourceTs = _findOfflineRecordSourceTs(charId, source.sessionId) || _getSourceTsFromMessages(source.messages, from, to);
    } else {
      sourceTs = _getSourceTsFromMessages(source.messages, from, to);
    }
  }

  var prefix = source.prefix || '';
  var finalContent = content.trim();
  if (prefix && finalContent.indexOf(prefix) !== 0) {
    finalContent = prefix + finalContent;
  }

  var memEntry = {
    id: Date.now().toString(),
    content: finalContent,
    type: 'custom',
    time: formatTime(Date.now()),
    _branchId: source.branchId || null,
    _sourceTs: sourceTs,
    _sourceSeq: to || 0,
    _sourceType: source.sourceType || 'manual'
  };

  if (source.sessionId) memEntry._sessionId = source.sessionId;
  if (source.saveId) memEntry._saveId = source.saveId;

  charMemories[charId].push(memEntry);
  _sortMemoryArrayInPlace(charMemories[charId]);

  var stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var label = source.labelBase || '手写';
  if (from > 0 && to > 0) {
    label += ' · 第' + from + '~' + to + '条';
  }

  var stackEntry = {
    memoryId: memEntry.id,
    from: from || 0,
    to: to || 0,
    deleted: false,
    label: label,
    _branchId: source.branchId || null,
    _sourceTs: sourceTs,
    _sourceSeq: to || 0,
    _sourceType: source.sourceType || 'manual'
  };

  if (source.sessionId) stackEntry._sessionId = source.sessionId;
  if (source.saveId) stackEntry._saveId = source.saveId;

  stack.push(stackEntry);
  localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(stack));

  cbyd21_Data.saveMemories();
  cbyd21_UI.renderMemoryList();
  if (document.getElementById('memoryDetailPage').classList.contains('active')) {
    renderMemoryDetailList();
  }

  _renderAutoSummaryProgress(charId, 'memModalAutoProgress');
  _renderAutoSummaryProgress(charId, 'memDetailAutoProgress');

  _manualMemoryPendingSource = null;
  showToast('手写记忆已添加');
}

// addManualMemory() → 手写添加记忆
// · 新逻辑：手写记忆也必须绑定来源范围
// · 先选择类型 / 来源范围，再填写内容
// · 保存时同时写入记忆条目 + summaryStack 栈道记录
function addManualMemory() {
  if (_memoryFilter && _memoryFilter !== 'all') {
    var isGroupManualMem = _memoryCharId && _memoryCharId.startsWith('group_');
    var prefixMap = isGroupManualMem
      ? { online: '[群聊] ', offline: '[线下群聊] ' }
      : { online: '', call: '[通话] ', offline: '[线下见面] ' };

    var prefix = prefixMap[_memoryFilter] || '';
    var typeName = _manualMemoryTypeName(_memoryFilter, isGroupManualMem);

    // 单聊线下：如果没有选中具体 session，先让用户选
    if (_memoryFilter === 'offline' && !_memoryOfflineSessionId && _memoryCharId && !_memoryCharId.startsWith('group_')) {
      var offSessions = cbyd21_Offline._sessions[_memoryCharId] || [];
      var currentBid = currentChatId;
      var branchOffSessions = offSessions.filter(function(s) {
        var hasMessages = s.messages && s.messages.length >= 1;
        var hasSaves = s._saves && s._saves.length > 0;
        return s._onlineBranchId === currentBid && (hasMessages || hasSaves);
      });

      if (branchOffSessions.length > 1) {
        _showSessionSelectorForManual(branchOffSessions, prefix);
        return;
      } else if (branchOffSessions.length === 1) {
        _memoryOfflineSessionId = branchOffSessions[0].id;
        _memoryOfflineSaveId = null;
      } else {
        showToast('当前分支没有线下记录，不能添加线下记忆');
        return;
      }
    }

    // 群聊线下：如果没有选中具体 session，先让用户选
    if (_memoryFilter === 'offline' && !_memoryOfflineSessionId && _memoryCharId && _memoryCharId.startsWith('group_')) {
      var gmManualSessions = _getGroupOfflineSessionsForMemory(_memoryCharId);

      if (gmManualSessions.length > 1) {
        _showGroupSessionSelectorForManual(gmManualSessions, prefix);
        return;
      } else if (gmManualSessions.length === 1) {
        _memoryOfflineSessionId = gmManualSessions[0].id;
        _memoryOfflineSaveId = null;
      } else {
        showToast('当前群聊分支没有线下记录，不能添加群聊线下记忆');
        return;
      }
    }

    _doAddManualMemory(prefix, '将添加为「' + typeName + '」记忆');
    return;
  }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var isGroupManualAll = _memoryCharId && _memoryCharId.startsWith('group_');
  var types = isGroupManualAll ? [
    { type: 'online', label: '💬 群聊记忆', prefix: '[群聊] ', desc: '绑定到当前群聊分支的一段线上群聊记录' },
    { type: 'offline', label: '🤝 群聊线下记忆', prefix: '[线下群聊] ', desc: '绑定到当前群聊分支的一次线下记录' }
  ] : [
    { type: 'online', label: '💬 线上记忆', prefix: '', desc: '绑定到当前线上分支的一段聊天记录' },
    { type: 'call', label: '📞 通话记忆', prefix: '[通话] ', desc: '绑定到某一次通话卡片' },
    { type: 'offline', label: '🤝 线下记忆', prefix: '[线下见面] ', desc: '绑定到当前分支的一次线下记录' }
  ];

  types.forEach(function(t) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.innerHTML =
      '<div style="flex:1">' +
        '<div style="font-size:14px;color:var(--text-primary)">' + t.label + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + t.desc + '</div>' +
      '</div>';

    div.onclick = function() {
      closeModal('addCharModal');
      _memoryFilter = t.type;

      document.querySelectorAll('#memoryModal [data-memfilter]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.memfilter === t.type);
      });
      document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.memfilter === t.type);
      });

      if (t.type !== 'offline') {
        _memoryOfflineSessionId = null;
        _memoryOfflineSaveId = null;
      }

      _doAddManualMemory(t.prefix, t.label);
    };

    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '添加到哪种记忆？';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}


// _showGroupSessionSelectorForManual(sessions, prefix) → 手写群聊线下记忆时选择第几次见面
function _showGroupSessionSelectorForManual(sessions, prefix) {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var hint = document.createElement('div');
  hint.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
  hint.innerHTML = '<div style="font-weight:600;margin-bottom:4px">添加到哪次群聊线下？</div><div style="font-size:11px;color:var(--text-muted)">选择后手写记忆会归入对应的群聊线下记录</div>';
  container.appendChild(hint);
  sessions.forEach(function(s, i) {
    var sessionNum = sessions.length - i;
    var statusText = s.status === 'active' ? '进行中' : '已结束';
    var statusColor = s.status === 'active' ? 'var(--accent)' : 'var(--text-muted)';
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:var(--text-primary)">第' + sessionNum + '次群聊线下</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="color:' + statusColor + '">' + statusText + '</span> · ' + s.messages.length + '条消息</div></div>';
    div.onclick = function() {
      closeModal('addCharModal');
      _memoryOfflineSessionId = s.id;
      _memoryOfflineSaveId = null;
      _doAddManualMemory(prefix, '将添加为「群聊线下」记忆 · 第' + sessionNum + '次群聊线下');
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '🤝 选择群聊线下记录';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _showSessionSelectorForManual(sessions, prefix) → 手写线下记忆时选择第几次见面
function _showSessionSelectorForManual(sessions, prefix) {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var hint = document.createElement('div');
  hint.style.cssText = 'padding:14px 16px;font-size:13px;color:var(--text-primary);line-height:1.6;border-bottom:1px solid var(--border-soft)';
  hint.innerHTML = '<div style="font-weight:600;margin-bottom:4px">添加到哪次见面？</div><div style="font-size:11px;color:var(--text-muted)">选择后手写记忆会归入对应的见面记录</div>';
  container.appendChild(hint);
  sessions.forEach(function(s, i) {
    var sessionNum = sessions.length - i;
    var statusText = s.status === 'active' ? '进行中' : '已结束';
    var statusColor = s.status === 'active' ? 'var(--accent)' : 'var(--text-muted)';
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:var(--text-primary)">第' + sessionNum + '次见面</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="color:' + statusColor + '">' + statusText + '</span> · ' + s.messages.length + '条消息</div></div>';
    div.onclick = function() {
      closeModal('addCharModal');
      _memoryOfflineSessionId = s.id;
      _memoryOfflineSaveId = null;
      _doAddManualMemory(prefix, '将添加为「线下」记忆 · 第' + sessionNum + '次见面');
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '🤝 选择见面记录';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _doAddManualMemory(prefix, hint) → 实际执行手写添加
// · 新逻辑：不再允许无来源手写
// · 必须先绑定来源范围 / 通话卡片，再填写记忆内容
function _doAddManualMemory(prefix, hint) {
  var source = _getManualMemorySource(prefix, hint);

  if (source.error) {
    showToast(source.error);
    return;
  }

  if (source.needCallSelect) {
    _openManualMemoryCallSelector(source.prefix, source.hint);
    return;
  }

  if (source.needSessionSelect) {
    showToast('请先选择一次线下记录');
    return;
  }

  if (source.needGroupSessionSelect) {
    showToast('请先选择一次群聊线下记录');
    return;
  }

  _openManualMemoryRangePanel(source);
}

// ============================================================
// 排序回调
// ============================================================

// toggleMemoryEnabled(i, on) → 开启/关闭某条记忆的读取
// · enabled=false时AI 不会读到这条记忆，但条目保留在列表里
// · 关闭的条目显示为半透明（wb-disabled 样式）
function toggleMemoryEnabled(i, on) {
  var memories = getMemories(_memoryCharId);
  if (!memories[i]) return;
  memories[i].enabled = on;
  cbyd21_Data.saveMemories();
  //刷新列表里这条的样式（不重新渲染整个列表，避免滚动位置丢失）
  var allEntries = document.querySelectorAll('#memoryList .wb-entry, #memoryDetailList .wb-entry');
  allEntries.forEach(function(el) {
    var toggle = el.querySelector('.toggle-sm input');
    if (toggle) {
      var idx = parseInt(toggle.getAttribute('onchange').match(/\d+/)[0]);
      if (idx === i) {
        el.classList.toggle('wb-disabled', !on);
      }
    }
  });
}


// ============================================================
// 记忆栈 — 重新总结
// ============================================================

// _resummarizeFromStack(stackIdx) → 从总结记录点击重新总结
// · 范围严格锁定为该栈记录的 from~to，不可修改
// · 已删除的记录：重新总结后恢复为有效状态
// · 有效的记录：替换旧的记忆条目为新总结
// · 通话类记录（from=0）不支持重新总结
async function _resummarizeFromStack(stackIdx) {
  if (_isSummarizing) { showToast('上一条总结正在生成中，请稍等'); return; }

  if(!_cbyd21MemoryPromptReadyOrToast(false)){
    return;
  }

  var charId = window._summaryModalCharId || _memoryCharId || currentChatCharId;
  if (!charId) return;

  var _stack = cbyd21_Memory_safeJson('stm_summaryStack_' + charId, []);
  var entry = _stack[stackIdx];
  if (!entry || !entry.from || !entry.to) { showToast('该记录没有范围信息'); return; }

  var source = _getStackSourceMessages(charId, entry);
  if (!source || !source.messages) {
    showToast('找不到这条总结记录对应的原始内容');
    return;
  }

  var reVisibleMessages = _memoryVisibleSourceMessages(source.messages || []);

  if (reVisibleMessages.length < entry.to) {
    showToast('当前可见消息数(' + reVisibleMessages.length + ')不足，该记录范围为第' + entry.from + '~' + entry.to + '条');
    return;
  }

  var sApi = getSummaryApiConfig();
  if (!sApi.url || !sApi.key || !sApi.model) { showToast('请先配置API'); return; }

  var settings = getMemorySettings(charId);
  var _promptEl = document.getElementById('summaryPromptInput');
  var _customEl = document.getElementById('summaryCustomPromptInput');
  var promptText = (_promptEl && _promptEl.value && _promptEl.value.trim()) || settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  var customPrompt = (_customEl && _customEl.value && _customEl.value.trim()) || settings.customPrompt || '';

  var unit = '条';
  var _yes = await customConfirm('重新总结第' + entry.from + '~' + entry.to + unit + '？\n\n' + (entry.deleted || entry.failed ? '将生成新的总结内容，恢复这条记录。' : '将生成新的总结内容，替换当前有效的总结。'));
  if (!_yes) return;

  closeModal('summaryModal');
  closeModal('addCharModal');
  _isSummarizing = true;
  showToast('正在重新总结第' + entry.from + '~' + entry.to + unit + '…');

  try {
    var slice = reVisibleMessages.slice(entry.from - 1, entry.to);
    if (slice.length < 2) { showToast('消息太少'); _isSummarizing = false; return; }

    var sourceTextMsgs = slice.filter(function(m) {
      var c = m.content || '';
      return c !== '__system_init__' &&
        c !== '__system_continue__' &&
        !c.startsWith('__call__') &&
        !c.startsWith('__offline_record__');
    });

    if (sourceTextMsgs.length === 0) {
      showToast('这个范围主要是通话/线下记录卡片，请到对应入口总结');
      _isSummarizing = false;
      return;
    }

    var msgs = sourceTextMsgs.map(function(m) {
      var c = _cbyd21MemoryCleanContent(m.content);
      return (m.role === 'user' ? source.userLabel : source.aiLabel) + ': ' + c.slice(0, 200);
    }).join('\n');

    if (!msgs.trim()) {
      showToast('没有可总结的文字内容');
      _isSummarizing = false;
      return;
    }

    var _reSysPrompt = promptText + (customPrompt ? '\n\n' + customPrompt : '');
    var url = sApi.url.replace(/\/+$/, '') + '/chat/completions';
    var _resummaryBody = {
      model:sApi.model,
      messages:[
        { role:'system', content:_reSysPrompt },
        { role:'user', content:'请总结以下记录：\n\n' + msgs }
      ]
    };

    if(sApi.temperature !== undefined){
      _resummaryBody.temperature = sApi.temperature;
    }

    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sApi.key }, body: JSON.stringify(_resummaryBody) });
    var _rawResummaryText = await r.text();

    if (!r.ok) {
      throw new Error('HTTP ' + r.status + ': ' + _rawResummaryText.slice(0, 300));
    }

    var _parsedResummaryText = typeof _cbyd21ParseChatApiResponseText === 'function'
      ? _cbyd21ParseChatApiResponseText(_rawResummaryText)
      : {data:null,text:_rawResummaryText};

    var d = _parsedResummaryText.data || {};
    var summary = _parsedResummaryText.text || _extractApiContent(d);

    if (!summary) { showToast('总结失败'); _isSummarizing = false; return; }

    if (!charMemories[charId]) charMemories[charId] = [];

    if (!entry.deleted && entry.memoryId) {
      var oldIdx = charMemories[charId].findIndex(function(m) { return m.id === entry.memoryId; });
      if (oldIdx >= 0) charMemories[charId].splice(oldIdx, 1);
    }

    var _reSourceTs = entry._sourceTs || _getSourceTsFromMessages(reVisibleMessages, entry.from, entry.to);

    var newEntry = {
      id: Date.now().toString(),
      content: (source.prefix || '') + summary.trim(),
      type: 'manual',
      time: formatTime(Date.now()),
      _sourceTs: _reSourceTs,
      _sourceSeq: entry.to || 0,
      _sourceType: entry._sourceType || 'resummary'
    };

    if (source.branchId) newEntry._branchId = source.branchId;
    if (source.sessionId) newEntry._sessionId = source.sessionId;
    if (source.saveId) newEntry._saveId = source.saveId;

    charMemories[charId].push(newEntry);
    _sortMemoryArrayInPlace(charMemories[charId]);

    entry.memoryId = newEntry.id;
    entry.deleted = false;
    entry.failed = false;
    if (source.branchId) entry._branchId = source.branchId;
    if (source.sessionId) entry._sessionId = source.sessionId;
    if (source.saveId) entry._saveId = source.saveId;

    entry._sourceTs = _reSourceTs;
    entry._sourceSeq = entry.to || 0;
    entry._sourceType = entry._sourceType || 'resummary';

    if(entry.label){
      entry.label = entry.label
        .replace(/ · 失败（[^）]*）/g, '')
        .replace(/ · 失败/g, '')
        .replace(/总结失败（[^）]*）/g, '总结')
        .replace(/总结失败/g, '总结');
    }

    localStorage.setItem('stm_summaryStack_' + charId, JSON.stringify(_stack));
    _updateSummaryPosition(charId);

    cbyd21_Data.saveMemories();
    cbyd21_UI.renderMemoryList();
    if (document.getElementById('memoryDetailPage').classList.contains('active')) { renderMemoryDetailList(); }
    _refreshMemoryListsIfVisible();
    showToast('重新总结完成（第' + entry.from + '~' + entry.to + unit + '）');
    _renderAutoSummaryProgress(charId, 'memModalAutoProgress');
    _renderAutoSummaryProgress(charId, 'memDetailAutoProgress');
  } catch (e) {
    showApiError('重新总结失败：' + (e.message || ''));
  }

  _isSummarizing = false;
}

// reorderMemoryChars(fromIdx, toIdx) → 记忆中心角色列表拖拽排序回调
// · 复用通讯录的排序逻辑
function reorderMemoryChars(fromIdx, toIdx) {
  reorderContacts(fromIdx, toIdx);
  cbyd21_UI.renderMemoryAppCharList();
}

// reorderMemoryGroups(fromIdx,toIdx)
 // → 记忆中心群聊列表排序。
 // 实际排序的是 cbyd21_Group._groups，保存到 stm_groupChats。
function reorderMemoryGroups(fromIdx, toIdx){
  if(typeof cbyd21_Group === 'undefined' || !Array.isArray(cbyd21_Group._groups))return;

  var groups = cbyd21_Group._groups;

  fromIdx = Math.max(0, Math.min(groups.length - 1, parseInt(fromIdx, 10) || 0));
  toIdx = Math.max(0, Math.min(groups.length - 1, parseInt(toIdx, 10) || 0));

  if(fromIdx === toIdx)return;

  var item = groups.splice(fromIdx, 1)[0];

  if(!item)return;

  groups.splice(toIdx, 0, item);

  // 群聊排序属于 groupChats 大数据变更。
  // 统一走 cbyd21_Group._save()，避免直接写完整 localStorage。
  if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
    cbyd21_Group._save();
  }

  renderMemoryGroupList();

  if(typeof cbyd21_Reorder !== 'undefined'){
    cbyd21_Reorder.init('memoryAppGroupList', reorderMemoryGroups);
  }
}

//============================================================
// 记忆中心 — 角色/群聊 Tab切换
// ============================================================
var _memoryAppTab = 'char';

// toggleMemoryReorderMode(btnEl)
 // → 记忆中心排序按钮。
 // · 角色 Tab：排序角色列表，复用 reorderMemoryChars。
 // · 群聊 Tab：排序群聊列表，使用 reorderMemoryGroups。
 // · 切换 Tab 后不会误操作隐藏列表。
function toggleMemoryReorderMode(btnEl){
  var targetId = _memoryAppTab === 'group' ? 'memoryAppGroupList' : 'memoryAppCharList';
  var otherId = _memoryAppTab === 'group' ? 'memoryAppCharList' : 'memoryAppGroupList';

  var other = document.getElementById(otherId);
  if(other){
    other.classList.remove('reorder-mode');
    _reorderStates[otherId] = false;
  }

  if(_memoryAppTab === 'group'){
    cbyd21_Reorder.init('memoryAppGroupList', reorderMemoryGroups);
  }else{
    cbyd21_Reorder.init('memoryAppCharList', reorderMemoryChars);
  }

  toggleReorderMode(targetId, btnEl);
}

function switchMemoryTab(tab) {
  _memoryAppTab = tab;

  // 切换 Tab 时关闭两个列表的排序模式，避免隐藏列表仍处于 reorder-mode。
  ['memoryAppCharList','memoryAppGroupList'].forEach(function(id){
    var el = document.getElementById(id);

    if(el){
      el.classList.remove('reorder-mode');
    }

    if(typeof _reorderStates !== 'undefined'){
      _reorderStates[id] = false;
    }
  });

  var reorderBtn = document.getElementById('memoryReorderBtn');

  if(reorderBtn){
    reorderBtn.classList.remove('active');
  }

  document.querySelectorAll('#memoryApp [data-memtab]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.memtab === tab);
  });

  var charList = document.getElementById('memoryAppCharList');
  var charEmpty = document.getElementById('memoryAppEmpty');
  var groupList = document.getElementById('memoryAppGroupList');
  var groupEmpty = document.getElementById('memoryAppGroupEmpty');

  if (tab === 'char') {
    if (charList) charList.style.display = '';
    if (charEmpty) charEmpty.style.display = '';
    if (groupList) groupList.style.display = 'none';
    if (groupEmpty) groupEmpty.style.display = 'none';
    cbyd21_UI.renderMemoryAppCharList();

    if(typeof cbyd21_Reorder !== 'undefined'){
      cbyd21_Reorder.init('memoryAppCharList', reorderMemoryChars);
    }
  } else {
    if (charList) charList.style.display = 'none';
    if (charEmpty) charEmpty.style.display = 'none';
    if (groupList) groupList.style.display = '';
    if (groupEmpty) groupEmpty.style.display = '';
    renderMemoryGroupList();

    if(typeof cbyd21_Reorder !== 'undefined'){
      cbyd21_Reorder.init('memoryAppGroupList', reorderMemoryGroups);
    }
  }
}

// _openMemoryGroupOfflineSessionMenu() → 群聊记忆面板里的线下session选择菜单
function _openMemoryGroupOfflineSessionMenu() {
  if (!_memoryCharId || !_memoryCharId.startsWith('group_')) return;
  var sessions = _getGroupOfflineSessionsForMemory(_memoryCharId);
  if (sessions.length === 0) { showToast('当前群聊分支没有线下记录'); return; }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var allDiv = document.createElement('div');
  allDiv.className = 'add-char-item';
  allDiv.style.padding = '12px 16px';
  var isAll = !_memoryOfflineSessionId;
  allDiv.innerHTML = '<div style="flex:1;font-size:14px;color:' + (isAll ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isAll ? '600' : '400') + '">全部群聊线下记录</div>' + (isAll ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
  allDiv.onclick = function() { closeModal('addCharModal'); _memoryOfflineSessionId = null; _memoryOfflineSaveId = null; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
  container.appendChild(allDiv);

  sessions.forEach(function(s, i) {
    var sessionNum = sessions.length - i;
    var msgCount = s.messages.length;
    var statusText = s.status === 'active' ? '进行中' : '已结束';
    var statusColor = s.status === 'active' ? 'var(--accent)' : 'var(--text-muted)';
    var isCurrent = s.id === _memoryOfflineSessionId;
    var timeStr = s.created ? formatTime(s.created) : '';
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + '">第' + sessionNum + '次群聊线下</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="color:' + statusColor + '">' + statusText + '</span> · ' + msgCount + '条消息 · ' + timeStr + '</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
    div.onclick = function() { closeModal('addCharModal'); _memoryOfflineSessionId = s.id; _memoryOfflineSaveId = null; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '🤝 选择群聊线下记录';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _openMemoryGroupOfflineSaveMenu() → 群聊记忆面板里的线下存档选择菜单
function _openMemoryGroupOfflineSaveMenu() {
  if (!_memoryOfflineSessionId || !_memoryCharId || !_memoryCharId.startsWith('group_')) return;
  var sessions = _getGroupOfflineSessionsForMemory(_memoryCharId);
  var session = sessions.find(function(s) { return s.id === _memoryOfflineSessionId; });
  if (!session || !session._saves || session._saves.length === 0) { showToast('该次群聊线下没有存档'); return; }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  var allDiv = document.createElement('div');
  allDiv.className = 'add-char-item';
  allDiv.style.padding = '12px 16px';
  var isAll = !_memoryOfflineSaveId;
  allDiv.innerHTML = '<div style="flex:1;font-size:14px;color:' + (isAll ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isAll ? '600' : '400') + '">全部（含存档）</div>' + (isAll ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
  allDiv.onclick = function() { closeModal('addCharModal'); _memoryOfflineSaveId = null; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
  container.appendChild(allDiv);

  var currentDiv = document.createElement('div');
  currentDiv.className = 'add-char-item';
  currentDiv.style.padding = '12px 16px';
  var isCurrent = _memoryOfflineSaveId === 'current';
  currentDiv.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + '">当前进度</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + session.messages.length + '条消息</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
  currentDiv.onclick = function() { closeModal('addCharModal'); _memoryOfflineSaveId = 'current'; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
  container.appendChild(currentDiv);

  session._saves.slice().reverse().forEach(function(sv) {
    var svTime = new Date(sv.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    var isSelected = _memoryOfflineSaveId === sv.id;
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isSelected ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isSelected ? '600' : '400') + '">💾 ' + escHtml(sv.label) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + sv.messages.length + '条消息 · ' + svTime + '</div></div>' + (isSelected ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
    div.onclick = function() { closeModal('addCharModal'); _memoryOfflineSaveId = sv.id; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '💾 选择群聊线下存档';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// _openMemoryOfflineSessionMenu() → 记忆面板里的线下session选择菜单
function _openMemoryOfflineSessionMenu() {
  var charId = _memoryCharId;
  if (!charId) return;
  var sessions = cbyd21_Offline._sessions[charId] || [];
  var _currentBid = currentChatId;
  var branchSessions = sessions.filter(function(s) {
    var hasMessages = s.messages && s.messages.length >= 1;
    var hasSaves = s._saves && s._saves.length > 0;
    return s._onlineBranchId === _currentBid && (hasMessages || hasSaves);
  });
  if (branchSessions.length === 0) { showToast('当前分支没有线下记录'); return; }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  // "全部"选项
  var allDiv = document.createElement('div');
  allDiv.className = 'add-char-item';
  allDiv.style.padding = '12px 16px';
  var isAll = !_memoryOfflineSessionId;
  allDiv.innerHTML = '<div style="flex:1;font-size:14px;color:' + (isAll ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isAll ? '600' : '400') + '">全部线下记录</div>' + (isAll ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
  allDiv.onclick = function() { closeModal('addCharModal'); _memoryOfflineSessionId = null; _memoryOfflineSaveId = null; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
  container.appendChild(allDiv);

  branchSessions.forEach(function(s, i) {
    var sessionNum = branchSessions.length - i;
    var msgCount = s.messages.length;
    var statusText = s.status === 'active' ? '进行中' : '已结束';
    var statusColor = s.status === 'active' ? 'var(--accent)' : 'var(--text-muted)';
    var isCurrent = s.id === _memoryOfflineSessionId;
    var timeStr = s.created ? formatTime(s.created) : '';
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + '">第' + sessionNum + '次见面</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="color:' + statusColor + '">' + statusText + '</span> · ' + msgCount + '条消息 · ' + timeStr + '</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
    div.onclick = function() { closeModal('addCharModal'); _memoryOfflineSessionId = s.id; _memoryOfflineSaveId = null; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '🤝 选择见面记录';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}


// _openMemoryOfflineSaveMenu() → 记忆面板里的存档选择菜单
function _openMemoryOfflineSaveMenu() {
  if (!_memoryOfflineSessionId || !_memoryCharId) return;
  var sessions = cbyd21_Offline._sessions[_memoryCharId] || [];
  var _currentBid = currentChatId;
  var branchSessions = sessions.filter(function(s) { return s._onlineBranchId === _currentBid; });
  var session = branchSessions.find(function(s) { return s.id === _memoryOfflineSessionId; });
  if (!session || !session._saves || session._saves.length === 0) { showToast('该次见面没有存档'); return; }

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  // "全部"选项
  var allDiv = document.createElement('div');
  allDiv.className = 'add-char-item';
  allDiv.style.padding = '12px 16px';
  var isAll = !_memoryOfflineSaveId;
  allDiv.innerHTML = '<div style="flex:1;font-size:14px;color:' + (isAll ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isAll ? '600' : '400') + '">全部（含存档）</div>' + (isAll ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
  allDiv.onclick = function() { closeModal('addCharModal'); _memoryOfflineSaveId = null; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
  container.appendChild(allDiv);

  // 当前进度
  var currentDiv = document.createElement('div');
  currentDiv.className = 'add-char-item';
  currentDiv.style.padding = '12px 16px';
  var isCurrent = _memoryOfflineSaveId === 'current';
  currentDiv.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + '">当前进度</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + session.messages.length + '条消息</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
  currentDiv.onclick = function() { closeModal('addCharModal'); _memoryOfflineSaveId = 'current'; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
  container.appendChild(currentDiv);

  // 各存档
  session._saves.slice().reverse().forEach(function(sv) {
    var svTime = new Date(sv.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    var isSelected = _memoryOfflineSaveId === sv.id;
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isSelected ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isSelected ? '600' : '400') + '">💾 ' + escHtml(sv.label) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + sv.messages.length + '条消息 · ' + svTime + '</div></div>' + (isSelected ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');
    div.onclick = function() { closeModal('addCharModal'); _memoryOfflineSaveId = sv.id; renderMemoryDetailList(); try { cbyd21_UI.renderMemoryList(); } catch(e) {} };
    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '💾 选择存档';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// renderMemoryGroupList() →渲染记忆中心的群聊列表
function renderMemoryGroupList() {
  var container = document.getElementById('memoryAppGroupList');
  var empty = document.getElementById('memoryAppGroupEmpty');
  if (!container) return;
  container.innerHTML = '';

  var groups = cbyd21_Group._groups || [];
  if (groups.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  groups.forEach(function(g) {
    var memKey = 'group_' + g.id;
    var memories = charMemories[memKey] || [];
    var total = memories.length;
    var onlineCount = 0, offlineCount = 0;
    memories.forEach(function(m) {
      var c = m.content || '';
      if (c.startsWith('[线下群聊]')) offlineCount++;
      else if (c.startsWith('[群聊]')) onlineCount++;else onlineCount++;
    });
    var parts = [];
    if (onlineCount > 0) parts.push('💬' + onlineCount);
    if (offlineCount > 0) parts.push('🤝' + offlineCount);
    var countText = total > 0 ? (total + ' 条· ' + parts.join(' ')) : '暂无记忆';

    // 群头像
    var avatarHtml = '';
    if (g._avatar) {
      avatarHtml = '<img src="' + g._avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      avatarHtml = '<span style="font-size:14px">👥</span>';
    }

    var div = document.createElement('div');
    div.className = 'msg-list-item';
    div.innerHTML = '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div><div class="msg-list-avatar">' + avatarHtml + '</div><div class="msg-list-info"><div class="msg-list-name">' + escHtml(g.name) + '</div><div class="msg-list-preview">' + countText + '</div></div><span style="font-size:12px;color:var(--text-muted)">→</span>';
    div.onclick = function() {
      openGroupMemoryDetailPage(g.id);
    };
    container.appendChild(div);
  });
}

// openGroupMemoryDetailPage(groupId) → 打开群聊记忆详情页
// ·复用角色记忆详情页的UI，但key用'group_' + groupId
// · 只显示线上和线下两个类型筛选
function openGroupMemoryDetailPage(groupId) {
  var memKey = 'group_' + groupId;
  _memoryCharId = memKey;
  _memoryFilter = 'all';
  _memoryBatchDeleteMode = false;
  _memoryBatchSelectedIds = {};

  var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
  document.getElementById('memoryDetailTitle').textContent = (group ? group.name : '群聊') + ' ·记忆管理';

  //渲染群聊分支选择器
  _renderGroupMemoryBranchSelector(groupId);

  // 群聊记忆不显示通话筛选Tab
  document.querySelectorAll('#memoryDetailPage [data-memfilter]').forEach(function(el) {
    var f = el.dataset.memfilter;
    if (f === 'call') { el.style.display = 'none'; }
    else { el.style.display = ''; }
    el.classList.toggle('active', f === 'all');
  });

  // 群聊记忆不显示通话自动总结开关
  var autoCall = document.getElementById('memDetailAutoCall');
  if (autoCall) autoCall.closest('.toggle-row').style.display = 'none';

  // 群聊连通范围：显示按钮，更新标签
  var _groupObj = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
  if (_groupObj) updateMemoryDetailScopeLabel(_groupObj);

  // 加载设置
  var settings = getMemorySettings(memKey);
  var autoMods = settings.autoSummaryModules || [];
  if (!settings.autoSummaryModules && settings.autoSummary) { autoMods = ['online', 'offline']; }
  document.getElementById('memDetailAutoOnline').checked = autoMods.indexOf('online') >= 0;
  document.getElementById('memDetailAutoOffline').checked = autoMods.indexOf('offline') >= 0;
  document.getElementById('memDetailInterval').value = settings.interval || 20;
  document.getElementById('memDetailSummaryPrompt').value = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
  document.getElementById('memDetailCustomPrompt').value = settings.customPrompt || '';

  var _groupMemDetailFailToggle=document.getElementById('memDetailShowFailToast');
  if(_groupMemDetailFailToggle)_groupMemDetailFailToggle.checked=localStorage.getItem('stm_muteAutoSummaryError')!=='on';

  _renderAutoSummaryProgress(_memoryCharId, 'memDetailAutoProgress');

  renderMemoryDetailList();
  // 确保memoryApp可见（从线下/群聊入口进来时memoryApp可能没打开）
  var memApp = document.getElementById('memoryApp');
  if (!memApp.classList.contains('active')) {
    memApp.classList.add('active');
    memApp.style.zIndex = '200';
  }
  document.getElementById('memoryDetailPage').classList.add('active');
  _pushInnerPageState('groupMemoryDetailPage');
}

// 群聊记忆的当前分支ID
var _currentGroupMemBranchId = null;

// _renderGroupMemoryBranchSelector(groupId) →渲染群聊记忆分支选择器
function _renderGroupMemoryBranchSelector(groupId) {
  var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
  if (!group || !group.branches) return;

  var container = document.getElementById('memoryBranchSelector');
  if (!container) {
    var detailScroll = document.querySelector('#memoryDetailPage .app-scroll');
    if (!detailScroll) return;
    container = document.createElement('div');
    container.id = 'memoryBranchSelector';
    container.style.cssText = 'padding:0 16px 8px';
    var firstChild = detailScroll.querySelector('div');
    if (firstChild) detailScroll.insertBefore(container, firstChild);else detailScroll.appendChild(container);
  }
  container.style.display = '';

  // 确定当前分支
  var currentBranch = null;
  if (_currentGroupMemBranchId) {
    currentBranch = group.branches.find(function(b) { return b.id === _currentGroupMemBranchId; });
  }
  if (!currentBranch) {
    var lastIdx = group._lastBranchId ? group.branches.findIndex(function(b) { return b.id === group._lastBranchId; }) : -1;
    currentBranch = lastIdx >= 0 ? group.branches[lastIdx] : group.branches[0];
    _currentGroupMemBranchId = currentBranch ? currentBranch.id : null;
  }

  var branchName = currentBranch ? '分支' + (group.branches.length - group.branches.indexOf(currentBranch)) : '未选择';
  var branchCount = group.branches.length;

  container.innerHTML = '<div onclick="_openGroupMemoryBranchMenu(\'' + groupId + '\')" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background 0.15s"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(branchName) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px">' + branchCount + ' 个分支·点击切换</div></div><span style="font-size:12px;color:var(--text-muted)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span></div>';
}

// _openGroupMemoryBranchMenu(groupId) →弹出群聊分支选择菜单
function _openGroupMemoryBranchMenu(groupId) {
  var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
  if (!group || !group.branches) return;

  var container = document.getElementById('addCharList');
  container.innerHTML = '';

  group.branches.forEach(function(b, i) {
    var isCurrent = b.id === _currentGroupMemBranchId;
    var branchNum = group.branches.length - i;
    var msgCount = b.messages ? b.messages.length : 0;
    var lastVisible = msgCount > 0 && cbyd21_UI.getLastVisibleMsgForPreview
      ? cbyd21_UI.getLastVisibleMsgForPreview(b.messages)
      : null;
    var preview = lastVisible ? lastVisible.preview : '空对话';

    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '12px 16px';
    div.innerHTML = '<div style="flex:1;min-width:0"><div style="font-size:14px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-primary)') + ';font-weight:' + (isCurrent ? '600' : '400') + '">分支' + branchNum + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + msgCount + ' 条消息 · ' + escHtml(preview) + '</div></div>' + (isCurrent ? '<span style="color:var(--accent);font-size:13px">✓</span>' : '');

    div.onclick = function() {
      closeModal('addCharModal');
      _currentGroupMemBranchId = b.id;
      _memoryOfflineSessionId = null;
      _memoryOfflineSaveId = null;
      // 同步线上分支
      cbyd21_Group._currentBranchIdx = i;
      cbyd21_Group._messages = b.messages;
      group._lastBranchId = b.id;

      // 群聊分支状态属于 groupChats 大数据。
      // 统一走 cbyd21_Group._save()，避免直接写完整 localStorage。
      if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
        cbyd21_Group._save();
      }

      // 同步线下session
      if (group._offlineSessions) {
        var _boundOff = group._offlineSessions.find(function(s) { return s.status === 'active' && s._branchId === b.id; });
        if (_boundOff && cbyd21_Offline._isGroupMode && cbyd21_Offline._groupId === group.id) {
          cbyd21_Offline._sessionId = _boundOff.id;
          cbyd21_Offline._messages = _boundOff.messages;
        }
      }
      //刷新分支选择器和记忆列表
      _renderGroupMemoryBranchSelector(groupId);
      renderMemoryDetailList();showToast('已切换到分支' + branchNum);
    };

    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '选择分支';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

