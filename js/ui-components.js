/* Shared presentation only: operational requests remain owned by their services. */
(function(global){
  const expandedLists=new Map();
  const openDetails=new Set();

  function list(items,render,{key,limit=10}={}){
    const count=Math.max(limit,expandedLists.get(key)||limit);
    const remaining=Math.max(0,items.length-count);
    return items.slice(0,count).map(render).join('')+
      (remaining?`<button type="button" class="desk-action-link ui-list-more" data-ui-more="${esc(key)}" data-ui-limit="${limit}">Show ${Math.min(limit,remaining)} more <span>(${remaining} remaining)</span></button>`:'')+
      (count>limit?`<button type="button" class="desk-action-link ui-list-less" data-ui-less="${esc(key)}">Show fewer</button>`:'');
  }

  function details(key,label,body){
    return `<details class="ui-details" data-ui-details="${esc(key)}" ${openDetails.has(key)?'open':''}><summary>${esc(label)}</summary>${body}</details>`;
  }

  function requestStatus({title,label,detail='',startAt=0,endAt=0,pending=false,tone='',facts=[],actions=''}={}){
    const progress=pending?clamp((simNow()-startAt)/Math.max(MIN,endAt-startAt),0,1):0;
    return `<section class="ui-request-status ${esc(tone)} ${pending?'pending':''}" ${pending?`data-ui-progress data-ui-start="${startAt}" data-ui-end="${endAt}"`:''}>
      <header><b>${esc(title||label)}</b>${pending?`<span data-ui-remaining>${Math.max(0,Math.ceil((endAt-simNow())/MIN))} min remaining</span>`:''}</header>
      ${title&&label?`<strong class="ui-request-label">${esc(label)}</strong>`:''}
      ${pending?`<div class="progress-track" role="progressbar" aria-label="${esc(label||title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress*100)}"><span style="width:${formatPct(progress)}"></span></div>`:''}
      ${detail?`<p>${esc(detail)}</p>`:''}
      ${facts.length?`<dl class="ui-facts">${facts.filter(([,value])=>value!==''&&value!==null&&value!==undefined).map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}
      ${actions?`<div class="form-actions">${actions}</div>`:''}
    </section>`;
  }

  function refreshProgress(root=document){
    const now=simNow();
    root.querySelectorAll('[data-ui-progress]').forEach(section=>{
      const start=Number(section.dataset.uiStart),end=Number(section.dataset.uiEnd);
      const progress=clamp((now-start)/Math.max(MIN,end-start),0,1);
      section.querySelector('[data-ui-remaining]').textContent=end>now?`${Math.ceil((end-now)/MIN)} min remaining`:'Due now';
      const track=section.querySelector('.progress-track');
      track.setAttribute('aria-valuenow',String(Math.round(progress*100)));
      track.firstElementChild.style.width=formatPct(progress);
    });
  }

  function flightLabel(flight){
    return `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)} · ${shortDay(flightActualDeparture(flight))} ${shortClock(flightActualDeparture(flight))}`;
  }
  function airportLabel(code){ return `${code} · ${AIRPORTS[code]?.name||code}`; }

  function badge(id,count){
    const node=document.getElementById(id);
    if(!node)return;
    node.textContent=count;
    node.closest('.occ-widget-state').hidden=!count;
  }

  function enhance(root){
    root.querySelectorAll('[role="tablist"]').forEach(list=>{
      const tabs=[...list.querySelectorAll('[role="tab"]')];
      const desk=tabs[0]?.dataset.deskPanel.split(':')[0];
      if(!desk)return;
      let panel=list.nextElementSibling;
      if(!panel?.classList.contains('ui-tabpanel')){
        panel=document.createElement('div');panel.className='ui-tabpanel';
        while(list.nextSibling)panel.append(list.nextSibling);
        list.after(panel);
      }
      panel.id=`panel-${desk}`;panel.setAttribute('role','tabpanel');
      tabs.forEach(tab=>{
        tab.tabIndex=tab.getAttribute('aria-selected')==='true'?0:-1;
        tab.id=`tab-${tab.dataset.deskPanel.replace(':','-')}`;
        tab.setAttribute('aria-controls',panel.id);
        if(tab.tabIndex===0)panel.setAttribute('aria-labelledby',tab.id);
      });
    });
    root.querySelectorAll('select').forEach(select=>{
      if(select.closest('.ui-select')||select.options.length<13) return;
      const label=select.getAttribute('aria-label')||[...(select.labels?.[0]?.childNodes||[])].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim()||'options';
      const wrapper=document.createElement('div');wrapper.className='ui-select';
      const search=document.createElement('input');search.type='search';search.placeholder=`Search ${label.toLowerCase()}`;
      search.setAttribute('aria-label',`Search ${label.toLowerCase()}`);search.autocomplete='off';
      const message=document.createElement('span');message.className='ui-select-result';message.hidden=true;message.setAttribute('role','status');
      select.before(wrapper);wrapper.append(search,select,message);
      search.addEventListener('input',()=>{
        const query=search.value.trim().toLocaleLowerCase();let matches=0;
        [...select.options].forEach(option=>{
          const match=option.textContent.toLocaleLowerCase().includes(query);
          option.hidden=!match&&!option.selected;
          if(match) matches++;
        });
        message.hidden=!query;message.textContent=matches?`${matches} matches`:'No matches. Current selection unchanged.';
      });
    });
  }

  function install(){
    const topbar=document.querySelector('.topbar');
    if(topbar)new ResizeObserver(()=>document.documentElement.style.setProperty('--topbar-height',`${topbar.getBoundingClientRect().height}px`)).observe(topbar);
    let helpTarget=null;
    const tooltip=document.createElement('div');tooltip.id='ui-help';tooltip.className='ui-tooltip';tooltip.role='tooltip';tooltip.hidden=true;document.body.append(tooltip);
    const hideHelp=()=>{helpTarget?.removeAttribute('aria-describedby');helpTarget=null;tooltip.hidden=true;};
    const showHelp=target=>{
      if(helpTarget!==target)hideHelp();helpTarget=target;tooltip.textContent=target.dataset.help;tooltip.hidden=false;target.setAttribute('aria-describedby',tooltip.id);
      tooltip.classList.toggle('multiline',target.hasAttribute('data-help-multiline'));
      const box=target.getBoundingClientRect(),tip=tooltip.getBoundingClientRect();
      tooltip.style.left=`${clamp(box.left,8,innerWidth-tip.width-8)}px`;
      tooltip.style.top=`${box.bottom+tip.height+12<innerHeight?box.bottom+6:Math.max(8,box.top-tip.height-6)}px`;
    };
    document.addEventListener('mouseover',event=>{const target=event.target.closest('[data-help]');if(target)showHelp(target);});
    document.addEventListener('mouseout',event=>{if(event.target.closest('[data-help]'))hideHelp();});
    document.addEventListener('focusin',event=>{const target=event.target.closest('[data-help]');if(target)showHelp(target);else hideHelp();});
    document.addEventListener('scroll',hideHelp,true);
    document.addEventListener('click',event=>{
      const help=event.target.closest('[data-help]');
      if(help){event.preventDefault();showHelp(help);return;}
      hideHelp();
      const tab=event.target.closest('[data-desk-panel]');
      if(tab){
        if(tab.getAttribute('aria-selected')==='true')return;
        const [desk,panel]=tab.dataset.deskPanel.split(':');
        setDeskPanel(desk,panel);
        const rail=tab.closest('[data-rail-widget]');
        if(rail)setRailWidgetOpen(rail.dataset.railWidget,true,{persist:false});
        markUiDirty(rail?'left':'desk');
        return;
      }
      const more=event.target.closest('[data-ui-more]'),less=event.target.closest('[data-ui-less]');
      if(more){const step=Number(more.dataset.uiLimit)||10;expandedLists.set(more.dataset.uiMore,(expandedLists.get(more.dataset.uiMore)||step)+step);}
      if(less)expandedLists.delete(less.dataset.uiLess);
      if(more||less)markUiDirty('left','desk');
      const jump=event.target.closest('[data-ui-jump]');
      if(jump){
        const name=jump.dataset.uiJump;
        if(name==='warnings'||name==='planning'){setDeskOpen(name,true);expandedEmptyDesks.add(name);renderDeskStack(true,true);}
        document.querySelector(name==='resources'?'.operations-rail':name==='schedule'?'#schedule-pane':`#occ-desk-${name}`)?.scrollIntoView({behavior:'smooth',block:'start'});
      }
    });
    document.addEventListener('toggle',event=>{
      const key=event.target.dataset?.uiDetails;if(key){if(event.target.open)openDetails.add(key);else openDetails.delete(key);}
    },true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape')hideHelp();
      const help=event.target.closest('[data-help]');
      if(help&&['Enter',' '].includes(event.key)){event.preventDefault();showHelp(help);}
      const tab=event.target.closest('[role="tab"]');
      if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],index=tabs.indexOf(tab);
      const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
      next.click();flushUiDirty();document.getElementById(next.id)?.focus();
    });
  }
  global.AeroUi={list,details,requestStatus,refreshProgress,flightLabel,airportLabel,badge,enhance,install};
})(window);
