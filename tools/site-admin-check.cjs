const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { PermissionFlagsBits: P } = require("discord.js");
const { createAdminSettings } = require("../bot/managers/siteAdminSettings");
const userId="123456789012345678", guildId="234567890123456789", otherId="345678901234567890", channelId="456789012345678901";
function fixture() {
  const db=new Database(":memory:");
  db.exec(`CREATE TABLE admin_contact(user_id TEXT,guild_id TEXT);
    CREATE TABLE guild_schools(guild_id TEXT,school_code TEXT,atpt_code TEXT,school_name TEXT,school_kind TEXT,registered_by TEXT,registered_at INTEGER,is_default INTEGER,PRIMARY KEY(guild_id,school_code));
    CREATE TABLE lunch_notice(guild_id TEXT PRIMARY KEY,channel_id TEXT,last_sent TEXT,send_minutes INTEGER NOT NULL DEFAULT 450);`);
  db.prepare("INSERT INTO admin_contact VALUES (?,?)").run(userId,guildId);
  const state={manager:true,admin:true,channel:true};
  const member={permissions:{has:p=>p===P.Administrator?state.admin:state.manager}};
  const guild={id:guildId,name:"테스트 서버",ownerId:"other",memberCount:12,
    roles:{fetch:async()=>{}},members:{fetch:async()=>member,fetchMe:async()=>({})},
    channels:{fetch:async()=>new Map([[channelId,{id:channelId,name:"급식",type:0,position:1,permissionsFor:()=>({has:()=>state.channel})}]])}};
  const getSchools=gid=>db.prepare("SELECT school_code code, atpt_code atpt, school_name name, school_kind kind, is_default isDefault FROM guild_schools WHERE guild_id=?").all(gid);
  const settings=createAdminSettings({db,client:{isReady:()=>true,guilds:{fetch:async()=>guild}},getSchools,
    neisRows:async(_,__,params)=>[{SD_SCHUL_CODE:params.SD_SCHUL_CODE||"7010001",ATPT_OFCDC_SC_CODE:"B10",SCHUL_NM:"테스트고등학교",SCHUL_KND_SC_NM:"고등학교",ORG_RDNMA:"서울"}]});
  const run=(method,body,gid=guildId)=>settings.run({userId,guildId:gid,method,body});
  return {db,state,run,settings};
}
test("server isolation, unregister and lost permission block writes",async()=>{
  const {db,state,run}=fixture();
  try {
    await assert.rejects(()=>run("PATCH",{action:"disable-lunch"},otherId),{status:403});
    state.manager=false;state.admin=false;
    await assert.rejects(()=>run("GET"),{status:403});
    state.manager=true;
    db.prepare("DELETE FROM admin_contact").run();
    await assert.rejects(()=>run("PATCH",{action:"disable-lunch"}),{status:403});
  } finally {db.close();}
});
test("school limits, duplicates, default reassignment and no cross-server writes",async()=>{
  const {db,run}=fixture();
  try {
    for(let i=1;i<=5;i++)await run("PATCH",{action:"add-school",code:`701000${i}`,atpt:"B10"});
    await assert.rejects(()=>run("PATCH",{action:"add-school",code:"7010001",atpt:"B10"}),{status:409});
    await assert.rejects(()=>run("PATCH",{action:"add-school",code:"7010006",atpt:"B10"}),{status:409});
    await run("PATCH",{action:"default-school",code:"7010002"});
    await run("PATCH",{action:"remove-school",code:"7010002"});
    const rows=db.prepare("SELECT * FROM guild_schools").all();
    assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.is_default).length,1);
    assert.ok(rows.every(r=>r.guild_id===guildId && r.school_name==="테스트고등학교"));
  } finally {db.close();}
});
test("ManageGuild cannot delete or change default but can add and set lunch",async()=>{
  const {db,state,run}=fixture();
  try {
    state.admin=false;
    await run("PATCH",{action:"add-school",code:"7010001",atpt:"B10"});
    for(const action of ["default-school","remove-school"])await assert.rejects(()=>run("PATCH",{action,code:"7010001"}),{status:403});
    await run("PATCH",{action:"set-lunch",time:"08:15",channelId});
    assert.equal(db.prepare("SELECT channel_id FROM lunch_notice").get().channel_id,channelId);
  } finally {db.close();}
});
test("channel permissions and input validation; schedule dedup survives channel changes",async()=>{
  const {db,state,run}=fixture();
  try {
    await assert.rejects(()=>run("PATCH",{action:"set-lunch",time:"08:15",channelId:otherId}),{status:400});
    state.channel=false;
    await assert.rejects(()=>run("PATCH",{action:"set-lunch",time:"08:15",channelId}),{status:400});
    state.channel=true;
    await run("PATCH",{action:"set-lunch",time:"08:15",channelId});
    db.prepare("UPDATE lunch_notice SET last_sent='2026-11-05'").run();
    await run("PATCH",{action:"set-lunch",time:"08:15",channelId});
    assert.equal(db.prepare("SELECT last_sent FROM lunch_notice").get().last_sent,"2026-11-05");
    assert.equal(db.prepare("SELECT send_minutes FROM lunch_notice").get().send_minutes,495);
    await assert.rejects(()=>run("PATCH",{action:"set-lunch",channelId,time:"24:00"}),{status:400});
    await assert.rejects(()=>run("PATCH",{action:"add-school",code:"7010001",atpt:"B10",name:"forged"}),{status:400});
    await run("PATCH",{action:"disable-lunch"});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lunch_notice").get().n,0);
    const view=await run("GET");assert.equal(view.lunch.channelId,null);assert.equal(view.channels.length,1);
  } finally {db.close();}
});

test("new servers and school registration keep lunch off; schedule is weekday-only", async()=>{
  const {db,run}=fixture();
  try {
    assert.equal((await run("GET")).lunch.channelId,null);
    await run("PATCH",{action:"add-school",code:"7010001",atpt:"B10"});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lunch_notice").get().n,0);
    const {isDue,formatTime}=require("../bot/managers/lunchSchedule");
    assert.equal(formatTime(undefined),"07:30");
    assert.equal(formatTime(495),"08:15");
    const row={send_minutes:495,last_sent:null};
    assert.equal(isDue(row,4,494,"2026-11-05"),false);
    assert.equal(isDue(row,4,495,"2026-11-05"),true);
    assert.equal(isDue(row,4,645,"2026-11-05"),false);
    assert.equal(isDue(row,0,495,"2026-11-08"),false);
    assert.equal(isDue({...row,last_sent:"2026-11-05"},4,495,"2026-11-05"),false);
    assert.equal(isDue({send_minutes:1439,last_sent:null},4,1439,"2026-11-05"),true);
  }finally{db.close();}
});
