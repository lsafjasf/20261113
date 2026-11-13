import { generateMission } from './js/generator.js';
import { CONFIG } from './js/config.js';
let maxTime=0, maxFuelRatio=0, minPat=999, bad=0;
const seen = new Set();
for (let i=0;i<300;i++){
  const seed = 'seed-'+i;
  const m = generateMission(seed);
  if (seen.has(seed)) throw new Error('dup');
  seen.add(seed);
  if (m.passengers.length!==8) bad++;
  if (m.reference.delivered!==8) bad++;
  if (m.reference.time > CONFIG.duration*CONFIG.budget.timeRatio) bad++;
  if (m.reference.fuelUsed > m.reference.tank*CONFIG.budget.fuelRatio) bad++;
  for (const p of m.passengers){
    if (p.from===p.to) bad++;
    if (p.patience < CONFIG.patience.minCap) minPat=Math.min(minPat,p.patience);
  }
  maxTime=Math.max(maxTime,m.reference.time);
  maxFuelRatio=Math.max(maxFuelRatio,m.reference.fuelUsed/m.reference.tank);
  minPat=Math.min(minPat,...m.passengers.map(p=>p.patience));
}
console.log({bad,maxTime:maxTime.toFixed(1),maxFuelRatio:maxFuelRatio.toFixed(3),minPat:minPat.toFixed(1)});
const m0 = generateMission('ferry-2026');
console.log(JSON.stringify({route:m0.route, passengers:m0.passengers, refTime:+m0.reference.time.toFixed(1), tank:m0.reference.tank, fuel:+m0.reference.fuelUsed.toFixed(1)},null,1));
