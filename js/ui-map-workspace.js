/* Presentation-only trial: move existing surfaces without rebuilding their controls. */
const AeroMapWorkspace=(()=>{
  const layoutKey='aoc_workspace_layout',heightKey='aoc_map_schedule_height';
  const shell=document.getElementById('operationsView');
  const center=document.getElementById('center-workspace');
  const pane=document.getElementById('schedule-pane');
  const toolbar=document.querySelector('.schedule-toolbar');
  const weather=document.getElementById('weatherStrip');
  const left=document.querySelector('.operations-rail'),right=document.querySelector('.context-rail');
  const compact=window.matchMedia('(max-width:900px)');
  const listeners=new Set();
  const read=key=>{try{return localStorage.getItem(key);}catch(_){return null;}};
  const write=(key,value)=>{try{localStorage.setItem(key,String(value));}catch(_){}};
  let layout=read(layoutKey)==='classic'?'classic':'map';
  let height=Number(read(heightKey))||0,active=false,focused=false,collapsed=false;
  let frame=0,lastGeometry='';

  function iconButton(id,icon,label,className){
    const button=document.createElement('button');
    button.id=id;button.type='button';button.className=className;
    button.title=label;button.setAttribute('aria-label',label);
    const image=document.createElement('img');
    image.src=`assets/icons/${icon}.svg`;image.alt='';image.className='workspace-icon';
    button.append(image);
    return button;
  }
  const toggle=iconButton('workspaceLayoutBtn','panels-top-left','Use classic layout','topbar-icon-button');
  document.getElementById('pauseTopbarBtn').before(toggle);
  const focus=iconButton('mapFocusBtn','maximize','Focus map','small-button');
  document.querySelector('.map-hud').append(focus);
  const dock=document.createElement('section');
  dock.id='map-schedule-dock';dock.setAttribute('aria-label','Schedule');
  const splitter=document.createElement('div');
  splitter.id='map-schedule-splitter';splitter.tabIndex=0;
  splitter.setAttribute('role','separator');splitter.setAttribute('aria-orientation','horizontal');
  splitter.setAttribute('aria-label','Resize schedule');splitter.setAttribute('aria-controls','map-schedule-dock');
  const collapse=document.getElementById('scheduleCollapseBtn');

  function heightBounds(){
    const maximum=Math.max(160,Math.min(shell.clientHeight*.65,shell.clientHeight-180));
    return {min:Math.min(220,maximum),max:maximum};
  }
  function updateHeight(){
    const bounds=heightBounds();
    const expanded=Math.round(Math.min(bounds.max,Math.max(bounds.min,height||shell.clientHeight*.34)));
    const actual=collapsed?toolbar.offsetHeight||38:expanded;
    shell.style.setProperty('--map-dock-height',`${actual}px`);
    splitter.setAttribute('aria-valuemin',String(Math.round(bounds.min)));
    splitter.setAttribute('aria-valuemax',String(Math.round(bounds.max)));
    splitter.setAttribute('aria-valuenow',String(expanded));
    splitter.setAttribute('aria-valuetext',`${expanded} pixels`);
  }
  function padding(){
    if(!active||focused)return {top:0,left:0,right:0,bottom:0};
    const rect=shell.getBoundingClientRect();
    return {top:12,left:Math.round(left.getBoundingClientRect().right-rect.left+16),
      right:Math.round(rect.right-right.getBoundingClientRect().left+16),
      bottom:Math.round(rect.bottom-dock.getBoundingClientRect().top+12)};
  }
  function queueGeometry(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      if(!shell.clientWidth||!shell.clientHeight)return;
      if(active)updateHeight();
      const inset=padding();
      shell.style.setProperty('--map-clear-left',`${inset.left+12}px`);
      shell.style.setProperty('--map-clear-right',`${inset.right+12}px`);
      shell.style.setProperty('--map-clear-bottom',`${inset.bottom+12}px`);
      const signature=JSON.stringify([active,focused,collapsed,shell.clientWidth,shell.clientHeight,inset]);
      if(signature===lastGeometry)return;
      lastGeometry=signature;
      for(const listener of listeners)listener(inset);
      markUiDirty('schedule');
    });
  }
  function setFocused(value){
    focused=active&&Boolean(value);
    document.body.classList.toggle('map-focused',focused);
    focus.setAttribute('aria-pressed',String(focused));
    focus.title=focused?'Show widgets':'Focus map';focus.setAttribute('aria-label',focus.title);
    focus.firstElementChild.src=`assets/icons/${focused?'minimize':'maximize'}.svg`;
    queueGeometry();
  }
  function setCollapsed(value){
    collapsed=Boolean(value);
    document.body.classList.toggle('schedule-dock-collapsed',active&&collapsed);
    collapse.setAttribute('aria-expanded',String(!collapsed));
    collapse.title=collapsed?'Expand schedule':'Collapse schedule';
    collapse.setAttribute('aria-label',collapse.title);
    queueGeometry();
  }
  function applyLayout(){
    const next=layout==='map'&&!compact.matches;
    if(next!==active){
      active=next;
      if(active){
        dock.append(splitter,toolbar,weather,pane);
        shell.append(dock);
      }else{
        center.append(toolbar,weather,pane);
        dock.remove();
      }
    }
    document.body.classList.toggle('map-workspace',active);
    toggle.setAttribute('aria-pressed',String(active));
    toggle.title=active?'Use classic layout':'Use map workspace';
    toggle.setAttribute('aria-label',toggle.title);
    setFocused(false);setCollapsed(collapsed);
    queueGeometry();
  }
  function setLayout(value){
    layout=value==='classic'?'classic':'map';write(layoutKey,layout);applyLayout();
  }
  toggle.addEventListener('click',()=>setLayout(active?'classic':'map'));
  focus.addEventListener('click',()=>setFocused(!focused));
  collapse.addEventListener('click',()=>setCollapsed(!collapsed));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&focused){setFocused(false);focus.focus();}});
  let dragging=false;
  splitter.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    dragging=true;splitter.classList.add('dragging');splitter.setPointerCapture(event.pointerId);event.preventDefault();
  });
  function resize(value){
    const bounds=heightBounds();height=Math.min(bounds.max,Math.max(bounds.min,value));
    queueGeometry();
  }
  splitter.addEventListener('pointermove',event=>{if(dragging)resize(shell.getBoundingClientRect().bottom-event.clientY-12);});
  function stop(){
    if(!dragging)return;
    dragging=false;splitter.classList.remove('dragging');write(heightKey,height);
  }
  splitter.addEventListener('pointerup',stop);splitter.addEventListener('pointercancel',stop);
  splitter.addEventListener('lostpointercapture',stop);
  splitter.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();
    const bounds=heightBounds(),current=dock.getBoundingClientRect().height;
    resize(event.key==='Home'?bounds.min:event.key==='End'?bounds.max:current+(event.key==='ArrowUp'?24:-24));
    write(heightKey,height);
  });
  const observer=new ResizeObserver(queueGeometry);
  [shell,left,right,dock,toolbar].forEach(element=>observer.observe(element));
  compact.addEventListener('change',applyLayout);
  applyLayout();
  return {setLayout,padding,onResize(listener){listeners.add(listener);queueGeometry();}};
})();
