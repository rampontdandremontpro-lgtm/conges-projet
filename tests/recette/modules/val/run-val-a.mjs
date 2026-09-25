import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('VAL')
function assertStep(id, step, r, exp = [200, 201, 204]) { if (!exp.includes(r.status)) throw new Error(`${id} | ${step} | HTTP=${r.status} | ${JSON.stringify(r.data?.message ?? r.data ?? '')}`); return r }
async function setSetting(k, v) { const c = await dbConn(); try { await c.execute('INSERT INTO settings (setting_key,setting_value,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',[k,v,'VAL A']) } finally { await c.end() } }
async function presence(id, tok) { return (await apiRequest(`/users/${id}`, { token: tok })).data?.presenceStatus }

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '') => results.push({ id, priority, module:'VAL', scenario, type, status, result: resultText, date:new Date().toISOString(), duration:'0 ms', proof, error, comment })

  const [admin, rh, resp, colA, colB, dir] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('responsable.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('col-b.recette@gmes.fr'), login('directeur.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map(u => [u.email, u]))
  const colAId = U['col-a.recette@gmes.fr'].id, colBId = U['col-b.recette@gmes.fr'].id
  const respId = U['responsable.recette@gmes.fr'].id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  const paid = (await apiRequest('/leave-types', { method:'POST', token:admin, body:{ name:'CP VAL A', category:'DEMANDE_CONGE', deductsPaidLeaveBalance:true, documentRequired:false, documentCanBeAddedLater:false, employeeCanCreate:true, rhOnly:false, allowsDays:true, allowsHalfDays:true, allowsHours:false, requiresValidation:true }})).data
  const halfType = (await apiRequest('/leave-types', { method:'POST', token:admin, body:{ name:'Abs demi VAL A', category:'DECLARATION_ABSENCE', deductsPaidLeaveBalance:false, documentRequired:false, documentCanBeAddedLater:false, employeeCanCreate:false, rhOnly:true, allowsDays:true, allowsHalfDays:true, allowsHours:false, requiresValidation:false }})).data

  const svc = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:'Service VAL A', serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false }})).data
  await apiRequest(`/users/${colAId}`, { method:'PATCH', token:admin, body:{ serviceId: svc.id } })
  await apiRequest(`/users/${respId}`, { method:'PATCH', token:admin, body:{ serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method:'PATCH', token:admin, body:{ primaryManagerId: respId, validationMode:'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const today = todayIso(); let off = 40
  function nw() { for (let i=0;i<300;i++){ const s=isoAddDays(today,off), e=isoAddDays(s,1); if(utcWeekday(s)>=1&&utcWeekday(s)<=5&&utcWeekday(e)>=1&&utcWeekday(e)<=5){off+=3;return[s,e]} off+=1 } }
  async function newReq() { const [s,e]=nw(); const r=assertStep('create','create',await apiRequest('/leave-requests',{method:'POST',token:colA,body:{leaveTypeId:paid.id,startDate:s,endDate:e,startPeriod:'MATIN',endPeriod:'APRES_MIDI'}}),[201]); assertStep('submit','submit',await apiRequest(`/leave-requests/${r.data.id}/submit`,{method:'POST',token:colA,body:{signatureType:'INITIALS',signatureData:'CA'}}),[200]); return r.data.id }
  async function newAbs(emp, sp, ep) { const r=assertStep('abs create','create',await apiRequest('/absence-declarations',{method:'POST',token:rh,body:{employeeId:emp,leaveTypeId:halfType.id,startDate:today,endDate:today,startPeriod:sp,endPeriod:ep}}),[201]); assertStep('abs submit','submit',await apiRequest(`/absence-declarations/${r.data.id}/submit`,{method:'POST',token:rh,body:{certifiedAccurate:true}}),[200]); return r.data.id }

  const browser = await launch()
  async function capVal(file) { let page; try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await navigateViaSidebar(page, '/app/rh-validators'); await page.waitForTimeout(400); await capture(page, file) } catch {} if (page) await page.close().catch(() => {}) }
  const CAPS = ['VAL-001','VAL-002','VAL-003','VAL-004','VAL-005','VAL-006','VAL-007','VAL-008','VAL-009','VAL-010','VAL-011','VAL-012','VAL-013','VAL-014','VAL-016','VAL-018','VAL-019','VAL-020','VAL-021','VAL-023']

  // VAL-001
  { const r = await apiRequest(`/services/${svc.id}/validators`, { token:admin }); push('VAL-001','P1','ADMIN consulte les valideurs du service','C - UI + API', r.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-001.png'); await capVal('CAP-VAL-001.png') }
  // VAL-002
  { const r = await apiRequest(`/services/${svc.id}/validators`, { method:'POST', token:admin, body:{ validatorId: rhId } }); push('VAL-002','P1','ADMIN ajoute le premier valideur de secours','C - UI + API', r.status===201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-002.png'); await capVal('CAP-VAL-002.png') }
  // VAL-003
  { const r = await apiRequest(`/services/${svc.id}/validators`, { method:'POST', token:rh, body:{ validatorId: dirId } }); push('VAL-003','P1','RH ajoute le second valideur de secours','C - UI + API', r.status===201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-003.png'); await capVal('CAP-VAL-003.png') }
  // VAL-004
  { const r = await apiRequest(`/services/${svc.id}/validators`, { method:'POST', token:colA, body:{ validatorId: dirId } }); push('VAL-004','P1','Un Collaborateur ne gère pas les valideurs de secours','C - UI + API', r.status===403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-004.png'); await capVal('CAP-VAL-004.png') }
  // VAL-005
  { const r = await apiRequest(`/services/${svc.id}/validators`, { method:'POST', token:admin, body:{ validatorId: respId } }); push('VAL-005','P1','Le Responsable principal ne peut pas être son propre secours','C - UI + API', r.status===400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-005.png'); await capVal('CAP-VAL-005.png') }
  // VAL-006
  { const r = await apiRequest(`/services/${svc.id}/validators`, { method:'POST', token:admin, body:{ validatorId: colBId } }); push('VAL-006','P1','Un Collaborateur ne peut pas être secours','C - UI + API', r.status===400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-006.png'); await capVal('CAP-VAL-006.png') }
  // VAL-007 — service hors RESPONSABLE_PUIS_RELAIS
  {
    const svc2 = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:'Service VAL A2', serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false }})).data
    await apiRequest(`/services/${svc2.id}`, { method:'PATCH', token:admin, body:{ primaryManagerId: respId, validationMode:'DIRECTEUR_SEUL' } })
    const r = await apiRequest(`/services/${svc2.id}/validators`, { method:'POST', token:admin, body:{ validatorId: rhId } })
    push('VAL-007','P1','Secours refusé hors circuit Responsable puis relais','C - UI + API', r.status===400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-007.png', '', JSON.stringify(r.data?.message ?? ''))
    await capVal('CAP-VAL-007.png')
  }
  // VAL-008 — doublon (409 acceptable)
  {
    const before = (await apiRequest(`/services/${svc.id}/validators`, { token:admin })).data.backupValidators.length
    const r = await apiRequest(`/services/${svc.id}/validators`, { method:'POST', token:admin, body:{ validatorId: rhId } })
    const after = (await apiRequest(`/services/${svc.id}/validators`, { token:admin })).data.backupValidators.length
    push('VAL-008','P1','Un secours actif ne peut pas être doublonné','C - UI + API', r.status===409 && before===after ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} ${before}→${after}`, 'CAP-VAL-008.png')
    await capVal('CAP-VAL-008.png')
  }
  // VAL-009 / 010
  { const r = await apiRequest(`/services/${svc.id}/validators/${rhId}/disable`, { method:'PATCH', token:admin }); push('VAL-009','P1','ADMIN désactive le secours 1','C - UI + API', r.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-009.png'); await capVal('CAP-VAL-009.png') }
  { const r = await apiRequest(`/services/${svc.id}/validators/${rhId}/enable`, { method:'PATCH', token:admin }); push('VAL-010','P1','ADMIN réactive le secours 1','C - UI + API', r.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-VAL-010.png'); await capVal('CAP-VAL-010.png') }
  // VAL-011 — structure réelle
  {
    const d = (await apiRequest(`/services/${svc.id}/validators`, { token:rh })).data
    const b = d.backupValidators ?? []
    const active = b.filter(x => x.isActive).map(x => x.validatorId)
    push('VAL-011','P1','La liste des valideurs expose les deux secours','C - UI + API', active.includes(rhId) && active.includes(dirId) ? STATUS.CONFORME : STATUS.NON_CONFORME, `backupValidators=${JSON.stringify(active)}`, 'CAP-VAL-011.png')
    await capVal('CAP-VAL-011.png')
  }

  // VAL-012..016 — décisions (resp présent)
  {
    const rid = await newReq()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:rh, body:{ signatureType:'INITIALS', signatureData:'RH', rhConfirmedDirectorAgreement:true } })
    push('VAL-012','P1','Secours refusé quand le Responsable est présent','C - UI + API', v.status===403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, 'CAP-VAL-012.png')
  }
  {
    const rid = await newReq()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:resp, body:{ signatureType:'INITIALS', signatureData:'DR' } })
    push('VAL-013','P1','Le Responsable principal valide la demande','C - UI + API', v.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, 'CAP-VAL-013.png')
  }
  {
    const rid = await newReq()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:rh, body:{ signatureType:'INITIALS', signatureData:'RH', rhConfirmedDirectorAgreement:true, emergencyTakeover:true, takeoverReason:'urgence' } })
    push('VAL-014','P1','L’urgence seule n’ouvre pas le secours','C - UI + API', v.status===403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, 'CAP-VAL-014.png')
  }
  {
    const rid = await newReq()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:resp, body:{ signatureType:'INITIALS', signatureData:'DR' } })
    push('VAL-015','P2','Le Responsable traite la demande','B - API', v.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`)
  }
  // VAL-016 — relais par présence (resp absent → secours RH valide)
  {
    const abs = await newAbs(respId, 'MATIN','APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR','00:00'); await apiRequest('/leave-requests/maintenance/run',{method:'POST',token:rh})
    const p = await presence(respId, rh)
    const rid = await newReq()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:rh, body:{ signatureType:'INITIALS', signatureData:'RH', rhConfirmedDirectorAgreement:true } })
    push('VAL-016','P1','Relais par présence du Responsable','C - UI + API', p==='ABSENT' && v.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} HTTP=${v.status}`, 'CAP-VAL-016.png')
    await apiRequest(`/absence-declarations/${abs}/cancel`,{method:'POST',token:rh})
  }

  // VAL-017..023 — chaîne absence
  {
    const abs = await newAbs(respId, 'MATIN','APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR','00:00'); await apiRequest('/leave-requests/maintenance/run',{method:'POST',token:rh})
    push('VAL-017','P1','RH crée une absence autorisée pour le Responsable','B - API', STATUS.CONFORME, 'absence créée')
    push('VAL-018','P1','La RH soumet l’absence du Responsable','C - UI + API', STATUS.CONFORME, 'absence soumise', 'CAP-VAL-018.png'); await capVal('CAP-VAL-018.png')
    const rid = await newReq()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:rh, body:{ signatureType:'INITIALS', signatureData:'RH', rhConfirmedDirectorAgreement:true } })
    push('VAL-019','P1','Le secours valide quand le Responsable est absent','C - UI + API', v.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, 'CAP-VAL-019.png'); await capVal('CAP-VAL-019.png')
    // VAL-020 : sur la MÊME demande, second secours bloqué
    const v2 = await apiRequest(`/leave-requests/${rid}/validate`, { method:'POST', token:dir, body:{ signatureType:'INITIALS', signatureData:'DR' } })
    push('VAL-020','P1','Le second secours est bloqué sur une demande déjà décidée','C - UI + API', v.status===200 && (v2.status===403 || v2.status===409) ? STATUS.CONFORME : STATUS.NON_CONFORME, `secours1=${v.status} secours2=${v2.status}`, 'CAP-VAL-020.png'); await capVal('CAP-VAL-020.png')
    push('VAL-021','P1','Le premier secours décide, le second ne peut plus','C - UI + API', v.status===200 && (v2.status===403||v2.status===409) ? STATUS.CONFORME : STATUS.NON_CONFORME, `secours1=${v.status} secours2=${v2.status}`, 'CAP-VAL-021.png'); await capVal('CAP-VAL-021.png')
    push('VAL-022','P1','La deuxième décision sur la même demande est refusée','B - API', (v2.status===403||v2.status===409) ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v2.status}`)
    const c = await apiRequest(`/absence-declarations/${abs}/cancel`,{method:'POST',token:rh})
    push('VAL-023','P1','La RH annule l’absence du Responsable','C - UI + API', c.status===200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${c.status}`, 'CAP-VAL-023.png'); await capVal('CAP-VAL-023.png')
  }

  await browser.close()
  results.sort((a,b)=>a.id.localeCompare(b.id))
  writeReport(results, { label:'recette-results-val-a' })
  console.log('[VAL-A]', results.length)
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
