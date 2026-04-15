const fs = require('fs');
const https = require('https');
const path = require('path');

const README_PATH = './README.md';
const NOW_BUILDING_SVG_PATH = './assets/now-building.svg';
const SYSTEM_PULSE_SVG_PATH = './assets/system-pulse.svg';
const SPOTLIGHT_CARD_SVG_PATH = './assets/spotlight-card.svg';

const usernameFromRepo = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split('/')[0]
  : '';

const GITHUB_USERNAME = process.env.GH_USERNAME || usernameFromRepo;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

if (!GITHUB_USERNAME) {
  console.error('Missing GitHub username. Set GH_USERNAME or GITHUB_REPOSITORY.');
  process.exit(1);
}

const TAGS = {
  techStack: 'TECH-STACK',
};

const requestJson = (requestPath) =>
  new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: requestPath,
      method: 'GET',
      headers: {
        'User-Agent': 'readme-automation-bot',
        Accept: 'application/vnd.github+json',
      },
    };

    if (GITHUB_TOKEN) {
      options.headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 404) {
          return resolve(null);
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
        }

        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });

const replaceBlock = (previousContent, tagName, newContent) => {
  const tagToLookFor = `<!-- ${tagName}:`;
  const closingTag = '-->';
  const startOfOpeningTagIndex = previousContent.indexOf(`${tagToLookFor}START`);
  const endOfOpeningTagIndex = previousContent.indexOf(closingTag, startOfOpeningTagIndex);
  const startOfClosingTagIndex = previousContent.indexOf(
    `${tagToLookFor}END`,
    endOfOpeningTagIndex,
  );

  if (
    startOfOpeningTagIndex === -1 ||
    endOfOpeningTagIndex === -1 ||
    startOfClosingTagIndex === -1
  ) {
    console.error(`Cannot find README tags for ${tagName}.`);
    process.exit(1);
  }

  return [
    previousContent.slice(0, endOfOpeningTagIndex + closingTag.length),
    '\n',
    newContent,
    '\n',
    previousContent.slice(startOfClosingTagIndex),
  ].join('');
};

const stripMarkdown = (value) =>
  String(value || '')
    .replace(/`+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[>#*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const truncate = (value, maxLength) => {
  const normalized = stripMarkdown(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
};

const relativeTime = (isoDate) => {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = Math.max(now - then, 0);
  const hours = Math.floor(diffMs / (1000 * 60 * 60));

  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
};

const eventToLine = (event) => {
  const repoName = event && event.repo ? event.repo.name : 'unknown repo';
  const eventTime = event && event.created_at ? relativeTime(event.created_at) : 'recently';

  if (!event || !event.type) {
    return 'no public contribution events yet';
  }

  if (event.type === 'PushEvent') {
    const commits = event.payload && event.payload.commits ? event.payload.commits.length : 0;
    if (commits > 0) {
      return `pushed ${commits} commit(s) to ${repoName} (${eventTime})`;
    }
    return `pushed code to ${repoName} (${eventTime})`;
  }

  if (event.type === 'PullRequestEvent') {
    const action = event.payload && event.payload.action ? event.payload.action : 'updated';
    return `${action} a pull request in ${repoName} (${eventTime})`;
  }

  if (event.type === 'CreateEvent') {
    const refType = event.payload && event.payload.ref_type ? event.payload.ref_type : 'item';
    return `created a ${refType} in ${repoName} (${eventTime})`;
  }

  return `${event.type} in ${repoName} (${eventTime})`;
};

const pickLatestRepo = (repos) => {
  const filtered = repos.filter(
    (repo) => !repo.fork && repo.name.toLowerCase() !== GITHUB_USERNAME.toLowerCase(),
  );
  return filtered[0] || repos[0] || null;
};

const languageColor = {
  Python: '0f172a',
  JavaScript: '312e81',
  TypeScript: '4c1d95',
  Jupyter: '3b0764',
  HTML: '172554',
  CSS: '1e1b4b',
  C: '334155',
  'C++': '111827',
  Java: '1e293b',
  Go: '2e1065',
  Rust: '111827',
};

const buildTechStackBlock = (repos) => {
  const counts = new Map();
  repos.forEach((repo) => {
    const key = repo.language || 'systems';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name]) => name);

  if (!top.length) {
    return '<p>\n  <img src="https://img.shields.io/badge/systems_ai-312e81?style=flat-square" alt="systems ai" />\n</p>';
  }

  const badges = top
    .map((name) => {
      const color = languageColor[name] || '312e81';
      const label = encodeURIComponent(String(name).toLowerCase().replace(/\s+/g, '_'));
      const alt = String(name).toLowerCase();
      return `  <img src="https://img.shields.io/badge/${label}-${color}?style=flat-square" alt="${alt}" />`;
    })
    .join('\n');

  return `<p>\n${badges}\n</p>`;
};

const getTopLanguages = (repos, limit = 5) => {
  const counts = new Map();
  repos.forEach((repo) => {
    const key = repo.language || 'systems';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
};

const writeNowBuildingBanner = (latestContributionText, latestRepoLine) => {
  const contributionText = truncate(latestContributionText, 88);
  const repoText = truncate(latestRepoLine, 88);

  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="980" height="145" viewBox="0 0 980 145" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="now building status">
  <defs>
    <linearGradient id="nbBg" x1="0" y1="0" x2="980" y2="145" gradientUnits="userSpaceOnUse">
      <stop stop-color="#020617"/>
      <stop offset="0.7" stop-color="#0B1120"/>
      <stop offset="1" stop-color="#140a2b"/>
    </linearGradient>
    <linearGradient id="nbLine" x1="0" y1="0" x2="980" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6D28D9"/>
      <stop offset="1" stop-color="#4C1D95"/>
    </linearGradient>
  </defs>

  <rect x="1" y="1" width="978" height="143" rx="12" fill="url(#nbBg)" stroke="#312E81"/>
  <rect x="18" y="18" width="944" height="3" rx="1.5" fill="url(#nbLine)"/>

  <text x="30" y="47" fill="#C4B5FD" font-family="'Segoe UI', 'Trebuchet MS', Arial, sans-serif" font-size="21" font-weight="700">
    now building
  </text>

  <text x="30" y="77" fill="#EDE9FE" font-family="'Segoe UI', 'Trebuchet MS', Arial, sans-serif" font-size="16">
    ${escapeXml(contributionText)}
  </text>

  <text x="30" y="104" fill="#DDD6FE" font-family="'Segoe UI', 'Trebuchet MS', Arial, sans-serif" font-size="14">
    ${escapeXml(repoText)}
  </text>

  <text x="30" y="127" fill="#A78BFA" font-family="'Segoe UI', 'Trebuchet MS', Arial, sans-serif" font-size="12">
    refreshed ${escapeXml(stamp)} UTC
  </text>
</svg>
`;

  fs.mkdirSync(path.dirname(NOW_BUILDING_SVG_PATH), { recursive: true });
  fs.writeFileSync(NOW_BUILDING_SVG_PATH, svg);
};

const writeSystemPulseBanner = (latestRepo, latestContributionText, topLanguages) => {
  const repoName = latestRepo ? latestRepo.full_name : `${GITHUB_USERNAME}/unknown`;
  const repoLang = latestRepo && latestRepo.language ? latestRepo.language : 'systems';
  const repoStars = latestRepo && typeof latestRepo.stargazers_count === 'number'
    ? latestRepo.stargazers_count
    : 0;
  const contributionText = truncate(latestContributionText, 72);

  const bars = topLanguages.length ? topLanguages : [['systems', 1]];
  const maxCount = Math.max(...bars.map((entry) => entry[1]), 1);

  const barSvg = bars.map(([language, count], index) => {
    const y = 64 + index * 18;
    const width = Math.max(90, Math.round((count / maxCount) * 330));
    const delay = (index * 0.2).toFixed(1);
    return `
  <text x="600" y="${y + 10}" fill="#C4B5FD" font-family="'Segoe UI', Arial, sans-serif" font-size="12">${escapeXml(String(language))}</text>
  <rect x="700" y="${y}" width="${width}" height="10" rx="5" fill="#7C3AED" opacity="0.85">
    <animate attributeName="opacity" values="0.35;0.9;0.35" dur="2.4s" begin="${delay}s" repeatCount="indefinite"/>
  </rect>`;
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="980" height="170" viewBox="0 0 980 170" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="system pulse">
  <defs>
    <linearGradient id="pulseBg" x1="0" y1="0" x2="980" y2="170" gradientUnits="userSpaceOnUse">
      <stop stop-color="#020617"/>
      <stop offset="1" stop-color="#120824"/>
    </linearGradient>
  </defs>

  <rect x="1" y="1" width="978" height="168" rx="12" fill="url(#pulseBg)" stroke="#312E81"/>

  <text x="28" y="38" fill="#C4B5FD" font-family="'Segoe UI', Arial, sans-serif" font-size="18" font-weight="700">system pulse</text>
  <circle cx="152" cy="33" r="5" fill="#A78BFA">
    <animate attributeName="opacity" values="1;0.35;1" dur="1.5s" repeatCount="indefinite"/>
  </circle>

  <text x="28" y="68" fill="#F5F3FF" font-family="'Segoe UI', Arial, sans-serif" font-size="14">repo: ${escapeXml(repoName)}</text>
  <text x="28" y="91" fill="#DDD6FE" font-family="'Segoe UI', Arial, sans-serif" font-size="14">language: ${escapeXml(String(repoLang))} | stars: ${repoStars}</text>
  <text x="28" y="114" fill="#C4B5FD" font-family="'Segoe UI', Arial, sans-serif" font-size="14">event: ${escapeXml(contributionText)}</text>

  <text x="600" y="40" fill="#E9D5FF" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="700">language activity</text>
  ${barSvg}
</svg>
`;

  fs.mkdirSync(path.dirname(SYSTEM_PULSE_SVG_PATH), { recursive: true });
  fs.writeFileSync(SYSTEM_PULSE_SVG_PATH, svg);
};

const writeSpotlightCard = (c4psRepo) => {
  const name = c4psRepo ? c4psRepo.full_name : `${GITHUB_USERNAME}/C4PS`;
  const description = c4psRepo
    ? truncate(c4psRepo.description || 'modular pipeline project', 105)
    : 'core featured project for this profile';
  const language = c4psRepo && c4psRepo.language ? c4psRepo.language : 'python';
  const stars = c4psRepo && typeof c4psRepo.stargazers_count === 'number'
    ? c4psRepo.stargazers_count
    : 0;
  const issues = c4psRepo && typeof c4psRepo.open_issues_count === 'number'
    ? c4psRepo.open_issues_count
    : 0;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="980" height="145" viewBox="0 0 980 145" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="spotlight card">
  <defs>
    <linearGradient id="spotBg" x1="0" y1="0" x2="980" y2="145" gradientUnits="userSpaceOnUse">
      <stop stop-color="#140a2b"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="978" height="143" rx="12" fill="url(#spotBg)" stroke="#4C1D95"/>
  <text x="28" y="40" fill="#E9D5FF" font-family="'Segoe UI', Arial, sans-serif" font-size="19" font-weight="700">spotlight :: c4ps</text>
  <text x="28" y="68" fill="#F5F3FF" font-family="'Segoe UI', Arial, sans-serif" font-size="16">${escapeXml(name)}</text>
  <text x="28" y="95" fill="#DDD6FE" font-family="'Segoe UI', Arial, sans-serif" font-size="14">${escapeXml(description)}</text>
  <text x="28" y="122" fill="#C4B5FD" font-family="'Segoe UI', Arial, sans-serif" font-size="13">lang: ${escapeXml(language.toLowerCase())} | stars: ${stars} | open issues: ${issues}</text>
  <rect x="810" y="22" width="140" height="38" rx="10" fill="#7C3AED" opacity="0.25"/>
  <text x="828" y="46" fill="#EDE9FE" font-family="'Segoe UI', Arial, sans-serif" font-size="12">featured repo</text>
</svg>
`;

  fs.mkdirSync(path.dirname(SPOTLIGHT_CARD_SVG_PATH), { recursive: true });
  fs.writeFileSync(SPOTLIGHT_CARD_SVG_PATH, svg);
};

const main = async () => {
  const [repos, events, c4psRepo] = await Promise.all([
    requestJson(`/users/${GITHUB_USERNAME}/repos?sort=updated&per_page=30&type=owner`),
    requestJson(`/users/${GITHUB_USERNAME}/events/public?per_page=20`),
    requestJson(`/repos/${GITHUB_USERNAME}/c4ps`),
  ]);

  const repoList = Array.isArray(repos) ? repos : [];
  const eventList = Array.isArray(events) ? events : [];

  const latestRepo = pickLatestRepo(repoList);
  const latestEvent = eventList.length ? eventList[0] : null;

  const latestRepoText = latestRepo
    ? `${latestRepo.full_name}${latestRepo.updated_at ? ` (updated ${relativeTime(latestRepo.updated_at)})` : ''}`
    : 'no public repo data found yet';

  const latestContributionText = eventToLine(latestEvent);
  const techStackBlock = buildTechStackBlock(repoList);
  const topLanguages = getTopLanguages(repoList, 5);

  writeNowBuildingBanner(latestContributionText, latestRepoText);
  writeSystemPulseBanner(latestRepo, latestContributionText, topLanguages);
  writeSpotlightCard(c4psRepo);

  const readmeData = fs.readFileSync(README_PATH, 'utf8');
  const nextReadme = replaceBlock(readmeData, TAGS.techStack, techStackBlock);

  if (nextReadme !== readmeData) {
    fs.writeFileSync(README_PATH, nextReadme);
    console.log('README updated with tech stack; live feed SVGs refreshed.');
  } else {
    console.log('README already up to date (live feed SVGs refreshed).');
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
