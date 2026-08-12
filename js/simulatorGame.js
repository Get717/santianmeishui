// ===== 【模块】cbyd21_SimulatorGame — 万象匣 =====

(function(){
  if(window.cbyd21_SimulatorGame)return;

  window.cbyd21_SimulatorGame = {
    _items:[],
    _currentId:null,
    _editingId:null,
    _generating:false,
    _abortController:null,
    _storeKey:'stm_simulatorGames',

    // openApp(fromGames)
    // → 打开万象匣应用并刷新列表。
    // fromGames=true 表示从绘言戏局进入，用于返回时回到绘言戏局。
    openApp:function(fromGames){
      this.load();
      this.showHome();
      this.renderList();
      this.bindFrameBridge();
      this.openNoticeIfNeeded();
    },

    // closeApp(fromPopstate)
    // → 关闭万象匣。
    // 如果是从绘言戏局进入，返回绘言戏局；否则回桌面。
    closeApp:function(fromPopstate){
      var simApp=document.getElementById('simulatorApp');

      if(simApp)simApp.classList.remove('active');

      var notice=document.getElementById('simulatorNoticeOverlay');
      if(notice)notice.classList.remove('active');

      if(this._abortController){
        try{
          this._abortController.abort();
        }catch(e){}
      }

      this._currentId=null;
      this._editingId=null;
      this._abortController=null;
      this._generating=false;

      var frame=document.getElementById('simFrame');
      if(frame){
        frame.removeAttribute('srcdoc');
        frame.removeAttribute('src');
      }

      var runBody=document.querySelector('#simulatorApp .sim-run-body');
      if(runBody){
        runBody.classList.remove('sim-html-mode');
      }

      var inputArea=document.querySelector('#simulatorApp .sim-input-area');
      if(inputArea)inputArea.style.display='flex';

      if(typeof cbyd21_Games !== 'undefined' && cbyd21_Games._returnToGames){
        cbyd21_Games._returnToGames=false;

        var gamesApp=document.getElementById('gamesApp');
        if(gamesApp)gamesApp.classList.add('active');

        document.getElementById('desktop').classList.add('hidden');
        currentAppId='gamesApp';

        if(!fromPopstate){
          _ignorePopstate=true;
          history.back();
        }

        if(typeof updateSnowVisibility === 'function')updateSnowVisibility();
        return;
      }

      document.getElementById('desktop').classList.remove('hidden');
      currentAppId=null;

      if(!fromPopstate){
        history.back();
      }

      if(typeof updateSnowVisibility === 'function')updateSnowVisibility();
    },

    // openNoticeIfNeeded()
    // → 首次进入万象匣时显示试验提示。
    // 用户勾选“不再提示”后不再自动弹出。
    openNoticeIfNeeded:function(){
      if(localStorage.getItem('stm_simulatorNoticeDismissed') === '1')return;

      var cb=document.getElementById('simulatorNoticeDontShow');
      if(cb)cb.checked=false;

      var overlay=document.getElementById('simulatorNoticeOverlay');

      if(overlay){
        overlay.classList.add('active');
      }
    },

    // closeNotice()
    // → 关闭万象匣试验提示。
    // 如果用户勾选不再提示，则写入本地偏好。
    closeNotice:function(){
      var cb=document.getElementById('simulatorNoticeDontShow');

      if(cb&&cb.checked){
        localStorage.setItem('stm_simulatorNoticeDismissed','1');
      }

      var overlay=document.getElementById('simulatorNoticeOverlay');

      if(overlay){
        overlay.classList.remove('active');
      }
    },

    // load()
    // → 从 localStorage 读取模拟器列表。
    load:function(){
      try{
        var arr=JSON.parse(localStorage.getItem(this._storeKey)||'[]');
        this._items=Array.isArray(arr)?arr:[];
      }catch(e){
        this._items=[];
      }
    },

    // save()
    // → 保存模拟器列表到 localStorage。
    save:function(){
      localStorage.setItem(this._storeKey,JSON.stringify(this._items||[]));
    },

    // getById(id)
    // → 根据 id 读取某个模拟器。
    getById:function(id){
      return (this._items||[]).find(function(item){
        return item&&item.id===id;
      })||null;
    },

    // showPage(id)
    // → 切换万象匣内部页面。
    showPage:function(id){
      document.querySelectorAll('#simulatorApp .sim-page').forEach(function(p){
        p.classList.toggle('active',p.id===id);
      });
    },

    // showHome()
    // → 回到万象匣首页。
    showHome:function(){
      this.showPage('simHomePage');
      this.renderList();

      var title=document.getElementById('simHeaderTitle');
      var sub=document.getElementById('simHeaderSub');

      if(title)title.textContent='万象匣';
      if(sub)sub.textContent='导入页面、模拟器和 AI 文游';
    },

    // modeLabel(mode)
    // → 将内部模式值转成用户能看懂的玩法名称。
    modeLabel:function(mode){
      if(mode==='html')return '直接运行 HTML';
      if(mode==='text')return '纯文字 AI 文游';
      if(mode==='hybrid')return '文字 + HTML 面板';
      if(mode==='frontend_ai')return 'HTML 选项 + AI 推进';
      return '未知模式';
    },

    // renderList()
    // → 渲染万象匣首页模拟器列表。
    renderList:function(){
      var list=document.getElementById('simGameList');
      var empty=document.getElementById('simGameEmpty');

      if(!list||!empty)return;

      list.innerHTML='';

      if(!this._items||this._items.length===0){
        empty.style.display='block';
        return;
      }

      empty.style.display='none';

      var self=this;

      this._items.forEach(function(item){
        var div=document.createElement('div');
        div.className='sim-item';

        div.innerHTML=
          '<div class="sim-item-name">'+escHtml(item.name||'未命名模拟器')+'</div>'+
          '<div class="sim-item-meta">'+escHtml(self.modeLabel(item.mode))+' · '+(item.messages&&item.messages.length?item.messages.length+'条记录':'暂无记录')+'</div>'+
          '<div class="sim-item-desc">'+escHtml((item.prompt||item.html||'').replace(/\s+/g,' ').slice(0,80)||'点击进入运行。')+'</div>';

        div.onclick=function(){
          self.run(item.id);
        };

        list.appendChild(div);
      });
    },

    // openEditor(id)
    // → 打开模拟器编辑页。
    // id 为空表示新建；有 id 表示编辑已有模拟器。
    openEditor:function(id){
      this.load();
      this._editingId=id||null;

      var item=id?this.getById(id):null;

      document.getElementById('simEditorTitle').textContent=item?'编辑模拟器':'新建模拟器';
      document.getElementById('simEditName').value=item&&item.name||'';
      document.getElementById('simEditMode').value=item&&item.mode||'html';
      document.getElementById('simEditHtml').value=item&&item.html||'';
      document.getElementById('simEditPrompt').value=item&&item.prompt||'';
      document.getElementById('simEditBreaker').value=item&&item.breaker||'';
      document.getElementById('simEditWcMin').value=item&&item.wcMin||'300';
      document.getElementById('simEditWcMax').value=item&&item.wcMax||'700';
      document.getElementById('simEditWorldBook').checked=item&&item.worldBookEnabled!==undefined?!!item.worldBookEnabled:true;
      document.getElementById('simEditRegex').checked=item&&item.regexEnabled!==undefined?!!item.regexEnabled:true;

      var delBtn=document.getElementById('simDeleteBtn');
      if(delBtn)delBtn.style.display=item?'':'none';

      this.syncEditorMode();
      this.showPage('simEditorPage');

      var title=document.getElementById('simHeaderTitle');
      var sub=document.getElementById('simHeaderSub');

      if(title)title.textContent=item?'编辑万象匣':'新建万象匣';
      if(sub)sub.textContent='配置运行方式、页面内容和玩法规则';
    },

    // syncEditorMode()
    // → 根据运行模式显示 / 隐藏编辑字段。
    syncEditorMode:function(){
      var mode=document.getElementById('simEditMode').value;
      var htmlWrap=document.getElementById('simHtmlEditorWrap');
      var promptWrap=document.getElementById('simPromptEditorWrap');
      var breakerWrap=document.getElementById('simBreakerEditorWrap');

      if(htmlWrap)htmlWrap.style.display=(mode==='html'||mode==='hybrid'||mode==='frontend_ai')?'block':'none';
      if(promptWrap)promptWrap.style.display=(mode==='text'||mode==='hybrid'||mode==='frontend_ai')?'block':'none';
      if(breakerWrap)breakerWrap.style.display=(mode==='text'||mode==='hybrid'||mode==='frontend_ai')?'block':'none';

    },

    // saveFromEditor()
    // → 保存编辑页内容。
    saveFromEditor:function(){
      var name=document.getElementById('simEditName').value.trim();
      var mode=document.getElementById('simEditMode').value;

      if(!name){
        showToast('请输入模拟器名称');
        return;
      }

      var item=this._editingId?this.getById(this._editingId):null;

      if(!item){
        item={
          id:'sim_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
          createdAt:Date.now(),
          messages:[]
        };
        this._items.unshift(item);
      }

      item.name=name;
      item.mode=mode;
      item.html=document.getElementById('simEditHtml').value||'';
      item.prompt=document.getElementById('simEditPrompt').value||'';
      item.breaker=document.getElementById('simEditBreaker').value||'';
      item.wcMin=parseInt(document.getElementById('simEditWcMin').value,10)||300;
      item.wcMax=parseInt(document.getElementById('simEditWcMax').value,10)||700;
      item.worldBookEnabled=!!document.getElementById('simEditWorldBook').checked;
      item.regexEnabled=!!document.getElementById('simEditRegex').checked;
      delete item.sendFullHtmlToAi;
      item.updatedAt=Date.now();

      this.save();
      this.run(item.id);
      showToast('模拟器已保存');
    },

    // deleteCurrentFromEditor()
    // → 删除当前正在编辑的模拟器。
    // 只删除万象匣数据，不影响普通聊天、线下、浮生或 HTML 预览器。
    deleteCurrentFromEditor:async function(){
      if(!this._editingId){
        showToast('当前是新建模拟器');
        return;
      }

      var item=this.getById(this._editingId);
      var yes=await customConfirm('确认删除模拟器「' + (item ? item.name : '') + '」？\n\n这会删除它的 HTML 源码、玩法提示词和运行记录。');

      if(!yes)return;

      this._items=(this._items||[]).filter(function(x){
        return x && x.id !== cbyd21_SimulatorGame._editingId;
      });

      if(this._currentId === this._editingId){
        this._currentId = null;
      }

      this._editingId = null;
      this.save();
      this.showHome();
      this.renderList();
      showToast('模拟器已删除');
    },

    // importTextCardFile()
    // → 导入 TXT / MD 形式的整卡文本。
    // 导入后创建“文字 + HTML 面板”模式，把整份文本作为完整玩法规则交给 AI。
    importTextCardFile:function(){
      var self=this;
      var input=document.createElement('input');

      input.type='file';
      input.accept='.txt,.text,.md,text/plain,text/markdown';
      input.style.display='none';

      input.onchange=function(e){
        var file=e.target.files&&e.target.files[0];

        if(!file)return;

        var reader=new FileReader();

        reader.onload=function(ev){
          self.load();

          var text=String(ev.target.result||'').trim();

          if(!text){
            showToast('文件里没有可导入文字');
            return;
          }

          var item={
            id:'sim_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
            name:file.name.replace(/\.(txt|text|md)$/i,'')||'导入文字卡',
            mode:'hybrid',
            html:'',
            prompt:text,
            breaker:'',
            wcMin:300,
            wcMax:700,
            worldBookEnabled:true,
            regexEnabled:true,
            messages:[],
            createdAt:Date.now(),
            updatedAt:Date.now()
          };

          self._items.unshift(item);
          self.save();
          self.run(item.id);
          showToast('文字卡已导入');
        };

        reader.readAsText(file);
      };

      document.body.appendChild(input);
      input.click();

      setTimeout(function(){
        if(input.parentNode)document.body.removeChild(input);
      },3000);
    },

    // importHtmlFile()
    // → 导入本地 HTML 文件并创建纯 HTML 模拟器。
    importHtmlFile:function(){
      var self=this;
      var input=document.createElement('input');

      input.type='file';
      input.accept='.html,.htm,text/html';
      input.style.display='none';

      input.onchange=function(e){
        var file=e.target.files&&e.target.files[0];

        if(!file)return;

        var reader=new FileReader();

        reader.onload=function(ev){
          self.load();

          var item={
            id:'sim_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
            name:file.name.replace(/\.(html|htm)$/i,'')||'导入 HTML',
            mode:'html',
            html:String(ev.target.result||''),
            prompt:'',
            breaker:'',
            wcMin:300,
            wcMax:700,
            worldBookEnabled:true,
            regexEnabled:true,
            messages:[],
            createdAt:Date.now(),
            updatedAt:Date.now()
          };

          self._items.unshift(item);
          self.save();
          self.run(item.id);
          showToast('HTML 已导入');
        };

        reader.readAsText(file);
      };

      document.body.appendChild(input);
      input.click();

      setTimeout(function(){
        if(input.parentNode)document.body.removeChild(input);
      },3000);
    },

    // run(id)
    // → 进入某个模拟器运行页。
    run:function(id){
      this.load();

      var item=this.getById(id);

      if(!item){
        showToast('找不到模拟器');
        return;
      }

      this._currentId=id;
      this.showPage('simRunPage');

      document.getElementById('simRunTitle').textContent=item.name||'万象匣';
      document.getElementById('simRunSub').textContent=this.modeLabel(item.mode);
      document.getElementById('simRerollBtn').style.display=item.mode==='html'?'none':'';

      var logPanel=document.getElementById('simLogPanel');
      if(logPanel)logPanel.style.display=item.mode==='html'?'none':'';

      var inputArea=document.querySelector('#simulatorApp .sim-input-area');
      if(inputArea)inputArea.style.display=item.mode==='html'?'none':'flex';

      var runBody=document.querySelector('#simulatorApp .sim-run-body');
      if(runBody){
        runBody.classList.toggle('sim-html-mode', item.mode === 'html');
      }

      this.renderRun(item);
      this.mountHtml(item);

      var title=document.getElementById('simHeaderTitle');
      var sub=document.getElementById('simHeaderSub');

      if(title)title.textContent='万象匣';
      if(sub)sub.textContent=item.name||'运行中';
    },

    // renderRun(item)
    // → 渲染运行页文本记录。
    renderRun:function(item){
      var list=document.getElementById('simLogList');

      if(!list)return;

      list.innerHTML='';

      var msgs=item.messages||[];

      if(msgs.length===0){
        list.innerHTML='<div style="text-align:center;padding:24px 8px;color:rgba(84,90,106,0.46);font-size:12px;line-height:1.7">还没有运行记录。<br>可以输入行动，或点击前端里的按钮把行动填入输入框。</div>';
        return;
      }

      msgs.forEach(function(m){
        var div=document.createElement('div');
        div.className='sim-log-item '+(m.role==='user'?'user':'ai');

        var text=String(m.content||'');

        if(typeof _stripLeakedThinking==='function'){
          text=_stripLeakedThinking(text);
        }

        div.textContent=(m.role==='user'?'你：':'AI：')+text;
        list.appendChild(div);
      });

      list.scrollTop=list.scrollHeight;
    },

    // mountHtml(item)
    // → 将当前模拟器 HTML 挂载进 iframe。
    // 纯 HTML / 混合 / 前端驱动 AI 都显示 iframe；纯文字模式隐藏 iframe。
    mountHtml:function(item){
      var panel=document.getElementById('simFramePanel');
      var frame=document.getElementById('simFrame');

      if(!panel||!frame)return;

      if(item.mode==='text'){
        panel.style.display='none';
        frame.removeAttribute('srcdoc');
        frame.removeAttribute('src');
        return;
      }

      panel.style.display='block';

      var html=String(item.html||'').trim();

      if(!html){
        html='<div style="font-family:sans-serif;padding:20px;color:#666">还没有可显示的页面内容。</div>';
      }

      html=this.injectBridge(html);

      frame.srcdoc=html;
    },

    // injectBridge(html)
    // → 给 iframe 注入万象匣桥接脚本。
    // iframe 内可调用：
    // parent.postMessage({type:'cbyd21_sim_action',text:'行动文字'}, '*')
    // 父页面收到后只填入输入框，不自动发送。
    injectBridge:function(html){
      var s=String(html||'');

      var bridge =
        '<scr'+'ipt>(function(){' +
        'window.cbyd21SimAction=function(text){try{parent.postMessage({type:"cbyd21_sim_action",text:String(text||"")},"*")}catch(e){}};' +
        'window.addEventListener("message",function(e){var d=e&&e.data;if(!d||d.type!=="cbyd21_sim_ai_result")return;try{if(window.onCbyd21SimAiResult)window.onCbyd21SimAiResult(d)}catch(_e){}});' +
        'document.addEventListener("click",function(ev){var el=ev.target&&ev.target.closest?ev.target.closest("[data-sim-action]"):null;if(!el)return;ev.preventDefault();window.cbyd21SimAction(el.getAttribute("data-sim-action")||el.textContent||"")},true);' +
        '})();</scr'+'ipt>';

      if(/<\/body\s*>/i.test(s)){
        return s.replace(/<\/body\s*>/i,bridge+'</body>');
      }

      if(/<\/html\s*>/i.test(s)){
        return s.replace(/<\/html\s*>/i,bridge+'</html>');
      }

      return s+bridge;
    },

    // bindFrameBridge()
    // → 接收 iframe 发来的行动文本。
    // 只填入输入框，用户自行确认发送。
    bindFrameBridge:function(){
      if(this._bridgeBound)return;

      this._bridgeBound=true;

      var self=this;

      window.addEventListener('message',function(e){
        var d=e&&e.data;

        if(!d||d.type!=='cbyd21_sim_action')return;

        var text=String(d.text||'').trim();

        if(!text)return;

        var input=document.getElementById('simActionInput');

        if(input){
          input.value=text;
          self.autoResizeInput(input);

          try{
            input.focus();
          }catch(_e){}
        }

        showToast('已填入输入框，确认后可发送');
      });
    },

    // postResultToFrame(item, text, html)
    // → AI 返回后把结果发回 iframe。
    // 支持前端驱动 AI 壳自行监听 onCbyd21SimAiResult。
    postResultToFrame:function(item,text,html){
      var frame=document.getElementById('simFrame');

      if(!frame||!frame.contentWindow)return;

      try{
        frame.contentWindow.postMessage({
          type:'cbyd21_sim_ai_result',
          text:String(text||''),
          html:String(html||''),
          state:{}
        },'*');
      }catch(e){}
    },

    // sendAction()
    // → 用户确认发送输入框里的行动。
    // HTML 模式不调用 API，只记录行动并回传 iframe。
    // 其他三种模式调用当前 API。
    sendAction:async function(){
      var item=this.getById(this._currentId);
      var input=document.getElementById('simActionInput');

      if(!item||!input)return;

      var text=String(input.value||'').trim();

      if(!text)return;

      if(item.regexEnabled && typeof applyRegexRules === 'function'){
        text = applyRegexRules(text,'userInput');
      }

      if(this._generating){
        showToast('正在生成中，请稍等');
        return;
      }

      input.value='';
      this.autoResizeInput(input);

      if(!Array.isArray(item.messages))item.messages=[];

      item.messages.push({
        role:'user',
        content:text,
        time:formatTime(Date.now()),
        _ts:Date.now()
      });

      if(item.mode==='html'){
        item.updatedAt=Date.now();
        this.save();
        this.renderRun(item);
        this.postResultToFrame(item,text,'');
        showToast('已发送到当前页面');
        return;
      }

      await this.generate(item,text);
    },

    // buildRequest(item)
    // → 构建 AI 模拟器请求。
    // 世界书只读取全局世界书；正则只处理 AI 文本输出，不处理 HTML 源码。
    buildRequest:function(item){
      if(!apiConfig||!apiConfig.url||!apiConfig.key||!apiConfig.model){
        throw new Error('请先配置 API');
      }

      var sp=[];

      var simPromptText = '';

      if(typeof simulatorPrompt !== 'undefined' && String(simulatorPrompt || '').trim()){
        simPromptText = String(simulatorPrompt || '').trim();
      }else if(
        typeof window.CBYD21_PROMPTS !== 'undefined' &&
        window.CBYD21_PROMPTS.simulator &&
        String(window.CBYD21_PROMPTS.simulator).trim()
      ){
        simPromptText = String(window.CBYD21_PROMPTS.simulator).trim();
      }

      if(simPromptText){
        sp.push(simPromptText);
      }else{
        sp.push(
          '[万象匣模拟器]\n' +
          '你正在运行用户放入万象匣的自定义文游、模拟器、HTML卡、状态栏卡或前端卡。完整卡内容、HTML/前端内容、世界书和历史记录共同构成当前上下文。你必须完整读取并根据用户行动推进玩法。'
        );
      }

      if(item.prompt&&item.prompt.trim()){
        sp.push(
          '[完整卡内容 / 玩法规则]\n' +
          '以下内容是用户放入万象匣的完整文游卡、模拟器规则、系统设定、角色库、输出格式要求或玩法说明。它是当前模拟器的核心上下文，必须完整读取并遵守。\n\n' +
          item.prompt.trim()
        );
      }

      if(item.html&&String(item.html).trim()&&item.mode!=='html'){
        sp.push(
          '[当前 HTML / 前端 / 状态栏 / 面板内容]\n' +
          '以下是用户放入万象匣的完整 HTML、前端代码、状态栏、卡面或数据面板内容。\n' +
          '这部分内容是当前模拟器玩法的一部分。你必须完整读取并遵守它。\n' +
          '如果玩法提示词要求输出 HTML、状态栏、卡面或数据面板，就按这里的结构、规则、尺寸、class、样式和注释要求输出。\n' +
          '不要因为内容很长就忽略它。不要自行省略关键结构。不要把 HTML 卡面改成普通文字。\n\n' +
          String(item.html||'').trim()
        );
      }

      if(item.mode==='hybrid'){
        sp.push(
          '[AI + HTML 混合输出]\n' +
          '你可以输出正文反馈，也可以在正文后附加 HTML 面板。\n' +
          '如果输出 HTML，使用：\n' +
          '__html_payload__\n' +
          '<HTML或片段>\n' +
          '__end_html_payload__\n\n' +
          'HTML 用于界面展示，不要让 HTML 替代必要的正文反馈。\n\n' +
          '如果当前 HTML 是模板或状态面板，请严格沿用当前 HTML 的布局、CSS、类名、尺寸规格和结构。不要重写样式，不要改容器结构，不要换类名。只更新模板里需要变化的文本内容、数据项、标题、状态值或面板信息。'
        );
      }

      if(item.mode==='frontend_ai'){
        sp.push(
          '[前端驱动 AI 模拟器]\n' +
          '用户可能从 iframe 前端按钮里选择行动。按钮点击结果已经由前端填入输入框，并由用户确认发送。\n' +
          '你需要根据用户行动、玩法提示词、历史记录和当前 HTML 壳推进模拟器。\n\n' +
          '如果当前 HTML 壳需要更新，可以在正文后附加 __html_payload__ 保护块。\n' +
          '如果当前 HTML 壳自己会监听父页面回传结果，也可以只输出正文反馈，让前端壳通过 postMessage 自行处理。\n\n' +
          '如果输出新的 HTML，必须尽量沿用当前 HTML 壳的结构、类名、CSS 和脚本桥接逻辑，不要破坏 data-sim-action、cbyd21SimAction、postMessage 或用户已有交互。'
        );
      }

      var min=parseInt(item.wcMin,10)||300;
      var max=parseInt(item.wcMax,10)||700;

      sp.push('[字数控制]\n本次 AI 文本反馈建议在 '+min+' 到 '+max+' 字之间。HTML 代码不计入字数。');

      if(item.worldBookEnabled && typeof cbyd21_WorldBook !== 'undefined'){
        var fakeChat={
          messages:(item.messages||[]).map(function(m){
            return {
              role:m.role==='ai'?'ai':'user',
              content:m.content||''
            };
          })
        };

        var htmlForWorldBook = item.html
          ? String(item.html || '')
          : '';

        var wb=collectActiveWorldBook(fakeChat,false,[item.name||'',item.prompt||'',htmlForWorldBook]);

        if(wb.system_start&&wb.system_start.length){
          sp.unshift('[万象匣世界书最前]\n'+wb.system_start.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
        }

        if(wb.before_char&&wb.before_char.length){
          sp.push('[世界背景]\n'+wb.before_char.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
        }

        if(wb.after_char&&wb.after_char.length){
          sp.push('[世界书]\n'+wb.after_char.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
        }

        if(wb.system_end&&wb.system_end.length){
          sp.push('[强制指令]\n'+wb.system_end.map(function(w){return '['+w.name+']\n'+w.content}).join('\n\n'));
        }
      }

      if(item.breaker&&item.breaker.trim()){
        sp.push('[万象匣专用破限词]\n'+item.breaker.trim());
      }

      var msgs=(item.messages||[]).slice(-30).map(function(m){
        return {
          role:m.role==='ai'?'assistant':'user',
          content:String(m.content||'')
        };
      });

      if(msgs.length===0){
        msgs.push({
          role:'user',
          content:'[模拟器刚开始，请根据完整卡内容、玩法规则、HTML/面板内容和世界书生成开局反馈。]'
        });
      }

      return {
        url:apiConfig.url.replace(/\/+$/,'')+'/chat/completions',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+apiConfig.key
        },
        body:{
          model:apiConfig.model,
          temperature:apiConfig.temperature!==undefined?apiConfig.temperature:1,
          messages:[
            {
              role:'system',
              content:sp.join('\n\n---\n\n')
            }
          ].concat(msgs)
        }
      };
    },

    // extractHtmlFromReply(text)
    // → 从 AI 回复中提取 __html_payload__。
    // 返回 {text, html}，text 是去掉 HTML 保护块后的正文。
    extractHtmlFromReply:function(text){
      var s=String(text||'').trim();
      var html='';

      var m=s.match(/__html_payload__\s*([\s\S]*?)\s*__end_html_payload__/i);

      if(m){
        html=m[1].trim();
        s=s.replace(m[0],'').trim();
      }

      return {
        text:s,
        html:html
      };
    },

    // generate(item,userText)
    // → 调用 API 推进模拟器。
    // 成功后写入 AI 消息，并在混合 / 前端驱动模式中更新 iframe。
    generate:async function(item,userText){
      if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
        return;
      }

      this._generating=true;

      try{
        var req=this.buildRequest(item);
        this._abortController=new AbortController();

        var r=await fetch(req.url,{
          method:'POST',
          headers:req.headers,
          body:JSON.stringify(req.body),
          signal:this._abortController.signal
        });

        var raw=await r.text();

        if(!r.ok){
          throw new Error('HTTP '+r.status+': '+raw.slice(0,300));
        }

        var parsed=typeof _cbyd21ParseChatApiResponseText==='function'
          ? _cbyd21ParseChatApiResponseText(raw)
          : {data:null,text:raw};

        var reply=parsed.text || (
          typeof _cbyd21ExtractChatApiContent==='function'
            ? _cbyd21ExtractChatApiContent(parsed.data||{})
            : ''
        );

        reply=String(reply||'').trim();

        if(typeof _stripLeakedThinking==='function'){
          reply=_stripLeakedThinking(reply);
        }

        if(!reply)reply='（模拟器没有返回内容）';

        var ex=this.extractHtmlFromReply(reply);
        var finalText=ex.text || (ex.html?'界面已更新。':'（空）');

        if(item.regexEnabled && typeof applyRegexRules==='function'){
          finalText=applyRegexRules(finalText,'aiOutput');
        }

        finalText = String(finalText || '').trim() || '（空）';

        item.messages.push({
          role:'ai',
          content:finalText,
          time:formatTime(Date.now()),
          _ts:Date.now(),
          _html:ex.html||''
        });

        if(ex.html){
          item.html=ex.html;
          this.mountHtml(item);
        }

        item.updatedAt=Date.now();
        this.save();
        this.renderRun(item);
        this.postResultToFrame(item,finalText,ex.html||'');

        showToast('万象匣已推进');
      }catch(e){
        if(e&&e.name==='AbortError'){
          showToast('已终止生成');
        }else if(typeof showApiError==='function'){
          showApiError(e.message||'万象匣生成失败');
        }else{
          showToast(e.message||'生成失败');
        }
      }

      this._abortController=null;
      this._generating=false;
    },

    // reroll()
    // → 重 roll AI 模式最后一轮。
    // 纯 HTML 模式没有 AI 历史重 roll，所以隐藏按钮。
    reroll:async function(){
      var item=this.getById(this._currentId);

      if(!item||item.mode==='html')return;

      if(this._generating){
        if(this._abortController){
          this._abortController.abort();
        }
        return;
      }

      if(!Array.isArray(item.messages)||item.messages.length===0){
        showToast('没有可重 roll 的内容');
        return;
      }

      while(item.messages.length>0&&item.messages[item.messages.length-1].role==='ai'){
        item.messages.pop();
      }

      var lastUser=null;

      for(var i=item.messages.length-1;i>=0;i--){
        if(item.messages[i].role==='user'){
          lastUser=item.messages[i];
          break;
        }
      }

      if(!lastUser){
        showToast('没有上一条行动');
        return;
      }

      this.save();
      this.renderRun(item);
      await this.generate(item,lastUser.content);
    },

    // refreshFrame()
    // → 刷新当前 iframe 前端。
    refreshFrame:function(){
      var item=this.getById(this._currentId);

      if(!item)return;

      this.mountHtml(item);
      showToast('前端已刷新');
    },

    // autoResizeInput(el)
    // → 运行页输入框自动高度。
    autoResizeInput:function(el){
      if(!el)return;

      el.style.height='38px';
      el.style.height=Math.min(el.scrollHeight,110)+'px';
      el.style.overflowY=el.scrollHeight>110?'auto':'hidden';
    }
  };

  function boot(){
    cbyd21_SimulatorGame.load();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot);
  }else{
    boot();
  }
})();
