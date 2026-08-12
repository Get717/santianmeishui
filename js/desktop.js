// ===== 【模块】cbyd21_Desktop — 桌面美化 =====
// 从index.html 主文件拆出
// 包含：下雪特效、桌面文字样式、桌面时间、桌面分页、唱片封面/颜色、
//顶部卡片头像/签名、桌面壁纸、壁纸模式、应用图标自定义
// 依赖主文件：cbyd21_Data、escHtml、showToast、openTextInputModal、
//   openModal、closeModal、openColorPicker、cbyd21_compressImg、
//   characters、currentAppId、currentChatCharId、getCharById、
//   getCurrentProfile、getCurrentChat、updateSnowVisibility（由本文件定义，
//   主文件的 openApp/closeCurrentApp/enterChatView/exitChatView 里调用）

// ============================================================
// 下雪特效
// ============================================================
// cbyd21_Desktop_isDirectImageRef(ref)
// → 判断是否可以直接作为 <img src> / background-image 使用的远程或内联图片。
// 支持 http(s)、协议相对 URL（//xxx）和 data:image。
function cbyd21_Desktop_isDirectImageRef(ref){
  ref = String(ref || '').trim();

  return ref.startsWith('http') ||
    ref.startsWith('//') ||
    ref.startsWith('data:image/');
}

// cbyd21_Desktop_cssUrl(ref)
 // → 安全生成 CSS background-image 用的 url("...")。
 // 避免图片 URL 里有空格、括号、引号时导致 CSS url(...) 解析失败。
function cbyd21_Desktop_cssUrl(ref){
  return 'url("' + String(ref || '').replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '")';
}

function cbyd21_Desktop_safeJson(key, fallback){
  try{
    var raw = localStorage.getItem(key);

    if(raw === null || raw === undefined || raw === ''){
      return fallback;
    }

    var parsed = JSON.parse(raw);
    return parsed;
  }catch(e){
    console.warn('桌面模块 localStorage JSON 解析失败：', key, e);

    try{
      localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
    }catch(_e){}

    return fallback;
  }
}

// _snowScopes → 存储哪些界面显示雪花，数组格式
//   可选值：'desktop','chatApp','chatView','settingsApp',
//           'appearanceApp','wbApp','memoryApp','fateApp',
//           'offlineApp','matchApp','regexApp'
var _snowScopes = cbyd21_Desktop_safeJson('stm_snowScope', ['desktop']);
if(!Array.isArray(_snowScopes))_snowScopes = ['desktop'];

// createSnow() → 在#snowContainer 里生成60个雪花DOM
//   · 每个雪花随机大小(2~4px)、位置、飘落速度、延迟
//   · 通过CSS动画 snowfall 实现飘落效果
function createSnow() {
  var c = document.getElementById('snowContainer');
  if (!c) return;
  c.innerHTML = '';
  var count = 60;
  for (var i = 0; i < count; i++) {
    var s = document.createElement('div');
    s.className = 'snowflake';
    var size = Math.random() * 2 + 2;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.setProperty('--sw', (Math.random() * 70 - 30) + 'px');
    s.style.animationDuration = (Math.random() * 5 + 7) + 's';
    s.style.animationDelay = (Math.random() * 10) + 's';
    c.appendChild(s);
  }
}

// toggleSnow() → 切换下雪开关，保存到 localStorage
//   · 开启时创建雪花DOM并根据当前界面判断是否显示
//   · 关闭时清空雪花DOM
function toggleSnow() {
  var on = document.getElementById('snowToggle').checked;
  document.getElementById('snowStatus').textContent = on ? '开启' : '关闭';
  localStorage.setItem('stm_snow', on ?'on' : 'off');
  if (on) { createSnow(); updateSnowVisibility(); }
  else { var c = document.getElementById('snowContainer'); if (c) c.innerHTML = ''; }
}

// loadSnowPref() → 页面加载时恢复下雪开关状态
//   · 默认开启（首次访问 localStorage 无值时）
function loadSnowPref() {
  var v = localStorage.getItem('stm_snow');
  var on = v === null ? true : v === 'on';
  document.getElementById('snowToggle').checked = on;
  document.getElementById('snowStatus').textContent = on ? '开启' : '关闭';
  if (on) { createSnow(); updateSnowVisibility(); }
}

// getCurrentScreen() → 返回当前所在界面的标识符
//   · 用于判断当前界面是否在_snowScopes 列表里
//   · 聊天界面返回 'chatView'，其他APP返回 appId，桌面返回 'desktop'
function getCurrentScreen() {
  if (document.getElementById('searchResultPage') && document.getElementById('searchResultPage').classList.contains('active')) return 'searchResultPage';
  if (document.getElementById('searchNavPage') && document.getElementById('searchNavPage').classList.contains('active')) return 'searchNavPage';
  if (currentAppId === 'chatApp' && document.getElementById('chatView').classList.contains('active')) return 'chatView';
  if (currentAppId) return currentAppId;
  return 'desktop';
}

// updateSnowVisibility() → 根据当前所在界面决定显示/隐藏雪花
//   · 每次打开/关闭APP、进入/退出聊天时由主文件自动调用
//   · 当前界面在 _snowScopes 列表里 → 显示
//   · 不在列表里 → 隐藏
function updateSnowVisibility() {
  var c = document.getElementById('snowContainer');
  if (!c || !c.children.length) return;
  var screen = getCurrentScreen();
  var show = _snowScopes.indexOf(screen) >= 0;
  c.style.display = show ? '' : 'none';
}

// updateSnowScopeLabel() → 更新美化页里「下雪范围」按钮上的显示文字
//   · 全选时显示"全局"
//   · 无选时显示"无"
//   · 部分选时显示选中的页面名称列表
function updateSnowScopeLabel() {
  var el = document.getElementById('snowScopeLabel');
  if (!el) return;
  var names = {
    desktop: '桌面', chatApp: '消息', chatView: '聊天',
    settingsApp: '设置', appearanceApp: '美化', wbApp: '世界书',
    memoryApp: '记忆', fateApp: '浮生逆笔', offlineApp: '咫尺朝夕',
    matchApp: '遇赴尘烟', regexApp: '正则', gamesApp: '绘言戏局',
    htmlPreviewApp: 'HTML预览', favoritesApp: '暮屿藏笺',
    readingApp: '素页同栖',
    searchNavPage: '搜索导航', searchResultPage: '搜索结果'
  };
  var all = ['desktop', 'chatApp', 'chatView', 'settingsApp', 'appearanceApp', 'wbApp', 'memoryApp', 'fateApp', 'offlineApp', 'matchApp', 'regexApp', 'gamesApp', 'htmlPreviewApp', 'favoritesApp', 'readingApp', 'searchNavPage', 'searchResultPage'];
  if (_snowScopes.length === all.length) { el.textContent = '全局'; }
  else if (_snowScopes.length === 0) { el.textContent = '无'; }
  else { el.textContent = _snowScopes.map(function(s) { return names[s] || s; }).join('、'); }
}

// saveSnowScope(scopes) → 保存下雪范围到 localStorage 并立即更新显示
//   · scopes =字符串数组，如 ['desktop','chatView']
function saveSnowScope(scopes) {
  _snowScopes = scopes;
  localStorage.setItem('stm_snowScope', JSON.stringify(scopes));
  updateSnowVisibility();
  updateSnowScopeLabel();
}

// loadSnowScope() → 从 localStorage 加载下雪范围并更新标签文字
function loadSnowScope() {
  var oldAll = ['desktop', 'chatApp', 'chatView', 'settingsApp', 'appearanceApp', 'wbApp', 'memoryApp', 'fateApp', 'offlineApp', 'matchApp', 'regexApp'];
  var newAll = ['desktop', 'chatApp', 'chatView', 'settingsApp', 'appearanceApp', 'wbApp', 'memoryApp', 'fateApp', 'offlineApp', 'matchApp', 'regexApp', 'gamesApp', 'htmlPreviewApp', 'favoritesApp', 'readingApp', 'searchNavPage', 'searchResultPage'];

  _snowScopes = cbyd21_Desktop_safeJson('stm_snowScope', ['desktop']);
  if(!Array.isArray(_snowScopes))_snowScopes = ['desktop'];

  var wasOldGlobal = oldAll.every(function(id){
    return _snowScopes.indexOf(id) >= 0;
  });

  if(wasOldGlobal){
    newAll.forEach(function(id){
      if(_snowScopes.indexOf(id) < 0)_snowScopes.push(id);
    });
    localStorage.setItem('stm_snowScope', JSON.stringify(_snowScopes));
  }

  updateSnowScopeLabel();
}

// openSnowScopeMenu() → 打开下雪范围选择菜单
//   ·顶部有"全局"快捷选项（全选/取消全选）
//   · 下方逐个列出所有界面，用开关控制
//   · 点击后实时保存并刷新菜单
function openSnowScopeMenu() {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var all = [
    { id: 'desktop', name: '桌面' }, { id: 'chatApp', name: '消息列表' },
    { id: 'chatView', name: '聊天界面' }, { id: 'settingsApp', name: '设置' },
    { id: 'appearanceApp', name: '美化' }, { id: 'wbApp', name: '世界书' },
    { id: 'memoryApp', name: '记忆' }, { id: 'fateApp', name: '浮生逆笔' },
    { id: 'offlineApp', name: '咫尺朝夕' }, { id: 'matchApp', name: '遇赴尘烟' },
    { id: 'regexApp', name: '正则替换' }, { id: 'gamesApp', name: '绘言戏局' },
    { id: 'htmlPreviewApp', name: 'HTML预览' }, { id: 'favoritesApp', name: '暮屿藏笺' },
    { id: 'readingApp', name: '素页同栖' },
    { id: 'searchNavPage', name: '搜索导航页' }, { id: 'searchResultPage', name: '搜索结果页' }
  ];
  var allIds = all.map(function(a) { return a.id; });

  // 全局快捷选项
  var globalDiv = document.createElement('div');
  globalDiv.className = 'add-char-item';
  globalDiv.style.padding = '14px 16px';
  var isAll = _snowScopes.length === allIds.length;
  globalDiv.innerHTML = '<div style="flex:1"><div style="font-size:14px;color:var(--accent);font-weight:600">❄️ 全局（所有界面）</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">所有界面都下雪</div></div><div style="font-size:14px;color:var(--accent)">' + (isAll ? '✓' : '') + '</div>';
  globalDiv.onclick = function() {
    if (isAll) { saveSnowScope(['desktop']); } else { saveSnowScope([].concat(allIds)); }
    openSnowScopeMenu();
  };
  container.appendChild(globalDiv);

  // 分隔线
  var sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border-soft);margin:0 16px';
  container.appendChild(sep);

  // 逐个界面选项
  all.forEach(function(item) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    var checked = _snowScopes.indexOf(item.id) >= 0;
    div.innerHTML = '<div style="flex:1;font-size:14px;color:var(--text-primary)">' + item.name + '</div><label class="toggle-switch toggle-sm" style="pointer-events:none"><input type="checkbox" ' + (checked ? 'checked' : '') + '><span class="toggle-slider"></span></label>';
    div.onclick = function(e) {
      e.preventDefault();
      var idx = _snowScopes.indexOf(item.id);
      var newScopes = [].concat(_snowScopes);
      if (idx >= 0) { newScopes.splice(idx, 1); } else { newScopes.push(item.id); }
      saveSnowScope(newScopes);
      openSnowScopeMenu();
    };
    container.appendChild(div);
  });document.getElementById('addCharModal').querySelector('h3').textContent = '下雪范围';
  openModal('addCharModal');
}

// ============================================================
// 日间桌面透明度
// ============================================================
// 只影响 light-mode：顶部卡片、桌面应用图标、Dock胶囊、Dock图标。
// 夜间模式暂时保持原有设计，不共用这套透明度。
function _clampLightDesktopOpacity(v, fallback){
  v = parseInt(v, 10);

  if(isNaN(v))v = fallback;

  return Math.max(20, Math.min(100, v));
}

function _clampLightDesktopBlur(v, fallback, max){
  v = parseInt(v, 10);

  if(isNaN(v))v = fallback;

  max = parseInt(max, 10);

  if(isNaN(max))max = 60;

  return Math.max(0, Math.min(max, v));
}

function applyLightDesktopOpacityPref(){
  var topCard = _clampLightDesktopOpacity(localStorage.getItem('stm_lightTopCardOpacity'), 82);
  var desktopIcon = _clampLightDesktopOpacity(localStorage.getItem('stm_lightDesktopIconOpacity'), 84);
  var dock = _clampLightDesktopOpacity(localStorage.getItem('stm_lightDockOpacity'), 72);
  var dockIcon = _clampLightDesktopOpacity(localStorage.getItem('stm_lightDockIconOpacity'), 82);

  var topCardBlur = _clampLightDesktopBlur(localStorage.getItem('stm_lightTopCardBlur'), 24, 60);
  var desktopIconBlur = _clampLightDesktopBlur(localStorage.getItem('stm_lightDesktopIconBlur'), 16, 60);
  var dockBlur = _clampLightDesktopBlur(localStorage.getItem('stm_lightDockBlur'), 50, 80);
  var dockIconBlur = _clampLightDesktopBlur(localStorage.getItem('stm_lightDockIconBlur'), 16, 60);

  document.documentElement.style.setProperty('--light-top-card-opacity', String(topCard / 100));
  document.documentElement.style.setProperty('--light-desktop-icon-opacity', String(desktopIcon / 100));
  document.documentElement.style.setProperty('--light-dock-opacity', String(dock / 100));
  document.documentElement.style.setProperty('--light-dock-icon-opacity', String(dockIcon / 100));

  document.documentElement.style.setProperty('--light-top-card-blur', topCardBlur + 'px');
  document.documentElement.style.setProperty('--light-desktop-icon-blur', desktopIconBlur + 'px');
  document.documentElement.style.setProperty('--light-dock-blur', dockBlur + 'px');
  document.documentElement.style.setProperty('--light-dock-icon-blur', dockIconBlur + 'px');

  var topCardRange = document.getElementById('lightTopCardOpacityRange');
  var desktopIconRange = document.getElementById('lightDesktopIconOpacityRange');
  var dockRange = document.getElementById('lightDockOpacityRange');
  var dockIconRange = document.getElementById('lightDockIconOpacityRange');

  var topCardBlurRange = document.getElementById('lightTopCardBlurRange');
  var desktopIconBlurRange = document.getElementById('lightDesktopIconBlurRange');
  var dockBlurRange = document.getElementById('lightDockBlurRange');
  var dockIconBlurRange = document.getElementById('lightDockIconBlurRange');

  var topCardLabel = document.getElementById('lightTopCardOpacityLabel');
  var desktopIconLabel = document.getElementById('lightDesktopIconOpacityLabel');
  var dockLabel = document.getElementById('lightDockOpacityLabel');
  var dockIconLabel = document.getElementById('lightDockIconOpacityLabel');

  var topCardBlurLabel = document.getElementById('lightTopCardBlurLabel');
  var desktopIconBlurLabel = document.getElementById('lightDesktopIconBlurLabel');
  var dockBlurLabel = document.getElementById('lightDockBlurLabel');
  var dockIconBlurLabel = document.getElementById('lightDockIconBlurLabel');

  if(topCardRange)topCardRange.value = topCard;
  if(desktopIconRange)desktopIconRange.value = desktopIcon;
  if(dockRange)dockRange.value = dock;
  if(dockIconRange)dockIconRange.value = dockIcon;

  if(topCardBlurRange)topCardBlurRange.value = topCardBlur;
  if(desktopIconBlurRange)desktopIconBlurRange.value = desktopIconBlur;
  if(dockBlurRange)dockBlurRange.value = dockBlur;
  if(dockIconBlurRange)dockIconBlurRange.value = dockIconBlur;

  if(topCardLabel)topCardLabel.textContent = topCard + '%';
  if(desktopIconLabel)desktopIconLabel.textContent = desktopIcon + '%';
  if(dockLabel)dockLabel.textContent = dock + '%';
  if(dockIconLabel)dockIconLabel.textContent = dockIcon + '%';

  if(topCardBlurLabel)topCardBlurLabel.textContent = topCardBlur + 'px';
  if(desktopIconBlurLabel)desktopIconBlurLabel.textContent = desktopIconBlur + 'px';
  if(dockBlurLabel)dockBlurLabel.textContent = dockBlur + 'px';
  if(dockIconBlurLabel)dockIconBlurLabel.textContent = dockIconBlur + 'px';
}

function saveLightDesktopOpacityPref(silent){
  var topCardRange = document.getElementById('lightTopCardOpacityRange');
  var desktopIconRange = document.getElementById('lightDesktopIconOpacityRange');
  var dockRange = document.getElementById('lightDockOpacityRange');
  var dockIconRange = document.getElementById('lightDockIconOpacityRange');

  var topCardBlurRange = document.getElementById('lightTopCardBlurRange');
  var desktopIconBlurRange = document.getElementById('lightDesktopIconBlurRange');
  var dockBlurRange = document.getElementById('lightDockBlurRange');
  var dockIconBlurRange = document.getElementById('lightDockIconBlurRange');

  var topCard = _clampLightDesktopOpacity(topCardRange ? topCardRange.value : localStorage.getItem('stm_lightTopCardOpacity'), 82);
  var desktopIcon = _clampLightDesktopOpacity(desktopIconRange ? desktopIconRange.value : localStorage.getItem('stm_lightDesktopIconOpacity'), 84);
  var dock = _clampLightDesktopOpacity(dockRange ? dockRange.value : localStorage.getItem('stm_lightDockOpacity'), 72);
  var dockIcon = _clampLightDesktopOpacity(dockIconRange ? dockIconRange.value : localStorage.getItem('stm_lightDockIconOpacity'), 82);

  var topCardBlur = _clampLightDesktopBlur(topCardBlurRange ? topCardBlurRange.value : localStorage.getItem('stm_lightTopCardBlur'), 24, 60);
  var desktopIconBlur = _clampLightDesktopBlur(desktopIconBlurRange ? desktopIconBlurRange.value : localStorage.getItem('stm_lightDesktopIconBlur'), 16, 60);
  var dockBlur = _clampLightDesktopBlur(dockBlurRange ? dockBlurRange.value : localStorage.getItem('stm_lightDockBlur'), 50, 80);
  var dockIconBlur = _clampLightDesktopBlur(dockIconBlurRange ? dockIconBlurRange.value : localStorage.getItem('stm_lightDockIconBlur'), 16, 60);

  localStorage.setItem('stm_lightTopCardOpacity', String(topCard));
  localStorage.setItem('stm_lightDesktopIconOpacity', String(desktopIcon));
  localStorage.setItem('stm_lightDockOpacity', String(dock));
  localStorage.setItem('stm_lightDockIconOpacity', String(dockIcon));

  localStorage.setItem('stm_lightTopCardBlur', String(topCardBlur));
  localStorage.setItem('stm_lightDesktopIconBlur', String(desktopIconBlur));
  localStorage.setItem('stm_lightDockBlur', String(dockBlur));
  localStorage.setItem('stm_lightDockIconBlur', String(dockIconBlur));

  applyLightDesktopOpacityPref();

  if(!silent){
    showToast('日间桌面透明度和模糊度已保存');
  }
}

// 显式暴露给 index.html 内联 oninput 使用。
// 同时主动绑定滑条事件，避免 PWA 缓存或浏览器全局函数绑定异常导致滑条拖动无效。
window.applyLightDesktopOpacityPref = applyLightDesktopOpacityPref;
window.saveLightDesktopOpacityPref = saveLightDesktopOpacityPref;

function bindLightDesktopOpacityControls(){
  var ids = [
    'lightTopCardOpacityRange',
    'lightDesktopIconOpacityRange',
    'lightDockOpacityRange',
    'lightDockIconOpacityRange',
    'lightTopCardBlurRange',
    'lightDesktopIconBlurRange',
    'lightDockBlurRange',
    'lightDockIconBlurRange'
  ];

  ids.forEach(function(id){
    var el = document.getElementById(id);

    if(!el || el._lightDesktopOpacityBound)return;

    el._lightDesktopOpacityBound = true;

    el.addEventListener('input', function(){
      saveLightDesktopOpacityPref(true);
    });

    el.addEventListener('change', function(){
      saveLightDesktopOpacityPref(true);
    });
  });

  applyLightDesktopOpacityPref();
}

window.bindLightDesktopOpacityControls = bindLightDesktopOpacityControls;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindLightDesktopOpacityControls);
}else{
  bindLightDesktopOpacityControls();
}

// ============================================================
// 桌面文字样式（颜色+阴影）
// ============================================================
// 颜色存localStorage key: stm_desktopLabelColor
// 阴影存 localStorage key: stm_desktopLabelShadow（'on'/'off'）
// 通过CSS变量 --desktop-label-color 和 --desktop-label-shadow 控制
// 只影响桌面图标下方文字，不影响其他界面

// saveDesktopLabelColorFromText() → 从文本输入框读取颜色值并应用
//   · 更新色块预览 + CSS变量 + localStorage
function saveDesktopLabelColorFromText() {
  var c = document.getElementById('desktopLabelColorText').value.trim();
  if (!c) return;
  var sw = document.getElementById('desktopLabelSwatch');
  if (sw) sw.style.background = c;
  localStorage.setItem('stm_desktopLabelColor', c);
  document.documentElement.style.setProperty('--desktop-label-color', c);
  showToast('文字颜色已更新');
}

// resetDesktopLabelColor() → 重置桌面文字颜色为默认白色
//   · 清除 localStorage + 移除CSS变量 + 重置预览色块和输入框
function resetDesktopLabelColor() {
  localStorage.removeItem('stm_desktopLabelColor');
  document.documentElement.style.removeProperty('--desktop-label-color');
  var sw = document.getElementById('desktopLabelSwatch');
  if (sw) sw.style.background = '#ffffff';
  document.getElementById('desktopLabelColorText').value = '';showToast('已重置为默认颜色');
}

// saveDesktopLabelShadow() → 保存桌面文字阴影开关状态
//   · 开启时设置深色描边阴影（在浅色壁纸上更容易看清）
//   · 关闭时设为none
function saveDesktopLabelShadow() {
  var on = document.getElementById('desktopLabelShadowToggle').checked;
  document.getElementById('desktopLabelShadowStatus').textContent = on ? '开启' : '关闭';
  localStorage.setItem('stm_desktopLabelShadow', on ? 'on' : 'off');
  if (on) {
    document.documentElement.style.setProperty('--desktop-label-shadow', '0 1px 3px rgba(0,0,0,0.8),0 0 6px rgba(0,0,0,0.4)');
  } else {
    document.documentElement.style.setProperty('--desktop-label-shadow', 'none');
  }
  showToast(on ? '文字阴影已开启' : '文字阴影已关闭');
}

// loadDesktopLabelPref() → 页面加载时恢复桌面文字颜色和阴影设置
//   · 从 localStorage 读取并应用到CSS变量 + 表单控件
function loadDesktopLabelPref() {
  var c = localStorage.getItem('stm_desktopLabelColor');
  if (c) {
    document.documentElement.style.setProperty('--desktop-label-color', c);
    var swatch = document.getElementById('desktopLabelSwatch');
    if (swatch) swatch.style.background = c;
    var txt = document.getElementById('desktopLabelColorText');
    if (txt) txt.value = c;
  }
  var s = localStorage.getItem('stm_desktopLabelShadow');
  var on = s === null ? true : s === 'on';
  var toggle = document.getElementById('desktopLabelShadowToggle');
  if (toggle) toggle.checked = on;
  var status = document.getElementById('desktopLabelShadowStatus');
  if (status) status.textContent = on ? '开启' : '关闭';if (!on) { document.documentElement.style.setProperty('--desktop-label-shadow', 'none'); }
}

// ============================================================
// 桌面时间
// ============================================================

// updateDesktopTime() → 更新桌面卡片上的时间/日期/星期
//   · 每30秒由主文件的 setInterval 调用一次
//   · 同时更新电池百分比（如果有 desktopBattery 元素）
function updateDesktopTime() {
  var d = new Date();
  var t = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  var el = document.getElementById('desktopTime');
  if (el) el.textContent = t;
  // 完整日期：2025.07.27 格式
  var dateFullEl = document.getElementById('desktopDateFull');
  if (dateFullEl) {
    var _y = d.getFullYear();
    var _m = (d.getMonth() + 1).toString().padStart(2, '0');
    var _d = d.getDate().toString().padStart(2, '0');
    dateFullEl.textContent = _y + '.' + _m + '.' + _d;
  }
  var wdEl = document.getElementById('desktopWeekday');
  if (wdEl) {
    var wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    wdEl.textContent = wd[d.getDay()];
  }
  var batEl = document.getElementById('desktopBattery');
  if (batEl && navigator.getBattery) {
    navigator.getBattery().then(function(b) { batEl.textContent = Math.round(b.level * 100) + '%'; });
  }
}

// ============================================================
// 桌面分页（左右滑动）
// ============================================================
// · 监听 .desktop-pages 的scroll 事件
// · 根据 scrollLeft 判断当前页码
// · 更新页面指示器小圆点的.active 状态
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var pages = document.getElementById('desktopPages');
    if (!pages) return;

    var lastPage = -1;
    var ticking = false;
    var wheelLocked = false;
    var animFrame = null;

    var mouseStartX = 0;
    var mouseStartY = 0;
    var mouseStartScrollLeft = 0;
    var mouseStartPage = 0;
    var mouseDragging = false;
    var mouseMoved = false;

    function isFinePointer(){
      return window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    }

    function getDesktopPageCount(){
      return pages.querySelectorAll('.desktop-page').length || 1;
    }

    function getCurrentDesktopPage(){
      var pageWidth = pages.offsetWidth || 1;
      return Math.max(0, Math.min(getDesktopPageCount() - 1, Math.round(pages.scrollLeft / pageWidth)));
    }

    function updateDesktopPageIndicator(){
      ticking = false;

      var currentPage = getCurrentDesktopPage();

      if(currentPage === lastPage)return;
      lastPage = currentPage;

      var dots = document.querySelectorAll('#desktopPageDots .desktop-page-dot');
      dots.forEach(function(dot, i) {
        dot.classList.toggle('active', i === currentPage);
      });
    }

    function requestDesktopPageIndicatorUpdate(){
      if(ticking)return;
      ticking = true;
      requestAnimationFrame(updateDesktopPageIndicator);
    }

    function setDesktopJsPaging(on){
      if(on){
        pages.classList.add('desktop-js-paging');
        pages.style.scrollBehavior = 'auto';
      }else{
        pages.style.scrollBehavior = '';
        pages.classList.remove('desktop-js-paging');
      }
    }

    function animateDesktopScrollTo(left, smooth){
      if(animFrame){
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }

      var maxScroll = Math.max(0, pages.scrollWidth - pages.clientWidth);
      var target = Math.max(0, Math.min(maxScroll, left));

      if(smooth === false){
        setDesktopJsPaging(false);
        pages.scrollLeft = target;
        requestDesktopPageIndicatorUpdate();
        return;
      }

      var start = pages.scrollLeft;
      var diff = target - start;

      setDesktopJsPaging(true);

      if(Math.abs(diff) < 1){
        pages.scrollLeft = target;
        requestDesktopPageIndicatorUpdate();

        requestAnimationFrame(function(){
          setDesktopJsPaging(false);
        });

        return;
      }

      var duration = 320;
      var startTime = performance.now();

      function easeOutCubic(t){
        return 1 - Math.pow(1 - t, 3);
      }

      function finish(){
        pages.scrollLeft = target;
        animFrame = null;
        requestDesktopPageIndicatorUpdate();

        requestAnimationFrame(function(){
          setDesktopJsPaging(false);
          requestDesktopPageIndicatorUpdate();
        });
      }

      function step(now){
        var p = Math.min(1, (now - startTime) / duration);
        var eased = easeOutCubic(p);

        pages.scrollLeft = start + diff * eased;
        requestDesktopPageIndicatorUpdate();

        if(p < 1){
          animFrame = requestAnimationFrame(step);
        }else{
          finish();
        }
      }

      animFrame = requestAnimationFrame(step);
    }

    function goDesktopPage(page, smooth){
      var total = getDesktopPageCount();
      var target = Math.max(0, Math.min(total - 1, page));
      animateDesktopScrollTo(target * (pages.offsetWidth || 1), smooth);
    }

    pages.addEventListener('scroll', requestDesktopPageIndicatorUpdate, { passive:true });

    window.addEventListener('resize', function(){
      lastPage = -1;
      goDesktopPage(getCurrentDesktopPage(), false);
    });

    // 电脑端：点击底部小圆点切换桌面页
    document.querySelectorAll('#desktopPageDots .desktop-page-dot').forEach(function(dot, i){
      dot.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        goDesktopPage(i, true);
      });
    });

    // 电脑端：普通鼠标按住桌面空白处左右拖动切页
    // 只在 fine pointer 设备启用，不影响安卓/iOS触摸滑动。
    pages.addEventListener('mousedown', function(e){
      if(!isFinePointer())return;
      if(e.button !== 0)return;

      // 避免拖动桌面图标、Dock、卡片、唱片、页码点时误触发切页
      if(e.target && e.target.closest && e.target.closest('.desktop-icon,.dock-icon,.top-card,#desktopPageDots,.vinyl-zone')){
        return;
      }

      if(animFrame){
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }

      mouseDragging = true;
      mouseMoved = false;
      mouseStartX = e.clientX;
      mouseStartY = e.clientY;
      mouseStartScrollLeft = pages.scrollLeft;
      mouseStartPage = getCurrentDesktopPage();

      pages.style.cursor = 'grabbing';
      setDesktopJsPaging(true);

      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e){
      if(!mouseDragging)return;

      var dx = e.clientX - mouseStartX;
      var dy = e.clientY - mouseStartY;

      if(Math.abs(dx) > 4 || Math.abs(dy) > 4){
        mouseMoved = true;
      }

      if(Math.abs(dx) > Math.abs(dy)){
        var maxScroll = Math.max(0, pages.scrollWidth - pages.clientWidth);
        pages.scrollLeft = Math.max(0, Math.min(maxScroll, mouseStartScrollLeft - dx));
        requestDesktopPageIndicatorUpdate();
      }
    });

    document.addEventListener('mouseup', function(e){
      if(!mouseDragging)return;

      mouseDragging = false;
      pages.style.cursor = '';

      var dx = e.clientX - mouseStartX;
      var dy = e.clientY - mouseStartY;

      if(mouseMoved && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)){
        goDesktopPage(mouseStartPage + (dx < 0 ? 1 : -1), true);
      }else{
        goDesktopPage(getCurrentDesktopPage(), true);
      }

      setTimeout(function(){
        mouseMoved = false;
      }, 0);
    });

    // 电脑端：支持触控板横向滚动 / Shift + 鼠标滚轮切页
    // 不处理普通竖向滚轮，避免影响第一页内容上下滚动。
    pages.addEventListener('wheel', function(e){
      if(!isFinePointer())return;

      var horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 8;
      var shiftWheelIntent = e.shiftKey && Math.abs(e.deltaY) > 8;

      if(!horizontalIntent && !shiftWheelIntent)return;

      e.preventDefault();

      if(wheelLocked)return;
      wheelLocked = true;

      var direction = horizontalIntent ? e.deltaX : e.deltaY;
      goDesktopPage(getCurrentDesktopPage() + (direction > 0 ? 1 : -1), true);

      setTimeout(function(){
        wheelLocked = false;
      }, 420);
    }, { passive:false });

    requestDesktopPageIndicatorUpdate();
  });
})();

// ============================================================
// iOS 桌面分页白条兜底修复
// ============================================================
// · 只在 iOS / iPadOS 启用
// · iOS 不再使用 #desktopPages 的原生横向滚动层，避免原生滚动指示残影露成白条
// · 用绝对定位页面层 + transform 模拟手机横滑：拖动时跟手，松手后平滑吸附
// · 安卓和电脑不走这里，继续使用上面的原生 scroll-snap / 鼠标拖动 / 小圆点切页逻辑
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var pages = document.getElementById('desktopPages');
    if(!pages)return;

    var isIosLikeDevice =
      document.documentElement.classList.contains('ios-device') ||
      /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
      ((navigator.platform === 'MacIntel') && navigator.maxTouchPoints > 1);

    if(!isIosLikeDevice)return;

    var pageEls = Array.prototype.slice.call(pages.querySelectorAll('.desktop-page'));
    if(pageEls.length <= 1)return;

    var currentPage = 0;
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var horizontal = false;
    var suppressClickUntil = 0;

    function pageWidth(){
      return pages.clientWidth || 1;
    }

    function clampPage(p){
      return Math.max(0, Math.min(pageEls.length - 1, p));
    }

    function setTransition(on){
      pageEls.forEach(function(page){
        page.style.transition = on ? 'transform 0.32s cubic-bezier(0.22,0.61,0.36,1)' : 'none';
      });
    }

    function applyPagePositions(extraDx){
      var w = pageWidth();
      extraDx = extraDx || 0;

      pageEls.forEach(function(page, i){
        var x = (i - currentPage) * w + extraDx;
        page.style.transform = 'translate3d(' + x + 'px,0,0)';
        page.style.pointerEvents = i === currentPage ? 'auto' : 'none';
      });
    }

    function goIosDesktopPage(page, animate){
      currentPage = clampPage(page);
      setTransition(animate !== false);
      applyPagePositions(0);

      if(animate !== false){
        setTimeout(function(){
          setTransition(false);
          applyPagePositions(0);
        }, 360);
      }
    }

    function resetNativeScroll(){
      // iOS 原生滚动层不再参与页面切换，强制归零，避免残留滚动指示器
      if(pages.scrollLeft !== 0){
        pages.scrollLeft = 0;
      }
    }

    resetNativeScroll();
    goIosDesktopPage(0, false);

    pages.addEventListener('scroll', function(){
      resetNativeScroll();
    }, { passive:true });

    pages.addEventListener('touchstart', function(e){
      if(!e.touches || !e.touches.length)return;

      dragging = true;
      horizontal = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;

      setTransition(false);
      resetNativeScroll();
      applyPagePositions(0);
    }, { passive:true });

    pages.addEventListener('touchmove', function(e){
      if(!dragging || !e.touches || !e.touches.length)return;

      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      if(!horizontal && Math.abs(dx) > Math.abs(dy) + 8){
        horizontal = true;
      }

      if(!horizontal)return;

      e.preventDefault();

      var maxPage = pageEls.length - 1;
      var dragDx = dx;

      // 边缘阻尼，避免第一/最后一页被硬拖出太远
      if(currentPage === 0 && dx > 0){
        dragDx = dx * 0.28;
      }

      if(currentPage === maxPage && dx < 0){
        dragDx = dx * 0.28;
      }

      pageEls.forEach(function(page){
        page.style.pointerEvents = 'none';
      });

      applyPagePositions(dragDx);
      resetNativeScroll();
    }, { passive:false });

    pages.addEventListener('touchend', function(e){
      if(!dragging)return;

      dragging = false;

      if(!e.changedTouches || !e.changedTouches.length){
        goIosDesktopPage(currentPage, true);
        horizontal = false;
        return;
      }

      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;

      if(horizontal && Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)){
        goIosDesktopPage(currentPage + (dx < 0 ? 1 : -1), true);
        suppressClickUntil = Date.now() + 350;
      }else{
        goIosDesktopPage(currentPage, true);
      }

      horizontal = false;
    }, { passive:true });

    pages.addEventListener('touchcancel', function(){
      dragging = false;
      horizontal = false;
      goIosDesktopPage(currentPage, true);
    }, { passive:true });

    // 横滑后阻止误点桌面图标
    pages.addEventListener('click', function(e){
      if(Date.now() < suppressClickUntil){
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    window.addEventListener('resize', function(){
      goIosDesktopPage(currentPage, false);
    });

    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState === 'visible'){
        resetNativeScroll();
        goIosDesktopPage(currentPage, false);
      }
    });
  });
})();

// ============================================================
// 唱片封面自定义
// ============================================================
// 存储：localStorage key stm_vinylCover（URL或IndexedDB引用ID）

// openVinylCoverMenu() → 点击唱片中心弹出选择菜单
//   · 三个选项：上传图片 / 输入URL / 恢复默认
//   · 上传图片存IndexedDB，URL直接存localStorage
function openVinylCoverMenu() {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '上传图片', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M8 10V2"/><path d="M5 5l3-3 3 3"/><path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3"/></svg>' },
    { label: '输入URL', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M7 9l2-2"/><path d="M5 11a3 3 0 010-4l1-1"/><path d="M11 5a3 3 0 010 4l-1 1"/></svg>' },
    { label: '恢复默认', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M4 7l-3 3 3 3"/><path d="M1 10h9a4 4 0 000-8H6"/></svg>' }
  ];
  items.forEach(function(item, i) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '16px';
    div.style.fontSize = '14px';
    div.style.color = 'var(--text-primary)';
    div.innerHTML = item.svg + item.label;
    div.onclick = function() {
      closeModal('addCharModal');
      if (i === 0) {
        // 上传图片
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
        inp.onchange = async function(e) {
          var f = e.target.files[0]; if (!f) return;
          var compressed = await cbyd21_compressImg(f, 300, 0.8);
          cbyd21_Data.storeImage(compressed).then(function(ref) {
            localStorage.setItem('stm_vinylCover', ref);
            setVinylCover(compressed);
            showToast('唱片封面已更换');
          });
          document.body.removeChild(inp);
        };
        document.body.appendChild(inp);
        inp.click();
      } else if (i === 1) {
        // 输入URL
        openTextInputModal('唱片封面URL', '输入图片URL', 'https://example.com/cover.jpg', function(url) {
          if (!url.trim()) return;
          localStorage.setItem('stm_vinylCover', url.trim());
          setVinylCover(url.trim());
          showToast('唱片封面已更换');
        });
      } else {
        // 恢复默认
        localStorage.removeItem('stm_vinylCover');
        document.getElementById('vinylCenter').innerHTML = '🎵';
        showToast('已恢复默认');
      }
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '唱片封面';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// setVinylCover(dataUrl) → 应用封面图到唱片中心
//   · dataUrl 为图片URL或base64
//   · 传null/空值时恢复默认🎵
function setVinylCover(dataUrl) {
  var el = document.getElementById('vinylCenter');
  if (!el) return;
  if (dataUrl) { el.innerHTML = '<img src="' + dataUrl + '">'; }
  else { el.innerHTML = '🎵'; }
}

// loadVinylCover() → 页面加载时恢复唱片封面
//   · 从 localStorage 读引用，http开头直接用，否则从IndexedDB加载
function loadVinylCover() {
  var ref = localStorage.getItem('stm_vinylCover');
  if (!ref) return;
  if (cbyd21_Desktop_isDirectImageRef(ref)) { setVinylCover(ref); }
  else { cbyd21_Data.loadImage(ref).then(function(d) { if (d) setVinylCover(d); }); }
}

// ============================================================
// 唱片颜色
// ============================================================
// 颜色存 localStorage key: stm_vinylColor
// 通过CSS变量 --vinyl-bg控制唱片本体的渐变色

// openVinylColorMenu() → 长按唱片本体弹出改色菜单
//   · 预设色：经典黑/深红/深蓝/墨绿/紫夜/金色/深棕
//   · 也可以自定义颜色（调用色域选色器）
function openVinylColorMenu() {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var colors = [
    { name: '经典黑', value: '' }, { name: '深红', value: '#8b1a1a' },
    { name: '深蓝', value: '#1a2a5b' }, { name: '墨绿', value: '#1a4a2a' },
    { name: '紫夜', value: '#3a1a5b' }, { name: '金色', value: '#6b5a1a' },
    { name: '深棕', value: '#4a2a1a' }, { name: '自定义', value: 'custom' }
  ];
  colors.forEach(function(c) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '14px 16px';
    // 色块预览
    var swatch = '';
    if (c.value && c.value !== 'custom') {
      swatch = '<div style="width:24px;height:24px;border-radius:50%;background:' + c.value + ';border:1px solid rgba(255,255,255,0.15);flex-shrink:0"></div>';
    } else if (c.value === 'custom') {
      swatch = '<div style="width:24px;height:24px;border-radius:50%;background:conic-gradient(red,yellow,lime,aqua,blue,magenta,red);border:1px solid rgba(255,255,255,0.15);flex-shrink:0"></div>';
    } else {
      swatch = '<div style="width:24px;height:24px;border-radius:50%;background:#1a1a1a;border:1px solid rgba(255,255,255,0.15);flex-shrink:0"></div>';
    }
    div.innerHTML = '<div style="display:flex;align-items:center;gap:12px;width:100%">' + swatch + '<span style="font-size:14px;color:var(--text-primary)">' + c.name + '</span></div>';
    div.onclick = function() {
      if (c.value === 'custom') {
        closeModal('addCharModal');
        var current = localStorage.getItem('stm_vinylColor') || '#1a1a1a';
        openColorPicker('唱片颜色', current, function(hex) {
          applyVinylColor(hex);localStorage.setItem('stm_vinylColor', hex);
          showToast('唱片颜色已更换');
        });
      } else {
        closeModal('addCharModal');
        if (!c.value) {
          localStorage.removeItem('stm_vinylColor');
          document.querySelector('.vinyl').style.removeProperty('--vinyl-bg');showToast('已恢复经典黑');
        } else {
          applyVinylColor(c.value);
          localStorage.setItem('stm_vinylColor', c.value);
          showToast('唱片颜色已更换');
        }
      }
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '唱片颜色';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// applyVinylColor(hex) → 将hex颜色转换为唱片渐变色并应用到CSS变量
//   · 从基色生成暗/中/亮三个色阶
//   · 构建径向渐变模拟唱片纹理
function applyVinylColor(hex) {
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  var dark = 'rgb(' + Math.max(0, r - 30) + ',' + Math.max(0, g - 30) + ',' + Math.max(0, b - 30) + ')';
  var mid = 'rgb(' + r + ',' + g + ',' + b + ')';
  var light = 'rgb(' + Math.min(255, r + 25) + ',' + Math.min(255, g + 25) + ',' + Math.min(255, b + 25) + ')';
  var gradient = 'radial-gradient(circle,' + light + ' 0%,' + light + ' 14%,' + mid + ' 16%,' + dark + ' 18%,' + mid + ' 24%,' + dark + ' 28%,' + mid + ' 34%,' + dark + ' 38%,' + mid + ' 44%,' + dark + ' 48%,' + mid + ' 54%,' + dark + ' 58%,' + mid + ' 64%,' + dark + ' 68%,' + mid + ' 74%,' + dark + ' 78%,' + mid + ' 84%,rgb(' + Math.max(0, r - 50) + ',' + Math.max(0, g - 50) + ',' + Math.max(0, b - 50) +') 100%)';
  document.querySelector('.vinyl').style.setProperty('--vinyl-bg', gradient);
}

// loadVinylColor() → 页面加载时恢复唱片颜色
function loadVinylColor() {
  var hex = localStorage.getItem('stm_vinylColor');
  if (hex) applyVinylColor(hex);
}

// 唱片本体长按→改色（独立注册，不依赖封面是否存在）
//   · touchstart 600ms长按触发
//   · contextmenu右键触发（PC端）
document.addEventListener('DOMContentLoaded', function() {
  var vinyl = document.querySelector('.vinyl');
  if (!vinyl) return;
  var _vpt = null;
  vinyl.style.pointerEvents = 'auto';
  vinyl.addEventListener('touchstart', function(e) {
    _vpt = setTimeout(function() { openVinylColorMenu(); }, 600);
  }, { passive: true });
  vinyl.addEventListener('touchend', function() { clearTimeout(_vpt); });
  vinyl.addEventListener('touchmove', function() { clearTimeout(_vpt); });vinyl.addEventListener('contextmenu', function(e) { e.preventDefault(); openVinylColorMenu(); });
});

// ============================================================
//顶部卡片头像
// ============================================================
// 存储：localStorage key stm_topCardAvatar

// openTopCardAvatarMenu() → 点击顶部卡片圆形头像弹出菜单
//   · 三个选项：上传图片 / 输入URL / 清除图片
//   · 上传时压缩到220px宽（比普通头像稍大，卡片显示区域较大）
function openTopCardAvatarMenu() {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '上传图片', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M8 10V2"/><path d="M5 5l3-3 3 3"/><path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3"/></svg>' },
    { label: '输入URL', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M7 9l2-2"/><path d="M5 11a3 3 0 010-4l1-1"/><path d="M11 5a3 3 0 010 4l-1 1"/></svg>' },
    { label: '清除图片', svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M4 7l-3 3 3 3"/><path d="M1 10h9a4 4 0 000-8H6"/></svg>' }
  ];
  items.forEach(function(item, i) {
    var div = document.createElement('div');
    div.className = 'add-char-item';
    div.style.padding = '16px';
    div.style.fontSize = '14px';
    div.style.color = 'var(--text-primary)';
    div.innerHTML = item.svg + item.label;
    div.onclick = function() {
      closeModal('addCharModal');
      if (i === 0) {
        // 上传图片
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
        inp.onchange = async function(e) {
          var f = e.target.files[0]; if (!f) return;
          var _compTca = await cbyd21_compressImg(f, 220, 0.72);
          cbyd21_Data.storeImage(_compTca).then(function(ref) {
            localStorage.setItem('stm_topCardAvatar', ref);
            setTopCardAvatar(_compTca);
            showToast('卡片头像已设置');
          });
          document.body.removeChild(inp);
        };
        document.body.appendChild(inp);
        inp.click();
      } else if (i === 1) {
        // 输入URL
        openTextInputModal('卡片头像URL', '输入图片URL', 'https://example.com/avatar.png', function(url) {
          if (!url.trim()) return;
          localStorage.setItem('stm_topCardAvatar', url.trim());
          setTopCardAvatar(url.trim());
          showToast('卡片头像已设置');
        });
      } else {
        // 清除
        localStorage.removeItem('stm_topCardAvatar');
        document.getElementById('topCardAvatar').innerHTML = '<span class="placeholder">+</span>';
        showToast('已清除');
      }
    };
    container.appendChild(div);
  });
  document.getElementById('addCharModal').querySelector('h3').textContent = '卡片头像';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// setTopCardAvatar(dataUrl) → 将图片应用到顶部卡片头像位置
//   · dataUrl为图片URL/base64时显示图片
//   · 为空时显示默认+号占位
function setTopCardAvatar(dataUrl) {
  var el = document.getElementById('topCardAvatar');
  if (!el) return;
  if (dataUrl) { el.innerHTML = '<img src="' + dataUrl + '">'; }
  else { el.innerHTML = '<span class="placeholder">+</span>'; }
}

// loadTopCardAvatar() → 页面加载时恢复顶部卡片头像
//   · http开头直接用，否则从IndexedDB加载
function loadTopCardAvatar() {
  var ref = localStorage.getItem('stm_topCardAvatar');
  if (!ref) return;
  if (cbyd21_Desktop_isDirectImageRef(ref)) { setTopCardAvatar(ref); }
  else { cbyd21_Data.loadImage(ref).then(function(d) { if (d) setTopCardAvatar(d); }); }
}

// ============================================================
// 桌面卡片签名
// ============================================================
// 存储：localStorage key stm_topCardSignature

// 桌面卡片默认文案和字符限制
// · 使用 Array.from 统计字符，避免 emoji 被 slice 截坏
// · 用户清空输入并点确定时，恢复默认文案，不强制重新输入
var CBYD21_TOP_CARD_DEFAULTS = {
  title:'✨要好好睡觉🌟',
  subtitle:'是时候睡觉了🌙✨',
  signature:'今天你严肃入睡了吗💤',
  location:'未设置'
};

function _topCardLimitChars(text, max){
  return Array.from(String(text || '').trim()).slice(0, max).join('');
}

function _topCardLimitRawInput(text, max){
  return Array.from(String(text || '')).slice(0, max).join('');
}

function _topCardRenderLocationText(text){
  var el = document.getElementById('topCardLocText');

  if(!el)return;

  var value = _topCardLimitChars(text, 8) || CBYD21_TOP_CARD_DEFAULTS.location;
  var chars = Array.from(value);
  var line1 = chars.slice(0, 4).join('');
  var line2 = chars.slice(4, 8).join('');

  el.title = value;

  el.innerHTML =
    '<div class="top-card-loc-line">' + escHtml(line1) + '</div>' +
    '<div class="top-card-loc-line">' + escHtml(line2) + '</div>';
}

// _topCardApplyInputLimit(max)
// → 给通用文字输入弹窗临时加桌面卡片字符限制。
// 输入超过 max 后立即截断；关闭/下次打开弹窗时由 openTextInputModal 清除。
function _topCardApplyInputLimit(max){
  setTimeout(function(){
    var area = document.getElementById('textInputArea');
    if(!area)return;

    area.dataset.topCardMaxChars = String(max);
    area.removeAttribute('maxLength');
    area.value = _topCardLimitRawInput(area.value, max);

    if(typeof autoResizeModal === 'function'){
      autoResizeModal(area);
    }
  }, 30);
}

// 只安装一次输入限制监听。
// 只有 textInputArea.dataset.topCardMaxChars 存在时才生效，不影响其他普通输入弹窗。
(function _installTopCardInputLimiter(){
  document.addEventListener('DOMContentLoaded', function(){
    var area = document.getElementById('textInputArea');
    if(!area)return;

    area.addEventListener('input', function(){
      var max = parseInt(area.dataset.topCardMaxChars || '', 10);

      if(!max)return;

      var limited = _topCardLimitRawInput(area.value, max);

      if(area.value !== limited){
        area.value = limited;
      }

      if(typeof autoResizeModal === 'function'){
        autoResizeModal(area);
      }
    });
  });
})();

// editTopCardSignature() → 点击签名栏弹出编辑弹窗
//   · 最多50字
//   · 编辑后保存到 localStorage 并更新显示
function editTopCardSignature() {
  var current = localStorage.getItem('stm_topCardSignature') || '';

  openTextInputModal('✏️ 编辑签名', '写一句你喜欢的话（最多20字，清空则恢复默认）', '写点什么…', function(text) {
    text = _topCardLimitChars(text, 20);

    var el = document.getElementById('topCardSignature');

    if(text){
      localStorage.setItem('stm_topCardSignature', text);
      if(el)el.textContent = text;
    }else{
      localStorage.removeItem('stm_topCardSignature');
      if(el)el.textContent = CBYD21_TOP_CARD_DEFAULTS.signature;
    }

    showToast('签名已更新');
  }, true);

  var area = document.getElementById('textInputArea');

  if(area){
    area.value = current;
  }

  _topCardApplyInputLimit(20);
}

// loadTopCardSignature() → 页面加载时恢复签名文字
function loadTopCardSignature() {
  var sig = localStorage.getItem('stm_topCardSignature');
  var el = document.getElementById('topCardSignature');

  if(!el)return;

  el.textContent = sig ? _topCardLimitChars(sig, 20) : CBYD21_TOP_CARD_DEFAULTS.signature;
}

//============================================================
// 桌面卡片标题/副标题编辑
// ============================================================
//存储：stm_topCardTitleText / stm_topCardSubtitleText

// editTopCardTitle() → 点击标题弹出编辑弹窗
//   · 最多12个字，避免挤到右侧头像
function editTopCardTitle() {
  var current = localStorage.getItem('stm_topCardTitleText') || '';

  openTextInputModal('✏️ 编辑标题', '桌面卡片标题（最多8字，清空则恢复默认）', '输入标题…', function(text) {
    text = _topCardLimitChars(text, 8);

    var el = document.getElementById('topCardTitle');

    if(text){
      localStorage.setItem('stm_topCardTitleText', text);
      if(el)el.textContent = text;
    }else{
      localStorage.removeItem('stm_topCardTitleText');
      if(el)el.textContent = CBYD21_TOP_CARD_DEFAULTS.title;
    }

    showToast('标题已更新');
  }, true);

  var area = document.getElementById('textInputArea');

  if(area){
    area.value = current;
  }

  _topCardApplyInputLimit(8);
}

// editTopCardSubtitle() → 点击副标题弹出编辑弹窗
//   · 最多15个字
function editTopCardSubtitle() {
  var current = localStorage.getItem('stm_topCardSubtitleText') || '';

  openTextInputModal('✏️ 编辑副标题', '桌面卡片副标题（最多10字，清空则恢复默认）', '输入副标题…', function(text) {
    text = _topCardLimitChars(text, 10);

    var el = document.getElementById('topCardSubtitle');

    if(text){
      localStorage.setItem('stm_topCardSubtitleText', text);
      if(el)el.textContent = text;
    }else{
      localStorage.removeItem('stm_topCardSubtitleText');
      if(el)el.textContent = CBYD21_TOP_CARD_DEFAULTS.subtitle;
    }

    showToast('副标题已更新');
  }, true);

  var area = document.getElementById('textInputArea');

  if(area){
    area.value = current;
  }

  _topCardApplyInputLimit(10);
}

// loadTopCardTitle() → 页面加载时恢复标题文字
function loadTopCardTitle() {
  var t = localStorage.getItem('stm_topCardTitleText');
  var el = document.getElementById('topCardTitle');

  if(!el)return;

  el.textContent = t ? _topCardLimitChars(t, 8) : CBYD21_TOP_CARD_DEFAULTS.title;
}

// loadTopCardSubtitle() → 页面加载时恢复副标题文字
function loadTopCardSubtitle() {
  var t = localStorage.getItem('stm_topCardSubtitleText');
  var el = document.getElementById('topCardSubtitle');

  if(!el)return;

  el.textContent = t ? _topCardLimitChars(t, 10) : CBYD21_TOP_CARD_DEFAULTS.subtitle;
}

// ============================================================
// 卡片文字颜色（标题/副标题/签名各自独立）
// ============================================================
// 存储 key：stm_topCardTitleColor / stm_topCardSubtitleColor / stm_topCardSignatureColor
// 直接设置元素的 style.color，覆盖CSS默认色

// saveTopCardTitleColor() → 从hex输入框保存标题颜色
function saveTopCardTitleColor() {
  var c = document.getElementById('topCardTitleColorHex').value.trim();
  if (c) {
    localStorage.setItem('stm_topCardTitleColor', c);
    var el = document.getElementById('topCardTitle');
    if (el) el.style.color = c;}
  showToast('标题颜色已更新');
}

// resetTopCardTitleColor() → 重置标题颜色为默认
function resetTopCardTitleColor() {
  localStorage.removeItem('stm_topCardTitleColor');
  var el = document.getElementById('topCardTitle');
  if (el) el.style.color = '';
  document.getElementById('topCardTitleColorHex').value = '';
  document.getElementById('topCardTitleColorSwatch').style.background = 'rgba(255,255,255,0.85)';
  showToast('已重置为默认颜色');
}

// saveTopCardSubtitleColor() → 保存副标题颜色
function saveTopCardSubtitleColor() {
  var c = document.getElementById('topCardSubtitleColorHex').value.trim();
  if (c) {
    localStorage.setItem('stm_topCardSubtitleColor', c);
    var el = document.getElementById('topCardSubtitle');
    if (el) el.style.color = c;
  }
  showToast('副标题颜色已更新');
}

// resetTopCardSubtitleColor() → 重置副标题颜色为默认
function resetTopCardSubtitleColor() {
  localStorage.removeItem('stm_topCardSubtitleColor');
  var el = document.getElementById('topCardSubtitle');
  if (el) el.style.color = '';
  document.getElementById('topCardSubtitleColorHex').value = '';
  document.getElementById('topCardSubtitleColorSwatch').style.background = 'rgba(255,255,255,0.3)';
  showToast('已重置为默认颜色');
}

// saveTopCardSignatureColor() → 保存签名颜色
function saveTopCardSignatureColor() {
  var c = document.getElementById('topCardSignatureColorHex').value.trim();
  if (c) {
    localStorage.setItem('stm_topCardSignatureColor', c);
    var el = document.getElementById('topCardSignature');
    if (el) el.style.color = c;
  }
  showToast('签名颜色已更新');
}

// resetTopCardSignatureColor() → 重置签名颜色为默认
function resetTopCardSignatureColor() {
  localStorage.removeItem('stm_topCardSignatureColor');
  var el = document.getElementById('topCardSignature');
  if (el) el.style.color = '';
  document.getElementById('topCardSignatureColorHex').value = '';
  document.getElementById('topCardSignatureColorSwatch').style.background = 'rgba(255,255,255,0.35)';
  showToast('已重置为默认颜色');
}

// saveTopCardDateColor() → 保存日期颜色（2025.07.27 + 周日）
function saveTopCardDateColor() {
  var c = document.getElementById('topCardDateColorHex').value.trim();
  if (c) {
    localStorage.setItem('stm_topCardDateColor', c);
    var dateEl = document.getElementById('desktopDateFull');
    if (dateEl) dateEl.style.color = c;
    var weekEl = document.getElementById('desktopWeekday');
    if (weekEl) weekEl.style.color = c;
  }
  showToast('日期颜色已更新');
}

// resetTopCardDateColor() → 重置日期颜色为默认
function resetTopCardDateColor() {
  localStorage.removeItem('stm_topCardDateColor');
  var dateEl = document.getElementById('desktopDateFull');
  if (dateEl) dateEl.style.color = '';
  var weekEl = document.getElementById('desktopWeekday');
  if (weekEl) weekEl.style.color = '';
  document.getElementById('topCardDateColorHex').value = '';
  document.getElementById('topCardDateColorSwatch').style.background = 'rgba(255,255,255,0.25)';
  showToast('已重置为默认颜色');
}

// saveTopCardTimeColor() → 保存时间颜色（16:08）
function saveTopCardTimeColor() {
  var c = document.getElementById('topCardTimeColorHex').value.trim();
  if (c) {
    localStorage.setItem('stm_topCardTimeColor', c);
    var timeEl = document.getElementById('desktopTime');
    if (timeEl) timeEl.style.color = c;
  }
  showToast('时间颜色已更新');
}

// resetTopCardTimeColor() → 重置时间颜色为默认
function resetTopCardTimeColor() {
  localStorage.removeItem('stm_topCardTimeColor');
  var timeEl = document.getElementById('desktopTime');
  if (timeEl) timeEl.style.color = '';
  document.getElementById('topCardTimeColorHex').value = '';
  document.getElementById('topCardTimeColorSwatch').style.background = 'rgba(255,255,255,0.85)';
  showToast('已重置为默认颜色');
}

// loadTopCardColors() → 页面加载时恢复五个颜色（标题/副标题/签名/日期/时间）
//   · 同时更新美化页的色块和输入框（如果已打开）
function loadTopCardColors() {
  var tc = localStorage.getItem('stm_topCardTitleColor');
  if (tc) {
    var el = document.getElementById('topCardTitle');
    if (el) el.style.color = tc;
    var sw = document.getElementById('topCardTitleColorSwatch');
    if (sw) sw.style.background = tc;
    var hex = document.getElementById('topCardTitleColorHex');
    if (hex) hex.value = tc;
  }

  var sc = localStorage.getItem('stm_topCardSubtitleColor');
  if (sc) {
    var el2 = document.getElementById('topCardSubtitle');
    if (el2) el2.style.color = sc;
    var sw2 = document.getElementById('topCardSubtitleColorSwatch');
    if (sw2) sw2.style.background = sc;
    var hex2 = document.getElementById('topCardSubtitleColorHex');
    if (hex2) hex2.value = sc;
  }

  var gc = localStorage.getItem('stm_topCardSignatureColor');
  if (gc) {
    var el3 = document.getElementById('topCardSignature');
    if (el3) el3.style.color = gc;
    var sw3 = document.getElementById('topCardSignatureColorSwatch');
    if (sw3) sw3.style.background = gc;
    var hex3 = document.getElementById('topCardSignatureColorHex');
    if (hex3) hex3.value = gc;
  }

  // 日期颜色（2025.07.27 + 周日）
  var dc = localStorage.getItem('stm_topCardDateColor');
  if (dc) {
    var dateEl = document.getElementById('desktopDateFull');
    if (dateEl) dateEl.style.color = dc;
    var weekEl = document.getElementById('desktopWeekday');
    if (weekEl) weekEl.style.color = dc;
    var dcSw = document.getElementById('topCardDateColorSwatch');
    if (dcSw) dcSw.style.background = dc;
    var dcHex = document.getElementById('topCardDateColorHex');
    if (dcHex) dcHex.value = dc;
  }

  // 时间颜色（16:08）
  var tmc = localStorage.getItem('stm_topCardTimeColor');
  if (tmc) {
    var timeEl = document.getElementById('desktopTime');
    if (timeEl) timeEl.style.color = tmc;
    var tmcSw = document.getElementById('topCardTimeColorSwatch');
    if (tmcSw) tmcSw.style.background = tmc;
    var tmcHex = document.getElementById('topCardTimeColorHex');
    if (tmcHex) tmcHex.value = tmc;
  }
}

// ============================================================
// 桌面卡片定位文字
// ============================================================
// 存储：localStorage key stm_topCardLocation
// 左上角小框，用户自定义显示的地名（纯装饰，不是真实GPS）

// editTopCardLocation() → 点击定位框弹出编辑弹窗
function editTopCardLocation() {
  var current = localStorage.getItem('stm_topCardLocation') || '';

  openTextInputModal('📍 编辑定位', '显示在卡片上的地点（最多8字，清空则恢复默认）', '输入地点名…', function(text) {
    text = _topCardLimitChars(text, 8);

    if(text){
      localStorage.setItem('stm_topCardLocation', text);
      _topCardRenderLocationText(text);
    }else{
      localStorage.removeItem('stm_topCardLocation');
      _topCardRenderLocationText('');
    }

    showToast('定位已更新');
  }, true);

  var area = document.getElementById('textInputArea');

  if(area){
    area.value = current;
  }

  _topCardApplyInputLimit(8);
}

// loadTopCardLocation() → 页面加载时恢复定位文字
function loadTopCardLocation() {
  var loc = localStorage.getItem('stm_topCardLocation');
  _topCardRenderLocationText(loc || '');
}

// ============================================================
// 桌面卡片背景图（长按卡片上传，铺满卡片内部）
// ============================================================
// 存储：localStorage key stm_topCardBg（IndexedDB引用ID或http URL）
// 背景图层是卡片内部的 .top-card-bg 元素（absolute定位，z-index:0）

// loadTopCardBg() → 页面加载时恢复卡片背景图
function loadTopCardBg() {
  var ref = localStorage.getItem('stm_topCardBg');
  if (!ref) return;
  if (cbyd21_Desktop_isDirectImageRef(ref)) {
    _setTopCardBg(ref);
  } else {
    cbyd21_Data.loadImage(ref).then(function(d) { if (d) _setTopCardBg(d); });
  }
}

// _setTopCardBg(dataUrl) → 将背景图应用到卡片bg层
function _setTopCardBg(dataUrl) {
  var el = document.getElementById('topCardBg');
  if (!el) return;
  if (dataUrl) {
    el.style.backgroundImage = cbyd21_Desktop_cssUrl(dataUrl);
  } else {
    el.style.backgroundImage = '';
  }
}

// _openTopCardBgMenu() → 弹出卡片背景上传菜单
function _openTopCardBgMenu() {
  var container = document.getElementById('addCharList');
  container.innerHTML = '';
  var items = [
    { label: '上传图片', action: function() {
      closeModal('addCharModal');
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      inp.onchange = async function(e) {
        var f = e.target.files[0]; if (!f) return;
        // 卡片背景需要更高分辨率（高DPI屏幕360px卡片需要720px+的图才清晰）
        var compressed = await cbyd21_compressImg(f, 800, 0.85);
        cbyd21_Data.storeImage(compressed).then(function(ref) {
          localStorage.setItem('stm_topCardBg', ref);
          _setTopCardBg(compressed);
          showToast('卡片背景已设置');
        });
        document.body.removeChild(inp);
      };
      document.body.appendChild(inp);
      inp.click();
    }},
    { label: '输入URL', action: function() {
      closeModal('addCharModal');
      openTextInputModal('卡片背景URL', '输入图片URL', 'https://example.com/bg.jpg', function(url) {
        if (!url.trim()) return;
        localStorage.setItem('stm_topCardBg', url.trim());
        _setTopCardBg(url.trim());
        showToast('卡片背景已设置');
      });
    }},
    { label: '清除背景', action: function() {
      closeModal('addCharModal');
      localStorage.removeItem('stm_topCardBg');
      _setTopCardBg(null);
      showToast('已清除');
    }}
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
  document.getElementById('addCharModal').querySelector('h3').textContent = '卡片背景';
  document.getElementById('addCharModal').classList.add('centered');
  openModal('addCharModal');
}

// 长按卡片触发背景上传菜单
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var card = document.getElementById('topCard');
    if (!card) return;
    var _lpt = null;
    card.addEventListener('touchstart', function(e) {
      // 如果点的是头像/标题/副标题/签名/定位等可交互区域，不触发长按
      if (e.target.closest('#topCardAvatar') || e.target.closest('#topCardTitle') ||
          e.target.closest('#topCardSubtitle') || e.target.closest('#topCardSignature') ||
          e.target.closest('#topCardLoc')) return;
      _lpt = setTimeout(function() { _openTopCardBgMenu(); }, 600);
    }, { passive: true });
    card.addEventListener('touchend', function() { clearTimeout(_lpt); });
    card.addEventListener('touchmove', function() { clearTimeout(_lpt); });
    // PC端右键
    card.addEventListener('contextmenu', function(e) {
      if (e.target.closest('#topCardAvatar') || e.target.closest('#topCardTitle') ||
          e.target.closest('#topCardSubtitle') || e.target.closest('#topCardSignature') ||
          e.target.closest('#topCardLoc')) return;
      e.preventDefault();
      _openTopCardBgMenu();
    });
  });
})();

// ============================================================
// 桌面壁纸
// ============================================================
// 存储：localStorage key stm_desktopWp（URL或IndexedDB引用ID）
// 壁纸层：.desktop-wallpaper（absolute定位，z-index:-1）
// 壁纸模式：localStorage key stm_wpMode
//cover=铺满裁剪，contain=完整不裁剪，auto=原始大小，stretch=拉伸

// handleDesktopWallpaper(e) → 上传桌面壁纸
//   ·读取文件 → 存IndexedDB → 应用到.desktop-wallpaper
async function handleDesktopWallpaper(e) {
  var f = e.target.files[0];
  if (!f) return;
  var compressed = await cbyd21_compressImg(f, 1080, 0.82);
  cbyd21_Data.storeImage(compressed).then(function(ref) {
    localStorage.setItem('stm_desktopWp', ref);
    applyDesktopWallpaper(compressed);
    showToast('桌面壁纸已更换');
  });
  e.target.value = '';
}

// applyDesktopWallpaper(dataUrl) → 将壁纸图应用到桌面壁纸层
//   · dataUrl有值 → 设为背景图，加.custom类
//   · dataUrl为空 → 清除背景图，移除.custom类
//   · 同步更新美化页的预览框
function applyDesktopWallpaper(dataUrl) {
  var el = document.querySelector('.desktop-wallpaper');
  if (!el) return;
  if (dataUrl) {
    el.style.backgroundImage = cbyd21_Desktop_cssUrl(dataUrl);
    el.classList.add('custom');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('custom');
  }
  var pv = document.getElementById('desktopWpPreviewBg');
  if (pv) { pv.style.backgroundImage = dataUrl ? cbyd21_Desktop_cssUrl(dataUrl) : ''; }
}

// clearDesktopWallpaper() → 清除桌面壁纸，恢复默认渐变背景
function clearDesktopWallpaper() {
  localStorage.removeItem('stm_desktopWp');
  applyDesktopWallpaper(null);
  showToast('已恢复默认壁纸');
}

// loadDesktopWallpaper() → 页面加载时恢复桌面壁纸
//   · http开头直接用
//   · 否则从IndexedDB加载base64
//   · 同时加载壁纸模式
function loadDesktopWallpaper() {
  var ref = localStorage.getItem('stm_desktopWp');
  if (!ref) return;
  if (cbyd21_Desktop_isDirectImageRef(ref)) { applyDesktopWallpaper(ref); }
  else { cbyd21_Data.loadImage(ref).then(function(d) { if (d) applyDesktopWallpaper(d); }); }
  loadWpMode();
}

// setDesktopWallpaperUrl() → 通过URL设置桌面壁纸
//   · 弹出prompt输入URL
//   · 直接存URL到localStorage（不存IndexedDB）
function setDesktopWallpaperUrl() {
  var url = prompt('输入桌面壁纸图片URL：');
  if (!url || !url.trim()) return;
  url = url.trim();
  localStorage.setItem('stm_desktopWp', url);
  applyDesktopWallpaper(url);
  showToast('桌面壁纸已更换');
}

// refreshDesktopWpPreview() → 刷新美化页的桌面壁纸小预览框
//   · 读取当前壁纸引用，加载图片
//   · 同步壁纸模式到预览框（cover/contain/auto/stretch）
function refreshDesktopWpPreview() {
  var ref = localStorage.getItem('stm_desktopWp');
  var pv = document.getElementById('desktopWpPreviewBg');
  if (!pv) return;
  if (!ref) { pv.style.backgroundImage = ''; return; }
  var mode = localStorage.getItem('stm_wpMode') || 'cover';
  pv.style.backgroundSize = { cover: 'cover', contain: 'contain', auto: 'auto', stretch: '100% 100%' }[mode] || 'cover';
  pv.style.backgroundRepeat = 'no-repeat';
  pv.style.backgroundPosition = 'center';
  if (cbyd21_Desktop_isDirectImageRef(ref)) { pv.style.backgroundImage = cbyd21_Desktop_cssUrl(ref); }
  else { cbyd21_Data.loadImage(ref).then(function(d) { if (d && pv) pv.style.backgroundImage = cbyd21_Desktop_cssUrl(d); }); }
}

// ============================================================
// 壁纸模式
// ============================================================
// 四种模式：cover/contain/auto/stretch
// 存储：localStorage key stm_wpMode

// setWpMode(mode) → 设置壁纸显示模式
//   · 保存到localStorage
//   · 应用到壁纸层CSS类
//   · 显示toast提示
function setWpMode(mode) {
  localStorage.setItem('stm_wpMode', mode);
  applyWpMode(mode);
  showToast('壁纸模式：' + { cover: '铺满', contain: '完整', auto: '原始', stretch: '拉伸' }[mode]);
}

// applyWpMode(mode) → 应用壁纸模式到.desktop-wallpaper的CSS类
//   · 移除所有旧模式类→ 添加新模式类
//   · 同步更新预览框和模式按钮高亮
function applyWpMode(mode) {
  var el = document.querySelector('.desktop-wallpaper');
  if (!el) return;
  el.classList.remove('wp-cover', 'wp-contain', 'wp-auto', 'wp-stretch');
  el.classList.add('wp-' + (mode || 'cover'));
  updateWpModeButtons(mode);
  var pv = document.getElementById('desktopWpPreviewBg');
  if (pv) {
    pv.style.backgroundSize = { cover: 'cover', contain: 'contain', auto: 'auto', stretch: '100% 100%' }[mode] || 'cover';
    pv.style.backgroundRepeat = 'no-repeat';
    pv.style.backgroundPosition = 'center';
  }
}

// updateWpModeButtons(mode) → 高亮当前选中的壁纸模式按钮
//   · 美化页里四个模式按钮，选中的加紫色背景
function updateWpModeButtons(mode) {
  var modes = ['cover', 'contain', 'auto', 'stretch'];
  modes.forEach(function(m) {
    var btn = document.getElementById('wpMode' + m.charAt(0).toUpperCase() + m.slice(1));
    if (btn) {
      btn.style.background = m === mode ? 'var(--accent)' : '';
      btn.style.color = m === mode ? '#fff' : '';
      btn.style.borderColor = m === mode ?'var(--accent)' : '';
    }
  });
}

// loadWpMode() → 从localStorage加载壁纸模式并应用
function loadWpMode() {
  var mode = localStorage.getItem('stm_wpMode') || 'cover';
  applyWpMode(mode);
}

// ============================================================
// 应用图标自定义
// ============================================================
// _customIcons → 存储自定义图标引用 { 'desktop_0': 引用ID, 'dock_1': URL, ... }
//   · desktop_0 ~ desktop_9 → 桌面10个应用图标
//   · dock_0 ~ dock_3 → 底部Dock 4个图标
//   · 值可以是IndexedDB引用ID 或 http URL
//   · 存储：localStorage key stm_customIcons

// _iconCustomSlot → 当前正在替换的图标槽位key（如'desktop_0'）
var _customIcons = cbyd21_Desktop_safeJson('stm_customIcons', {});
if(!_customIcons || typeof _customIcons !== 'object' || Array.isArray(_customIcons))_customIcons = {};
var _iconCustomSlot = null;

// _iconSlotDefs → 所有图标槽位定义（桌面10个 + Dock 4个）
//   · key: localStorage引用key
//   · name: 显示名称
//   · type: 'desktop' 或 'dock'
//   · slot: HTML中data-slot 或 data-dockslot 的值
var _iconSlotDefs = [
  { key: 'desktop_0', name: '消息', type: 'desktop', slot: 0 },
  { key: 'desktop_1', name: '写卡助手', type: 'desktop', slot: 1 },
  { key: 'desktop_2', name: '绘言戏局', type: 'desktop', slot: 2 },
  { key: 'desktop_3', name: '正则', type: 'desktop', slot: 3 },
  { key: 'desktop_4', name: '咫尺朝夕', type: 'desktop', slot: 4 },
  { key: 'desktop_5', name: '遇赴尘烟', type: 'desktop', slot: 5 },
  { key: 'desktop_6', name:'HTML预览', type: 'desktop', slot: 6 },
  { key: 'desktop_7', name: '暮屿藏笺', type: 'desktop', slot: 7 },
  { key: 'desktop_8', name: '素页同栖', type: 'desktop', slot: 8 },
  { key: 'desktop_9', name: '占位', type: 'desktop', slot: 9 },
  { key: 'dock_0', name: '设置', type: 'dock', slot: 0 },
  { key: 'dock_1', name: '美化', type: 'dock', slot: 1 },
  { key: 'dock_2', name: '世界书', type: 'dock', slot: 2 },
  { key: 'dock_3', name: '记忆', type: 'dock', slot: 3 }
];

// getDefaultIconMarkup(key) → 获取指定槽位的默认SVG图标HTML
//   · 用于恢复默认图标时替换回原始SVG
//   · key格式：'desktop_0' ~ 'desktop_9', 'dock_0' ~ 'dock_3'
function getDefaultIconMarkup(key) {
  var map = {
    desktop_0: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h18a1 1 0 011 1v10a1 1 0 01-1 1h-5l-4 4v-4H5a1 1 0 01-1-1V8a1 1 0 011-1z"/><circle cx="10" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>',
    desktop_1: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 4l4 4L9 20H5v-4L17 4z"/><line x1="14" y1="7" x2="21" y2="14" opacity="0.3"/><line x1="5" y1="24" x2="14" y2="24"/></svg>',
    desktop_2: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="6" width="18" height="16" rx="2"/><rect x="8" y="9" width="12" height="8" rx="1" opacity="0.35" fill="currentColor" stroke="none"/><path d="M5 6l2-3h14l2 3"/><path d="M9 22l-2 3"/><path d="M19 22l2 3"/><circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" opacity="0.7"/><path d="M12 16l2-2 2 1 2-3" opacity="0.75"/></svg>',
    desktop_3: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l3 3-3 3"/><path d="M4 18l3 3-3 3"/><line x1="10" y1="11" x2="24" y2="11" opacity="0.6"/><line x1="10" y1="21" x2="20" y2="21" opacity="0.6"/><path d="M21 16l3 3-3 3" opacity="0.4"/><circle cx="18" cy="6" r="2" opacity="0.3"/></svg>',
    desktop_4: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="10" r="5"/><path d="M6 24Q6 18 14 18 Q22 18 22 24"/><circle cx="20" cy="8" r="3" opacity="0.4"/></svg>',
    desktop_5: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 6Q10 2 7 6 4 10 7 14l7 8 7-8q3-4 0-8Q18 2 14 6z"/><circle cx="14" cy="11" r="2" opacity="0.4"/></svg>',
    desktop_6: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l-3 6 3 6"/><path d="M22 8l3 6-3 6"/><path d="M16 5l-4 18" opacity="0.5"/></svg>',
    desktop_7: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5h12a2 2 0 012 2v16l-8-4-8 4V7a2 2 0 012-2z"/><path d="M11 10h6" opacity="0.45"/><path d="M11 14h4" opacity="0.35"/></svg>',
    desktop_8: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5h7a3 3 0 013 3v15H9a3 3 0 00-3 2V5z"/><path d="M22 5h-6a3 3 0 00-3 3v15h6a3 3 0 013 2V5z" opacity="0.65"/><path d="M9 9h3"/><path d="M9 13h4" opacity="0.5"/><path d="M17 9h3" opacity="0.5"/><path d="M17 13h2" opacity="0.35"/></svg>',
    desktop_9: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="14" r="9"/><circle cx="14" cy="14" r="4" opacity="0.4"/><line x1="14" y1="5" x2="14" y2="8" opacity="0.3"/><line x1="14" y1="20" x2="14" y2="23" opacity="0.3"/><line x1="5" y1="14" x2="8" y2="14" opacity="0.3"/><line x1="20" y1="14" x2="23" y2="14" opacity="0.3"/></svg>',
    dock_0: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="width:26px;height:26px"><circle cx="14" cy="14" r="4"/><circle cx="14" cy="14" r="9" opacity="0.3"/><line x1="14" y1="2" x2="14" y2="5"/><line x1="14" y1="23" x2="14" y2="26"/><line x1="2" y1="14" x2="5" y2="14"/><line x1="23" y1="14" x2="26" y2="14"/><line x1="5.5" y1="5.5" x2="7.5" y2="7.5"/><line x1="20.5" y1="20.5" x2="22.5" y2="22.5"/><line x1="22.5" y1="5.5" x2="20.5" y2="7.5"/><line x1="7.5" y1="20.5" x2="5.5" y2="22.5"/></svg>',
    dock_1: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="width:26px;height:26px"><circle cx="9" cy="9" r="4"/><circle cx="19" cy="8" r="3" opacity="0.5"/><circle cx="19" cy="19" r="2.5" opacity="0.4"/><circle cx="9" cy="19" r="3" opacity="0.5"/></svg>',
    dock_2: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px"><path d="M4 5h9v20H5a1 1 0 01-1-1V5z"/><path d="M13 5h11v19a1 1 0 01-1 1H13V5z"/><line x1="13" y1="5" x2="13" y2="25"/><line x1="7" y1="10" x2="10" y2="10" opacity="0.4"/><line x1="7" y1="13" x2="10" y2="13" opacity="0.4"/><line x1="16" y1="10" x2="21" y2="10" opacity="0.4"/><line x1="16" y1="13" x2="20" y2="13" opacity="0.4"/></svg>',
    dock_3: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="width:26px;height:26px"><path d="M14 6Q10 2 7 6 4 10 7 14l7 8 7-8q3-4 0-8Q18 2 14 6z"/><path d="M10 10Q12 8 14 10" opacity="0.4"/><path d="M14 10 Q16 8 18 10" opacity="0.4"/></svg>'
  };
  return map[key] || '';
}

// cbyd21_UI.renderIconCustomGrid() → 渲染美化页的图标替换网格
//   · 遍历 _iconSlotDefs（14个槽位）
//   · 有自定义图标的显示缩略图，没有的显示空白
//   · 点击触发文件选择器上传新图标
cbyd21_UI.renderIconCustomGrid = function() {
  var grid = document.getElementById('iconCustomGrid');
  if (!grid) return;
  grid.innerHTML = '';

  _iconSlotDefs.forEach(function(def) {
    var item = document.createElement('div');
    item.className = 'icon-custom-item';
    item.dataset.slotkey = def.key;

    var hasCustom = _customIcons[def.key];
    item.innerHTML = '<div class="preview">' + (hasCustom ? '<img src="">' : '') + '</div><div class="name">' + def.name + '</div>';

    // 有自定义图标时异步加载缩略图
    if (hasCustom) {
      (function(slotKey, el) {
        var ref = _customIcons[slotKey];
        if (cbyd21_Desktop_isDirectImageRef(ref)) {
          var img = el.querySelector('img');
          if (img) img.src = ref;
        } else {
          cbyd21_Data.loadImage(ref).then(function(d) {
            var img = el.querySelector('img');
            if (img && d) img.src = d;
          });
        }
      })(def.key, item);
    }

    // 点击上传新图标
    item.onclick = function() {
      _iconCustomSlot = def.key;
      document.getElementById('iconCustomInput').click();
    };

    grid.appendChild(item);
  });
}

// handleIconCustomUpload(e) → 处理图标上传
//   · 读取文件 → 存IndexedDB → 应用到桌面 → 刷新网格
async function handleIconCustomUpload(e) {
  var f = e.target.files[0];
  if (!f || _iconCustomSlot === null) return;
  var compressed = await cbyd21_compressImg(f, 200, 0.8);
  cbyd21_Data.storeImage(compressed).then(function(ref) {
    _customIcons[_iconCustomSlot] = ref;
    localStorage.setItem('stm_customIcons', JSON.stringify(_customIcons));
    applyCustomIconToDesktop(_iconCustomSlot, compressed);
    cbyd21_UI.renderIconCustomGrid();
    showToast('图标已更换');
  });
  e.target.value = '';
}

// applyCustomIconToDesktop(slotKey, dataUrl) → 将自定义图标应用到桌面或Dock
//   · slotKey='desktop_N' → 找data-slot="N" 的 .desktop-icon-img
//   · slotKey='dock_N' → 找 data-dockslot="N" 的 .dock-icon
//   · dataUrl有值 → 替换为<img>
//   · dataUrl为空 → 恢复默认SVG图标
function applyCustomIconToDesktop(slotKey, dataUrl) {
  var el = null;

  if (slotKey.indexOf('desktop_') === 0) {
    var slot = slotKey.replace('desktop_', '');
    el = document.querySelector('.desktop-icon[data-slot="' + slot + '"] .desktop-icon-img');
  } else if (slotKey.indexOf('dock_') === 0) {
    var dockSlot = slotKey.replace('dock_', '');
    el = document.querySelector('.dock-icon[data-dockslot="' + dockSlot + '"]');
  }

  if (!el) return;

  if (dataUrl) {
    el.innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
  } else {
    el.innerHTML = getDefaultIconMarkup(slotKey);
  }
}

// loadCustomIcons() → 页面加载时恢复所有自定义图标
//   · 遍历 _customIcons 对象
//   · http开头直接用，否则从IndexedDB加载
//   · 加载完后刷新美化页网格（如果美化页已打开）
function loadCustomIcons() {
  Object.keys(_customIcons).forEach(function(slotKey) {
    var ref = _customIcons[slotKey];
    if (!ref) return;

    if (cbyd21_Desktop_isDirectImageRef(ref)) {
      applyCustomIconToDesktop(slotKey, ref);
    } else {
      cbyd21_Data.loadImage(ref).then(function(d) {
        if (d) applyCustomIconToDesktop(slotKey, d);
      });
    }
  });

  if (cbyd21_UI.renderIconCustomGrid) cbyd21_UI.renderIconCustomGrid();
}

// setIconByUrl() → 通过URL替换指定位置的图标
//   · 先问用户要替换第几个（1~14）
//   · 1~10=桌面图标，11~14=Dock图标
//   · 再问URL
//   · 直接存URL到_customIcons（不存IndexedDB）
function setIconByUrl() {
  var slotStr = prompt('要替换第几个图标？（1~14）\n1~10 = 桌面图标\n11~14 = Dock图标');
  if (!slotStr) return;

  var slot = parseInt(slotStr) - 1;
  if (isNaN(slot) || slot < 0 || slot > 13) {
    showToast('请输入 1~14 的数字');
    return;
  }

  var url = prompt('输入图标图片URL：');
  if (!url || !url.trim()) return;
  url = url.trim();

  var def = _iconSlotDefs[slot];
  if (!def) return;

  _customIcons[def.key] = url;
  localStorage.setItem('stm_customIcons', JSON.stringify(_customIcons));
  applyCustomIconToDesktop(def.key, url);
  cbyd21_UI.renderIconCustomGrid();
  showToast('图标已更换');
}

// clearAllCustomIcons() → 恢复所有图标为默认SVG
//   · 清空 _customIcons 对象
//   · 删除 localStorage
//   · 遍历所有槽位恢复默认SVG
//   · 刷新美化页网格
function clearAllCustomIcons() {
  _customIcons = {};
  localStorage.removeItem('stm_customIcons');

  _iconSlotDefs.forEach(function(def) {
    applyCustomIconToDesktop(def.key, null);
  });

  cbyd21_UI.renderIconCustomGrid();
  showToast('已恢复所有默认图标');
}


// ============================================================
// 自定义字体（全局替换）
// ============================================================
// 存储：localStorage key stm_customFont（JSON: {url, name}）
// 通过动态style标签注入@font-face + 覆盖body的font-family
// 全局生效，影响所有界面的文字

// saveCustomFont() → 从表单读取URL和名称，保存并应用
function saveCustomFont() {
  var url = document.getElementById('customFontUrl').value.trim();
  if (!url) { showToast('请输入字体文件URL'); return; }
  var name = document.getElementById('customFontName').value.trim() || '自定义字体';
  var data = { url: url, name: name };
  localStorage.setItem('stm_customFont', JSON.stringify(data));
  _applyCustomFont(data);
  showToast('字体加载中…');
}

// clearCustomFont() → 清除自定义字体，恢复系统默认
function clearCustomFont() {
  localStorage.removeItem('stm_customFont');
  var el = document.getElementById('customFontStyle');
  if (el) el.textContent = '';
  document.getElementById('customFontUrl').value = '';
  document.getElementById('customFontName').value = '';
  var preview = document.getElementById('customFontPreview');
  if (preview) preview.style.display = 'none';
  showToast('已恢复默认字体');
}

// loadCustomFont() → 页面加载时恢复自定义字体
function loadCustomFont() {
  var raw = localStorage.getItem('stm_customFont');
  if (!raw) return;
  try {
    var data = JSON.parse(raw);
    if (data && data.url) _applyCustomFont(data);
  } catch (e) {}
}

// _applyCustomFont(data) → 注入@font-face和全局font-family覆盖
//   · data = { url: '字体文件URL', name: '显示名称' }
//   · 创建或更新 #customFontStyle 标签
//   · @font-face声明字体族名为 'STM-Custom'
//   · body的font-family在最前面插入 'STM-Custom'
function _applyCustomFont(data) {
  if (!data || !data.url) return;
  var el = document.getElementById('customFontStyle');
  if (!el) {
    el = document.createElement('style');
    el.id = 'customFontStyle';
    document.head.appendChild(el);
  }
  // 推断字体格式
  var format = 'truetype';
  var urlLower = data.url.toLowerCase();
  if (urlLower.indexOf('.woff2') >= 0) format = 'woff2';
  else if (urlLower.indexOf('.woff') >= 0) format = 'woff';
  else if (urlLower.indexOf('.otf') >= 0) format = 'opentype';

  el.textContent = '@font-face{font-family:"STM-Custom";src:url("' + data.url + '") format("' + format + '");font-weight:normal;font-style:normal;font-display:swap}' +
    'body,input,textarea,select,button,.msg-bubble,.form-input,.form-textarea,.form-select{font-family:"STM-Custom",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif!important}';

  // 更新预览区
  var preview = document.getElementById('customFontPreview');
  var previewName = document.getElementById('customFontPreviewName');
  if (preview) preview.style.display = 'block';
  if (previewName) previewName.textContent = data.name || '自定义字体';
}

// ============================================================
// 字体预设管理
// ============================================================
// 存储：localStorage key stm_fontPresets（JSON数组）
// 每条预设：{ name: '预设名', url: '字体URL', fontName: '显示名称' }
// 选择预设→自动填入表单并应用
// 保存预设→从当前表单读取URL和名称存入列表
// 删除预设→删除选中的预设

// _loadFontPresetList() → 渲染字体预设下拉列表
function _loadFontPresetList() {
  var sel = document.getElementById('fontPresetSelect');
  if (!sel) return;
  var presets = cbyd21_Desktop_safeJson('stm_fontPresets', []);
  if(!Array.isArray(presets))presets = [];
  var curVal = sel.value;
  sel.innerHTML = '<option value="">— 选择预设 —</option>';
  presets.forEach(function(p, i) {
    var opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name + (p.fontName && p.fontName !== p.name ? ' (' + p.fontName + ')' : '');
    sel.appendChild(opt);
  });
  if (curVal && sel.querySelector('option[value="' + curVal + '"]')) sel.value = curVal;
}

// loadFontPreset() → 选中预设后填入表单并立即应用
function loadFontPreset() {
  var sel = document.getElementById('fontPresetSelect');
  var idx = sel.value;
  if (idx === '') return;
  var presets = cbyd21_Desktop_safeJson('stm_fontPresets', []);
  if(!Array.isArray(presets))presets = [];
  var p = presets[parseInt(idx)];
  if (!p) return;
  document.getElementById('customFontUrl').value = p.url || '';
  document.getElementById('customFontName').value = p.fontName || '';
  // 立即应用
  var data = { url: p.url, name: p.fontName || '自定义字体' };
  localStorage.setItem('stm_customFont', JSON.stringify(data));
  _applyCustomFont(data);
  showToast('已切换字体：' + p.name);
}

// saveFontPreset() → 把当前表单里的字体保存为预设
function saveFontPreset() {
  var url = document.getElementById('customFontUrl').value.trim();
  if (!url) { showToast('请先填写字体URL'); return; }
  var fontName = document.getElementById('customFontName').value.trim() || '自定义字体';
  var presets = cbyd21_Desktop_safeJson('stm_fontPresets', []);
  if(!Array.isArray(presets))presets = [];
  // 弹出输入预设名称
  var name = prompt('预设名称：', fontName);
  if (!name || !name.trim()) return;
  name = name.trim();
  var entry = { name: name, url: url, fontName: fontName };
  // 同名覆盖
  var existIdx = presets.findIndex(function(p) { return p.name === name; });
  if (existIdx >= 0) {
    presets[existIdx] = entry;
    showToast('预设「' + name + '」已覆盖');
  } else {
    presets.push(entry);
    showToast('预设「' + name + '」已保存');
  }
  localStorage.setItem('stm_fontPresets', JSON.stringify(presets));
  _loadFontPresetList();
}

// deleteFontPreset() → 删除选中的字体预设
function deleteFontPreset() {
  var sel = document.getElementById('fontPresetSelect');
  var idx = sel.value;
  if (idx === '') { showToast('请先选择预设'); return; }
  var presets = cbyd21_Desktop_safeJson('stm_fontPresets', []);
  if(!Array.isArray(presets))presets = [];
  var p = presets[parseInt(idx)];
  if (!p) return;
  presets.splice(parseInt(idx), 1);
  localStorage.setItem('stm_fontPresets', JSON.stringify(presets));
  _loadFontPresetList();
  showToast('预设「' + p.name + '」已删除');
}

// _fillCustomFontForm() → 打开美化页时填充字体表单
function _fillCustomFontForm() {
  var raw = localStorage.getItem('stm_customFont');
  var urlEl = document.getElementById('customFontUrl');
  var nameEl = document.getElementById('customFontName');
  var preview = document.getElementById('customFontPreview');
  var previewName = document.getElementById('customFontPreviewName');
  if (!raw) {
    if (urlEl) urlEl.value = '';
    if (nameEl) nameEl.value = '';
    if (preview) preview.style.display = 'none';
    return;
  }
  try {
    var data = JSON.parse(raw);
    if (urlEl) urlEl.value = data.url || '';
    if (nameEl) nameEl.value = data.name || '';
    if (preview) preview.style.display = 'block';
    if (previewName) previewName.textContent = data.name || '自定义字体';
  } catch (e) {}
}
