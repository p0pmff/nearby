import L from "leaflet";
import {Capacitor,registerPlugin} from "@capacitor/core";
import {Geolocation} from "@capacitor/geolocation";
import {App} from "@capacitor/app";
import {Filesystem,Directory} from "@capacitor/filesystem";
import {FileOpener} from "@capacitor-community/file-opener";
import {CapacitorUpdater} from "@capgo/capacitor-updater";
import {Device} from "@capacitor/device";
import {Browser} from "@capacitor/browser";
import {LocalNotifications} from "@capacitor/local-notifications";
import {createClient} from "@supabase/supabase-js";

const BG=registerPlugin("BackgroundGeolocation");
const $=i=>document.getElementById(i);
const native=Capacitor.isNativePlatform();
const sb=createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.anonKey,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:!native}});
const SCHEME="com.nearby.app://login-callback";
const OWNER="ytvas68@gmail.com";
const SW=["#ff5d73","#4f8cff","#2ecc8f","#ffb020","#14b8a6","#f97316"];
const PRE=[{k:"home",n:"Home",e:"🏠"},{k:"school",n:"School",e:"🏫"},{k:"work",n:"Work",e:"🏢"},{k:"gym",n:"Gym",e:"💪"},{k:"other",n:"Other",e:"📍"}];
const MAIN=["map","friends","places","alerts","you"];
const TITLES={map:"Nearby",friends:"Friends",places:"Places",alerts:"Alerts",you:"You",edit:"Edit profile",perm:"Permissions"};
const STEPS=["Connecting to Supabase","Loading your circle","Syncing places","Finding your location"];
const col=(u,o)=>o&&o.color||SW[[...u].reduce((a,c)=>a+c.charCodeAt(0),0)%SW.length];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const init=n=>esc((n||"?")[0]);
const dist=(a,b,c,d)=>{const r=Math.PI/180,x=(c-a)*r,y=(d-b)*r*Math.cos((a+c)/2*r);return Math.sqrt(x*x+y*y)*6371000};
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?"just now":m<60?m+" min ago":Math.round(m/60)+" h ago"};
const cmp=(a,b)=>{const x=a.split(".").map(Number),y=b.split(".").map(Number);for(let i=0;i<3;i++){const d=(x[i]||0)-(y[i]||0);if(d)return d>0?1:-1}return 0};

let poll=null,me=null,prof={},friends={},places=[],alerts=[],reqIn=[],reqOut=[],cur="map",sel=null,pos=null,subs=[],wid=null,bat=null,tt=0,gotFix=false,obStep=0,form={};
let ust="checking",latest="",upd=null,forced=false,seenLoc={},inside={},moving={},movedAt={},newFriend={},reqReady=false,placing=null,isOwner=false,selfSpeed=0,H={uid:"",days:[],day:0,err:"",loading:false};
let pm={loc:"prompt",bg:"prompt",push:native?"prompt":"na"};
let ready={f:false,p:false,a:false};
const done=new Set();

const map=L.map("map",{zoomControl:false,attributionControl:false}).setView([30,10],3);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Esri, Maxar, Earthstar Geographics"}).addTo(map);
L.control.attribution({prefix:false,position:"bottomleft"}).addTo(map);
const fl=L.layerGroup().addTo(map),pl=L.layerGroup().addTo(map),hl=L.layerGroup().addTo(map);

const kmh=l=>Math.round(((l&&l.speed)||0)*3.6);
const driving=l=>kmh(l)>=25;
function status(f){
if(f.hidden)return "Not sharing with you";
if(!f.loc)return "No location yet";
const p=places.find(p=>dist(f.loc.lat,f.loc.lng,p.lat,p.lng)<=(p.radius||150));
return p?"At "+p.name:(driving(f.loc)?"Driving · "+kmh(f.loc)+" km/h":f.loc.speed>1?"Moving":"Stopped")+" · "+ago(f.loc.ts);
}
const who=p=>Object.values(friends).filter(f=>f.loc&&dist(f.loc.lat,f.loc.lng,p.lat,p.lng)<=(p.radius||150)).map(f=>f.name).join(", ");

const batt=b=>b==null?"":'<span class="bt '+(b<20?"lo":b<50?"mid":"hi")+'">'+b+"%</span>";
function mkIcon(u,f){
const l=f.loc||{},d=driving(l),sp=kmh(l);
const a='<div class="mk'+(u===sel?" sel":"")+'" style="background:'+col(u,f)+'">'+init(f.name)+"</div>";
const tags='<span class="tags">'+(sp>=4?'<span class="bt sp">'+sp+" km/h</span>":"")+batt(l.battery)+"</span>";
return L.divIcon({className:"",html:(d?'<div class="cm"><span class="cr">🚗</span>'+a+"</div>":a)+tags,iconSize:d?[40,30]:[28,28],iconAnchor:d?[20,15]:[14,14]});
}
function drawMap(){
fl.clearLayers();pl.clearLayers();
Object.entries(friends).forEach(([u,f])=>{
if(!f.loc)return;
L.marker([f.loc.lat,f.loc.lng],{icon:mkIcon(u,f)}).on("click",()=>pick(u)).addTo(fl);
});
if(pos&&me)L.marker([pos.lat,pos.lng],{icon:mkIcon(me.uid,{name:prof.name,color:prof.color,loc:{speed:selfSpeed,battery:bat}}),interactive:false,zIndexOffset:500}).addTo(fl);
places.forEach(p=>{
L.circle([p.lat,p.lng],{radius:p.radius||150,color:"#60a5fa",weight:1.5,dashArray:"4 4",fillOpacity:.18}).addTo(pl);
L.marker([p.lat,p.lng],{icon:L.divIcon({className:"",html:'<div class="pe">'+esc(p.emoji||"📍")+"</div>",iconSize:[24,24],iconAnchor:[12,12]}),interactive:false}).addTo(pl);
});
}

const sr='<div class="it2 glass"><div class="sk" style="width:38px;height:38px;border-radius:13px"></div><div class="tx"><div class="sk" style="width:70%;height:12px"></div><div class="sk" style="width:40%;height:9px;margin-top:7px"></div></div></div>';
const SK={map:'<div class="sheet glass"><div class="who"><div class="sk" style="width:38px;height:38px;border-radius:50%"></div><div style="flex:1"><div class="sk" style="width:50%;height:13px"></div><div class="sk" style="width:70%;height:9px;margin-top:7px"></div></div></div></div>',list:'<div class="panel">'+sr.repeat(4)+"</div>"};
const sw=o=>'<div class="sw'+(o?" on":"")+'"></div>';
const av=(u,o,big)=>"<u"+(big?' class="big"':"")+' style="background:'+col(u,o)+'">'+init(o&&o.name)+"</u>";
const itm=(a,v,inner)=>'<div class="it2 glass"'+(a?' data-a="'+a+'" data-v="'+v+'"':' style="cursor:default"')+">"+inner+"</div>";
const tx=(b,s)=>'<div class="tx"><b>'+b+"</b><small>"+s+"</small></div>";
const sec=t=>'<div class="sec">'+t+"</div>";
const note=t=>'<small class="mt" style="display:block;margin:10px 4px">'+t+"</small>";

const CODE=()=>itm("",0,'<div style="flex:1"><small style="color:var(--muted);font-size:11px">Your friend code</small><div style="display:flex;align-items:center;gap:8px;margin-top:6px"><b class="code">'+esc(prof.code||"...")+'</b><button class="btn" data-a="copy">Copy</button></div></div>');
const ADD=()=>itm("",0,'<div style="flex:1"><small style="color:var(--muted);font-size:11px">Add a friend</small><div style="display:flex;gap:8px;margin-top:8px"><input id="fq" class="inp lc" placeholder="@username or NB-code" autocapitalize="none" autocomplete="off"><button class="btn" data-a="req">Add</button></div></div>')+note("A friend code adds instantly. A username sends a request.");

function profileForm(){
const c=form.color||prof.color||SW[0];
return '<div class="fld"><label>Display name</label><input id="fn" class="inp lc" maxlength="30" value="'+esc(form.name!=null?form.name:prof.name)+'"></div><div class="fld"><label>Username</label><input id="fu" class="inp lc" maxlength="20" autocapitalize="none" autocomplete="off" value="'+esc(form.username!=null?form.username:prof.username)+'"></div><div class="fld"><label>Color</label><div class="sws">'+SW.map(x=>'<i data-a="sw" data-v="'+x+'" class="'+(x===c?"on":"")+'" style="background:'+x+'"></i>').join("")+'</div></div><div class="err" id="fe"></div>';
}

function permRows(){
const row=(ic,t,d,st,a)=>itm("",0,'<div class="ic">'+ic+"</div>"+tx(t,d)+(st==="granted"?'<span class="ok">On</span>':'<button class="btn sm" data-a="'+a+'">'+(st==="denied"?"Settings":"Allow")+"</button>"));
let h=row("📍","Location","Needed to show you on the map",pm.loc,"ploc");
if(native)h+=row("🌙","Background location","Keeps sharing when the app is closed. Choose Allow all the time",pm.bg,"pbg")+row("🔔","Notifications","Arrival and friend alerts while the app is running",pm.push,"ppush");
else h+=note("Web version: your location updates only while this page is open. Push notifications are in the Android app.");
return h;
}

const RE={
map:()=>{
const ids=Object.keys(friends);
if(!ids.length)return '<div class="sheet glass"><b>No friends yet</b><p class="mt">Add friends in the Friends tab or share your code '+esc(prof.code||"")+".</p></div>";
const u=friends[sel]?sel:ids[0],f=friends[u];
return '<div class="sheet glass"><div class="who">'+av(u,f)+"<div><b>"+esc(f.name)+"</b><small>"+esc(status(f))+"</small></div><em>"+(f.loc&&f.loc.battery!=null?f.loc.battery+"%":"")+'</em></div><div class="row"><div><small>Speed</small><b>'+(f.loc?Math.round((f.loc.speed||0)*3.6):0)+' km/h</b></div></div><div class="av">'+ids.map(i=>'<u class="'+(i===u?"cur":"")+'" data-a="pick" data-v="'+i+'" style="background:'+col(i,friends[i])+'">'+init(friends[i].name)+"</u>").join("")+"</div></div>";
},
friends:()=>{
const ids=Object.keys(friends);
return '<div class="panel">'+ADD()+(reqIn.length?sec("Requests")+reqIn.map(r=>itm("",0,av(r.from,{name:r.fromName})+tx(esc(r.fromName),"@"+esc(r.fromUsername))+'<button class="btn sm" data-a="acc" data-v="'+r.id+'">Accept</button><small data-a="dec" data-v="'+r.id+'" style="padding:6px">✕</small>')).join(""):"")+sec("Your friends")+(ids.length?ids.map(i=>{const f=friends[i];return itm("fp",i,av(i,f)+tx(esc(f.name),"@"+esc(f.username)+" · "+esc(status(f)))+"<small>›</small>")}).join(""):itm("",0,"<small>No friends yet</small>"))+(reqOut.length?sec("Sent requests")+reqOut.map(r=>itm("",0,tx(esc(r.toName),"@"+esc(r.toUsername))+'<small data-a="can" data-v="'+r.id+'" style="padding:6px">Cancel</small>')).join(""):"")+"</div>";
},
fp:u=>{
const f=friends[u],l=f.loc;
return '<div class="panel"><div class="pf">'+av(u,f,1)+"<b>"+esc(f.name)+"</b><small>@"+esc(f.username)+" · "+esc(status(f))+'</small></div><div class="row"><div><small>Battery</small><b>'+(l&&l.battery!=null?l.battery+"%":"n/a")+"</b></div><div><small>Speed</small><b>"+(l?Math.round((l.speed||0)*3.6):0)+' km/h</b></div><div><small>Updated</small><b>'+(l?ago(l.ts):"n/a")+'</b></div></div><button class="btn big" data-a="pick" data-v="'+u+'">Show on map</button>'+itm("fshare",u,tx("Share my location with "+esc(f.name),"Turn off to hide yourself from them")+sw(f.share!==false))+itm("hist",u,tx("History","Last 5 days of movement")+"<small>›</small>")+itm("frm",u,'<div class="tx"><b style="color:#ff6b6b">Remove friend</b></div>')+"</div>";
},
places:()=>'<div class="panel">'+sec("Alerts for arrivals and departures")+places.map(p=>itm("tgp",p.id,'<div class="ic">'+esc(p.emoji||"📍")+"</div>"+tx(esc(p.name),esc(who(p))||"Nobody here")+'<small data-a="delp" data-v="'+p.id+'" style="padding:6px">✕</small>'+sw(p.alert!==false))).join("")+itm("",0,'<div style="flex:1"><small style="color:var(--muted);font-size:11px">Add or move a place</small><div class="chips2">'+PRE.map(p=>'<button class="chp" data-a="preset" data-v="'+p.k+'">'+p.e+" "+p.n+"</button>").join("")+"</div></div>")+note("Friends who have you as a friend get a notification when you arrive at a place, and you get one when they do.")+"</div>",
alerts:()=>'<div class="panel">'+(alerts.length?alerts.map(a=>itm("",0,'<div class="ic">'+esc(a.emoji||"📍")+"</div>"+tx(esc(a.text),a.ts?new Date(a.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"now"))).join(""):itm("",0,"<small>No alerts yet. They appear when friends arrive at or leave your places.</small>"))+"</div>",
you:()=>'<div class="panel"><div class="pf">'+av(me.uid,prof,1)+"<b>"+esc(prof.name)+"</b><small>@"+esc(prof.username)+" · "+esc(me.email)+"</small></div>"+itm("edit",0,tx("Edit profile","Name, username and color")+"<small>›</small>")+itm("hist",me.uid,tx("My history","Last 5 days of movement")+"<small>›</small>")+itm("perm",0,tx("Permissions","Location, background, notifications, privacy")+"<small>›</small>")+CODE()+(isOwner&&!native?itm("owner",0,tx("Owner panel","Stats, users and broadcasts")+"<small>›</small>"):"")+itm("out",0,'<div class="tx"><b style="color:#ff6b6b">Sign out</b></div>')+"</div>",
hist:()=>{
if(H.loading)return '<div class="sheet glass"><b>Loading history…</b></div>';
if(H.err)return '<div class="sheet glass"><b>'+esc(H.err)+'</b><p class="mt">Your friend can turn on history sharing in Permissions.</p></div>';
if(!H.days.length)return '<div class="sheet glass"><b>No history yet</b><p class="mt">Locations are saved while you share and kept for 5 days.</p></div>';
const f=H.uid===(me&&me.uid)?prof:friends[H.uid]||{},d=H.days[H.day]||H.days[0];
const top=Math.max(...d.pts.map(p=>(p.speed||0)*3.6));
return '<div class="sheet glass"><div class="who">'+av(H.uid,f)+"<div><b>"+esc(f.name)+"</b><small>Last 5 days</small></div></div><div class=\"chips2\" style=\"margin-top:12px\">"+H.days.map((x,i)=>'<button class="chp'+(i===H.day?" cur":"")+'" data-a="hd" data-v="'+i+'">'+esc(x.label)+"</button>").join("")+'</div><div class="row"><div><small>Distance</small><b>'+distKm(d.pts).toFixed(1)+' km</b></div><div><small>Top speed</small><b>'+Math.round(top)+' km/h</b></div><div><small>Points</small><b>'+d.pts.length+"</b></div></div></div>";
},
edit:()=>'<div class="panel">'+profileForm()+'<button class="btn big" data-a="save">Save</button></div>',
perm:()=>'<div class="panel">'+permRows()+sec("Privacy")+itm("share",0,tx("Share my location","Pause to hide from everyone")+sw(prof.sharing!==false))+itm("disc",0,tx("Find me by username","Off means only your code works")+sw(prof.discoverable!==false))+itm("hsh",0,tx("Share my 5 day history","Friends you share with can see where you went")+sw(prof.historyShare===true))+sec("Notifications")+itm("nmove",0,tx("On the move","Notify me when a friend starts moving")+sw(prof.notifyMove!==false))+note("Only friends can see your location. You can also turn it off for each friend on their page.")+"</div>"
};

function draw(){
const a=document.activeElement;
if(a&&a.tagName==="INPUT"&&$("scr").contains(a))return;
if(cur.startsWith("fp:")&&!friends[cur.slice(3)])cur="friends";
const fp=cur.startsWith("fp:"),hs=cur.startsWith("hist:");
const b=hs?(cur.slice(5)===(me&&me.uid)?"you":"friends"):fp?"friends":cur==="edit"||cur==="perm"?"you":cur;
const ld=!(ready.f&&ready.p&&ready.a);
$("ph").classList.toggle("ld",ld);
$("ph").classList.toggle("dim",b!=="map"&&!hs);
$("ph").classList.toggle("sub",!MAIN.includes(cur));
$("scr").innerHTML=ld?(b==="map"||hs?SK.map:SK.list):hs?RE.hist():fp?RE.fp(cur.slice(3)):RE[cur]();
$("ttl").textContent=hs?"History":fp?friends[cur.slice(3)].name:TITLES[cur];
if(!hs)hl.clearLayers();
$("bdg").textContent=prof.sharing===false?"Paused":Object.keys(friends).length+" friends";
document.querySelectorAll(".tb span").forEach(s=>{s.classList.toggle("on",s.dataset.k===b);if(s.dataset.k==="friends")s.dataset.n=reqIn.length||""});
}
function rerender(){if($("ob").classList.contains("on"))ob(obStep);else draw()}

function say(ic,msg){
const t=$("toast");
t.innerHTML="<i>"+ic+"</i><div><small>NEARBY · now</small><b>"+esc(msg)+"</b></div>";
t.classList.add("show");
clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("show"),3200);
}

function paintSteps(){
const next=[0,1,2,3].find(k=>!done.has(k));
$("st").innerHTML=STEPS.map((s,i)=>'<div class="'+(done.has(i)?"d":i===next?"r":"")+'"><i></i>'+s+"</div>").join("");
$("bar").style.transform="scaleX("+done.size/4+")";
}
const hideSplash=()=>$("sp").classList.add("off");
function mark(i){done.add(i);paintSteps();if(done.size===4)setTimeout(hideSplash,300)}

function pick(v){
sel=v;cur="map";
const f=friends[v];
if(f&&f.loc)map.flyTo([f.loc.lat,f.loc.lng],16,{duration:.6});
drawMap();draw();
}

async function refreshPerm(){
try{pm.loc=(await Geolocation.checkPermissions()).location}catch(e){}
if(native){
try{pm.push=(await LocalNotifications.checkPermissions()).display}catch(e){}
pm.bg=localStorage.getItem("bg")?"granted":"prompt";
}
rerender();
}

function stopTrack(){
if(!wid)return;
if(wid.bg)BG.removeWatcher({id:wid.bg});
if(wid.geo)Geolocation.clearWatch({id:wid.geo});
wid=null;
}
async function track(){
stopTrack();
let lastL=null,lastH=null;
const fix=async(lat,lng,speed)=>{
pos={lat,lng};selfSpeed=speed||0;
if(!gotFix){gotFix=true;map.setView([lat,lng],16);mark(3)}
drawMap();
if(native)try{const i=await Device.getBatteryInfo();if(i.batteryLevel!=null)bat=Math.round(i.batteryLevel*100)}catch(e){}
const n=Date.now();
if(prof.sharing===false||!me)return;
if(lastL&&n-lastL.ts<180000&&!(dist(lastL.lat,lastL.lng,lat,lng)>=20&&n-lastL.ts>=10000))return;
lastL={lat,lng,ts:n};
sb.from("locations").upsert({user_id:me.uid,lat,lng,speed:speed||0,ts:n,battery:bat==null?null:bat}).then(r=>{if(r.error)console.warn(r.error.message)});
if(!lastH||dist(lastH.lat,lastH.lng,lat,lng)>=50||n-lastH.ts>=600000){lastH={lat,lng,ts:n};sb.from("history").insert({user_id:me.uid,lat,lng,ts:n,speed:speed||0}).then(()=>{})}
};
try{
if(native)wid={bg:await BG.addWatcher({backgroundTitle:"Nearby is sharing your location",backgroundMessage:"Your friends can see where you are",requestPermissions:true,stale:false,distanceFilter:10},(l,e)=>{
if(e){if(e.code==="NOT_AUTHORIZED")pm.loc="denied";mark(3);return}
fix(l.latitude,l.longitude,l.speed);
})};
else wid={geo:await Geolocation.watchPosition({enableHighAccuracy:true},p=>{if(p)fix(p.coords.latitude,p.coords.longitude,p.coords.speed)})};
}catch(e){mark(3)}
}

async function pushSetup(){
if(!native)return;
try{pm.push=(await LocalNotifications.requestPermissions()).display}catch(e){}
}

function notify(title,body){
say("🔔",body);
if(!native)return;
LocalNotifications.schedule({notifications:[{id:Math.floor(Math.random()*2e9),title,body,schedule:{at:new Date(Date.now()+200)}}]}).catch(()=>{});
}
function record(text,emoji,uid,place){
notify("Nearby",text);
sb.from("alerts").insert({user_id:me.uid,text,uid:uid||null,place,emoji}).then(()=>{});
}
function onFriendLoc(u,f,loc){
const prev=seenLoc[u],first=prev===undefined;
seenLoc[u]=loc;
if(!loc)return;
places.forEach(p=>{
const k=u+"_"+p.id,now=dist(loc.lat,loc.lng,p.lat,p.lng)<=(p.radius||150),was=inside[k];
inside[k]=now;
if(first||was===undefined||was===now||p.alert===false)return;
record(f.name+(now?" arrived at ":" left ")+p.name,p.emoji||"📍",u,p.name);
});
const moved=prev?dist(prev.lat,prev.lng,loc.lat,loc.lng):0,dt=prev?(loc.ts-prev.ts)/1000:0,was=moving[u]===true;
const now=was?!(loc.speed<.8&&moved<20):(loc.speed>=1.5||(dt>0&&dt<600&&moved>=40));
moving[u]=now;
if(!first&&now&&!was&&Date.now()-(movedAt[u]||0)>600000&&prof.notifyMove!==false){movedAt[u]=Date.now();record(f.name+" is on the move","🚶",u,"")}
}
const FP="id,name,username,color,email,code,sharing,discoverable,onboarded,notify_move,history_share,seen";
const P=r=>r&&{id:r.id,name:r.name,username:r.username||"",color:r.color,email:r.email,code:r.code,sharing:r.sharing,discoverable:r.discoverable,onboarded:r.onboarded,notifyMove:r.notify_move,historyShare:r.history_share,seen:r.seen};
const R=r=>({id:r.id,from:r.from_id,to:r.to_id,fromName:r.from_name,fromUsername:r.from_username,toName:r.to_name,toUsername:r.to_username});
const mine=uid=>!!me&&me.uid===uid;

async function setProf(p){
const M={notifyMove:"notify_move",historyShare:"history_share"},row={};
for(const k in p)row[M[k]||k]=p[k];
Object.assign(prof,p);draw();
const r=await sb.from("profiles").update(row).eq("id",me.uid);
if(r.error)say("⚠️","Could not save that");
}
async function saveProfileData(name,username,color){
if(!/^[a-z0-9_]{3,20}$/.test(username))throw new Error("Username must be 3 to 20 letters, numbers or underscores");
if(!name)throw new Error("Enter a display name");
const r=await sb.from("profiles").update({username,name,color,onboarded:true}).eq("id",me.uid);
if(r.error){if(r.error.code==="23505")throw new Error("That username is taken");throw new Error(r.error.message)}
Object.assign(prof,{username,name,color,onboarded:true});
}
async function cleanHistory(){
try{await sb.from("history").delete().eq("user_id",me.uid).lt("ts",Date.now()-5*864e5)}catch(e){}
}

async function loadFriends(){
if(!me)return;
const uid=me.uid;
try{
const [a,b]=await Promise.all([sb.from("friends").select("friend_id,share").eq("user_id",uid),sb.from("friends").select("user_id,share").eq("friend_id",uid)]);
if(!mine(uid)||a.error)return;
const sh={},theirs={};
a.data.forEach(r=>{sh[r.friend_id]=r.share});
(b.data||[]).forEach(r=>{theirs[r.user_id]=r.share});
const ids=Object.keys(sh);
Object.keys(friends).filter(i=>!(i in sh)).forEach(i=>{delete friends[i];delete seenLoc[i]});
ids.filter(i=>!friends[i]).forEach(i=>{friends[i]={name:"...",username:""};if(ready.f)newFriend[i]=1});
ids.forEach(i=>{friends[i].share=sh[i];friends[i].hidden=theirs[i]===false});
if(ids.length){
const [pr,lo]=await Promise.all([sb.from("profiles").select(FP).in("id",ids),sb.from("locations").select("*").in("user_id",ids)]);
if(!mine(uid))return;
(pr.data||[]).forEach(r=>{const f=friends[r.id];if(!f)return;Object.assign(f,P(r));if(newFriend[r.id]){delete newFriend[r.id];notify("Nearby",f.name+" is now your friend")}});
const locs={};
(lo.data||[]).forEach(r=>{locs[r.user_id]=r});
ids.forEach(i=>{const f=friends[i],old=f.loc;f.loc=f.hidden?null:(locs[i]||null);if(!(old&&f.loc&&old.ts===f.loc.ts))onFriendLoc(i,f,f.loc)});
}
}catch(e){}
ready.f=true;mark(1);drawMap();draw();
}
async function loadPlaces(){
if(!me)return;
const uid=me.uid,r=await sb.from("places").select("*").eq("user_id",uid);
if(!mine(uid))return;
if(!r.error)places=r.data;
ready.p=true;mark(2);drawMap();draw();
}
async function loadAlerts(){
if(!me)return;
const uid=me.uid,r=await sb.from("alerts").select("text,uid,place,emoji,ts").eq("user_id",uid).order("ts",{ascending:false}).limit(30);
if(!mine(uid))return;
if(!r.error)alerts=r.data;
ready.a=true;draw();
}
async function loadReqs(){
if(!me)return;
const uid=me.uid,[i,o]=await Promise.all([sb.from("requests").select("*").eq("to_id",uid),sb.from("requests").select("*").eq("from_id",uid)]);
if(!mine(uid))return;
if(!i.error)reqIn=i.data.map(R);
if(!o.error)reqOut=o.data.map(R);
reqReady=true;draw();
}
const refresh=()=>{if(!me)return;loadFriends();loadPlaces();loadAlerts();loadReqs()};

function subscribe(){
const uid=me.uid,T=(table,filter,event)=>({event:event||"*",schema:"public",table,...(filter?{filter}:{})});
const ch=sb.channel("nb-"+uid)
.on("postgres_changes",T("profiles"),p=>{
const r=p.new;
if(!r||!r.id)return;
if(r.id===uid){Object.assign(prof,P(r));draw()}
else if(friends[r.id]){Object.assign(friends[r.id],P(r));drawMap();draw()}
})
.on("postgres_changes",T("locations"),p=>{
const r=p.eventType==="DELETE"?p.old:p.new,id=r&&r.user_id,f=id&&friends[id];
if(!f)return;
f.loc=p.eventType==="DELETE"||f.hidden?null:p.new;
onFriendLoc(id,f,f.loc);drawMap();draw();
})
.on("postgres_changes",T("friends","user_id=eq."+uid),()=>loadFriends())
.on("postgres_changes",T("friends","friend_id=eq."+uid),()=>loadFriends())
.on("postgres_changes",T("places","user_id=eq."+uid),()=>loadPlaces())
.on("postgres_changes",T("alerts","user_id=eq."+uid,"INSERT"),()=>loadAlerts())
.on("postgres_changes",T("requests","to_id=eq."+uid),p=>{
if(p.eventType==="INSERT"&&reqReady)notify("Nearby",(p.new.from_name||"Someone")+" sent you a friend request");
loadReqs();
})
.on("postgres_changes",T("requests","from_id=eq."+uid),()=>loadReqs())
.on("postgres_changes",T("bans","user_id=eq."+uid),p=>{
const b=p.new;
if(b&&b.user_id&&(b.until==null||b.until>Date.now())){showBan(b);stopTrack()}
})
.on("postgres_changes",T("broadcasts",null,"INSERT"),p=>{
localStorage.setItem("bc",p.new.id);
notify(p.new.title,p.new.body);
})
.subscribe();
subs.push(()=>{sb.removeChannel(ch)});
}

async function start(){
const uid=me.uid;
const bs=await sb.from("bans").select("*").eq("user_id",uid).maybeSingle();
const bb=bs.data;
if(bb&&(bb.until==null||bb.until>Date.now())){showBan(bb);return}
refreshPerm();
isOwner=!native&&me.emailVerified===true&&me.email===OWNER;
let r;
try{
const x=await sb.rpc("ensure_profile");
if(x.error)throw x.error;
r=P(x.data);
}catch(e){hideSplash();say("⚠️","Setup error: "+(e.code||e.message));return}
if(!mine(uid))return;
prof={...prof,...r};
draw();
subscribe();
refresh();
sb.from("broadcasts").select("id,title,body").order("ts",{ascending:false}).limit(1).then(x=>{
const d=x.data&&x.data[0];
if(!d)return;
const seen=localStorage.getItem("bc");
localStorage.setItem("bc",d.id);
if(seen!==null&&seen!==d.id)notify(d.title,d.body);
});
clearInterval(poll);poll=setInterval(refresh,60000);
if(r.onboarded){track();pushSetup();cleanHistory();sb.from("profiles").update({seen:Date.now()}).eq("id",uid).then(()=>{})}
else{hideSplash();ob(1)}
}

function stop(){
clearInterval(poll);poll=null;
subs.forEach(f=>f());subs=[];
Object.values(friends).forEach(f=>f.off&&f.off());
friends={};places=[];alerts=[];reqIn=[];reqOut=[];prof={};sel=null;gotFix=false;pos=null;cur="map";isOwner=false;seenLoc={};inside={};moving={};movedAt={};newFriend={};reqReady=false;
ready={f:false,p:false,a:false};
fl.clearLayers();pl.clearLayers();hl.clearLayers();stopTrack();$("bn").classList.remove("on");
$("ob").classList.remove("on");
draw();
}

function ob(n){
obStep=n;
const el=$("ob");
el.classList.add("on");
const body={
1:'<div class="step">Step 1 of 3</div><h2>Set up your profile</h2><p class="mt">Pick a username so friends can find you.</p>'+profileForm()+'<button class="btn big" data-a="obn1">Continue</button>',
2:'<div class="step">Step 2 of 3</div><h2>Permissions</h2><p class="mt">You control what is shared and can change this any time.</p>'+permRows()+'<button class="btn big" data-a="obn2">Continue</button>',
3:'<div class="step">Step 3 of 3</div><h2>Add friends</h2><p class="mt">Share your code or add someone by username. You can skip this.</p>'+CODE()+ADD()+'<button class="btn big" data-a="obdone">Finish</button>'
}[n];
const keep=$("fq")?$("fq").value:"";
el.innerHTML=body;
if($("fq"))$("fq").value=keep;
}

async function saveProfile(onb){
const name=$("fn").value.trim(),username=$("fu").value.trim().toLowerCase().replace(/^@/,"");
form={name,username,color:form.color};
try{
await saveProfileData(name,username,form.color||prof.color||SW[0]);
form={};
if(onb)ob(2);
else{cur="you";draw();say("✅","Profile saved")}
}catch(e){$("fe").textContent=e.code==="permission-denied"?"That username is not available":e.message}
}

function finish(){
$("ob").classList.remove("on");
cur="map";draw();track();pushSetup();
}

async function login(){
try{
const {data,error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:native?SCHEME:location.origin+location.pathname,skipBrowserRedirect:native,queryParams:{prompt:"select_account"}}});
if(error)throw error;
if(native&&data&&data.url)await Browser.open({url:data.url});
}catch(e){say("⚠️","Sign in failed: "+(e.message||e))}
}
if(native)App.addListener("appUrlOpen",async({url})=>{
if(!url||!url.startsWith(SCHEME))return;
try{await Browser.close()}catch(e){}
const er=/[?&#]error_description=([^&#]+)/.exec(url),m=/[?&#]code=([^&#]+)/.exec(url);
if(er){say("⚠️","Sign in failed: "+decodeURIComponent(er[1].replace(/\+/g," ")));return}
if(m){const x=await sb.auth.exchangeCodeForSession(decodeURIComponent(m[1]));if(x.error)say("⚠️","Sign in failed: "+x.error.message)}
});

async function sendReq(){
const q=$("fq").value.trim();
if(!q)return;
try{
if(/^NB-/i.test(q)){
const r=await sb.rpc("add_friend_by_code",{p_code:q});
if(r.error)throw r.error;
$("fq").value="";
say("🎉","Friend added");
loadFriends();
return;
}
const r=await sb.rpc("send_request",{p_username:q});
if(r.error)throw r.error;
$("fq").value="";
if(r.data&&r.data.status==="accepted"){say("🎉","Friend added");loadFriends()}
else say("📨","Request sent to "+((r.data&&r.data.name)||q));
loadReqs();
}catch(e){say("⚠️",e.message)}
}
async function respond(id,action){
try{
if(action==="accept"){
const x=await sb.rpc("accept_request",{p_id:id});
if(x.error)throw x.error;
loadFriends();
}else{
const x=await sb.from("requests").delete().eq("id",id);
if(x.error)throw x.error;
}
loadReqs();
}catch(e){say("⚠️","Could not complete that")}
}
async function unfriend(v){
try{
const x=await sb.rpc("remove_friend",{p_uid:v});
if(x.error)throw x.error;
delete friends[v];delete seenLoc[v];
drawMap();draw();loadFriends();
}catch(e){say("⚠️","Could not remove that friend")}
}

async function savePlace(k,name,e,lat,lng){
const id=k==="other"?(crypto.randomUUID?crypto.randomUUID():Date.now()+Math.random().toString(36).slice(2)):k;
const r=await sb.from("places").upsert({user_id:me.uid,id,name:name.slice(0,40),emoji:e,lat,lng,radius:150});
if(r.error){say("⚠️","Could not save that place");return}
say(e,name+" saved");
loadPlaces();
}
async function addPlace(k){
const p=PRE.find(x=>x.k===k);
let name=p.n;
if(k==="other"){name=prompt("Place name");if(!name)return}
if(pos&&confirm("Use your current location for "+name+"? Cancel to choose it on the map.")){await savePlace(k,name,p.e,pos.lat,pos.lng);return}
placing={k,name,e:p.e};
cur="map";draw();
say("📍","Tap the map to set "+name);
}
map.on("click",ev=>{
if(!placing)return;
const p=placing;placing=null;
savePlace(p.k,p.name,p.e,ev.latlng.lat,ev.latlng.lng);
});

document.addEventListener("click",async e=>{
const t=e.target.closest("[data-a]");
if(!t)return;
const a=t.dataset.a,v=t.dataset.v;
if(a==="tab"){if(v!=="map")placing=null;cur=v;draw()}
else if(a==="back"){cur=cur.startsWith("fp:")?"friends":cur.startsWith("hist:")?(H.uid===me.uid?"you":"fp:"+H.uid):"you";draw()}
else if(a==="login")login();
else if(a==="upd")doUpdate();
else if(a==="pick")pick(v);
else if(a==="fp"){cur="fp:"+v;draw()}
else if(a==="edit"||a==="perm"){cur=a;draw();if(a==="perm")refreshPerm()}
else if(a==="tgp"){const p=places.find(x=>x.id===v);if(p){p.alert=p.alert===false;draw();sb.from("places").update({alert:p.alert}).eq("user_id",me.uid).eq("id",v).then(()=>{})}}
else if(a==="delp"){places=places.filter(x=>x.id!==v);drawMap();draw();sb.from("places").delete().eq("user_id",me.uid).eq("id",v).then(()=>{})}
else if(a==="preset")addPlace(v);
else if(a==="copy"){if(navigator.clipboard)navigator.clipboard.writeText(prof.code||"");say("📋","Friend code copied")}
else if(a==="req")sendReq();
else if(a==="acc")respond(v,"accept");
else if(a==="dec")respond(v,"decline");
else if(a==="can")respond(v,"cancel");
else if(a==="fshare"){const f=friends[v];f.share=f.share===false;draw();sb.from("friends").update({share:f.share}).eq("user_id",me.uid).eq("friend_id",v).then(()=>{})}
else if(a==="frm"){if(confirm("Remove "+friends[v].name+"?")){unfriend(v);cur="friends"}}
else if(a==="share")setProf({sharing:prof.sharing===false});
else if(a==="disc")setProf({discoverable:prof.discoverable===false});
else if(a==="nmove")setProf({notifyMove:prof.notifyMove===false});
else if(a==="hsh")setProf({historyShare:prof.historyShare!==true});
else if(a==="hist")openHist(v);
else if(a==="hd"){H.day=+v;drawHist();draw()}
else if(a==="doupd")doUpdate();
else if(a==="retry")location.reload();
else if(a==="sw"){form.color=v;document.querySelectorAll(".sws i").forEach(i=>i.classList.toggle("on",i.dataset.v===v))}
else if(a==="save")saveProfile(false);
else if(a==="obn1")saveProfile(true);
else if(a==="obn2")ob(3);
else if(a==="obdone")finish();
else if(a==="ploc"){
if(pm.loc==="denied"&&native)BG.openSettings();
else{try{await Geolocation.requestPermissions()}catch(x){}await refreshPerm()}
}
else if(a==="pbg"){localStorage.setItem("bg","1");BG.openSettings();await refreshPerm()}
else if(a==="ppush"){await pushSetup();await refreshPerm()}
else if(a==="owner")location.href="owner.html";
else if(a==="out")sb.auth.signOut()
});

function showBan(d){
hideSplash();
$("bnt").textContent=(d.reason?d.reason+". ":"")+(d.until?"Your access returns on "+new Date(d.until).toLocaleString()+".":"This ban is permanent.");
$("bn").classList.add("on");
}

const dayLabel=k=>{const d=new Date(k),n=Math.round((new Date(new Date().toDateString())-d)/864e5);return n===0?"Today":n===1?"Yesterday":d.toLocaleDateString([],{weekday:"short"})};
const distKm=p=>p.reduce((a,x,i)=>i?a+dist(p[i-1].lat,p[i-1].lng,x.lat,x.lng):0,0)/1000;
function drawHist(){
hl.clearLayers();
const d=H.days[H.day];
if(!d)return;
const ll=d.pts.map(p=>[p.lat,p.lng]);
L.polyline(ll,{color:"#3b82f6",weight:4,opacity:.9}).addTo(hl);
L.circleMarker(ll[0],{radius:6,color:"#fff",weight:2,fillColor:"#3ddc97",fillOpacity:1}).addTo(hl);
L.circleMarker(ll[ll.length-1],{radius:6,color:"#fff",weight:2,fillColor:"#ef4444",fillOpacity:1}).addTo(hl);
map.fitBounds(L.latLngBounds(ll),{paddingTopLeft:[40,60],paddingBottomRight:[40,260],maxZoom:17});
}
async function openHist(uid){
H={uid,days:[],day:0,err:"",loading:true};
cur="hist:"+uid;draw();
try{
const f=friends[uid];
if(uid!==me.uid&&(!f||f.hidden||f.historyShare!==true))throw 0;
const rows=[];
for(let o=0;;o+=1000){
const r=await sb.from("history").select("lat,lng,ts,speed").eq("user_id",uid).gte("ts",Date.now()-5*864e5).order("ts").range(o,o+999);
if(r.error)throw r.error;
rows.push(...r.data);
if(r.data.length<1000)break;
}
const g={};
rows.forEach(x=>{const k=new Date(x.ts).toDateString();(g[k]=g[k]||[]).push(x)});
H.days=Object.keys(g).map(k=>({label:dayLabel(k),pts:g[k]})).reverse();
}catch(e){H.err="History is not shared"}
H.loading=false;
draw();drawHist();
}

function paintUS(){
const v="v"+window.APP_VERSION;
const m={checking:["#9aa3bd","Checking for updates…"],ok:["#3ddc97",v+" · Up to date"],nw:["#fbbf24",v+(native?" · Update required v"+latest:" · Update available v"+latest+", tap to update")],err:["#9aa3bd",v+" · Could not check for updates"]}[ust];
const e=$("usb");
e.innerHTML='<i style="background:'+m[0]+'"></i>'+m[1];
e.className=ust==="nw"&&!native?"tap":"";
}
const mb=n=>(n/1048576).toFixed(1);
function showUpdate(){
const ota=upd.need==="ota",a=ota?upd.bundle:upd.apk;
$("upt").innerHTML="<b>Version "+esc(latest)+" is required to continue</b><p class=\"mt\">"+(ota?"Only the changed app files are downloaded ("+mb(a.size)+" MB). No APK to install.":"This update changes the Android app itself ("+mb(a.size)+" MB). The file is deleted after installing.")+"</p>";
$("up").classList.add("on");
}
async function check(){
ust="checking";paintUS();
if(!window.GH_REPO){ust="ok";paintUS();return}
try{
const ac=new AbortController(),to=setTimeout(()=>ac.abort(),7000);
const r=await fetch("https://api.github.com/repos/"+window.GH_REPO+"/releases/latest",{headers:{Accept:"application/vnd.github+json"},signal:ac.signal});
clearTimeout(to);
if(r.status===404)ust="ok";
else if(!r.ok)throw 0;
else{
const j=await r.json();
latest=String(j.tag_name||"").replace(/^v/,"");
if(latest&&cmp(latest,window.APP_VERSION)>0){
ust="nw";
let meta={};
try{meta=JSON.parse(j.body||"{}")}catch(e){}
const as=n=>(j.assets||[]).find(a=>a.name===n);
let installed="0.0.0";
if(native)try{installed=(await App.getInfo()).version}catch(e){}
const need=native?(cmp(installed,meta.minApk||"0.0.0")<0?"apk":"ota"):"web";
upd={need,bundle:as(meta.bundle||""),apk:as("nearby.apk")};
forced=native&&((need==="ota"&&!!upd.bundle)||(need==="apk"&&!!upd.apk));
}else{ust="ok";forced=false}
}
}catch(e){ust="err"}
paintUS();
if(forced)showUpdate();
}
async function doUpdate(){
if(ust!=="nw"||!upd)return;
if(!native){
try{
const k=await caches.keys();await Promise.all(k.map(x=>caches.delete(x)));
const r=await navigator.serviceWorker.getRegistrations();await Promise.all(r.map(x=>x.unregister()));
}catch(e){}
location.reload();
return;
}
const btn=$("ubtn"),bar=$("ubar");
btn.disabled=true;btn.textContent="Downloading…";
try{
if(upd.need==="ota"){
const h=await CapacitorUpdater.addListener("download",e=>{bar.style.transform="scaleX("+(e.percent/100)+")"});
const b=await CapacitorUpdater.download({url:upd.bundle.browser_download_url,version:latest});
h.remove();
await CapacitorUpdater.set(b);
}else{
const h=await Filesystem.addListener("progress",e=>{if(e.contentLength)bar.style.transform="scaleX("+(e.bytes/e.contentLength)+")"});
await Filesystem.downloadFile({url:upd.apk.browser_download_url,path:"nearby-update.apk",directory:Directory.Cache,progress:true});
h.remove();
const u=await Filesystem.getUri({path:"nearby-update.apk",directory:Directory.Cache});
await FileOpener.open({filePath:u.uri,contentType:"application/vnd.android.package-archive",openWithDefault:true});
btn.disabled=false;btn.textContent="Install";
}
}catch(e){btn.disabled=false;btn.textContent="Try again";say("⚠️","Update failed. Check your connection")}
}
async function tidy(){
if(!native)return;
try{await CapacitorUpdater.notifyAppReady()}catch(e){}
try{
const cur=(await CapacitorUpdater.current()).bundle,l=await CapacitorUpdater.list();
for(const b of l.bundles)if(b.id!==cur.id&&b.id!=="builtin"&&b.status!=="builtin")await CapacitorUpdater.delete({id:b.id});
}catch(e){}
try{await Filesystem.deleteFile({path:"nearby-update.apk",directory:Directory.Cache})}catch(e){}
}
document.addEventListener("visibilitychange",()=>{document.body.classList.toggle("pause",document.hidden);if(!document.hidden){check();refresh()}});

const gate=check();
const toMe=u=>({uid:u.id,email:u.email,displayName:(u.user_metadata&&(u.user_metadata.full_name||u.user_metadata.name))||"",emailVerified:!!u.email_confirmed_at});
let first=true,curUid=null;
async function authChanged(u){
const id=u?u.id:null;
if(!first&&id===curUid){if(u)me=toMe(u);return}
first=false;curUid=id;
me=u?toMe(u):null;mark(0);
await gate;
if(forced){hideSplash();return}
if(u){$("lg").classList.add("off");start()}
else{stop();$("lg").classList.remove("off");hideSplash()}
}
sb.auth.onAuthStateChange((ev,sess)=>{setTimeout(()=>authChanged(sess&&sess.user),0)});

if(navigator.getBattery)navigator.getBattery().then(b=>{bat=Math.round(b.level*100);b.onlevelchange=()=>{bat=Math.round(b.level*100)}});
if("serviceWorker"in navigator&&!native&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
(function(){const c=document.createElement("canvas");c.width=c.height=96;const x=c.getContext("2d"),d=x.createImageData(96,96);for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=26}x.putImageData(d,0,0);$("nz").style.backgroundImage="url("+c.toDataURL()+")"})();
paintSteps();draw();tidy();
setTimeout(hideSplash,7000);
