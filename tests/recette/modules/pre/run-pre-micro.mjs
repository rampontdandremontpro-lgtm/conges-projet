import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('PRE')
function assertStep(s, step, r, exp=[200,201]) { if(!exp.includes(r.status)) throw new Error(`${s} | ${step} | HTTP=${r.status} | ${JSON.stringify(r.data?.message ?? r.data ?? '')}`); return r }
async function setSetting(k,v){ const c=await dbConn(); try{ await c.execute('INSERT INTO settings (setting_key,setting_value,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',[k,v,'PRE micro'])} finally{ await c.end() } }
async function presence(id,tok){ return (await apiRequest(`/users/${id}`,{token:tok})).data?.presenceStatus }
async function maintenance(rh){ return apiRequest('/leave-requests/maintenance/run',{method:'POST',token:rh}) }

async function run(){
  ensurePreuves()
  const results=[]
  const push=(id,priority,scenario,type,status,resultText,error='',comment='')=>results.push({id,priority,module:'PRE',scenario,type,status,result:resultText,date:new Date().toISOString(),duration:'0 ms',proof:'',error,comment})
  const [admin,rh,colA,resp,dir]=await Promise.all([login('admin.recette@gmes.fr'),login('rh.recette@gmes.fr'),login('col-a.recette@gmes.fr'),login('responsable.recette@gmes.fr'),login('directeur.recette@gmes.fr')])
  const users=(await apiRequest('/users',{token:rh})).data
  const col=users.find(u=>u.email==='col-a.recette@gmes.fr'); const r=users.find(u=>u.email==='responsable.recette@gmes.fr')
  const rhId=(await apiRequest('/users/me',{token:rh})).data.id
  const paid=(await apiRequest('/leave-types',{method:'POST',token:admin,body:{name:'CP PRE micro',category:'DEMANDE_CONGE',deductsPaidLeaveBalance:true,documentRequired:false,documentCanBeAddedLater:false,employeeCanCreate:true,rhOnly:false,allowsDays:true,allowsHalfDays:true,allowsHours:false,requiresValidation:true}})).data
  const halfType=(await apiRequest('/leave-types',{method:'POST',token:admin,body:{name:'Abs demi PRE micro',category:'DECLARATION_ABSENCE',deductsPaidLeaveBalance:false,documentRequired:false,documentCanBeAddedLater:false,employeeCanCreate:false,rhOnly:true,allowsDays:true,allowsHalfDays:true,allowsHours:false,requiresValidation:false}})).data
  const svc=(await apiRequest('/services',{method:'POST',token:admin,body:{name:'Svc PRE micro',serviceType:'INTERNE',minimumPresence:1,hasMinimumPresenceRule:false}})).data
  await apiRequest(`/users/${col.id}`,{method:'PATCH',token:admin,body:{serviceId:svc.id}})
  await apiRequest(`/users/${r.id}`,{method:'PATCH',token:admin,body:{serviceId:svc.id}})
  await apiRequest(`/services/${svc.id}`,{method:'PATCH',token:admin,body:{primaryManagerId:r.id,validationMode:'RESPONSABLE_PUIS_RELAIS',takeoverDelayDays:7}})
  assertStep('backup','assign',await apiRequest(`/services/${svc.id}/validators`,{method:'POST',token:admin,body:{validatorId:rhId}}))
  const today=todayIso(); let off=40
  function nw(){ for(let i=0;i<300;i++){ const s=isoAddDays(today,off), e=isoAddDays(s,1); if(utcWeekday(s)>=1&&utcWeekday(s)<=5&&utcWeekday(e)>=1&&utcWeekday(e)<=5){off+=3;return[s,e]} off+=1 } }
  async function newReq(){ const [s,e]=nw(); const r=assertStep('create','create',await apiRequest('/leave-requests',{method:'POST',token:colA,body:{leaveTypeId:paid.id,startDate:s,endDate:e,startPeriod:'MATIN',endPeriod:'APRES_MIDI'}}),[201]); assertStep('submit','submit',await apiRequest(`/leave-requests/${r.data.id}/submit`,{method:'POST',token:colA,body:{signatureType:'INITIALS',signatureData:'CA'}}),[200]); return r.data.id }
  async function newAbs(emp,sp,ep){ const r=assertStep('abs create','create',await apiRequest('/absence-declarations',{method:'POST',token:rh,body:{employeeId:emp,leaveTypeId:halfType.id,startDate:today,endDate:today,startPeriod:sp,endPeriod:ep}}),[201]); assertStep('abs submit','submit',await apiRequest(`/absence-declarations/${r.data.id}/submit`,{method:'POST',token:rh,body:{certifiedAccurate:true}}),[200]); return r.data.id }

  // PRE-018 : RH backup reprend (resp ABSENT)
  let req18
  {
    const abs=await newAbs(r.id,'MATIN','APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR','00:00'); await maintenance(rh)
    const p=await presence(r.id,rh)
    req18=await newReq()
    const v=await apiRequest(`/leave-requests/${req18}/validate`,{method:'POST',token:rh,body:{signatureType:'INITIALS',signatureData:'RH',rhConfirmedDirectorAgreement:true}})
    push('PRE-018','P1','La RH reprend la validation via le relais (Responsable ABSENT)','B - API', v.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} HTTP=${v.status} status=${v.data?.status}`, '', JSON.stringify(v.data?.message ?? ''))
    await apiRequest(`/absence-declarations/${abs}/cancel`,{method:'POST',token:rh})
  }
  // PRE-019 : audit REPRISE_PAR_RELAIS sur req18 avec acteur RH
  {
    const c=await dbConn()
    try{
      const [rows]=await c.execute(`SELECT action, actor_id AS aid FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [req18])
      const ok=rows.length>0 && Number(rows[0].aid)===Number(rhId)
      push('PRE-019','P1','Le relais est tracé dans l’audit (REPRISE_PAR_RELAIS)','B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `traces=${rows.length} actor=${rows[0]?.aid} rh=${rhId}`, '', ok?'':'ANO-016 : la reprise RH (secours) ne trace pas REPRISE_PAR_RELAIS.')
    } finally { await c.end() }
  }

  // PRE-027 : indépendant slot par slot
  {
    // MATIN
    const abs=await newAbs(r.id,'MATIN','MATIN')
    await setSetting('AFTERNOON_START_HOUR','23:59'); await maintenance(rh)
    const pM=await presence(r.id,rh)
    const ridM=await newReq()
    const vM=await apiRequest(`/leave-requests/${ridM}/validate`,{method:'POST',token:rh,body:{signatureType:'INITIALS',signatureData:'RH',rhConfirmedDirectorAgreement:true}})
    // APRES_MIDI
    await setSetting('AFTERNOON_START_HOUR','00:00'); await maintenance(rh)
    const pA=await presence(r.id,rh)
    const ridA=await newReq()
    const vA=await apiRequest(`/leave-requests/${ridA}/validate`,{method:'POST',token:rh,body:{signatureType:'INITIALS',signatureData:'RH',rhConfirmedDirectorAgreement:true}})
    const ok = pM==='ABSENT' && vM.status===200 && pA==='PRESENT' && vA.status===403
    push('PRE-027','P2','Le relais du Responsable est décidé slot par slot (demi-journée)','B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `MATIN presence=${pM} relais=${vM.status} | APRES_MIDI presence=${pA} relais=${vA.status}`)
    await apiRequest(`/absence-declarations/${abs}/cancel`,{method:'POST',token:rh})
  }

  results.sort((a,b)=>a.id.localeCompare(b.id))
  writeReport(results,{label:'recette-results-pre-micro'})
  console.log('[PRE-MICRO]', results.length)
}
run().catch(e=>{console.error('ERR',e.message);process.exit(1)})
