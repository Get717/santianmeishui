// ===== 【模块】cbyd21_StickerSuggest — 输入框表情包联想 =====
// 功能：
// · 当前角色开启后，用户在聊天输入框输入文字时，输入框上方显示匹配到的全部表情包。
// · 精准字面匹配：输入内容和表情包描述互相包含时命中。
// · 支持中文单字输入命中描述中的任意位置，例如只输入“笑”可命中“赔笑”。
// · 不做近义词、不做语义模糊、不做拼音匹配。
// · 点击推荐表情后直接调用现有 sendStickerMsg(s.url)，不改表情包发送/渲染链路。

(function(){
  if(window.cbyd21_StickerSuggest)return;

  window.cbyd21_StickerSuggest = {
    _bound:false,
    _lastQuery:'',
    _renderSeq:0,
    maxItems:18,

    init:function(){
      if(this._bound)return;
      this._bound = true;

      var input = document.getElementById('msgInput');
      var self = this;

      if(input){
        input.addEventListener('input', function(){
          self.update();
        });

        input.addEventListener('focus', function(){
          self.update();
        });

        input.addEventListener('blur', function(){
          // 移动端输入法 / 点击联想条时可能短暂 blur。
          // 延迟后确认焦点不在输入区和联想条内，再隐藏。
          setTimeout(function(){
            var bar = document.getElementById('stickerSuggestBar');
            var inputArea = document.getElementById('inputArea');
            var active = document.activeElement;

            if(bar && active && bar.contains(active))return;
            if(inputArea && active && inputArea.contains(active))return;

            self.hide();
          }, 260);
        });
      }

      document.addEventListener('pointerdown', function(e){
        var bar = document.getElementById('stickerSuggestBar');
        var inputArea = document.getElementById('inputArea');

        if(!bar || !bar.classList.contains('active'))return;
        if(bar.contains(e.target))return;
        if(inputArea && inputArea.contains(e.target))return;

        self.hide();
      }, true);
    },

    loadPanel:function(ch){
      var toggle = document.getElementById('charInfoStickerSuggest');
      var status = document.getElementById('charInfoStickerSuggestStatus');

      var on = !!(ch && ch._stickerSuggestEnabled);

      if(toggle)toggle.checked = on;
      if(status)status.textContent = on ? '开启' : '关闭';
    },

    saveFromPanel:function(){
      var charId = typeof _charInfoCharId !== 'undefined' ? _charInfoCharId : null;
      var ch = charId && typeof getCharById === 'function' ? getCharById(charId) : null;

      if(!ch)return;

      if(typeof DEFAULT_CHAR_ID !== 'undefined' && ch.id === DEFAULT_CHAR_ID){
        var toggleDefault = document.getElementById('charInfoStickerSuggest');
        var statusDefault = document.getElementById('charInfoStickerSuggestStatus');

        ch._stickerSuggestEnabled = false;

        if(toggleDefault)toggleDefault.checked = false;
        if(statusDefault)statusDefault.textContent = '关闭';

        if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.saveCharacters){
          cbyd21_Data.saveCharacters();
        }

        this.hide();
        showToast('写卡助手不启用输入联想表情包');
        return;
      }

      var toggle = document.getElementById('charInfoStickerSuggest');
      var status = document.getElementById('charInfoStickerSuggestStatus');
      var on = !!(toggle && toggle.checked);

      ch._stickerSuggestEnabled = on;
      ch._updatedAt = Date.now();

      if(status)status.textContent = on ? '开启' : '关闭';

      if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.saveCharacters){
        cbyd21_Data.saveCharacters();
      }

      if(!on)this.hide();
      else this.update();

      showToast(on ? '输入联想表情包已开启' : '输入联想表情包已关闭');
    },

    hide:function(){
      var bar = document.getElementById('stickerSuggestBar');
      var scroll = document.getElementById('stickerSuggestScroll');

      this._renderSeq++;

      if(bar)bar.classList.remove('active');
      if(scroll)scroll.innerHTML = '';

      this._lastQuery = '';
    },

    _isChatAvailable:function(){
      try{
        var view = document.getElementById('chatView');

        if(!view || !view.classList.contains('active'))return false;
        if(view.dataset.groupMode === 'true')return false;

        if(typeof currentChatCharId === 'undefined' || !currentChatCharId)return false;

        var ch = typeof getCharById === 'function' ? getCharById(currentChatCharId) : null;

        if(!ch)return false;
        if(!ch._stickerSuggestEnabled)return false;
        if(typeof DEFAULT_CHAR_ID !== 'undefined' && ch.id === DEFAULT_CHAR_ID)return false;

        return true;
      }catch(e){
        return false;
      }
    },

    _normalize:function(text){
      return String(text || '')
        .toLowerCase()
        .replace(/\s+/g,'')
        .replace(/[，。！？、；：,.!?;:"'“”‘’（）()\[\]【】{}<>《》~`·|\\/]/g,'')
        .trim();
    },

    // _canTriggerQuery(q)
    // → 判断规范化后的输入词是否允许触发表情包联想。
    // 中文单字允许触发，但只在输入内容本身就是这一个字时触发。
    // 这样“笑”能匹配“赔笑”，但“我笑了”不会因为单字“笑”乱弹。
    // 英文 / 数字单字符不触发，避免输入 a / 1 这类字符时误弹大量表情。
    _canTriggerQuery:function(q){
      q = String(q || '').trim();

      if(!q)return false;

      if(q.length >= 2)return true;

      return /^[\u4e00-\u9fff]$/.test(q);
    },

    // _getAllUserStickers()
    // → 获取用户表情包管理里的全部表情包。
    // 用户输入联想不受角色挂载分组限制；挂载分组只限制 AI 可用表情包。
    // 这里做多层兜底，避免外部脚本读取不到主文件函数或 window.stickerGroups 旧引用为空。
    _getAllUserStickers:function(){
      var list = [];

      function pushFromGroups(groups){
        if(!Array.isArray(groups))return;

        groups.forEach(function(g){
          if(!g || !Array.isArray(g.stickers))return;

          g.stickers.forEach(function(s){
            if(!s)return;

            list.push({
              url:s.url,
              desc:s.desc,
              groupId:g.id
            });
          });
        });
      }

      try{
        if(typeof getAllStickers === 'function'){
          var fromFn = getAllStickers();

          if(Array.isArray(fromFn) && fromFn.length > 0){
            return fromFn;
          }
        }
      }catch(e){}

      try{
        pushFromGroups(window.stickerGroups);
      }catch(e){}

      if(list.length > 0){
        return list;
      }

      try{
        if(typeof stickerGroups !== 'undefined'){
          pushFromGroups(stickerGroups);
        }
      }catch(e){}

      if(list.length > 0){
        return list;
      }

      try{
        var raw = localStorage.getItem('stm_stickerGroups') || localStorage.getItem('stm_idbFallback_stickerGroups') || '[]';
        var parsed = JSON.parse(raw);

        pushFromGroups(parsed);
      }catch(e){}

      return list;
    },

    _matchStickers:function(query){
      if(!this._isChatAvailable())return [];

      var ch = typeof getCharById === 'function' ? getCharById(currentChatCharId) : null;

      if(!ch)return [];

      var qRaw = String(query || '').trim();
      var q = this._normalize(qRaw);

      if(!q)return [];

      if(!this._canTriggerQuery(q))return [];

      // 用户自己输入关键词找表情包时，应搜索“表情包管理”里的全部表情包。
      // 角色挂载分组只限制 AI 能使用哪些表情包，不限制用户自己发送。
      var mounted = this._getAllUserStickers();

      var result = [];
      var seen = {};

      mounted.forEach(function(s){
        if(!s || !s.url)return;

        var descRaw = String(s.desc || '').trim();

        if(!descRaw)return;

        var desc = cbyd21_StickerSuggest._normalize(descRaw);

        if(!desc)return;

        // 精准字面匹配：不做近义、不做语义模糊、不做拼音。
        // 单字输入时，允许命中描述中的任意位置：
        // · desc=赔笑，输入“笑”命中；
        // · desc=找婆娘，输入“娘”命中。
        // 多字输入时，按整体互含匹配：
        // · desc=开心，输入“今天好开心”命中；
        // · desc=开心大笑，输入“开心”命中；
        // · desc=笑，输入“我笑了”不命中，避免一句话里的单字乱弹。
        // · desc=抱抱，输入“安慰”不命中，因为不是字面包含。
        var isSingleCnQuery = /^[\u4e00-\u9fff]$/.test(q);

        if(isSingleCnQuery){
          if(desc.indexOf(q) < 0)return;
        }else{
          if(q.indexOf(desc) < 0 && desc.indexOf(q) < 0)return;
        }

        var key = String(s.url || '') + '\n' + descRaw;

        if(seen[key])return;

        seen[key] = true;

        result.push({
          url:s.url,
          desc:descRaw,
          score:desc.length
        });
      });

      result.sort(function(a,b){
        return b.score - a.score;
      });

      return result.slice(0, this.maxItems);
    },

    update:function(){
      var input = document.getElementById('msgInput');
      var bar = document.getElementById('stickerSuggestBar');
      var scroll = document.getElementById('stickerSuggestScroll');

      if(!input || !bar || !scroll)return;

      if(!this._isChatAvailable()){
        this.hide();
        return;
      }

      var text = String(input.value || '');

      if(!text.trim()){
        this.hide();
        return;
      }

      // 打开大表情包面板或加号面板时，不显示联想小条。
      var stickerPanel = document.getElementById('stickerPanel');
      var plusPanel = document.getElementById('plusPanel');

      if(
        (stickerPanel && stickerPanel.classList.contains('active')) ||
        (plusPanel && plusPanel.classList.contains('active'))
      ){
        this.hide();
        return;
      }

      var matches = this._matchStickers(text);

      if(matches.length === 0){
        this.hide();
        return;
      }

      this._lastQuery = text;
      this._render(matches);
    },

    _render:function(items){
      var bar = document.getElementById('stickerSuggestBar');
      var scroll = document.getElementById('stickerSuggestScroll');

      if(!bar || !scroll)return;

      var seq = ++this._renderSeq;
      var self = this;

      scroll.innerHTML = '';

      items.forEach(function(item){
        var btn = document.createElement('button');

        btn.type = 'button';
        btn.className = 'sticker-suggest-item';
        btn.tabIndex = 0;
        btn.title = item.desc || '表情包';
        btn.innerHTML = '<span class="sticker-suggest-loading">加载中</span>';

        function sendSuggestedSticker(e){
          e.preventDefault();
          e.stopPropagation();

          self.hide();

          if(typeof sendStickerMsg === 'function'){
            sendStickerMsg(item.url);
          }else{
            showToast('表情包发送模块未加载');
          }
        }

        btn.addEventListener('pointerdown', sendSuggestedSticker);

        scroll.appendChild(btn);

        self._loadThumb(item.url).then(function(src){
          if(seq !== self._renderSeq)return;

          if(!src){
            btn.innerHTML = '<span class="sticker-suggest-fallback">' + escHtml(item.desc || '表情') + '</span>';
            return;
          }

          btn.innerHTML = '';
          var img = document.createElement('img');
          img.src = src;
          img.alt = item.desc || '表情包';
          img.onerror = function(){
            btn.innerHTML = '<span class="sticker-suggest-fallback">' + escHtml(item.desc || '表情') + '</span>';
          };
          btn.appendChild(img);
        });
      });

      bar.classList.add('active');
    },

    _loadThumb:function(ref){
      ref = String(ref || '').trim();

      if(!ref)return Promise.resolve('');

      if(
        (typeof _cbyd21IsDirectImageRef === 'function' && _cbyd21IsDirectImageRef(ref)) ||
        ref.startsWith('data:image/') ||
        ref.startsWith('http') ||
        ref.startsWith('//')
      ){
        return Promise.resolve(ref);
      }

      if(typeof cbyd21_Data !== 'undefined' && cbyd21_Data.loadImage){
        return cbyd21_Data.loadImage(ref).then(function(d){
          return d || '';
        }).catch(function(){
          return '';
        });
      }

      return Promise.resolve('');
    }
  };

  function boot(){
    cbyd21_StickerSuggest.init();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }
})();
