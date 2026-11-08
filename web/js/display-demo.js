// Made-up board for checking the display layout (display/index.html?demo).
// Made-up names and codes only; nothing here comes from the database.

const STATIONS = [
  ["Fit Feet", "Feet and footwear", "foot", "#198754"],
  ["FUNfitness", "Strength and flexibility", "run", "#fd7e14"],
  ["Health Promotion", "Healthy living", "apple", "#20c997"],
  ["Healthy Hearing", "Hearing", "ear", "#6f42c1"],
  ["Opening Eyes", "Vision", "eye", "#1f6feb"],
  ["Special Smiles", "Dental", "tooth", "#d63384"],
  ["Strong Minds", "Emotional wellbeing", "mind", "#0b7f99"],
];
const NAMES = ["Alex", "Bea", "Carmen", "Dylan", "Ella", "Finn", "Gabi", "Hugo", "Isla", "Jake", "Kira", "Luca", "Maya", "Noah"];
const SURNAMES = ["Sample", "Example", "Demo", "Testa", "Placeholder", "Mockford", "Fictus"];

let step = 0;

export function demoBoard() {
  step += 1;
  const turn = Math.floor(step / 4); // a new call roughly every 12 seconds
  const now = Date.now();
  const stations = STATIONS.map(([name, subtitle, icon, colour], i) => {
    const queued = (i * 7 + turn) % 12;
    return {
      id: `s${i}`, name, subtitle, icon, colour, queued,
      wait_minutes: queued ? queued * (6 + i) : null,
      next: queued ? { first_name: NAMES[(i * 3 + turn) % NAMES.length], last_name: SURNAMES[(i + turn) % SURNAMES.length], athlete_code: `HA-${String(100 + i * 11 + turn).padStart(4, "0")}` } : null,
    };
  });
  const calls = [0, 1, 2, 3, 4].map((k) => {
    const n = turn - k;
    return {
      first_name: NAMES[((n % NAMES.length) + NAMES.length) % NAMES.length],
      last_name: SURNAMES[((n % SURNAMES.length) + SURNAMES.length) % SURNAMES.length],
      athlete_code: `HA-${String(200 + n).padStart(4, "0")}`,
      station_id: `s${((n % STATIONS.length) + STATIONS.length) % STATIONS.length}`,
      called_at: new Date(1.8e12 + n * 12000).toISOString(),
    };
  });
  return { event: { id: "demo", name: "Healthy Athletes · Demo event" }, now: new Date(now).toISOString(), calls, stations };
}
