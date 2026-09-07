(function(global){
  class Source {
    constructor(){ this.data={type:'FeatureCollection',features:[]}; }
    setData(data){ this.data=data; }
  }
  class StubMap {
    constructor(options={}){
      this.options=options;
      this.sources=new Map();
      this.layers=new Map();
      for(const id of ['road_oneway','road_oneway_opposite','highway_name_other','highway_name_motorway','place_other','place_suburb','place_village','place_town','place_state','place_city']){
        this.layers.set(id,{id,type:'symbol',layout:{visibility:'visible'}});
      }
      this.handlers=new Map();
      this.loaded=false;
      this.canvas=document.createElement('canvas');
      this.container=typeof options.container==='string'
        ? document.getElementById(options.container)
        : options.container;
      if(this.container){
        this.container.classList.add('maplibregl-map');
        this.container.appendChild(this.canvas);
      }
      setTimeout(()=>{
        this.loaded=true;
        this.emit('load',{type:'load',target:this});
      },0);
    }
    addControl(){}
    resize(){}
    jumpTo(payload){ this.center=payload.center; this.zoom=payload.zoom; }
    easeTo(payload){ this.jumpTo(payload); }
    fitBounds(bounds,options){ this.bounds=bounds; this.fitOptions=options; }
    getCanvas(){ return this.canvas; }
    addSource(id,source){ this.sources.set(id,{...source,setData(data){ this.data=data; }}); }
    getSource(id){ return this.sources.get(id)||null; }
    addLayer(layer){ this.layers.set(layer.id,layer); }
    getLayer(id){ return this.layers.get(id)||null; }
    setLayoutProperty(id,key,value){
      const layer=this.layers.get(id);
      if(layer) layer.layout={...(layer.layout||{}),[key]:value};
    }
    getLayoutProperty(id,key){
      return this.layers.get(id)?.layout?.[key];
    }
    on(type,layerOrHandler,handler){
      const callback=handler||layerOrHandler;
      const key=handler?`${type}:${layerOrHandler}`:type;
      if(!this.handlers.has(key)) this.handlers.set(key,[]);
      this.handlers.get(key).push(callback);
      if(type==='load'&&this.loaded) setTimeout(()=>callback({type:'load',target:this}),0);
    }
    emit(type,event={}){
      for(const callback of this.handlers.get(type)||[]) callback(event);
    }
  }
  class NavigationControl {
    constructor(options={}){ this.options=options; }
  }
  class Marker {
    constructor(options={}){
      this.element=options.element||document.createElement('div');
      this.element.classList.add('maplibregl-marker');
    }
    setLngLat(lngLat){ this.lngLat=lngLat; return this; }
    addTo(map){
      this.map=map;
      map.container?.appendChild(this.element);
      return this;
    }
    remove(){ this.element.remove(); }
  }
  class Popup {
    constructor(options={}){ this.options=options; this.element=null; }
    setLngLat(lngLat){ this.lngLat=lngLat; return this; }
    setHTML(html){ this.html=html; return this; }
    addTo(map){
      this.remove();
      const shell=document.createElement('div');
      shell.className=`maplibregl-popup ${this.options.className||''}`.trim();
      const content=document.createElement('div');
      content.className='maplibregl-popup-content';
      content.innerHTML=this.html||'';
      shell.appendChild(content);
      map.container?.appendChild(shell);
      this.element=shell;
      return this;
    }
    remove(){ if(this.element) this.element.remove(); this.element=null; }
  }
  class LngLatBounds {
    constructor(){ this.points=[]; }
    extend(point){ this.points.push(point); return this; }
  }
  global.maplibregl={Map:StubMap,NavigationControl,Marker,Popup,LngLatBounds};
})(window);
