// ===== 【模块】cbyd21_HtmlPreview — HTML预览器 =====
// 功能：
// 1. 打开 / 关闭 HTML 预览器
// 2. 加载 4 个内置模板
// 3. 编辑 HTML 并预览
// 4. 复制 / 清空代码
// 5. 调用 AI 按用户要求修改 HTML
// 6. 自动保存最近编辑内容

function cbyd21_HtmlPreview_safeJson(key, fallback){
  try{
    var raw = localStorage.getItem(key);

    if(raw === null || raw === undefined || raw === ''){
      return fallback;
    }

    return JSON.parse(raw);
  }catch(e){
    console.warn('HTML预览器 localStorage JSON 解析失败：', key, e);

    try{
      localStorage.setItem(key + '_broken_' + Date.now(), localStorage.getItem(key) || '');
    }catch(_e){}

    return fallback;
  }
}

var cbyd21_HtmlPreview={
  _watermark:'<!-- 由三天没睡HTML预览器生成 / 编辑，请勿删除“三天没睡HTML预览器”字样 -->',
  _storageKey:'stm_htmlPreviewCode',
  _promptKey:'stm_htmlPreviewAiPrompt',
  _draftKey:'stm_htmlPreviewDrafts',
  _aiEditing:false,
  _zoom:1,
  _stateLoaded:false,

  // 打开 HTML 预览器
  // · 显示页面
  // · 恢复上次编辑内容
  // · 恢复上次 AI 修改要求
  openApp:function(){
    document.getElementById('desktop').classList.add('hidden');
    document.getElementById('htmlPreviewApp').classList.add('active');
    currentAppId='htmlPreviewApp';
    history.pushState({app:'htmlPreviewApp'},'');

    this.loadSavedState();
    this.renderPreview();
    updateSnowVisibility();
  },

  // 关闭 HTML 预览器
  // · 返回桌面
  closeApp:function(fromPopstate){
    document.getElementById('htmlPreviewApp').classList.remove('active');
    document.getElementById('desktop').classList.remove('hidden');
    if(!fromPopstate)history.back();
    currentAppId=null;
    updateSnowVisibility();
  },

  // 读取本地保存的编辑内容和 AI 提示词
  // · 同时刷新草稿列表
  loadSavedState:function(){
    var input=document.getElementById('htmlPreviewInput');
    var prompt=document.getElementById('htmlPreviewAiPrompt');

    if(input)input.value=localStorage.getItem(this._storageKey)||'';
    if(prompt)prompt.value=localStorage.getItem(this._promptKey)||'';

    this._stateLoaded=true;
    this.renderDraftList();
  },

  // 保存当前输入状态
  saveState:function(){
    var input=document.getElementById('htmlPreviewInput');
    var prompt=document.getElementById('htmlPreviewAiPrompt');
    var app=document.getElementById('htmlPreviewApp');
    var appActive=!!(app && app.classList.contains('active'));

    // 页面刚加载但用户还没打开过 HTML 预览器时，textarea 默认是空的。
    // 这时导出/切后台如果直接保存，会把 localStorage 里的旧草稿覆盖成空。
    // 所以只有 App 当前打开，或本次已经 loadSavedState() 过，才允许写回。
    if(!appActive && !this._stateLoaded){
      return;
    }

    if(input)localStorage.setItem(this._storageKey,input.value||'');
    if(prompt)localStorage.setItem(this._promptKey,prompt.value||'');
  },

  // 确保 HTML 顶部存在注释水印
  // · 如果没有，就自动补到最顶部
  ensureWatermark:function(code){
    code=code||'';
    var trimmed=code.trimStart();
    if(trimmed.indexOf(this._watermark)===0){
      return code;
    }
    return this._watermark+'\n'+code;
  },

  // 获取 4 个内置模板
  // · 类名前缀统一使用 cbyd-
  // · 占位统一使用 ^占位^
  getTemplates:function(){
    return {
      minimal:
`<!-- 由三天没睡HTML预览器生成 / 编辑，请勿删除“三天没睡HTML预览器”字样 -->
<div class="cbyd-card cbyd-minimal" style="max-width:420px;margin:24px auto;padding:24px;border-radius:20px;background:#f7f7f5;border:1px solid #e3e1dc;color:#2c2c2c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div class="cbyd-tag" style="display:inline-block;padding:4px 10px;border-radius:999px;background:#ece8df;color:#5a564f;font-size:12px;margin-bottom:12px;">^占位^</div>
  <h2 class="cbyd-title" style="margin:0 0 10px;font-size:24px;line-height:1.3;">^占位^</h2>
  <p class="cbyd-desc" style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#5d5a55;">^占位^</p>
  <div class="cbyd-actions" style="display:flex;gap:10px;">
    <button style="padding:10px 16px;border:none;border-radius:12px;background:#2c2c2c;color:#fff;font-size:14px;">^占位^</button>
    <button style="padding:10px 16px;border:1px solid #d7d3cc;border-radius:12px;background:transparent;color:#2c2c2c;font-size:14px;">^占位^</button>
  </div>
</div>`,

      dark:
`<!-- 由三天没睡HTML预览器生成 / 编辑，请勿删除“三天没睡HTML预览器”字样 -->
<div class="cbyd-card cbyd-dark" style="max-width:440px;margin:24px auto;padding:24px;border-radius:22px;background:linear-gradient(160deg,#111111,#1a1a1a);border:1px solid rgba(255,255,255,0.08);color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 30px rgba(0,0,0,0.28);">
  <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:10px;">^占位^</div>
  <h2 style="margin:0 0 12px;font-size:24px;line-height:1.3;">^占位^</h2>
  <div style="padding:14px 16px;border-radius:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);margin-bottom:14px;">
    <div style="font-size:14px;line-height:1.8;color:rgba(255,255,255,0.78);">^占位^</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div style="padding:12px 14px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);font-size:13px;color:rgba(255,255,255,0.7);">^占位^</div>
    <div style="padding:12px 14px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);font-size:13px;color:rgba(255,255,255,0.7);">^占位^</div>
  </div>
</div>`,

      cute:
`<!-- 由三天没睡HTML预览器生成 / 编辑，请勿删除“三天没睡HTML预览器”字样 -->
<div class="cbyd-card cbyd-cute" style="max-width:430px;margin:24px auto;padding:24px;border-radius:24px;background:linear-gradient(160deg,#fff7fb,#ffeef7);border:1px solid #ffd6e8;color:#5b4450;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 10px 24px rgba(255,182,213,0.18);">
  <div style="font-size:12px;color:#c27a9e;margin-bottom:8px;">✦ ^占位^ ✦</div>
  <h2 style="margin:0 0 10px;font-size:24px;line-height:1.35;color:#7d4a63;">^占位^</h2>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#8a6275;">^占位^</p>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
    <span style="padding:6px 10px;border-radius:999px;background:#ffddeb;font-size:12px;color:#a45f7f;">^占位^</span>
    <span style="padding:6px 10px;border-radius:999px;background:#ffe4f0;font-size:12px;color:#a45f7f;">^占位^</span>
    <span style="padding:6px 10px;border-radius:999px;background:#fff0f6;font-size:12px;color:#a45f7f;">^占位^</span>
  </div>
  <button style="padding:10px 18px;border:none;border-radius:14px;background:#ff8fbd;color:#fff;font-size:14px;box-shadow:0 6px 14px rgba(255,143,189,0.28);">^占位^</button>
</div>`,

      cyberpunk:
`<!-- 由三天没睡HTML预览器生成 / 编辑，请勿删除“三天没睡HTML预览器”字样 -->
<div class="cbyd-card cbyd-cyberpunk" style="max-width:460px;margin:24px auto;padding:24px;border-radius:20px;background:linear-gradient(160deg,#0b0f1a,#111827);border:1px solid rgba(0,255,255,0.18);color:#d9faff;font-family:'SF Mono','Fira Code',monospace;box-shadow:0 0 0 1px rgba(255,0,255,0.08),0 12px 30px rgba(0,0,0,0.35);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
    <span style="font-size:12px;color:#00f5ff;">[ ^占位^ ]</span>
    <span style="font-size:12px;color:#ff4fd8;">^占位^</span>
  </div>
  <h2 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#ffffff;text-shadow:0 0 8px rgba(0,255,255,0.25);">^占位^</h2>
  <div style="padding:14px 16px;border-radius:14px;background:rgba(0,255,255,0.04);border:1px solid rgba(0,255,255,0.12);margin-bottom:14px;">
    <div style="font-size:13px;line-height:1.8;color:#b5f7ff;">^占位^</div>
  </div>
  <div style="display:flex;gap:10px;">
    <button style="padding:10px 16px;border:none;border-radius:12px;background:#00e5ff;color:#071018;font-size:13px;font-weight:700;">^占位^</button>
    <button style="padding:10px 16px;border:1px solid rgba(255,0,255,0.25);border-radius:12px;background:transparent;color:#ff75ef;font-size:13px;">^占位^</button>
  </div>
</div>`
    };
  },

  // 从模板弹窗加载模板
  // · 选中后关闭弹窗，再把模板放进编辑区
  loadTemplateAndClose:function(type){
    closeModal('htmlPreviewTemplateModal');
    this.loadTemplate(type);
  },

  // 加载某个内置模板到编辑区
  loadTemplate:function(type){
    var templates=this.getTemplates();
    var code=templates[type];
    if(!code){
      showToast('模板不存在');
      return;
    }

    var input=document.getElementById('htmlPreviewInput');
    if(!input)return;

    input.value=this.ensureWatermark(code);
    this.saveState();
    this.renderPreview();
    showToast('模板已加载');
  },

  // 应用预览缩放
  // · 只影响 iframe 的显示比例
  // · 不改原始 HTML 内容
  applyZoom:function(){
    var frame=document.getElementById('htmlPreviewFrame');
    var wrap=document.querySelector('.html-preview-frame-wrap');
    if(!frame||!wrap)return;

    var zoom=this._zoom||1;
    frame.style.transform='scale('+zoom+')';
    frame.style.width=(100/zoom)+'%';
    frame.style.height=(520/zoom)+'px';
  },

  // 放大预览
  // · 每次增加一点，方便查看细节
  zoomIn:function(){
    this._zoom=Math.min(2,this._zoom+0.1);
    this.applyZoom();
    showToast('预览缩放：'+Math.round(this._zoom*100)+'%');
  },

  // 缩小预览
  // · 每次减少一点，方便看整体布局
  zoomOut:function(){
    this._zoom=Math.max(0.5,this._zoom-0.1);
    this.applyZoom();
    showToast('预览缩放：'+Math.round(this._zoom*100)+'%');
  },

  // 重置预览缩放
  resetZoom:function(){
    this._zoom=1;
    this.applyZoom();
    showToast('预览已重置');
  },

  // 渲染 HTML 到 iframe
  // · 如果用户只写片段，就自动包一层最小页面结构
  renderPreview:function(){
    var input=document.getElementById('htmlPreviewInput');
    var frame=document.getElementById('htmlPreviewFrame');
    if(!input||!frame)return;

    var code=input.value||'';
    code=this.ensureWatermark(code);
    input.value=code;
    this.saveState();

    var finalHtml=code;

    if(!/<html[\s>]/i.test(code)){
      finalHtml='<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#ffffff;line-height:1.6;color:#222}*{box-sizing:border-box}img{max-width:100%;height:auto}</style></head><body>'+code+'</body></html>';
    }

    frame.srcdoc=finalHtml;
    this.applyZoom();
  },

  // 复制当前 HTML 代码
  copyCode:function(){
    var input=document.getElementById('htmlPreviewInput');
    if(!input)return;

    var text=input.value||'';
    if(!text.trim()){
      showToast('没有可复制的代码');
      return;
    }

    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        showToast('代码已复制');
      }).catch(function(){
        _fallbackCopy(text);
      });
    }else{
      _fallbackCopy(text);
    }
  },

  // 清空当前 HTML 和 AI 输入
  clearCode:function(){
    var input=document.getElementById('htmlPreviewInput');
    var prompt=document.getElementById('htmlPreviewAiPrompt');
    var frame=document.getElementById('htmlPreviewFrame');

    if(input)input.value='';
    if(prompt)prompt.value='';
    if(frame)frame.srcdoc='';

    localStorage.removeItem(this._storageKey);
    localStorage.removeItem(this._promptKey);
    showToast('已清空');
  },

  // 导入本地 HTML 文件
  // · 读取文件内容后填入编辑区
  // · 自动补上顶部水印
  importHtmlFile:function(){
    var self=this;
    var input=document.createElement('input');
    input.type='file';
    input.accept='.html,.htm,.txt';
    input.style.display='none';

    input.onchange=function(e){
      var file=e.target.files[0];
      if(!file)return;

      var reader=new FileReader();
      reader.onload=function(ev){
        var code=String(ev.target.result||'');
        code=self.ensureWatermark(code);

        var editor=document.getElementById('htmlPreviewInput');
        if(editor)editor.value=code;

        self.saveState();
        self.renderPreview();
        showToast('HTML 已导入');
      };
      reader.readAsText(file);

      document.body.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
  },

  // 导出当前 HTML 为本地文件
  // · 文件名自动带时间戳
  exportHtmlFile:function(){
    var input=document.getElementById('htmlPreviewInput');
    if(!input)return;

    var code=input.value||'';
    if(!code.trim()){
      showToast('没有可导出的 HTML');
      return;
    }

    code=this.ensureWatermark(code);

    var blob=new Blob([code],{type:'text/html'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;
    a.download='cbyd_html_preview_'+dateStamp()+'.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('HTML 已导出');
  },

  // 获取本地草稿列表
  getDrafts:function(){
    var drafts = cbyd21_HtmlPreview_safeJson(this._draftKey, []);
    return Array.isArray(drafts) ? drafts : [];
  },

  // 保存草稿列表
  setDrafts:function(list){
    localStorage.setItem(this._draftKey,JSON.stringify(list||[]));
  },

  // 保存当前 HTML 为一个本地草稿
  saveDraft:function(){
    var input=document.getElementById('htmlPreviewInput');
    if(!input)return;

    var code=input.value||'';
    if(!code.trim()){
      showToast('没有可保存的内容');
      return;
    }

    var name=prompt('草稿名称：');
    if(!name||!name.trim())return;

    code=this.ensureWatermark(code);

    var drafts=this.getDrafts();
    drafts.unshift({
      id:Date.now().toString(),
      name:name.trim(),
      code:code,
      time:dateStamp()
    });

    this.setDrafts(drafts);
    this.renderDraftList();
    showToast('草稿已保存');
  },

  // 渲染草稿列表
  renderDraftList:function(){
    var listEl=document.getElementById('htmlPreviewDraftList');
    if(!listEl)return;

    var drafts=this.getDrafts();
    listEl.innerHTML='';

    if(drafts.length===0){
      listEl.innerHTML='<div style="font-size:12px;color:var(--text-muted);padding:4px 2px;">还没有保存的草稿</div>';
      return;
    }

    var self=this;

    drafts.forEach(function(draft){
      var item=document.createElement('div');
      item.className='html-preview-draft-item';
      item.innerHTML=
        '<div class="html-preview-draft-info">'+
          '<div class="html-preview-draft-name">'+escHtml(draft.name)+'</div>'+
          '<div class="html-preview-draft-meta">'+escHtml(draft.time||'')+'</div>'+
        '</div>'+
        '<div class="html-preview-draft-actions">'+
          '<button class="btn-sm" data-draft-load="'+draft.id+'">加载</button>'+
          '<button class="btn-sm danger" data-draft-del="'+draft.id+'">删除</button>'+
        '</div>';

      var loadBtn=item.querySelector('[data-draft-load="'+draft.id+'"]');
      var delBtn=item.querySelector('[data-draft-del="'+draft.id+'"]');

      loadBtn.onclick=function(){
        self.loadDraft(draft.id);
      };

      delBtn.onclick=function(){
        self.deleteDraft(draft.id);
      };

      listEl.appendChild(item);
    });
  },

  // 加载指定草稿到编辑区
  loadDraft:function(id){
    var drafts=this.getDrafts();
    var draft=drafts.find(function(x){return x.id===id});
    if(!draft)return;

    var input=document.getElementById('htmlPreviewInput');
    if(input)input.value=this.ensureWatermark(draft.code||'');

    this.saveState();
    this.renderPreview();
    showToast('草稿已加载');
  },

  // 删除指定草稿
  deleteDraft:function(id){
    var drafts=this.getDrafts().filter(function(x){return x.id!==id});
    this.setDrafts(drafts);
    this.renderDraftList();
    showToast('草稿已删除');
  },

  // 更新 AI 修改按钮状态
  // · 生成中时禁用按钮并切换文字
  // · 完成后恢复默认状态
  setAiButtonState:function(loading,text){
    var btn=document.getElementById('htmlPreviewAiBtn');
    if(!btn)return;

    btn.disabled=!!loading;
    btn.textContent=text||'AI修改';
    btn.style.opacity=loading?'0.6':'';
    btn.style.cursor=loading?'not-allowed':'';
  },

  // 调用 AI 修改当前 HTML
  // · 用户写修改要求
  // · 调当前 API 和模型
  // · 返回新的 HTML 替换编辑区内容
  applyAiEdit:async function(){
    if(typeof _cbyd21BlockApiIfPromptsLoading === 'function' && _cbyd21BlockApiIfPromptsLoading()){
      return;
    }

    var input=document.getElementById('htmlPreviewInput');
    var promptEl=document.getElementById('htmlPreviewAiPrompt');
    if(!input||!promptEl)return;

    if(this._aiEditing){
      showToast('AI 还在修改中，请等它完成');
      this.setAiButtonState(true,'AI正在修改中…');
      return;
    }

    var html=input.value.trim();
    var userPrompt=promptEl.value.trim();

    if(!html){
      showToast('请先输入或加载 HTML');
      return;
    }

    if(!userPrompt){
      showToast('请先输入 AI 修改要求');
      return;
    }

    if(!apiConfig.url||!apiConfig.key||!apiConfig.model){
      showToast('请先在设置中配置 API');
      return;
    }

    this.saveState();
    this._aiEditing=true;
    this.setAiButtonState(true,'开始修改…');
    showToast('开始修改…');

    try{
      var systemPrompt=
`你是一个 HTML 模板修改助手。

你的任务：
根据用户的修改要求，直接修改提供的 HTML 代码，并输出修改后的最终 HTML。

严格规则：
1. 只输出最终 HTML，不要输出解释
2. 不要输出 markdown 代码块
3. 不要输出 \`\`\`html 或 \`\`\`
4. 尽量保留原结构，按用户要求修改
5. 保留所有 cbyd- 前缀类名，不要随意删除
6. 保留 ^占位^ 这种占位符，除非用户明确要求填充具体内容
7. 不要输出 script
8. 尽量使用内联样式，不要依赖外部文件
9. 输出必须能直接放进 body 中预览
10. 如果用户要求“填充内容”，就直接把对应的 ^占位^ 替换成合理内容
11. 如果用户只要求改颜色、字体、圆角、间距、阴影、边框、排版风格等样式内容，就只允许修改样式，不要改结构，不要改逻辑，不要改标签层级
12. 如果用户没有明确要求修改功能、交互、逻辑、组件结构，就禁止改动功能和结构
13. 如果原HTML中存在分页、切换、翻页、按钮交互、容器层级、特定布局结构，默认必须保留，不能自作主张删除、改写或简化
14. 用户要求修改功能时，也只允许做与该功能直接相关的最小改动，禁止顺手重构其他部分
15. 必须保留 HTML 顶部这句注释水印，不能删除，也不能改写：
<!-- 由三天没睡HTML预览器生成 / 编辑，请勿删除“三天没睡HTML预览器”字样 -->
16. 如果原始 HTML 顶部已经有这句注释，就原样保留在最顶部
17. 如果修改后的 HTML 中缺少这句注释，必须自动补回最顶部`;

      var userContent=
`【当前 HTML】
${html}

【用户要求】
${userPrompt}

请直接输出修改后的最终 HTML：`;

      this.setAiButtonState(true,'AI正在修改中…');
      showToast('AI 正在修改中…');

      var url=apiConfig.url.replace(/\/+$/,'')+'/chat/completions';
      var headers={
        'Content-Type':'application/json',
        'Authorization':'Bearer '+apiConfig.key
      };
      var body={
        model:apiConfig.model,
        messages:[
          {role:'system',content:systemPrompt},
          {role:'user',content:userContent}
        ]
      };
      if(apiConfig.temperature!==undefined)body.temperature=apiConfig.temperature;

      var r=await fetch(url,{
        method:'POST',
        headers:headers,
        body:JSON.stringify(body)
      });

      if(!r.ok){
        var t=await r.text();
        throw new Error('HTTP '+r.status+': '+t.slice(0,200));
      }

      var d=await r.json();
      var reply = typeof _cbyd21ExtractChatApiContent === 'function'
        ? _cbyd21ExtractChatApiContent(d)
        : (d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content||'');

      reply=String(reply||'').trim();

      if(!reply){
        showApiError('HTML预览器AI修改失败：API返回为空');
        return;
      }

      // 清理 markdown 代码块包裹
      reply=reply.replace(/^```html\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/,'').trim();

      input.value=reply;
      this.saveState();
      this.renderPreview();
      showToast('AI 已完成修改');
    }catch(e){
      showApiError('HTML预览器AI修改失败：'+(e.message||''));
    }finally{
      this._aiEditing=false;
      this.setAiButtonState(false,'AI修改');
    }
  }
};
