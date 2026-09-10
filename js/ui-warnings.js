/* Warning widget rendering. */
(function(global){
function warningsDeskMarkup(warnings){
  if(!warnings.length) return '<div class="occ-clear-state"><b>No current warnings</b><span>Derived schedule, crew, night, and maintenance risks are clear.</span></div>';
  const byGroup=new Map();
  for(const warning of warnings) mapPush(byGroup,warning.group||'Other warnings',warning);
  const row=warning=>{
    const actionAttr=warning.flightId
      ? `data-warning-flight="${esc(warning.flightId)}"`
      : warning.aircraftId
        ? `data-warning-aircraft="${esc(warning.aircraftId)}"`
        : '';
    const dismissKey=warningDismissKey(warning);
    return `<div class="desk-list-row warning-row ${esc(warning.level)}" data-warning-key="${esc(dismissKey)}">
      <button class="row-main-button" type="button" ${actionAttr}>
        <b>${esc(warning.title)}</b>
        <span>${esc(warning.detail)}</span>
      </button>
      <button class="warning-dismiss-button" type="button" data-dismiss-warning="${esc(dismissKey)}" aria-label="Dismiss warning" title="Dismiss warning">×</button>
    </div>`;
  };
  const groups=[...byGroup.entries()]
    .sort((a,b)=>warningLevelRank(a[1][0]?.level)-warningLevelRank(b[1][0]?.level)||b[1].length-a[1].length||a[0].localeCompare(b[0]))
    .map(([name,items])=>{
      const critical=items.filter(item=>item.level==='critical').length;
      const shown=items.slice(0,10),hidden=items.slice(10,30);
      return `<section class="warning-group-card ${critical?'critical':''}">
        <header><div><b>${esc(name)}</b><span>${critical?`${critical} critical · `:''}${items.length} warning${items.length===1?'':'s'}</span></div></header>
        ${shown.map(row).join('')}
        ${hidden.length?`<details class="warning-group-more"><summary>Show ${items.length-shown.length} more</summary>${hidden.map(row).join('')}${items.length>shown.length+hidden.length?`<p>${items.length-shown.length-hidden.length} more not shown.</p>`:''}</details>`:''}
      </section>`;
    })
    .join('');
  return `<section class="desk-section warning-group-section"><h2>Warning groups</h2>${groups}</section>`;
}

  global.AeroWarningUi={warningsDeskMarkup};
  global.warningsDeskMarkup=warningsDeskMarkup;
})(window);
