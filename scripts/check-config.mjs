try{
const j=JSON.parse(process.env.SUPABASE_CONFIG||"");
for(const k of ["url","anonKey"])if(!j[k])throw new Error("missing "+k);
new URL(j.url);
}catch(e){
console.error("SUPABASE_CONFIG secret is missing or invalid: "+e.message+'. Expected {"url":"https://<ref>.supabase.co","anonKey":"<anon public key>"}');
process.exit(1);
}
