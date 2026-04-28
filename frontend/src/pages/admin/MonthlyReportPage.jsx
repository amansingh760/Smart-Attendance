import React, { useState, useEffect, useRef, useCallback } from 'react';
import { attendanceAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { fmtTime, fmtMins } from '../../utils/timeUtils';

const STATUS_COLOR = {
  present:  { bg:'rgba(52,211,153,0.18)',  border:'rgba(52,211,153,0.4)',   text:'#34d399' },
  late:     { bg:'rgba(251,191,36,0.18)',  border:'rgba(251,191,36,0.4)',   text:'#fbbf24' },
  absent:   { bg:'rgba(248,113,113,0.14)', border:'rgba(248,113,113,0.35)', text:'#f87171' },
  'on-leave':{ bg:'rgba(91,156,246,0.15)', border:'rgba(91,156,246,0.35)', text:'#63b3ed' },
  holiday:  { bg:'rgba(167,139,250,0.14)', border:'rgba(167,139,250,0.3)', text:'#b794f4' },
  sunday:   { bg:'rgba(74,93,128,0.1)',    border:'var(--border)',          text:'var(--text3)' },
  none:     { bg:'transparent',            border:'var(--border)',          text:'var(--text3)' },
};

function pctColor(p){ return p>=90?'var(--green)':p>=75?'var(--amber)':'var(--red)'; }

function DonutRing({ pct, color, size=40 }) {
  const r=(size-6)/2, circ=2*Math.PI*r, dash=(pct/100)*circ;
  return (
    <svg width={size} height={size} style={{transform:'rotate(-90deg)',flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:'stroke-dasharray 0.6s'}}/>
    </svg>
  );
}

export default function MonthlyReportPage() {
  const { toast } = useToast();
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const [month, setMonth]         = useState(defaultMonth);
  const [report, setReport]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [view, setView]           = useState('summary');
  const [expandedId, setExpandedId] = useState(null);
  const [sortKey, setSortKey]     = useState('name');
  const [sortDir, setSortDir]     = useState(1);
  const [deptFilter, setDeptFilter] = useState('');

  const load = useCallback(async (m) => {
    setLoading(true); setReport(null);
    try { const r = await attendanceAPI.monthlyReport(m); setReport(r.data); }
    catch (err) { toast(err.response?.data?.error||'Failed to load','error'); }
    setLoading(false);
  },[toast]);

  useEffect(()=>{ load(month); },[month]);

  const handleSort = k => { if(sortKey===k) setSortDir(d=>-d); else{setSortKey(k);setSortDir(1);} };
  const SortBtn = ({k,children}) => (
    <button onClick={()=>handleSort(k)} style={{background:'none',border:'none',cursor:'pointer',padding:0,color:sortKey===k?'var(--accent)':'var(--text3)',fontFamily:'var(--font)',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.6px',display:'flex',alignItems:'center',gap:4}}>
      {children}<span style={{opacity:sortKey===k?1:0.3}}>{sortDir===1?'↑':'↓'}</span>
    </button>
  );

  const employees = report?.employees||[];
  const depts = [...new Set(employees.map(e=>e.dept).filter(Boolean))].sort();
  const filtered = employees
    .filter(e=>!deptFilter||e.dept===deptFilter)
    .sort((a,b)=>{
      const vs={name:[a.name,b.name],presentDays:[a.presentDays,b.presentDays],absentDays:[a.absentDays,b.absentDays],lateDays:[a.lateDays,b.lateDays],totalMins:[a.totalMins,b.totalMins],attendancePct:[a.attendancePct,b.attendancePct]};
      const [va,vb]=vs[sortKey]||[a.name,b.name];
      return sortDir*(va>vb?1:va<vb?-1:0);
    });

  const totalPresent=employees.reduce((s,e)=>s+e.presentDays,0);
  const totalLate=employees.reduce((s,e)=>s+e.lateDays,0);
  const totalHours=employees.reduce((s,e)=>s+e.totalMins,0);
  const overallPct=employees.length&&report?.workdays?Math.round(employees.reduce((s,e)=>s+e.attendancePct,0)/employees.length):0;
  const maxMins=Math.max(...employees.map(e=>Math.max(...(e.days||[]).map(d=>d.workMins||0))),1);
  const monthLabel=new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN',{month:'long',year:'numeric'});

  return (
    <div style={{padding:24}}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{fontFamily:'var(--display)',fontSize:26,fontWeight:800}}>Monthly Report</h1>
          <p style={{color:'var(--text2)',fontSize:14}}>Attendance, hours &amp; late count — {monthLabel}</p>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          {depts.length>1&&<select className="form-select" value={deptFilter} onChange={e=>setDeptFilter(e.target.value)} style={{width:160}}><option value="">All Departments</option>{depts.map(d=><option key={d} value={d}>{d}</option>)}</select>}
          <input type="month" className="form-input" value={month} onChange={e=>setMonth(e.target.value)} style={{width:168}}/>
        </div>
      </div>

      {loading&&<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200}}><span className="pulsing" style={{fontSize:24}}>⟳</span><span style={{marginLeft:10,color:'var(--text2)',fontSize:13}}>Loading report…</span></div>}

      {!loading&&report&&(
        <>
          {/* Top stats */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:12,marginBottom:24}}>
            {[['Working Days',report.workdays,'blue','📅'],['Avg Attendance',`${overallPct}%`,overallPct>=90?'green':overallPct>=75?'amber':'red','📊'],['Total Present',totalPresent,'green','✅'],['Late Arrivals',totalLate,'amber','⏰'],['Total Hours',fmtMins(totalHours),'purple','🕐'],['Holidays',report.holidays.length,'blue','🎉']].map(s=>(
              <div key={s[0]} className="stat-card">
                <div style={{fontSize:18,marginBottom:4}}>{s[3]}</div>
                <div className="stat-label">{s[0]}</div>
                <div className="stat-value" style={{color:`var(--${s[2]})`,fontSize:22}}>{s[1]}</div>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div style={{display:'flex',gap:6,marginBottom:20}}>
            {[['summary','📊 Summary'],['calendar','📅 Calendar'],['hours','⏱ Hours']].map(([id,label])=>(
              <button key={id} onClick={()=>setView(id)} className={`btn btn-sm ${view===id?'btn-primary':'btn-ghost'}`}>{label}</button>
            ))}
          </div>

          {/* Summary table */}
          {view==='summary'&&(
            <div className="card" style={{padding:0,overflow:'hidden'}}>
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th><SortBtn k="name">Employee</SortBtn></th>
                    <th style={{textAlign:'center'}}><SortBtn k="presentDays">Present</SortBtn></th>
                    <th style={{textAlign:'center'}}><SortBtn k="absentDays">Absent</SortBtn></th>
                    <th style={{textAlign:'center'}}><SortBtn k="lateDays">Late</SortBtn></th>
                    <th style={{textAlign:'center'}}><SortBtn k="totalMins">Total Hrs</SortBtn></th>
                    <th style={{textAlign:'center'}}>Avg/Day</th>
                    <th style={{textAlign:'center'}}><SortBtn k="attendancePct">Attendance</SortBtn></th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(emp=>{
                      const pc=pctColor(emp.attendancePct);
                      return (
                        <React.Fragment key={emp.userId}>
                          <tr style={{cursor:'pointer'}} onClick={()=>setExpandedId(expandedId===emp.userId?null:emp.userId)}>
                            <td><div style={{display:'flex',alignItems:'center',gap:10}}>
                              <div className="avatar avatar-sm" style={{background:`${emp.color}22`,color:emp.color}}>{emp.avatar}</div>
                              <div><div style={{fontWeight:600,color:'var(--text)',fontSize:13}}>{emp.name}</div><div style={{fontSize:11,color:'var(--text3)'}}>{emp.dept}</div></div>
                              <span style={{fontSize:10,color:'var(--text3)'}}>{expandedId===emp.userId?'▲':'▼'}</span>
                            </div></td>
                            <td style={{textAlign:'center'}}><span style={{fontWeight:700,color:'var(--green)',fontFamily:'var(--mono)'}}>{emp.presentDays}</span><span style={{color:'var(--text3)',fontSize:11}}>/{report.workdays}</span></td>
                            <td style={{textAlign:'center'}}><span style={{fontWeight:700,fontFamily:'var(--mono)',color:emp.absentDays>0?'var(--red)':'var(--text3)'}}>{emp.absentDays}</span></td>
                            <td style={{textAlign:'center'}}>{emp.lateDays>0?<span className="badge badge-amber" style={{fontSize:11}}>⏰ {emp.lateDays}</span>:<span style={{color:'var(--text3)',fontSize:12}}>—</span>}</td>
                            <td style={{textAlign:'center',fontFamily:'var(--mono)',fontSize:12}}>{fmtMins(emp.totalMins)}</td>
                            <td style={{textAlign:'center',fontFamily:'var(--mono)',fontSize:12}}>{fmtMins(emp.avgMinsPerDay)}</td>
                            <td style={{textAlign:'center'}}><div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><DonutRing pct={emp.attendancePct} color={pc} size={36}/><span style={{fontWeight:700,fontSize:13,color:pc,fontFamily:'var(--mono)'}}>{emp.attendancePct}%</span></div></td>
                          </tr>
                          {expandedId===emp.userId&&(
                            <tr><td colSpan={7} style={{padding:'16px 20px',background:'var(--bg3)'}}>
                              <div style={{fontSize:12,fontWeight:700,color:'var(--text2)',marginBottom:12,textTransform:'uppercase',letterSpacing:'0.6px'}}>Daily breakdown — {emp.name}</div>
                              <div style={{overflowX:'auto'}}>
                                <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                  <thead><tr>{['Date','Day','Status','Check In','Check Out','Hours','Note'].map(h=><th key={h} style={{padding:'5px 10px',textAlign:'left',color:'var(--text3)',fontWeight:700,fontSize:10,textTransform:'uppercase',borderBottom:'1px solid var(--border)',letterSpacing:'0.5px'}}>{h}</th>)}</tr></thead>
                                  <tbody>
                                    {emp.days.filter(d=>!d.isSunday).map(d=>{
                                      const sc=STATUS_COLOR[d.status]||STATUS_COLOR.none;
                                      return (<tr key={d.date} style={{borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                                        <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:'var(--text)'}}>{d.date}</td>
                                        <td style={{padding:'6px 10px',color:'var(--text2)'}}>{new Date(d.date+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short'})}</td>
                                        <td style={{padding:'6px 10px'}}><span style={{padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:600,background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`}}>{d.isHoliday?'🎉 Holiday':d.status}{d.late&&d.status!=='absent'?' (Late)':''}</span></td>
                                        <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:d.late?'var(--amber)':'var(--text2)'}}>{fmtTime(d.checkIn)}</td>
                                        <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:'var(--text2)'}}>{fmtTime(d.checkOut)}</td>
                                        <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:d.workMins>0?'var(--green)':'var(--text3)'}}>{fmtMins(d.workMins)}</td>
                                        <td style={{padding:'6px 10px',color:'var(--text3)',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.note||d.lateReason||'—'}</td>
                                      </tr>);
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {!filtered.length&&<tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">No employees</div></div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Calendar view */}
          {view==='calendar'&&(
            <div>
              <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:12,color:'var(--text2)',fontWeight:600}}>Legend:</span>
                {Object.entries({present:'Present',late:'Late',absent:'Absent','on-leave':'On Leave',holiday:'Holiday'}).map(([k,label])=>{
                  const sc=STATUS_COLOR[k];
                  return <div key={k} style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:12,height:12,borderRadius:3,background:sc.bg,border:`1px solid ${sc.border}`}}/><span style={{fontSize:12,color:'var(--text2)'}}>{label}</span></div>;
                })}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(272px,1fr))',gap:16}}>
                {filtered.map(emp=>{
                  const firstDow=new Date(`${month}-01T00:00:00`).getDay();
                  return (
                    <div key={emp.userId} className="card">
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                        <div className="avatar avatar-sm" style={{background:`${emp.color}22`,color:emp.color}}>{emp.avatar}</div>
                        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{emp.name}</div><div style={{fontSize:11,color:'var(--text3)'}}>{emp.dept}</div></div>
                        <div style={{textAlign:'right'}}><div style={{fontWeight:800,fontSize:16,color:pctColor(emp.attendancePct),fontFamily:'var(--mono)'}}>{emp.attendancePct}%</div><div style={{fontSize:10,color:'var(--text3)'}}>{emp.presentDays}/{report.workdays}</div></div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:4}}>
                        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=><div key={d} style={{textAlign:'center',fontSize:9,color:'var(--text3)',fontWeight:700,padding:'2px 0'}}>{d}</div>)}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
                        {Array(firstDow).fill(null).map((_,i)=><div key={`b${i}`}/>)}
                        {emp.days.map(d=>{
                          const sc=STATUS_COLOR[d.status]||STATUS_COLOR.none;
                          return <div key={d.date} title={`${d.date}${d.checkIn?`\nIn: ${fmtTime(d.checkIn)}`:''}${d.workMins?`\n${fmtMins(d.workMins)}`:''}${d.lateReason?`\nLate: ${d.lateReason}`:''}${d.note?`\nNote: ${d.note}`:''}`} style={{aspectRatio:'1/1',borderRadius:4,background:sc.bg,border:`1px solid ${sc.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,color:sc.text,cursor:'default',transition:'transform 0.1s'}} onMouseEnter={e=>e.currentTarget.style.transform='scale(1.15)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>{parseInt(d.date.split('-')[2])}</div>;
                        })}
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
                        {emp.presentDays>0&&<span className="badge badge-green" style={{fontSize:10}}>✅ {emp.presentDays}</span>}
                        {emp.absentDays>0&&<span className="badge badge-red" style={{fontSize:10}}>❌ {emp.absentDays}</span>}
                        {emp.lateDays>0&&<span className="badge badge-amber" style={{fontSize:10}}>⏰ {emp.lateDays}</span>}
                        <span className="badge badge-purple" style={{fontSize:10}}>🕐 {fmtMins(emp.totalMins)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hours breakdown */}
          {view==='hours'&&(
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              {filtered.slice().sort((a,b)=>b.totalMins-a.totalMins).map(emp=>{
                const expected=report.workdays*9*60;
                const effPct=expected>0?Math.min(100,Math.round((emp.totalMins/expected)*100)):0;
                return (
                  <div key={emp.userId} className="card">
                    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
                      <div className="avatar avatar-md" style={{background:`${emp.color}22`,color:emp.color}}>{emp.avatar}</div>
                      <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15}}>{emp.name}</div><div style={{fontSize:12,color:'var(--text3)'}}>{emp.dept}</div></div>
                      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                        {[['Total',fmtMins(emp.totalMins),'var(--accent)'],['Avg/day',fmtMins(emp.avgMinsPerDay),'var(--green)'],['Late',`${emp.lateDays} days`,emp.lateDays>0?'var(--amber)':'var(--text3)'],['Efficiency',`${effPct}%`,pctColor(effPct)]].map(([l,v,c])=>(
                          <div key={l} style={{textAlign:'center'}}><div style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:14,color:c}}>{v}</div><div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.4px'}}>{l}</div></div>
                        ))}
                      </div>
                    </div>
                    <div style={{overflowX:'auto',paddingBottom:4}}>
                      <div style={{display:'flex',gap:4,alignItems:'flex-end',minWidth:emp.days.length*22,height:80}}>
                        {emp.days.map(d=>{
                          if(d.isSunday) return <div key={d.date} style={{width:18,flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}><div style={{flex:1}}/><div style={{height:2,width:'100%',background:'var(--bg3)',borderRadius:1}}/><div style={{fontSize:8,color:'var(--text3)'}}>{parseInt(d.date.split('-')[2])}</div></div>;
                          const barH=maxMins>0?Math.max((d.workMins/maxMins)*64,d.workMins>0?4:0):0;
                          const barColor=d.isHoliday?'rgba(167,139,250,0.4)':d.status==='absent'?'rgba(248,113,113,0.2)':d.status==='on-leave'?'rgba(91,156,246,0.4)':d.late?'rgba(251,191,36,0.6)':d.workMins>0?`${emp.color}cc`:'rgba(74,93,128,0.15)';
                          return <div key={d.date} title={`${d.date}\n${d.isHoliday?'Holiday':d.status}${d.workMins?'\n'+fmtMins(d.workMins):''}`} style={{width:18,flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:'default'}}>
                            <div style={{flex:1,width:'100%',display:'flex',alignItems:'flex-end'}}>
                              <div style={{width:'100%',height:`${barH}px`,background:barColor,borderRadius:'3px 3px 0 0',transition:'height 0.4s',minHeight:d.isHoliday?4:0}}/>
                            </div>
                            <div style={{fontSize:8,color:'var(--text3)',lineHeight:1}}>{parseInt(d.date.split('-')[2])}</div>
                          </div>;
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {!loading&&!report&&<div className="card"><div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">Select a month to generate the report</div></div></div>}
    </div>
  );
}
