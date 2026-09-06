/* Browser-facing services used by simulation code without tying it to DOM calls. */
(function(global){
  let toastTimer=null;

  function confirm(message){
    return typeof global.confirm==='function' ? global.confirm(message) : true;
  }

  function notify(message){
    const documentRef=global.document;
    const el=documentRef&&documentRef.getElementById('toast');
    if(!el) return;
    el.textContent=message;
    el.classList.add('show');
    global.clearTimeout(toastTimer);
    toastTimer=global.setTimeout(()=>el.classList.remove('show'),2600);
  }

  function persist(){
    if(typeof global.save==='function') global.save();
  }

  function renderAll(){
    if(typeof global.markUiDirty==='function'){
      global.markUiDirty('all');
      return;
    }
    if(typeof global.refreshAll==='function') global.refreshAll();
  }

  function openContextWorkbench({scroll='top'}={}){
    const documentRef=global.document;
    const widget=documentRef&&documentRef.querySelector('[data-widget="context-workbench"]');
    if(!widget) return null;
    if(typeof global.setWidgetOpen==='function') global.setWidgetOpen(widget,true,{persist:false});
    const rightSidebar=widget.closest('.sidebar');
    if(rightSidebar){
      const top=scroll==='widget' ? widget.offsetTop : 0;
      rightSidebar.scrollTo({top,behavior:'smooth'});
    }
    return widget;
  }

  function commit(){
    persist();
    renderAll();
  }

  global.AeroServices={confirm,notify,persist,renderAll,commit,openContextWorkbench};
  global.toast=notify;
})(window);
