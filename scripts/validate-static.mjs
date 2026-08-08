import { readFile, access } from 'node:fs/promises';
const required = ['public/index.html','public/monetization-checker/index.html','public/earnings-calculator/index.html','public/assets/site.css','public/assets/site.js','public/robots.txt','public/sitemap.xml','functions/api/check.js','.env.example'];
await Promise.all(required.map(file => access(file)));
const checker = await readFile('public/monetization-checker/index.html','utf8');
const exact = [
  '<title>YouTube Monetization Checker – Check Any Channel Instantly</title>',
  `content="Check any YouTube channel's monetization status instantly. Verify YPP eligibility, ad revenue, authenticity scores &amp; earnings estimates for creators &amp; brands."`,
  '<h1>YouTube Monetization <span>Checker</span></h1>',
  '"@type":"FAQPage"','"@type":"HowTo"','"@type":"BreadcrumbList"','"@type":"WebApplication"'
];
for (const token of exact) if (!checker.includes(token)) throw new Error(`Missing required checker token: ${token}`);
console.log('Static site validation passed. Output directory: public');
