// fetch-jobs.js — runs on GitHub Actions servers (Node 20+, no CORS).
// Pulls jobs from Arbeitnow, ranks them against Aqib's profile, writes jobs.json.

const fs = require("fs");

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

async function getPage(p){
  const r = await fetch("https://www.arbeitnow.com/api/job-board-api?page="+p, {
    headers: { "User-Agent": "job-pipeline-personal" }
  });
  if(!r.ok) throw new Error("HTTP "+r.status);
  const j = await r.json();
  return j.data || [];
}

(async () => {
  let all = [];
  for(let p=1; p<=5; p++){
    try { all = all.concat(await getPage(p)); }
    catch(e){ console.error("page "+p+" failed:", e.message); }
  }

  const ranked = all.map(j => {
    const sc = score(j);
    return { ...j, _score: sc.score, _why: sc.why, _sponsor: sc.sponsor };
  }).sort((a,b)=> b._score - a._score);

  const out = {
    generated_at: new Date().toISOString(),
    count: ranked.length,
    jobs: ranked.slice(0, 150)
  };

  fs.writeFileSync("jobs.json", JSON.stringify(out, null, 2));
  console.log("Wrote jobs.json with "+out.jobs.length+" jobs at "+out.generated_at);
})();
