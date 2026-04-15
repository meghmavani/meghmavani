const fs = require('fs');
const https = require('https');
const path = require('path');

const README_PATH = './README.md';
const NOW_BUILDING_SVG_PATH = './assets/now-building.svg';

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
  latestContrib: 'LATEST-CONTRIB',
  spotlight: 'PROJECT-SPOTLIGHT',
  techStack: 'TECH-STACK',
};

const requestJson = (path) =>
  new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
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
    return '- latest contribution: no public contribution events yet';
  }

  if (event.type === 'PushEvent') {
    const commits = event.payload && event.payload.commits ? event.payload.commits.length : 0;
    if (commits > 0) {
      return `- latest contribution: pushed ${commits} commit(s) to ${repoName} (${eventTime})`;
    }
    return `- latest contribution: pushed code to ${repoName} (${eventTime})`;
  }

  if (event.type === 'PullRequestEvent') {
    const action = event.payload && event.payload.action ? event.payload.action : 'updated';
    return `- latest contribution: ${action} a pull request in ${repoName} (${eventTime})`;
  }

  if (event.type === 'CreateEvent') {
    const refType = event.payload && event.payload.ref_type ? event.payload.ref_type : 'item';
    return `- latest contribution: created a ${refType} in ${repoName} (${eventTime})`;
  }

  return `- latest contribution: ${event.type} in ${repoName} (${eventTime})`;
};

const pickLatestRepo = (repos) => {
  const filtered = repos.filter(
    (repo) => !repo.fork && repo.name.toLowerCase() !== GITHUB_USERNAME.toLowerCase(),
  );
  return filtered[0] || repos[0] || null;
};

const languageColor = {
  Python: '1f2937',
  JavaScript: '374151',
  TypeScript: '4b5563',
  Jupyter: '0f766e',
  HTML: '155e75',
  CSS: '0f172a',
  C: '3f3f46',
  'C++': '52525b',
  Java: '0c4a6e',
  Go: '075985',
  Rust: '7c2d12',
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
    return '<p>\n  <img src="https://img.shields.io/badge/systems_ai-0f766e?style=flat-square" alt="systems ai" />\n</p>';
  }

  const badges = top
    .map((name) => {
      const color = languageColor[name] || '334155';
      const label = encodeURIComponent(String(name).toLowerCase().replace(/\s+/g, '_'));
      const alt = String(name).toLowerCase();
      return `  <img src="https://img.shields.io/badge/${label}-${color}?style=flat-square" alt="${alt}" />`;
    })
    .join('\n');

  return `<p>\n${badges}\n</p>`;
};

const writeNowBuildingBanner = (latestContributionLine, currentFocusLine) => {
  const contributionText = truncate(
    stripMarkdown(latestContributionLine).replace(/^latest contribution:\s*/i, ''),
    85,
  );
  const focusText = truncate(
    stripMarkdown(currentFocusLine).replace(/^current focus hint:\s*/i, ''),
    85,
  );

  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="980" height="140" viewBox="0 0 980 140" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="now building status">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="980" y2="140" gradientUnits="userSpaceOnUse">
      <stop stop-color="#020617"/>
      <stop offset="0.55" stop-color="#0F172A"/>
      <stop offset="1" stop-color="#082F49"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="980" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22D3EE"/>
      <stop offset="1" stop-color="#0EA5E9"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="1" y="1" width="978" height="138" rx="12" fill="url(#bg)" stroke="#1E293B"/>
  <rect x="18" y="18" width="944" height="3" rx="1.5" fill="url(#line)" filter="url(#glow)"/>

  <text x="30" y="46" fill="#67E8F9" font-family="'Fira Code', Consolas, monospace" font-size="17" font-weight="700">
    >>> now building
  </text>

  <text x="30" y="74" fill="#E2E8F0" font-family="'Fira Code', Consolas, monospace" font-size="14">
    ${escapeXml(contributionText)}
  </text>

  <text x="30" y="100" fill="#93C5FD" font-family="'Fira Code', Consolas, monospace" font-size="13">
    ${escapeXml(focusText)}
  </text>

  <text x="30" y="123" fill="#64748B" font-family="'Fira Code', Consolas, monospace" font-size="11">
    refreshed ${escapeXml(stamp)} UTC
  </text>
</svg>
`;

  fs.mkdirSync(path.dirname(NOW_BUILDING_SVG_PATH), { recursive: true });
  fs.writeFileSync(NOW_BUILDING_SVG_PATH, svg);
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

  const latestRepoLine = latestRepo
    ? `- latest repo: [${latestRepo.full_name}](${latestRepo.html_url})${
        latestRepo.updated_at ? ` (updated ${relativeTime(latestRepo.updated_at)})` : ''
      }`
    : '- latest repo: no public repo data found yet';

  const latestContributionLine = eventToLine(latestEvent);

  const currentFocusLine = latestRepo && latestRepo.description
    ? `- current focus hint: ${truncate(latestRepo.description, 110)}`
    : '- current focus hint: building modular ai systems that perceive, adapt, and act';

  const spotlightBlock = c4psRepo
    ? [
        `- repo spotlight: [${c4psRepo.full_name}](${c4psRepo.html_url})`,
        `- why this one: ${truncate(c4psRepo.description || 'core featured project in this profile', 110)}`,
        `- signal: ${(c4psRepo.language || 'multi-language').toLowerCase()} project, ${c4psRepo.stargazers_count} stars`,
      ].join('\n')
    : [
        `- repo spotlight: [${GITHUB_USERNAME}/c4ps](https://github.com/${GITHUB_USERNAME}/c4ps)`,
        '- why this one: selected as the primary spotlight project',
        '- signal: pinned spotlight target',
      ].join('\n');

  const latestContribBlock = [latestRepoLine, latestContributionLine, currentFocusLine].join('\n');
  const techStackBlock = buildTechStackBlock(repoList);

  writeNowBuildingBanner(latestContributionLine, currentFocusLine);

  const readmeData = fs.readFileSync(README_PATH, 'utf8');
  let nextReadme = readmeData;
  nextReadme = replaceBlock(nextReadme, TAGS.latestContrib, latestContribBlock);
  nextReadme = replaceBlock(nextReadme, TAGS.spotlight, spotlightBlock);
  nextReadme = replaceBlock(nextReadme, TAGS.techStack, techStackBlock);

  if (nextReadme !== readmeData) {
    fs.writeFileSync(README_PATH, nextReadme);
    console.log('README updated with latest contribution, c4ps spotlight, and tech stack blocks.');
  } else {
    console.log('README already up to date (banner refreshed).');
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
