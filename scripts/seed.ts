import { seedDemoData } from "../src/lib/data";

const user = seedDemoData();
console.log(`Seeded GanSystems demo data for ${user.email}`);
