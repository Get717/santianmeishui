// ===== 【模块】cbyd21_WorldBook — 世界书管理模块 =====
// · 全局世界书 + 角色世界书统一管理界面
// · 支持分组、注入位置（最前强制 / 兼容最前 / 角色前 / 角色后 / 末尾强制 / 深度）
// · 当前只拆 JS，样式仍复用主文件里的共享样式

function cbyd21_WorldBook_safeJson(key, fallback){
  try{
    var raw = localStorage.getItem(key);

    if(raw === null || raw === undefined || raw === ''){
      return fallback;
    }

    return JSON.parse(raw);
  }catch(e){
    console.warn('世界书 localStorage JSON 解析失败：', key, e);

    try{
      localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
    }catch(_e){}

    return fallback;
  }
}

var _wbBatchDeleteMode = false;
var _wbBatchSelectedIds = {};
var _wbBatchSelectedGroupIds = {};

function _worldBookBatchCountText(){
  var entryCount = Object.keys(_wbBatchSelectedIds || {}).length;
  var groupCount = Object.keys(_wbBatchSelectedGroupIds || {}).length;

  if(groupCount > 0){
    return entryCount + ' 条目 / ' + groupCount + ' 分组';
  }

  return entryCount + ' 条目';
}

function _updateWorldBookBatchDeleteCount(){
  var text = _worldBookBatchCountText();

  document.querySelectorAll('#wbBatchDeleteCount').forEach(function(el){
    if(el){
      el.textContent = text;
    }
  });
}

function _clearWorldBookBatchSelection(){
  _wbBatchSelectedIds = {};
  _wbBatchSelectedGroupIds = {};
}

function toggleWorldBookBatchDeleteMode(){
  _wbBatchDeleteMode = !_wbBatchDeleteMode;
  _clearWorldBookBatchSelection();

  cbyd21_WorldBook._refreshViews();

  showToast(_wbBatchDeleteMode ? '世界书批量删除已开启' : '世界书批量删除已关闭');
}

function toggleWorldBookBatchSelect(id,on){
  id = String(id || '');

  if(!id)return;

  if(on){
    _wbBatchSelectedIds[id] = true;
  }else{
    delete _wbBatchSelectedIds[id];
  }

  _updateWorldBookBatchDeleteCount();
}

function toggleWorldBookBatchSelectGroup(id,on){
  id = String(id || '');

  if(!id)return;

  if(on){
    _wbBatchSelectedGroupIds[id] = true;
  }else{
    delete _wbBatchSelectedGroupIds[id];
  }

  _updateWorldBookBatchDeleteCount();
}

function _getCurrentVisibleWorldBookBatchIds(){
  var ids = [];

  if(!cbyd21_WorldBook)return ids;

  var data = cbyd21_WorldBook.getCurrentData();

  if(!data)return ids;

  var groupDetailActive = false;

  try{
    var groupPage = document.getElementById('wbGroupDetailPage');
    groupDetailActive = !!(groupPage && groupPage.classList.contains('active'));
  }catch(e){}

  if(groupDetailActive && cbyd21_WorldBook._currentGroupId){
    var group = Array.isArray(data.groups)
      ? data.groups.find(function(g){
          return g && g.id === cbyd21_WorldBook._currentGroupId;
        })
      : null;

    if(group && Array.isArray(group.entries)){
      group.entries.forEach(function(e){
        if(e && e.id)ids.push(String(e.id));
      });
    }

    return ids;
  }

  if(Array.isArray(data.ungrouped)){
    data.ungrouped.forEach(function(e){
      if(e && e.id)ids.push(String(e.id));
    });
  }

  return ids;
}

function _getCurrentVisibleWorldBookBatchGroupIds(){
  var ids = [];

  if(!cbyd21_WorldBook)return ids;

  var groupDetailActive = false;

  try{
    var groupPage = document.getElementById('wbGroupDetailPage');
    groupDetailActive = !!(groupPage && groupPage.classList.contains('active'));
  }catch(e){}

  if(groupDetailActive){
    return ids;
  }

  var data = cbyd21_WorldBook.getCurrentData();

  if(!data || !Array.isArray(data.groups)){
    return ids;
  }

  data.groups.forEach(function(g){
    if(g && g.id){
      ids.push(String(g.id));
    }
  });

  return ids;
}

function toggleWorldBookBatchSelectAll(){
  var ids = _getCurrentVisibleWorldBookBatchIds();

  if(ids.length === 0){
    showToast('当前页面没有可选择的世界书条目');
    return;
  }

  var allSelected = ids.every(function(id){
    return !!_wbBatchSelectedIds[id];
  });

  ids.forEach(function(id){
    if(allSelected){
      delete _wbBatchSelectedIds[id];
    }else{
      _wbBatchSelectedIds[id] = true;
    }
  });

  cbyd21_WorldBook._refreshViews();
}

function toggleWorldBookBatchSelectAllGroups(){
  var ids = _getCurrentVisibleWorldBookBatchGroupIds();

  if(ids.length === 0){
    showToast('当前页面没有可选择的世界书分组');
    return;
  }

  var allSelected = ids.every(function(id){
    return !!_wbBatchSelectedGroupIds[id];
  });

  ids.forEach(function(id){
    if(allSelected){
      delete _wbBatchSelectedGroupIds[id];
    }else{
      _wbBatchSelectedGroupIds[id] = true;
    }
  });

  cbyd21_WorldBook._refreshViews();
}

async function deleteSelectedWorldBookEntries(){
  var entryIds = Object.keys(_wbBatchSelectedIds || {});
  var groupIds = Object.keys(_wbBatchSelectedGroupIds || {});

  if(entryIds.length === 0 && groupIds.length === 0){
    showToast('请先选择世界书条目或分组');
    return;
  }

  if(groupIds.length === 0){
    var yes = await customConfirm('确认删除选中的 ' + entryIds.length + ' 个世界书条目？');

    if(!yes)return;

    cbyd21_WorldBook._executeBatchDelete(entryIds, [], false);
    return;
  }

  openSelectedWorldBookDeleteMenu(entryIds, groupIds);
}

function openSelectedWorldBookDeleteMenu(entryIds, groupIds){
  entryIds = entryIds || [];
  groupIds = groupIds || [];

  var container = document.getElementById('addCharList');

  if(!container)return;

  container.innerHTML = '';

  var hint = document.createElement('div');
  hint.style.cssText = 'padding:16px;font-size:13px;color:var(--text-secondary);line-height:1.7;border-bottom:1px solid var(--border-soft)';
  hint.innerHTML =
    '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px">批量删除世界书</div>' +
    '<div>已选择 ' + entryIds.length + ' 个条目，' + groupIds.length + ' 个分组。</div>' +
    '<div style="margin-top:6px;color:var(--text-muted)">请选择分组里的条目要怎么处理。</div>';
  container.appendChild(hint);

  var actions = [
    {
      label:'删除所选条目 + 删除分组，条目移到未分组',
      desc:'只删除你勾选的条目；被勾选分组里的其他条目会移到未分组。',
      deleteGroupEntries:false
    },
    {
      label:'删除所选条目 + 删除分组和条目',
      desc:'删除你勾选的条目；被勾选分组里的所有条目也会一起删除。此操作不可恢复。',
      deleteGroupEntries:true,
      danger:true
    },
    {
      label:'取消',
      desc:'不执行删除。',
      cancel:true
    }
  ];

  actions.forEach(function(item){
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    div.style.flexDirection = 'column';
    div.style.alignItems = 'flex-start';
    div.style.gap = '4px';

    div.innerHTML =
      '<div style="font-size:14px;font-weight:600;color:' + (item.danger ? 'var(--danger)' : 'var(--text-primary)') + '">' + escHtml(item.label) + '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);line-height:1.5">' + escHtml(item.desc) + '</div>';

    div.onclick = function(){
      closeModal('addCharModal');

      if(item.cancel){
        return;
      }

      cbyd21_WorldBook._confirmAndExecuteBatchDelete(entryIds, groupIds, item.deleteGroupEntries);
    };

    container.appendChild(div);
  });

  document.getElementById('addCharModal').querySelector('h3').textContent = '批量删除世界书';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

var cbyd21_WorldBook = {
  // 当前世界书页签
  _currentTab: 'global',

  // 当前正在查看的角色世界书角色ID
  _currentCharId: null,

  // 当前正在编辑的条目属于哪个范围
  _editTarget: 'global',

  // 当前编辑条目的索引
  _editIdx: null,

  // 当前编辑条目原本所在的分组ID
  _editGroupId: null,

  // 当前打开的分组详情页ID
  _currentGroupId: null,

  // 当前打开的分组详情页属于 global 还是 char
  _currentGroupTarget: null,

  // 世界书角色列表的独立排序
  _charOrder: cbyd21_WorldBook_safeJson('stm_wbCharOrder', []),

  // 世界书群聊列表的独立排序
  _groupOrder: cbyd21_WorldBook_safeJson('stm_wbGroupOrder', []),

  // 把旧格式世界书迁移成新结构
  migrate: function(data) {
    if (!data) return { groups: [], ungrouped: [] };

    if (Array.isArray(data)) {
      return {
        groups: [],
        ungrouped: data.map(function(e, i) {
          if (!e.id) e.id = 'wb_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
          if (!e.position) e.position = 'after_char';
          if (!e.depth) e.depth = 4;
          return e;
        })
      };
    }

    if (data.groups || data.ungrouped) {
      if (!Array.isArray(data.groups)) data.groups = [];
      if (!Array.isArray(data.ungrouped)) data.ungrouped = [];

      data.ungrouped.forEach(function(e, i) {
        if (!e) return;
        if (!e.id) e.id = 'wb_' + Date.now() + '_u_' + i + '_' + Math.random().toString(36).slice(2, 6);
        if (!e.position) e.position = 'after_char';
        if (!e.depth) e.depth = 4;
      });

      data.groups.forEach(function(g, gi) {
        if (!g) return;
        if (!g.id) g.id = 'wbg_' + Date.now() + '_' + gi + '_' + Math.random().toString(36).slice(2, 6);
        if (!Array.isArray(g.entries)) g.entries = [];

        g.entries.forEach(function(e, ei) {
          if (!e) return;
          if (!e.id) e.id = 'wb_' + Date.now() + '_g_' + gi + '_' + ei + '_' + Math.random().toString(36).slice(2, 6);
          if (!e.position) e.position = 'after_char';
          if (!e.depth) e.depth = 4;
        });
      });

      return data;
    }

    return { groups: [], ungrouped: [] };
  },

  // 读取全局世界书数据
  getGlobalData: function() {
    var before = '';

    try{
      before = JSON.stringify(globalWorldBook || null);
    }catch(e){}

    globalWorldBook = this.migrate(globalWorldBook);

    var after = '';

    try{
      after = JSON.stringify(globalWorldBook || null);
    }catch(e){}

    if(before !== after){
      this.saveGlobal();
    }

    return globalWorldBook;
  },

  // 读取某个角色自己的世界书数据
  getCharData: function(charId) {
    // 群聊世界书：charId以__group__开头
    if (charId && charId.startsWith('__group__')) {
      var _gid = charId.slice(9);
      return this._getGroupWbData(_gid);
    }

    var ch = getCharById(charId);
    if (!ch) return { groups: [], ungrouped: [] };

    if (!ch.worldBook) ch.worldBook = { groups: [], ungrouped: [] };

    var before = '';

    try{
      before = JSON.stringify(ch.worldBook || null);
    }catch(e){}

    ch.worldBook = this.migrate(ch.worldBook);

    var after = '';

    try{
      after = JSON.stringify(ch.worldBook || null);
    }catch(e){}

    if(before !== after){
      cbyd21_Data.saveCharacters();
    }

    return ch.worldBook;
  },

  // 根据当前页面状态返回正在操作的数据
  getCurrentData: function() {
    // 分组详情页优先按分组来源判断。
    // 角色世界书详情 / 群聊世界书详情都会把 target 记为 char；
    // 群聊世界书通过 _currentCharId='__group__xxx' 路由到 _getGroupWbData。
    if (this._currentGroupId && this._currentGroupTarget === 'char' && this._currentCharId) {
      return this.getCharData(this._currentCharId);
    }

    if (this._currentGroupId && this._currentGroupTarget === 'global') {
      return this.getGlobalData();
    }

    // 只要当前有 _currentCharId，就说明正在某个角色/群聊世界书详情页。
    // 不能只判断 _currentTab === 'char'，因为群聊世界书详情页里 _currentTab 仍可能是 group。
    if (this._currentCharId) {
      return this.getCharData(this._currentCharId);
    }

    return this.getGlobalData();
  },

  // 保存全局世界书
  saveGlobal: function() {
    localStorage.setItem('stm_globalWb', JSON.stringify(globalWorldBook));
  },

  // 保存角色世界书
  saveChar: function() {
    if (this._currentCharId && this._currentCharId.startsWith('__group__')) {
      // 群聊世界书存在 group 对象上，属于 groupChats 大数据。
      // 必须走 cbyd21_Group._save()，避免绕过 IndexedDB 主存 + localStorage 小镜像 / meta。
      if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
        cbyd21_Group._save();
      }
      return;
    }
    cbyd21_Data.saveCharacters();
  },

  // 按当前范围保存世界书
  saveCurrent: function() {
    // 只要当前处于角色/群聊世界书详情页，就保存到当前对象。
    // 群聊世界书复用角色详情页 UI，_currentTab 可能仍是 group，
    // 所以不能只判断 _currentTab === 'char'。
    if (this._currentCharId) {
      this.saveChar();
    } else if (this._currentTab === 'char') {
      this.saveChar();
    } else {
      this.saveGlobal();
    }
  },

  // 把分组结构拍平成条目数组，供 buildRequest 使用
  getAllEntries: function(data) {
    var entries = [];
    if (!data) return entries;

    if (data.ungrouped) {
      data.ungrouped.forEach(function(e) {
        entries.push(e);
      });
    }

    if (data.groups) {
      data.groups.forEach(function(g) {
        if (g.entries) {
          g.entries.forEach(function(e) {
            entries.push(e);
          });
        }
      });
    }

    return entries;
  },

  // 切换世界书顶栏页签
  switchTab: function(tab) {
    this._currentTab = tab;
    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    document.querySelectorAll('#wbApp [data-wbtab]').forEach(function(el) {
      el.classList.toggle('active', el.dataset.wbtab === tab);
    });

    document.getElementById('wbTabGlobal').style.display = tab === 'global' ? '' : 'none';
    document.getElementById('wbTabChar').style.display = tab === 'char' ? '' : 'none';
    var wbTabGroup = document.getElementById('wbTabGroup');
    if (wbTabGroup) wbTabGroup.style.display = tab === 'group' ? '' : 'none';

    var sortBtn = document.getElementById('wbSortBtn');
    var addBtn = document.getElementById('wbAddBtn');
    var batchBtn = document.getElementById('wbBatchDeleteBtn');

    if (tab === 'global') {
      if(batchBtn)batchBtn.style.display = '';

      sortBtn.style.display = '';
      sortBtn.onclick = function() {
        cbyd21_WorldBook.autoSort('global');
      };
      addBtn.style.display = '';
      addBtn.onclick = function() {
        cbyd21_WorldBook.addEntry('global');
      };
    } else if (tab === 'group') {
      if(batchBtn)batchBtn.style.display = 'none';

      // 群聊世界书主列表支持自动排序群聊列表
      sortBtn.style.display = '';
      sortBtn.onclick = function() {
        cbyd21_WorldBook.autoSortGroupList();
      };
      addBtn.style.display = 'none';
    } else {
      if(batchBtn)batchBtn.style.display = 'none';

      sortBtn.style.display = 'none';
      addBtn.style.display = 'none';
    }

    var reorderBtn = document.getElementById('wbReorderBtn');
    reorderBtn.style.display = '';

    if (tab === 'char') {
      reorderBtn.onclick = function() {
        toggleReorderMode('wbCharList', reorderBtn);
      };
    } else if (tab === 'group') {
      // 群聊世界书主列表支持手动拖拽排序
      reorderBtn.onclick = function() {
        toggleReorderMode('wbGroupList', reorderBtn);
      };
    } else {
      reorderBtn.onclick = function() {
        toggleReorderMode('wbGlobalGroups', reorderBtn);
      };
    }

    var newGroupBar = document.getElementById('wbNewGroupBar');
    if (newGroupBar) {
      if (tab === 'global') {
        newGroupBar.style.display = '';
        document.getElementById('wbNewGroupBtn').onclick = function() {
          cbyd21_WorldBook.createGroup('global');
        };
      } else {
        newGroupBar.style.display = 'none';
      }
    }

    if (tab === 'global') {
      this.renderGlobal();
      cbyd21_Reorder.init('wbGlobalGroups', cbyd21_WorldBook._reorderGlobalEntries);
    } else if (tab === 'char') {
      this.renderCharList();
      cbyd21_Reorder.init('wbCharList', cbyd21_WorldBook._reorderCharList);
    } else if (tab === 'group') {
      this.renderGroupList();
      cbyd21_Reorder.init('wbGroupList', cbyd21_WorldBook._reorderGroupList);
    }
  },

  // 渲染全局世界书主页面
  renderGlobal: function() {
    var data = this.getGlobalData();
    var container = document.getElementById('wbGlobalGroups');
    container.innerHTML = '';
    this._renderGroupedEntries(container, data, 'global');
  },

  // 渲染角色世界书的角色列表
  renderCharList: function() {
    var container = document.getElementById('wbCharList');
    container.innerHTML = '';

    var charList = characters.filter(function(c) {
      return c.id !== DEFAULT_CHAR_ID;
    });

    if (this._charOrder.length > 0) {
      charList.sort(function(a, b) {
        var ia = cbyd21_WorldBook._charOrder.indexOf(a.id);
        var ib = cbyd21_WorldBook._charOrder.indexOf(b.id);
        if (ia === -1) ia = 9999;
        if (ib === -1) ib = 9999;
        return ia - ib;
      });
    }

    if (charList.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-muted);font-size:13px;line-height:1.8">还没有角色<br>先去「💬 消息 → 通讯录」创建角色</div>';
      return;
    }

    var self = this;
    charList.forEach(function(ch) {
      var wbData = self.getCharData(ch.id);
      var count = self.getAllEntries(wbData).length;
      var avatarHtml = ch.avatar ? '<img src="' + ch.avatar + '">' : escHtml(ch.name.charAt(0));

      var div = document.createElement('div');
      div.className = 'msg-list-item';
      div.innerHTML =
        '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div>' +
        '<div class="msg-list-avatar">' + avatarHtml + '</div>' +
        '<div class="msg-list-info">' +
          '<div class="msg-list-name">' + escHtml(ch.name) + '</div>' +
          '<div class="msg-list-preview">' + (count > 0 ? count + ' 个条目' : '暂无条目') + '</div>' +
        '</div>' +
        '<span style="font-size:12px;color:var(--text-muted)">→</span>';

      div.onclick = function() {
        self.openCharDetail(ch.id);
      };

      container.appendChild(div);
    });
  },

  openCharDetail: function(charId) {
    var ch = getCharById(charId);
    if (!ch) return;

    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    this._currentCharId = charId;

    var newGroupBar = document.getElementById('wbNewGroupBar');
    if (newGroupBar) {
      newGroupBar.style.display = 'none';
    }

    document.getElementById('wbCharDetailTitle').textContent = ch.name + ' · 世界书';
    this.renderCharDetail();
    document.getElementById('wbCharDetailPage').classList.add('active');
    _pushInnerPageState('wbCharDetailPage');
    // 初始化角色世界书详情页的拖拽排序（未分组条目）
    cbyd21_Reorder.init('wbCharDetailGroups', cbyd21_WorldBook._reorderCharDetailEntries);
  },

  // 关闭角色世界书详情页
  closeCharDetail: function(fromPopstate) {
    document.getElementById('wbCharDetailPage').classList.remove('active');

    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    var wasGroup = this._currentCharId && this._currentCharId.startsWith('__group__');
    this._currentCharId = null;
    if (wasGroup) { this.renderGroupList(); } else { this.renderCharList(); }

    var newGroupBar = document.getElementById('wbNewGroupBar');
    if (newGroupBar) newGroupBar.style.display = 'none';
    _backFromInnerPage(fromPopstate);
  },

  // 渲染角色世界书详情页里的内容
  renderCharDetail: function() {
    var data = this.getCharData(this._currentCharId);
    var container = document.getElementById('wbCharDetailGroups');
    container.innerHTML = '';
    this._renderGroupedEntries(container, data, 'char');
  },

  // 渲染“分组 + 未分组条目”的通用列表
  _renderGroupedEntries: function(container, data, target) {
    var self = this;
    var posNames = {
      system_start: '最前强制',
      user_start: '兼容最前',
      before_char: '角色前',
      after_char: '角色后',
      system_end: '末尾强制',
      depth: '深度'
    };

    if(_wbBatchDeleteMode){
      var bar = document.createElement('div');

      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:10px;background:rgba(196,92,92,0.08);border:1px solid rgba(196,92,92,0.18);border-radius:10px;font-size:12px;color:var(--text-secondary);flex-wrap:wrap';
      bar.innerHTML =
        '<span style="flex:1;min-width:120px">已选 <strong id="wbBatchDeleteCount">' + _worldBookBatchCountText() + '</strong></span>' +
        '<button class="btn-sm" onclick="toggleWorldBookBatchSelectAll()">全选条目 / 取消</button>' +
        '<button class="btn-sm" onclick="toggleWorldBookBatchSelectAllGroups()">全选分组 / 取消</button>' +
        '<button class="btn-sm danger" onclick="deleteSelectedWorldBookEntries()">删除所选</button>' +
        '<button class="btn-sm" onclick="toggleWorldBookBatchDeleteMode()">退出</button>';

      container.appendChild(bar);
    }

    if (data.groups && data.groups.length > 0) {
      data.groups.forEach(function(g) {
        var count = g.entries ? g.entries.length : 0;
        var div = document.createElement('div');
        div.className = 'wb-folder-card';
        div.dataset.wbType = 'group';
        div.dataset.wbId = g.id;
        div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;cursor:pointer;transition:background 0.15s;margin-bottom:8px;max-width:100%;min-width:0;overflow:hidden';
        div.innerHTML =
          '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div>' +
          (_wbBatchDeleteMode ? '<input type="checkbox" class="wb-batch-group-cb" data-wbgid="' + escHtml(g.id || '') + '" ' + (_wbBatchSelectedGroupIds[g.id] ? 'checked' : '') + ' onclick="event.stopPropagation()" onchange="toggleWorldBookBatchSelectGroup(this.dataset.wbgid,this.checked)" style="display:block;width:18px;height:18px;accent-color:var(--danger);flex-shrink:0;margin-right:4px">' : '') +
          '<span style="font-size:20px;flex-shrink:0">📁</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;color:var(--text-primary);font-weight:500">' + escHtml(g.name) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + count + ' 个条目</div>' +
          '</div>' +
          '<button class="wb-entry-btn" onclick="event.stopPropagation();cbyd21_WorldBook.groupMenu(\'' + target + '\',\'' + g.id + '\')" title="分组操作" style="flex-shrink:0">⋯</button>' +
          '<span style="font-size:12px;color:var(--text-muted);flex-shrink:0"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg></span>';

        div.onclick = function(e) {
          if (e.target.closest('.wb-entry-btn') || e.target.closest('.wb-batch-group-cb')) return;

          if(_wbBatchDeleteMode){
            var cb = div.querySelector('.wb-batch-group-cb');

            if(cb){
              cb.checked = !cb.checked;
              toggleWorldBookBatchSelectGroup(cb.dataset.wbgid, cb.checked);
            }

            return;
          }

          self.openGroupDetail(target, g.id);
        };

        div.addEventListener('touchstart', function() {
          this.style.background = 'var(--bg-hover)';
        }, { passive: true });

        div.addEventListener('touchend', function() {
          this.style.background = 'var(--bg-card)';
        });

        container.appendChild(div);
      });
    }

    if (data.ungrouped && data.ungrouped.length > 0) {
      if (data.groups && data.groups.length > 0) {
        var uHeader = document.createElement('div');
        uHeader.style.cssText = 'display:flex;align-items:center;gap:6px;padding:12px 0 8px';
        uHeader.innerHTML =
          '<span style="font-size:12px;color:var(--text-muted)">📄</span>' +
          '<span style="font-size:13px;font-weight:500;color:var(--text-muted)">未分组</span>' +
          '<span style="font-size:11px;color:var(--text-muted)">(' + data.ungrouped.length + ')</span>';
        container.appendChild(uHeader);
      }

      data.ungrouped.forEach(function(e, i) {
        container.appendChild(self._createEntryCard(e, target, null, i, posNames));
      });
    }

    var total = self.getAllEntries(data).length;
    if (total === 0 && (!data.groups || data.groups.length === 0)) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px';
      empty.innerHTML = '还没有条目<br>点右上角 ＋ 添加';
      container.appendChild(empty);
    }
  },

  // 生成单个条目卡片
  _createEntryCard: function(e, target, groupId, idx, posNames) {
    var on = e.enabled !== false;
    var posLabel = posNames[e.position || 'after_char'] || '角色后';
    if (e.position === 'depth') posLabel = '深度' + (e.depth || 4);

    var div = document.createElement('div');
    div.className = 'wb-entry' + (on ? '' : ' wb-disabled');
    div.dataset.wbType = 'entry';
    div.dataset.wbId = e.id || '';
    div.innerHTML =
      '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div>' +
      (_wbBatchDeleteMode?'<input type="checkbox" class="wb-batch-cb" data-wbid="' + escHtml(e.id || '') + '" ' + (_wbBatchSelectedIds[e.id]?'checked':'') + ' onclick="event.stopPropagation()" onchange="toggleWorldBookBatchSelect(this.dataset.wbid,this.checked)" style="display:block;width:18px;height:18px;accent-color:var(--danger);flex-shrink:0;margin-right:4px">':'') +
      '<div class="wb-entry-info" onclick="if(_wbBatchDeleteMode){var cb=this.parentNode.querySelector(&quot;.wb-batch-cb&quot;);if(cb){cb.checked=!cb.checked;toggleWorldBookBatchSelect(cb.dataset.wbid,cb.checked)}}else{cbyd21_WorldBook.editEntry(\'' + target + '\',\'' + (groupId || '') + '\',' + idx + ')}" style="cursor:pointer;flex:1;min-width:0">' +
        '<div class="wb-entry-name">' + escHtml(e.name) + '</div>' +
        '<div class="wb-entry-keys">' + (e.keywords ? escHtml(e.keywords) : '(Always On)') + ' · ' + posLabel + '</div>' +
      '</div>' +
      '<div class="wb-entry-actions">' +
        '<label class="toggle-switch toggle-sm"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="cbyd21_WorldBook.toggleEntry(\'' + target + '\',\'' + (groupId || '') + '\',' + idx + ',this.checked)"><span class="toggle-slider"></span></label>' +
        '<button class="wb-entry-btn" onclick="cbyd21_WorldBook.entryMenu(\'' + target + '\',\'' + (groupId || '') + '\',' + idx + ')">⋯</button>' +
      '</div>';

    return div;
  },

  // _confirmAndExecuteBatchDelete(entryIds, groupIds, deleteGroupEntries)
  // → 批量删除前的最终确认。
  _confirmAndExecuteBatchDelete: async function(entryIds, groupIds, deleteGroupEntries) {
    entryIds = entryIds || [];
    groupIds = groupIds || [];

    var msg = '确认执行批量删除？\n\n已选择 ' + entryIds.length + ' 个条目，' + groupIds.length + ' 个分组。';

    if(groupIds.length > 0){
      msg += deleteGroupEntries
        ? '\n\n分组内条目会一起删除，此操作不可恢复。'
        : '\n\n分组内未被单独选中的条目会移到未分组。';
    }

    var yes = await customConfirm(msg);

    if(!yes)return;

    this._executeBatchDelete(entryIds, groupIds, !!deleteGroupEntries);
  },

  // _executeBatchDelete(entryIds, groupIds, deleteGroupEntries)
  // → 真正执行批量删除，并保存刷新。
  _executeBatchDelete: function(entryIds, groupIds, deleteGroupEntries) {
    entryIds = entryIds || [];
    groupIds = groupIds || [];

    if(entryIds.length > 0){
      this._deleteEntriesByIds(entryIds);
    }

    if(groupIds.length > 0){
      this._deleteGroupsByIds(groupIds, !!deleteGroupEntries);
    }

    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    this.saveCurrent();
    this._refreshViews();

    showToast('已完成批量删除');
  },

  // _deleteGroupsByIds(groupIds, deleteEntries)
  // → 批量删除分组。
  // deleteEntries=false：删除分组，分组内条目移到未分组。
  // deleteEntries=true：删除分组和分组内条目。
  _deleteGroupsByIds: function(groupIds, deleteEntries) {
    groupIds = groupIds || [];

    var groupMap = {};

    groupIds.forEach(function(id){
      groupMap[String(id || '')] = true;
    });

    var data = this.getCurrentData();

    if(!data || !Array.isArray(data.groups))return;

    if(!Array.isArray(data.ungrouped)){
      data.ungrouped = [];
    }

    var keptGroups = [];

    data.groups.forEach(function(g){
      if(!g || !groupMap[String(g.id || '')]){
        keptGroups.push(g);
        return;
      }

      if(!deleteEntries && Array.isArray(g.entries)){
        g.entries.forEach(function(e){
          if(e){
            data.ungrouped.push(e);
          }
        });
      }
    });

    data.groups = keptGroups;
  },

  // _deleteEntriesByIds(ids)
  // → 批量删除当前世界书数据里的条目。
  // 会同时扫描未分组和所有分组内部条目。
  _deleteEntriesByIds: function(ids) {
    ids = ids || [];

    var idMap = {};

    ids.forEach(function(id){
      idMap[String(id || '')] = true;
    });

    var data = this.getCurrentData();

    if(!data)return;

    if(Array.isArray(data.ungrouped)){
      data.ungrouped = data.ungrouped.filter(function(e){
        return !idMap[String(e && e.id || '')];
      });
    }

    if(Array.isArray(data.groups)){
      data.groups.forEach(function(g){
        if(Array.isArray(g.entries)){
          g.entries = g.entries.filter(function(e){
            return !idMap[String(e && e.id || '')];
          });
        }
      });
    }
  },

  // 打开“新建条目”弹窗
  addEntry: function(target) {
    target = target || this._currentTab;
    this._editTarget = target;
    this._editIdx = null;
    this._editGroupId = null;

    document.getElementById('wbEntryName').value = '';
    document.getElementById('wbEntryKeywords').value = '';
    document.getElementById('wbEntryContent').value = '';
    document.getElementById('wbEntryPosition').value = 'after_char';
    document.getElementById('wbEntryDepth').value = 4;
    document.getElementById('wbEntryDepthGroup').style.display = 'none';

    this._populateGroupSelect(target);
    openModal('wbEntryModal');
  },

  // 直接往某个分组里新建条目
  addEntryToGroup: function(target, groupId) {
    this.addEntry(target);
    document.getElementById('wbEntryGroup').value = groupId;
  },

  // 打开“编辑条目”弹窗
  editEntry: function(target, groupId, idx) {
    this._editTarget = target;
    this._editGroupId = groupId || null;
    this._editIdx = idx;

    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var entries = groupId
      ? ((data.groups.find(function(g) { return g.id === groupId; }) || {}).entries || [])
      : (data.ungrouped || []);

    var e = entries[idx];
    if (!e) return;

    document.getElementById('wbEntryName').value = e.name || '';
    document.getElementById('wbEntryKeywords').value = e.keywords || '';
    document.getElementById('wbEntryContent').value = e.content || '';
    document.getElementById('wbEntryPosition').value = e.position || 'after_char';
    document.getElementById('wbEntryDepth').value = e.depth || 4;
    document.getElementById('wbEntryDepthGroup').style.display = e.position === 'depth' ? 'block' : 'none';

    this._populateGroupSelect(target);
    document.getElementById('wbEntryGroup').value = groupId || '';
    openModal('wbEntryModal');
  },

  // 保存条目（新建或编辑）
  saveEntry: function() {
    var n = document.getElementById('wbEntryName').value.trim();
    if (!n) {
      showToast('请输入名称');
      return;
    }

    var entry = {
      id: 'wb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: n,
      keywords: document.getElementById('wbEntryKeywords').value.trim(),
      content: document.getElementById('wbEntryContent').value,
      position: document.getElementById('wbEntryPosition').value || 'after_char',
      depth: parseInt(document.getElementById('wbEntryDepth').value) || 4,
      enabled: true,
      _updatedAt: Date.now()
    };

    var targetGroupId = document.getElementById('wbEntryGroup').value || null;
    var data = this._editTarget === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();

    if (this._editIdx !== null) {
      var oldEntries = this._editGroupId
        ? ((data.groups.find(function(g) { return g.id === cbyd21_WorldBook._editGroupId; }) || {}).entries || [])
        : (data.ungrouped || []);

      if (oldEntries[this._editIdx]) {
        entry.id = oldEntries[this._editIdx].id || entry.id;
        entry.enabled = oldEntries[this._editIdx].enabled !== false;
        entry._createdAt = oldEntries[this._editIdx]._createdAt || oldEntries[this._editIdx].createdAt || entry._updatedAt;
        entry._updatedAt = Date.now();
        oldEntries.splice(this._editIdx, 1);
      }
    }

    if (targetGroupId) {
      var targetGroup = data.groups.find(function(g) {
        return g.id === targetGroupId;
      });

      if (targetGroup) {
        if (!targetGroup.entries) targetGroup.entries = [];
        targetGroup.entries.push(entry);
      } else {
        if (!data.ungrouped) data.ungrouped = [];
        data.ungrouped.push(entry);
      }
    } else {
      if (!data.ungrouped) data.ungrouped = [];
      data.ungrouped.push(entry);
    }

    this.saveCurrent();
    closeModal('wbEntryModal');
    this._refreshViews();
    showToast('已保存');
  },

   // 开关单条世界书（即时更新DOM样式，不重新渲染整个列表）
  toggleEntry: function(target, groupId, idx, on) {
    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var entries = groupId
      ? ((data.groups.find(function(g) { return g.id === groupId; }) || {}).entries || [])
      : (data.ungrouped || []);

    if (entries[idx]) {
      entries[idx].enabled = on;
      entries[idx]._updatedAt = Date.now();
    }

    this.saveCurrent();
    // 即时更新当前条目的视觉状态（不重渲染避免滚动跳动）
    this._refreshViews();
  },

  // 打开条目操作菜单
  entryMenu: function(target, groupId, idx) {
    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var entries = groupId
      ? ((data.groups.find(function(g) { return g.id === groupId; }) || {}).entries || [])
      : (data.ungrouped || []);

    var e = entries[idx];
    if (!e) return;

    var self = this;
    var container = document.getElementById('addCharList');
    container.innerHTML = '';

    var items = [
      {
        label: '编辑',
        action: function() {
          closeModal('addCharModal');
          self.editEntry(target, groupId, idx);
        }
      },
      {
        label: '移动到分组',
        action: function() {
          closeModal('addCharModal');
          self._moveToGroupMenu(target, groupId, idx);
        }
      },
      {
        label: '移出分组',
        show: !!groupId,
        action: function() {
          closeModal('addCharModal');
          entries.splice(idx, 1);
          if (!data.ungrouped) data.ungrouped = [];
          data.ungrouped.push(e);
          self.saveCurrent();
          self._refreshViews();
          showToast('已移出分组');
        }
      },
      {
        label: '删除',
        danger: true,
        action: function() {
          closeModal('addCharModal');
          customConfirm('确认删除「' + e.name + '」？').then(function(yes) {
            if (!yes) return;
            entries.splice(idx, 1);
            self.saveCurrent();
            self._refreshViews();
            showToast('已删除');
          });
        }
      }
    ];

    items.forEach(function(item) {
      if (item.show === false) return;
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '14px 16px';
      div.style.fontSize = '14px';
      div.style.color = item.danger ? 'var(--danger)' : 'var(--text-primary)';
      div.textContent = item.label;
      div.onclick = item.action;
      container.appendChild(div);
    });

    document.getElementById('addCharModal').querySelector('h3').textContent = '条目操作';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 打开“移动到分组”菜单
  _moveToGroupMenu: function(target, fromGroupId, idx) {
    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var fromEntries = fromGroupId
      ? ((data.groups.find(function(g) { return g.id === fromGroupId; }) || {}).entries || [])
      : (data.ungrouped || []);

    var e = fromEntries[idx];
    if (!e) return;

    var self = this;
    var container = document.getElementById('addCharList');
    container.innerHTML = '';

    if (fromGroupId) {
      var uDiv = document.createElement('div');
      uDiv.className = 'add-char-item';
      uDiv.style.padding = '14px 16px';
      uDiv.textContent = '📄 未分组';
      uDiv.onclick = function() {
        closeModal('addCharModal');
        fromEntries.splice(idx, 1);
        if (!data.ungrouped) data.ungrouped = [];
        data.ungrouped.push(e);
        self.saveCurrent();
        self._refreshViews();
        showToast('已移动');
      };
      container.appendChild(uDiv);
    }

    if (data.groups) {
      data.groups.forEach(function(g) {
        if (g.id === fromGroupId) return;

        var div = document.createElement('div');
        div.className = 'add-char-item';
        div.style.padding = '14px 16px';
        div.textContent = '📁 ' + g.name;
        div.onclick = function() {
          closeModal('addCharModal');
          fromEntries.splice(idx, 1);
          if (!g.entries) g.entries = [];
          g.entries.push(e);
          self.saveCurrent();
          self._refreshViews();
          showToast('已移动到「' + g.name + '」');
        };
        container.appendChild(div);
      });
    }

    if ((!data.groups || data.groups.length === 0) && !fromGroupId) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">还没有分组，先创建分组</div>';
    }

    document.getElementById('addCharModal').querySelector('h3').textContent = '移动到分组';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 创建新分组
  createGroup: function(target) {
    var name = prompt('分组名称：');
    if (!name || !name.trim()) return;

    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    if (!data.groups) data.groups = [];
    data.groups.push({
      id: 'wbg_' + Date.now(),
      name: name.trim(),
      entries: [],
      _updatedAt: Date.now()
    });

    this.saveCurrent();
    if (target === 'char') this.renderCharDetail();
    else this.renderGlobal();
    showToast('分组已创建');
  },

  // 打开分组操作菜单
  groupMenu: function(target, groupId) {
    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var group = data.groups.find(function(g) {
      return g.id === groupId;
    });
    if (!group) return;

    var self = this;
    var container = document.getElementById('addCharList');
    container.innerHTML = '';

    var items = [
      {
        label: '重命名',
        action: function() {
          closeModal('addCharModal');
          var name = prompt('新名称：', group.name);
          if (!name || !name.trim()) return;
          group.name = name.trim();
          group._updatedAt = Date.now();
          self.saveCurrent();
          self._refreshViews();
          if (self._currentGroupId === groupId) {
            document.getElementById('wbGroupDetailTitle').textContent = name.trim();
          }
          showToast('已重命名');
        }
      },
      {
        label: '删除分组（条目移到未分组）',
        danger: true,
        action: function() {
          closeModal('addCharModal');
          customConfirm('确认删除分组「' + group.name + '」？\n条目会移到未分组').then(function(yes) {
            if (!yes) return;

            if (group.entries && group.entries.length > 0) {
              if (!data.ungrouped) data.ungrouped = [];
              group.entries.forEach(function(e) {
                data.ungrouped.push(e);
              });
            }

            data.groups = data.groups.filter(function(g) {
              return g.id !== groupId;
            });

            self.saveCurrent();

            if (self._currentGroupId === groupId) {
              document.getElementById('wbGroupDetailPage').classList.remove('active');
              self._currentGroupId = null;
              self._currentGroupTarget = null;
            }

            self._refreshViews();
            showToast('分组已删除，条目已移到未分组');
          });
        }
      },
      {
        label: '删除分组和条目',
        danger: true,
        action: function() {
          closeModal('addCharModal');
          customConfirm('确认删除分组「' + group.name + '」以及里面的 ' + ((group.entries && group.entries.length) || 0) + ' 个条目？\n\n此操作不可恢复。').then(function(yes) {
            if (!yes) return;

            data.groups = data.groups.filter(function(g) {
              return g.id !== groupId;
            });

            self.saveCurrent();

            if (self._currentGroupId === groupId) {
              document.getElementById('wbGroupDetailPage').classList.remove('active');
              self._currentGroupId = null;
              self._currentGroupTarget = null;
            }

            self._refreshViews();
            showToast('分组和条目已删除');
          });
        }
      }
    ];

    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'add-char-item';
      div.style.padding = '14px 16px';
      div.style.fontSize = '14px';
      div.style.color = item.danger ? 'var(--danger)' : 'var(--text-primary)';
      div.textContent = item.label;
      div.onclick = item.action;
      container.appendChild(div);
    });

    document.getElementById('addCharModal').querySelector('h3').textContent = '分组操作';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  },

  // 填充分组下拉框
  _populateGroupSelect: function(target) {
    var sel = document.getElementById('wbEntryGroup');
    sel.innerHTML = '<option value="">未分组</option>';

    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    if (data.groups) {
      data.groups.forEach(function(g) {
        var opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        sel.appendChild(opt);
      });
    }
  },

  // autoSort → 只排未分组条目，分组内条目不动（分组有自己的排序按钮）
  autoSort: function(target) {
    target = target || this._currentTab;

    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var posOrder = {
      system_start: 0,
      user_start: 1,
      before_char: 2,
      after_char: 3,
      system_end: 4,
      depth: 5
    };

    function sortFn(a, b) {
      var paKey = a.position || 'after_char';
      var pbKey = b.position || 'after_char';
      var pa = Object.prototype.hasOwnProperty.call(posOrder, paKey) ? posOrder[paKey] : posOrder.after_char;
      var pb = Object.prototype.hasOwnProperty.call(posOrder, pbKey) ? posOrder[pbKey] : posOrder.after_char;

      if (pa !== pb) return pa - pb;

      if (a.position === 'depth' && b.position === 'depth') {
        return (a.depth || 4) - (b.depth || 4);
      }

      return 0;
    }

    // 只排未分组条目，分组内条目由分组详情页的排序按钮单独处理
    if (data.ungrouped) data.ungrouped.sort(sortFn);

    this.saveCurrent();

    if (target === 'char') this.renderCharDetail();
    else this.renderGlobal();

    showToast('已按注入位置排序（未分组条目）');
  },

  // 拖动排序全局世界书主页面的未分组条目
  // 分组文件夹不参与排序，只排序 .wb-entry，也就是未分组条目。
  _reorderGlobalEntries: function(fromIdx, toIdx) {
    var data = cbyd21_WorldBook.getGlobalData();
    var container = document.getElementById('wbGlobalGroups');

    if (!data || !container) return;

    var groupOrder = [];
    var entryOrder = [];

    Array.from(container.children).forEach(function(el){
      if(!el || !el.dataset)return;

      if(el.dataset.wbType === 'group' && el.dataset.wbId){
        groupOrder.push(el.dataset.wbId);
      }

      if(el.dataset.wbType === 'entry' && el.dataset.wbId){
        entryOrder.push(el.dataset.wbId);
      }
    });

    if(Array.isArray(data.groups) && groupOrder.length > 0){
      data.groups.sort(function(a,b){
        var ia = groupOrder.indexOf(a.id);
        var ib = groupOrder.indexOf(b.id);

        if(ia < 0)ia = 999999;
        if(ib < 0)ib = 999999;

        return ia - ib;
      });
    }

    if(Array.isArray(data.ungrouped) && entryOrder.length > 0){
      data.ungrouped.sort(function(a,b){
        var ia = entryOrder.indexOf(a.id);
        var ib = entryOrder.indexOf(b.id);

        if(ia < 0)ia = 999999;
        if(ib < 0)ib = 999999;

        return ia - ib;
      });
    }

    cbyd21_WorldBook.saveGlobal();
    cbyd21_WorldBook.renderGlobal();
    cbyd21_Reorder.init('wbGlobalGroups', cbyd21_WorldBook._reorderGlobalEntries);
  },

  // 拖动排序角色世界书详情页的未分组条目
  _reorderCharDetailEntries: function(fromIdx, toIdx) {
    var data = cbyd21_WorldBook.getCharData(cbyd21_WorldBook._currentCharId);
    var container = document.getElementById('wbCharDetailGroups');

    if (!data || !container) return;

    var groupOrder = [];
    var entryOrder = [];

    Array.from(container.children).forEach(function(el){
      if(!el || !el.dataset)return;

      if(el.dataset.wbType === 'group' && el.dataset.wbId){
        groupOrder.push(el.dataset.wbId);
      }

      if(el.dataset.wbType === 'entry' && el.dataset.wbId){
        entryOrder.push(el.dataset.wbId);
      }
    });

    if(Array.isArray(data.groups) && groupOrder.length > 0){
      data.groups.sort(function(a,b){
        var ia = groupOrder.indexOf(a.id);
        var ib = groupOrder.indexOf(b.id);

        if(ia < 0)ia = 999999;
        if(ib < 0)ib = 999999;

        return ia - ib;
      });
    }

    if(Array.isArray(data.ungrouped) && entryOrder.length > 0){
      data.ungrouped.sort(function(a,b){
        var ia = entryOrder.indexOf(a.id);
        var ib = entryOrder.indexOf(b.id);

        if(ia < 0)ia = 999999;
        if(ib < 0)ib = 999999;

        return ia - ib;
      });
    }

    cbyd21_WorldBook.saveCurrent();
    cbyd21_WorldBook.renderCharDetail();
    cbyd21_Reorder.init('wbCharDetailGroups', cbyd21_WorldBook._reorderCharDetailEntries);
  },

  // 拖动排序角色世界书列表
  _reorderCharList: function(fromIdx, toIdx) {
    var charList = characters.filter(function(c) {
      return c.id !== DEFAULT_CHAR_ID;
    });

    // 先按当前显示顺序排一遍，再基于显示顺序生成新的 order。
    // 这样即使后来新增了角色，_charOrder 里没有这个角色ID，
    // 拖动时也不会出现索引和数据对不上的问题。
    if (cbyd21_WorldBook._charOrder.length > 0) {
      charList.sort(function(a, b) {
        var ia = cbyd21_WorldBook._charOrder.indexOf(a.id);
        var ib = cbyd21_WorldBook._charOrder.indexOf(b.id);
        if (ia === -1) ia = 9999;
        if (ib === -1) ib = 9999;
        return ia - ib;
      });
    }

    var order = charList.map(function(c) {
      return c.id;
    });

    var item = order.splice(fromIdx, 1)[0];
    if (!item) return;

    order.splice(toIdx, 0, item);

    cbyd21_WorldBook._charOrder = order;
    localStorage.setItem('stm_wbCharOrder', JSON.stringify(cbyd21_WorldBook._charOrder));
  },

  // 自动排序群聊世界书主列表
  // 这里只排序“群聊列表本身”，不进入任何群聊内部条目。
  // 群聊内部世界书条目的自动排序仍由详情页 autoSort('char') 处理：
  // 只排未分组条目，文件夹不参与，文件夹内部有自己的 autoSortGroup。
  autoSortGroupList: function() {
    var groups = (cbyd21_Group._groups || []).slice();

    groups.sort(function(a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });

    this._groupOrder = groups.map(function(g) {
      return g.id;
    });

    localStorage.setItem('stm_wbGroupOrder', JSON.stringify(this._groupOrder));
    this.renderGroupList();
    cbyd21_Reorder.init('wbGroupList', cbyd21_WorldBook._reorderGroupList);
    showToast('群聊世界书列表已自动排序');
  },

  // 拖动排序群聊世界书主列表
  _reorderGroupList: function(fromIdx, toIdx) {
    var groups = (cbyd21_Group._groups || []).slice();

    if (cbyd21_WorldBook._groupOrder.length > 0) {
      groups.sort(function(a, b) {
        var ia = cbyd21_WorldBook._groupOrder.indexOf(a.id);
        var ib = cbyd21_WorldBook._groupOrder.indexOf(b.id);
        if (ia === -1) ia = 9999;
        if (ib === -1) ib = 9999;
        return ia - ib;
      });
    }

    var order = groups.map(function(g) {
      return g.id;
    });

    var item = order.splice(fromIdx, 1)[0];
    order.splice(toIdx, 0, item);

    cbyd21_WorldBook._groupOrder = order;
    localStorage.setItem('stm_wbGroupOrder', JSON.stringify(cbyd21_WorldBook._groupOrder));
  },

  // 打开单个分组详情页
  openGroupDetail: function(target, groupId) {
    var data = target === 'char' ? this.getCharData(this._currentCharId) : this.getGlobalData();
    var group = data.groups.find(function(g) {
      return g.id === groupId;
    });
    if (!group) return;

    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    this._currentGroupId = groupId;
    this._currentGroupTarget = target;

    document.getElementById('wbGroupDetailTitle').textContent = group.name;
    this.renderGroupDetail();

    var groupDetailPage = document.getElementById('wbGroupDetailPage');
    groupDetailPage.classList.add('active');

    // 不要在详情页滑入前立刻隐藏“新建分组”栏。
    // 否则全局世界书页面会先闪一下，再进入分组详情。
    // 等滑入动画基本完成后再隐藏底层栏位，视觉更稳。
    setTimeout(function(){
      var newGroupBar = document.getElementById('wbNewGroupBar');
      var groupDetailPage = document.getElementById('wbGroupDetailPage');

      // 只有当前仍然停留在这个分组详情页时才隐藏底层新建分组栏，
      // 避免快速返回 / 切页面后旧的延迟回调再反向改状态，造成闪动。
      if(
        newGroupBar &&
        groupDetailPage &&
        groupDetailPage.classList.contains('active') &&
        cbyd21_WorldBook._currentGroupId === groupId &&
        cbyd21_WorldBook._currentGroupTarget === target
      ){
        newGroupBar.style.display = 'none';
      }
    }, 380);

    _pushInnerPageState('wbGroupDetailPage');
    cbyd21_Reorder.init('wbGroupDetailEntries', cbyd21_WorldBook._reorderGroupEntries);
  },

  // 关闭分组详情页
  closeGroupDetail: function(fromPopstate) {
    document.getElementById('wbGroupDetailPage').classList.remove('active');

    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    var oldTarget = this._currentGroupTarget;

    if (oldTarget === 'char') this.renderCharDetail();
    else this.renderGlobal();

    this._currentGroupId = null;
    this._currentGroupTarget = null;

    var newGroupBar = document.getElementById('wbNewGroupBar');
    if (newGroupBar) {
      // 只有真正回到“全局世界书主列表”时才显示新建分组栏。
      // 角色世界书详情、群聊世界书详情、分组详情关闭后都继续保持隐藏，
      // 避免顶部栏状态被 _currentCharId / _currentTab 的中间态串线。
      var shouldShowNewGroupBar = oldTarget === 'global' && this._currentTab === 'global';

      newGroupBar.style.display = shouldShowNewGroupBar ? '' : 'none';
    }

    _backFromInnerPage(fromPopstate);
  },

  // 渲染分组详情页里的条目
  renderGroupDetail: function() {
    var data = this._currentGroupTarget === 'char'
      ? this.getCharData(this._currentCharId)
      : this.getGlobalData();

    var group = data.groups.find(function(g) {
      return g.id === cbyd21_WorldBook._currentGroupId;
    });
    if (!group) return;

    var container = document.getElementById('wbGroupDetailEntries');
    container.innerHTML = '';

    var posNames = {
      system_start: '最前强制',
      user_start: '兼容最前',
      before_char: '角色前',
      after_char: '角色后',
      system_end: '末尾强制',
      depth: '深度'
    };

    var target = this._currentGroupTarget;
    var groupId = this._currentGroupId;

    if(_wbBatchDeleteMode){
      var bar = document.createElement('div');

      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:10px;background:rgba(196,92,92,0.08);border:1px solid rgba(196,92,92,0.18);border-radius:10px;font-size:12px;color:var(--text-secondary);flex-wrap:wrap';
      bar.innerHTML =
        '<span style="flex:1;min-width:120px">已选 <strong id="wbBatchDeleteCount">' + _worldBookBatchCountText() + '</strong></span>' +
        '<button class="btn-sm" onclick="toggleWorldBookBatchSelectAll()">全选条目 / 取消</button>' +
        '<button class="btn-sm danger" onclick="deleteSelectedWorldBookEntries()">删除所选</button>' +
        '<button class="btn-sm" onclick="toggleWorldBookBatchDeleteMode()">退出</button>';

      container.appendChild(bar);
    }

    if (group.entries && group.entries.length > 0) {
      var self = this;
      group.entries.forEach(function(e, i) {
        container.appendChild(self._createEntryCard(e, target, groupId, i, posNames));
      });
    } else {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px';
      empty.innerHTML = '分组内还没有条目<br>点右上角 ＋ 添加';
      container.appendChild(empty);
    }
  },

  // 往当前分组详情页里直接添加条目
  addEntryToCurrentGroup: function() {
    if (!this._currentGroupId || !this._currentGroupTarget) return;
    this.addEntryToGroup(this._currentGroupTarget, this._currentGroupId);
  },

  // 打开当前分组的菜单
  currentGroupMenu: function() {
    if (!this._currentGroupId || !this._currentGroupTarget) return;
    this.groupMenu(this._currentGroupTarget, this._currentGroupId);
  },

  // 只对当前分组自动排序
  autoSortGroup: function() {
    if (!this._currentGroupId || !this._currentGroupTarget) return;

    var data = this._currentGroupTarget === 'char'
      ? this.getCharData(this._currentCharId)
      : this.getGlobalData();

    var group = data.groups.find(function(g) {
      return g.id === cbyd21_WorldBook._currentGroupId;
    });
    if (!group || !group.entries) return;

    var posOrder = {
      system_start: 0,
      user_start: 1,
      before_char: 2,
      after_char: 3,
      system_end: 4,
      depth: 5
    };

    group.entries.sort(function(a, b) {
      var paKey = a.position || 'after_char';
      var pbKey = b.position || 'after_char';
      var pa = Object.prototype.hasOwnProperty.call(posOrder, paKey) ? posOrder[paKey] : posOrder.after_char;
      var pb = Object.prototype.hasOwnProperty.call(posOrder, pbKey) ? posOrder[pbKey] : posOrder.after_char;

      if (pa !== pb) return pa - pb;
      if (a.position === 'depth' && b.position === 'depth') {
        return (a.depth || 4) - (b.depth || 4);
      }
      return 0;
    });

    this.saveCurrent();
    this.renderGroupDetail();
    showToast('已排序');
  },

  // 拖动排序当前分组内的条目
  _reorderGroupEntries: function(fromIdx, toIdx) {
    if (!cbyd21_WorldBook._currentGroupId || !cbyd21_WorldBook._currentGroupTarget) return;

    var data = cbyd21_WorldBook._currentGroupTarget === 'char'
      ? cbyd21_WorldBook.getCharData(cbyd21_WorldBook._currentCharId)
      : cbyd21_WorldBook.getGlobalData();

    var group = data.groups.find(function(g) {
      return g.id === cbyd21_WorldBook._currentGroupId;
    });

    var container = document.getElementById('wbGroupDetailEntries');

    if (!group || !group.entries || !container) return;

    var entryOrder = [];

    Array.from(container.children).forEach(function(el){
      if(el && el.dataset && el.dataset.wbType === 'entry' && el.dataset.wbId){
        entryOrder.push(el.dataset.wbId);
      }
    });

    if(entryOrder.length > 0){
      group.entries.sort(function(a,b){
        var ia = entryOrder.indexOf(a.id);
        var ib = entryOrder.indexOf(b.id);

        if(ia < 0)ia = 999999;
        if(ib < 0)ib = 999999;

        return ia - ib;
      });
    }

    cbyd21_WorldBook.saveCurrent();
    cbyd21_WorldBook.renderGroupDetail();
    cbyd21_Reorder.init('wbGroupDetailEntries', cbyd21_WorldBook._reorderGroupEntries);
  },

  // 修改后刷新当前还开着的世界书页面
  _refreshViews: function() {
    // 角色世界书详情页和群聊世界书详情页都复用 renderCharDetail。
    // 群聊详情页里 _currentTab 仍可能是 group，所以这里优先看 _currentCharId。
    if (this._currentCharId) {
      this.renderCharDetail();

      if(typeof cbyd21_Reorder !== 'undefined'){
        cbyd21_Reorder.init('wbCharDetailGroups', cbyd21_WorldBook._reorderCharDetailEntries);
      }
    } else if (this._currentTab === 'char') {
      this.renderCharList();

      if(typeof cbyd21_Reorder !== 'undefined'){
        cbyd21_Reorder.init('wbCharList', cbyd21_WorldBook._reorderCharList);
      }
    } else if (this._currentTab === 'group') {
      this.renderGroupList();

      if(typeof cbyd21_Reorder !== 'undefined'){
        cbyd21_Reorder.init('wbGroupList', cbyd21_WorldBook._reorderGroupList);
      }
    } else {
      this.renderGlobal();

      if(typeof cbyd21_Reorder !== 'undefined'){
        cbyd21_Reorder.init('wbGlobalGroups', cbyd21_WorldBook._reorderGlobalEntries);
      }
    }

    if (document.getElementById('wbGroupDetailPage').classList.contains('active') && this._currentGroupId) {
      this.renderGroupDetail();

      if(typeof cbyd21_Reorder !== 'undefined'){
        cbyd21_Reorder.init('wbGroupDetailEntries', cbyd21_WorldBook._reorderGroupEntries);
      }
    }
  },

  //渲染群聊世界书列表
  renderGroupList: function() {
    var container = document.getElementById('wbGroupList');
    if (!container) return;
    container.innerHTML = '';

    var groups = (cbyd21_Group._groups || []).slice();

    if (this._groupOrder.length > 0) {
      groups.sort(function(a, b) {
        var ia = cbyd21_WorldBook._groupOrder.indexOf(a.id);
        var ib = cbyd21_WorldBook._groupOrder.indexOf(b.id);
        if (ia === -1) ia = 9999;
        if (ib === -1) ib = 9999;
        return ia - ib;
      });
    }

    if (groups.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-muted);font-size:13px;line-height:1.8">还没有群聊<br>先去「💬 消息」创建群聊</div>';
      return;
    }

    var self = this;
    groups.forEach(function(g) {
      // 群聊世界书存在 group._worldBook 字段
      if (!g._worldBook) g._worldBook = { groups: [], ungrouped: [] };
      var wbData = self.migrate(g._worldBook);
      g._worldBook = wbData;

      var count = self.getAllEntries(wbData).length;
      var avatarHtml = '';

      if (g._avatar) {
        avatarHtml = '<img src="' + g._avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      } else {
        avatarHtml = '<span style="font-size:14px">👥</span>';
      }

      var div = document.createElement('div');
      div.className = 'msg-list-item';
      div.innerHTML =
        '<div class="reorder-handle"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="12" y2="12"/></svg></div>' +
        '<div class="msg-list-avatar">' + avatarHtml + '</div>' +
        '<div class="msg-list-info">' +
          '<div class="msg-list-name">' + escHtml(g.name) + '</div>' +
          '<div class="msg-list-preview">' + (count > 0 ? count + ' 个条目' : '暂无条目') + '</div>' +
        '</div>' +
        '<span style="font-size:12px;color:var(--text-muted)">→</span>';

      div.onclick = function() {
        self.openGroupWbDetail(g.id);
      };

      container.appendChild(div);
    });
  },


  // 打开群聊世界书详情页
  openGroupWbDetail: function(groupId) {
    var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });
    if (!group) return;

    _wbBatchDeleteMode = false;
    _clearWorldBookBatchSelection();

    if (!group._worldBook) group._worldBook = { groups: [], ungrouped: [] };
    group._worldBook = this.migrate(group._worldBook);

    // 如果是从群聊设置页进入群聊世界书，当前可能不在 wbApp 内。
    // 先确保世界书 APP 本身打开，再打开内部详情页。
    var wbApp = document.getElementById('wbApp');
    if (wbApp && !wbApp.classList.contains('active')) {
      var groupSettingsPanel = document.getElementById('groupSettingsPanel');
      if (groupSettingsPanel) groupSettingsPanel.classList.remove('active');

      if (currentAppId && currentAppId !== 'wbApp') {
        var oldApp = document.getElementById(currentAppId);
        if (oldApp) oldApp.classList.remove('active');
      }

      document.getElementById('desktop').classList.add('hidden');
      wbApp.classList.add('active');
      currentAppId = 'wbApp';
      this.switchTab('group');
      updateSnowVisibility();
    }

    // 复用角色世界书详情页的UI。
    // 不要把 _currentTab 强行改成 char，否则从群聊世界书详情页返回后，
    // 顶部实际还停在“群聊”Tab，但内部状态会变成 char，导致排序/按钮状态错乱。
    // 保存逻辑已通过 _currentCharId 判断，只要这里带 __group__ 前缀即可路由到群聊数据。
    this._currentCharId = '__group__' + groupId;
    document.getElementById('wbCharDetailTitle').textContent = group.name + ' · 世界书';
    this.renderCharDetail();
    document.getElementById('wbCharDetailPage').classList.add('active');
    _pushInnerPageState('wbGroupWbDetailPage');
    // 初始化群聊世界书详情页的拖拽排序（未分组条目）
    cbyd21_Reorder.init('wbCharDetailGroups', cbyd21_WorldBook._reorderCharDetailEntries);

    var newGroupBar = document.getElementById('wbNewGroupBar');
    if (newGroupBar) {
      newGroupBar.style.display = 'none';
    }
  },

  // 获取群聊世界书数据（当_currentCharId以__group__开头时）
  _getGroupWbData: function(groupId) {
    var group = cbyd21_Group._groups.find(function(g) { return g.id === groupId; });

    if (!group) return { groups: [], ungrouped: [] };

    if (!group._worldBook) group._worldBook = { groups: [], ungrouped: [] };

    var before = '';

    try{
      before = JSON.stringify(group._worldBook || null);
    }catch(e){}

    group._worldBook = this.migrate(group._worldBook);

    var after = '';

    try{
      after = JSON.stringify(group._worldBook || null);
    }catch(e){}

    if(before !== after){
      // 群聊世界书迁移后，也要走 groupChats 大数据保存。
      // 不能直接写 localStorage，否则新存储模式下 IndexedDB 主存可能不同步。
      if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save){
        cbyd21_Group._save();
      }
    }

    return group._worldBook;
  },

  // 打开世界书使用教程
  openTutorial: function() {
    var container = document.getElementById('addCharList');

    container.innerHTML =
      '<div style="padding:16px;font-size:13px;color:var(--text-secondary);line-height:1.85">' +

        '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:12px">📖 世界书新手教程</div>' +

        '<div style="background:rgba(124,111,155,0.08);border:1px solid rgba(124,111,155,0.16);border-radius:12px;padding:12px 14px;margin-bottom:16px">' +
          '<div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:6px">一句话说明</div>' +
          '<div>世界书就是一叠“备用设定小纸条”。平时它不会显示在聊天里，但当前聊天、人设、用户面具或场景里出现了你设置的关键词时，前端会把对应纸条塞进 AI 的上下文里，让 AI 记住这些设定。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">一、世界书适合放什么？</div>' +
        '<div style="margin-bottom:12px">适合放那些“不一定每轮都要出现，但一旦聊到就不能忘”的内容。</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div><strong style="color:var(--text-primary)">适合：</strong>世界观背景、地点设定、组织资料、NPC资料、物品说明、特殊规则、角色过去经历、某段关系的补充信息、当前剧情状态。</div>' +
          '<div style="margin-top:8px"><strong style="color:var(--text-primary)">不太适合：</strong>角色最核心的人设。角色是谁、怎么说话、和用户是什么关系，这些最好放在角色卡里，不要全部塞进世界书。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">二、全局、角色、群聊分别怎么用？</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:10px"><strong style="color:var(--text-primary)">全局世界书</strong><br>所有角色、群聊、通话、线下、动态等模块都有机会读取。适合放整套世界观都会用到的公共设定，比如时代背景、国家制度、魔法体系、共同城市、全局规则。注意：有关键词的条目仍然要被关键词触发；关键词留空才是每次都注入。</div>' +
          '<div style="margin-bottom:10px"><strong style="color:var(--text-primary)">角色世界书</strong><br>只有这个角色相关的聊天、通话、线下、动态等场景会读取。适合放这个角色专属的补充设定，比如他的家人、过去经历、住处、工作单位、和用户之间的隐藏背景。</div>' +
          '<div><strong style="color:var(--text-primary)">群聊世界书</strong><br>只有这个群聊相关的线上群聊和群聊线下会读取。适合放群聊共同背景，比如这个群为什么在一起、群成员共享的事件、群体关系、共同任务、当前群聊剧情状态。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">三、怎么新建一条世界书？</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:8px">1. 进入「世界书」。</div>' +
          '<div style="margin-bottom:8px">2. 选择「全局」「角色」或「群聊」。</div>' +
          '<div style="margin-bottom:8px">3. 点右上角 ＋ 添加条目。</div>' +
          '<div style="margin-bottom:8px">4. 填「条目名称」和「条目内容」。</div>' +
          '<div style="margin-bottom:8px">5. 如果希望它只在聊到某些词时触发，就填「触发关键词」。如果希望每次都注入，就把关键词留空。</div>' +
          '<div>6. 选择注入位置。新手不知道选什么时，默认用「角色定义之后」就可以。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">四、触发关键词怎么填？</div>' +
        '<div style="margin-bottom:10px">关键词决定这条世界书什么时候被塞给 AI。</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">关键词留空</strong><br>这条会变成 Always On，每次对话都会注入。适合非常重要、必须一直记住的设定。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">关键词填写具体词</strong><br>聊天记录、人设、用户面具或额外场景里出现这些词时才会触发。适合地点、NPC、组织、道具、事件这类内容。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">多个关键词</strong><br>可以用中文逗号、英文逗号、顿号、分号、竖线或换行分隔。</div>' +
          '<div><strong style="color:var(--text-primary)">新手建议</strong><br>关键词不要太短。一个字、两个字很容易误触发。尽量填专有名词、地点名、人名、事件名。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">五、六种注入位置怎么选？</div>' +
        '<div style="margin-bottom:10px">注入位置就是“这张小纸条塞到 AI 上下文的哪个位置”。不是越靠后越好，也不是所有重要内容都要放末尾强制。新手可以先按“这条内容有多重要、是不是当前正在发生、是不是强制规则”来判断。</div>' +

        '<div style="background:rgba(124,111,155,0.08);border:1px solid rgba(124,111,155,0.16);border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px">先看你想让 AI 怎么对待这条设定</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">只是普通补充设定</strong><br>放「角色定义之后」。这是最稳的新手默认选项。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">是整个世界都要先知道的背景</strong><br>放「角色定义之前」。适合影响角色卡理解方式的世界观基础。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">是必须强制遵守的规则</strong><br>放「末尾强制」。这里更像强提醒，但不要滥用。</div>' +
          '<div><strong style="color:var(--text-primary)">是当前剧情、当前场景、最近几轮必须记住的状态</strong><br>放「对话深度」。它会更像最近聊天里发生的事，而不是永久规则。</div>' +
        '</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">⓪ 最前强制</div>' +
          '<div style="margin-bottom:6px">这条会放在前端上下文包最前部，是最早被读取的强规则位置。用户不需要理解 system/user，前端会自动打包。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">适合放：</strong>必须最先压住模型默认行为的强规则、强破限词、全局最高优先级身份/输出限制。</div>' +
          '<div><strong style="color:var(--text-primary)">不适合放：</strong>普通设定、NPC资料、地点信息、剧情状态。普通内容放这里会干扰整体提示词结构。</div>' +
        '</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">⓪.5 兼容最前（高级）</div>' +
          '<div style="margin-bottom:6px">普通用户一般不需要用。现在前端会自动把角色卡、用户面具、世界书和规则打包成上下文包发送，已经兼容多数不稳定读取 system 的渠道。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">适合放：</strong>极少数特殊渠道仍然需要额外提前强调的破限词、强制规则、全局兼容指令。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">不适合放：</strong>普通NPC资料、地点介绍、大段剧情资料。普通设定放角色后或深度更合适。</div>' +
          '<div><strong style="color:var(--text-primary)">简单理解：</strong>大多数情况下不用管这里；只有某条强规则特别需要压在最前时再用。</div>' +
        '</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">① 角色定义之前</div>' +
          '<div style="margin-bottom:6px">AI 会先读这条，再读角色卡。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">适合放：</strong>世界观大背景、时代规则、种族设定、整个世界都绕不开的基础设定。</div>' +
          '<div><strong style="color:var(--text-primary)">新手理解：</strong>如果这条设定会影响角色卡该怎么理解，就放这里。</div>' +
        '</div>' +

        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">② 角色定义之后</div>' +
          '<div style="margin-bottom:6px">AI 先读完角色是谁，再读这条补充设定。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">适合放：</strong>NPC资料、地点说明、角色关系补充、某段过去经历、某件物品的详细解释。</div>' +
          '<div><strong style="color:var(--text-primary)">新手理解：</strong>大多数世界书都放这里。拿不准就选这个。</div>' +
        '</div>' +

        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:10px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">③ 末尾强制</div>' +
          '<div style="margin-bottom:6px">这条会放在前端上下文包靠后的位置，更像“最后再提醒一次这件事必须按规则来”的强提醒。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">适合放：</strong>必须严格遵守的规则、破限词、强制口吻要求、玩法禁令、不能被普通剧情覆盖的设定。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">不适合放：</strong>普通地点资料、NPC介绍、物品说明、角色过去经历。普通设定放这里太多，AI 容易变僵硬，也容易和其他强规则打架。</div>' +
          '<div><strong style="color:var(--text-primary)">特别说明：</strong>线下模式和浮生逆笔里，如果用户写了文风预设，文风预设会有额外保护。世界书可以决定“写什么设定”，但不要用世界书强行覆盖用户文风预设要求的“怎么写”。</div>' +
        '</div>' +

        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">④ 对话深度</div>' +
          '<div style="margin-bottom:6px">这条不会放在系统提示词里，而是插进聊天记录靠近底部的位置。它更像“最近聊天里刚发生过、现在还要记住”的内容。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">适合放：</strong>当前剧情状态、临时任务、场景状态、角色现在必须记住的短期信息、刚刚发生但 AI 容易忘的事实。</div>' +
          '<div style="margin-bottom:6px"><strong style="color:var(--text-primary)">和末尾强制的区别：</strong>末尾强制像规则，告诉 AI 必须遵守；对话深度像最近消息，提醒 AI 当前正在发生什么。规则用末尾强制，当前状态用深度。</div>' +
          '<div><strong style="color:var(--text-primary)">新手理解：</strong>如果这条内容不是永久规则，而是“这段剧情现在要记住”，就用深度。比如当前地点、当前任务、当前误会、当前关系状态，都更适合深度。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">六、深度数字填多少？</div>' +
        '<div style="margin-bottom:10px">深度数字表示：从最新消息往上数，第几条附近插入这条世界书。数字越小，离最新消息越近；数字越大，离最新消息越远。</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">2 到 3</strong><br>很贴近最新消息。适合特别紧急、这一两轮必须记住的信息。太常用会有点压迫上下文。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">4 到 8</strong><br>最常用范围。既靠近当前对话，又不至于太硬。新手推荐先用 4 或 6。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">9 到 20</strong><br>更像背景提醒。适合持续存在但没那么紧急的场景信息。</div>' +
          '<div><strong style="color:var(--text-primary)">20 以上</strong><br>很靠前，模型不一定每次都特别重视。只有上下文很长、而且你知道自己在做什么时再用。</div>' +
        '</div>' +

        '<div style="background:rgba(124,111,155,0.08);border:1px solid rgba(124,111,155,0.16);border-radius:12px;padding:12px 14px;margin-bottom:16px">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px">按重要程度怎么放？</div>' +
          '<div style="font-size:12px;line-height:1.8">' +
            '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">想让 AI 每次都读到，但只是普通设定</strong><br>关键词留空，注入位置选「角色定义之后」。</div>' +
            '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">想让 AI 每次都读到，而且必须很重视</strong><br>关键词留空，注入位置选「末尾强制」。只给真正强制的规则用，不要把普通资料都放这里。</div>' +
            '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">想让 AI 最近几轮特别别忘</strong><br>注入位置选「对话深度」，深度先填 4 或 6。适合当前场景和短期剧情状态。</div>' +
            '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">只想聊到某个词时才出现</strong><br>填写触发关键词。普通资料选「角色定义之后」；当前状态选「对话深度」；强制规则才选「末尾强制」。</div>' +
            '<div><strong style="color:var(--text-primary)">深度选择口诀</strong><br>不知道填几，就填 4。<br>怕 AI 忘当前场景，就填 4 到 6。<br>只是普通背景提醒，就填 8 到 12。<br>不要一上来就填很深，也不要所有条目都用深度。</div>' +
          '</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">七、分组是干什么的？</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:8px">分组只是帮你整理世界书，不会改变触发逻辑。</div>' +
          '<div style="margin-bottom:8px">比如你可以把地点放一个分组，把 NPC 放一个分组，把当前剧情放一个分组。</div>' +
          '<div>自动排序时，主列表只排序未分组条目，不会把文件夹本身打乱。文件夹里面的条目有自己的排序按钮。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">八、排序按钮怎么理解？</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">自动排序</strong><br>按注入位置整理未分组条目，一般会把最前强制、兼容最前、角色前、角色后、末尾强制、深度这几类排得更清楚。</div>' +
          '<div style="margin-bottom:8px"><strong style="color:var(--text-primary)">手动排序</strong><br>点排序按钮后，拖动条目前面的手柄，可以自己调整顺序。</div>' +
          '<div><strong style="color:var(--text-primary)">注意</strong><br>排序主要影响你管理时的顺序，不等于一定改变 AI 对内容的重视程度。真正影响注入位置的是条目里的“注入位置”。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">九、新手推荐用法</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:8px">1. 先把角色最核心的东西写进角色卡，不要全靠世界书。</div>' +
          '<div style="margin-bottom:8px">2. 世界书先少量添加，别一口气写几十条 Always On。</div>' +
          '<div style="margin-bottom:8px">3. 普通补充设定放「角色定义之后」。</div>' +
          '<div style="margin-bottom:8px">4. 当前剧情状态放「深度」，数字先用 4 或 6。</div>' +
          '<div style="margin-bottom:8px">5. 很硬的规则才放「末尾强制」。</div>' +
          '<div>6. 如果发现 AI 忘设定，先检查关键词有没有触发，再考虑改注入位置。</div>' +
        '</div>' +

        '<div style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px">十、常见问题</div>' +
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">' +
          '<div style="margin-bottom:10px"><strong style="color:var(--text-primary)">为什么我写了世界书，AI 没用？</strong><br>先看关键词有没有在聊天、人设或用户面具里出现。关键词没触发，这条就不会注入。关键词留空才是每次都注入。</div>' +
          '<div style="margin-bottom:10px"><strong style="color:var(--text-primary)">为什么 AI 还是忘？</strong><br>可能是上下文太长、世界书太多、模型能力不够，或者这条放得太靠前。当前状态类内容可以试试放「深度 4 到 6」。</div>' +
          '<div style="margin-bottom:10px"><strong style="color:var(--text-primary)">Always On 能不能很多条？</strong><br>能，但不建议太多。Always On 越多，每次请求消耗越大，AI 也更容易被一堆设定压住。</div>' +
          '<div><strong style="color:var(--text-primary)">世界书能替代记忆吗？</strong><br>不完全能。世界书适合固定设定，记忆适合从聊天里总结出来的经历和关系变化。固定背景放世界书，聊出来的新变化更适合总结成记忆。</div>' +
        '</div>' +

        '<div style="background:rgba(92,160,124,0.08);border:1px solid rgba(92,160,124,0.18);border-radius:12px;padding:12px 14px;margin-bottom:4px">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px">最简单的入门方案</div>' +
          '<div style="font-size:12px;line-height:1.8">如果你完全不知道怎么填，就这样来：<br>普通设定：角色定义之后。<br>每次都要读到的普通设定：关键词留空 + 角色定义之后。<br>当前剧情或短期状态：对话深度 4。<br>非常重要、必须强制遵守的规则：关键词留空 + 末尾强制。<br>只在聊到某个东西时才出现：填写具体关键词。<br>关键词能写具体就写具体，不知道就先留空测试。</div>' +
        '</div>' +

      '</div>';

    document.getElementById('addCharModal').querySelector('h3').textContent = '📖 世界书教程';
    document.getElementById('addCharModal').classList.add('centered');
    openModal('addCharModal');
  }
};
