import {createClient} from "@supabase/supabase-js";

const OWNER="ytvas68@gmail.com";
const $=i=>document.getElementById(i);
const sb=createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.anonKey,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const chk=r=>{if(r.error)throw r.error;return r};
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=t=>t?new Date(t).toLocaleString([],{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}):"never";
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?"just now":m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)+" d ago"};
let users=[],filter="all",banUid="",ownerId="",curUid=null;

const show=id=>["lg","dn","ow"].forEach(x=>{$(x).hidden=x!==id});

function stats(s){
$("stats").innerHTML=[["Registered",s.users],["Online now",s.online],["Active in 24 h",s.active],["New this week",s.fresh],["Banned",s.banned],["Friendships",s.friendships],["Places",s.places]].map(x=>'<div class="card"><small>'+x[0]+"</small><b>"+x[1]+"</b></div>").join("");
}
function status(u){
if(u.ban)return '<span class="tag bad">Banned</span><br><small>'+(u.ban.until?"until "+fmt(u.ban.until):"Permanent")+(u.ban.reason?" · "+esc(u.ban.reason):"")+"</small>";
return u.onboarded?'<span class="tag ok">Active</span>':'<span class="tag">Setting up</span>';
}
function table(){
const q=$("q").value.trim().toLowerCase();
const rows=users.filter(u=>(filter==="all"||(filter==="banned"?u.ban:!u.ban))&&(!q||[u.name,u.username,u.email,u.uid].join(" ").toLowerCase().includes(q)));
$("count").textContent=users.length+" registered · "+users.filter(u=>u.ban).length+" banned";
$("rows").innerHTML=rows.map(u=>"<tr><td><b>"+esc(u.name||"(no name)")+"</b><br><small>@"+esc(u.username)+" · "+esc(u.email)+"</small><br><small>"+esc(u.uid)+"</small></td><td>"+fmt(u.created)+"</td><td>"+fmt(u.signedIn)+"</td><td>"+(u.last?ago(u.last):"never")+"</td><td>"+u.friends+"</td><td>"+status(u)+'</td><td class="act">'+(u.ban?'<button class="ghost" data-a="unban" data-v="'+u.uid+'">Unban</button>':'<button class="red" data-a="ban" data-v="'+u.uid+'">Ban</button>')+"</td></tr>").join("")||'<tr><td colspan="7"><small>No accounts found</small></td></tr>';
}
async function load(){
$("status").textContent="Loading…";
try{
const o=chk(await sb.rpc("owner_overview")).data,now=Date.now();
users=o.users.map(x=>({uid:x.uid,name:x.name,username:x.username,email:x.email,created:x.created,signedIn:x.seen,friends:x.friends,last:x.last,onboarded:x.onboarded,ban:x.ban?{until:x.ban.until,reason:x.ban.reason}:null}));
stats({users:users.length,online:users.filter(u=>now-u.last<600000).length,active:users.filter(u=>now-u.last<86400000).length,fresh:users.filter(u=>now-u.created<604800000).length,banned:users.filter(u=>u.ban).length,friendships:Math.round(users.reduce((x,u)=>x+u.friends,0)/2),places:o.places});
table();
$("status").textContent="Updated "+new Date().toLocaleTimeString();
}catch(e){$("status").textContent=e.message}
}

document.addEventListener("click",async e=>{
const t=e.target.closest("[data-a]");
if(!t)return;
const a=t.dataset.a,v=t.dataset.v,u=users.find(x=>x.uid===v);
try{
if(a==="out")sb.auth.signOut();
else if(a==="refresh")load();
else if(a==="flt"){filter=v;document.querySelectorAll("[data-a=flt]").forEach(b=>b.classList.toggle("on",b===t));table()}
else if(a==="ban"){banUid=v;$("bmt").textContent="Ban "+(u.name||u.email);$("br").value="";$("bd").value="86400000";$("bc").hidden=true;$("be").textContent="";$("bm").hidden=false}
else if(a==="bancancel")$("bm").hidden=true;
else if(a==="banok"){
const d=$("bd").value;
let until=null;
if(d==="custom"){until=new Date($("bc").value).getTime();if(!isFinite(until)){$("be").textContent="Pick a date and time";return}}
else if(d!=="perm")until=Date.now()+Number(d);
if(until!==null&&until<=Date.now()){$("be").textContent="The end must be in the future";return}
chk(await sb.from("bans").upsert({user_id:banUid,type:until===null?"permanent":"temporary",until,reason:$("br").value.trim().slice(0,200),banned_by:ownerId,ts:new Date().toISOString()}));
await sb.from("locations").delete().eq("user_id",banUid);
$("bm").hidden=true;load();
}
else if(a==="unban"){if(confirm("Unban "+(u.name||u.email)+"?")){chk(await sb.from("bans").delete().eq("user_id",v));load()}}
else if(a==="bc"){
const title=$("bt").value.trim(),body=$("bb").value.trim();
if(!title||!body){$("bs").textContent="Enter a title and a message";return}
if(!confirm("Send this notification to everyone?"))return;
chk(await sb.from("broadcasts").insert({title:title.slice(0,60),body:body.slice(0,200)}));
$("bs").textContent="Sent";
}
}catch(x){alert(x.message);$("be").textContent=x.message}
});
$("bd").addEventListener("change",()=>{$("bc").hidden=$("bd").value!=="custom"});
$("q").addEventListener("input",table);
$("gin").addEventListener("click",()=>{
sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:"select_account"}}}).catch(()=>{});
});

function route(u){
const id=u?u.id:null;
if(id===curUid&&curUid!==null)return;
curUid=id;
if(!u){show("lg");return}
if(!u.email_confirmed_at||u.email!==OWNER){$("who").textContent="Signed in as "+u.email;show("dn");return}
ownerId=u.id;
$("em").textContent=u.email;
show("ow");
load();
}
sb.auth.onAuthStateChange((ev,sess)=>{setTimeout(()=>route(sess&&sess.user),0)});
