// ===== 【模块】cbyd21_Reading — 素页同栖 =====
// 当前范围：
// · 桌面入口打开 / 关闭
// · 首页三入口
// · 品墨知音 / 阅趣同行共读项目
// · 新建项目、角色选择、TXT/MD 导入、自动分段
// · 阅读页、段落选择、批注浮签、心声/问TA 抽屉
// · 批注 + 心声 API、问TA API
// · 执笔成篇：自由生成、用户×角色故事、继续扩写、历史记录
// · 文风预设、专用破限词、错误记录
// · 本地数据 key 初始化、导入导出、iOS 友好页面栈
//
// 边界：不做聊天分支，不自动写记忆，不自动批量调用 API。
// 生成类操作均由用户点击触发，且每次动作只调用一次 API。

(function(){
  if(window.cbyd21_Reading)return;

  window.cbyd21_Reading = {
    // _pageStack
    // → 素页同栖内部页面栈。
    // home 为首页；shelf/newProject/writing/settings 为内部页。
    _pageStack:['home'],

    // _currentMode
    // → 当前共读模式。
    // pinmo = 品墨知音；yuequ = 阅趣同行。
    _currentMode:'pinmo',

    // _draftCharId
    // → 新建共读表单里当前选择的角色 ID。
    // 第一批不做多角色共读，一个项目只绑定一个角色。
    _draftCharId:null,

    // _currentProjectId
    // → 当前正在阅读的项目 ID。
    _currentProjectId:null,

    // _currentParagraphId
    // → 当前阅读页选中的段落 ID。
    _currentParagraphId:null,

    // _writeType
    // → 当前执笔成篇表单类型。
    // free = 自由生成；userCharStory = 用户×角色故事。
    _writeType:'free',

    // _writeCharId
    // → 用户×角色故事当前选择的角色 ID。
    _writeCharId:null,

    // _currentWriteId
    // → 当前打开的生成结果 ID。
    _currentWriteId:null,

    // _editingStylePresetId
    // → 当前正在编辑的素页同栖文风预设 ID。
    // null 表示新建。
    _editingStylePresetId:null,

    // _suspendWriteDraft
    // → 打开写作表单、恢复草稿、重置表单时临时暂停自动保存草稿。
    // 防止表单赋值过程中触发 oninput/onchange，把半恢复状态写回草稿。
    _suspendWriteDraft:false,

    // _drawerOpen
    // → 阅读页底部抽屉是否打开。
    // 返回键优先关闭抽屉，再退内部页面栈。
    _drawerOpen:false,

    // _generating
    // → 素页同栖当前是否正在调用 API。
    // 用于防止重复点击生成批注、问TA、执笔成篇时重复请求。
    _generating:false,

    // _abortController
    // → 素页同栖当前 API 请求的终止控制器。
    // 关闭 App 或用户离开时可中断本次生成，不自动重试。
    _abortController:null,

    // keys
    // → 素页同栖本地存储 key。
    // 第一批只初始化空结构，后续项目/批注/长文会写入这些 key。
    keys:{
      projects:'stm_readingProjects',
      writes:'stm_readingWrites',
      presets:'stm_readingStylePresets',
      settings:'stm_readingSettings',
      breaker:'stm_readingBreaker'
    },

    // _safeJson(key,fallback)
    // → 安全读取素页同栖本地 JSON。
    // 如果数据损坏，会把坏数据备份到 key_broken_时间戳，并返回 fallback。
    _safeJson:function(key, fallback){
      try{
        var raw = localStorage.getItem(key);

        if(raw === null || raw === undefined || raw === ''){
          return fallback;
        }

        return JSON.parse(raw);
      }catch(e){
        console.warn('素页同栖 JSON 读取失败：', key, e);

        try{
          localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
        }catch(_e){}

        return fallback;
      }
    },

    // loadProjects()
    // → 读取所有共读项目。
    // 返回数组；异常或空数据时返回 []。
    loadProjects:function(){
      var arr = this._safeJson(this.keys.projects, []);
      return Array.isArray(arr) ? arr : [];
    },

    // saveProjects(list)
    // → 保存共读项目数组。
    // 第一批只用于空结构和书架计数，后续新建项目会写入真实数据。
    saveProjects:function(list){
      localStorage.setItem(this.keys.projects, JSON.stringify(Array.isArray(list) ? list : []));
    },

    // loadWrites()
    // → 读取执笔成篇生成历史。
    // 返回数组；异常或空数据时返回 []。
    loadWrites:function(){
      var arr = this._safeJson(this.keys.writes, []);
      return Array.isArray(arr) ? arr : [];
    },

    // saveWrites(list)
    // → 保存执笔成篇生成历史数组。
    saveWrites:function(list){
      localStorage.setItem(this.keys.writes, JSON.stringify(Array.isArray(list) ? list : []));
    },

    // loadStylePresets()
    // → 读取素页同栖文风预设。
    // 第一版提供少量默认预设；用户自定义预设后保存在 stm_readingStylePresets。
    loadStylePresets:function(){
      var raw = localStorage.getItem(this.keys.presets);
      var arr = this._safeJson(this.keys.presets, []);

      if(!Array.isArray(arr))arr = [];

      // 只有首次不存在 key 时，才写入默认预设。
      // 如果用户已经把预设删成 []，必须尊重用户选择，不自动复活默认预设。
      if(raw === null){
        arr = [
          {
            id:'reading_style_plain',
            name:'清淡叙事',
            prompt:'文字克制、清晰、留白适中，避免过度煽情和堆砌修辞。',
            target:'all',
            createdAt:0,
            updatedAt:0
          },
          {
            id:'reading_style_literary',
            name:'文学感',
            prompt:'语言更有层次，注重意象、节奏、心理暗流和句子余韵，但保持自然可读。',
            target:'writing',
            createdAt:0,
            updatedAt:0
          },
          {
            id:'reading_style_tension',
            name:'关系张力',
            prompt:'更关注人物之间未说出口的情绪、试探、克制、靠近与回避，让关系张力自然推进。',
            target:'writing',
            createdAt:0,
            updatedAt:0
          }
        ];

        localStorage.setItem(this.keys.presets, JSON.stringify(arr));
      }

      return arr;
    },

    // loadSettings()
    // → 读取素页同栖设置对象。
    // 第一批只预留结构；专用破限词单独存在 stm_readingBreaker。
    loadSettings:function(){
      var obj = this._safeJson(this.keys.settings, {});
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    },

    // saveSettingsData(obj)
    // → 保存素页同栖设置对象。
    saveSettingsData:function(obj){
      localStorage.setItem(this.keys.settings, JSON.stringify(obj || {}));
    },

    // ensureData()
    // → 初始化素页同栖本地数据 key。
    // 不覆盖已有数据，只在 key 不存在时写入空结构。
    ensureData:function(){
      if(!localStorage.getItem(this.keys.projects)){
        localStorage.setItem(this.keys.projects, '[]');
      }

      if(!localStorage.getItem(this.keys.writes)){
        localStorage.setItem(this.keys.writes, '[]');
      }

      if(!localStorage.getItem(this.keys.presets)){
        localStorage.setItem(this.keys.presets, '[]');
      }

      if(!localStorage.getItem(this.keys.settings)){
        localStorage.setItem(this.keys.settings, '{}');
      }

      if(localStorage.getItem(this.keys.breaker) === null){
        localStorage.setItem(this.keys.breaker, '');
      }
    },

    // openApp()
    // → 从桌面打开素页同栖。
    // 初始化数据、隐藏桌面、显示 readingApp、进入首页并推入 history。
    openApp:function(){
      this.ensureData();

      document.getElementById('desktop').classList.add('hidden');
      document.getElementById('readingApp').classList.add('active');

      currentAppId = 'readingApp';

      this._pageStack = ['home'];
      this.showPage('home', true);
      this.refresh();
      this.openNoticeIfNeeded();

      history.pushState({app:'readingApp'}, '');
      updateSnowVisibility && updateSnowVisibility();
    },

    // openNoticeIfNeeded()
    // → 首次进入素页同栖时显示制作中提示。
    // 用户勾选“不再提示”后不再自动弹出。
    openNoticeIfNeeded:function(){
      if(localStorage.getItem('stm_readingNoticeDismissed') === '1')return;

      var cb = document.getElementById('readingNoticeDontShow');
      if(cb){
        cb.checked = false;
      }

      var overlay = document.getElementById('readingNoticeOverlay');

      if(overlay){
        overlay.classList.add('active');
      }
    },

    // closeNotice()
    // → 关闭素页同栖制作中提示。
    // 如果用户勾选不再提示，则写入本地偏好。
    closeNotice:function(){
      var cb = document.getElementById('readingNoticeDontShow');

      if(cb && cb.checked){
        localStorage.setItem('stm_readingNoticeDismissed','1');
      }

      var overlay = document.getElementById('readingNoticeOverlay');

      if(overlay){
        overlay.classList.remove('active');
      }
    },

    // closeApp(fromPopstate)
    // → 关闭素页同栖并回到桌面。
    // fromPopstate=true 表示浏览器返回键触发，不再主动 history.back()。
    closeApp:function(fromPopstate){
      if(this._abortController){
        try{
          this._abortController.abort();
        }catch(e){}

        this._abortController = null;
        this._setGenerating(false);

        var resultBox = document.getElementById('readingWriteResultContent');
        var resultTitle = document.getElementById('readingWriteResultTitle');

        if(resultBox && /正在生成/.test(resultBox.textContent || '')){
          resultBox.textContent = '生成已中断。';
        }

        if(resultTitle && resultTitle.textContent === '生成中'){
          resultTitle.textContent = '生成已中断';
        }
      }

      this.closeDrawer(true);
      this._drawerOpen = false;

      var notice = document.getElementById('readingNoticeOverlay');
      if(notice){
        notice.classList.remove('active');
      }

      var app = document.getElementById('readingApp');

      if(app){
        app.classList.remove('active');
      }

      document.getElementById('desktop').classList.remove('hidden');

      currentAppId = null;

      if(!fromPopstate){
        try{
          _ignorePopstate = true;
          history.back();
        }catch(e){}
      }

      updateSnowVisibility && updateSnowVisibility();
    },

    // showPage(page,replace)
    // → 切换素页同栖内部页面。
    // replace=true 时只替换当前页，不压入内部页面栈。
    // 如果当前已经在同一页面，也不重复压栈，避免返回时绕回重复页面。
    showPage:function(page, replace){
      var current = this._pageStack[this._pageStack.length - 1] || 'home';
      var samePage = current === page;

      var pages = document.querySelectorAll('#readingPages .reading-page');

      pages.forEach(function(el){
        var active = el.dataset.readingPage === page;
        el.classList.toggle('active', active);
        el.classList.remove('back');
      });

      if(!replace && !samePage){
        this._pageStack.push(page);
        _pushInnerPageState && _pushInnerPageState('reading_' + page);
      }

      this._syncHeader(page);

      var activePage = document.querySelector('#readingPages .reading-page.active .reading-scroll');

      if(activePage && !samePage){
        activePage.scrollTop = 0;
      }
    },

    // _syncHeader(page)
    // → 根据当前内部页面刷新顶部标题和副标题。
    _syncHeader:function(page){
      var title = document.getElementById('readingHeaderTitle');
      var sub = document.getElementById('readingHeaderSub');

      if(!title || !sub)return;

      if(page === 'home'){
        title.textContent = '素页同栖';
        sub.textContent = '与角色同栖一页，共读、批注、写作';
      }else if(page === 'shelf'){
        title.textContent = this._currentMode === 'pinmo' ? '品墨知音' : '阅趣同行';
        sub.textContent = this._currentMode === 'pinmo'
          ? '文学作品、散文、诗歌与严肃批注'
          : '网络小说、剧情追读与轻松批注';
      }else if(page === 'newProject'){
        title.textContent = '新建共读';
        sub.textContent = this._currentMode === 'pinmo' ? '品墨知音' : '阅趣同行';
      }else if(page === 'reader'){
        var project = this._findProject ? this._findProject(this._currentProjectId) : null;
        title.textContent = project && project.title ? project.title : '阅读页';

        var ch = project && project.charId && typeof getCharById === 'function'
          ? getCharById(project.charId)
          : null;

        var charName = ch ? this._displayCharName(ch) : (project && project.charNameSnapshot || '未绑定角色');

        sub.textContent = charName + ' · ' + (project && project.mode === 'yuequ' ? '阅趣同行' : '品墨知音');
      }else if(page === 'writing'){
        title.textContent = '执笔成篇';
        sub.textContent = '自由生成、同栖故事与长文工坊';
      }else if(page === 'writeForm'){
        title.textContent = this._writeType === 'userCharStory' ? '用户 × 角色故事' : '自由生成';
        sub.textContent = '填写需求后生成长文';
      }else if(page === 'writeResult'){
        title.textContent = '生成结果';
        sub.textContent = '执笔成篇';
      }else if(page === 'settings'){
        title.textContent = '素页同栖设置';
        sub.textContent = '独立破限词与阅读偏好';
      }
    },

    // back(fromPopstate)
    // → 素页同栖内部返回。
    // 优先关闭阅读页抽屉；没有抽屉时退内部页面栈；已经在首页时关闭 App 回桌面。
    back:function(fromPopstate){
      var app = document.getElementById('readingApp');

      if(!app || !app.classList.contains('active')){
        return;
      }

      if(this._drawerOpen){
        this.closeDrawer(!!fromPopstate);
        return;
      }

      if(this._pageStack.length > 1){
        this._pageStack.pop();
        var prev = this._pageStack[this._pageStack.length - 1] || 'home';
        this.showPage(prev, true);

        if(!fromPopstate){
          try{
            _ignorePopstate = true;
            history.back();
          }catch(e){}
        }

        return;
      }

      this.closeApp(fromPopstate);
    },

    // openShelf(mode)
    // → 打开品墨知音 / 阅趣同行项目书架。
    // mode=pinmo 或 yuequ。
    openShelf:function(mode){
      this._currentMode = mode === 'yuequ' ? 'yuequ' : 'pinmo';
      this.renderShelf();
      this.showPage('shelf', false);
    },

    // openNewProject()
    // → 打开新建共读页。
    // 初始化表单，默认沿用上次使用角色；不调用 API。
    openNewProject:function(){
      var settings = this.loadSettings();
      this._draftCharId = settings.lastCharId || null;

      this._fillNewProjectForm();
      this.showPage('newProject', false);
    },

    // openWritingHome(replace)
    // → 打开执笔成篇首页。
    // replace=true 时不新增内部历史层，适合从结果页回历史。
    openWritingHome:function(replace){
      this.renderWriteHistory();
      this.showPage('writing', !!replace);
    },

    // _setGenerating(on)
    // → 设置素页同栖生成中状态。
    // 同步内部锁和 DOM class，给按钮显示禁用视觉。
    _setGenerating:function(on){
      this._generating = !!on;

      var app = document.getElementById('readingApp');

      if(app){
        app.classList.toggle('reading-generating', !!on);
      }
    },

    // copyText(text)
    // → 素页同栖内部复制工具。
    // 用于复制批注、心声、讨论、错误记录和生成结果片段。
    copyText:function(text){
      text = String(text || '');

      if(!text){
        showToast('没有可复制的内容');
        return;
      }

      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){
          showToast('已复制');
        }).catch(function(){
          if(typeof _fallbackCopy === 'function'){
            _fallbackCopy(text);
          }else{
            showToast('复制失败，请手动选择文本复制');
          }
        });
      }else if(typeof _fallbackCopy === 'function'){
        _fallbackCopy(text);
      }else{
        showToast('复制失败，请手动选择文本复制');
      }
    },

    // _errorText(e)
    // → 统一提取错误文案。
    _errorText:function(e){
      return String(e && e.message || e || '未知错误');
    },

    // _appendProjectError(project, type, detail)
    // → 给阅读项目记录一次错误。
    // 不影响正文、批注、讨论，只用于后续排查。
    _appendProjectError:function(project, type, detail){
      if(!project)return;

      if(!Array.isArray(project.errors)){
        project.errors = [];
      }

      project.errors.unshift({
        id:'err_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
        type:type || 'unknown',
        detail:String(detail || ''),
        createdAt:Date.now()
      });

      project.errors = project.errors.slice(0,20);
      this._saveProject(project);
    },

    // _appendWriteError(data, detail)
    // → 执笔成篇生成失败时保存一条错误记录。
    // 因为没有成功生成 result，所以写入 stm_readingWrites 里的 failed 记录。
    _appendWriteError:function(data, detail){
      var writes = this.loadWrites();
      var now = Date.now();

      writes.unshift({
        id:'write_err_' + now + '_' + Math.random().toString(36).slice(2,6),
        type:data && data.type || this._writeType || 'free',
        charId:data && data.charId || null,
        title:(data && data.title) || '生成失败',
        userPrompt:data && data.prompt || '',
        tags:data && data.tags || '',
        result:'',
        error:{
          detail:String(detail || ''),
          createdAt:now
        },
        createdAt:now,
        updatedAt:now
      });

      this.saveWrites(writes.slice(0,200));
    },

    // _extractApiTextFromResponse(response, rawText)
    // → 从 API 原始响应体中提取正文。
    // 兼容标准 OpenAI、NDJSON、SSE、JSON套字符串和纯文本。
    _extractApiTextFromResponse:function(response, rawText){
      var parsed = typeof _cbyd21ParseChatApiResponseText === 'function'
        ? _cbyd21ParseChatApiResponseText(rawText)
        : {data:null,text:rawText};

      var text = String(parsed.text || '').trim();

      if(!text && parsed.data && typeof _cbyd21ExtractChatApiContent === 'function'){
        text = String(_cbyd21ExtractChatApiContent(parsed.data) || '').trim();
      }

      return {
        text:text,
        data:parsed.data || null
      };
    },

    // _looksLikeOnlyApiError(text)
    // → 判断非 200 响应体提取出来的内容是否只是错误说明。
    // 如果像模型正文，就继续处理；如果只是错误，就抛出。
    _looksLikeOnlyApiError:function(text){
      text = String(text || '').trim();

      if(!text)return true;

      return /^(bad request|unauthorized|forbidden|not found|internal server error|too many requests|invalid request|request failed|error)$/i.test(text) ||
        (
          text.length < 30 &&
          /error|failed|invalid|unauthorized|forbidden|quota|limit|timeout/i.test(text)
        );
    },

    // _fetchChatCompletion(body,label)
    // → 素页同栖统一 API 调用。
    // 只调用一次 API，不自动重试，不自动修复。
    _fetchChatCompletion:async function(body,label){
      if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
        var pe = new Error('PromptLoadingBlocked: 提示词正在加载，请稍等…');
        pe.name = 'PromptLoadingBlocked';
        pe._cbyd21PromptLoadingBlocked = true;
        throw pe;
      }

      if(!apiConfig.url || !apiConfig.key || !apiConfig.model){
        throw new Error('请先配置 API');
      }

      this._abortController = new AbortController();

      try{
        var url = apiConfig.url.replace(/\/+$/,'') + '/chat/completions';
        var reqBody = body || {};

        reqBody.model = reqBody.model || apiConfig.model;

        if(apiConfig.temperature !== undefined && reqBody.temperature === undefined){
          reqBody.temperature = apiConfig.temperature;
        }

        var r = await fetch(url,{
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            'Authorization':'Bearer ' + apiConfig.key
          },
          body:JSON.stringify(reqBody),
          signal:this._abortController.signal
        });

        var rawText = await r.text();
        var extracted = this._extractApiTextFromResponse(r, rawText);

        if(!r.ok){
          if(extracted.text && extracted.text.length >= 10 && !this._looksLikeOnlyApiError(extracted.text)){
            console.warn((label || '素页同栖') + ' HTTP ' + r.status + ' 但响应体包含可读模型输出，按正常结果处理');
          }else{
            throw new Error('HTTP ' + r.status + ': ' + rawText.slice(0,300));
          }
        }

        if(!extracted.text && rawText && rawText.trim()){
          extracted.text =
            '[前端提示：API 已返回内容，但前端未能按已知字段提取正文。以下为模型原始返回内容。]\n\n' +
            rawText.trim();
        }

        var text = String(extracted.text || '').trim();

        text = text
          .replace(/[\n\r]*输入\d+[\s\S]*?缓存读\d+[,，]\d+[\s\S]*$/,'')
          .replace(/\n*<<<[A-Z_]+[\s\S]*$/,'')
          .trim();

        if(typeof _stripLeakedThinking === 'function'){
          text = _stripLeakedThinking(text);
        }

        return text.trim();
      }finally{
        this._abortController = null;
      }
    },

    // _fetchChatCompletionSafe(body,label)
    // → _fetchChatCompletion 的安全包装。
    // 保证无论成功、失败还是用户中断，都会清理 _abortController。
    _fetchChatCompletionSafe:async function(body,label){
      try{
        return await this._fetchChatCompletion(body,label);
      }finally{
        this._abortController = null;
      }
    },

    // _runRegexForChar(text,scope,charId)
    // → 按指定角色运行正则。
    // 素页同栖会读取角色正则，但不永久改写原文项目正文。
    _runRegexForChar:function(text, scope, charId){
      if(typeof applyRegexRules !== 'function')return text;

      var old = window._cbyd21RegexRuntimeCharId;

      try{
        window._cbyd21RegexRuntimeCharId = charId || null;
        return applyRegexRules(String(text || ''), scope);
      }finally{
        window._cbyd21RegexRuntimeCharId = old;
      }
    },

    // _displayCharName(ch)
    // → 素页同栖 UI 使用角色线上备注名。
    // 如果没有备注，就显示角色原名。
    // 注意：这只影响前端显示，不改变 API 里的角色真实身份。
    _displayCharName:function(ch){
      if(!ch)return '未绑定角色';

      if(typeof getCharOnlineName === 'function'){
        return getCharOnlineName(ch);
      }

      return ch.name || '角色';
    },

    // _fillNewProjectForm()
    // → 刷新新建共读表单。
    // 包括角色选择卡、标题、作者、正文、分段预览。
    _fillNewProjectForm:function(){
      var titleEl = document.getElementById('readingNewTitle');
      var authorEl = document.getElementById('readingNewAuthor');
      var textEl = document.getElementById('readingNewText');
      var ownEl = document.getElementById('readingNewIsOwnWork');
      var previewEl = document.getElementById('readingSplitPreview');

      if(titleEl)titleEl.value = '';
      if(authorEl)authorEl.value = '';
      if(textEl)textEl.value = '';
      if(ownEl)ownEl.checked = false;
      if(previewEl){
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
      }

      this._syncSelectedCharCard();
    },

    // _syncSelectedCharCard()
    // → 根据 _draftCharId 刷新“共读角色”选择卡。
    _syncSelectedCharCard:function(){
      var av = document.getElementById('readingSelectedCharAvatar');
      var name = document.getElementById('readingSelectedCharName');
      var hint = document.getElementById('readingSelectedCharHint');

      if(!av || !name || !hint)return;

      var ch = this._draftCharId ? getCharById(this._draftCharId) : null;

      if(!ch){
        av.innerHTML = '角';
        name.textContent = '请选择角色';
        hint.textContent = '批注和心声会严格从这个角色出发';
        return;
      }

      if(ch.avatar){
        av.innerHTML = '<img src="' + ch.avatar + '">';
      }else{
        av.textContent = (ch.name || '角').charAt(0);
      }

      name.textContent = this._displayCharName(ch);
      hint.textContent = ch._onlineRemark ? ('原名：' + ch.name) : '已选择共读角色';
    },

    // openCharPicker()
    // → 打开素页同栖新建项目的角色选择弹窗。
    // 只列出普通角色，不包含三天没睡写卡助手。
    openCharPicker:function(){
      var container = document.getElementById('addCharList');

      container.innerHTML = '';

      var list = (characters || []).filter(function(ch){
        return ch && ch.id !== DEFAULT_CHAR_ID;
      });

      if(list.length === 0){
        container.innerHTML = '<div style="padding:30px 18px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.8">还没有角色<br>请先去「消息 → 通讯录」创建角色</div>';
      }else{
        var self = this;

        list.forEach(function(ch){
          var div = document.createElement('div');
          div.className = 'add-char-item';
          div.style.padding = '12px 16px';

          var avHtml = ch.avatar
            ? '<img src="' + ch.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
            : escHtml((ch.name || '角').charAt(0));

          var displayName = self._displayCharName(ch);
          var sub = ch._onlineRemark ? ('原名：' + ch.name) : '点击选择';

          div.innerHTML =
            '<div style="width:38px;height:38px;border-radius:50%;background:var(--bg-tertiary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;color:var(--accent)">' + avHtml + '</div>' +
            '<div style="flex:1;min-width:0;margin-left:12px">' +
              '<div style="font-size:14px;color:var(--text-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(displayName) + '</div>' +
              '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(sub) + '</div>' +
            '</div>';

          div.onclick = function(){
            self._draftCharId = ch.id;

            var settings = self.loadSettings();
            settings.lastCharId = ch.id;
            self.saveSettingsData(settings);

            self._syncSelectedCharCard();
            closeModal('addCharModal');
          };

          container.appendChild(div);
        });
      }

      document.getElementById('addCharModal').querySelector('h3').textContent = '选择共读角色';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    // _buildBasePrompt(project,paragraph,taskName)
    // → 构建素页同栖 API 的基础上下文。
    // 不写入记忆，不联动聊天分支，只读取当前项目和角色资料。
    _buildBasePrompt:function(project, paragraph, taskName){
      var ch = project && project.charId ? getCharById(project.charId) : null;
      var up = typeof getCurrentProfile === 'function' ? getCurrentProfile() : {name:'用户',persona:''};

      if(!ch){
        throw new Error('找不到共读角色');
      }

      var extraTexts = [
        project.title || '',
        project.author || '',
        paragraph && paragraph.text || ''
      ];

      (paragraph && paragraph.annotations || []).forEach(function(a){
        if(!a)return;
        if(a.visibleNote)extraTexts.push(a.visibleNote);
        if(a.innerThought)extraTexts.push(a.innerThought);
      });

      (paragraph && paragraph.discussions || []).forEach(function(d){
        if(!d)return;
        if(d.userQuestion)extraTexts.push(d.userQuestion);
        if(d.charReply)extraTexts.push(d.charReply);
      });

      var wb = typeof collectActiveWorldBook === 'function'
        ? collectActiveWorldBook({messages:[]}, ch.id, extraTexts)
        : {system_start:[],user_start:[],before_char:[],after_char:[],system_end:[],depth:[]};

      var sp = [];

      if(wb.system_start && wb.system_start.length > 0){
        sp.push('[最高优先级强制指令 — 最前]\n' + wb.system_start.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      if(wb.before_char && wb.before_char.length > 0){
        sp.push('[World Book — 世界背景]\n' + wb.before_char.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      if(ch.prompt && ch.prompt.trim() && !(typeof _isMissingCharPrompt === 'function' && _isMissingCharPrompt(ch.prompt))){
        sp.push('[角色设定]\n' + _replaceCardVars(ch.prompt.trim(), ch.name, up.name || '用户'));
      }else{
        sp.push('[角色设定]\n当前共读角色是「' + (ch.name || '角色') + '」。该角色完整人设缺失或需要从备份恢复。即使缺少详细人设，也不能把用户面具当成角色人设。');
      }

      if(wb.after_char && wb.after_char.length > 0){
        sp.push('[World Book]\n' + wb.after_char.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      var userBlock =
        '[和角色共读的用户]\n' +
        '用户的名字是「' + (up.name || '用户') + '」。用户是正在和角色一起阅读的人，不是角色本人。\n';

      if(up.persona && up.persona.trim()){
        userBlock += up.persona.trim();
      }

      sp.push(userBlock);

      sp.push(
        '[素页同栖任务说明]\n' +
        '当前任务：' + (taskName || '共读文本') + '。\n' +
        '你必须保持当前角色的人格、知识结构、表达方式、情绪反应、审美偏好和对用户的态度。\n' +
        '你不是统一模板的文学评论 AI，也不是语文老师。你是在以当前角色身份和用户共同阅读。\n' +
        '用户上传或粘贴的文本只作为阅读对象，不自动成为聊天记忆，不自动改变角色和用户关系。\n\n' +
        '[用户尊重与角色卡底线]\n' +
        '素页同栖中的批注、心声、讨论和写作都必须从角色卡出发，同时保持对用户的尊重和珍重。\n' +
        '尊重用户不只是避免脏话、攻击词或明显辱骂。用词和态度是两个独立维度，都必须合格。\n' +
        '角色可以保持自己的性格、毒舌程度、冷淡程度、强势程度、挑剔审美和表达习惯，但这些外层风格不能把用户放在一个被轻视、被嫌弃、被羞辱、被敷衍、被看不起、被随意对待的位置上。\n' +
        '判断一句话是否合格时，把角色性格标签暂时拿掉，只看这句话的裸内容在向用户传达什么态度：它是在把用户当作值得被认真对待的人，还是在把用户当作可以随便评判、随便打击、随便轻慢的人。\n' +
        '如果裸内容会让用户感到自己的创作、感受、时间、表达、期待或投入被看轻，那么这句话需要调整。调整的是态度和隐含定位，不是把角色性格改成统一温柔模板。\n' +
        '用户上传自己的作品时，角色可以真实指出文本优点、问题、结构缺陷、节奏问题、表达问题和改进方向；也可以按照角色卡表达审美差异和阅读反应。但评价对象是文本，不是羞辱用户本人。\n' +
        '角色批评文本时仍要让用户感到：自己的创作劳动被看见、被认真读过、被当回事。不能让用户觉得被看不起、被嘲弄、被敷衍，或者像是把作品递给了一个随便打分的人。\n' +
        '除非角色卡的核心玩法本身明确以伤害用户情感体验为目的，否则默认所有批注、心声、讨论和写作都遵守这条底线。判断不确定时，优先保持对用户的尊重和珍重。'
      );

      var breaker = String(localStorage.getItem(this.keys.breaker) || '').trim();

      if(breaker){
        sp.push('[素页同栖专用破限词 — 末尾强制]\n' + breaker);
      }

      if(wb.system_end && wb.system_end.length > 0){
        sp.push('[强制指令]\n' + wb.system_end.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      return {
        char:ch,
        user:up,
        worldBook:wb,
        system:sp.join('\n\n---\n\n')
      };
    },

    // _buildApiMessagesWithWorldBookDepth(base, msgs)
    // → 构建素页同栖 API messages。
    // 完整支持世界书：
    // · user_start 放进前端上下文包最前部；
    // · depth 插入到底部附近；
    // · system 只保留短协议，避免部分渠道忽略长 system。
    _buildApiMessagesWithWorldBookDepth:function(base, msgs){
      base = base || {};
      msgs = (msgs || []).map(function(m){
        return {
          role:m.role,
          content:m.content
        };
      });

      var wb = base.worldBook || {};
      var blocks = [];

      blocks.push(
        '[前端上下文包说明]\n' +
        '以下内容由素页同栖前端生成，包括角色卡、用户面具、世界书、阅读项目、任务规则、专用破限词和输出格式。\n' +
        '这些内容是本轮任务的内部上下文，不是用户在阅读页里的真实发言。\n' +
        '回复时直接进入当前共读、批注、心声、讨论或写作任务本身，把这些内容作为背景依据自然生效。'
      );

      if(wb.user_start && wb.user_start.length > 0){
        blocks.push(
          '[兼容最前规则]\n' +
          wb.user_start.map(function(w){
            return '[' + w.name + ']\n' + w.content;
          }).join('\n\n')
        );
      }

      blocks.push(String(base.system || ''));

      var pack =
        '[素页同栖前端上下文包]\n' +
        '这是一段前端打包给模型的内部上下文，不是用户的真实阅读页发言。\n' +
        '请根据下方上下文直接完成当前素页同栖任务，让角色卡、用户面具、世界书、阅读项目和输出规则自然生效。\n\n' +
        blocks.join('\n\n---\n\n') +
        '\n\n[素页同栖前端上下文包结束]';

      if(msgs.length > 0 && msgs[0] && msgs[0].role === 'user'){
        msgs[0].content = pack + '\n\n[本轮用户任务开始]\n' + msgs[0].content;
      }else{
        msgs.unshift({
          role:'user',
          content:pack + '\n\n[本轮用户任务开始]\n请根据前端上下文包执行当前素页同栖任务。'
        });
      }

      if(wb.depth && wb.depth.length > 0){
        wb.depth.forEach(function(w){
          var depthPos = w.depth || 4;
          var insertIdx = Math.max(0, msgs.length - depthPos);

          msgs.splice(insertIdx, 0, {
            role:'user',
            content:'[前端深度注入 — 这不是用户发言]\n[World Book — ' + w.name + ']\n' + w.content
          });
        });
      }

      return [{
        role:'system',
        content:'[前端协议]\n第一条 user message 的开头包含素页同栖前端上下文包，里面有角色卡、用户信息、世界书、阅读项目和输出规则。它是内部上下文，不是用户真实发言。请根据该上下文包直接执行当前任务，让上下文自然生效。'
      }].concat(msgs);
    },

    // _annotationModePrompt(project)
    // → 根据品墨知音 / 阅趣同行返回共读模式提示。
    _annotationModePrompt:function(project){
      if(project && project.mode === 'yuequ'){
        return (
          '[阅趣同行]\n' +
          '当前是轻松追读模式。公开批注像角色和用户一起追读时写在书边的留言。\n' +
          '关注剧情推进、人物关系、爽点、伏笔、情绪张力、名场面、代入感和阅读体验。\n' +
          '如果文本偏严肃或文学性强，也用轻松共读方式回应，关注画面、人物张力、情绪触点和可读性。保持尊重文本，不低质胡闹。\n'
        );
      }

      return (
        '[品墨知音]\n' +
        '当前是认真共读模式。公开批注像角色认真写在书页边缘的批注。\n' +
        '关注语言、结构、人物、主题、隐喻、叙事视角、情绪暗流、文本张力和思想意味。\n' +
        '如果文本偏通俗或网络叙事，也按当前模式认真阅读，关注它的叙事机制、情绪推进、人物关系、欲望结构和读者体验。\n'
      );
    },

    // _splitTextToParagraphs(text)
    // → 将用户导入文本拆成段落。
    // 规则：
    // · 优先按空行分段；
    // · 没有空行时按长度切段；
    // · 轻量清理 Markdown 文件开头 frontmatter；
    // · 只生成段落副本，不修改原始输入框文本。
    _splitTextToParagraphs:function(text){
      var s = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u200b/g, '')
        .trim();

      // Markdown frontmatter 只在文件开头清理。
      // 不影响正文中普通的 --- 分隔线。
      s = s.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();

      if(!s)return [];

      var parts = s.split(/\n\s*\n+/).map(function(p){
        return p.trim();
      }).filter(function(p){
        return p.length > 0;
      });

      if(parts.length <= 1){
        parts = s.split(/\n+/).map(function(p){
          return p.trim();
        }).filter(function(p){
          return p.length > 0;
        });
      }

      var out = [];
      var maxLen = 1000;

      parts.forEach(function(p){
        if(p.length <= maxLen){
          out.push(p);
          return;
        }

        var rest = p;

        while(rest.length > maxLen){
          var cut = rest.slice(0, maxLen);
          var lastPunc = Math.max(
            cut.lastIndexOf('。'),
            cut.lastIndexOf('！'),
            cut.lastIndexOf('？'),
            cut.lastIndexOf('.'),
            cut.lastIndexOf('!'),
            cut.lastIndexOf('?'),
            cut.lastIndexOf('\n')
          );

          if(lastPunc < 300)lastPunc = maxLen;

          out.push(rest.slice(0, lastPunc + 1).trim());
          rest = rest.slice(lastPunc + 1).trim();
        }

        if(rest)out.push(rest);
      });

      return out.filter(function(p){
        return p.length > 0;
      });
    },

    // _extractFirstJsonObject(text)
    // → 从模型返回里提取第一个完整 JSON 对象。
    _extractFirstJsonObject:function(text){
      var s = String(text || '').trim();
      var start = s.indexOf('{');

      if(start < 0)return null;

      var src = s.slice(start);
      var depth = 0;
      var inStr = false;
      var esc = false;
      var end = -1;

      for(var i = 0; i < src.length; i++){
        var ch = src[i];

        if(inStr){
          if(esc)esc = false;
          else if(ch === '\\')esc = true;
          else if(ch === '"')inStr = false;
          continue;
        }

        if(ch === '"'){
          inStr = true;
          continue;
        }

        if(ch === '{')depth++;
        else if(ch === '}'){
          depth--;
          if(depth === 0){
            end = i + 1;
            break;
          }
        }
      }

      if(end < 0)return null;

      try{
        return JSON.parse(src.slice(0,end));
      }catch(e){
        return null;
      }
    },

    // _parseAnnotationReply(reply)
    // → 解析批注 API 返回。
    // 期望字段 visibleNote / innerThought；兼容 note/comment/thought 等字段。
    _parseAnnotationReply:function(reply){
      var raw = String(reply || '').trim();
      var obj = this._extractFirstJsonObject(raw);

      var visibleNote = '';
      var innerThought = '';

      if(obj && typeof obj === 'object'){
        visibleNote = String(
          obj.visibleNote ||
          obj.publicNote ||
          obj.note ||
          obj.annotation ||
          obj.comment ||
          ''
        ).trim();

        innerThought = String(
          obj.innerThought ||
          obj.privateThought ||
          obj.innerVoice ||
          obj.thought ||
          obj.mind ||
          ''
        ).trim();
      }

      if(!visibleNote && raw){
        visibleNote = raw
          .replace(/^```(?:json|js|javascript)?\s*/i,'')
          .replace(/```$/,'')
          .trim();
      }

      if(typeof _stripLeakedThinking === 'function'){
        visibleNote = _stripLeakedThinking(visibleNote);
        innerThought = _stripLeakedThinking(innerThought);
      }

      return {
        visibleNote:visibleNote || '（这段批注没有按预期生成。）',
        innerThought:innerThought || ''
      };
    },

    // _parseDiscussionReply(reply)
    // → 解析问TA API 返回。
    // 期望 answer 字段；普通文本直接作为回答。
    _parseDiscussionReply:function(reply){
      var raw = String(reply || '').trim();
      var obj = this._extractFirstJsonObject(raw);
      var answer = '';

      if(obj && typeof obj === 'object'){
        answer = String(obj.answer || obj.reply || obj.content || obj.text || '').trim();
      }

      if(!answer){
        answer = raw;
      }

      if(typeof _stripLeakedThinking === 'function'){
        answer = _stripLeakedThinking(answer);
      }

      return answer.trim() || '（没有生成可用回答。）';
    },

    // previewSplit()
    // → 预览当前文本会被拆成多少段。
    // 不保存，不调用 API。
    previewSplit:function(){
      var textEl = document.getElementById('readingNewText');
      var previewEl = document.getElementById('readingSplitPreview');

      if(!textEl || !previewEl)return;

      var parts = this._splitTextToParagraphs(textEl.value);

      if(parts.length === 0){
        showToast('请先输入或导入文本');
        return;
      }

      previewEl.style.display = 'block';
      previewEl.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px">分段预览</div>' +
        '<div style="font-size:12px;color:var(--text-muted);line-height:1.7">共 ' + parts.length + ' 段。前 3 段预览：</div>' +
        parts.slice(0,3).map(function(p, i){
          return '<div style="margin-top:8px;padding:8px 10px;background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:8px;font-size:12px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">' +
            '<strong style="color:var(--accent)">#' + (i + 1) + '</strong> ' +
            escHtml(p.slice(0, 180) + (p.length > 180 ? '…' : '')) +
          '</div>';
        }).join('');
    },

    // handleTextFile(event)
    // → 导入 TXT / MD 文本文件。
    // 文件只读入输入框，不自动保存项目，不调用 API。
    handleTextFile:function(event){
      var input = event && event.target;
      var file = input && input.files && input.files[0];

      if(!file)return;

      var reader = new FileReader();
      var self = this;

      reader.onload = function(e){
        var text = String(e.target.result || '');
        var textEl = document.getElementById('readingNewText');

        if(textEl){
          textEl.value = text;
          if(typeof autoResizeModal === 'function'){
            autoResizeModal(textEl);
          }
        }

        var titleEl = document.getElementById('readingNewTitle');

        if(titleEl && !titleEl.value.trim()){
          titleEl.value = String(file.name || '').replace(/\.(txt|text|md)$/i, '');
        }

        self.previewSplit();
      };

      reader.onerror = function(){
        showToast('文件读取失败');
      };

      reader.readAsText(file);
      input.value = '';
    },

    // createProjectFromForm()
    // → 从新建共读表单创建本地阅读项目。
    // 只写 localStorage，不调用 API。
    createProjectFromForm:function(){
      var ch = this._draftCharId ? getCharById(this._draftCharId) : null;

      if(!ch){
        showToast('请先选择共读角色');
        return;
      }

      var title = (document.getElementById('readingNewTitle') || {}).value || '';
      var author = (document.getElementById('readingNewAuthor') || {}).value || '';
      var text = (document.getElementById('readingNewText') || {}).value || '';
      var ownWork = !!((document.getElementById('readingNewIsOwnWork') || {}).checked);

      title = String(title || '').trim();
      author = String(author || '').trim();
      text = String(text || '').trim();

      if(!text){
        showToast('请先输入或导入文本');
        return;
      }

      var paragraphs = this._splitTextToParagraphs(text);

      if(paragraphs.length === 0){
        showToast('没有可保存的段落');
        return;
      }

      if(!title){
        title = paragraphs[0].slice(0, 18) || '未命名共读';
      }

      var now = Date.now();

      var project = {
        id:'read_' + now + '_' + Math.random().toString(36).slice(2,6),
        mode:this._currentMode === 'yuequ' ? 'yuequ' : 'pinmo',
        charId:ch.id,
        charNameSnapshot:ch.name || '',
        title:title,
        author:author,
        sourceType:'paste',
        isOwnWork:ownWork,
        createdAt:now,
        updatedAt:now,
        chapters:[
          {
            id:'chap_' + now,
            title:'正文',
            paragraphs:paragraphs.map(function(p, i){
              return {
                id:'p_' + now + '_' + i,
                text:p,
                annotations:[],
                discussions:[]
              };
            })
          }
        ]
      };

      var projects = this.loadProjects();
      projects.unshift(project);
      this.saveProjects(projects);

      var settings = this.loadSettings();
      settings.lastCharId = ch.id;
      this.saveSettingsData(settings);

      this._currentProjectId = project.id;
      this._currentParagraphId = null;

      // 保存成功后，新建表单不再作为返回目标。
      // 返回阅读页时应该回到对应书架，而不是回到刚才的表单。
      this._pageStack = ['home','shelf'];
      this.renderShelf();

      showToast('共读项目已保存');
      this.refresh();
      this.openReader(project.id);
    },

    // _fillStylePresetSelect(selectId,target)
    // → 填充文风预设下拉框。
    _fillStylePresetSelect:function(selectId, target){
      var sel = document.getElementById(selectId);

      if(!sel)return;

      var presets = this.loadStylePresets();

      sel.innerHTML = '<option value="">— 不使用预设 —</option>';

      presets.filter(function(p){
        return !target || p.target === 'all' || p.target === target;
      }).forEach(function(p){
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || '未命名预设';
        sel.appendChild(opt);
      });
    },

    // _getStylePrompt(presetId)
    // → 根据预设 ID 读取文风提示。
    _getStylePrompt:function(presetId){
      if(!presetId)return '';

      var presets = this.loadStylePresets();
      var p = presets.find(function(x){
        return x && x.id === presetId;
      });

      return p && p.prompt ? String(p.prompt).trim() : '';
    },

    // openWriteForm(type)
    // → 打开执笔成篇生成表单。
    // type=free 自由生成；type=userCharStory 用户×角色故事。
    openWriteForm:function(type){
      this._suspendWriteDraft = true;

      this._writeType = type === 'userCharStory' ? 'userCharStory' : 'free';

      var settings = this.loadSettings();

      this._writeCharId = this._writeType === 'userCharStory'
        ? (settings.lastCharId || null)
        : null;

      var title = document.getElementById('readingWriteFormTitle');
      var charWrap = document.getElementById('readingWriteCharWrap');
      var tagsWrap = document.getElementById('readingWriteTagsWrap');
      var promptLabel = document.getElementById('readingWritePromptLabel');

      if(title)title.textContent = this._writeType === 'userCharStory' ? '用户 × 角色故事' : '自由生成';
      if(charWrap)charWrap.style.display = this._writeType === 'userCharStory' ? 'block' : 'none';
      if(tagsWrap)tagsWrap.style.display = this._writeType === 'userCharStory' ? 'block' : 'none';
      if(promptLabel)promptLabel.textContent = this._writeType === 'userCharStory' ? '故事背景 / 需求' : '主题 / 需求';

      ['readingWriteTitle','readingWritePrompt','readingWriteTags','readingWriteGenre','readingWritePov','readingWriteLength','readingWriteExtra'].forEach(function(id){
        var el = document.getElementById(id);
        if(el)el.value = '';
      });

      var personaEl = document.getElementById('readingWriteUsePersona');
      if(personaEl)personaEl.checked = true;

      this._fillStylePresetSelect('readingWriteStylePreset','writing');

      var draft = this._loadWriteDraft(this._writeType);

      if(draft){
        var map = {
          readingWriteTitle:'title',
          readingWritePrompt:'prompt',
          readingWriteTags:'tags',
          readingWriteGenre:'genre',
          readingWritePov:'pov',
          readingWriteLength:'length',
          readingWriteExtra:'extra',
          readingWriteStylePreset:'stylePresetId'
        };

        Object.keys(map).forEach(function(id){
          var el = document.getElementById(id);
          if(el && draft[map[id]] !== undefined && draft[map[id]] !== null){
            el.value = draft[map[id]];
          }
        });

        if(personaEl){
          personaEl.checked = draft.usePersona !== false;
        }

        if(this._writeType === 'userCharStory' && draft.charId){
          this._writeCharId = draft.charId;
        }
      }

      this._syncWriteCharCard();
      this.showPage('writeForm', false);

      var self = this;

      setTimeout(function(){
        self._suspendWriteDraft = false;
      },0);
    },

    // _syncWriteCharCard()
    // → 刷新用户×角色故事的角色选择卡。
    _syncWriteCharCard:function(){
      var av = document.getElementById('readingWriteCharAvatar');
      var name = document.getElementById('readingWriteCharName');
      var hint = document.getElementById('readingWriteCharHint');

      if(!av || !name || !hint)return;

      var ch = this._writeCharId ? getCharById(this._writeCharId) : null;

      if(!ch){
        av.innerHTML = '角';
        name.textContent = '请选择角色';
        hint.textContent = '用于生成用户 × 角色故事';
        return;
      }

      if(ch.avatar){
        av.innerHTML = '<img src="' + ch.avatar + '">';
      }else{
        av.textContent = (ch.name || '角').charAt(0);
      }

      name.textContent = this._displayCharName(ch);
      hint.textContent = ch._onlineRemark ? ('原名：' + ch.name) : '已选择故事角色';
    },

    // openWriteCharPicker()
    // → 打开用户×角色故事的角色选择弹窗。
    openWriteCharPicker:function(){
      var container = document.getElementById('addCharList');
      var self = this;

      container.innerHTML = '';

      var list = (characters || []).filter(function(ch){
        return ch && ch.id !== DEFAULT_CHAR_ID;
      });

      if(list.length === 0){
        container.innerHTML = '<div style="padding:30px 18px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.8">还没有角色<br>请先去「消息 → 通讯录」创建角色</div>';
      }else{
        list.forEach(function(ch){
          var div = document.createElement('div');
          div.className = 'add-char-item';
          div.style.padding = '12px 16px';

          var avHtml = ch.avatar
            ? '<img src="' + ch.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
            : escHtml((ch.name || '角').charAt(0));

          div.innerHTML =
            '<div style="width:38px;height:38px;border-radius:50%;background:var(--bg-tertiary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;color:var(--accent)">' + avHtml + '</div>' +
            '<div style="flex:1;min-width:0;margin-left:12px">' +
              '<div style="font-size:14px;color:var(--text-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(self._displayCharName(ch)) + '</div>' +
              '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escHtml(ch._onlineRemark ? ('原名：' + ch.name) : '点击选择') + '</div>' +
            '</div>';

          div.onclick = function(){
            self._writeCharId = ch.id;

            var settings = self.loadSettings();
            settings.lastCharId = ch.id;
            self.saveSettingsData(settings);

            self._syncWriteCharCard();

            if(self._writeType === 'userCharStory'){
              self.saveWriteDraft();
            }

            closeModal('addCharModal');
          };

          container.appendChild(div);
        });
      }

      document.getElementById('addCharModal').querySelector('h3').textContent = '选择故事角色';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    // _writeDraftKey(type)
    // → 执笔成篇表单草稿 key。
    _writeDraftKey:function(type){
      return 'stm_readingWriteDraft_' + (type === 'userCharStory' ? 'userCharStory' : 'free');
    },

    // saveWriteDraft()
    // → 保存当前执笔成篇表单草稿。
    // 不调用 API，只写 localStorage。
    saveWriteDraft:function(){
      if(this._suspendWriteDraft)return;

      try{
        var data = this._buildWritingPromptData ? this._buildWritingPromptData() : null;

        if(!data)return;

        localStorage.setItem(this._writeDraftKey(data.type), JSON.stringify(data));
      }catch(e){}
    },

    // _loadWriteDraft(type)
    // → 读取指定类型的执笔成篇草稿。
    _loadWriteDraft:function(type){
      try{
        return JSON.parse(localStorage.getItem(this._writeDraftKey(type)) || 'null') || null;
      }catch(e){
        return null;
      }
    },

    // _clearWriteDraft(type)
    // → 清除指定类型的执笔成篇草稿。
    _clearWriteDraft:function(type){
      localStorage.removeItem(this._writeDraftKey(type));
    },

    // _buildWritingPromptData()
    // → 从执笔成篇表单读取生成参数。
    _buildWritingPromptData:function(){
      return {
        type:this._writeType,
        charId:this._writeType === 'userCharStory' ? this._writeCharId : null,
        title:String((document.getElementById('readingWriteTitle') || {}).value || '').trim(),
        prompt:String((document.getElementById('readingWritePrompt') || {}).value || '').trim(),
        tags:String((document.getElementById('readingWriteTags') || {}).value || '').trim(),
        genre:String((document.getElementById('readingWriteGenre') || {}).value || '').trim(),
        pov:String((document.getElementById('readingWritePov') || {}).value || '').trim(),
        length:String((document.getElementById('readingWriteLength') || {}).value || '').trim(),
        extra:String((document.getElementById('readingWriteExtra') || {}).value || '').trim(),
        stylePresetId:String((document.getElementById('readingWriteStylePreset') || {}).value || '').trim(),
        usePersona:!!((document.getElementById('readingWriteUsePersona') || {}).checked)
      };
    },

    // _buildWritingRequest(data, continueFrom)
    // → 构建执笔成篇 API 请求。
    // 长文生成直接返回纯文本，不强制 JSON。
    _buildWritingRequest:function(data, continueFrom){
      data = data || {};

      var ch = data.charId ? getCharById(data.charId) : null;
      var up = typeof getCurrentProfile === 'function' ? getCurrentProfile() : {name:'用户',persona:''};
      var extraTexts = [
        data.prompt || '',
        data.tags || '',
        data.genre || '',
        data.pov || '',
        data.extra || '',
        continueFrom || ''
      ];

      var wb = typeof collectActiveWorldBook === 'function'
        ? collectActiveWorldBook({messages:[]}, ch ? ch.id : false, extraTexts)
        : {system_start:[],user_start:[],before_char:[],after_char:[],system_end:[],depth:[]};

      var blocks = [];

      if(wb.system_start && wb.system_start.length > 0){
        blocks.push('[最高优先级强制指令 — 最前]\n' + wb.system_start.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      if(wb.before_char && wb.before_char.length > 0){
        blocks.push('[World Book — 世界背景]\n' + wb.before_char.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      if(ch){
        if(ch.prompt && ch.prompt.trim() && !(typeof _isMissingCharPrompt === 'function' && _isMissingCharPrompt(ch.prompt))){
          blocks.push('[角色设定]\n' + _replaceCardVars(ch.prompt.trim(), ch.name, up.name || '用户'));
        }else{
          blocks.push('[角色设定]\n当前故事角色是「' + (ch.name || '角色') + '」。该角色完整人设缺失或需要从备份恢复。');
        }
      }

      if(wb.after_char && wb.after_char.length > 0){
        blocks.push('[World Book]\n' + wb.after_char.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      if(data.usePersona){
        var userBlock = '[用户面具]\n用户名字是「' + (up.name || '用户') + '」。';

        if(up.persona && up.persona.trim()){
          userBlock += '\n' + up.persona.trim();
        }

        blocks.push(userBlock);
      }

      var stylePrompt = this._getStylePrompt(data.stylePresetId);

      blocks.push(
        '[素页同栖 · 执笔成篇任务说明]\n' +
        '当前请求来自素页同栖的长文生成入口。它是独立写作功能，不是普通线上聊天，不是线下见面，不是通话，也不是记忆总结。\n' +
        '生成结果只保存为素页同栖的本地写作记录，不自动写入角色记忆，不自动改变角色和用户关系，不自动联动聊天分支。\n\n' +
        '[用户尊重与创作需求底线]\n' +
        '用户提出的主题、tag、故事背景、文风要求和额外限制，都是用户的创作意图。你需要认真对待这些意图，而不是随意改写成自己方便生成的模板。\n' +
        '如果生成用户 × 角色故事，用户面具只属于用户，角色卡只属于角色。不能把用户面具当成角色人设，也不能把角色卡当成用户信息。\n' +
        '正文可以有张力、冲突、克制、遗憾、误会、冷淡、毒舌或复杂情绪，但底层态度仍要让用户感到自己在这个创作体验里是被认真对待的。\n' +
        '不通过羞辱用户、轻视用户、敷衍用户需求、否定用户创意价值来制造所谓真实感。'
      );

      if(stylePrompt){
        blocks.push('[素页同栖文风预设]\n' + stylePrompt);
      }

      var breaker = String(localStorage.getItem(this.keys.breaker) || '').trim();

      if(breaker){
        blocks.push('[素页同栖专用破限词 — 末尾强制]\n' + breaker);
      }

      if(wb.system_end && wb.system_end.length > 0){
        blocks.push('[强制指令]\n' + wb.system_end.map(function(w){
          return '[' + w.name + ']\n' + w.content;
        }).join('\n\n'));
      }

      var modeLine = data.type === 'userCharStory'
        ? '当前任务是生成用户 × 当前角色的故事。故事必须围绕用户与角色展开，用户面具只属于用户，角色卡只属于角色。'
        : '当前任务是自由长文生成。可以参考用户面具，但不必强行写成用户 × 角色故事。';

      var userContent =
        '[执笔成篇任务]\n' +
        modeLine + '\n\n' +
        '[主题 / 需求]\n' + (data.prompt || '未填写') +
        (data.tags ? '\n\n[故事 tag]\n' + data.tags : '') +
        (data.genre ? '\n\n[类型 / 体裁]\n' + data.genre : '') +
        (data.pov ? '\n\n[视角]\n' + data.pov : '') +
        (data.length ? '\n\n[长度要求]\n' + data.length : '') +
        (data.extra ? '\n\n[额外限制]\n' + data.extra : '');

      if(continueFrom){
        userContent +=
          '\n\n[已有正文]\n' + continueFrom +
          '\n\n[继续扩写]\n请在已有正文基础上继续写，不要重写开头。';
      }

      userContent +=
        '\n\n[输出要求]\n' +
        '直接输出正文。保持段落清晰，保留自然换行。正文从第一段内容开始。';

      var base = {
        system:blocks.join('\n\n---\n\n'),
        worldBook:wb
      };

      return this._buildApiMessagesWithWorldBookDepth(base, [
        {role:'user',content:userContent}
      ]);
    },

    // generateWriting()
    // → 执行执笔成篇生成。
    // 一次点击只调用一次 API；结果保存到 stm_readingWrites。
    generateWriting:async function(){
      if(this._generating){
        showToast('素页同栖正在生成中，请稍等');
        return;
      }

      var data = this._buildWritingPromptData();

      if(!data.prompt){
        showToast('请先填写主题 / 需求');
        return;
      }

      if(data.type === 'userCharStory' && !data.charId){
        showToast('请先选择故事角色');
        return;
      }

      this._setGenerating(true);

      try{
        var messages = this._buildWritingRequest(data, '');

        this.showPage('writeResult', false);

        var resultBox = document.getElementById('readingWriteResultContent');
        var titleEl = document.getElementById('readingWriteResultTitle');
        var subEl = document.getElementById('readingWriteResultSub');

        if(titleEl)titleEl.textContent = '生成中';
        if(subEl)subEl.textContent = data.type === 'userCharStory' ? '用户 × 角色故事' : '自由生成';
        if(resultBox)resultBox.textContent = '正在生成正文……';

        var reply = await this._fetchChatCompletionSafe({
          messages:messages
        }, '素页同栖执笔成篇');

        reply = this._runRegexForChar(reply, 'aiOutput', data.charId);

        var now = Date.now();
        var title = data.title || data.prompt.slice(0, 18) || '未命名生成';

        var item = {
          id:'write_' + now + '_' + Math.random().toString(36).slice(2,6),
          type:data.type,
          charId:data.charId || null,
          title:title,
          userPrompt:data.prompt,
          tags:data.tags,
          genre:data.genre,
          pov:data.pov,
          length:data.length,
          extra:data.extra,
          stylePresetId:data.stylePresetId,
          usePersona:data.usePersona,
          result:reply,
          createdAt:now,
          updatedAt:now
        };

        var writes = this.loadWrites();
        writes.unshift(item);
        this.saveWrites(writes);

        this._currentWriteId = item.id;
        this.renderWriteResult(item);
        this.refresh();
        this._clearWriteDraft(data.type);

        showToast('生成完成');
      }catch(e){
        var isAbort = e && e.name === 'AbortError';

        if(!isAbort){
          this._appendWriteError(data, this._errorText(e));
        }

        var errBox = document.getElementById('readingWriteResultContent');

        if(errBox){
          errBox.textContent = isAbort
            ? '生成已中断。'
            : ('生成失败：' + (e && e.message || '未知错误'));
        }

        this.refresh();

        if(e && !(e.name === 'PromptLoadingBlocked' || e._cbyd21PromptLoadingBlocked || e.name === 'AbortError')){
          showApiError(e.message || '');
        }
      }finally{
        this._setGenerating(false);
      }
    },

    // renderWriteHistory()
    // → 渲染执笔成篇历史列表。
    renderWriteHistory:function(){
      var list = document.getElementById('readingWriteHistoryList');
      var empty = document.getElementById('readingWriteHistoryEmpty');

      if(!list || !empty)return;

      var writes = this.loadWrites();

      list.innerHTML = '';

      if(writes.length === 0){
        empty.style.display = 'block';
        return;
      }

      empty.style.display = 'none';

      writes.sort(function(a,b){
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });

      var self = this;

      writes.forEach(function(w){
        var div = document.createElement('div');
        div.className = 'reading-entry-card';

        var ch = w.charId ? getCharById(w.charId) : null;
        var typeLabel = w.type === 'userCharStory' ? '用户×角色故事' : '自由生成';
        var isError = !!(w.error && w.error.detail);
        var sub = (isError ? '生成失败 · ' : '') + typeLabel + (ch ? (' · ' + self._displayCharName(ch)) : '') + ' · ' + formatTime(w.createdAt || Date.now());

        div.innerHTML =
          '<span class="reading-entry-icon"><svg viewBox="0 0 28 28" fill="none" stroke="' + (isError ? 'var(--danger)' : 'currentColor') + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h14v18H7z"/><path d="M10 10h8"/><path d="M10 14h6"/><path d="M10 18h7" opacity="0.45"/></svg></span>' +
          '<span class="reading-entry-main"><strong>' + escHtml(w.title || '未命名生成') + '</strong><em>' + escHtml(sub) + '</em></span>' +
          '<span class="reading-entry-count" style="' + (isError ? 'color:var(--danger)' : '') + '">' + (isError ? '错误' : '查看') + '</span>';

        div.onclick = function(){
          self.openWriteResult(w.id);
        };

        list.appendChild(div);
      });
    },

    // openWriteResult(writeId)
    // → 打开某条执笔成篇生成记录。
    openWriteResult:function(writeId){
      var item = this.loadWrites().find(function(w){
        return w && w.id === writeId;
      });

      if(!item){
        showToast('找不到生成记录');
        return;
      }

      this._currentWriteId = item.id;
      this.renderWriteResult(item);
      this.showPage('writeResult', false);
    },

    // renderWriteResult(item)
    // → 渲染执笔成篇结果页。
    renderWriteResult:function(item){
      var titleEl = document.getElementById('readingWriteResultTitle');
      var subEl = document.getElementById('readingWriteResultSub');
      var contentEl = document.getElementById('readingWriteResultContent');

      if(titleEl)titleEl.textContent = item && item.title ? item.title : '生成结果';
      if(subEl)subEl.textContent = item && item.type === 'userCharStory' ? '用户 × 角色故事' : '自由生成';

      if(contentEl){
        if(item && item.error && item.error.detail){
          contentEl.textContent =
            '生成失败：\n' + item.error.detail +
            (item.userPrompt ? '\n\n原始需求：\n' + item.userPrompt : '');
        }else{
          contentEl.textContent = item && item.result ? item.result : '（空）';
        }
      }
    },

    // copyCurrentWriteResult()
    // → 复制当前执笔成篇结果。
    copyCurrentWriteResult:function(){
      var item = this.loadWrites().find(function(w){
        return w && w.id === cbyd21_Reading._currentWriteId;
      });

      if(!item){
        showToast('找不到生成记录');
        return;
      }

      var copyText = item.result || '';

      if(!copyText && item.error && item.error.detail){
        copyText =
          '生成失败：\n' + item.error.detail +
          (item.userPrompt ? '\n\n原始需求：\n' + item.userPrompt : '');
      }

      if(!copyText){
        showToast('没有可复制的内容');
        return;
      }

      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(copyText).then(function(){
          showToast('已复制');
        }).catch(function(){
          _fallbackCopy(copyText);
        });
      }else{
        _fallbackCopy(copyText);
      }
    },

    // renameCurrentWrite()
    // → 修改当前执笔成篇生成记录标题。
    renameCurrentWrite:function(){
      var writes = this.loadWrites();
      var item = writes.find(function(w){
        return w && w.id === cbyd21_Reading._currentWriteId;
      });

      if(!item){
        showToast('找不到生成记录');
        return;
      }

      var self = this;

      openTextInputModal(
        '修改标题',
        '给这条生成记录起一个标题。',
        '标题',
        function(text){
          text = String(text || '').trim();

          if(!text){
            showToast('标题不能为空');
            return;
          }

          item.title = text;
          item.updatedAt = Date.now();

          self.saveWrites(writes);
          self.renderWriteResult(item);
          self.refresh();
          showToast('标题已更新');
        },
        true
      );

      setTimeout(function(){
        var area = document.getElementById('textInputArea');

        if(area){
          area.value = item.title || '';
          autoResizeModal(area);
        }
      },60);
    },

    // continueCurrentWrite()
    // → 继续扩写当前执笔成篇结果。
    // 这是用户主动操作，会调用一次新的 API。
    continueCurrentWrite:async function(){
      var writes = this.loadWrites();
      var item = writes.find(function(w){
        return w && w.id === cbyd21_Reading._currentWriteId;
      });

      if(!item){
        showToast('找不到生成记录');
        return;
      }

      if(item.error && item.error.detail){
        showToast('这条记录是生成失败记录，不能继续扩写');
        return;
      }

      if(this._generating){
        showToast('素页同栖正在生成中，请稍等');
        return;
      }

      this._setGenerating(true);

      try{
        var data = {
          type:item.type,
          charId:item.charId,
          title:item.title,
          prompt:item.userPrompt,
          tags:item.tags,
          genre:item.genre,
          pov:item.pov,
          length:item.length,
          extra:item.extra,
          stylePresetId:item.stylePresetId,
          usePersona:item.usePersona
        };

        var originalResult = item.result || '';
        var resultBox = document.getElementById('readingWriteResultContent');
        if(resultBox)resultBox.textContent = originalResult + '\n\n……正在继续扩写……';

        var reply = await this._fetchChatCompletionSafe({
          messages:this._buildWritingRequest(data, originalResult)
        }, '素页同栖继续扩写');

        reply = this._runRegexForChar(reply, 'aiOutput', item.charId);

        item.result = (item.result || '') + '\n\n' + reply;
        item.updatedAt = Date.now();
        this.saveWrites(writes);

        this.renderWriteResult(item);
        this.refresh();
        showToast('已继续扩写');
      }catch(e){
        var resultBox = document.getElementById('readingWriteResultContent');

        if(resultBox){
          resultBox.textContent = item.result || '（空）';
        }

        if(e && e.name === 'AbortError'){
          showToast('继续扩写已中断');
        }else if(e && !(e.name === 'PromptLoadingBlocked' || e._cbyd21PromptLoadingBlocked)){
          showApiError(e.message || '');
        }
      }finally{
        this._setGenerating(false);
      }
    },

    // deleteCurrentWrite()
    // → 删除当前执笔成篇结果。
    deleteCurrentWrite:async function(){
      var id = this._currentWriteId;

      if(!id)return;

      var yes = await customConfirm('确认删除这条生成记录？');

      if(!yes)return;

      var writes = this.loadWrites().filter(function(w){
        return w && w.id !== id;
      });

      this.saveWrites(writes);
      this._currentWriteId = null;
      this.refresh();
      this.openWritingHome(true);
      showToast('已删除');
    },

    // saveStylePresets(list)
    // → 保存素页同栖文风预设列表。
    saveStylePresets:function(list){
      localStorage.setItem(this.keys.presets, JSON.stringify(Array.isArray(list) ? list : []));
    },

    // renderStylePresetList()
    // → 渲染素页同栖设置页里的文风预设列表。
    renderStylePresetList:function(){
      var listEl = document.getElementById('readingStylePresetList');
      var emptyEl = document.getElementById('readingStylePresetEmpty');

      if(!listEl || !emptyEl)return;

      var presets = this.loadStylePresets();

      listEl.innerHTML = '';

      if(!presets || presets.length === 0){
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';

      var self = this;

      presets.forEach(function(p){
        if(!p)return;

        var targetLabel = p.target === 'annotation'
          ? '批注 / 问TA'
          : (p.target === 'writing' ? '执笔成篇' : '全部');

        var div = document.createElement('div');
        div.className = 'reading-entry-card';
        div.innerHTML =
          '<span class="reading-entry-icon">' +
            '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h14v18H7z"/><path d="M10 10h8"/><path d="M10 14h6"/><path d="M10 18h7" opacity="0.45"/></svg>' +
          '</span>' +
          '<span class="reading-entry-main">' +
            '<strong>' + escHtml(p.name || '未命名预设') + '</strong>' +
            '<em>' + escHtml(targetLabel + ' · ' + String(p.prompt || '').slice(0, 36)) + '</em>' +
          '</span>' +
          '<span class="reading-entry-count">编辑</span>';

        div.onclick = function(){
          self.openStylePresetEditor(p.id);
        };

        listEl.appendChild(div);
      });
    },

    // openStylePresetEditor(presetId)
    // → 打开文风预设编辑页。
    // presetId=null 表示新建。
    openStylePresetEditor:function(presetId){
      var presets = this.loadStylePresets();
      var p = presetId
        ? presets.find(function(x){ return x && x.id === presetId; })
        : null;

      this._editingStylePresetId = p ? p.id : null;

      var titleEl = document.getElementById('readingStylePresetEditTitle');
      var nameEl = document.getElementById('readingStylePresetName');
      var targetEl = document.getElementById('readingStylePresetTarget');
      var promptEl = document.getElementById('readingStylePresetPrompt');
      var delBtn = document.getElementById('readingStylePresetDeleteBtn');

      if(titleEl)titleEl.textContent = p ? '编辑文风预设' : '新建文风预设';
      if(nameEl)nameEl.value = p ? (p.name || '') : '';
      if(targetEl)targetEl.value = p ? (p.target || 'all') : 'all';
      if(promptEl)promptEl.value = p ? (p.prompt || '') : '';
      if(delBtn)delBtn.style.display = p ? '' : 'none';

      this.showPage('stylePresetEdit', false);
    },

    // saveStylePresetFromEditor()
    // → 保存当前编辑页里的文风预设。
    saveStylePresetFromEditor:function(){
      var name = String((document.getElementById('readingStylePresetName') || {}).value || '').trim();
      var target = String((document.getElementById('readingStylePresetTarget') || {}).value || 'all').trim();
      var prompt = String((document.getElementById('readingStylePresetPrompt') || {}).value || '').trim();

      if(!name){
        showToast('请输入预设名称');
        return;
      }

      if(!prompt){
        showToast('请输入文风提示词');
        return;
      }

      if(['all','annotation','writing'].indexOf(target) < 0){
        target = 'all';
      }

      var presets = this.loadStylePresets();
      var now = Date.now();
      var item = null;

      if(this._editingStylePresetId){
        item = presets.find(function(p){
          return p && p.id === cbyd21_Reading._editingStylePresetId;
        }) || null;
      }

      if(item){
        item.name = name;
        item.target = target;
        item.prompt = prompt;
        item.updatedAt = now;
      }else{
        presets.push({
          id:'reading_style_' + now + '_' + Math.random().toString(36).slice(2,6),
          name:name,
          target:target,
          prompt:prompt,
          createdAt:now,
          updatedAt:now
        });
      }

      this.saveStylePresets(presets);
      this._editingStylePresetId = null;
      this.renderStylePresetList();
      this.showPage('settings', true);
      showToast('文风预设已保存');
    },

    // deleteStylePresetFromEditor()
    // → 删除当前正在编辑的文风预设。
    deleteStylePresetFromEditor:async function(){
      if(!this._editingStylePresetId){
        return;
      }

      var yes = await customConfirm('确认删除这个文风预设？');

      if(!yes)return;

      var id = this._editingStylePresetId;
      var presets = this.loadStylePresets().filter(function(p){
        return p && p.id !== id;
      });

      this.saveStylePresets(presets);
      this._editingStylePresetId = null;
      this.renderStylePresetList();
      this.showPage('settings', true);
      showToast('文风预设已删除');
    },

    // openSettings()
    // → 打开素页同栖设置页。
    // 当前设置页管理素页同栖专用破限词和文风预设。
    openSettings:function(){
      var input = document.getElementById('readingBreakerInput');

      if(input){
        input.value = localStorage.getItem(this.keys.breaker) || '';
      }

      this.renderStylePresetList();
      this.showPage('settings', false);
    },

    // saveSettings()
    // → 保存素页同栖专用破限词。
    // 这个破限词只影响后续素页同栖 API，不影响普通聊天、线下、动态、通话或浮生。
    saveSettings:function(){
      var input = document.getElementById('readingBreakerInput');

      if(input){
        localStorage.setItem(this.keys.breaker, input.value || '');
      }

      showToast('素页同栖设置已保存');
    },

    // refresh()
    // → 刷新首页计数和当前书架列表。
    // 页面恢复、导入数据、重新进入 App 后调用。
    refresh:function(){
      this.ensureData();

      var projects = this.loadProjects();
      var writes = this.loadWrites();

      var pinmoCount = projects.filter(function(p){
        return p && p.mode === 'pinmo';
      }).length;

      var yuequCount = projects.filter(function(p){
        return p && p.mode === 'yuequ';
      }).length;

      var pinmoEl = document.getElementById('readingPinmoCount');
      var yuequEl = document.getElementById('readingYuequCount');
      var writeEl = document.getElementById('readingWriteCount');

      if(pinmoEl)pinmoEl.textContent = pinmoCount + ' 项';
      if(yuequEl)yuequEl.textContent = yuequCount + ' 项';
      if(writeEl)writeEl.textContent = writes.length + ' 篇';

      var currentPage = this._pageStack[this._pageStack.length - 1];

      if(currentPage === 'shelf'){
        this.renderShelf();
      }

      if(currentPage === 'reader' && this._currentProjectId){
        var project = this._findProject(this._currentProjectId);

        if(project){
          this.renderReader(project);
        }else{
          showToast('当前阅读项目已不存在');
          this._currentProjectId = null;
          this._currentParagraphId = null;
          this.openShelf(this._currentMode);
        }
      }

      if(currentPage === 'writing'){
        this.renderWriteHistory();
      }
    },

    // _saveProject(project)
    // → 保存单个阅读项目。
    // 按 id 替换本地 projects 数组里的对应项目，并刷新 updatedAt。
    _saveProject:function(project){
      if(!project || !project.id)return false;

      var projects = this.loadProjects();
      var idx = projects.findIndex(function(p){
        return p && p.id === project.id;
      });

      project.updatedAt = Date.now();

      if(idx >= 0){
        projects[idx] = project;
      }else{
        projects.unshift(project);
      }

      this.saveProjects(projects);
      return true;
    },

    // _findProject(projectId)
    // → 根据项目 ID 查找阅读项目。
    _findProject:function(projectId){
      var projects = this.loadProjects();

      return projects.find(function(p){
        return p && p.id === projectId;
      }) || null;
    },

    // _findParagraph(project, paragraphId)
    // → 在项目中查找指定段落。
    _findParagraph:function(project, paragraphId){
      if(!project || !paragraphId)return null;

      var found = null;

      (project.chapters || []).forEach(function(chap){
        (chap.paragraphs || []).forEach(function(pg){
          if(pg && pg.id === paragraphId){
            found = pg;
          }
        });
      });

      return found;
    },

    // _getCurrentProjectAndParagraph()
    // → 返回当前阅读页选中的项目和段落。
    _getCurrentProjectAndParagraph:function(){
      var project = this._findProject(this._currentProjectId);

      if(!project)return null;

      var paragraph = this._findParagraph(project, this._currentParagraphId);

      if(!paragraph)return null;

      return {
        project:project,
        paragraph:paragraph
      };
    },

    // openProjectMenu(projectId)
    // → 打开阅读项目管理菜单。
    // 支持重命名、编辑正文、删除项目。
    openProjectMenu:function(projectId){
      var project = this._findProject(projectId);

      if(!project){
        showToast('找不到阅读项目');
        return;
      }

      var container = document.getElementById('addCharList');
      var self = this;

      container.innerHTML = '';

      var items = [
        {
          label:'重命名项目',
          desc:'修改标题和作者/来源',
          action:function(){
            closeModal('addCharModal');
            self.renameProject(projectId);
          }
        },
        {
          label:'编辑正文并重新分段',
          desc:'会清空该项目已有批注、心声和讨论记录',
          action:function(){
            closeModal('addCharModal');
            self.editProjectText(projectId);
          }
        },
        {
          label:'查看错误记录',
          desc:'查看批注、问TA等生成失败时保存的错误信息',
          action:function(){
            closeModal('addCharModal');
            self.openProjectErrors(projectId);
          }
        },
        {
          label:'删除项目',
          desc:'删除这个共读项目、批注、心声和讨论记录',
          danger:true,
          action:function(){
            closeModal('addCharModal');
            self.deleteProject(projectId);
          }
        }
      ];

      items.forEach(function(item){
        var div = document.createElement('div');
        div.className = 'add-char-item';
        div.style.padding = '14px 16px';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'flex-start';
        div.style.gap = '4px';

        div.innerHTML =
          '<div style="font-size:14px;font-weight:600;color:' + (item.danger ? 'var(--danger)' : 'var(--text-primary)') + '">' + escHtml(item.label) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);line-height:1.5">' + escHtml(item.desc) + '</div>';

        div.onclick = item.action;
        container.appendChild(div);
      });

      document.getElementById('addCharModal').querySelector('h3').textContent = project.title || '项目管理';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    // renameProject(projectId)
    // → 修改阅读项目标题和作者/来源。
    renameProject:function(projectId){
      var project = this._findProject(projectId);

      if(!project)return;

      var self = this;

      openTextInputModal(
        '重命名项目',
        '第一行写标题；第二行可写作者 / 来源。',
        '标题\n作者或来源',
        function(text){
          var lines = String(text || '').split(/\r?\n/);
          var title = String(lines[0] || '').trim();
          var author = String(lines.slice(1).join('\n') || '').trim();

          if(!title){
            showToast('标题不能为空');
            return;
          }

          project.title = title;
          project.author = author;
          project.updatedAt = Date.now();

          self._saveProject(project);
          self.refresh();

          if(self._currentProjectId === project.id){
            self.renderReader(project);
            self._syncHeader('reader');
          }

          showToast('项目已重命名');
        },
        true
      );

      setTimeout(function(){
        var area = document.getElementById('textInputArea');

        if(area){
          area.dataset.enterNewline = '1';
          area.value = (project.title || '') + (project.author ? ('\n' + project.author) : '');
          autoResizeModal(area);
        }
      },60);
    },

    // editProjectText(projectId)
    // → 编辑项目正文并重新分段。
    // 重新分段后旧段落 ID 会失效，所以会清空旧批注/心声/讨论。
    editProjectText:function(projectId){
      var project = this._findProject(projectId);

      if(!project)return;

      var text = [];

      (project.chapters || []).forEach(function(chap){
        (chap.paragraphs || []).forEach(function(pg){
          if(pg && pg.text)text.push(pg.text);
        });
      });

      var self = this;

      openTextInputModal(
        '编辑共读正文',
        '保存后会重新分段，并清空该项目已有批注、心声和讨论记录。',
        '输入正文……',
        async function(newText){
          newText = String(newText || '').trim();

          if(!newText){
            showToast('正文不能为空');
            return;
          }

          var yes = await customConfirm('确认重新保存正文？\n\n这会清空该项目已有批注、心声和讨论记录。');

          if(!yes)return;

          var parts = self._splitTextToParagraphs(newText);

          if(parts.length === 0){
            showToast('没有可保存的段落');
            return;
          }

          var now = Date.now();

          project.chapters = [
            {
              id:'chap_' + now,
              title:'正文',
              paragraphs:parts.map(function(p, i){
                return {
                  id:'p_' + now + '_' + i,
                  text:p,
                  annotations:[],
                  discussions:[]
                };
              })
            }
          ];

          project.updatedAt = now;

          self._saveProject(project);
          self._currentParagraphId = null;
          self.refresh();

          if(self._currentProjectId === project.id){
            self.renderReader(project);
          }

          showToast('正文已更新');
        }
      );

      setTimeout(function(){
        var area = document.getElementById('textInputArea');

        if(area){
          area.dataset.enterNewline = '1';
          area.value = text.join('\n\n');
          autoResizeModal(area);
        }
      },80);
    },

    // deleteProject(projectId)
    // → 删除一个阅读项目。
    deleteProject:async function(projectId){
      var project = this._findProject(projectId);

      if(!project)return;

      var yes = await customConfirm('确认删除共读项目「' + (project.title || '未命名项目') + '」？\n\n项目内批注、心声和讨论记录也会一起删除。');

      if(!yes)return;

      var projects = this.loadProjects().filter(function(p){
        return p && p.id !== projectId;
      });

      this.saveProjects(projects);

      if(this._currentProjectId === projectId){
        this._currentProjectId = null;
        this._currentParagraphId = null;
        this.openShelf(project.mode || this._currentMode);
      }

      this.refresh();
      showToast('项目已删除');
    },

    // openCurrentProjectErrors()
    // → 从阅读页打开当前项目的错误记录。
    openCurrentProjectErrors:function(){
      if(!this._currentProjectId){
        showToast('当前没有打开阅读项目');
        return;
      }

      this.openProjectErrors(this._currentProjectId);
    },

    // openProjectErrors(projectId)
    // → 查看某个阅读项目的错误记录。
    // 错误记录来自批注、重新生成、问TA等 API 失败。
    openProjectErrors:function(projectId){
      var project = this._findProject(projectId);

      if(!project){
        showToast('找不到阅读项目');
        return;
      }

      var errors = Array.isArray(project.errors) ? project.errors : [];
      var container = document.getElementById('addCharList');

      container.innerHTML = '';

      var head = document.createElement('div');
      head.style.cssText = 'padding:14px 16px;border-bottom:1px solid var(--border-soft);font-size:12px;color:var(--text-muted);line-height:1.6';
      head.innerHTML =
        '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:4px">' + escHtml(project.title || '未命名项目') + '</div>' +
        '<div>共 ' + errors.length + ' 条错误记录。错误记录只保存在本地，用于排查，不会自动重试。</div>';
      container.appendChild(head);

      if(errors.length === 0){
        var empty = document.createElement('div');
        empty.style.cssText = 'padding:30px 18px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.8';
        empty.textContent = '没有错误记录';
        container.appendChild(empty);
      }else{
        errors.forEach(function(err){
          var div = document.createElement('div');
          div.className = 'add-char-item';
          div.style.padding = '14px 16px';
          div.style.flexDirection = 'column';
          div.style.alignItems = 'stretch';
          div.style.gap = '6px';

          var timeText = err.createdAt ? formatTime(err.createdAt) : '';
          var detail = String(err.detail || '');

          div.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div style="flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--danger)">' + escHtml(err.type || 'unknown') + '</div>' +
              '<div style="font-size:10px;color:var(--text-muted);flex-shrink:0">' + escHtml(timeText) + '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:120px;overflow-y:auto">' + escHtml(detail || '（无详情）') + '</div>' +
            '<button class="btn-sm" onclick="cbyd21_Reading.copyText(' + JSON.stringify(detail) + ')" style="width:100%;font-size:11px">复制错误</button>';

          container.appendChild(div);
        });

        var clearBtn = document.createElement('div');
        clearBtn.className = 'add-char-item';
        clearBtn.style.padding = '14px 16px';
        clearBtn.style.color = 'var(--danger)';
        clearBtn.style.fontSize = '14px';
        clearBtn.style.justifyContent = 'center';
        clearBtn.textContent = '清空错误记录';
        clearBtn.onclick = function(){
          cbyd21_Reading.clearProjectErrors(projectId);
        };
        container.appendChild(clearBtn);
      }

      document.getElementById('addCharModal').querySelector('h3').textContent = '错误记录';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    // clearProjectErrors(projectId)
    // → 清空某个阅读项目的错误记录。
    clearProjectErrors:async function(projectId){
      var project = this._findProject(projectId);

      if(!project)return;

      var yes = await customConfirm('确认清空这个项目的错误记录？');

      if(!yes)return;

      project.errors = [];
      this._saveProject(project);
      closeModal('addCharModal');
      this.refresh();
      showToast('错误记录已清空');
    },

    // openReader(projectId,replace)
    // → 打开阅读页。
    // 只渲染本地段落，不调用 API。
    // replace=true 时不新增内部历史层，用于刷新/导入恢复等场景。
    openReader:function(projectId, replace){
      var project = this._findProject(projectId);

      if(!project){
        showToast('找不到阅读项目');
        return;
      }

      this._currentProjectId = project.id;
      this._currentMode = project.mode === 'yuequ' ? 'yuequ' : 'pinmo';
      this._currentParagraphId = null;

      this.renderReader(project);
      this.showPage('reader', !!replace);
    },

    // renderReader(project)
    // → 渲染阅读页正文段落。
    // 段落点击后会高亮，并记录当前选中段落。
    renderReader:function(project){
      project = project || this._findProject(this._currentProjectId);

      if(!project)return;

      var titleEl = document.getElementById('readingReaderTitle');
      var subEl = document.getElementById('readingReaderSub');
      var listEl = document.getElementById('readingParagraphList');

      if(titleEl)titleEl.textContent = project.title || '未命名项目';

      var ch = project.charId ? getCharById(project.charId) : null;
      var charName = ch ? this._displayCharName(ch) : (project.charNameSnapshot || '未绑定角色');

      if(subEl){
        subEl.textContent = charName + ' · ' + (project.mode === 'pinmo' ? '品墨知音' : '阅趣同行');
      }

      if(!listEl)return;

      listEl.innerHTML = '';

      var paragraphs = [];

      (project.chapters || []).forEach(function(chap){
        (chap.paragraphs || []).forEach(function(pg){
          paragraphs.push(pg);
        });
      });

      if(paragraphs.length === 0){
        listEl.innerHTML = '<div class="reading-empty" style="display:block">这个项目还没有段落</div>';
        return;
      }

      var self = this;

      paragraphs.forEach(function(pg, idx){
        var div = document.createElement('div');
        div.className = 'reading-paragraph';
        div.dataset.pid = pg.id;

        var annotationHtml = '';

        if(pg.annotations && pg.annotations.length > 0){
          annotationHtml =
            '<div class="reading-annotation-strip">' +
            pg.annotations.map(function(a){
              return '<div class="reading-annotation-card" onclick="event.stopPropagation();cbyd21_Reading.openAnnotationDrawer(\'' + pg.id + '\',\'' + a.id + '\')">' +
                '<div class="reading-annotation-meta">批注 · ' + escHtml(a.mode === 'pinmo' ? '品墨知音' : '阅趣同行') + '</div>' +
                '<div class="reading-annotation-note">' + escHtml(a.visibleNote || '（空批注）') + '</div>' +
              '</div>';
            }).join('') +
            '</div>';
        }

        div.innerHTML =
          '<div class="reading-paragraph-index">#' + (idx + 1) + '</div>' +
          escHtml(pg.text || '') +
          annotationHtml;

        div.onclick = function(){
          self.selectParagraph(pg.id);
        };

        listEl.appendChild(div);
      });
    },

    // selectParagraph(paragraphId)
    // → 选中当前段落。
    // 后续生成批注、心声、问TA都会围绕这个段落。
    selectParagraph:function(paragraphId){
      this._currentParagraphId = paragraphId;

      document.querySelectorAll('#readingParagraphList .reading-paragraph').forEach(function(el){
        el.classList.toggle('active', el.dataset.pid === paragraphId);
      });

      var subEl = document.getElementById('readingReaderSub');

      if(subEl){
        var idx = Array.prototype.indexOf.call(
          document.querySelectorAll('#readingParagraphList .reading-paragraph'),
          document.querySelector('#readingParagraphList .reading-paragraph[data-pid="' + paragraphId + '"]')
        );

        subEl.textContent = idx >= 0 ? ('已选中第 ' + (idx + 1) + ' 段') : '已选中段落';
      }
    },

    // openDrawer(title,sub,bodyHtml,footerHtml)
    // → 打开阅读页底部抽屉。
    // 用于批注详情、角色心声、段落讨论。
    // 只有从关闭状态打开时才 push history；抽屉已打开时只刷新内容。
    openDrawer:function(title, sub, bodyHtml, footerHtml){
      var overlay = document.getElementById('readingDrawerOverlay');
      var titleEl = document.getElementById('readingDrawerTitle');
      var subEl = document.getElementById('readingDrawerSub');
      var bodyEl = document.getElementById('readingDrawerBody');
      var footerEl = document.getElementById('readingDrawerFooter');

      if(!overlay || !titleEl || !subEl || !bodyEl || !footerEl)return;

      var wasOpen = this._drawerOpen;

      titleEl.textContent = title || '详情';
      subEl.textContent = sub || '';
      bodyEl.innerHTML = bodyHtml || '';
      footerEl.innerHTML = footerHtml || '';

      overlay.classList.add('active');
      this._drawerOpen = true;

      if(!wasOpen && typeof _pushInnerPageState === 'function'){
        _pushInnerPageState('readingDrawer');
      }

      requestAnimationFrame(function(){
        bodyEl.scrollTop = 0;
      });
    },

    // closeDrawer(fromPopstate)
    // → 关闭阅读页底部抽屉。
    // fromPopstate=true 表示浏览器返回键触发，不再主动 history.back()。
    closeDrawer:function(fromPopstate){
      var overlay = document.getElementById('readingDrawerOverlay');

      if(overlay){
        overlay.classList.remove('active');
      }

      var wasOpen = this._drawerOpen;
      this._drawerOpen = false;

      if(wasOpen && !fromPopstate){
        try{
          _ignorePopstate = true;
          history.back();
        }catch(e){}
      }
    },

    // openAnnotationDrawer(paragraphId, annotationId)
    // → 打开某条批注详情抽屉。
    // 显示公开批注和角色心声。
    openAnnotationDrawer:function(paragraphId, annotationId){
      var project = this._findProject(this._currentProjectId);

      if(!project)return;

      var pg = this._findParagraph(project, paragraphId);

      if(!pg)return;

      var anno = (pg.annotations || []).find(function(a){
        return a && a.id === annotationId;
      });

      if(!anno)return;

      var body =
        '<div class="reading-drawer-section">' +
          '<div class="reading-drawer-section-title">TA写下的批注</div>' +
          '<div class="reading-drawer-text">' + escHtml(anno.visibleNote || '（空）') + '</div>' +
        '</div>' +
        '<div class="reading-drawer-section">' +
          '<div class="reading-drawer-section-title">TA真正的想法</div>' +
          '<div class="reading-drawer-text">' + escHtml(anno.innerThought || '还没有心声') + '</div>' +
        '</div>';

      var copyText = 'TA写下的批注：\n' + (anno.visibleNote || '') + '\n\nTA真正的想法：\n' + (anno.innerThought || '');

      var footer =
        '<button class="btn-sm" onclick="cbyd21_Reading.copyText(' + JSON.stringify(copyText) + ')" style="flex:1">复制</button>' +
        '<button class="btn-sm primary" onclick="cbyd21_Reading.regenerateAnnotation(\'' + paragraphId + '\',\'' + annotationId + '\')" style="flex:1">重新生成</button>' +
        '<button class="btn-sm danger" onclick="cbyd21_Reading.deleteAnnotation(\'' + paragraphId + '\',\'' + annotationId + '\')" style="flex:1">删除</button>';

      this.openDrawer('批注与心声', '当前段落', body, footer);
    },

    // generateAnnotationPlaceholder()
    // → 生成当前段落的公开批注 + 角色心声。
    // 一次用户点击只调用一次 API。
    // 返回内容写入当前段落 annotations。
    generateAnnotationPlaceholder:async function(){
      if(this._generating){
        showToast('素页同栖正在生成中，请稍等');
        return;
      }

      var ctx = this._getCurrentProjectAndParagraph();

      if(!ctx){
        showToast('请先点击选择一段正文');
        return;
      }

      this._setGenerating(true);

      try{
        this.openDrawer(
          '生成批注中',
          '当前段落',
          '<div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:12px">正在生成公开批注和角色心声…</div>',
          ''
        );

        var parsed = await this._generateAnnotationForContext(ctx);

        if(!Array.isArray(ctx.paragraph.annotations)){
          ctx.paragraph.annotations = [];
        }

        var now = Date.now();
        var anno = {
          id:'anno_' + now + '_' + Math.random().toString(36).slice(2,6),
          mode:ctx.project.mode || this._currentMode,
          charId:ctx.project.charId,
          visibleNote:parsed.visibleNote,
          innerThought:parsed.innerThought,
          createdAt:now,
          updatedAt:now
        };

        ctx.paragraph.annotations.push(anno);
        this._saveProject(ctx.project);
        this.renderReader(ctx.project);
        this.selectParagraph(ctx.paragraph.id);
        this.openAnnotationDrawer(ctx.paragraph.id, anno.id);
        showToast('批注已生成');
      }catch(e){
        var isAbort = e && e.name === 'AbortError';

        if(!isAbort){
          this._appendProjectError(ctx.project, 'annotation', this._errorText(e));
        }

        this.openDrawer(
          isAbort ? '生成已中断' : '生成失败',
          '当前段落',
          '<div class="reading-drawer-section"><div class="reading-drawer-section-title">状态</div><div class="reading-drawer-text">' + escHtml(isAbort ? '本次批注生成已中断。' : (e && e.message || '未知错误')) + '</div></div>',
          '<button class="btn-sm" onclick="cbyd21_Reading.closeDrawer()" style="width:100%">关闭</button>'
        );

        if(e && !(e.name === 'PromptLoadingBlocked' || e._cbyd21PromptLoadingBlocked || e.name === 'AbortError')){
          showApiError(e.message || '');
        }
      }finally{
        this._setGenerating(false);
      }
    },

    // _generateAnnotationForContext(ctx)
    // → 内部共用：为当前项目段落调用一次 API 生成批注+心声。
    _generateAnnotationForContext:async function(ctx){
      var base = this._buildBasePrompt(ctx.project, ctx.paragraph, '生成段落批注和角色心声');
      var textForApi = this._runRegexForChar(ctx.paragraph.text || '', 'userInput', ctx.project.charId);
      var modePrompt = this._annotationModePrompt(ctx.project);

      var ownWorkNote = ctx.project.isOwnWork
        ? '\n[用户作品提示]\n用户标记这段文本是自己的作品。阅读和批注时要把它当成用户投入过心力的创作来看待。\n可以真实指出优点、问题、结构缺陷、表达问题、节奏问题和改进方向，也可以按照角色卡表达审美差异。\n但评价对象始终是文本，不是用户本人。批评文本时仍要让用户感到自己的创作劳动被看见、被认真读过、被当回事。\n不能让用户感到被看不起、被嫌弃、被羞辱、被敷衍、被放在低处，或者像是被随意打分。\n'
        : '';

      var annotationStylePrompt = '';

      var annotationPreset = this.loadStylePresets().find(function(p){
        return p && (p.target === 'annotation' || p.target === 'all') && p.prompt;
      });

      if(annotationPreset){
        annotationStylePrompt = '\n[素页同栖文风预设]\n' + String(annotationPreset.prompt || '').trim() + '\n';
      }

      var userContent =
        modePrompt +
        ownWorkNote +
        annotationStylePrompt +
        '\n[批注态度要求]\n' +
        'visibleNote 是角色写给用户看的书边公开批注。它可以认真、轻松、挑剔、毒舌、克制或带有角色自己的审美，但必须让用户感觉这段文本被认真读过。\n' +
        '如果文本是用户自己的作品，评价对象始终是文本本身。可以指出问题，也可以表达不喜欢某种写法，但不能把用户本人放在低处，不能让用户感到被看不起、被羞辱、被敷衍或被随意对待。\n' +
        'innerThought 是角色内心真实反应，可以更私密、更直接，也可以和公开批注有反差；反差来自角色卡和文本内容，不是为了制造刻薄或搞笑。即使是心声，也要保持角色卡定义的对用户态度和关系底色。\n\n' +
        '[当前项目]\n标题：' + (ctx.project.title || '未命名') +
        (ctx.project.author ? '\n作者/来源：' + ctx.project.author : '') +
        '\n\n[当前段落原文]\n' +
        textForApi +
        '\n\n[输出格式]\n' +
        '输出 JSON 对象：{"visibleNote":"","innerThought":""}\n' +
        'visibleNote 字段填写角色写给用户看的书边公开批注。\n' +
        'innerThought 字段填写角色读到这一段时真实闪过的内心反应，它是内心活动，不是写给用户看的批注。\n' +
        '保持当前角色的人格、知识结构、情绪反应和表达方式。输出内容像这个角色在阅读这一段时自然留下的批注和心声。最终只输出这个 JSON 对象本身。';

      var reply = await this._fetchChatCompletionSafe({
        messages:this._buildApiMessagesWithWorldBookDepth(base, [
          {role:'user',content:userContent}
        ])
      }, '素页同栖批注');

      var parsed = this._parseAnnotationReply(reply);

      parsed.visibleNote = this._runRegexForChar(parsed.visibleNote, 'aiOutput', ctx.project.charId);
      parsed.innerThought = this._runRegexForChar(parsed.innerThought, 'aiOutput', ctx.project.charId);

      return parsed;
    },

    // regenerateAnnotation(paragraphId,annotationId)
    // → 重新生成某条批注和心声。
    // 只调用一次 API，成功后覆盖原批注。
    regenerateAnnotation:async function(paragraphId, annotationId){
      if(this._generating){
        showToast('素页同栖正在生成中，请稍等');
        return;
      }

      var project = this._findProject(this._currentProjectId);
      var paragraph = this._findParagraph(project, paragraphId);

      if(!project || !paragraph){
        showToast('找不到段落');
        return;
      }

      var anno = (paragraph.annotations || []).find(function(a){
        return a && a.id === annotationId;
      });

      if(!anno){
        showToast('找不到批注');
        return;
      }

      this._setGenerating(true);

      try{
        this.openDrawer(
          '重新生成中',
          '当前段落',
          '<div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:12px">正在重新生成公开批注和角色心声…</div>',
          ''
        );

        var parsed = await this._generateAnnotationForContext({
          project:project,
          paragraph:paragraph
        });

        anno.visibleNote = parsed.visibleNote;
        anno.innerThought = parsed.innerThought;
        anno.updatedAt = Date.now();

        this._saveProject(project);
        this.renderReader(project);
        this.selectParagraph(paragraph.id);
        this.openAnnotationDrawer(paragraph.id, anno.id);
        showToast('批注已重新生成');
      }catch(e){
        var isAbort = e && e.name === 'AbortError';

        if(!isAbort){
          this._appendProjectError(project, 'annotation_regenerate', this._errorText(e));
        }

        this.openDrawer(
          isAbort ? '重新生成已中断' : '重新生成失败',
          '当前段落',
          '<div class="reading-drawer-section"><div class="reading-drawer-section-title">状态</div><div class="reading-drawer-text">' + escHtml(isAbort ? '本次重新生成已中断。' : (e && e.message || '未知错误')) + '</div></div>',
          '<button class="btn-sm" onclick="cbyd21_Reading.closeDrawer()" style="width:100%">关闭</button>'
        );

        if(e && !(e.name === 'PromptLoadingBlocked' || e._cbyd21PromptLoadingBlocked || e.name === 'AbortError')){
          showApiError(e.message || '');
        }
      }finally{
        this._setGenerating(false);
      }
    },

    // deleteAnnotation(paragraphId,annotationId)
    // → 删除某条批注和心声。
    deleteAnnotation:async function(paragraphId, annotationId){
      var project = this._findProject(this._currentProjectId);
      var paragraph = this._findParagraph(project, paragraphId);

      if(!project || !paragraph)return;

      var yes = await customConfirm('确认删除这条批注和心声？');

      if(!yes)return;

      paragraph.annotations = (paragraph.annotations || []).filter(function(a){
        return a && a.id !== annotationId;
      });

      this._saveProject(project);
      this.renderReader(project);
      this.selectParagraph(paragraph.id);
      this.closeDrawer();
      showToast('批注已删除');
    },

    // showThoughtPlaceholder()
    // → 打开当前段落最近一条批注的心声。
    // 如果还没有批注，提示先生成批注。
    showThoughtPlaceholder:function(){
      var ctx = this._getCurrentProjectAndParagraph();

      if(!ctx){
        showToast('请先点击选择一段正文');
        return;
      }

      var annotations = ctx.paragraph.annotations || [];

      if(annotations.length === 0){
        showToast('这段还没有批注，请先生成批注');
        return;
      }

      var latest = annotations[annotations.length - 1];

      this.openAnnotationDrawer(ctx.paragraph.id, latest.id);
    },

    // askTaPlaceholder()
    // → 打开段落讨论抽屉。
    // 当前批次只支持本地写入占位回答，不调用 API。
    askTaPlaceholder:function(){
      var ctx = this._getCurrentProjectAndParagraph();

      if(!ctx){
        showToast('请先点击选择一段正文');
        return;
      }

      this.openDiscussionDrawer(ctx.project, ctx.paragraph);
    },

    // openDiscussionDrawer(project,paragraph)
    // → 打开当前段落讨论抽屉。
    openDiscussionDrawer:function(project, paragraph){
      if(!project || !paragraph)return;

      if(!Array.isArray(paragraph.discussions)){
        paragraph.discussions = [];
      }

      var body = '';

      body +=
        '<div class="reading-drawer-section">' +
          '<div class="reading-drawer-section-title">当前段落</div>' +
          '<div class="reading-drawer-text">' + escHtml((paragraph.text || '').slice(0, 600)) + (paragraph.text && paragraph.text.length > 600 ? '…' : '') + '</div>' +
        '</div>';

      if(paragraph.discussions.length === 0){
        body += '<div style="text-align:center;padding:18px 0;color:var(--text-muted);font-size:12px">还没有讨论记录</div>';
      }else{
        paragraph.discussions.forEach(function(d){
          body +=
            '<div class="reading-discussion-item">' +
              '<div class="reading-discussion-q">你：' + escHtml(d.userQuestion || '') + '</div>' +
              '<div class="reading-discussion-a">TA：' + escHtml(d.charReply || '') + '</div>' +
              '<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px">' +
                '<button class="btn-sm" onclick="cbyd21_Reading.copyText(' + JSON.stringify('你：' + (d.userQuestion || '') + '\n\nTA：' + (d.charReply || '')) + ')" style="padding:4px 8px;font-size:10px">复制</button>' +
                '<button class="btn-sm danger" onclick="cbyd21_Reading.deleteDiscussion(\'' + paragraph.id + '\',\'' + d.id + '\')" style="padding:4px 8px;font-size:10px">删除</button>' +
              '</div>' +
            '</div>';
        });
      }

      var footer =
        '<input class="form-input" id="readingDiscussionInput" placeholder="问TA关于这一段的想法…" style="flex:1;font-size:12px">' +
        '<button class="btn-sm primary" onclick="cbyd21_Reading.submitDiscussionPlaceholder()">发送</button>';

      this.openDrawer('问TA', '段落讨论', body, footer);

      setTimeout(function(){
        var input = document.getElementById('readingDiscussionInput');

        if(input){
          input.focus();

          input.onkeydown = function(e){
            if(e.isComposing || e.keyCode === 229)return;

            if(e.key === 'Enter'){
              e.preventDefault();
              cbyd21_Reading.submitDiscussionPlaceholder();
            }
          };
        }
      },80);
    },

    // deleteDiscussion(paragraphId,discussionId)
    // → 删除某条段落讨论记录。
    deleteDiscussion:async function(paragraphId, discussionId){
      var project = this._findProject(this._currentProjectId);
      var paragraph = this._findParagraph(project, paragraphId);

      if(!project || !paragraph)return;

      var yes = await customConfirm('确认删除这条讨论记录？');

      if(!yes)return;

      paragraph.discussions = (paragraph.discussions || []).filter(function(d){
        return d && d.id !== discussionId;
      });

      this._saveProject(project);
      this.renderReader(project);
      this.selectParagraph(paragraph.id);
      this.openDiscussionDrawer(project, paragraph);
      showToast('讨论记录已删除');
    },

    // submitDiscussionPlaceholder()
    // → 提交段落讨论问题。
    // 一次用户点击只调用一次 API。
    // 生成回答后保存到当前段落 discussions。
    submitDiscussionPlaceholder:async function(){
      if(this._generating){
        showToast('素页同栖正在生成中，请稍等');
        return;
      }

      var input = document.getElementById('readingDiscussionInput');
      var text = input ? String(input.value || '').trim() : '';

      if(!text){
        showToast('请输入问题');
        return;
      }

      var ctx = this._getCurrentProjectAndParagraph();

      if(!ctx){
        showToast('请先选择段落');
        return;
      }

      this._setGenerating(true);

      try{
        var base = this._buildBasePrompt(ctx.project, ctx.paragraph, '回答用户关于段落的问题');

        var paragraphText = this._runRegexForChar(ctx.paragraph.text || '', 'userInput', ctx.project.charId);
        var questionText = this._runRegexForChar(text, 'userInput', ctx.project.charId);

        var notes = (ctx.paragraph.annotations || []).map(function(a, idx){
          return '批注' + (idx + 1) + '：' + (a.visibleNote || '') + (a.innerThought ? '\n心声' + (idx + 1) + '：' + a.innerThought : '');
        }).join('\n\n');

        var discussionStylePrompt = '';

        var discussionPreset = this.loadStylePresets().find(function(p){
          return p && (p.target === 'annotation' || p.target === 'all') && p.prompt;
        });

        if(discussionPreset){
          discussionStylePrompt = '[素页同栖文风预设]\n' + String(discussionPreset.prompt || '').trim() + '\n\n';
        }

        var userContent =
          discussionStylePrompt +
          '[段落讨论]\n' +
          '用户正在和角色讨论当前段落。请以当前角色身份回答用户的问题。\n' +
          '回答来自角色卡、当前阅读模式、段落原文、已有批注和角色心声。\n' +
          '回复形式是素页同栖内部的段落讨论回答，保持角色陪读感、角色语气和对用户的态度。\n' +
          '用户的问题和阅读感受都应被认真对待。角色可以有自己的判断、审美、偏见和情绪，但不能用居高临下、敷衍、轻视或随便打发的态度回应用户。\n' +
          '如果讨论的是用户自己的作品，回答可以真实指出文本问题和改进方向，但评价文本，不贬低用户本人；让用户感到自己的创作劳动被认真看见。\n\n' +
          '[当前段落原文]\n' + paragraphText +
          (notes ? '\n\n[已有批注和心声]\n' + notes : '') +
          '\n\n[用户的问题]\n' + questionText +
          '\n\n[输出格式]\n' +
          '输出 JSON 对象：{"answer":""}\n' +
          'answer 字段填写角色对用户这个问题的回答。最终只输出这个 JSON 对象本身。';

        var footer =
          '<button class="btn-sm" disabled style="width:100%;opacity:.65">正在生成回答…</button>';

        document.getElementById('readingDrawerFooter').innerHTML = footer;

        var reply = await this._fetchChatCompletionSafe({
          messages:this._buildApiMessagesWithWorldBookDepth(base, [
            {role:'user',content:userContent}
          ])
        }, '素页同栖问TA');

        var answer = this._parseDiscussionReply(reply);
        answer = this._runRegexForChar(answer, 'aiOutput', ctx.project.charId);

        if(!Array.isArray(ctx.paragraph.discussions)){
          ctx.paragraph.discussions = [];
        }

        ctx.paragraph.discussions.push({
          id:'disc_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
          userQuestion:text,
          charReply:answer,
          createdAt:Date.now(),
          updatedAt:Date.now()
        });

        this._saveProject(ctx.project);
        this.renderReader(ctx.project);
        this.selectParagraph(ctx.paragraph.id);
        this.openDiscussionDrawer(ctx.project, ctx.paragraph);
        showToast('回答已生成');
      }catch(e){
        var isAbort = e && e.name === 'AbortError';

        if(!isAbort){
          this._appendProjectError(ctx.project, 'discussion', this._errorText(e));
        }

        this.openDrawer(
          isAbort ? '问TA已中断' : '问TA失败',
          '段落讨论',
          '<div class="reading-drawer-section"><div class="reading-drawer-section-title">状态</div><div class="reading-drawer-text">' + escHtml(isAbort ? '本次段落讨论生成已中断。' : (e && e.message || '未知错误')) + '</div></div>',
          '<button class="btn-sm" onclick="cbyd21_Reading.closeDrawer()" style="width:100%">关闭</button>'
        );

        if(e && !(e.name === 'PromptLoadingBlocked' || e._cbyd21PromptLoadingBlocked || e.name === 'AbortError')){
          showApiError(e.message || '');
        }
      }finally{
        this._setGenerating(false);
      }
    },

    // renderShelf()
    // → 渲染当前模式的项目书架。
    // 第一批支持空列表和已有项目卡片展示；阅读页下一批接入。
    renderShelf:function(){
      var list = document.getElementById('readingShelfList');
      var empty = document.getElementById('readingShelfEmpty');
      var title = document.getElementById('readingShelfTitle');
      var desc = document.getElementById('readingShelfDesc');

      if(!list || !empty)return;

      var mode = this._currentMode === 'yuequ' ? 'yuequ' : 'pinmo';

      if(title){
        title.textContent = mode === 'pinmo' ? '品墨知音' : '阅趣同行';
      }

      if(desc){
        desc.textContent = mode === 'pinmo'
          ? '适合文学作品、散文、诗歌、思想性文本。'
          : '适合网文、轻小说、同人、剧情小说。';
      }

      var projects = this.loadProjects().filter(function(p){
        return p && p.mode === mode;
      });

      list.innerHTML = '';

      if(projects.length === 0){
        empty.style.display = 'block';
        empty.textContent = mode === 'pinmo'
          ? '还没有品墨知音项目'
          : '还没有阅趣同行项目';
        return;
      }

      empty.style.display = 'none';

      projects.sort(function(a,b){
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });

      projects.forEach(function(p){
        var div = document.createElement('div');
        div.className = 'reading-entry-card';

        var ch = p.charId && typeof getCharById === 'function'
          ? getCharById(p.charId)
          : null;

        var charName = ch && typeof getCharOnlineName === 'function'
          ? getCharOnlineName(ch)
          : (ch ? ch.name : (p.charNameSnapshot || '未绑定角色'));

        var paraCount = 0;
        var annoCount = 0;
        var discussionCount = 0;
        var errorCount = Array.isArray(p.errors) ? p.errors.length : 0;

        (p.chapters || []).forEach(function(chap){
          (chap.paragraphs || []).forEach(function(pg){
            paraCount++;
            annoCount += (pg.annotations || []).length;
            discussionCount += (pg.discussions || []).length;
          });
        });

        var updatedText = p.updatedAt ? (' · 更新 ' + formatTime(p.updatedAt)) : '';

        var projectMetaText =
          charName + ' · ' +
          paraCount + '段 · ' +
          annoCount + '批注 · ' +
          discussionCount + '讨论' +
          (errorCount ? (' · ' + errorCount + '错误') : '') +
          updatedText;

        div.innerHTML =
          '<span class="reading-entry-icon"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h12a2 2 0 012 2v16l-7-3-7 3V7a2 2 0 012-2z"/><path d="M10 10h7"/><path d="M10 14h5" opacity="0.45"/></svg></span>' +
          '<span class="reading-entry-main"><strong>' + escHtml(p.title || '未命名项目') + '</strong><em>' + escHtml(projectMetaText) + '</em></span>' +
          '<button class="btn-sm" onclick="event.stopPropagation();cbyd21_Reading.openProjectMenu(\'' + p.id + '\')" style="padding:5px 9px;font-size:10px">管理</button>' +
          '<span class="reading-entry-count">进入</span>';

        div.onclick = function(){
          cbyd21_Reading.openReader(p.id);
        };

        list.appendChild(div);
      });
    }
  };

  // boot()
  // → 模块加载后初始化本地 key。
  // 不打开页面，不触发 API。
  function boot(){
    cbyd21_Reading.ensureData();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }
})();
