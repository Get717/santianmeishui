// ===== 【模块】cbyd21_UnderMode — 皮下模式 =====
// 用户侧名称：皮下模式
// 内部为了兼容旧数据，仍沿用 _oocMode / _oocInstructions 字段。
// 皮下模式开启后：
// · 用户不用括号，带括号也兼容
// · 普通皮下聊天只在皮下模式内作为上下文
// · 只有“后续要求：”或“具体要求：”会保存为恢复普通聊天后的持续要求
// · 查看/清空/删除要求由前端本地处理，不调用 API

(function(){
  if(window.cbyd21_UnderMode)return;

  window.cbyd21_UnderMode = {
    _installed:false,

    // init()
    // → 初始化皮下模式模块。
    // 负责插入顶栏状态条、同步按钮、覆盖皮下专用请求、绑定页面/分支切换同步。
    init:function(){
      this.ensureTopBar();
      this.syncButton();
      this.patchChatOocRequest();
      this.patchGroupOocRequest();
      this.patchNavigationSync();
      this._installed=true;
    },

    isGroupMode:function(){
      var view=document.getElementById('chatView');
      return !!(view && view.dataset.groupMode === 'true' && typeof cbyd21_Group !== 'undefined');
    },

    // getTarget()
    // → 获取当前皮下模式对应的数据目标。
    // · 单聊：当前聊天分支 chat
    // · 群聊：当前群聊分支 branch
    // · 如果聊天页没有打开，返回 null，避免退出聊天后状态条读取旧分支
    getTarget:function(){
      try{
        var view=document.getElementById('chatView');

        if(!view || !view.classList.contains('active')){
          return null;
        }

        if(this.isGroupMode() && cbyd21_Group._getCurrentBranch){
          return cbyd21_Group._getCurrentBranch();
        }

        if(typeof getCurrentChat === 'function'){
          return getCurrentChat();
        }
      }catch(e){}

      return null;
    },

    saveTarget:function(){
      try{
        if(this.isGroupMode()){
          if(typeof cbyd21_Group !== 'undefined' && cbyd21_Group._save)cbyd21_Group._save();
          return;
        }

        if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.saveChats)cbyd21_Data.saveChats();
      }catch(e){}
    },

    // isOn()
    // → 判断当前可见聊天分支是否处于皮下模式。
    // 不在聊天页时一律视为关闭，避免状态条残留。
    isOn:function(){
      var target=this.getTarget();
      return !!(target && target._oocMode && target._oocMode.enabled);
    },

    setOn:function(on){
      on=!!on;

      var target=this.getTarget();
      if(!target)return;

      if(!target._oocMode)target._oocMode={};
      target._oocMode.enabled=on;
      target._oocMode.updatedAt=Date.now();

      this.saveTarget();
    },

    toggle:function(force){
      var on = force === false ? false : !this.isOn();

      // 当前分支已有专用生成状态时，不再开启另一个专用调试入口。
      // 允许 force=false 正常关闭当前入口。
      if(on && window.cbyd21_InlineOffline && cbyd21_InlineOffline.isEnabledForCurrentChat && cbyd21_InlineOffline.isEnabledForCurrentChat()){
        showToast('当前分支正在使用专用生成模式，暂不能开启皮下模式');
        return;
      }

      this.setOn(on);
      this.syncButton();

      var pp=document.getElementById('plusPanel');
      if(pp)pp.classList.remove('active');

      if(on){
        showToast('皮下模式已开启');
        this.openHelp(false);
      }else{
        showToast('皮下模式已关闭，已恢复角色聊天');
      }
    },

    ensureTopBar:function(){
      var old=document.getElementById('underModeTopBar');
      if(old)return old;

      var header=document.getElementById('chatHeader');
      if(!header || !header.parentNode)return null;

      var bar=document.createElement('div');
      bar.className='under-mode-top-bar';
      bar.id='underModeTopBar';
      bar.innerHTML =
        '<span class="under-mode-top-title">皮下模式中</span>' +
        '<span class="under-mode-top-desc">不会进行角色扮演</span>' +
        '<div class="under-mode-top-actions">' +
          '<button class="under-mode-top-action" onclick="cbyd21_UnderMode.openRequirements()">查看要求</button>' +
          '<button class="under-mode-top-action" onclick="cbyd21_UnderMode.openHelp(true)">说明</button>' +
          '<button class="under-mode-top-action" onclick="cbyd21_UnderMode.toggle(false)">退出</button>' +
        '</div>';

      header.parentNode.insertBefore(bar, header.nextSibling);

      return bar;
    },

    syncButton:function(){
      var item=document.getElementById('oocModePlusItem');
      var label=document.getElementById('oocModePlusLabel');
      var on=this.isOn();

      if(label)label.textContent=on?'退出皮下':'皮下';

      if(item){
        item.style.background=on?'rgba(124,111,155,0.16)':'';
        item.style.borderRadius=on?'10px':'';
      }

      var bar=this.ensureTopBar();
      if(bar)bar.classList.toggle('active',on);
    },

    stripOuterWrap:function(text){
      var s=String(text||'').trim();

      var pairs=[
        ['(',')'],
        ['（','）'],
        ['[',']'],
        ['【','】'],
        ['〔','〕'],
        ['「','」'],
        ['『','』'],
        ['《','》'],
        ['〈','〉'],
        ['﹙','﹚'],
        ['﹝','﹞'],
        ['｛','｝'],
        ['{','}'],
        ['﹛','﹜'],
        ['［','］'],
        ['｟','｠'],
        ['⟦','⟧'],
        ['⟨','⟩']
      ];

      var changed=true;

      while(changed && s.length>=2){
        changed=false;

        for(var i=0;i<pairs.length;i++){
          var a=pairs[i][0];
          var b=pairs[i][1];

          if(s.indexOf(a)===0 && s.lastIndexOf(b)===s.length-b.length){
            s=s.slice(a.length,s.length-b.length).trim();
            changed=true;
            break;
          }
        }
      }

      return s;
    },

    parseCommand:function(text){
      var raw=String(text||'').trim();
      var s=this.stripOuterWrap(raw);

      if(!s)return {type:'',value:'',raw:raw};

      var saveMatch=s.match(/^(后续要求|具体要求)\s*[:：]\s*([\s\S]*)$/);
      if(saveMatch){
        return {
          type:'save',
          key:saveMatch[1],
          value:String(saveMatch[2]||'').trim(),
          raw:raw
        };
      }

      if(/^(查看要求|查看后续要求)\s*[:：]\s*$/.test(s)){
        return {type:'view',value:'',raw:raw};
      }

      if(/^(清空要求|清空后续要求)\s*[:：]\s*$/.test(s)){
        return {type:'clear',value:'',raw:raw};
      }

      var del=s.match(/^(删除要求|删除后续要求)\s*[:：]\s*([0-9\s,，、]+)$/);
      if(del){
        return {
          type:'delete',
          value:String(del[2]||'').trim(),
          raw:raw
        };
      }

      return {type:'',value:'',raw:raw};
    },

    addInstruction:function(target,content,sourceText){
      if(!target)return null;

      content=String(content||'').trim();
      if(!content)return null;

      if(!Array.isArray(target._oocInstructions)){
        target._oocInstructions=[];
      }

      var item={
        id:'under_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        content:content,
        sourceText:String(sourceText||'').trim(),
        createdAt:Date.now()
      };

      target._oocInstructions.push(item);
      target._oocInstructions=target._oocInstructions.slice(-30);

      this.saveTarget();

      return item;
    },

    handleInput:function(target,text){
      var raw=String(text||'').trim();

      var result={
        handled:false,
        notices:[],
        openPanel:false,
        hasNormalText:false
      };

      if(!target || !raw)return result;

      var stripped=this.stripOuterWrap(raw);
      var whole=this.parseCommand(stripped);

      // 整条消息是多行后续要求块：
      // 后续要求：
      // 1. ...
      // 2. ...
      if(
        whole.type==='save' &&
        !whole.value &&
        /\r?\n/.test(stripped)
      ){
        var firstLineEnd=stripped.search(/\r?\n/);
        var rest=stripped.slice(firstLineEnd).trim();

        if(rest){
          if(this.addInstruction(target,rest,raw)){
            result.handled=true;
            result.notices.push('（已保存为后续要求。这个操作由前端本地处理，不调用 API；退出皮下后会继续生效。）');
          }

          return result;
        }
      }

      var lines=raw.split(/\r?\n/);
      var normalLines=[];

      for(var i=0;i<lines.length;i++){
        var line=String(lines[i]||'').trim();
        if(!line)continue;

        var cmd=this.parseCommand(line);

        if(cmd.type==='save'){
          if(cmd.value){
            if(this.addInstruction(target,cmd.value,line)){
              result.handled=true;
              result.notices.push('（已保存为后续要求。这个操作由前端本地处理，不调用 API；退出皮下后会继续生效。）');
            }
          }else{
            normalLines.push(line);
          }

          continue;
        }

        if(cmd.type==='view'){
          result.handled=true;
          result.openPanel=true;
          result.notices.push('（已打开当前后续要求。）');
          continue;
        }

        if(cmd.type==='clear'){
          target._oocInstructions=[];
          this.saveTarget();
          result.handled=true;
          result.notices.push('（已清空当前分支的全部后续要求。）');
          continue;
        }

        if(cmd.type==='delete'){
          var nums=cmd.value.split(/[,\s，、]+/).map(function(n){
            return parseInt(n,10);
          }).filter(function(n){
            return isFinite(n)&&n>0;
          });

          if(nums.length>0 && Array.isArray(target._oocInstructions)){
            var before=target._oocInstructions.length;
            var map={};

            nums.forEach(function(n){map[n]=true});

            target._oocInstructions=target._oocInstructions.filter(function(item,idx){
              return !map[idx+1];
            });

            var removed=before-target._oocInstructions.length;

            this.saveTarget();
            result.handled=true;
            result.notices.push(removed>0?'（已删除 '+removed+' 条后续要求。）':'（没有找到对应编号的后续要求。）');
          }else{
            result.handled=true;
            result.notices.push('（请输入要删除的要求编号，例如：删除要求：2）');
          }

          continue;
        }

        normalLines.push(line);
      }

      result.hasNormalText=normalLines.join('\n').trim().length>0;

      return result;
    },

    appendLocalNotice:function(target,text){
      if(!target || !text)return;

      if(!Array.isArray(target.messages))target.messages=[];

      var msg={
        role:'ai',
        content:text,
        time:formatTime(Date.now()),
        _ts:Date.now(),
        _mode:'ooc',
        _underLocalNotice:true
      };

      if(this.isGroupMode()){
        var group=typeof cbyd21_Group!=='undefined' && cbyd21_Group._getCurrentGroup
          ? cbyd21_Group._getCurrentGroup()
          : null;

        if(group && group.memberIds && group.memberIds[0]){
          msg._charId=group.memberIds[0];
        }

        // 群聊皮下本地提示：
        // 写入当前群聊分支消息数组，并立刻保存到 group.branches[currentBranch].messages。
        // 这样切分支 / 刷新 / 导出时不会丢失皮下本地提示。
        cbyd21_Group._messages.push(msg);
        cbyd21_Group._appendGroupMsgDOM(msg,cbyd21_Group._messages.length-1);
        cbyd21_Group._save();
      }else{
        target.messages.push(msg);
        cbyd21_Chat.appendMessageDOM('ai',msg.content,msg.time,true,target.messages.length-1);
        cbyd21_Data.saveChats();
      }

      if(typeof scrollToBottom==='function')scrollToBottom();
    },

    formatInstructions:function(list){
      if(!Array.isArray(list)||list.length===0)return '';

      var lines=list.map(function(item,idx){
        var text=item&&item.content?String(item.content).trim():'';
        if(!text)return '';
        return (idx+1)+'. '+text;
      }).filter(Boolean);

      if(lines.length===0)return '';

      return (
        '[用户在皮下模式中保存的后续执行要求]\n' +
        '以下内容来自用户显式开启的皮下模式，并且用户明确要求它们在退出皮下后继续生效。\n' +
        '这些内容不是普通聊天内容，角色本人没有在剧情内听见这些话。\n' +
        '它们只用于调整后续输出方式、格式偏好、互动规则或创作方向。\n' +
        '执行时仍必须遵守角色卡、世界书、当前功能模式边界、对用户的尊重底线和所有前端功能格式规则。\n\n' +
        lines.join('\n')
      );
    },

    openHelp:function(force){
      if(!force && localStorage.getItem('stm_underModeHelpDismissed')==='1')return;

      var container=document.getElementById('addCharList');
      if(!container)return;

      container.innerHTML =
        '<div style="padding:18px 18px 14px;font-size:13px;color:var(--text-secondary);line-height:1.75">' +
          '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:8px">皮下模式已开启</div>' +
          '<div style="padding:12px;background:rgba(124,111,155,0.10);border:1px solid rgba(124,111,155,0.22);border-radius:12px;margin-bottom:12px">' +
            '这里是和 AI 沟通设置的地方，不进行角色扮演。' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-secondary);line-height:1.8;margin-bottom:12px">' +
            '普通皮下聊天只在皮下模式内生效。<br>' +
            '下面这些管理指令由前端直接处理，不调用 API。<br>' +
            '要让设置退出皮下后继续生效，请输入：<br><br>' +
            '<span class="under-mode-code">后续要求：你的要求</span><br>' +
            '<span class="under-mode-code">具体要求：你的要求</span><br><br>' +
            '管理要求：<br>' +
            '<span class="under-mode-code">查看要求：</span><br>' +
            '<span class="under-mode-code">清空要求：</span><br>' +
            '<span class="under-mode-code">删除要求：编号</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);line-height:1.6;margin-bottom:12px">' +
            '中文冒号和英文冒号都可以。习惯加括号也可以。<br>' +
            '如果要让皮下模式多读一点普通聊天背景，可在「查看要求」里调整读取轮数。' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:12px;cursor:pointer">' +
            '<input type="checkbox" id="underModeHelpDontShow" style="accent-color:var(--accent)">' +
            '<span>以后开启皮下时不再自动提示</span>' +
          '</label>' +
          '<button class="btn primary" onclick="cbyd21_UnderMode.closeHelp()" style="width:100%">我知道了</button>' +
        '</div>';

      document.getElementById('addCharModal').querySelector('h3').textContent='皮下模式说明';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    closeHelp:function(){
      var cb=document.getElementById('underModeHelpDontShow');
      if(cb&&cb.checked)localStorage.setItem('stm_underModeHelpDismissed','1');
      closeModal('addCharModal');
    },

    openRequirements:function(){
      var target=this.getTarget();
      var list=target&&Array.isArray(target._oocInstructions)?target._oocInstructions:[];
      var container=document.getElementById('addCharList');
      if(!container)return;

      var html='<div style="padding:16px;font-size:13px;color:var(--text-secondary);line-height:1.7">';
      var contextRounds = this.getContextRounds(target);

      html+='<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">这些要求会在退出皮下、恢复普通聊天后持续注入当前分支。</div>';

      html+=
        '<div style="background:var(--bg-tertiary);border:1px solid var(--border-soft);border-radius:10px;padding:10px 12px;margin-bottom:12px">' +
          '<div style="font-size:12px;color:var(--text-primary);font-weight:600;margin-bottom:6px">皮下读取普通聊天背景</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:11px;color:var(--text-muted);flex-shrink:0">最近</span>' +
            '<input class="form-input" id="underModeContextRoundsInput" type="number" min="0" max="200" value="'+contextRounds+'" style="width:70px;text-align:center;font-size:12px;padding:6px 8px">' +
            '<span style="font-size:11px;color:var(--text-muted);flex-shrink:0">轮</span>' +
            '<button class="btn-sm primary" onclick="cbyd21_UnderMode.saveContextRoundsFromPanel()" style="margin-left:auto;padding:6px 10px;font-size:11px">保存</button>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--text-muted);line-height:1.6;margin-top:6px">用于皮下模式理解刚才的普通聊天上下文。0 = 尽量读取更多，最多最近240条普通消息；默认 20 轮。</div>' +
        '</div>';

      if(list.length===0){
        html+='<div style="text-align:center;padding:28px 8px;color:var(--text-muted);font-size:12px">当前没有保存后续要求</div>';
      }else{
        list.forEach(function(item,idx){
          html+=
            '<div class="under-mode-requirement-card">' +
              '<div class="under-mode-requirement-row">' +
                '<div class="under-mode-requirement-index">'+(idx+1)+'.</div>' +
                '<div class="under-mode-requirement-content">'+escHtml(item.content||'')+'</div>' +
                '<button class="btn-sm danger" onclick="cbyd21_UnderMode.deleteRequirement('+idx+')" style="padding:4px 8px;font-size:10px;flex-shrink:0">删除</button>' +
              '</div>' +
            '</div>';
        });
      }

      html+=
        '<div style="display:flex;gap:8px;margin-top:12px">' +
          '<button class="btn" onclick="closeModal(\'addCharModal\')" style="flex:1">关闭</button>' +
          '<button class="btn danger" onclick="cbyd21_UnderMode.clearRequirementsFromPanel()" style="flex:1">清空全部</button>' +
        '</div>';

      html+='</div>';

      container.innerHTML=html;
      document.getElementById('addCharModal').querySelector('h3').textContent='当前后续要求';
      document.getElementById('addCharModal').classList.add('centered');
      openModal('addCharModal');
    },

    deleteRequirement:function(idx){
      var target=this.getTarget();
      if(!target || !Array.isArray(target._oocInstructions)){
        showToast('没有可删除的要求');
        return;
      }

      idx=parseInt(idx,10);
      if(idx<0 || idx>=target._oocInstructions.length){
        showToast('找不到这条要求');
        return;
      }

      target._oocInstructions.splice(idx,1);
      this.saveTarget();
      this.openRequirements();
      showToast('已删除后续要求');
    },

    clearRequirementsFromPanel:async function(){
      var target=this.getTarget();
      if(!target)return;

      var yes=await customConfirm('确认清空当前分支的全部后续要求？');
      if(!yes)return;

      target._oocInstructions=[];
      this.saveTarget();
      this.openRequirements();
      showToast('已清空后续要求');
    },

    // patchNavigationSync()
    // → 给聊天页和群聊页的进入 / 退出 / 切分支行为补同步。
    // 目的：
    // · 单聊切分支后刷新“皮下模式中”状态条
    // · 群聊切分支后刷新“皮下模式中”状态条
    // · 退出聊天后隐藏状态条
    // · 避免状态条和实际分支状态不一致
    patchNavigationSync:function(){
      if(this._navPatched)return;
      this._navPatched=true;

      var self=this;

      function syncSoon(){
        setTimeout(function(){
          try{
            self.syncButton();
          }catch(e){}
        },60);
      }

      if(typeof window.enterChatView === 'function' && !window.enterChatView._underModePatched){
        var oldEnterChatView = window.enterChatView;

        window.enterChatView = async function(){
          var ret = oldEnterChatView.apply(this, arguments);

          try{
            if(ret && ret.then){
              ret.then(syncSoon).catch(syncSoon);
            }else{
              syncSoon();
            }
          }catch(e){
            syncSoon();
          }

          return ret;
        };

        window.enterChatView._underModePatched=true;
      }

      if(typeof window.exitChatView === 'function' && !window.exitChatView._underModePatched){
        var oldExitChatView = window.exitChatView;

        window.exitChatView = function(){
          var ret = oldExitChatView.apply(this, arguments);
          syncSoon();
          return ret;
        };

        window.exitChatView._underModePatched=true;
      }

      if(window.cbyd21_Chat && cbyd21_Chat.switchBranch && !cbyd21_Chat.switchBranch._underModePatched){
        var oldSwitchBranch = cbyd21_Chat.switchBranch;

        cbyd21_Chat.switchBranch = function(){
          var ret = oldSwitchBranch.apply(this, arguments);
          syncSoon();
          return ret;
        };

        cbyd21_Chat.switchBranch._underModePatched=true;
      }

      if(window.cbyd21_Group){
        if(cbyd21_Group.enterGroupChat && !cbyd21_Group.enterGroupChat._underModePatched){
          var oldEnterGroupChat = cbyd21_Group.enterGroupChat;

          cbyd21_Group.enterGroupChat = function(){
            var ret = oldEnterGroupChat.apply(this, arguments);
            syncSoon();
            return ret;
          };

          cbyd21_Group.enterGroupChat._underModePatched=true;
        }

        if(cbyd21_Group.exitGroupChat && !cbyd21_Group.exitGroupChat._underModePatched){
          var oldExitGroupChat = cbyd21_Group.exitGroupChat;

          cbyd21_Group.exitGroupChat = function(){
            var ret = oldExitGroupChat.apply(this, arguments);
            syncSoon();
            return ret;
          };

          cbyd21_Group.exitGroupChat._underModePatched=true;
        }

        if(cbyd21_Group._switchGroupBranch && !cbyd21_Group._switchGroupBranch._underModePatched){
          var oldSwitchGroupBranch = cbyd21_Group._switchGroupBranch;

          cbyd21_Group._switchGroupBranch = function(){
            var ret = oldSwitchGroupBranch.apply(this, arguments);
            syncSoon();
            return ret;
          };

          cbyd21_Group._switchGroupBranch._underModePatched=true;
        }
      }

      var chatView=document.getElementById('chatView');

      if(chatView && typeof MutationObserver !== 'undefined'){
        var observer = new MutationObserver(function(){
          syncSoon();
        });

        observer.observe(chatView,{
          attributes:true,
          attributeFilter:['class','data-group-mode']
        });
      }
    },

    // getContextRounds(target)
    // → 读取当前皮下模式的“普通聊天背景轮数”。
    // 说明：
    // · 皮下模式内会读取普通聊天背景，方便用户和 AI 讨论“刚才哪里不对”。
    // · 但不能无限读取，否则皮下上下文会过大。
    // · 默认 20 轮；0 = 尽量读取更多，但最终最多保留最近 240 条普通消息；最大 200 轮。
    getContextRounds:function(target){
      var raw = target && target._oocMode ? target._oocMode.contextRounds : undefined;
      var n = parseInt(raw,10);

      if(isNaN(n))n = 20;

      n = Math.max(0, Math.min(200, n));

      return n;
    },

    // setContextRounds(target,value)
    // → 保存当前分支的皮下普通聊天背景轮数。
    // 保存目标：
    // · 单聊：chat._oocMode.contextRounds
    // · 群聊：branch._oocMode.contextRounds
    setContextRounds:function(target,value){
      if(!target)return;

      var n = parseInt(value,10);

      if(isNaN(n))n = 20;

      n = Math.max(0, Math.min(200, n));

      if(!target._oocMode)target._oocMode = {};
      target._oocMode.contextRounds = n;
      target._oocMode.updatedAt = Date.now();

      this.saveTarget();

      return n;
    },

    // limitNormalBackgroundForTarget(target,normalBackground)
    // → 裁剪皮下模式读取的普通聊天背景。
    // 裁剪单位是“用户轮数”，和普通聊天上下文轮数逻辑接近：
    // · 从后往前数用户消息
    // · 保留最近 N 轮用户消息及其间的 AI 消息
    // · N=0 时不裁剪
    limitNormalBackgroundForTarget:function(target,normalBackground){
      normalBackground = Array.isArray(normalBackground) ? normalBackground : [];

      var rounds = this.getContextRounds(target);

      // rounds <= 0 表示“尽量全部读取”。
      // 但皮下模式只是设置沟通，不应该无限塞入全部历史。
      // 这里给一个安全上限，避免超长聊天导致皮下请求爆上下文。
      if(rounds <= 0)return normalBackground.slice(-240);

      var userCount = 0;
      var startIdx = 0;

      for(var i = normalBackground.length - 1; i >= 0; i--){
        if(normalBackground[i] && normalBackground[i].role === 'user'){
          userCount++;

          if(userCount > rounds){
            startIdx = i + 1;
            break;
          }
        }
      }

      return normalBackground.slice(startIdx);
    },

    // saveContextRoundsFromPanel()
    // → 从“当前后续要求”面板保存皮下普通聊天背景轮数。
    // 这个操作不调用 API，只更新当前聊天/群聊分支设置。
    saveContextRoundsFromPanel:function(){
      var target = this.getTarget();

      if(!target){
        showToast('请先进入聊天');
        return;
      }

      var input = document.getElementById('underModeContextRoundsInput');
      var n = this.setContextRounds(target, input ? input.value : 20);

      if(input)input.value = n;

      showToast(n === 0 ? '皮下背景已设为尽量多读，最多最近240条普通消息' : '皮下背景轮数已保存：' + n + '轮');
    },

    // cleanNormalBackgroundContent(c, role)
    // → 皮下模式读取普通聊天背景时的轻量清理。
    // 目的：
    // · 让皮下 AI 能理解普通聊天发生了什么；
    // · 不把转账 JSON、通话 JSON、图片引用、HTML 大段源码等原样塞进皮下上下文；
    // · 避免普通聊天背景把皮下上下文撑爆。
    cleanNormalBackgroundContent:function(c, role){
      c = String(c || '').trim();

      if(!c)return '';

      if(typeof _cbyd21MessageContentForUserAction === 'function'){
        c = _cbyd21MessageContentForUserAction(c);
      }

      if(typeof _stripLeakedThinking === 'function'){
        c = _stripLeakedThinking(c);
      }

      c = String(c || '').trim();

      if(!c)return '';

      if(c.startsWith('__voice__')){
        return '[语音] ' + c.slice(9).replace(/__bilingual_split__[\s\S]*/,'').slice(0,120);
      }

      if(c.startsWith('__fakeimg__')){
        return '[图片描述] ' + c.slice(11).slice(0,120);
      }

      if(c.startsWith('__realimg__')){
        return '[真实图片]';
      }

      if(c.startsWith('__sticker__')){
        return '[表情包]';
      }

      if(c.startsWith('__transfer__')){
        try{
          var d = JSON.parse(c.slice(12));
          var amount = isFinite(Number(d.amount)) ? Number(d.amount).toFixed(2) : '?';
          var note = d.note ? '，备注：' + String(d.note).slice(0,60) : '';
          return '[转账 ¥' + amount + note + ']';
        }catch(e){
          return '[转账]';
        }
      }

      if(c.startsWith('__call__')){
        try{
          var call = JSON.parse(c.slice(8));
          var duration = call.duration || 0;
          var min = Math.floor(duration / 60);
          var msgCount = call.messages && call.messages.length || 0;
          return '[通话记录：' + min + '分钟，' + msgCount + '条通话消息]';
        }catch(e){
          return '[通话记录]';
        }
      }

      if(c.startsWith('__offline_record__')){
        return '[线下见面记录]';
      }

      if(c.startsWith('__location__')){
        try{
          var loc = JSON.parse(c.slice(12));
          return '[定位：' + (loc.name || '未知地点') + ']';
        }catch(e){
          return '[定位]';
        }
      }

      if(c.startsWith('__share_location__'))return '[用户发起或更新了共享位置]';
      if(c.startsWith('__share_response__'))return '[角色共享或更新了位置]';
      if(c.startsWith('__share_invite__'))return '[角色发起共享位置邀请]';
      if(c.startsWith('__share_ignore__'))return '[用户没有回应共享位置邀请]';
      if(c.startsWith('__share_reject__'))return '[用户拒绝共享位置邀请]';
      if(c.startsWith('__share_end__'))return '[共享位置已结束]';

      if(c.startsWith('__offline_invite__')){
        try{
          var oi = JSON.parse(c.slice(18));
          return '[线下邀请：' + String(oi.msg || oi.scene || '邀请见面').slice(0,120) + ']';
        }catch(e){
          return '[线下邀请]';
        }
      }

      if(typeof _looksLikeHtmlPayload === 'function' && _looksLikeHtmlPayload(c)){
        return '[HTML / 前端代码内容]';
      }

      c = c
        .replace(/__inner_voice__[\s\S]*/g,'')
        .replace(/__bilingual_split__/g,' / ')
        .replace(/__bl_json__[\s\S]*/g,'')
        .replace(/__bl_sep__/g,'')
        .trim();

      return c.slice(0,300);
    },

    patchChatOocRequest:function(){
      if(!window.cbyd21_Chat)return;

      cbyd21_Chat.buildOocRequest = async function(chat){
        if(typeof _cbyd21PromptsLoaded !== 'undefined' && !_cbyd21PromptsLoaded){
          if(typeof _cbyd21BlockApiIfPromptsLoading === 'function')_cbyd21BlockApiIfPromptsLoading();

          var err=new Error('PromptLoadingBlocked: 提示词正在加载，请稍等…');
          err.name='PromptLoadingBlocked';
          err._cbyd21PromptLoadingBlocked=true;
          throw err;
        }

        var ch=typeof getChatChar==='function'?getChatChar():null;
        var up=typeof getCurrentProfile==='function'?getCurrentProfile():null;

        var sys=[
          '[皮下设置沟通模式]',
          '当前是用户通过前端开关显式开启的皮下模式。',
          '你现在以 AI 本体和用户沟通，不扮演角色，不推进剧情，不输出角色聊天消息。',
          '皮下模式开启期间，直到用户通过前端开关关闭前，都保持皮下模式，不自动恢复角色。',
          '用户在皮下模式中不需要使用括号；用户带不带括号都按皮下沟通处理。',
          '回复用括号包裹，语气简洁、直接、清楚。',
          '你可以和用户讨论提示词、角色卡、输出方式、格式规则、创作方向、调试问题、设定修改和交互规则。',
          '你必须认真听用户要求，准确理解用户想调整什么，并用尊重、礼貌、珍重用户的态度回应。',
          '不要嘲讽用户，不要居高临下，不要把用户的困惑或修改需求当成麻烦。',
          '皮下内容不是剧情内事件，角色本人不会在剧情里听见或记住这些话。',
          '普通皮下聊天只在皮下模式内作为上下文使用，不会自动影响恢复后的普通聊天。',
          '如果用户希望某条设置在关闭皮下、恢复普通聊天后继续生效，请提醒用户使用“后续要求：具体要求”或“具体要求：具体要求”。只有这种明确格式会被前端保存并注入普通聊天。'
        ];

        if(ch){
          sys.push('\n[当前关联角色]');
          sys.push('角色名：'+(ch.name||'角色'));
          sys.push('这里只用于让你知道用户正在调试或讨论哪个角色，不代表你现在要扮演这个角色。');
        }

        if(up){
          sys.push('\n[用户]');
          sys.push('用户名称：'+(up.name||'用户'));
        }

        var normalBackground=[];
        var underHistory=[];

        (chat.messages||[]).filter(function(m){
          return m && m.content !== '__system_init__' && m.content !== '__system_continue__';
        }).forEach(function(m){
          var c=m.content||'';

          c = cbyd21_UnderMode.cleanNormalBackgroundContent(c, m.role);

          if(!c)return;

          if(m._mode === 'ooc'){
            underHistory.push({
              role:m.role === 'ai' ? 'assistant' : 'user',
              content:c
            });
          }else{
            normalBackground.push({
              role:m.role === 'ai' ? 'assistant' : 'user',
              content:c
            });
          }
        });

        // 皮下模式读取普通聊天背景：
        // · 不读取全部皮下闲聊进普通聊天；
        // · 但在皮下模式内部，需要能看到最近普通聊天，方便用户讨论刚才的问题。
        // · 读取轮数由当前分支 _oocMode.contextRounds 控制。
        normalBackground = cbyd21_UnderMode.limitNormalBackgroundForTarget(chat, normalBackground);
        underHistory=underHistory.slice(-30);

        var msgs=[];

        if(normalBackground.length>0){
          msgs.push({
            role:'user',
            content:
              '[普通聊天背景摘要]\n' +
              '下面是进入皮下前后近期普通聊天背景，只用于帮助你知道用户正在调试哪个角色和什么上下文。不要把这些内容当成当前皮下用户指令。\n\n' +
              normalBackground.map(function(m){
                return (m.role==='assistant'?'角色':'用户')+'：'+m.content;
              }).join('\n')
          });
        }

        msgs=msgs.concat(underHistory);

        if(msgs.length===0){
          msgs.push({
            role:'user',
            content:'用户已开启皮下模式，但还没有输入具体问题。请简短说明已经进入皮下模式；用户可以直接说要调整什么，不需要使用括号。'
          });
        }

        var url=apiConfig.url.replace(/\/+$/,'')+'/chat/completions';
        var headers={
          'Content-Type':'application/json',
          'Authorization':'Bearer '+apiConfig.key
        };

        var body={
          model:apiConfig.model,
          messages:[{role:'system',content:sys.join('\n')}].concat(msgs)
        };

        if(apiConfig.temperature!==undefined)body.temperature=apiConfig.temperature;

        return {
          url:url,
          headers:headers,
          body:body,
          pendingVisionImages:[]
        };
      };
    },

    patchGroupOocRequest:function(){
      if(!window.cbyd21_Group)return;

      cbyd21_Group._buildGroupOocRequest = function(group){
        var up=getCurrentProfile();
        var memberNames=group&&group.memberIds
          ? group.memberIds.map(function(mid){
              var ch=getCharById(mid);
              return ch?ch.name:null;
            }).filter(Boolean).join('、')
          : '';

        var sys =
          '[群聊皮下设置沟通模式]\n' +
          '当前是用户通过前端开关显式开启的群聊皮下模式。\n' +
          '你现在以 AI 本体和用户沟通，不扮演群聊成员，不输出群成员消息，不推进群聊剧情。\n' +
          '皮下模式开启期间，直到用户通过前端开关关闭前，都保持皮下模式，不自动恢复群聊。\n' +
          '用户在皮下模式中不需要使用括号；用户带不带括号都按皮下沟通处理。\n' +
          '回复用括号包裹，语气简洁、直接、清楚。\n' +
          '你可以和用户讨论群聊提示词、群成员设定、输出方式、格式规则、创作方向、调试问题、设定修改和交互规则。\n' +
          '你必须认真听用户要求，准确理解用户想调整什么，并用尊重、礼貌、珍重用户的态度回应。\n' +
          '不要嘲讽用户，不要居高临下，不要把用户的困惑或修改需求当成麻烦。\n' +
          '皮下内容不是群聊内事件，群成员不会在剧情里听见或记住这些话。\n' +
          '普通皮下聊天只在皮下模式内作为上下文使用，不会自动影响恢复后的普通群聊。\n' +
          '如果用户希望某条设置在关闭皮下、恢复普通群聊后继续生效，请提醒用户使用“后续要求：具体要求”或“具体要求：具体要求”。只有这种明确格式会被前端保存并注入普通群聊。\n\n' +
          '当前群聊成员：'+(memberNames||'未知')+'\n' +
          '用户名称：'+((up&&up.name)||'用户')+'\n' +
          '这些信息只用于让你知道用户正在调试或讨论哪个群聊，不代表你现在要扮演这些成员。';

        var normalBackground=[];
        var underHistory=[];

        (this._messages||[]).filter(function(m){
          return m && m.content !== '__system_init__' && m.content !== '__system_continue__';
        }).forEach(function(m){
          var c=m.content||'';

          c = cbyd21_UnderMode.cleanNormalBackgroundContent(c, m.role);

          if(!c)return;

          if(m.role==='ai' && m._charId){
            var ch=getCharById(m._charId);
            c='「'+(ch?ch.name:'群成员')+'」：'+c;
          }else if(m.role==='user'){
            c='「'+((up&&up.name)||'用户')+'」：'+c;
          }

          if(m._mode==='ooc'){
            underHistory.push({
              role:m.role==='ai'?'assistant':'user',
              content:c
            });
          }else{
            normalBackground.push({
              role:m.role==='ai'?'assistant':'user',
              content:c
            });
          }
        });

        // 群聊皮下模式读取普通群聊背景：
        // · 只在皮下模式内部使用；
        // · 普通群聊恢复后不会读取皮下闲聊；
        // · 读取轮数由当前群聊分支 _oocMode.contextRounds 控制。
        var branchForContext = cbyd21_Group._getCurrentBranch ? cbyd21_Group._getCurrentBranch() : null;
        normalBackground = cbyd21_UnderMode.limitNormalBackgroundForTarget(branchForContext, normalBackground);
        underHistory=underHistory.slice(-30);

        var msgs=[];

        if(normalBackground.length>0){
          msgs.push({
            role:'user',
            content:
              '[普通群聊背景摘要]\n' +
              '下面是进入皮下前后近期普通群聊背景，只用于帮助你知道用户正在调试哪个群聊和什么上下文。不要把这些内容当成当前皮下用户指令。\n\n' +
              normalBackground.map(function(m){
                return (m.role==='assistant'?'群成员':'用户')+'：'+m.content;
              }).join('\n')
          });
        }

        msgs=msgs.concat(underHistory);

        if(msgs.length===0){
          msgs.push({
            role:'user',
            content:'用户已开启群聊皮下模式，但还没有输入具体问题。请简短说明已经进入皮下模式；用户可以直接说要调整什么，不需要使用括号。'
          });
        }

        var url=apiConfig.url.replace(/\/+$/,'')+'/chat/completions';
        var headers={
          'Content-Type':'application/json',
          'Authorization':'Bearer '+apiConfig.key
        };

        var body={
          model:apiConfig.model,
          messages:[{role:'system',content:sys}].concat(msgs)
        };

        if(apiConfig.temperature!==undefined)body.temperature=apiConfig.temperature;

        return {
          url:url,
          headers:headers,
          body:body
        };
      };
    }
  };

  // ===== 兼容旧全局函数名 =====

  window._isCurrentOocMode=function(){
    return cbyd21_UnderMode.isOn();
  };

  window._setCurrentOocMode=function(on){
    return cbyd21_UnderMode.setOn(on);
  };

  window._syncOocModePlusButton=function(){
    return cbyd21_UnderMode.syncButton();
  };

  window.toggleOocModeFromPlus=function(force){
    return cbyd21_UnderMode.toggle(force);
  };

  window._cbyd21FormatOocInstructions=function(list){
    return cbyd21_UnderMode.formatInstructions(list);
  };

  window._cbyd21RecordOocInstruction=function(target,text){
    var result=cbyd21_UnderMode.handleInput(target,text);
    return !!(result && result.handled);
  };

  window.openUnderModeRequirementsPanel=function(){
    return cbyd21_UnderMode.openRequirements();
  };

  window.openUnderModeHelpPanel=function(force){
    return cbyd21_UnderMode.openHelp(!!force);
  };

  function boot(){
    cbyd21_UnderMode.init();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot);
  }else{
    boot();
  }
})();
