/* Combined incident and warning attention feed. */
(function(global){
function incidentFlightRow(flight){
  return `<button type="button" data-case-affected-flight="${esc(flight.id)}">
    <span><b>${esc(flight.id)}</b><em>${esc(flight.route)}</em></span>
    <small>${esc(flight.detail)}</small>
  </button>`;
}

function incidentRequiredResponse(response){
  if(!response) return '';
  const ownerLabel=response.ownerLabel||'Operational desk';
  if(response.status==='pending'){
    return `<section class="incident-required-response pending" data-required-response-progress data-response-start="${Number(response.requestedAt)||0}" data-response-end="${Number(response.respondsAt)||0}" data-response-due-label="${esc(`${ownerLabel} response due`)}">
      <div><b>${esc(response.label||`${ownerLabel} response`)}</b><span data-required-response-remaining>${esc(response.remainingLabel||'Awaiting response')}</span></div>
      <div class="progress-track" role="progressbar" aria-label="${esc(`${ownerLabel} response`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(response.progress*100)}"><span style="width:${formatPct(response.progress)}"></span></div>
    </section>`;
  }
  return `<section class="incident-required-response received">
    <span>${esc(response.label||`${ownerLabel} response`)} received</span>
    <b>${esc(response.title||'Assessment available')}</b>
    ${(response.severityLabel||response.decision)?`<div class="incident-response-facts">${response.severityLabel?`<span><em>Severity</em>${esc(response.severityLabel)}</span>`:''}${response.decision?`<span><em>Flight deck</em>${esc(response.decision)}</span>`:''}</div>`:''}
    <p>${esc(response.detail||'The operational response is available for OCC coordination.')}</p>
  </section>`;
}

function incidentDefaultCountdown(consequence){
  if(!consequence) return '';
  return `<section class="incident-default-countdown ${esc(consequence.status||'pending')}" data-problem-default-countdown data-default-start="${Number(consequence.startAt)||0}" data-default-deadline="${Number(consequence.deadline)||0}">
    <div><b>${esc(consequence.label||'No-action default')}</b><span data-default-countdown-remaining>${esc(consequence.remainingLabel||'')}</span></div>
    <div class="progress-track" role="progressbar" aria-label="No-action default countdown" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((Number(consequence.progress)||0)*100)}"><span style="width:${formatPct(Number(consequence.progress)||0)}"></span></div>
    <p>${esc(consequence.detail||'')}</p>
  </section>`;
}

function incidentCrewAbsences(absences=[]){
  if(!absences.length) return '';
  return `<section class="incident-crew-absence"><span>Unavailable crew</span>${absences.map(item=>`<div><b>${Number(item.count)||1} ${esc(PERSONNEL[item.role]?.label||item.role)}</b><small>${esc([item.family,item.until?`unavailable until ${formatTime(item.until)}`:''].filter(Boolean).join(' · '))}</small></div>`).join('')}</section>`;
}

function incidentCard(incident){
  const visible=incident.flights.slice(0,3);
  const hidden=incident.flights.slice(3);
  const overflow=Math.max(hidden.length,incident.affectedCount-visible.length);
  const unknownOverflow=Math.max(0,overflow-hidden.length);
  return `<article class="desk-list-row warning-row critical incident-attention-card" data-critical-incident="${esc(incident.id)}">
    <header class="incident-attention-header">
      <div><b>${esc(incident.title)}</b><span>${esc(incident.summary)}</span></div>
      <em>${esc(incident.status)}</em>
    </header>
    ${incident.scope?`<span class="incident-attention-scope">${esc(incident.scope)}</span>`:''}
    ${incidentRequiredResponse(incident.requiredResponse)}
    ${incidentDefaultCountdown(incident.defaultConsequence)}
    ${incidentCrewAbsences(incident.crewAbsences)}
    ${visible.length?`<div class="incident-affected-list"><span>Affected flights</span>${visible.map(incidentFlightRow).join('')}${hidden.length?`<details><summary>+${overflow} more</summary>${hidden.map(incidentFlightRow).join('')}${unknownOverflow?`<small>+${unknownOverflow} additional affected flights</small>`:''}</details>`:overflow?`<small>+${overflow} more affected</small>`:''}</div>`:''}
  </article>`;
}

function refreshRequiredResponseProgress(root=document){
  const now=typeof simNow==='function'?simNow():Date.now();
  root.querySelectorAll('[data-required-response-progress]').forEach(section=>{
    const start=Number(section.dataset.responseStart)||now;
    const end=Math.max(start+1,Number(section.dataset.responseEnd)||start+1);
    const progress=Math.max(0,Math.min(1,(now-start)/(end-start)));
    const remaining=Math.max(0,Math.ceil((end-now)/60_000));
    const track=section.querySelector('.progress-track');
    const bar=track?.querySelector('span');
    if(bar) bar.style.width=`${Math.round(progress*100)}%`;
    if(track) track.setAttribute('aria-valuenow',String(Math.round(progress*100)));
    const label=section.querySelector('[data-required-response-remaining]');
    if(label) label.textContent=remaining?`${remaining} min remaining`:(section.dataset.responseDueLabel||'Response due');
  });
  root.querySelectorAll('[data-problem-default-countdown]').forEach(section=>{
    const start=Number(section.dataset.defaultStart)||now;
    const deadline=Math.max(start+1,Number(section.dataset.defaultDeadline)||start+1);
    const progress=Math.max(0,Math.min(1,(now-start)/(deadline-start)));
    const remaining=Math.max(0,Math.ceil((deadline-now)/60_000));
    const track=section.querySelector('.progress-track');
    const bar=track?.querySelector('span');
    if(bar) bar.style.width=`${Math.round(progress*100)}%`;
    if(track) track.setAttribute('aria-valuenow',String(Math.round(progress*100)));
    const label=section.querySelector('[data-default-countdown-remaining]');
    if(label) label.textContent=remaining?`${remaining} min remaining`:'Default action due';
  });
}

function criticalIncidentsMarkup(incidents){
  if(!incidents.length) return '';
  return `<section class="attention-feed-section critical-feed">
    <header class="attention-feed-heading"><h2>Critical</h2><span>${incidents.length}</span></header>
    <div class="attention-feed-list">${incidents.map(incidentCard).join('')}</div>
  </section>`;
}

function warningRow(warning){
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
}

function warningGroupsMarkup(warnings){
  if(!warnings.length) return '';
  const byGroup=new Map();
  for(const warning of warnings) mapPush(byGroup,warning.group||'Other warnings',warning);
  const groups=[...byGroup.entries()]
    .sort((a,b)=>warningLevelRank(a[1][0]?.level)-warningLevelRank(b[1][0]?.level)||b[1].length-a[1].length||a[0].localeCompare(b[0]))
    .map(([name,items])=>{
      const critical=items.filter(item=>item.level==='critical').length;
      const shown=items.slice(0,10),hidden=items.slice(10,30);
      return `<section class="warning-group-card ${critical?'critical':''}">
        <header><div><b>${esc(name)}</b><span>${critical?`${critical} critical · `:''}${items.length} warning${items.length===1?'':'s'}</span></div></header>
        ${shown.map(warningRow).join('')}
        ${hidden.length?`<details class="warning-group-more"><summary>Show ${items.length-shown.length} more</summary>${hidden.map(warningRow).join('')}${items.length>shown.length+hidden.length?`<p>${items.length-shown.length-hidden.length} more not shown.</p>`:''}</details>`:''}
      </section>`;
    })
    .join('');
  return `<section class="attention-feed-section warning-feed">
    <header class="attention-feed-heading"><h2>Warnings</h2><span>${warnings.length}</span></header>
    <div class="warning-group-section">${groups}</div>
  </section>`;
}

function incidentsWarningsDeskMarkup(incidents,warnings){
  if(!incidents.length&&!warnings.length){
    return '<div class="occ-clear-state"><b>Operation normal</b><span>No incidents or derived warnings require attention.</span></div>';
  }
  return `${criticalIncidentsMarkup(incidents)}${warningGroupsMarkup(warnings)}`;
}

  global.AeroWarningUi={incidentsWarningsDeskMarkup,refreshRequiredResponseProgress};
  global.incidentsWarningsDeskMarkup=incidentsWarningsDeskMarkup;
  global.refreshRequiredResponseProgress=refreshRequiredResponseProgress;
})(window);
