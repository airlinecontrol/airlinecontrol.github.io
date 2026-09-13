/* Shared crew-duty presentation; the assignment service owns clocks and legality. */
(function(global){
  const ROLES={captains:{label:'Captain',short:'CPT'},firstOfficers:{label:'First officer',short:'FO'},cabinCrew:{label:'Cabin crew',short:'CAB'}};

  function marginText(hours){
    const duration=formatDuration(Math.abs(hours)*HOUR);
    return hours<0?`${duration} over limit`:`${duration} margin`;
  }

  function timeRange(start,end){
    const differentDay=new Date(start).toDateString()!==new Date(end).toDateString();
    return `${shortClock(start)} - ${differentDay?`${shortDay(end)} `:''}${shortClock(end)}`;
  }

  function signature(duty){
    return JSON.stringify([duty.dutyStart,duty.dutyEnd,duty.dutyHours,duty.maxHours,duty.legal,duty.status,duty.roleDuties,duty.roleSwaps]);
  }

  function describe(duty){
    const start=duty.reportAt??duty.dutyStart,end=duty.releaseAt??duty.dutyEnd;
    const roles=Object.entries(ROLES).filter(([role])=>duty.roleDuties?.[role]).map(([role,names])=>{
      const data=duty.roleDuties[role];
      const segments=data.segments?.length?data.segments:[data];
      return {role,...names,...data,segments,margin:data.maxHours-data.dutyHours,
        replaced:(duty.roleSwaps||[]).some(swap=>swap.role===role)};
    });
    const margin=roles.length?Math.min(...roles.map(role=>role.margin)):Number(duty.maxHours||0)-Number(duty.dutyHours||0);
    const limiting=roles.filter(role=>Math.abs(role.margin-margin)<1/60);
    const clockKeys=roles.map(role=>JSON.stringify(role.segments.map(segment=>[
      Math.round(segment.dutyStart/MIN),Math.round(segment.dutyEnd/MIN),Math.round(segment.maxHours*60)
    ])));
    const different=clockKeys.some(key=>key!==clockKeys[0]);
    const limitingLabel=different?limiting.map(role=>role.label).join(' / '):'All required roles';
    const badge=different?`${limiting.map(role=>role.short).join('/')} limit`:'';
    const lines=[(duty.flightIds||[]).join(' + '),`Crew coverage: ${timeRange(start,end)}`,
      `Limiting: ${limitingLabel} · ${marginText(margin)}`,
      `${duty.sectors||1} sector${duty.sectors===1?'':'s'}`];
    if(different){
      for(const role of roles){
        const periods=new Set(role.segments.map(segment=>segment.dutyStart)).size;
        lines.push('',`${role.label}${role.replaced?' (replacement)':''}`,
          `${periods>1?`Limiting duty of ${periods} periods`:'Report - release'}: ${timeRange(role.dutyStart,role.dutyEnd)}`,
          `Duty ${formatDuration(role.dutyHours*HOUR)} · limit ${formatDuration(role.maxHours*HOUR)} · ${marginText(role.margin)}`);
      }
    }else{
      lines.push(`Shared duty ${formatDuration(Number(duty.dutyHours||0)*HOUR)} · limit ${formatDuration(Number(duty.maxHours||0)*HOUR)}`);
    }
    const swaps=[...new Set((duty.roleSwaps||[]).map(swap=>ROLES[swap.role]?.label||swap.role))];
    if(swaps.length&&!different) lines.push(`Role replacement: ${swaps.join(', ')}`);
    if(duty.augmented) lines.push('Augmented crew planned');
    return {start,end,margin,roles,limiting,different,badge,legal:duty.legal,tooltip:lines.filter((line,index)=>line||index>0).join('\n')};
  }

  global.AeroCrewDutyUi={describe,signature};
})(window);
