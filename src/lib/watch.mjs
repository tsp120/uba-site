import fs from 'node:fs';
const file = 'public/data/watch.json';
export const watchDays = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
