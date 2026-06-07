// fetch-jobs.js — runs on GitHub Actions (Node 20+, no CORS).
// Sources: Arbeitnow (EU sponsorship/remote) + Adzuna (UK + 8 EU countries, ALL roles).
// Merges, dedupes, ranks against Aqib's profile, writes jobs.json.

const fs = require("fs");

const ADZUNA_ID  = process.env.ADZUNA_APP_ID;
const ADZUNA_KEY = process.env.ADZUNA_APP_KEY;

// Adzuna country codes to pull. UK ("gb") = all roles, not just sponsorship.
const ADZUNA_COUNTRIES = ["gb","de","nl","fr","es","it","be","at","ch"];

// Search terms aimed at Aqib's target roles. Adzuna searches title+description.
const SEARCH_TERMS = [
  "product manager","product owner","delivery manager",
  "associate product manager","producer","project manager"
];

const PROFILE = {
  titles: ["product manager","product owner","delivery manager","program manager",
           "project manager","product lead","technical product","associate product",
           "producer","scrum master","delivery lead"],
  skills: ["figma","ux","wireframe","game","agile","scrum","jira","roadmap",
           "stakeholder","qa","backlog","sprint","saas","mobile","b2b","fintech",
           "edtech","gamification"],
  sponsorKeywords: ["visa","sponsor","relocation","relocate","blue card",
                    "work permit","international"],
};

function score(job){
  const t=(job.title||"").toLowerCase();
  const d=(job.description||"").toLowerCase();
  const tags=(job.tags||[]).join(" ").toLowerCase();
  const blob=t+" "+d+" "+tags;
  let s=0, why=[];
  for(const tt of PROFILE.titles){ if(t.includes(tt)){ s+=40; why.push("title matches "+tt); break; } }
  if(s===0){ for(const tt of PROFILE.titles){ if(blob.includes(tt)){ s+=18; why.push("mentions "+tt); break; } } }
  const sk=PROFILE.skills.filter(k=>blob.includes(k));
  if(sk.length){ s+=Math.min(sk.length*6,30); why.push("skills: "+sk.slice(0,4).join(", ")); }
  const sp=PROFILE.sponsorKeywords.filter(k=>blob.includes(k));
  if(sp.length){ s+=20; }
  if(job.remote){ s+=10; }
  return {score:s, why, sponsor: sp.length>0};
}

// ---------- Arbeitnow ----------
async function fetchArbeitnow(){
  const out=[];
  for(let p=1;p<=5;p++){
    try{
      const r=await fetch("https://www.arbeitnow.com/api/job-board-api?page="+p,
        {headers:{"User-Agent":"job-pipeline-personal"}});
      if(!r.ok) throw new Error("HTTP "+r.status);
      const j=await r.json();
      (j.data||[]).forEach(x=>out.push({
        title:x.title, company_name:x.company_name, location:x.location,
        url:x.url, remote:!!x.remote, tags:x.tags||[],
        description:x.description||"", source:"Arbeitnow", country:"EU"
      }));
    }catch(e){ console.error("Arbeitnow p"+p+":",e.message); }
  }
  return out;
}

// ---------- Adzuna ----------
async function fetchAdzunaCountry(cc, term){
  const url="https://api.adzuna.com/v1/api/jobs/"+cc+"/search/1"
    +"?app_id="+encodeURIComponent(ADZUNA_ID)
    +"&app_key="+encodeURIComponent(ADZUNA_KEY)
    +"&results_per_page=50"
    +"&what="+encodeURIComponent(term)
    +"&max_days_old=30"
    +"&content-type=application/json";
  const r=await fetch(url);
  if(!r.ok) throw new Error("HTTP "+r.status);
  const j=await r.json();
  return (j.results||[]).map(x=>({
    title:x.title||"",
    company_name:(x.company&&x.company.display_name)||"",
    location:(x.location&&x.location.display_name)||cc.toUpperCase(),
    url:x.redirect_url||"",
    remote:/remote/i.test((x.title||"")+(x.description||"")),
    tags:[(x.category&&x.category.label)||""].filter(Boolean),
    description:x.description||"",
    source:"Adzuna", country:cc.toUpperCase()
  }));
}

async function fetchAdzuna(){
  if(!ADZUNA_ID||!ADZUNA_KEY){ console.error("No Adzuna keys set — skipping Adzuna."); return []; }
  const out=[];
  for(const cc of ADZUNA_COUNTRIES){
    for(const term of SEARCH_TERMS){
      try{
        const rows=await fetchAdzunaCountry(cc,term);
        out.push(...rows);
        await new Promise(r=>setTimeout(r,250)); // be gentle on rate limit
      }catch(e){ console.error("Adzuna "+cc+"/"+term+":",e.message); }
    }
  }
  return out;
}

function dedupe(jobs){
  const seen=new Set(), out=[];
  for(const j of jobs){
    const key=((j.title||"")+"|"+(j.company_name||"")+"|"+((j.location||"").split(",")[0])).toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key); out.push(j);
  }
  return out;
}

(async () => {
  const [arb, adz] = await Promise.all([fetchArbeitnow(), fetchAdzuna()]);
  console.log("Arbeitnow:",arb.length," Adzuna:",adz.length);

  let all = dedupe(arb.concat(adz));

  const ranked = all.map(j=>{
    const sc=score(j);
    return { ...j, _score:sc.score, _why:sc.why, _sponsor:sc.sponsor };
  })
  .filter(j=> j._score >= 18)          // drop near-irrelevant noise
  .sort((a,b)=> b._score - a._score);

  const out = {
    generated_at: new Date().toISOString(),
    count: ranked.length,
    sources: ["Arbeitnow", "Adzuna ("+ADZUNA_COUNTRIES.join(",")+")"],
    jobs: ranked.slice(0, 250)
  };
  fs.writeFileSync("jobs.json", JSON.stringify(out, null, 2));
  console.log("Wrote jobs.json with "+out.jobs.length+" jobs.");
})();
