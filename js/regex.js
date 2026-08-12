// ============================================================
// 正则替换 APP
// ============================================================
// 【数据】
// _regexRules → 全局正则规则列表，存 localStorage
//   每条规则: { id, name, pattern, replace, timing, enabled }
//   timing: 'input'=发送前 / 'output'=显示时 / 'both'=两者都
//
// 【管理界面】
// cbyd21_UI.renderRegexList(
// )       → 渲染规则列表
// openRegexEntryModal(i)  → 打开新建/编辑规则弹窗（i=null为新建）
// saveRegexEntry()        → 保存规则
// deleteRegexEntry(i)     → 删除规则
// toggleRegexEntry(i,on)  → 启用/禁用规则
//
// 【执行】
// applyRegexRules(text,timing) → 对文本执行所有匹配timing的已启用规则
//   · timing='input' → buildRequest里调用，改发给AI的内容
//   · timing='output' → processContent里调用，改显示内容
var _regexRules=_safeLocalJson('stm_regexRules', []);
var _regexEditIdx=null;
var _regexScope='global';
var _regexCharId=null;
var _regexBatchDeleteMode=false;
var _regexBatchSelectedKeys={};

function _regexRuleKey(rule,idx){
  if(rule && rule.id)return String(rule.id);

  return 'idx_' + idx + '_' +
    String(rule && rule.name || '') + '|' +
    String(rule && rule.pattern || '') + '|' +
    String(rule && rule.replace || '');
}

function toggleRegexBatchDeleteMode(){
  if(_regexScope === 'char' && !_regexCharId){
    showToast('请先选择一个角色，再批量删除该角色的正则');
    return;
  }

  _regexBatchDeleteMode = !_regexBatchDeleteMode;
  _regexBatchSelectedKeys = {};

  cbyd21_UI.renderRegexList();

  showToast(_regexBatchDeleteMode ? '正则批量删除已开启' : '正则批量删除已关闭');
}

function toggleRegexBatchSelect(idx,on){
  var list = _getRegexCurrentRuleList();

  if(!list || !list[idx])return;

  var key = _regexRuleKey(list[idx],idx);

  if(on){
    _regexBatchSelectedKeys[key] = true;
  }else{
    delete _regexBatchSelectedKeys[key];
  }

  var count = Object.keys(_regexBatchSelectedKeys).length;
  var el = document.getElementById('regexBatchDeleteCount');

  if(el){
    el.textContent = count;
  }
}

function toggleRegexBatchSelectAll(){
  var list = _getRegexCurrentRuleList();

  if(!list || list.length === 0){
    showToast('没有可选择的正则');
    return;
  }

  var allSelected = list.every(function(rule, idx){
    return !!_regexBatchSelectedKeys[_regexRuleKey(rule, idx)];
  });

  _regexBatchSelectedKeys = {};

  if(!allSelected){
    list.forEach(function(rule, idx){
      _regexBatchSelectedKeys[_regexRuleKey(rule, idx)] = true;
    });
  }

  cbyd21_UI.renderRegexList();
}

async function deleteSelectedRegexRules(){
  var list = _getRegexCurrentRuleList();

  if(!list)return;

  var selected = Object.keys(_regexBatchSelectedKeys || {});

  if(selected.length === 0){
    showToast('请先选择正则');
    return;
  }

  var yes = await customConfirm('确认删除选中的 ' + selected.length + ' 条正则规则？');

  if(!yes)return;

  for(var i = list.length - 1; i >= 0; i--){
    var key = _regexRuleKey(list[i],i);

    if(_regexBatchSelectedKeys[key]){
      list.splice(i,1);
    }
  }

  _regexBatchSelectedKeys = {};
  _regexBatchDeleteMode = false;

  _saveRegexCurrentRuleList();
  cbyd21_UI.renderRegexList();

  showToast('已删除所选正则');
}

// _normalizeRegexFlags(flags)
// → 清理正则 flags。
// g 自动启用；允许 i / m / s / u / y。
// 不允许 d/v 等兼容性较新的 flags，避免部分移动端浏览器报错。
function _normalizeRegexFlags(flags){
  flags = String(flags || '').toLowerCase();

  var out = 'g';

  ['i','m','s','u','y'].forEach(function(f){
    if(flags.indexOf(f) >= 0 && out.indexOf(f) < 0){
      out += f;
    }
  });

  return out;
}

// _normalizeImportedRegexPattern(pattern)
// → 酒馆正则可能写成 /xxx/g，也可能直接写 xxx。
// 小手机正则输入框只保存正则主体，不保存两边斜杠和 flags。
function _parseImportedRegexPatternAndFlags(pattern){
  pattern = String(pattern || '').trim();

  if(!pattern){
    return {
      pattern:'',
      flags:''
    };
  }

  // 只把明确带合法 flags 的 /pattern/flags 当成酒馆 slash-regex。
  // 没有 flags 的 /pattern/ 保留原样，避免误剥用户本来想匹配的首尾斜杠。
  var m = pattern.match(/^\/([\s\S]*)\/([a-z]+)$/i);

  if(m && m[1] !== undefined){
    var rawFlags = String(m[2] || '').toLowerCase();

    // 只接受当前前端支持的 flags。
    // 如果尾部不是合法 flags，就把整段当普通 pattern 保留。
    if(/^[gimsuy]+$/.test(rawFlags)){
      return {
        pattern:m[1],
        flags:_normalizeRegexFlags(rawFlags)
      };
    }
  }

  return {
    pattern:pattern,
    flags:''
  };
}

function _normalizeImportedRegexPattern(pattern){
  return _parseImportedRegexPatternAndFlags(pattern).pattern;
}

// _convertTavernRegexScriptToRule(raw,idx)
// → 把酒馆 regex_scripts 的常见字段转成小手机角色正则。
// 默认 enabled=false，先可见，不自动启用。
function _convertTavernRegexScriptToRule(raw,idx){
  raw = raw || {};

  var name = '';
  var pattern = '';
  var replace = '';

  if(typeof raw === 'string'){
    pattern = raw;
    name = '酒馆正则 ' + (idx + 1);
  }else{
    name =
      raw.scriptName ||
      raw.name ||
      raw.title ||
      raw.comment ||
      ('酒馆正则 ' + (idx + 1));

    pattern =
      raw.findRegex ||
      raw.regex ||
      raw.pattern ||
      raw.find ||
      raw.match ||
      raw.matchRegex ||
      '';

    replace =
      raw.replaceString ||
      raw.replace ||
      raw.replacement ||
      raw.substitute ||
      raw.substitution ||
      '';
  }

  var parsedPattern = _parseImportedRegexPatternAndFlags(pattern);
  pattern = parsedPattern.pattern;

  if(!pattern)return null;

  var importedFlags = parsedPattern.flags || 'g';

  // 酒馆状态栏 / XML样式面板正则常用 .*? 串联多个标签。
  // JavaScript 默认 . 不匹配换行，这类规则导入后通常需要 s 才能跨行匹配。
  // 这里只补 flags，不改 pattern，避免误伤用户正则内容。
  if(
    importedFlags.indexOf('s') < 0 &&
    /<[^>]+>[\s\S]*<\/[^>]+>/.test(pattern) &&
    /\.\*\?/.test(pattern)
  ){
    importedFlags = _normalizeRegexFlags(importedFlags + 's');
  }

  return {
    id:'regex_tavern_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2,6),
    name:String(name || ('酒馆正则 ' + (idx + 1))).trim(),
    pattern:pattern,
    flags:importedFlags,
    replace:String(replace || ''),
    scopeUserInput:false,
    scopeAiOutput:true,
    enabled:false,
    source:'tavern',
    raw:raw,
    _updatedAt:Date.now()
  };
}

// _convertTavernRegexScriptsToRules(list)
// → 批量转换酒馆正则，过滤掉无法识别 pattern 的项目。
function _convertTavernRegexScriptsToRules(list){
  if(!Array.isArray(list))return [];

  return list.map(function(raw,idx){
    return _convertTavernRegexScriptToRule(raw,idx);
  }).filter(Boolean);
}

// _ensureCharRegexFromTavern(ch)
// → 如果角色有 _tavernRaw.regexScripts，但还没进入 ch._regexRules，自动补进角色正则。
// 用于兼容之前已经导入过酒馆卡的角色。
function _ensureCharRegexFromTavern(ch){
  if(!ch)return false;

  if(!Array.isArray(ch._regexRules)){
    ch._regexRules = [];
  }

  var rawList = ch._tavernRaw && Array.isArray(ch._tavernRaw.regexScripts)
    ? ch._tavernRaw.regexScripts
    : [];

  if(rawList.length === 0)return false;

  var converted = _convertTavernRegexScriptsToRules(rawList);

  if(converted.length === 0)return false;

  var changed = false;

  converted.forEach(function(rule){
    var exists = ch._regexRules.some(function(r){
      return r &&
        r.source === 'tavern' &&
        String(r.pattern || '') === String(rule.pattern || '') &&
        String(r.replace || '') === String(rule.replace || '');
    });

    if(!exists){
      ch._regexRules.push(rule);
      changed = true;
    }
  });

  if(changed){
    ch._updatedAt = Date.now();
    cbyd21_Data.saveCharacters();
  }

  return changed;
}

// _getRegexCurrentRuleList()
// → 当前正则 App 正在编辑的规则数组。
// global = _regexRules
// char = 当前角色 ch._regexRules
function _getRegexCurrentRuleList(){
  if(_regexScope !== 'char'){
    return _regexRules;
  }

  var ch = _regexCharId ? getCharById(_regexCharId) : null;

  if(!ch)return null;

  _ensureCharRegexFromTavern(ch);

  if(!Array.isArray(ch._regexRules)){
    ch._regexRules = [];
  }

  return ch._regexRules;
}

// _saveRegexCurrentRuleList()
// → 根据当前正则范围保存。
function _saveRegexCurrentRuleList(){
  if(_regexScope === 'char'){
    var ch = _regexCharId ? getCharById(_regexCharId) : null;

    if(ch){
      ch._updatedAt = Date.now();
      cbyd21_Data.saveCharacters();
    }

    return;
  }

  localStorage.setItem('stm_regexRules',JSON.stringify(_regexRules));
}

// switchRegexTab(tab)
// → 切换全局正则 / 角色正则。
function switchRegexTab(tab){
  _regexScope = tab === 'char' ? 'char' : 'global';
  _regexBatchDeleteMode = false;
  _regexBatchSelectedKeys = {};

  document.querySelectorAll('#regexApp [data-regex-tab]').forEach(function(el){
    el.classList.toggle('active', el.dataset.regexTab === _regexScope);
  });

  if(_regexScope === 'global'){
    _regexCharId = null;
  }

  cbyd21_UI.renderRegexList();

  if(typeof cbyd21_Reorder !== 'undefined'){
    cbyd21_Reorder.init('regexListContainer',reorderRegex);
  }
}

// _regexSafeListPreviewText(text,maxLen)
// → 正则列表专用安全预览。
// 只影响列表显示，不修改真实 pattern / replace。
// 用于防止酒馆状态栏 HTML、长标签、超长无空格内容把正则条目撑高或看起来像被渲染。
function _regexSafeListPreviewText(text,maxLen){
  var s = String(text == null ? '' : text);

  maxLen = maxLen || 90;

  s = s
    .replace(/\r/g,'')
    .replace(/\n+/g,' ⏎ ')
    .replace(/\s{2,}/g,' ')
    .trim();

  // HTML / XML 标签在列表里只做视觉转写。
  // 真实内容仍保存在规则对象里，编辑弹窗可查看完整 pattern。
  // 这里把 <标签> 显示成 ‹标签›，避免用户误以为 HTML 被渲染进条目。
  s = s.replace(/<[^>]{0,80}>/g,function(tag){
    tag = String(tag || '');

    var visual = tag
      .replace(/^</,'‹')
      .replace(/>$/,'›');

    if(visual.length <= 18){
      return visual;
    }

    return visual.slice(0, 15) + '…›';
  });

  // 兜底：连续超长无空格片段压缩，避免撑宽条目。
  s = s.replace(/[^\s]{60,}/g,function(chunk){
    return chunk.slice(0, 36) + '…' + chunk.slice(-12);
  });

  if(s.length > maxLen){
    return s.slice(0,maxLen) + '…';
  }

  return s;
}



// 渲染正则规则列表
// · 列表里显示规则名、替换内容、作用范围、启用状态
// · 兼容旧版 timing 字段
cbyd21_UI.renderRegexList = function(){
  var c=document.getElementById('regexListContainer');
  if(!c)return;

  c.innerHTML='';

  // 角色正则：未选角色时先显示角色列表。
  if(_regexScope === 'char' && !_regexCharId){
    var charList = characters.filter(function(ch){
      return ch && ch.id !== DEFAULT_CHAR_ID;
    });

    if(charList.length === 0){
      c.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;line-height:1.8">还没有角色<br>先去通讯录创建角色</div>';
      return;
    }

    var hint=document.createElement('div');
    hint.style.cssText='padding:12px 14px;margin-bottom:10px;background:rgba(124,111,155,0.08);border:1px solid rgba(124,111,155,0.16);border-radius:10px;font-size:12px;color:var(--text-muted);line-height:1.6';
    hint.innerHTML='角色正则只属于单个角色。酒馆卡导入的正则会显示在对应角色这里，默认关闭，需手动启用。';
    c.appendChild(hint);

    charList.forEach(function(ch){
      _ensureCharRegexFromTavern(ch);

      var list = Array.isArray(ch._regexRules) ? ch._regexRules : [];
      var tavernCount = list.filter(function(r){
        return r && r.source === 'tavern';
      }).length;

      var avatarHtml = ch.avatar ? '<img src="'+ch.avatar+'">' : escHtml((ch.name||'角').charAt(0));
      var div=document.createElement('div');
      div.className='msg-list-item';
      div.innerHTML=
        '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div>'+
        '<div class="msg-list-avatar">'+avatarHtml+'</div>'+
        '<div class="msg-list-info">'+
          '<div class="msg-list-name">'+escHtml(ch.name||'未命名角色')+'</div>'+
          '<div class="msg-list-preview">'+list.length+' 条角色正则'+(tavernCount?(' · '+tavernCount+' 条来自酒馆卡'):'')+'</div>'+
        '</div>'+
        '<span style="font-size:12px;color:var(--text-muted)">→</span>';

      div.onclick=function(){
        _regexCharId=ch.id;
        cbyd21_UI.renderRegexList();
      };

      c.appendChild(div);
    });

    return;
  }

  var list = _getRegexCurrentRuleList();

  if(!list){
    c.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;line-height:1.8">请先选择角色</div>';
    return;
  }

  if(_regexScope === 'char'){
    var ch = getCharById(_regexCharId);

    var top=document.createElement('div');
    top.style.cssText='padding:12px 14px;margin-bottom:10px;background:rgba(124,111,155,0.08);border:1px solid rgba(124,111,155,0.16);border-radius:10px;font-size:12px;color:var(--text-muted);line-height:1.6';
    top.innerHTML=
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
        '<div><div style="font-size:13px;font-weight:700;color:var(--text-primary)">当前角色：'+escHtml(ch?ch.name:'未知角色')+'</div>'+
        '<div style="margin-top:2px">角色正则只影响这个角色。酒馆正则默认关闭，启用前请先检查规则。</div></div>'+
        '<button class="btn-sm" type="button" onclick="_regexCharId=null;cbyd21_UI.renderRegexList()">返回角色列表</button>'+
      '</div>';
    c.appendChild(top);
  }

  if(list.length===0){
    c.innerHTML += '<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;line-height:1.8">还没有'+(_regexScope==='char'?'角色':'全局')+'正则规则<br>点右上角 ＋ 添加</div>';
    return;
  }

  if(_regexBatchDeleteMode){
    var bar=document.createElement('div');
    var selectedCount = Object.keys(_regexBatchSelectedKeys || {}).length;

    bar.style.cssText='display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:10px;background:rgba(196,92,92,0.08);border:1px solid rgba(196,92,92,0.18);border-radius:10px;font-size:12px;color:var(--text-secondary)';
    bar.innerHTML=
      '<span style="flex:1">已选 <strong id="regexBatchDeleteCount">'+selectedCount+'</strong> 条正则</span>' +
      '<button class="btn-sm" onclick="toggleRegexBatchSelectAll()">全选 / 取消</button>' +
      '<button class="btn-sm danger" onclick="deleteSelectedRegexRules()">删除所选</button>' +
      '<button class="btn-sm" onclick="toggleRegexBatchDeleteMode()">退出</button>';
    c.appendChild(bar);
  }

  list.forEach(function(r,i){
    var on=r.enabled!==false;

    var useUserInput=!!r.scopeUserInput;
    var useAiOutput=!!r.scopeAiOutput;

    if(!useUserInput&&!useAiOutput){
      var oldTiming=r.timing||'output';
      if(oldTiming==='input'){
        useUserInput=true;
      }else if(oldTiming==='output'){
        useAiOutput=true;
      }else if(oldTiming==='both'){
        useUserInput=true;
        useAiOutput=true;
      }
    }

    var scopeLabel='';
    if(useUserInput&&useAiOutput){
      scopeLabel='用户输入 / AI输出';
    }else if(useUserInput){
      scopeLabel='用户输入';
    }else{
      scopeLabel='AI输出';
    }

    var sourceLabel = r.source === 'tavern'
      ? (on ? ' · 来自酒馆卡' : ' · 来自酒馆卡 · 默认关闭')
      : '';

    var previewPattern = _regexSafeListPreviewText(r.pattern, 90);
    var previewReplace = _regexSafeListPreviewText(r.replace || '(删除)', 70);
    var previewFlags = _normalizeRegexFlags(r.flags || 'g');
    var fullPreviewTitle = '/' + _regexSafeListPreviewText(r.pattern, 180) + '/' + previewFlags + ' → ' + _regexSafeListPreviewText(r.replace || '(删除)', 120);

    var ruleKey = _regexRuleKey(r,i);
    var batchChecked = !!_regexBatchSelectedKeys[ruleKey];

    var div=document.createElement('div');
    div.className='wb-entry'+(on?'':' wb-disabled');
    div.innerHTML=
      '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div>'+
      (_regexBatchDeleteMode?'<input type="checkbox" class="regex-batch-cb" '+(batchChecked?'checked':'')+' onclick="event.stopPropagation()" onchange="toggleRegexBatchSelect('+i+',this.checked)" style="display:block;width:18px;height:18px;accent-color:var(--danger);flex-shrink:0;margin-right:4px">':'')+
      '<div class="wb-entry-info" onclick="if(_regexBatchDeleteMode){var cb=this.parentNode.querySelector(&quot;.regex-batch-cb&quot;);if(cb){cb.checked=!cb.checked;toggleRegexBatchSelect('+i+',cb.checked)}}else{openRegexEntryModal('+i+')}" style="cursor:pointer;flex:1;min-width:0">'+
        '<div class="wb-entry-name">'+escHtml(r.name||'未命名')+'</div>'+
        '<div class="wb-entry-keys regex-rule-preview" title="'+escHtml(fullPreviewTitle)+'" style="font-family:monospace;font-size:10px">/'+escHtml(previewPattern)+'/'+escHtml(previewFlags)+' → '+escHtml(previewReplace)+'</div>'+
        '<div class="wb-entry-keys">'+scopeLabel+sourceLabel+'</div>'+
      '</div>'+
      '<div class="wb-entry-actions">'+
        '<label class="toggle-switch toggle-sm"><input type="checkbox" '+(on?'checked':'')+' onchange="toggleRegexEntry('+i+',this.checked)"><span class="toggle-slider"></span></label>'+
        '<button class="wb-entry-btn" onclick="confirmDeleteRegex('+i+')"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V3h6v1"/><path d="M4 4l1 10h6l1-10"/></svg></button>'+
      '</div>';

    c.appendChild(div);
  });
}

// 打开正则规则编辑弹窗
// · i=null 时是新建
// · i 有值时是编辑已有规则
// · 兼容旧版 timing 字段，自动映射到“用户输入 / AI输出”两个开关
function openRegexEntryModal(i){
  _regexEditIdx=i;

  var list = _getRegexCurrentRuleList();

  if(!list){
    showToast('请先选择角色');
    return;
  }

  if(i!==null&&list[i]){
    var r=list[i];
    document.getElementById('regexEntryName').value=r.name||'';
    document.getElementById('regexEntryPattern').value=r.pattern||'';
    document.getElementById('regexEntryFlags').value=_normalizeRegexFlags(r.flags || 'g');
    document.getElementById('regexEntryReplace').value=r.replace||'';

    var useUserInput=!!r.scopeUserInput;
    var useAiOutput=!!r.scopeAiOutput;

    if(!useUserInput&&!useAiOutput){
      var oldTiming=r.timing||'output';
      if(oldTiming==='input'){
        useUserInput=true;
      }else if(oldTiming==='output'){
        useAiOutput=true;
      }else if(oldTiming==='both'){
        useUserInput=true;
        useAiOutput=true;
      }
    }

    document.getElementById('regexScopeUserInput').checked=useUserInput;
    document.getElementById('regexScopeAiOutput').checked=useAiOutput;
  }else{
    document.getElementById('regexEntryName').value='';
    document.getElementById('regexEntryPattern').value='';
    document.getElementById('regexEntryFlags').value='g';
    document.getElementById('regexEntryReplace').value='';
    document.getElementById('regexScopeUserInput').checked=false;
    document.getElementById('regexScopeAiOutput').checked=true;
  }

  openModal('regexEntryModal');
}

// 保存正则规则
// · 新版保存两个作用范围：用户输入 / AI输出
// · 至少要勾选一个范围
// · 保留 enabled 状态
function saveRegexEntry(){
  var list = _getRegexCurrentRuleList();

  if(!list){
    showToast('请先选择角色');
    return;
  }

  var p=document.getElementById('regexEntryPattern').value.trim();
  if(!p){
    showToast('请输入正则表达式');
    return;
  }

  var flags = _normalizeRegexFlags((document.getElementById('regexEntryFlags') || {}).value || 'g');

  try{
    new RegExp(p,flags);
  }catch(e){
    showToast('正则语法或 flags 错误：'+e.message);
    return;
  }

  var scopeUserInput=document.getElementById('regexScopeUserInput').checked;
  var scopeAiOutput=document.getElementById('regexScopeAiOutput').checked;

  if(!scopeUserInput&&!scopeAiOutput){
    showToast('请至少选择一个作用范围');
    return;
  }

  var entry={
    id:Date.now().toString(),
    name:document.getElementById('regexEntryName').value.trim()||'未命名',
    pattern:p,
    flags:flags,
    replace:document.getElementById('regexEntryReplace').value,
    scopeUserInput:scopeUserInput,
    scopeAiOutput:scopeAiOutput,
    enabled:true,
    source:_regexScope === 'char' ? 'manual_char' : 'manual_global',
    _updatedAt:Date.now()
  };

  if(_regexEditIdx!==null&&list[_regexEditIdx]){
    entry.enabled=list[_regexEditIdx].enabled;
    entry.id=list[_regexEditIdx].id;
    entry.source=list[_regexEditIdx].source || entry.source;
    entry.raw=list[_regexEditIdx].raw;
    list[_regexEditIdx]=entry;
  }else{
    list.push(entry);
  }

  _saveRegexCurrentRuleList();
  closeModal('regexEntryModal');
  cbyd21_UI.renderRegexList();
  showToast('规则已保存');
}

async function confirmDeleteRegex(i){
  var list = _getRegexCurrentRuleList();

  if(!list || !list[i])return;

  var _yes=await customConfirm('确认删除该正则规则？');
  if(!_yes)return;

  list.splice(i,1);
  _saveRegexCurrentRuleList();
  cbyd21_UI.renderRegexList();
  showToast('已删除');
}

function toggleRegexEntry(i,on){
  var list = _getRegexCurrentRuleList();

  if(!list || !list[i])return;

  list[i].enabled=on;
  list[i]._updatedAt=Date.now();

  _saveRegexCurrentRuleList();
  cbyd21_UI.renderRegexList();
}

// 执行正则替换
// · scope='userInput' → 用户消息发给 AI 之前处理
// · scope='aiOutput'  → AI 消息显示到前端时处理
// · 兼容旧数据：
//   timing='input'  → 视为 用户输入
//   timing='output' → 视为 AI输出
//   timing='both'   → 两边都生效
function applyRegexRules(text,scope){
  if(!text)return text;

  if(scope==='input')scope='userInput';
  if(scope==='output')scope='aiOutput';

  if(scope!=='userInput'&&scope!=='aiOutput')return text;

  function getContextCharId(){
    if(window._cbyd21RegexRuntimeCharId)return window._cbyd21RegexRuntimeCharId;
    if(currentChatCharId)return currentChatCharId;

    try{
      if(typeof cbyd21_Offline !== 'undefined' && cbyd21_Offline._charId && !cbyd21_Offline._isGroupMode){
        return cbyd21_Offline._charId;
      }
    }catch(e){}

    try{
      if(typeof cbyd21_Fate !== 'undefined' && cbyd21_Fate._charId){
        return cbyd21_Fate._charId;
      }
    }catch(e){}

    try{
      if(typeof _callCharId !== 'undefined' && _callCharId){
        return _callCharId;
      }
    }catch(e){}

    return null;
  }

  var ruleList = [];

  if(Array.isArray(_regexRules)){
    ruleList = ruleList.concat(_regexRules);
  }

  var contextCharId = getContextCharId();
  var ch = contextCharId ? getCharById(contextCharId) : null;

  if(ch){
    _ensureCharRegexFromTavern(ch);

    if(Array.isArray(ch._regexRules)){
      ruleList = ruleList.concat(ch._regexRules);
    }
  }

  if(ruleList.length === 0)return text;

  ruleList.forEach(function(r){
    if(!r || r.enabled===false)return;

    var useUserInput=!!r.scopeUserInput;
    var useAiOutput=!!r.scopeAiOutput;

    if(!useUserInput&&!useAiOutput){
      var oldTiming=r.timing||'output';
      if(oldTiming==='input'){
        useUserInput=true;
      }else if(oldTiming==='output'){
        useAiOutput=true;
      }else if(oldTiming==='both'){
        useUserInput=true;
        useAiOutput=true;
      }
    }

    if(scope==='userInput'&&!useUserInput)return;
    if(scope==='aiOutput'&&!useAiOutput)return;

    try{
      var re=new RegExp(r.pattern,_normalizeRegexFlags(r.flags || 'g'));
      text=text.replace(re,r.replace!==undefined?r.replace:'');
    }catch(e){}
  });

  return text;
}

function reorderRegex(fromIdx,toIdx){
  // 角色正则 Tab 的第一层是“角色列表”，不是正则列表。
  // 这里排序应当作用到角色顺序，而不是 _regexRules。
  if(_regexScope === 'char' && !_regexCharId){
    if(typeof reorderContacts === 'function'){
      reorderContacts(fromIdx,toIdx);
      cbyd21_UI.renderRegexList();

      if(cbyd21_UI.renderContactList){
        cbyd21_UI.renderContactList();
      }

      if(typeof cbyd21_Reorder !== 'undefined'){
        cbyd21_Reorder.init('regexListContainer',reorderRegex);
      }
    }

    return;
  }

  var list = _getRegexCurrentRuleList();

  if(!list)return;

  var item=list.splice(fromIdx,1)[0];

  if(!item)return;

  list.splice(toIdx,0,item);
  _saveRegexCurrentRuleList();
}
